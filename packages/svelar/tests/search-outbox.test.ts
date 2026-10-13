import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { CreateSearchOutboxTable } from '../src/database/CoreMigrations.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Model } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Queue } from '../src/queue/index.js';
import { Search, Searchable, SearchOutbox } from '../src/search/index.js';
import { ApplicationContext } from '../src/support/Context.js';

class Article extends Searchable(Model) {
  static table = 'outbox_articles';
  static fillable = ['title', 'private_value'];
  static hidden = ['private_value'];
  static softDeletes = true;
}
const outboxRows = () => new QueryBuilder('svelar_search_outbox');
let add: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  Connection.configure({ default: 'default', connections: { default: { driver: 'sqlite', filename: ':memory:' } } });
  await new CreateSearchOutboxTable().up();
  await new Schema().createTable('outbox_articles', (table) => {
    table.increments('id'); table.string('title'); table.string('private_value').nullable(); table.timestamps(); table.softDeletes();
  });
  Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
  Search.configure({ host: 'http://search.test' });
  add = vi.fn(async () => undefined);
  remove = vi.fn(async () => undefined);
  vi.spyOn(Search, 'getClient').mockReturnValue({ index: () => ({ addDocuments: add, deleteDocument: remove }) });
});
afterEach(async () => { vi.restoreAllMocks(); await Connection.disconnect(); ApplicationContext.clear(); });

