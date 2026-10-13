import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Connection, type DatabaseDriver } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Model, TenantModel } from '../src/orm/Model.js';
import { QueryBuilder, type GlobalScope, type GlobalScopeQuery } from '../src/orm/QueryBuilder.js';
import { Teams } from '../src/teams/index.js';

class ScopeRecord extends TenantModel {
  static table = 'global_scope_records';
  static timestamps = false;
  static softDeletes = true;
}
ScopeRecord.addGlobalScope('visible', (query) => query.where('visible', 1));
ScopeRecord.addGlobalScope('status', (query) => query.where('status', 'active').orWhere('status', 'pending'));

describe.sequential('Model global scopes', () => {
  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    await new Schema().createTable('global_scope_records', (table) => {
      table.increments('id'); table.string('team_id'); table.string('slug').unique();
      table.string('status').default('active'); table.integer('visible').default(1);
      table.integer('visits').default(0); table.string('title'); table.softDeletes();
    });
    await new QueryBuilder('global_scope_records').insertMany([
      { team_id: 'a', slug: 'active', status: 'active', visible: 1, title: 'Active', deleted_at: null },
      { team_id: 'a', slug: 'pending', status: 'pending', visible: 1, title: 'Pending', deleted_at: null },
      { team_id: 'a', slug: 'hidden', status: 'active', visible: 0, title: 'Hidden', deleted_at: null },
      { team_id: 'a', slug: 'archived', status: 'archived', visible: 1, title: 'Archived', deleted_at: null },
      { team_id: 'a', slug: 'deleted', status: 'active', visible: 1, title: 'Deleted', deleted_at: '2026-01-01' },
      { team_id: 'b', slug: 'foreign', status: 'pending', visible: 1, title: 'Foreign', deleted_at: null },
    ]);
    Teams.configure({ driver: 'memory' });
  });

  afterEach(async () => {
    ScopeRecord.boot({}); ScopeRecord.removeObservers();
    Teams.clearCurrentTeam(); vi.restoreAllMocks(); await Connection.disconnect();
  });

  it('inherits scopes without sharing a mutable registry between siblings', () => {
    class Child extends ScopeRecord {}
    class Sibling extends ScopeRecord {}
    Child.addGlobalScope('visible', (query) => query.where('visible', 0));
    Child.addGlobalScope('child', (query) => query.whereNotNull('title'));
    expect([...Child.globalScopes().keys()]).toEqual(['visible', 'status', 'child']);
    expect([...Sibling.globalScopes().keys()]).toEqual(['visible', 'status']);
    (Child.globalScopes() as Map<string, GlobalScope>).clear();
    expect(Child.globalScopes().size).toBe(3);
    expect(ScopeRecord.globalScopes().size).toBe(2);
  });

  it('keeps scopes around user OR predicates, including OR inside a scope', async () => {
    await Teams.runWithTeam('a', async () => {
      const query = ScopeRecord.where('slug', 'active').orWhere('status', 'pending');
      expect((await query.orderBy('id').get()).map((row) => row.getAttribute('slug'))).toEqual(['active', 'pending']);
      expect(await query.count()).toBe(2);
      expect(query.toSQL().sql).toContain('("global_scope_records"."status" = ? OR "global_scope_records"."status" = ?)');
    });
    await expect(ScopeRecord.all()).rejects.toThrow('Tenant context');
  });

  it('removes exactly one named scope and preserves tenant and soft-delete scopes', async () => {
    await Teams.runWithTeam('a', async () => {
      expect((await ScopeRecord.withoutGlobalScope('visible').orderBy('id').get()).map((row) => row.getAttribute('slug')))
        .toEqual(['active', 'pending', 'hidden']);
      expect((await ScopeRecord.query().withoutGlobalScope('status').get()).length).toBe(3);
      expect(await ScopeRecord.withTrashed().count()).toBe(3);
      expect(await ScopeRecord.withoutTenantScope().count()).toBe(3);
      expect(() => ScopeRecord.withoutGlobalScope('missing')).toThrow('Unknown global scope');
    });
  });

  it('clones independent exclusions and stable scope values', async () => {
    class ContextRecord extends Model { static table = ScopeRecord.table; }
    let visible = 1;
    ContextRecord.addGlobalScope('visible', (query) => query.where('visible', visible));
    const query = ContextRecord.query();
    const clone = query.clone();
    visible = 0;
    expect(clone.toSQL()).toEqual(query.toSQL());
    expect(clone.toSQL().bindings).toEqual([1]);
    clone.withoutGlobalScope('visible');
    expect(clone.toSQL().bindings).toEqual([]);
    expect(query.toSQL().bindings).toEqual([1]);
  });

  it('guards bulk updates, increments and deletes without crossing OR boundaries', async () => {
    await Teams.runWithTeam('a', async () => {
      const query = ScopeRecord.where('status', 'active').orWhere('status', 'pending');
      expect(await query.clone().update({ title: 'Updated' })).toBe(2);
      await query.clone().increment('visits');
      expect(await query.clone().delete()).toBe(2);
    });
    const rows = await new QueryBuilder(ScopeRecord.table).orderBy('id').get();
    expect(rows.map((row) => row.title)).toEqual(['Updated', 'Updated', 'Hidden', 'Archived', 'Deleted', 'Foreign']);
    expect(rows.map((row) => row.visits)).toEqual([1, 1, 0, 0, 0, 0]);
    expect(rows[5].deleted_at).toBeNull();
  });

  it('preserves full scoped model helpers, lifecycle and original builder projections', async () => {
    const saved = vi.fn(); ScopeRecord.observe({ saved });
    await Teams.runWithTeam('a', async () => {
      const query = ScopeRecord.where('slug', 'active').orWhere('slug', 'pending').selectRaw('? AS projected', ['literal']);
      const before = query.toSQL();
      const existing = await query.firstOrCreate({ slug: 'pending' });
      expect(existing).toBeInstanceOf(ScopeRecord);
      expect(existing.getAttribute('id')).toBeDefined();
      await query.updateOrCreate({ slug: 'pending' }, { title: 'Only pending' });
      expect(query.toSQL()).toEqual(before);
      const created = await ScopeRecord.query().firstOrCreate({ slug: 'new' }, { title: 'New', status: 'active', visible: 1 });
      expect(created.getAttribute('team_id')).toBe('a');
      expect(await ScopeRecord.where('slug', 'new').count()).toBe(1);
    });
    expect(saved).toHaveBeenCalledTimes(2);
    const titles = await new QueryBuilder(ScopeRecord.table).orderBy('id').pluck('title');
    expect(titles.slice(0, 3)).toEqual(['Active', 'Only pending', 'Hidden']);
  });

  it.each(['firstOrCreate', 'updateOrCreate'] as const)('does not recover an excluded unique winner through %s', async (helper) => {
    await Teams.runWithTeam('a', async () => {
      await expect(ScopeRecord.query()[helper]({ slug: 'hidden' }, { title: 'Attempt', status: 'active', visible: 1 }))
        .rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
    });
    expect(await new QueryBuilder(ScopeRecord.table).where('slug', 'hidden').value('title')).toBe('Hidden');
  });

  it('validates direct creates and new instance saves, without guessing defaults', async () => {
    await Teams.runWithTeam('a', async () => {
      await expect(ScopeRecord.create({ slug: 'missing', title: 'Missing', status: 'active' })).rejects.toThrow('explicit "visible"');
      await expect(ScopeRecord.create({ slug: 'bad', title: 'Bad', status: 'archived', visible: 1 })).rejects.toThrow('does not satisfy');
      const model = new ScopeRecord({ slug: 'saved', title: 'Saved', status: 'pending', visible: 1 });
      await model.save();
      expect(model.getAttribute('id')).toBeDefined();
      expect(await ScopeRecord.where('slug', 'saved').count()).toBe(1);
      expect(await ScopeRecord.withoutGlobalScope('visible').firstOrCreate({ slug: 'disabled' }, { title: 'Disabled', status: 'active', visible: 0 }))
        .toBeInstanceOf(ScopeRecord);
    });
    expect(await new QueryBuilder(ScopeRecord.table).whereIn('slug', ['missing', 'bad']).count()).toBe(0);
  });

  it('rejects a bulk insert before any row is written if any scope check fails', async () => {
    await Teams.runWithTeam('a', async () => {
      await expect(ScopeRecord.query().insertMany([
        { slug: 'bulk-good', title: 'Good', status: 'active', visible: 1 },
        { slug: 'bulk-bad', title: 'Bad', status: 'active', visible: 0 },
      ])).rejects.toThrow('does not satisfy');
    });
    expect(await new QueryBuilder(ScopeRecord.table).where('slug', 'LIKE', 'bulk-%').count()).toBe(0);
  });

  it('rejects scoped upsert rather than ignoring its row predicates', async () => {
    await Teams.runWithTeam('a', async () => {
      await expect(ScopeRecord.query().withTrashed().upsert({ slug: 'active', visible: 1, status: 'active', title: 'Bad' }, ['team_id', 'slug']))
        .rejects.toThrow('Upsert cannot apply row filters');
    });
  });

  it.each(['save', 'delete', 'forceDelete', 'restore'] as const)('fails closed for an excluded hydrated instance on %s', async (method) => {
    const after = vi.fn(); ScopeRecord.observe({ saved: after, deleted: after, restored: after, forceDeleted: after });
    await Teams.runWithTeam('a', async () => {
      const hidden = await ScopeRecord.withoutGlobalScope('visible').where('slug', 'hidden').firstOrFail();
      if (method === 'save') hidden.setAttribute('title', 'Attempt');
      await expect(hidden[method]()).rejects.toThrow('no longer available');
    });
    expect(after).not.toHaveBeenCalled();
    const row = await new QueryBuilder(ScopeRecord.table).where('slug', 'hidden').firstOrFail();
    expect(row.title).toBe('Hidden'); expect(row.deleted_at).toBeNull();
  });

  it('rejects clean saves when a globally scoped instance is no longer visible', async () => {
    await Teams.runWithTeam('a', async () => {
      const model = await ScopeRecord.where('slug', 'active').firstOrFail();
      await new QueryBuilder(ScopeRecord.table).where('slug', 'active').update({ visible: 0 });
      await expect(model.save()).rejects.toThrow('no longer available');
    });
  });

  it('does not let returning projections hide a zero-row scoped helper mutation', async () => {
    const saved = vi.fn();
    ScopeRecord.observe({
      async updating(model) {
        await new QueryBuilder(ScopeRecord.table).where('id', model.getAttribute('id')).update({ visible: 0 });
      }, saved,
    });
    await Teams.runWithTeam('a', async () => {
      await expect(ScopeRecord.query().returning('id').updateOrCreate({ slug: 'active' }, { title: 'Attempt' }))
        .rejects.toThrow('no longer available');
    });
    expect(saved).not.toHaveBeenCalled();
    expect(await new QueryBuilder(ScopeRecord.table).where('slug', 'active').value('title')).toBe('Active');
  });

  it('supports nested portable equality/IN/null scopes on insertion', async () => {
    class Nested extends Model { static table = ScopeRecord.table; static timestamps = false; }
    Nested.addGlobalScope('nested', (query) => query.orWhere('visible', 1)
      .whereNested((group) => group.whereIn('status', ['active', 'pending']).whereNull('deleted_at')));
    await Nested.create({ team_id: 'a', slug: 'nested', title: 'Nested', visible: 1, status: 'active', deleted_at: null });
    await expect(Nested.create({ team_id: 'a', slug: 'nested-hidden', title: 'Hidden', visible: 0, status: 'active', deleted_at: null }))
      .rejects.toThrow('does not satisfy');
    expect(await Nested.where('slug', 'nested').count()).toBe(1);
  });

  it.each(['>', '!=', 'LIKE'] as const)('uses %s for reads but fails closed on unsafe insertion inference', async (operator) => {
    class Filtered extends Model { static table = ScopeRecord.table; static timestamps = false; }
    Filtered.addGlobalScope('filter', (query) => query.where('status', operator, 'a'));
    expect(Filtered.query().toSQL().bindings).toEqual(['a']);
    await expect(Filtered.create({ team_id: 'a', slug: 'range', title: 'Range', status: 'active' }))
      .rejects.toThrow('only support equality');
  });

  it.each(['raw', 'update', 'empty', 'async', 'invalid'] as const)('fails closed for a %s scope callback', async (kind) => {
    class Unsafe extends Model { static table = ScopeRecord.table; }
    const callback = kind === 'raw' ? (query: any) => query.whereRaw('1=1')
      : kind === 'update' ? (query: any) => query.update({ visible: 1 })
      : kind === 'empty' ? () => {}
      : kind === 'async' ? async (query: GlobalScopeQuery) => { query.where('visible', 1); }
      : (query: GlobalScopeQuery) => query.where('visible', Number.NaN);
    Unsafe.addGlobalScope('unsafe', callback as GlobalScope);
    const raw = vi.spyOn(Connection, 'raw');
    await expect(Unsafe.all()).rejects.toThrow();
    expect(raw).not.toHaveBeenCalled();
  });

  it('prevents a retained callback adapter from mutating applied scope conditions', () => {
    class Retained extends Model { static table = ScopeRecord.table; }
    let adapter!: GlobalScopeQuery;
    Retained.addGlobalScope('retained', (query) => { adapter = query; query.where('visible', 1); });
    const query = Retained.query(); const sql = query.toSQL();
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(() => adapter.where('visible', 0)).toThrow('synchronous');
    expect(query.toSQL()).toEqual(sql);
  });

  it('rejects unscoped union branches and table rewrites while globals remain enabled', () => {
    class Filtered extends Model { static table = ScopeRecord.table; }
    Filtered.addGlobalScope('visible', (query) => query.where('visible', 1));
    expect(() => Filtered.query().union((query) => query.from(ScopeRecord.table)).toSQL()).toThrow('cannot change');
    expect(() => Filtered.query().from('other_records').toSQL()).toThrow('cannot change');
  });

  it.each(['sqlite', 'postgres', 'mysql'] as DatabaseDriver[])('compiles protected parameterized scopes on %s', (driver) => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    class Portable extends Model { static table = ScopeRecord.table; }
    Portable.addGlobalScope('visible', (query) => query.where('visible', 1).orWhere('title', "x' OR 1=1"));
    const compiled = Portable.where('slug', 'active').orWhere('slug', 'foreign').toSQL();
    expect(compiled.bindings).toEqual([1, "x' OR 1=1", 'active', 'foreign']);
    expect(compiled.sql).not.toContain("x' OR 1=1");
    expect(compiled.sql).toContain(') AND (');
    expect(compiled.sql).toContain(driver === 'mysql' ? '`global_scope_records`.`visible`' : '"global_scope_records"."visible"');
  });

  it('retains custom model key defaults for find and keyset chunks', async () => {
    class SlugRecord extends Model { static table = ScopeRecord.table; static primaryKey = 'slug'; static incrementing = false; }
    SlugRecord.addGlobalScope('visible', (query) => query.where('visible', 1));
    expect((await SlugRecord.query().find('pending'))?.getAttribute('slug')).toBe('pending');
    expect((await SlugRecord.query().findOrFail('active')).getAttribute('slug')).toBe('active');
    const slugs: string[] = [];
    await SlugRecord.query().chunkById(2, async (rows) => { slugs.push(...rows.map((row) => row.getAttribute('slug'))); });
    expect(slugs).toEqual(['active', 'archived', 'deleted', 'foreign', 'pending']);
  });

  it('keeps keyset predicates outside existing OR filters without replaying rows', async () => {
    await Teams.runWithTeam('a', async () => {
      const query = ScopeRecord.where('slug', 'active').orWhere('slug', 'pending');
      const original = query.toSQL();
      const slugs: string[] = [];
      await query.chunkById(1, async (rows) => {
        slugs.push(...rows.map((row) => row.getAttribute('slug')));
        if (slugs.length > 4) return false;
      });
      expect(slugs).toEqual(['active', 'pending']);
      expect(query.toSQL()).toEqual(original);
    });
  });

  it('does not expose mutable Date scope bindings through compiled SQL', () => {
    class DateScoped extends Model { static table = ScopeRecord.table; }
    const input = new Date('2026-01-01T00:00:00Z');
    DateScoped.addGlobalScope('date', (query) => query.where('deleted_at', input));
    const query = DateScoped.query(); const first = query.toSQL(); const clone = query.clone();
    input.setUTCFullYear(2030); first.bindings[0].setUTCFullYear(2031);
    expect(query.toSQL().bindings).toEqual([new Date('2026-01-01T00:00:00Z')]);
    expect(clone.toSQL()).toEqual(query.toSQL());
  });

  it('captures insert values before callers can mutate a validated payload', async () => {
    await Teams.runWithTeam('a', async () => {
      const payload = { slug: 'stable-insert', title: 'Stable', visible: 1, status: 'active' };
      const promise = ScopeRecord.query().insert(payload);
      payload.visible = 0;
      await promise;
      expect(await ScopeRecord.where('slug', 'stable-insert').count()).toBe(1);
    });
  });

  it('rejects explicitly undefined condition values before executing SQL', async () => {
    class UndefinedScope extends Model { static table = ScopeRecord.table; }
    UndefinedScope.addGlobalScope('undefined', (query) => (query as any).where('visible', '=', undefined));
    const raw = vi.spyOn(Connection, 'raw');
    await expect(UndefinedScope.all()).rejects.toThrow('require a value');
    expect(raw).not.toHaveBeenCalled();
  });

  it('drops replaced selectRaw bindings for aggregates then restores the original projection', async () => {
    await Teams.runWithTeam('a', async () => {
      const query = ScopeRecord.query().selectRaw('? AS marker', ['marker']).orderBy('id').limit(1).offset(1);
      const original = query.toSQL();
      expect(await query.count()).toBe(2);
      expect(query.toSQL()).toEqual(original);
      expect((await query.firstOrFail()).getAttribute('marker')).toBe('marker');
    });
  });

  it('provides typed, condition-only scope callbacks and model query results', () => {
    expectTypeOf(ScopeRecord.withoutGlobalScope('visible')).toEqualTypeOf<QueryBuilder<ScopeRecord>>();
    const compileOnly: GlobalScope = (query) => {
      expectTypeOf(query).toEqualTypeOf<GlobalScopeQuery>();
      // @ts-expect-error Scope callbacks cannot mutate or execute SQL.
      query.update({ visible: 0 });
      // @ts-expect-error Scope values cannot be arbitrary objects.
      query.where('visible', {});
    };
    expect(typeof compileOnly).toBe('function');
  });
});
