import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Migration } from '../src/database/Migration.js';
import { Hash } from '../src/hashing/Hash.js';
import { Model } from '../src/orm/Model.js';
import { Factory } from '../src/testing/Factory.js';

class FactoryRecord extends Model {
  static table = 'async_factory_records';
  static timestamps = false;
  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare role: string;
}

class CreateFactoryRecords extends Migration {
  async up() {
    await this.schema.createTable(FactoryRecord.table, (table) => {
      table.increments('id'); table.string('name'); table.string('email').unique(); table.string('password'); table.string('role');
    });
  }
}

class SyncFactory extends Factory<FactoryRecord> {
  model() { return FactoryRecord; }
  definition() {
    const sequence = this.sequence;
    return { name: `Sync ${sequence}`, email: `sync${sequence}@example.test`, password: 'not-used-for-login', role: 'user' };
  }
}

class AsyncFactory extends Factory<FactoryRecord> {
  completions: number[] = [];
  model() { return FactoryRecord; }
  async definition() {
    const sequence = this.sequence;
    await Promise.resolve();
    const password = await Hash.make('test-only-password');
    this.completions.push(sequence);
    return { name: `Async ${sequence}`, email: `async${sequence}@example.test`, password, role: 'user' };
  }
}

beforeEach(async () => {
  await Connection.disconnect();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
  await new CreateFactoryRecords().up();
  Factory.resetSequence();
});
afterEach(async () => { await Connection.disconnect(); });

describe('Asynchronous factory definitions', () => {
  it('awaits hashes before persisting and preserves explicit overrides', async () => {
    const factory = new AsyncFactory();
    const record = await factory.create({ role: 'editor' });
    expect(record.id).toBe(1);
    expect(record.name).toBe('Async 1');
    expect(record.role).toBe('editor');
    expect(await Hash.verify('test-only-password', record.password)).toBe(true);
    expect((await FactoryRecord.find(1))?.getAttribute('password')).toBe(record.password);
    expect(factory.completions).toEqual([1]);
  });

  it('keeps synchronous make/makeMany synchronous and non-persistent', async () => {
    const factory = new SyncFactory();
    const record = factory.make({ name: 'Explicit' });
    expect(record).toBeInstanceOf(FactoryRecord);
    expect(record).not.toBeInstanceOf(Promise);
    expect(record.name).toBe('Explicit');
    expect(factory.makeMany(2).map((value) => value.name)).toEqual(['Sync 2', 'Sync 3']);
    expect(await FactoryRecord.count()).toBe(0);
  });

  it('rejects asynchronous definitions in make/makeMany instead of constructing empty models', async () => {
    let resolve: (value: Record<string, unknown>) => void = () => {};
    const pending = new Promise<Record<string, unknown>>((accept) => { resolve = accept; });
    class PendingFactory extends Factory<FactoryRecord> {
      model() { return FactoryRecord; }
      definition() { return pending; }
    }
    const factory = new PendingFactory();
    expect(() => factory.make()).toThrow('makeAsync() or makeManyAsync()');
    expect(() => factory.makeMany(2)).toThrow('requires a synchronous definition');
    resolve({ name: 'Ignored async result' });
    await pending;
    expect(await FactoryRecord.count()).toBe(0);
  });

  it('makes asynchronous instances without writing to SQLite', async () => {
    const factory = new AsyncFactory();
    const record = await factory.makeAsync({ name: 'Unpersisted', role: 'admin' });
    expect(record.name).toBe('Unpersisted');
    expect(record.role).toBe('admin');
    expect(record.id).toBeUndefined();
    expect(await Hash.verify('test-only-password', record.password)).toBe(true);
    expect(await FactoryRecord.count()).toBe(0);
  });

  it('awaits many definitions sequentially while preserving factory state and sequence order', async () => {
    const factory = new AsyncFactory();
    const made = await factory.makeManyAsync(3, { role: 'member' });
    expect(made.map((record) => record.name)).toEqual(['Async 1', 'Async 2', 'Async 3']);
    expect(factory.completions).toEqual([1, 2, 3]);
    expect(made.every((record) => record.role === 'member')).toBe(true);
    expect(await FactoryRecord.count()).toBe(0);
    const created = await factory.createMany(2);
    expect(created.map((record) => record.id)).toEqual([1, 2]);
    expect(created.map((record) => record.name)).toEqual(['Async 4', 'Async 5']);
    expect(factory.completions).toEqual([1, 2, 3, 4, 5]);
  });

  it('accepts synchronous definitions in the async make APIs and honors sequence reset', async () => {
    const factory = new SyncFactory();
    expect((await factory.makeAsync()).name).toBe('Sync 1');
    Factory.resetSequence();
    expect((await factory.makeManyAsync(2)).map((record) => record.name)).toEqual(['Sync 1', 'Sync 2']);
  });

  it('propagates rejected definitions without database writes or unhandled synchronous-call rejections', async () => {
    class BrokenFactory extends Factory<FactoryRecord> {
      model() { return FactoryRecord; }
      async definition(): Promise<Record<string, unknown>> { throw new Error('definition failed'); }
    }
    const factory = new BrokenFactory();
    await expect(factory.create()).rejects.toThrow('definition failed');
    await expect(factory.makeAsync()).rejects.toThrow('definition failed');
    await expect(factory.makeManyAsync(2)).rejects.toThrow('definition failed');
    expect(() => factory.make()).toThrow('requires a synchronous definition');
    await Promise.resolve();
    expect(await FactoryRecord.count()).toBe(0);
  });
});
