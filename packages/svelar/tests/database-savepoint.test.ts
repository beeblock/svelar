import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Connection, type DatabaseDriverAlias } from '../src/database/Connection.js';

function postgresFixture() {
  const nestedClient = { unsafe: vi.fn(async () => [{ scope: 'nested' }]) };
  const savepointClient = {
    unsafe: vi.fn(async () => [{ scope: 'savepoint' }]),
    savepoint: vi.fn(async (callback: (client: typeof nestedClient) => Promise<unknown>) => callback(nestedClient)),
  };
  const rolledBack = vi.fn();
  const settled = vi.fn();
  const transactionClient = {
    unsafe: vi.fn(async () => [{ scope: 'transaction' }]),
    savepoint: vi.fn(async (callback: (client: typeof savepointClient) => Promise<unknown>) => {
      try {
        const result = await callback(savepointClient);
        settled('success');
        return result;
      } catch (error) {
        rolledBack(error);
        settled('failure');
        throw error;
      }
    }),
  };
  const pool = {
    begin: vi.fn(async (callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient)),
  };
  return { pool, transactionClient, savepointClient, nestedClient, rolledBack, settled };
}

describe.sequential('Connection.withSavepointIfNeeded', () => {
  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({
      default: 'main',
      connections: {
        main: { driver: 'postgres' },
        analytics: { driver: 'postgres' },
        sqlite: { driver: 'sqlite', filename: ':memory:' },
        mysql: { driver: 'mysql' },
      },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Connection.disconnect();
  });

  it.each(['sqlite', 'mysql', 'mysql2', 'postgres', 'postgresql'] as const)(
    'calls directly outside a transaction without acquiring a client (%s)', async (driver: DatabaseDriverAlias) => {
      Connection.configure({ default: 'main', connections: { main: { driver } } });
      const rawClient = vi.spyOn(Connection, 'rawClient').mockRejectedValue(new Error('Unexpected client acquisition'));
      const connection = vi.spyOn(Connection, 'connection').mockRejectedValue(new Error('Unexpected connection acquisition'));
      const transaction = vi.spyOn(Connection, 'transaction').mockRejectedValue(new Error('Unexpected transaction'));
      const value = { id: 42 };
      const callback = vi.fn(async () => value);
      const result = await Connection.withSavepointIfNeeded(callback);
      expectTypeOf(result).toEqualTypeOf<{ id: number }>();
      expect(result).toBe(value);
      expect(callback).toHaveBeenCalledExactlyOnceWith();
      expect(rawClient).not.toHaveBeenCalled();
      expect(connection).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['sqlite', 'mysql', 'main'] as const)('preserves direct callback errors without acquiring a client (%s)', async (name) => {
    const original = new Error('statement failed');
    const rawClient = vi.spyOn(Connection, 'rawClient').mockRejectedValue(new Error('Unexpected acquisition'));
    const connection = vi.spyOn(Connection, 'connection').mockRejectedValue(new Error('Unexpected acquisition'));
    await expect(Connection.withSavepointIfNeeded(() => { throw original; }, name)).rejects.toBe(original);
    await expect(Connection.withSavepointIfNeeded(async () => { throw original; }, name)).rejects.toBe(original);
    expect(rawClient).not.toHaveBeenCalled();
    expect(connection).not.toHaveBeenCalled();
  });

  it('validates the configured connection before invoking the callback or acquiring clients', async () => {
    const callback = vi.fn(async () => 1);
    const rawClient = vi.spyOn(Connection, 'rawClient');
    const connection = vi.spyOn(Connection, 'connection');
    await expect(Connection.withSavepointIfNeeded(callback, 'missing')).rejects.toThrow('Database connection "missing" is not defined.');
    expect(callback).not.toHaveBeenCalled();
    expect(rawClient).not.toHaveBeenCalled();
    expect(connection).not.toHaveBeenCalled();
  });

  it('delegates savepoint settlement to PostgreSQL and restores the outer client', async () => {
    const fixture = postgresFixture();
    vi.spyOn(Connection, 'connection').mockResolvedValue({});
    const rawClient = vi.spyOn(Connection, 'rawClient').mockResolvedValueOnce(fixture.pool);
    const value = { insertedId: 'uuid' };
    const result = await Connection.transaction(async () => {
      expect(await Connection.rawClient()).toBe(fixture.transactionClient);
      const acquisitions = rawClient.mock.calls.length;
      const saved = await Connection.withSavepointIfNeeded(async () => {
        expect(rawClient).toHaveBeenCalledTimes(acquisitions);
        expect(await Connection.rawClient()).toBe(fixture.savepointClient);
        await Connection.raw('INSERT INTO records (id) VALUES (?)', ['uuid']);
        expect(fixture.settled).not.toHaveBeenCalled();
        return value;
      });
      expect(await Connection.rawClient()).toBe(fixture.transactionClient);
      expect(fixture.settled).toHaveBeenCalledExactlyOnceWith('success');
      return saved;
    });
    expect(result).toBe(value);
    expect(fixture.pool.begin).toHaveBeenCalledTimes(1);
    expect(fixture.transactionClient.savepoint).toHaveBeenCalledTimes(1);
    expect(fixture.savepointClient.unsafe).toHaveBeenCalledExactlyOnceWith('INSERT INTO records (id) VALUES ($1)', ['uuid']);
    expect(fixture.transactionClient.unsafe).not.toHaveBeenCalled();
    expect(fixture.rolledBack).not.toHaveBeenCalled();
    await expect(Connection.withSavepointIfNeeded(async () => 'outside')).resolves.toBe('outside');
    expect(fixture.transactionClient.savepoint).toHaveBeenCalledTimes(1);
  });

  it('delegates rollback while preserving the INSERT error and the usable outer transaction', async () => {
    const fixture = postgresFixture();
    const original = Object.assign(new Error('unique violation'), { code: '23505' });
    fixture.savepointClient.unsafe.mockRejectedValueOnce(original);
    vi.spyOn(Connection, 'connection').mockResolvedValue({});
    vi.spyOn(Connection, 'rawClient').mockResolvedValueOnce(fixture.pool);
    await Connection.transaction(async () => {
      await expect(Connection.withSavepointIfNeeded(() => Connection.raw('INSERT INTO records (id) VALUES (?)', ['duplicate'])))
        .rejects.toBe(original);
      expect(fixture.rolledBack).toHaveBeenCalledExactlyOnceWith(original);
      expect(fixture.settled).toHaveBeenCalledExactlyOnceWith('failure');
      expect(await Connection.rawClient()).toBe(fixture.transactionClient);
      await expect(Connection.raw('SELECT 1')).resolves.toEqual([{ scope: 'transaction' }]);
    });
    expect(fixture.pool.begin).toHaveBeenCalledTimes(1);
    expect(fixture.transactionClient.unsafe).toHaveBeenCalledExactlyOnceWith('SELECT 1', []);
    expect(fixture.savepointClient.unsafe).toHaveBeenCalledTimes(1);
  });

  it('preserves savepoint setup failures without running the callback or replacing the outer client', async () => {
    const fixture = postgresFixture();
    const original = new Error('savepoint setup failed');
    fixture.transactionClient.savepoint.mockRejectedValueOnce(original);
    vi.spyOn(Connection, 'rawClient').mockResolvedValueOnce(fixture.pool);
    const callback = vi.fn(async () => 1);
    await Connection.transaction(async () => {
      await expect(Connection.withSavepointIfNeeded(callback)).rejects.toBe(original);
      expect(callback).not.toHaveBeenCalled();
      expect(await Connection.rawClient()).toBe(fixture.transactionClient);
    });
  });

  it('uses the current savepoint client for nested savepoints and restores each enclosing client', async () => {
    const fixture = postgresFixture();
    vi.spyOn(Connection, 'rawClient').mockResolvedValueOnce(fixture.pool);
    await Connection.transaction(async () => {
      await Connection.withSavepointIfNeeded(async () => {
        expect(await Connection.rawClient()).toBe(fixture.savepointClient);
        await Connection.withSavepointIfNeeded(async () => {
          expect(await Connection.rawClient()).toBe(fixture.nestedClient);
        });
        expect(await Connection.rawClient()).toBe(fixture.savepointClient);
      });
      expect(await Connection.rawClient()).toBe(fixture.transactionClient);
    });
    expect(fixture.transactionClient.savepoint).toHaveBeenCalledTimes(1);
    expect(fixture.savepointClient.savepoint).toHaveBeenCalledTimes(1);
  });

  it('does not borrow an active transaction from another named connection', async () => {
    const fixture = postgresFixture();
    const rawClient = vi.spyOn(Connection, 'rawClient').mockResolvedValueOnce(fixture.pool);
    await Connection.transaction(async () => {
      const acquisitions = rawClient.mock.calls.length;
      await expect(Connection.withSavepointIfNeeded(async () => {
        expect(rawClient).toHaveBeenCalledTimes(acquisitions);
        expect(await Connection.rawClient('main')).toBe(fixture.transactionClient);
        return 'analytics-autocommit';
      }, 'analytics')).resolves.toBe('analytics-autocommit');
    }, 'main');
    expect(fixture.transactionClient.savepoint).not.toHaveBeenCalled();
    expect(fixture.pool.begin).toHaveBeenCalledTimes(1);
  });

  it('replaces only the requested named transaction entry and preserves the other active connection', async () => {
    const main = postgresFixture();
    const analytics = postgresFixture();
    const rawClient = vi.spyOn(Connection, 'rawClient').mockResolvedValueOnce(main.pool);
    await Connection.transaction(async () => {
      rawClient.mockResolvedValueOnce(analytics.pool);
      await Connection.transaction(async () => {
        await Connection.withSavepointIfNeeded(async () => {
          expect(await Connection.rawClient('main')).toBe(main.transactionClient);
          expect(await Connection.rawClient('analytics')).toBe(analytics.savepointClient);
          await Connection.withSavepointIfNeeded(async () => {
            expect(await Connection.rawClient('main')).toBe(main.savepointClient);
            expect(await Connection.rawClient('analytics')).toBe(analytics.savepointClient);
          });
          expect(await Connection.rawClient('main')).toBe(main.transactionClient);
        }, 'analytics');
        expect(await Connection.rawClient('main')).toBe(main.transactionClient);
        expect(await Connection.rawClient('analytics')).toBe(analytics.transactionClient);
      }, 'analytics');
      await Connection.withSavepointIfNeeded(async () => 'no-analytics-transaction', 'analytics');
      expect(await Connection.rawClient()).toBe(main.transactionClient);
    });
    expect(main.transactionClient.savepoint).toHaveBeenCalledTimes(1);
    expect(analytics.transactionClient.savepoint).toHaveBeenCalledTimes(1);
  });

  it('calls directly inside a SQLite transaction without opening a savepoint or another connection', async () => {
    const client = { exec: vi.fn() };
    const rawClient = vi.spyOn(Connection, 'rawClient').mockResolvedValueOnce(client);
    await expect(Connection.transaction(async () => Connection.withSavepointIfNeeded(async () => {
      expect(rawClient).toHaveBeenCalledTimes(1);
      expect(client.exec).toHaveBeenCalledExactlyOnceWith('BEGIN');
      return 42;
    }, 'sqlite'), 'sqlite')).resolves.toBe(42);
    expect(client.exec.mock.calls).toEqual([['BEGIN'], ['COMMIT']]);
    expect(rawClient).toHaveBeenCalledTimes(1);
  });

  it('calls directly inside a MySQL transaction and leaves transaction cleanup to its existing owner', async () => {
    const client = {
      beginTransaction: vi.fn(async () => {}), commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}), release: vi.fn(), savepoint: vi.fn(),
    };
    const pool = { getConnection: vi.fn(async () => client) };
    const rawClient = vi.spyOn(Connection, 'rawClient').mockResolvedValueOnce(pool);
    await expect(Connection.transaction(async () => Connection.withSavepointIfNeeded(async () => {
      expect(rawClient).toHaveBeenCalledTimes(1);
      expect(await Connection.rawClient('mysql')).toBe(client);
      expect(client.commit).not.toHaveBeenCalled();
      expect(client.release).not.toHaveBeenCalled();
      return 42;
    }, 'mysql'), 'mysql')).resolves.toBe(42);
    expect(pool.getConnection).toHaveBeenCalledTimes(1);
    expect(client.savepoint).not.toHaveBeenCalled();
    expect(client.commit).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.rollback).not.toHaveBeenCalled();
  });
});