describe('Durable transactional search synchronization', () => {
  it('commits data and intent without contacting Meilisearch; excludes hidden model fields', async () => {
    add.mockRejectedValue(new Error('Search unavailable'));
    const article = await ApplicationContext.run({ teamId: 'tenant-1', actorId: 'actor-1' }, () => Article.create({ title: 'Saved', private_value: 'hidden' }));
    expect(await Article.count()).toBe(1);
    expect(add).not.toHaveBeenCalled();
    const row = await outboxRows().first();
    expect(JSON.stringify(JSON.parse(row.operation))).not.toContain('hidden');
    expect(JSON.parse(row.context)).toMatchObject({ teamId: 'tenant-1', actorId: 'actor-1' });
    expect((await Search.processOutbox()).failed).toBe(1);
    expect(await Article.find(article!.getAttribute('id'))).not.toBeNull();
    expect(await Search.outbox().stats()).toMatchObject({ pending: 1, dead: 0 });
  });

  it('rolls back data, intent and queue publication together', async () => {
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    const dispatch = vi.spyOn(Queue, 'dispatch');
    await expect(Connection.transaction(async () => {
      await Article.create({ title: 'Rolled back' });
      expect(dispatch).not.toHaveBeenCalled();
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await Article.count()).toBe(0);
    expect(await outboxRows().count()).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('fails closed and rolls back the model write if durable intent cannot be stored', async () => {
    vi.spyOn(SearchOutbox.prototype, 'enqueue').mockRejectedValue(new Error('outbox unavailable'));
    await expect(Article.create({ title: 'Not committed' })).rejects.toThrow('outbox unavailable');
    expect(await Article.count()).toBe(0);
  });

  it('keeps committed intent when queue dispatch fails and lets the sweep recover it', async () => {
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Queue, 'dispatch').mockRejectedValue(new Error('Redis unavailable'));
    await expect(Article.create({ title: 'Committed without Redis' })).resolves.toBeInstanceOf(Article);
    expect(await Article.count()).toBe(1);
    expect((await Search.processOutbox()).completed).toBe(1);
    expect(add).toHaveBeenCalledOnce();
  });

  it('orders mutations per document, blocks later writes behind DLQ and supports replay', async () => {
    Search.configure({ host: 'http://search.test', outbox: { maxAttempts: 1 } });
    const article = await Article.create({ title: 'First' });
    article!.setAttribute('title', 'Second');
    await article!.save();
    add.mockRejectedValueOnce(new Error('password=hidden upstream failed'));
    expect(await Search.processOutbox()).toEqual({ completed: 0, failed: 1 });
    expect(add).toHaveBeenCalledOnce();
    const dead = await outboxRows().where('status', 'dead').first();
    expect(dead.error).not.toContain('hidden');
    expect(await Search.outbox().replay(dead.id)).toBe(true);
    expect(await Search.processOutbox()).toEqual({ completed: 2, failed: 0 });
    expect(add.mock.calls.map((call) => (call as any)[0][0].title)).toEqual(['First', 'First', 'Second']);
    expect((await Search.outbox().stats()).pending).toBe(0);
  });

  it('recovers expired claims and restores tenant/actor context during processing', async () => {
    await ApplicationContext.run({ teamId: 'origin', actorId: 'worker' }, () => Article.create({ title: 'Recover me' }));
    await outboxRows().update({ status: 'processing', owner: 'killed-worker', locked_until: new Date(Date.now() - 1000).toISOString() });
    add.mockImplementation(async () => { expect(ApplicationContext.get('teamId')).toBe('origin'); expect(ApplicationContext.get('actorId')).toBe('worker'); });
    expect((await Search.processOutbox()).completed).toBe(1);
    expect((await outboxRows().first()).owner).toBeNull();
  });

  it('does not inherit the sweep caller tenant for a captured system operation', async () => {
    await ApplicationContext.runIsolated({}, () => Article.create({ title: 'System-owned' }));
    add.mockImplementation(async () => { expect(ApplicationContext.get('teamId')).toBeUndefined(); expect(ApplicationContext.get('actorId')).toBeUndefined(); });
    await ApplicationContext.run({ teamId: 'unrelated', actorId: 'admin' }, async () => {
      expect((await Search.processOutbox()).completed).toBe(1);
    });
  });

  it('synchronizes soft-delete, restore and force-delete through durable operations', async () => {
    const article = await Article.create({ title: 'Lifecycle' });
    await article!.delete(); await article!.restore(); await article!.forceDelete();
    expect(await Search.processOutbox()).toEqual({ completed: 4, failed: 0 });
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('does not mark an asynchronously failed Meilisearch task completed', async () => {
    await Article.create({ title: 'Invalid indexing task' });
    const waitForTask = vi.fn(async () => ({ status: 'failed', error: { code: 'invalid_document_id' } }));
    vi.mocked(Search.getClient).mockReturnValue({ index: () => ({ addDocuments: async () => ({ taskUid: 7 }) }), waitForTask });
    expect((await Search.processOutbox()).failed).toBe(1);
    expect(waitForTask).toHaveBeenCalledWith(7, { timeOutMs: 30_000 });
    expect((await outboxRows().first()).status).toBe('pending');
  });

  it('does not claim the same operation concurrently and retains other document progress', async () => {
    await Article.create({ title: 'One' }); await Article.create({ title: 'Two' });
    const seen: number[] = [];
    const execute = async (operation: any) => { seen.push(operation.id); await new Promise((resolve) => setTimeout(resolve, 10)); };
    await Promise.all([Search.outbox().drain(execute), Search.outbox().drain(execute)]);
    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
  });

  it('renews a claim during processing longer than its initial lease', async () => {
    Search.configure({ host: 'http://search.test', outbox: { leaseSeconds: 1 } });
    await Article.create({ title: 'Long indexing task' });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let finish!: () => void;
    const complete = new Promise<void>((resolve) => { finish = resolve; });
    const drain = Search.outbox().drain(async () => { started(); await complete; });
    await ready;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const rival = await Search.outbox().drain(async () => { throw new Error('Claim stolen'); });
    finish();
    expect(await drain).toEqual({ completed: 1, failed: 0 });
    expect(rival).toEqual({ completed: 0, failed: 0 });
  });

  it('prunes only completed entries and leaves pending recovery intact', async () => {
    await Article.create({ title: 'Completed' });
    await Search.processOutbox();
    await Article.create({ title: 'Pending' });
    expect(await Search.outbox().prune(new Date(Date.now() + 1000))).toBe(1);
    expect((await Search.outbox().stats()).pending).toBe(1);
  });
});
