import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { TenantModel } from '../src/orm/Model.js';
import { QueryBuilder, type JsonLengthOperator, type JsonValue, type WindowSpecification } from '../src/orm/index.js';

describe('Structured JSON and window SQL', () => {
  beforeEach(() => { vi.spyOn(Connection, 'getDriver').mockReturnValue('postgres'); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('binds JSON values and top-level keys in their SQL position without interpolating data', () => {
    const key = "ready' OR 1=1 -- ?";
    const query = new QueryBuilder('records').selectRaw('? as marker', ['projection'])
      .whereJsonContains('records.metadata', { state: 'ready', nested: [1, true, null] })
      .whereJsonContainsKey('metadata', key).where('team_id', 'tenant-a')
      .orderByRaw('CASE WHEN status = ? THEN 0 ELSE 1 END', ['first']);
    expect(query.toSQL()).toEqual({
      sql: 'SELECT ? as marker FROM "records" WHERE ("records"."metadata"::jsonb @> ?::jsonb) AND ("metadata"::jsonb ? ?) AND "team_id" = ? ORDER BY CASE WHEN status = ? THEN 0 ELSE 1 END',
      bindings: ['projection', '{"state":"ready","nested":[1,true,null]}', key, 'tenant-a', 'first'],
    });
  });

  it('keeps OR and negation predicates structured and snapshots JSON input before later mutations', () => {
    const value = { state: ['first'] };
    const query = new QueryBuilder('records').whereJsonDoesntContain('metadata', value)
      .orWhereJsonContains('metadata', false).whereJsonDoesntContainKey('metadata', '')
      .orWhereJsonDoesntContain('metadata', null).orWhereJsonDoesntContainKey('metadata', 'missing');
    value.state.push('later');
    expect(query.toSQL().bindings).toEqual(['{"state":["first"]}', 'false', '', 'null', 'missing']);
    expect(query.toSQL().sql).toContain('NOT ("metadata"::jsonb @> ?::jsonb) OR ("metadata"::jsonb @> ?::jsonb)');
    expect(query.toSQL().sql).toContain('AND NOT ("metadata"::jsonb ? ?)');
    expect(query.toSQL().sql).toContain('OR NOT ("metadata"::jsonb ? ?)');
    const cloned = query.clone().orWhereJsonContainsKey('metadata', 'extra');
    expect(cloned.toSQL().bindings).toEqual([...query.toSQL().bindings, 'extra']);
    expect(query.toSQL().bindings).toHaveLength(5);
  });

  for (const driver of ['sqlite', 'mysql'] as const) {
    it(`fails before mutation for PostgreSQL-only JSONB semantics on ${driver}`, () => {
      vi.mocked(Connection.getDriver).mockReturnValue(driver);
      const query = new QueryBuilder('records').where('id', 1);
      const before = query.toSQL();
      for (const invoke of [
        () => query.whereJsonContains('metadata', { ready: true }), () => query.orWhereJsonContains('metadata', 1),
        () => query.whereJsonDoesntContain('metadata', null), () => query.orWhereJsonDoesntContain('metadata', []),
        () => query.whereJsonContainsKey('metadata', 'ready'), () => query.orWhereJsonContainsKey('metadata', 'ready'),
        () => query.whereJsonDoesntContainKey('metadata', 'ready'), () => query.orWhereJsonDoesntContainKey('metadata', 'ready'),
      ]) { expect(invoke).toThrow('requires PostgreSQL'); expect(query.toSQL()).toEqual(before); }
    });
  }

  it('rejects invalid, cyclic, sparse, accessor and custom-serialized JSON without changing the query', () => {
    const query = new QueryBuilder('records').where('id', 1); const before = query.toSQL();
    const cycle: any = {}; cycle.self = cycle;
    const accessor = vi.fn(() => 'value'); const object = Object.defineProperty({}, 'secret', { get: accessor, enumerable: true });
    const serializer = vi.fn(() => ({})); const custom = { toJSON: serializer };
    const augmented = Object.assign(['first'], { extra: 'ignored' });
    for (const value of [undefined, NaN, Infinity, -Infinity, 1n, new Date(), new Map(), cycle, [, 1], augmented, object, custom]) {
      expect(() => query.whereJsonContains('metadata', value as JsonValue)).toThrow();
      expect(query.toSQL()).toEqual(before);
    }
    expect(accessor).not.toHaveBeenCalled(); expect(serializer).not.toHaveBeenCalled();
    expect(() => query.whereJsonContainsKey('metadata', 'nul\0key')).toThrow();
    expect(query.toSQL()).toEqual(before);
  });

  it('rejects SQL fragments, aliases and wildcards as structured JSON/window columns', () => {
    const query = new QueryBuilder('records'); const before = query.toSQL();
    for (const column of ['*', 'records.*', 'metadata as data', 'metadata data', 'metadata->ready', 'metadata; DROP TABLE records', 'metadata..key']) {
      expect(() => query.whereJsonContains(column, true)).toThrow();
      expect(() => query.whereJsonContainsKey(column, 'ready')).toThrow();
      expect(() => query.whereJsonLength(column, 1)).toThrow();
      expect(() => query.selectWindow('ranked', { function: 'row_number', orderBy: [{ column }] })).toThrow();
      expect(query.toSQL()).toEqual(before);
    }
  });

  for (const [driver, expression] of [
    ['postgres', 'CASE WHEN jsonb_typeof("tags"::jsonb) = \'array\' THEN jsonb_array_length("tags"::jsonb) END'],
    ['mysql', 'CASE WHEN JSON_TYPE(`tags`) = \'ARRAY\' THEN JSON_LENGTH(`tags`) END'],
    ['sqlite', 'CASE WHEN json_type("tags") = \'array\' THEN json_array_length("tags") END'],
  ] as const) {
    it(`compiles array-only length comparisons with bound operands for ${driver}`, () => {
      vi.mocked(Connection.getDriver).mockReturnValue(driver);
      const query = new QueryBuilder('records').whereJsonLength('tags', '>=', 2).orWhereJsonLength('tags', 0);
      const quote = driver === 'mysql' ? '`' : '"';
      expect(query.toSQL()).toEqual({ sql: `SELECT * FROM ${quote}records${quote} WHERE (${expression}) >= ? OR (${expression}) = ?`, bindings: [2, 0] });
    });
  }

  it('preflights invalid lengths, operators and missing database configuration', () => {
    const query = new QueryBuilder('records'); const before = query.toSQL();
    for (const length of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => query.whereJsonLength('tags', length)).toThrow();
    expect(() => query.whereJsonLength('tags', '>= 0 OR 1=1' as JsonLengthOperator, 0)).toThrow();
    expect(query.toSQL()).toEqual(before);
    vi.mocked(Connection.getDriver).mockImplementation(() => { throw new Error('Missing configured database'); });
    expect(() => query.whereJsonLength('tags', 0)).toThrow('Missing configured database');
    expect(() => query.whereJsonContains('metadata', true)).toThrow('Missing configured database');
  });

  for (const driver of ['postgres', 'mysql', 'sqlite'] as const) {
    it(`compiles validated ranking and explicit aggregate frames for ${driver}`, () => {
      vi.mocked(Connection.getDriver).mockReturnValue(driver);
      const q = driver === 'mysql' ? '`' : '"';
      const query = new QueryBuilder('records').select('id')
        .selectWindow('position', { function: 'row_number', partitionBy: ['records.category'], orderBy: [{ column: 'amount', direction: 'desc' }, { column: 'id' }] })
        .selectWindow('running', { function: 'sum', column: 'amount', partitionBy: ['category'], orderBy: [{ column: 'id' }], frame: 'running' })
        .selectWindow('total', { function: 'count', column: '*', partitionBy: ['category'] }).where('team_id', 'a');
      expect(query.toSQL()).toEqual({ sql: `SELECT ${q}id${q}, ROW_NUMBER() OVER (PARTITION BY ${q}records${q}.${q}category${q} ORDER BY ${q}amount${q} DESC, ${q}id${q} ASC) as ${q}position${q}, SUM(${q}amount${q}) OVER (PARTITION BY ${q}category${q} ORDER BY ${q}id${q} ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as ${q}running${q}, COUNT(*) OVER (PARTITION BY ${q}category${q} ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as ${q}total${q} FROM ${q}records${q} WHERE ${q}team_id${q} = ?`, bindings: ['a'] });
    });
  }

  it('keeps original select/where/order bindings and snapshots caller-owned window lists across clones', () => {
    const partition = ['category']; const order = [{ column: 'id', direction: 'desc' as const }];
    const query = new QueryBuilder('records').selectRaw('? as marker', ['marker'])
      .selectWindow('ranked', { function: 'rank', partitionBy: partition, orderBy: order })
      .where('id', '>', 3).orderByRaw('CASE WHEN category = ? THEN 0 ELSE 1 END', ['priority']);
    const before = query.toSQL(); partition[0] = 'changed'; order[0].column = 'changed';
    expect(query.toSQL()).toEqual(before);
    const clone = query.clone().whereJsonLength('tags', 2).selectWindow('dense', { function: 'dense_rank', orderBy: [{ column: 'id' }] });
    expect(clone.toSQL().bindings).toEqual(['marker', 3, 2, 'priority']);
    expect(query.toSQL()).toEqual(before);
  });

  it('rejects arbitrary window functions, frames, directions, aliases and extra fields before mutation', () => {
    const query = new QueryBuilder('records'); const before = query.toSQL();
    for (const specification of [
      { function: 'pg_sleep', column: 'id' }, { function: 'row_number' },
      { function: 'rank', column: 'id', orderBy: [{ column: 'id' }] },
      { function: 'row_number', orderBy: [{ column: 'id' }], frame: 'partition' },
      { function: 'sum', column: '*' }, { function: 'sum', column: 'amount', frame: '1 PRECEDING' },
      { function: 'sum', column: 'amount', frame: 'running' },
      { function: 'count', column: '*', orderBy: [{ column: 'id', direction: 'desc; DROP TABLE records' }] },
      { function: 'count', column: '*', partitionBy: ['id as injected'] },
      { function: 'count', column: '*', sql: 'untrusted' },
      { function: 'count', column: '*', orderBy: [{ column: 'id', expression: 'untrusted' }] },
      { function: 'count', column: '*', partitionBy: Array(17).fill('id') },
      { function: 'count', column: '*', partitionBy: Array(1) },
      { function: 'row_number', orderBy: Array(1) },
    ]) {
      expect(() => query.selectWindow('result', specification as WindowSpecification)).toThrow();
      expect(query.toSQL()).toEqual(before);
    }
    for (const alias of ['records.result', '*', 'result as injected', 'result; SELECT 1', undefined, { toString: () => 'result' }]) {
      expect(() => query.selectWindow(alias as string, { function: 'count', column: '*' })).toThrow();
      expect(query.toSQL()).toEqual(before);
    }
  });

  it('exports typed structured inputs from the existing ORM barrel', () => {
    expectTypeOf<QueryBuilder['whereJsonContains']>().parameter(1).toEqualTypeOf<JsonValue>();
    expectTypeOf<QueryBuilder['selectWindow']>().parameter(1).toEqualTypeOf<WindowSpecification>();
    const specification: WindowSpecification = { function: 'sum', column: 'amount', partitionBy: ['category'], frame: 'partition' };
    expect(new QueryBuilder('records').selectWindow('total', specification).toSQL().sql).toContain('SUM("amount") OVER');
  });
});

class WindowRecord extends TenantModel {
  static table = 'json_window_records'; static timestamps = false; static softDeletes = true;
}
WindowRecord.addGlobalScope('visible', (query) => query.where('visible', 1));

describe.sequential('Native SQLite portable JSON/window behavior', () => {
  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'proof', connections: { proof: { driver: 'sqlite', filename: ':memory:' } } });
    await new Schema().createTable(WindowRecord.table, (table) => {
      table.increments('id'); table.string('team_id'); table.integer('visible'); table.string('category');
      table.integer('amount'); table.json('tags').nullable(); table.softDeletes();
    });
    await new QueryBuilder(WindowRecord.table).insertMany([
      { team_id: 'a', visible: 1, category: 'x', amount: 10, tags: '[1,2]', deleted_at: null },
      { team_id: 'a', visible: 1, category: 'x', amount: 20, tags: '[]', deleted_at: null },
      { team_id: 'a', visible: 0, category: 'x', amount: 100, tags: '[]', deleted_at: null },
      { team_id: 'b', visible: 1, category: 'x', amount: 999, tags: '[]', deleted_at: null },
      { team_id: 'a', visible: 1, category: 'y', amount: 30, tags: '{}', deleted_at: null },
      { team_id: 'a', visible: 1, category: 'y', amount: 40, tags: 'null', deleted_at: null },
      { team_id: 'a', visible: 1, category: 'x', amount: 500, tags: '[]', deleted_at: '2026-01-01' },
    ]);
  });
  afterEach(async () => { await Connection.disconnect(); });

  it('never equates objects/JSON null with empty arrays, and scopes remain outside user OR predicates', async () => {
    const query = WindowRecord.forTenant('a').whereJsonLength('tags', 2).orWhereJsonLength('tags', 0).orderBy('id');
    expect((await query.get()).map((row) => row.getAttribute('id'))).toEqual([1, 2]);
    expect((await WindowRecord.forTenant('a').whereJsonLength('tags', '!=', 0).get()).map((row) => row.getAttribute('id'))).toEqual([1]);
    expect((await query.clone().where('amount', '>', 10).get()).map((row) => row.getAttribute('id'))).toEqual([1, 2]);
    expect((await query.get()).map((row) => row.getAttribute('id'))).toEqual([1, 2]);
  });

  it('ranks and aggregates only the current tenant, visible rows and nondeleted records', async () => {
    const query = WindowRecord.forTenant('a').select('id', 'category').whereJsonLength('tags', '>=', 0)
      .selectWindow('ordinal', { function: 'row_number', partitionBy: ['category'], orderBy: [{ column: 'id' }] })
      .selectWindow('running', { function: 'sum', column: 'amount', partitionBy: ['category'], orderBy: [{ column: 'id' }], frame: 'running' })
      .selectWindow('partition_count', { function: 'count', column: '*', partitionBy: ['category'] }).orderBy('id');
    const records = await query.get();
    expect(records.map((row) => [row.getAttribute('id'), row.getAttribute('ordinal'), row.getAttribute('running'), row.getAttribute('partition_count')]))
      .toEqual([[1, 1, 10, 2], [2, 2, 30, 2]]);
    expect(query.clone().toSQL()).toEqual(query.toSQL());
  });
});
