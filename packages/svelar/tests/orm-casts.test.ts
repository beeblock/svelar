import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Model, type AttributeCast, type ModelCast } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

interface Money { cents: bigint; currency: string; }
const moneyCast: AttributeCast<Money> = {
  get(raw: string) {
    const stored = JSON.parse(raw) as { cents: string; currency: string };
    return { cents: BigInt(stored.cents), currency: stored.currency.toUpperCase() };
  },
  set(value) { return JSON.stringify({ cents: value.cents.toString(), currency: value.currency.toUpperCase() }); },
};
const labelCast: AttributeCast<{ value: string }> = {
  get(raw: string) { return { value: raw }; },
  set(value) { return value.value; },
  equals(left, right) { return left.value.toLowerCase() === right.value.toLowerCase(); },
};

class CastRecord extends Model {
  static table = 'cast_records';
  static timestamps = false;
  static casts = {
    total: 'decimal', fixed: 'decimal:2', metadata: 'json', observed_at: 'date',
    money: moneyCast, label: labelCast, quantity: 'number', enabled: 'boolean', name: 'string',
  } satisfies Record<string, ModelCast>;
}

describe.sequential('Model casts and semantic dirty tracking', () => {
  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    await new Schema().createTable('cast_records', (table) => {
      table.increments('id'); table.string('code').nullable().unique();
      for (const key of ['total', 'fixed', 'metadata', 'observed_at', 'money', 'label', 'quantity', 'enabled', 'name']) table.text(key).nullable();
    });
    CastRecord.boot({}); CastRecord.removeObservers();
  });

  afterEach(async () => {
    CastRecord.boot({}); CastRecord.removeObservers(); vi.restoreAllMocks(); await Connection.disconnect();
  });

  it.each(['400', '400.000', '+00400.00', '4e2', '40000e-2', 400])('treats %s as semantically equal to stored decimal 400.000', (value) => {
    const model = CastRecord.hydrate({ total: '400.000' });
    model.setAttribute('total', value);
    expect(model.getAttribute('total')).toBe('400');
    expect(model.isDirty('total')).toBe(false);
    expect(model.getOriginal('total')).toBe('400.000');
  });

  it('preserves decimal precision beyond Number limits and detects exact changes', () => {
    const model = CastRecord.hydrate({ total: '90071992547409931234567890.0000000001' });
    expect(model.getAttribute('total')).toBe('90071992547409931234567890.0000000001');
    model.setAttribute('total', '90071992547409931234567890.0000000002');
    expect(model.getDirty()).toEqual({ total: '90071992547409931234567890.0000000002' });
  });

  it.each(['0', '-0', '-0.000', '+0e20'])('normalizes decimal zero %s', (value) => {
    const model = CastRecord.hydrate({ total: '-0.000' });
    model.setAttribute('total', value);
    expect(model.getAttribute('total')).toBe('0'); expect(model.isClean()).toBe(true);
  });

  it.each([
    ['400.000', '400.00'], ['1.005', '1.01'], ['-1.005', '-1.01'], ['0.004', '0.00'],
    ['99999999999999999999.995', '100000000000000000000.00'], ['1e-3', '0.00'], ['0e20', '0.00'], ['-0e2', '0.00'],
  ])('rounds decimal:2 exactly from %s to %s', (value, expected) => {
    const model = new CastRecord({ fixed: value });
    expect(model.getAttribute('fixed')).toBe(expected);
    expect(model.getAttributes().fixed).toBe(expected);
  });

  it.each(['NaN', 'Infinity', '', '1foo', '1e10001', Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid decimal %s', (value) => {
    expect(() => new CastRecord({ total: value })).toThrow(TypeError);
  });

  it('compares fixed precision at its storage scale', async () => {
    await new QueryBuilder(CastRecord.table).insert({ fixed: '400.000' });
    const model = await CastRecord.firstOrFail();
    model.setAttribute('fixed', '400.004');
    expect(model.isClean('fixed')).toBe(true);
    await model.save(); expect(model.wasChanged('fixed')).toBe(false);
    model.setAttribute('fixed', '400.005');
    await model.save(); expect(model.wasChanged('fixed')).toBe(true);
    expect((await CastRecord.findOrFail(model.getAttribute('id'))).getAttribute('fixed')).toBe('400.01');
  });

  it('avoids dirty SQL and false changes for semantic primitive/date/JSON equality', async () => {
    await new QueryBuilder(CastRecord.table).insert({
      total: '400.000', quantity: '2', enabled: '0', name: '12',
      observed_at: '2026-01-01T00:00:00.000Z', metadata: '{"b":2,"a":1}',
    });
    const model = await CastRecord.firstOrFail();
    model.fill({ total: 400, quantity: 2, enabled: false, name: 12,
      observed_at: new Date('2026-01-01T01:00:00+01:00'), metadata: { a: 1, b: 2 } });
    expect(model.isClean()).toBe(true);
    const raw = vi.spyOn(Connection, 'raw');
    await model.save();
    expect(raw).not.toHaveBeenCalled(); expect(model.wasChanged()).toBe(false);
    expect(model.getAttribute('enabled')).toBe(false);
  });

  it('persists in-place mutable JSON and Date edits, and keeps previous originals for observers', async () => {
    const model = await CastRecord.create({ metadata: { nested: { count: 1 }, list: [1] }, observed_at: new Date('2026-01-01T00:00:00Z') });
    const observations: Array<{ original: any; previous: any; changes: any }> = [];
    CastRecord.observe({ updated(record) {
      observations.push({ original: record.getOriginal(), previous: record.getPreviousOriginal(), changes: record.getChanges() });
      expect(record.wasChanged('metadata', 'observed_at')).toBe(true);
      const changes = record.getChanges(); changes.metadata = 'tampered';
    } });
    const metadata = model.getAttribute('metadata');
    metadata.nested.count = 2; metadata.list.push(2);
    const observedAt = model.getAttribute('observed_at') as Date;
    observedAt.setUTCDate(2);
    expect(model.getAttribute('metadata')).toBe(metadata);
    expect(model.getAttribute('observed_at')).toBe(observedAt);
    expect(model.isDirty('metadata')).toBe(true); expect(model.isDirty('observed_at')).toBe(true);
    await model.save();
    expect(observations).toEqual([{
      original: expect.objectContaining({ metadata: '{"nested":{"count":1},"list":[1]}', observed_at: '2026-01-01T00:00:00.000Z' }),
      previous: expect.objectContaining({ metadata: '{"nested":{"count":1},"list":[1]}', observed_at: '2026-01-01T00:00:00.000Z' }),
      changes: { metadata: '{"nested":{"count":2},"list":[1,2]}', observed_at: '2026-01-02T00:00:00.000Z' },
    }]);
    expect(model.isClean()).toBe(true); expect(model.wasChanged('metadata')).toBe(true);
    const stored = await CastRecord.findOrFail(model.getAttribute('id'));
    expect(stored.getAttribute('metadata')).toEqual({ nested: { count: 2 }, list: [1, 2] });
    expect(stored.getAttribute('observed_at')).toEqual(new Date('2026-01-02T00:00:00Z'));
  });

  it('snapshots raw mutable JSON/Date values without sharing driver rows or original accessors', () => {
    const row = { id: 1, nested: { list: [1] }, date: new Date('2026-01-01T00:00:00Z') };
    const model = Model.hydrate(row);
    row.nested.list.push(99); row.date.setUTCFullYear(2030);
    expect(model.getAttribute('nested')).toEqual({ list: [1] });
    const originals = model.getOriginal(); originals.nested.list.push(88); originals.date.setUTCFullYear(2031);
    expect(model.getOriginal('nested')).toEqual({ list: [1] });
    expect(model.getOriginal('date')).toEqual(new Date('2026-01-01T00:00:00Z'));
    model.getAttribute('nested').list.push(2); model.getAttribute('date').setUTCDate(2);
    expect(model.getDirty()).toEqual({ nested: { list: [1, 2] }, date: new Date('2026-01-02T00:00:00Z') });
    const dirty = model.getDirty(); dirty.nested.list.push(77);
    expect(model.getAttribute('nested').list).toEqual([1, 2]);
  });

  it('handles PostgreSQL-like hydrated JSON objects and Date values without dirtying clean reads', () => {
    const row = { metadata: { nested: { count: 1 } }, observed_at: new Date('2026-01-01T00:00:00Z') };
    const model = CastRecord.hydrate(row);
    const metadata = model.getAttribute('metadata'); const date = model.getAttribute('observed_at');
    expect(model.isClean()).toBe(true);
    metadata.nested.count = 2; date.setUTCDate(2);
    expect(model.getDirty()).toEqual({ metadata: '{"nested":{"count":2}}', observed_at: '2026-01-02T00:00:00.000Z' });
    expect(row.metadata.nested.count).toBe(1); expect(row.observed_at.getUTCDate()).toBe(1);
    const original = model.getOriginal('metadata'); original.nested.count = 9;
    expect(model.getOriginal('metadata')).toEqual({ nested: { count: 1 } });
  });

  it('rejects asynchronous custom equality instead of silently losing dirty changes', () => {
    class AsyncEquality extends Model {
      static casts = { label: { ...labelCast, equals: (async () => false) as any } };
    }
    const model = AsyncEquality.hydrate({ label: 'before' });
    model.setAttribute('label', { value: 'after' });
    expect(() => model.getDirty()).toThrow('synchronously');
  });

  it('keeps custom cast values mutable and canonicalizes their storage for equality', async () => {
    await new QueryBuilder(CastRecord.table).insert({ money: '{"currency":"usd","cents":"000400"}' });
    const model = await CastRecord.firstOrFail();
    expect(model.getAttribute('money')).toEqual({ currency: 'USD', cents: 400n });
    model.setAttribute('money', { currency: 'usd', cents: 400n });
    expect(model.isClean('money')).toBe(true);
    const money = model.getAttribute('money') as Money;
    money.cents = 401n;
    expect(model.isDirty('money')).toBe(true);
    await model.save();
    expect(model.getPreviousOriginal('money')).toBe('{"currency":"usd","cents":"000400"}');
    expect(model.getChanges().money).toBe('{"cents":"401","currency":"USD"}');
    expect((await CastRecord.findOrFail(model.getAttribute('id'))).getAttribute('money')).toEqual({ currency: 'USD', cents: 401n });
  });

  it('uses custom equality when supplied, rather than object identity or storage formatting', async () => {
    const model = await CastRecord.create({ label: { value: 'ALPHA' } });
    model.setAttribute('label', { value: 'alpha' });
    expect(model.isClean('label')).toBe(true);
    await model.save(); expect(model.wasChanged('label')).toBe(false);
    model.getAttribute('label').value = 'beta';
    await model.save();
    expect(model.getChanges().label).toBe('beta');
    expect((await CastRecord.findOrFail(model.getAttribute('id'))).getAttribute('label')).toEqual({ value: 'beta' });
  });

  it('passes model and attribute key into typed custom read/write hooks', () => {
    const read = vi.fn((raw: string, _model: Model, _key: string) => ({ value: raw }));
    const write = vi.fn((value: { value: string }, _model: Model, _key: string) => value.value);
    class ContextCast extends Model { static casts = { field: { get: read, set: write } }; }
    const model = new ContextCast({ field: { value: 'hello' } });
    expect(model.getAttribute('field')).toEqual({ value: 'hello' });
    expect(write).toHaveBeenCalledWith({ value: 'hello' }, expect.any(ContextCast), 'field');
    expect(read).toHaveBeenCalledWith('hello', model, 'field');
  });

  it('keeps snapshot Date objects independent after a saved change', async () => {
    const model = await CastRecord.create({ observed_at: new Date('2026-01-01T00:00:00Z') });
    model.getAttribute('observed_at').setUTCDate(2); await model.save();
    const previous = model.getPreviousOriginal(); previous.observed_at = 'tampered';
    const changes = model.getChanges(); changes.observed_at = 'tampered';
    expect(model.getPreviousOriginal('observed_at')).toBe('2026-01-01T00:00:00.000Z');
    expect(model.getChanges().observed_at).toBe('2026-01-02T00:00:00.000Z');
    model.getAttribute('observed_at').setUTCDate(3);
    expect(model.getChanges().observed_at).toBe('2026-01-02T00:00:00.000Z');
    expect(model.getOriginal('observed_at')).toBe('2026-01-02T00:00:00.000Z');
    expect(model.isDirty('observed_at')).toBe(true);
  });

  it('does not lose in-place cast edits during helper updates', async () => {
    CastRecord.observe({ updating(model) { model.getAttribute('metadata').count++; } });
    const created = await CastRecord.query().firstOrCreate({ code: 'helper' }, { total: '400.000', metadata: { count: 1 } });
    const updated = await CastRecord.query().updateOrCreate({ code: 'helper' }, { total: 400 });
    expect(updated.getAttribute('id')).toBe(created.getAttribute('id'));
    expect(updated.wasChanged('total')).toBe(false); expect(updated.wasChanged('metadata')).toBe(true);
    expect((await CastRecord.findOrFail(created.getAttribute('id'))).getAttribute('metadata')).toEqual({ count: 2 });
  });

  it('serializes decimal, date and custom cast helper searches using their model contract', async () => {
    const created = await CastRecord.create({ fixed: '12.00', observed_at: new Date('2026-01-01T00:00:00Z'), money: { cents: 400n, currency: 'USD' } });
    const match = await CastRecord.query().firstOrCreate({
      fixed: '12.000', observed_at: new Date('2026-01-01T00:00:00Z'), money: { cents: 400n, currency: 'usd' },
    });
    expect(match.getAttribute('id')).toBe(created.getAttribute('id'));
    expect(await CastRecord.count()).toBe(1);
  });

  it('preserves null and tracks transitions to and from null', async () => {
    const model = await CastRecord.create({ metadata: null, total: null, money: null });
    expect(model.getAttribute('metadata')).toBeNull(); expect(model.isClean()).toBe(true);
    model.setAttribute('metadata', { value: 1 }); await model.save();
    expect(model.wasChanged('metadata')).toBe(true);
    model.setAttribute('metadata', null); await model.save();
    expect(model.getPreviousOriginal('metadata')).toBe('{"value":1}');
    expect(model.getChanges().metadata).toBeNull();
    expect((await CastRecord.findOrFail(model.getAttribute('id'))).getAttribute('metadata')).toBeNull();
  });

  it('preserves Buffer storage snapshots and detects content changes', () => {
    const buffer = Buffer.from([1, 2]);
    const model = Model.hydrate({ bytes: buffer });
    buffer[0] = 9;
    expect(Buffer.isBuffer(model.getOriginal('bytes'))).toBe(true);
    expect(model.isClean()).toBe(true);
    model.getAttribute('bytes')[0] = 3;
    expect(model.isDirty('bytes')).toBe(true);
    expect([...model.getOriginal('bytes')]).toEqual([1, 2]);
  });

  it('retains typed cast descriptors and model inference', () => {
    expectTypeOf<ReturnType<typeof moneyCast.get>>().toEqualTypeOf<Money>();
    expectTypeOf(CastRecord.query()).toEqualTypeOf<QueryBuilder<CastRecord>>();
    expectTypeOf(moneyCast.set).parameter(0).toEqualTypeOf<Money>();
    const compileOnly = () => {
      // @ts-expect-error The custom cast write value must satisfy its declared domain type.
      moneyCast.set({ cents: 'wrong', currency: 'USD' }, new Model(), 'money');
    };
    expect(typeof compileOnly).toBe('function');
  });
});
