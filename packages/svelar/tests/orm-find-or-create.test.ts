import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { HasUlids, HasUuids, Model, TenantModel } from '../src/orm/index.js';
import type { ModelHooks } from '../src/orm/Model.js';
import type { ModelObserver } from '../src/orm/Observer.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { ApplicationContext } from '../src/support/Context.js';
import { isUlid, isUuidv7 } from '../src/support/uuid.js';
import { Audit, auditable } from '../src/audit/index.js';
import { Search, Searchable } from '../src/search/index.js';

class FindRecord extends Model {
  static table = 'find_records';
  static fillable = ['id', 'code', 'name', 'tag', 'metadata', 'parent_id'];
  static casts = { metadata: 'json', admin: 'boolean' } as const;
}
class SoftFindRecord extends FindRecord { static softDeletes = true; }
class NoTimestampFindRecord extends FindRecord { static timestamps = false; }
class TenantFindRecord extends TenantModel {
  static table = 'tenant_find_records';
  static timestamps = false;
  static fillable = ['code', 'name'];
}
class UuidFindRecord extends HasUuids(Model) {
  static table = 'uuid_find_records';
  static timestamps = false;
  static fillable = ['code', 'name'];
}
class UlidFindRecord extends HasUlids(Model) {
  static table = 'ulid_find_records';
  static timestamps = false;
  static fillable = ['code', 'name'];
}
class CustomFindRecord extends Model {
  static table = 'custom_find_records';
  static primaryKey = 'slug';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['slug', 'code', 'name'];
}

const models = [FindRecord, SoftFindRecord, NoTimestampFindRecord, TenantFindRecord, UuidFindRecord, UlidFindRecord, CustomFindRecord];
const events = ['creating', 'saving', 'created', 'saved', 'updating', 'updated'] as const;
function observe(model: typeof Model) {
  const order: string[] = [];
  const hooks: ModelHooks = {};
  const observer: ModelObserver = {};
  for (const event of events) {
    hooks[event] = vi.fn(() => { order.push(`hook:${event}`); });
    observer[event] = vi.fn(() => { order.push(`observer:${event}`); });
  }
  model.boot(hooks);
  model.observe(observer);
  return { order, hooks, observer };
}
function lifecycle(...names: string[]): string[] {
  return names.flatMap((name) => [`hook:${name}`, `observer:${name}`]);
}

