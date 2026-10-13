import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection, AfterCommitError } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { ApplicationContext } from '../src/support/Context.js';

const records = () => new QueryBuilder('commit_records');
beforeEach(async () => {
  Connection.configure({ default: 'default', connections: { default: { driver: 'sqlite', filename: ':memory:' } } });
  await new Schema().createTable('commit_records', (table) => { table.increments('id'); table.string('value'); });
});
afterEach(async () => { await Connection.disconnect(); vi.restoreAllMocks(); });

describe('Transaction settlement and async isolation', () => {
  it('runs callbacks after the outer commit and preserves their origin context', async () => {
    const seen: unknown[] = [];
    await Connection.transaction(async () => {
      await records().insert({ value: 'Committed' });
      await ApplicationContext.run({ teamId: 'one', actorId: 'worker' }, async () => {
        await Connection.afterCommit(async () => {
          expect(Connection.inTransaction()).toBe(false);
          seen.push(ApplicationContext.snapshot());
          expect(await records().count()).toBe(2);
        });
      });
      await Connection.transaction(async () => {
        await records().insert({ value: 'Nested' });
        await Connection.afterCommit(() => { seen.push('nested committed'); });
      });
      expect(seen).toEqual([]);
      expect(Connection.inTransaction()).toBe(true);
    });
    expect(seen).toEqual([{ teamId: 'one', actorId: 'worker' }, 'nested committed']);
  });

  it('discards nested rollback callbacks but keeps the outer transaction usable', async () => {
    const callback = vi.fn();
    await Connection.transaction(async () => {
      await records().insert({ value: 'Kept' });
      await expect(Connection.transaction(async () => {
        await records().insert({ value: 'Rolled back' });
        await Connection.afterCommit(callback);
        throw new Error('rollback');
      })).rejects.toThrow('rollback');
      await records().insert({ value: 'Still usable' });
    });
    expect(callback).not.toHaveBeenCalled();
    expect(await records().pluck('value')).toEqual(['Kept', 'Still usable']);
  });

  it('discards every callback on outer rollback', async () => {
    const callback = vi.fn();
    await expect(Connection.transaction(async () => {
      await Connection.transaction(async () => { await Connection.afterCommit(callback); });
      await records().insert({ value: 'Never committed' });
      throw new Error('outer rollback');
    })).rejects.toThrow('outer rollback');
    expect(callback).not.toHaveBeenCalled();
    expect(await records().count()).toBe(0);
  });

  it('serializes independent SQLite transactions without leaking writes into a rollback', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let resume!: () => void;
    const release = new Promise<void>((resolve) => { resume = resolve; });
    const first = Connection.transaction(async () => {
      await records().insert({ value: 'Discarded' });
      started();
      await release;
      throw new Error('rollback first');
    });
    const rejected = expect(first).rejects.toThrow('rollback first');
    await ready;
    const second = Connection.transaction(async () => { await records().insert({ value: 'Independent' }); });
    const read = records().pluck('value');
    resume();
    await rejected;
    await second;
    expect(await read).not.toContain('Discarded');
    expect(await records().pluck('value')).toEqual(['Independent']);
  });

  it('explicitly marks callback failures as already committed and runs remaining callbacks', async () => {
    const last = vi.fn();
    let error: unknown;
    try {
      await Connection.transaction(async () => {
        await records().insert({ value: 'Do not repeat' });
        await Connection.afterCommit(() => { throw new Error('downstream unavailable'); });
        await Connection.afterCommit(last);
      });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(AfterCommitError);
    expect(error).toMatchObject({ committed: true });
    expect(last).toHaveBeenCalledOnce();
    expect(await records().count()).toBe(1);
  });

  it('fails closed rather than interleaving parent writes and concurrent savepoints', async () => {
    await Connection.transaction(async () => {
      let resume!: () => void;
      const ready = new Promise<void>((resolve) => { resume = resolve; });
      const nested = Connection.transaction(async () => {
        await records().insert({ value: 'Nested' });
        await ready;
      });
      await expect(Connection.transaction(async () => {})).rejects.toThrow('Concurrent nested transactions');
      await expect(records().insert({ value: 'Leaked parent write' })).rejects.toThrow('Await the nested transaction');
      resume(); await nested;
      await records().insert({ value: 'Parent after nested' });
    });
    expect(await records().pluck('value')).toEqual(['Nested', 'Parent after nested']);
  });

  it('executes outside transactions immediately and rejects detached post-transaction work', async () => {
    const callback = vi.fn();
    await Connection.afterCommit(callback);
    expect(callback).toHaveBeenCalledOnce();
    let detached!: () => Promise<unknown>;
    await Connection.transaction(async () => {
      detached = await ApplicationContext.run({}, async () => {
        const { AsyncResource } = await import('node:async_hooks');
        return AsyncResource.bind(() => records().count());
      });
    });
    await expect(detached()).rejects.toThrow('transaction has already ended');
  });
});
