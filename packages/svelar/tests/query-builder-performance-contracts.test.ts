import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Connection, type DatabaseDriver } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Model, TenantModel } from '../src/orm/Model.js';
import { QueryBuilder, type GlobalScopeQuery, type LeanResult } from '../src/orm/QueryBuilder.js';
import { ApplicationContext } from '../src/support/Context.js';
import { Teams } from '../src/teams/index.js';

describe('QueryBuilder membership and structured compilation cache', () => {
  beforeEach(() => {
    Connection.configure({ default: 'proof', connections: { proof: { driver: 'postgres', database: 'proof' } } });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('uses one PostgreSQL array parameter at every cardinality, including empty lists', () => {
    const shapes = [[], [1], [1, 2], [1, null, 3]].map((values) => new QueryBuilder('records').whereIn('id', values).toSQL());
    expect(new Set(shapes.map((query) => query.sql)).size).toBe(1);
    expect(shapes[0].sql).toBe('SELECT * FROM "records" WHERE "id" = ANY(?)');
    expect(shapes.map((query) => query.bindings)).toEqual([[[]], [[1]], [[1, 2]], [[1, null, 3]]]);
    const inverse = new QueryBuilder('records').whereNotIn('id', [1, null]).orWhereNotIn('id', []).toSQL();
    expect(inverse.sql).toBe('SELECT * FROM "records" WHERE "id" <> ALL(?) OR "id" <> ALL(?)');
    expect(inverse.bindings).toEqual([[1, null], []]);
  });

  it.each(['sqlite', 'mysql'] as DatabaseDriver[])('retains IN on %s and compiles empty lists to portable constants', (driver) => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    const quote = driver === 'mysql' ? '`' : '"';
    expect(new QueryBuilder('records').whereIn('id', [1, 2]).toSQL()).toEqual({
      sql: `SELECT * FROM ${quote}records${quote} WHERE ${quote}id${quote} IN (?, ?)`, bindings: [1, 2],
    });
    expect(new QueryBuilder('records').whereIn('id', []).orWhereNotIn('id', []).toSQL()).toEqual({
      sql: `SELECT * FROM ${quote}records${quote} WHERE 1 = 0 OR 1 = 1`, bindings: [],
    });
  });

  it('snapshots membership lists and never exposes their internal arrays through returned bindings', () => {
    const values = [1, 2];
    const query = new QueryBuilder('records').whereIn('id', values);
    values.push(3);
    query.toSQL().bindings[0].push(4);
    query.toSQL().bindings[0].push(5);
    expect(query.toSQL().bindings).toEqual([[1, 2]]);
    const clone = query.clone().whereIn('other_id', [9]);
    expect(clone.toSQL().bindings).toEqual([[1, 2], [9]]);
    expect(query.toSQL().bindings).toEqual([[1, 2]]);
  });

  it('keeps PostgreSQL arrays isolated through nested, scalar, CTE and UNION snapshots', () => {
    const builders = [
      new QueryBuilder('records').whereNested((query) => query.whereIn('id', [1, 2])),
      new QueryBuilder('records').whereExists((query) => query.from('other').whereIn('id', [1, 2])),
      new QueryBuilder('records').whereNotExists((query) => query.from('other').whereIn('id', [1, 2])),
      new QueryBuilder('records').whereSub('id', '=', (query) => query.from('other').whereIn('id', [1, 2])),
      new QueryBuilder('records').selectSub((query) => query.from('other').whereIn('id', [1, 2]), 'other_id'),
      new QueryBuilder('records').withCTE('cte', (query) => query.from('other').whereIn('id', [1, 2])),
      new QueryBuilder('records').union((query) => query.from('other').whereIn('id', [1, 2])),
    ];
    for (const query of builders) {
      const before = query.toSQL();
      query.toSQL().bindings[0].push(99);
      query.clone().toSQL().bindings[0].push(100);
      expect(query.toSQL()).toEqual(before);
    }
  });

  it('does no fingerprinting, slot collection or plan allocation on a cold builder or clone', () => {
    const query = new QueryBuilder('records').forTenant('a').where('name', 'user');
    const shape = vi.spyOn(query as any, 'queryShape');
    const slots = vi.spyOn(query as any, 'bindingSlots');
    const bind = vi.spyOn(query as any, 'bindCompiledQuery');
    const first = query.toSQL();
    expect(shape).not.toHaveBeenCalled();
    expect(slots).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect((query as any).compiledQuery).toBeUndefined();
    expect(query.toSQL()).toEqual(first);
    expect(shape).toHaveBeenCalledTimes(1);
    expect(slots).toHaveBeenCalledTimes(1);
    expect(bind).not.toHaveBeenCalled();
    expect((query as any).compiledQuery).toBeDefined();
    expect(query.toSQL()).toEqual(first);
    expect(shape).toHaveBeenCalledTimes(2);
    expect(slots).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledTimes(1);
    const clone = query.clone();
    const cloneShape = vi.spyOn(clone as any, 'queryShape');
    const cloneSlots = vi.spyOn(clone as any, 'bindingSlots');
    expect(clone.toSQL()).toEqual(first);
    expect(cloneShape).not.toHaveBeenCalled();
    expect(cloneSlots).not.toHaveBeenCalled();
    expect((clone as any).compiledQuery).toBeUndefined();
  });

  it('reuses SQL after two compilations and caches only positional metadata, never user or tenant values', () => {
    const query = new QueryBuilder('records').forTenant('TENANT_SECRET').where('name', 'USER_SECRET').whereIn('id', [17, 23]);
    const quote = vi.spyOn(query as any, 'quoteIdentifier');
    const first = query.toSQL();
    expect(query.toSQL()).toEqual(first);
    quote.mockClear();
    expect(query.toSQL()).toEqual(first);
    expect(quote).not.toHaveBeenCalled();
    const plan = JSON.stringify((query as any).compiledQuery);
    expect(plan).not.toContain('TENANT_SECRET');
    expect(plan).not.toContain('USER_SECRET');
    expect(plan).not.toContain('17');
    expect(plan).not.toContain('23');
    first.bindings[0] = 'MUTATED_TENANT';
    expect(query.toSQL().bindings).toEqual(['TENANT_SECRET', 'USER_SECRET', [17, 23]]);
    query.forTenant('NEXT_TENANT');
    expect(query.toSQL().bindings).toEqual(['NEXT_TENANT', 'USER_SECRET', [17, 23]]);
  });

  it('invalidates every structural change and does not share plans with clones', () => {
    const query = new QueryBuilder('records').where('name', 'before');
    query.toSQL(); query.toSQL();
    const clone = query.clone().select('id').whereNotNull('name').orderBy('id', 'desc').limit(5).offset(2);
    expect((clone as any).compiledQuery).toBeUndefined();
    expect(clone.toSQL().sql).toBe('SELECT "id" FROM "records" WHERE "name" = ? AND "name" IS NOT NULL ORDER BY "id" DESC LIMIT 5 OFFSET 2');
    expect(query.toSQL().sql).toBe('SELECT * FROM "records" WHERE "name" = ?');
    query.distinct().select('id').groupBy('id').having('id', '>', 3).forUpdate().skipLocked();
    expect(query.toSQL()).toEqual({
      sql: 'SELECT DISTINCT "id" FROM "records" WHERE "name" = ? GROUP BY "id" HAVING "id" > ? FOR UPDATE SKIP LOCKED',
      bindings: ['before', 3],
    });
    expect(query.toSQL().bindings).toEqual(['before', 3]);
    query.from('other_records');
    expect(query.toSQL().sql).toContain('FROM "other_records"');
    vi.spyOn(Connection, 'getDriver').mockReturnValue('mysql');
    expect(query.toSQL().sql).toContain('FROM `other_records`');
  });

  it('does not cache any raw or captured-subquery SQL, and bounds each local plan', () => {
    const queries = [
      new QueryBuilder('records').whereRaw('name = ?', ['secret']),
      new QueryBuilder('records').selectRaw("'literal-secret' as marker"),
      new QueryBuilder('records').orderByRaw('id + ?', [7]),
      new QueryBuilder('records').withRawCTE('cte', 'SELECT ?', [8]),
      new QueryBuilder('records').selectSub((sub) => sub.from('other').select('id'), 'other_id'),
      new QueryBuilder('records').union((sub) => sub.from('other')),
      new QueryBuilder('records').whereExists((sub) => sub.from('other')),
    ];
    for (const query of queries) {
      expect(query.toSQL()).toEqual(query.toSQL());
      expect((query as any).compiledQuery).toBeUndefined();
    }
    const wide = new QueryBuilder('records').select(...Array.from({ length: 4000 }, (_, index) => `column_${index}`));
    wide.toSQL(); wide.toSQL();
    expect((wide as any).compiledQuery).toBeUndefined();
  });

  it('compiles current structure on the second call and invalidates later warmed mutations', () => {
    const query = new QueryBuilder('records').where('name', 'original');
    const first = query.toSQL();
    query.whereIn('id', [1, 2]);
    const second = query.toSQL();
    expect(second.bindings).toEqual(['original', [1, 2]]);
    expect(second.sql).not.toBe(first.sql);
    expect(query.toSQL()).toEqual(second);
    query.forTenant('b').orWhere('name', 'other');
    const changed = query.toSQL();
    expect(changed.bindings).toEqual(['b', 'original', [1, 2], 'other']);
    expect(changed.sql).toContain(')');
    expect(changed.sql).toContain(' AND (');
    expect(query.toSQL()).toEqual(changed);
    expect(JSON.stringify((query as any).compiledQuery)).not.toContain('original');
    expect(JSON.stringify((query as any).compiledQuery)).not.toContain('other');
  });

  it('preserves protected nested-scope binding order and isolates mutable scope Dates on cache hits', () => {
    class Scoped extends Model { static table = 'records'; }
    const date = new Date('2026-01-01T00:00:00Z');
    Scoped.addGlobalScope('scope', (scope) => scope.whereNested((nested) => nested.whereIn('visible', [1, 2]).where('created_at', date)));
    const query = Scoped.query().where('name', 'user').forTenant('a');
    const first = query.toSQL();
    expect(first.bindings).toEqual(['a', [1, 2], date, 'user']);
    const second = query.toSQL();
    first.bindings[2].setUTCFullYear(2030);
    second.bindings[1].push(9);
    expect(query.toSQL().bindings).toEqual(['a', [1, 2], date, 'user']);
    expect(query.clone().toSQL()).toEqual(query.toSQL());
  });
});

describe('QueryBuilder structured lateral joins', () => {
  beforeEach(() => {
    Connection.configure({ default: 'proof', connections: {
      proof: { driver: 'postgres', database: 'proof' }, other: { driver: 'postgres', database: 'proof' },
    } });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(['postgres', 'mysql'] as const)('compiles safe correlated LEFT/CROSS joins and binding order on %s', (driver) => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    const sub = new QueryBuilder('sessions').select('user_id', 'label').whereColumn('sessions.user_id', 'users.id').where('active', true).limit(1);
    const original = sub.toSQL();
    const query = new QueryBuilder('users').withCTE('options', (cte) => cte.from('settings').where('key', 'cte'))
      .select('users.id', 'session.label').selectRaw('? as marker', ['select'])
      .leftJoinLateral(sub, 'session')
      .crossJoinLateral(new QueryBuilder('phones').select('user_id').whereColumn('phones.user_id', 'users.id').where('verified', 1), 'phone')
      .where('users.enabled', 1).groupBy('users.id', 'session.label').having('users.id', '>', 2).orderByRaw('users.id + ?', [3]);
    const compiled = query.toSQL();
    const quote = driver === 'mysql' ? '`' : '"';
    expect(compiled.sql).toContain(`LEFT JOIN LATERAL (${original.sql}) AS ${quote}session${quote} ON TRUE`);
    expect(compiled.sql).toContain('CROSS JOIN LATERAL (');
    expect(compiled.bindings).toEqual(['cte', 'select', true, 1, 1, 2, 3]);
    expect(query.clone().toSQL()).toEqual(compiled);
    sub.where('active', false);
    expect(query.toSQL()).toEqual(compiled);
    expect(original.bindings).toEqual([true]);
  });

  it('rejects raw inputs, invalid aliases, foreign named connections and missing tenant context before mutating the parent', () => {
    const parent = new QueryBuilder('users');
    const original = parent.toSQL();
    expect(() => parent.leftJoinLateral('SELECT 1' as any, 's')).toThrow('structured');
    for (const alias of ['s; DROP TABLE users', 'schema.s', 's as t', '*', '']) {
      expect(() => parent.leftJoinLateral(new QueryBuilder('sessions'), alias)).toThrow('Lateral alias');
    }
    expect(() => parent.leftJoinLateral(new QueryBuilder('sessions', undefined, 'other'), 's')).toThrow('same connection');
    class ScopedSession extends TenantModel { static table = 'sessions'; }
    expect(() => parent.leftJoinLateral(ScopedSession.query(), 's')).toThrow('Tenant context');
    expect(parent.toSQL()).toEqual(original);
  });

  it('checks SQLite support at insertion and rechecks connection identity at compilation', () => {
    const sub = new QueryBuilder('sessions');
    const parent = new QueryBuilder('users').leftJoinLateral(sub, 's');
    expect(() => Connection.usingConnection('other', () => parent.toSQL())).toThrow('same connection');
    Connection.configure({ default: 'proof', connections: { proof: { driver: 'sqlite', filename: ':memory:' } } });
    expect(() => parent.toSQL()).toThrow('Lateral joins require');
    const sqlite = new QueryBuilder('users');
    expect(() => sqlite.crossJoinLateral(sub, 's')).toThrow('Lateral joins require');
    expect(sqlite.toSQL().sql).toBe('SELECT * FROM "users"');
  });

  it('retains tenant, soft-delete and global conditions in a lateral subquery', () => {
    class Session extends TenantModel { static table = 'sessions'; static softDeletes = true; }
    Session.addGlobalScope('active', (query) => query.where('active', 1));
    const sub = Session.forTenant('a').select('label').whereColumn('sessions.user_id', 'users.id').orWhere('label', 'fallback');
    const parent = new QueryBuilder('users').leftJoinLateral(sub, 's').where('users.id', 7);
    expect(parent.toSQL().bindings).toEqual(['a', 1, 'fallback', 7]);
    expect(parent.toSQL().sql).toContain('"sessions"."deleted_at" IS NULL');
    expect(parent.toSQL().sql).toContain('"sessions"."team_id" = ?');
    expect(parent.toSQL().sql).toContain(') AND (');
  });

  it('isolates lateral arrays and Dates from caller mutations and returned bindings', () => {
    const instant = new Date('2026-01-01T00:00:00Z');
    const values = [1, 2];
    const sub = new QueryBuilder('sessions').where('created_at', instant).whereIn('id', values);
    const query = new QueryBuilder('users').leftJoinLateral(sub, 's');
    const clone = query.clone();
    instant.setUTCFullYear(2030); values.push(3);
    const compiled = query.toSQL();
    compiled.bindings[0].setUTCFullYear(2031); compiled.bindings[1].push(4);
    expect(query.toSQL().bindings).toEqual([new Date('2026-01-01T00:00:00Z'), [1, 2]]);
    expect(clone.toSQL()).toEqual(query.toSQL());
  });
});

describe('QueryBuilder lean reads and fresh scope adapters', () => {
  let constructions = 0;
  class Record extends TenantModel {
    static table = 'lean_records'; static timestamps = false; static softDeletes = true;
    static hidden = ['secret'];
    static casts = { enabled: 'boolean' as const, payload: 'json' as const };
    constructor() { super(); constructions++; }
  }
  Record.addGlobalScope('visible', (query) => query.where('visible', 1));
  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'proof', connections: { proof: { driver: 'sqlite', filename: ':memory:' } } });
    Teams.configure({ driver: 'memory' });
    await new Schema().createTable(Record.table, (table) => {
      table.increments(); table.string('team_id'); table.integer('visible'); table.integer('enabled');
      table.text('payload'); table.string('secret'); table.softDeletes();
    });
    await new QueryBuilder(Record.table).insertMany([
      { team_id: 'a', visible: 1, enabled: 1, payload: '{"a":1}', secret: 'visible-secret', deleted_at: null },
      { team_id: 'a', visible: 0, enabled: 1, payload: '{}', secret: 'hidden', deleted_at: null },
      { team_id: 'b', visible: 1, enabled: 1, payload: '{}', secret: 'foreign', deleted_at: null },
      { team_id: 'a', visible: 1, enabled: 0, payload: '{}', secret: 'deleted', deleted_at: '2026-01-01' },
    ]);
    constructions = 0;
  });
  afterEach(async () => { vi.restoreAllMocks(); Teams.clearCurrentTeam(); await Connection.disconnect(); });

  it('returns driver rows without Model construction, hydrate, casts, hidden filtering or accessors', async () => {
    const hydrate = vi.spyOn(Record, 'hydrate');
    const source = Record.forTenant('a').where('id', 1).orWhere('enabled', 1);
    const lean = source.lean<{ id: number; enabled: number; payload: string; secret: string }>();
    const rows = await lean.get();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, enabled: 1, payload: '{"a":1}', secret: 'visible-secret' });
    expect(rows[0]).not.toBeInstanceOf(Model);
    expect(hydrate).not.toHaveBeenCalled();
    expect(constructions).toBe(0);
    expect(lean.clone().toSQL()).toEqual(source.toSQL());
    expect(await lean.clone().first()).toEqual(rows[0]);
    expect((await lean.clone().paginate(1, 1)).data).toEqual(rows);
    const seen: number[] = [];
    await lean.clone().chunkById(1, async (items) => { seen.push(...items.map((row) => row.id)); });
    expect(seen).toEqual([1]);
    expect(hydrate).not.toHaveBeenCalled();
    expect(constructions).toBe(0);
    const hydrated = await source.firstOrFail();
    expect(hydrated).toBeInstanceOf(Record);
    expect(hydrated.getAttribute('payload')).toEqual({ a: 1 });
  });

  it('rejects eager loading in both orders and lean writes before issuing any SQL', async () => {
    expect(() => Record.forTenant('a').with('children').lean()).toThrow('eager load');
    expect(() => Record.forTenant('a').lean().with('children')).toThrow('eager load');
    const query = Record.forTenant('a').lean();
    const raw = vi.spyOn(Connection, 'raw');
    const attempts = [
      () => query.insert({}), () => query.insertGetId({}), () => query.insertMany([]),
      () => query.upsert([], 'id'), () => query.update({ enabled: 0 }), () => query.delete(),
      () => query.forceDelete(), () => query.increment('enabled'), () => query.decrement('enabled'),
      () => query.restore(), () => query.truncate(), () => query.firstOrCreate({ id: 1 }),
      () => query.updateOrCreate({ id: 1 }, { enabled: 0 }),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow('read-only');
    expect(raw).not.toHaveBeenCalled();
  });

  it('continues to require tenant context and honors explicit scope exclusions', async () => {
    expect(() => Record.query().lean().toSQL()).toThrow('Tenant context');
    expect(await Record.forTenant('a').withoutGlobalScope('visible').lean().count()).toBe(2);
    expect(await Record.forTenant('a').withTrashed().lean().count()).toBe(2);
    expect(await Record.query().withoutTenantScope().lean().count()).toBe(2);
  });

  it('shares frozen adapter methods but evaluates each context afresh and seals retained adapters', async () => {
    class ContextRecord extends Model { static table = Record.table; }
    const adapters: GlobalScopeQuery[] = [];
    ContextRecord.addGlobalScope('context', (query) => {
      adapters.push(query);
      query.where('team_id', ApplicationContext.get<string>('teamId')!);
    });
    const a = await Teams.runWithTeam('a', async () => ContextRecord.query().lean().toSQL());
    const b = await Teams.runWithTeam('b', async () => ContextRecord.query().lean().toSQL());
    expect(a.bindings).toEqual(['a']); expect(b.bindings).toEqual(['b']);
    expect(adapters[0]).not.toBe(adapters[1]);
    expect(adapters[0].where).toBe(adapters[1].where);
    expect(Object.isFrozen(adapters[0])).toBe(true);
    expect(Object.isFrozen(Object.getPrototypeOf(adapters[0]))).toBe(true);
    expect(() => adapters[0].where('team_id', 'b')).toThrow('synchronous');
    expect(() => adapters[0].whereNested((query) => query.where('team_id', 'b'))).toThrow('synchronous');
    expect(() => adapters[0].whereIn('team_id', ['b'])).toThrow('synchronous');
  });

  it('keeps lean return types plain through first, pagination, cloning and explicit row types', () => {
    interface Row { id: number }
    expectTypeOf<LeanResult<Record>>().toEqualTypeOf<{ [key: string]: unknown }>();
    expectTypeOf<LeanResult<{ id: number }>>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<LeanResult<Row>>().toEqualTypeOf<Row>();
    expectTypeOf(new QueryBuilder<Row>('records').lean()).toEqualTypeOf<QueryBuilder<Row>>();
    expectTypeOf(Record.lean<Row>()).toEqualTypeOf<QueryBuilder<Row>>();
    expectTypeOf(Record.forTenant('a').lean<Row>()).toEqualTypeOf<QueryBuilder<Row>>();
    const query = Record.forTenant('a').lean<{ id: number }>();
    expectTypeOf(query).toEqualTypeOf<QueryBuilder<{ id: number }>>();
    expectTypeOf(query.get).returns.resolves.toEqualTypeOf<{ id: number }[]>();
    expectTypeOf(query.first).returns.resolves.toEqualTypeOf<{ id: number } | null>();
    expectTypeOf(query.clone()).toEqualTypeOf<QueryBuilder<{ id: number }>>();
  });
});