describe.sequential('ORM find-or-create model lifecycle', () => {
  let root: string;
  beforeEach(async () => {
    ApplicationContext.clear();
    for (const model of models) { model.removeObservers(); model.boot({}); }
    root = await mkdtemp(join(tmpdir(), 'svelar-find-or-create-'));
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: join(root, 'database.sqlite') } } });
    const schema = new Schema();
    await schema.createTable('find_parents', (table) => { table.increments('id'); });
    await schema.createTable('find_records', (table) => {
      table.increments('id');
      table.string('code').unique();
      table.string('name').default('Default');
      table.string('tag').nullable().unique();
      table.json('metadata').nullable();
      table.boolean('admin').default(false);
      table.integer('parent_id').nullable().references('id', 'find_parents');
      table.string('created_at').nullable();
      table.string('updated_at').nullable();
      table.string('deleted_at').nullable();
    });
    await schema.createTable('tenant_find_records', (table) => {
      table.increments('id'); table.string('team_id'); table.string('code'); table.string('name');
      table.uniqueIndex(['team_id', 'code']);
    });
    for (const [name, type] of [['uuid_find_records', 'uuid'], ['ulid_find_records', 'ulid'], ['custom_find_records', 'custom']] as const) {
      await schema.createTable(name, (table) => {
        if (type === 'uuid') table.uuid('id').primary();
        else if (type === 'ulid') table.ulid('id').primary();
        else table.string('slug').primary();
        table.string('code').unique(); table.string('name');
      });
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks(); vi.useRealTimers(); ApplicationContext.clear();
    for (const model of models) { model.removeObservers(); model.boot({}); }
    Audit.configure({ driver: 'memory', enabled: true });
    Search.configure({ host: 'http://meilisearch.test', syncDriver: 'inline' });
    (Search as any).client = null;
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });

  it('firstOrCreate runs creating/saving/created/saved hooks and observers exactly once', async () => {
    const watched = observe(FindRecord);
    const record = await FindRecord.query().firstOrCreate({ code: 'created' }, { name: 'Created' });
    expect(record).toBeInstanceOf(FindRecord);
    expect(watched.order).toEqual(lifecycle('creating', 'saving', 'created', 'saved'));
    expect(record.getAttribute('id')).toBe(1);
    expect(record.getOriginal('name')).toBe('Created');
    expect(record.isClean()).toBe(true);
    expect(await FindRecord.count()).toBe(1);
  });

  it('firstOrCreate existing branch never mutates data, timestamps or lifecycle state', async () => {
    const original = await FindRecord.create({ code: 'existing', name: 'Original' });
    const before = (await FindRecord.find(original.getAttribute('id')))!.getAttributes();
    const watched = observe(FindRecord);
    const found = await FindRecord.query().firstOrCreate({ code: 'existing' }, { name: 'Ignored' });
    expect(found.getAttributes()).toEqual(before);
    expect(found.getChanges()).toEqual({});
    expect(watched.order).toEqual([]);
    expect((await FindRecord.find(1))!.getAttributes()).toEqual(before);
  });

  it('updateOrCreate missing branch creates once without a redundant update/save', async () => {
    const watched = observe(FindRecord);
    await FindRecord.query().updateOrCreate({ code: 'upsert-new' }, { name: 'New' });
    expect(watched.order).toEqual(lifecycle('creating', 'saving', 'created', 'saved'));
    expect(await FindRecord.count()).toBe(1);
  });

  it('updateOrCreate existing branch uses fillable guards, JSON casts and timestamped update hooks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const original = await FindRecord.query().firstOrCreate({ code: 'casted' }, { name: 'Before', metadata: { state: 'draft' }, admin: true });
    const createdAt = original.getAttribute('created_at');
    expect((await new QueryBuilder('find_records').first())!.admin).toBe(0);
    const watched = observe(FindRecord);
    vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));
    const updated = await FindRecord.query().updateOrCreate({ code: 'casted' }, { name: 'After', metadata: { state: 'published' }, admin: true });
    expect(watched.order).toEqual(lifecycle('updating', 'saving', 'updated', 'saved'));
    expect(updated.getAttribute('metadata')).toEqual({ state: 'published' });
    expect(updated.getAttribute('admin')).toBe(false);
    expect(updated.getAttribute('created_at')).toBe(createdAt);
    expect(updated.getAttribute('updated_at')).toBe('2026-01-01T00:00:01.000Z');
    expect(updated.getChanges()).toMatchObject({ name: 'After', metadata: '{"state":"published"}' });
    expect(updated.isClean()).toBe(true);
    const same = await FindRecord.query().firstOrCreate({ metadata: { state: 'published' } }, { code: 'not-created' });
    expect(same.getAttribute('id')).toBe(updated.getAttribute('id'));
    expect((await new QueryBuilder('find_records').first())!.metadata).toBe('{"state":"published"}');
  });

  it('preserves input objects, original filters and selected/raw projections while hydrating complete models', async () => {
    await FindRecord.create({ code: 'filtered', name: 'Visible', tag: 'scope' });
    const query = FindRecord.query().where('tag', 'scope').select('code').selectRaw('? AS marker', ['projection']).orderBy('id');
    const sql = query.toSQL();
    const search = Object.freeze({ code: 'filtered' });
    const defaults = Object.freeze({ name: 'Unused' });
    const found = await query.firstOrCreate(search, defaults);
    expect(found.getAttribute('id')).toBe(1);
    expect(found.getAttribute('name')).toBe('Visible');
    expect(query.toSQL()).toEqual(sql);
    const updated = await query.updateOrCreate(search, Object.freeze({ name: 'Updated' }));
    expect(updated.getAttribute('id')).toBe(1);
    expect(query.toSQL()).toEqual(sql);
    expect(search).toEqual({ code: 'filtered' });
    expect(defaults).toEqual({ name: 'Unused' });
    expect((await query.clone().first())!.getAttributes()).toEqual({ code: 'filtered', marker: 'projection' });
  });

  it('uses IS NULL search matching and lets create defaults override search without changing either input', async () => {
    const search = Object.freeze({ tag: null });
    const created = await FindRecord.query().firstOrCreate(search, { code: 'null-tag', name: 'Null tag' });
    const found = await FindRecord.query().firstOrCreate(search, { code: 'unused' });
    expect(found.getAttribute('id')).toBe(created.getAttribute('id'));
    const create = Object.freeze({ code: 'override', name: 'Override', tag: 'override-tag' });
    const overridden = await FindRecord.query().firstOrCreate(Object.freeze({ code: 'searched' }), create);
    expect(overridden.getAttribute('code')).toBe('override');
    expect(search).toEqual({ tag: null });
    expect(create.code).toBe('override');
    expect(await FindRecord.count()).toBe(2);
  });

  it('generates UUID v7/ULID IDs and respects a custom non-incrementing primary key', async () => {
    const uuid = await UuidFindRecord.query().firstOrCreate({ code: 'uuid' }, { name: 'UUID' });
    const ulid = await UlidFindRecord.query().updateOrCreate({ code: 'ulid' }, { name: 'ULID' });
    const custom = await CustomFindRecord.query().firstOrCreate({ code: 'custom' }, { slug: 'custom-key', name: 'Custom' });
    expect(isUuidv7(uuid.getAttribute('id'))).toBe(true);
    expect(isUlid(ulid.getAttribute('id'))).toBe(true);
    expect(custom.getAttribute('slug')).toBe('custom-key');
    expect((await CustomFindRecord.find('custom-key'))!.getAttribute('name')).toBe('Custom');
  });

  it('updates the original primary key when a fillable primary key changes', async () => {
    const created = await FindRecord.create({ code: 'move-id', name: 'Before' });
    const updated = await FindRecord.query().updateOrCreate({ code: 'move-id' }, { id: 77, name: 'After' });
    expect(await FindRecord.find(created.getAttribute('id'))).toBeNull();
    expect(updated.getOriginal('id')).toBe(77);
    expect((await FindRecord.find(77))!.getAttribute('name')).toBe('After');
    expect(await FindRecord.count()).toBe(1);
  });

  it('recovers a forced two-creator unique race with one durable row and one created/saved lifecycle', async () => {
    const watched = observe(FindRecord);
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    FindRecord.observe({ async saving() { if (++arrivals === 2) release(); await gate; } });
    const [first, second] = await Promise.all([
      FindRecord.query().firstOrCreate({ code: 'race' }, { name: 'Race' }),
      FindRecord.query().firstOrCreate({ code: 'race' }, { name: 'Race' }),
    ]);
    expect(arrivals).toBe(2);
    expect(first.getAttribute('id')).toBe(second.getAttribute('id'));
    expect(await FindRecord.count()).toBe(1);
    expect(watched.observer.creating).toHaveBeenCalledTimes(2);
    expect(watched.observer.created).toHaveBeenCalledTimes(1);
    expect(watched.observer.saved).toHaveBeenCalledTimes(1);
    expect(watched.observer.updated).not.toHaveBeenCalled();
  });

  it('returns each distinct concurrent SQLite INSERT ID for its own durable row', async () => {
    const rows = await Promise.all(Array.from({ length: 6 }, (_, index) => FindRecord.query().firstOrCreate({ code: `parallel-${index}` }, { name: `Name ${index}` })));
    const ids = rows.map((row) => row.getAttribute('id'));
    expect(new Set(ids).size).toBe(6);
    for (let index = 0; index < rows.length; index++) {
      const stored = await FindRecord.find(ids[index]);
      expect(stored!.getAttribute('code')).toBe(`parallel-${index}`);
      expect(stored!.getAttribute('name')).toBe(`Name ${index}`);
    }
    expect(await FindRecord.count()).toBe(6);
  });

  it('preserves explicit unscoped tenant updates and requires an explicit tenant on unscoped creation', async () => {
    const record = await ApplicationContext.run({ teamId: 'team-a' }, () => TenantFindRecord.create({ code: 'tenant', name: 'Before' }));
    ApplicationContext.clear();
    await expect(TenantFindRecord.query().firstOrCreate({ code: 'missing' }, { name: 'Missing' })).rejects.toThrow('Tenant context is required');
    const updated = await TenantFindRecord.withoutTenantScope().updateOrCreate({ code: 'tenant' }, { name: 'After' });
    expect(updated.getAttribute('id')).toBe(record.getAttribute('id'));
    expect(updated.getAttribute('name')).toBe('After');
    await expect(TenantFindRecord.withoutTenantScope().firstOrCreate({ code: 'new' }, { name: 'New' })).rejects.toThrow('explicit tenant');
    const explicit = await TenantFindRecord.withoutTenantScope().firstOrCreate({ code: 'new', team_id: 'team-b' }, { name: 'Explicit' });
    expect(explicit.getAttribute('team_id')).toBe('team-b');
    expect(await TenantFindRecord.withoutTenantScope().count()).toBe(2);
  });

  it('updates a withTrashed model through the caller scope without restoring it', async () => {
    const original = await SoftFindRecord.create({ code: 'trashed', name: 'Before' });
    await original.delete();
    const deletedAt = original.getAttribute('deleted_at');
    const watched = observe(SoftFindRecord);
    const updated = await SoftFindRecord.withTrashed().updateOrCreate({ code: 'trashed' }, { name: 'After' });
    expect(updated.getAttribute('id')).toBe(original.getAttribute('id'));
    expect(updated.getAttribute('deleted_at')).toBe(deletedAt);
    expect(watched.order).toEqual(lifecycle('updating', 'saving', 'updated', 'saved'));
    expect(await SoftFindRecord.count()).toBe(0);
    expect(await SoftFindRecord.withTrashed().count()).toBe(1);
  });

  it('propagates unrelated unique/FK and observer-coded 23505 failures without duplicate writes', async () => {
    await FindRecord.create({ code: 'occupied', name: 'Existing', tag: 'unique-tag' });
    const watched = observe(FindRecord);
    await expect(FindRecord.query().firstOrCreate({ code: 'different' }, { tag: 'unique-tag' })).rejects.toThrow();
    await expect(FindRecord.query().firstOrCreate({ code: 'bad-fk' }, { parent_id: 9999 })).rejects.toThrow();
    expect(await FindRecord.count()).toBe(1);
    expect(watched.observer.created).not.toHaveBeenCalled();
    expect(watched.observer.saved).not.toHaveBeenCalled();
    for (const phase of ['creating', 'created'] as const) {
      FindRecord.removeObservers();
      const error = Object.assign(new Error(`${phase} observer failure`), { code: '23505' });
      const saved = vi.fn();
      FindRecord.observe({ [phase]: () => { throw error; }, saved });
      await expect(FindRecord.query().firstOrCreate({ code: `observer-${phase}` }, { name: 'Observer' })).rejects.toBe(error);
      expect(saved).not.toHaveBeenCalled();
      expect(await FindRecord.where('code', `observer-${phase}`).count()).toBe(phase === 'created' ? 1 : 0);
    }
    expect(await FindRecord.count()).toBe(2);
  });

  it.each([true, false])('rejects a scoped record removed by its updating observer, with dirty=%s and no post-write events', async (dirty) => {
    const record = await NoTimestampFindRecord.create({ code: 'removed', name: 'Before' });
    const watched = observe(NoTimestampFindRecord);
    let attempted: Model | undefined;
    NoTimestampFindRecord.observe({ async updating(model) {
      attempted = model;
      await new QueryBuilder('find_records').where('id', model.getOriginal('id')).delete();
    } });
    await expect(NoTimestampFindRecord.query().updateOrCreate({ code: 'removed' }, { name: dirty ? 'After' : 'Before' })).rejects.toThrow('no longer available in the query scope');
    expect(watched.order).toEqual(lifecycle('updating', 'saving'));
    expect(watched.observer.updated).not.toHaveBeenCalled();
    expect(watched.observer.saved).not.toHaveBeenCalled();
    expect(attempted!.getChanges()).toEqual({});
    expect(attempted!.getOriginal('name')).toBe('Before');
    expect(await NoTimestampFindRecord.find(record.getAttribute('id'))).toBeNull();
  });

  it('audits helper creation and updates with real model diffs and actor context', async () => {
    Audit.configure({ driver: 'memory', enabled: true });
    auditable(FindRecord);
    await ApplicationContext.run({ actorId: 52, teamId: 'audit-team' }, async () => {
      const model = await FindRecord.query().firstOrCreate({ code: 'audited' }, { name: 'Before' });
      await FindRecord.query().updateOrCreate({ code: 'audited' }, { name: 'After' });
      const entries = await Audit.forModel('FindRecord', model.getAttribute('id'));
      expect(entries).toHaveLength(2);
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'created', newValues: expect.objectContaining({ name: 'Before' }) }),
        expect.objectContaining({ action: 'updated', oldValues: expect.objectContaining({ name: 'Before' }), newValues: expect.objectContaining({ name: 'After' }) }),
      ]));
      expect(entries.every((entry) => entry.metadata?.teamId === 'audit-team')).toBe(true);
    });
  });

  it('forwards persistence context through Searchable create/save and indexes only writes', async () => {
    class SearchableTenantFindRecord extends Searchable(TenantFindRecord) {}
    const addDocuments = vi.fn(async (documents: Record<string, any>[]) => ({ taskUid: documents.length }));
    Search.configure({ host: 'http://meilisearch.test', syncDriver: 'inline' });
    (Search as any).client = { index: () => ({ addDocuments }) };
    const created = await SearchableTenantFindRecord.withoutTenantScope().firstOrCreate(
      { code: 'indexed', team_id: 'search-team' }, { name: 'Before' },
    );
    expect(created.getAttribute('team_id')).toBe('search-team');
    await SearchableTenantFindRecord.withoutTenantScope().firstOrCreate({ code: 'indexed' }, { name: 'Ignored' });
    expect(addDocuments).toHaveBeenCalledTimes(1);
    const updated = await SearchableTenantFindRecord.withoutTenantScope().updateOrCreate({ code: 'indexed' }, { name: 'After' });
    expect(updated.getAttribute('team_id')).toBe('search-team');
    expect((await TenantFindRecord.withoutTenantScope().first())!.getAttribute('name')).toBe('After');
    expect(addDocuments).toHaveBeenCalledTimes(2);
    expect(addDocuments.mock.calls[1][0]).toEqual([expect.objectContaining({ name: 'After', team_id: 'search-team' })]);
  });

  it('rejects grouped or aliased helper write contexts before inserting', async () => {
    for (const query of [FindRecord.query().groupBy('name'), FindRecord.query().from('find_records as f')]) {
      await expect(query.firstOrCreate({ code: 'invalid' }, { name: 'Invalid' })).rejects.toThrow('single, unaliased');
    }
    expect(await FindRecord.count()).toBe(0);
  });

  it('keeps raw-table helpers eventless and supports supplied string id values', async () => {
    const watched = observe(UuidFindRecord);
    const query = new QueryBuilder('uuid_find_records');
    const original = query.toSQL();
    const id = '018f65d4-98fb-7a12-a12b-7c1190de8f37';
    const row = await query.firstOrCreate({ code: 'raw' }, { id, name: 'Before' });
    expect(row.id).toBe(id);
    expect(row).not.toBeInstanceOf(Model);
    expect((await query.updateOrCreate({ code: 'raw' }, { name: 'After' })).name).toBe('After');
    expect(watched.order).toEqual([]);
    expect(query.toSQL()).toEqual(original);
  });

  it('rejects raw create/update on custom-key-only tables without changing records', async () => {
    const query = new QueryBuilder('custom_find_records');
    await expect(query.firstOrCreate({ code: 'raw-custom' }, { slug: 'key', name: 'Before' })).rejects.toThrow();
    expect(await CustomFindRecord.count()).toBe(0);
    await CustomFindRecord.create({ slug: 'key', code: 'custom', name: 'Before' });
    await expect(query.updateOrCreate({ code: 'custom' }, { name: 'After' })).rejects.toThrow('id column');
    expect((await CustomFindRecord.find('key'))!.getAttribute('name')).toBe('Before');
  });
});
