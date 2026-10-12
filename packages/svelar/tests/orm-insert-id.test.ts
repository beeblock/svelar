import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connection, type DatabaseDriver } from '../src/database/Connection.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

function configure(driver: DatabaseDriver): void {
  Connection.configure({ default: 'write', connections: { write: { driver, filename: ':memory:' } } });
}

afterEach(() => vi.restoreAllMocks());

describe('Insert identity', () => {
  it.each(['sqlite', 'mysql'] as const)('uses %s mutation metadata instead of a separate connection-local query', async (driver) => {
    configure(driver);
    const raw = vi.spyOn(Connection, 'raw').mockResolvedValue({ lastInsertRowid: 17, insertId: 17 });
    expect(await new QueryBuilder('records').insertGetId({ title: 'Own insert' })).toBe(17);
    expect(raw).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('INSERT INTO'), ['Own insert'], undefined);
  });

  it.each(['sqlite', 'mysql'] as const)('returns supplied custom primary keys on %s', async (driver) => {
    configure(driver);
    const id = '0199cb36-dc80-7abc-8abc-0123456789ab';
    const raw = vi.spyOn(Connection, 'raw').mockResolvedValue({ lastInsertRowid: 42, insertId: 0 });
    expect(await new QueryBuilder('records').insertGetId<string>({ record_key: id }, 'record_key')).toBe(id);
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('uses PostgreSQL RETURNING for the configured primary key', async () => {
    configure('postgres');
    const raw = vi.spyOn(Connection, 'raw').mockResolvedValue([{ record_key: 'returned-id' }]);
    expect(await new QueryBuilder('records', undefined, 'write').insertGetId<string>({ title: 'Returned' }, 'record_key')).toBe('returned-id');
    expect(raw).toHaveBeenCalledExactlyOnceWith('INSERT INTO "records" ("title") VALUES (?) RETURNING "record_key"', ['Returned'], 'write');
  });

  it.each(['sqlite', 'postgres', 'mysql'] as const)('supports default-only inserts on %s', async (driver) => {
    configure(driver);
    const raw = vi.spyOn(Connection, 'raw').mockResolvedValue(driver === 'postgres' ? [{ id: 9 }] : { lastInsertRowid: 9, insertId: 9 });
    expect(await new QueryBuilder('records').insertGetId({})).toBe(9);
    const sql = raw.mock.calls[0][0];
    expect(sql).toContain(driver === 'mysql' ? '() VALUES ()' : 'DEFAULT VALUES');
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('supports default-only inserts without identity retrieval', async () => {
    configure('sqlite');
    const raw = vi.spyOn(Connection, 'raw').mockResolvedValue({ changes: 1, lastInsertRowid: 9 });
    await new QueryBuilder('records').insert({});
    expect(raw).toHaveBeenCalledExactlyOnceWith('INSERT INTO "records" DEFAULT VALUES', [], undefined);
  });
});
