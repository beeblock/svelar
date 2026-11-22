import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Model, type ModelCast } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

afterEach(() => vi.restoreAllMocks());

describe('Model snapshot fast paths', () => {
  it('preserves all immutable scalar values without invoking structuredClone', () => {
    const clone = vi.spyOn(globalThis, 'structuredClone');
    const row = {
      text: 'hello', empty: '', count: 42, zero: 0, negativeZero: -0, nan: NaN,
      infinity: Infinity, enabled: false, nothing: null, missing: undefined, large: 9007199254740993n,
    };
    const model = Model.hydrate(row);
    expect(model.getAttributes()).toEqual(row);
    expect(model.getOriginal()).toEqual(row);
    expect(model.getOriginal('negativeZero')).toBe(-0);
    expect(model.getOriginal('nan')).toBeNaN();
    expect(model.getPreviousOriginal()).toEqual({});
    expect(model.getChanges()).toEqual({});
    expect(model.isClean()).toBe(true);
    expect(new Model(row).getAttributes()).toEqual(row);
    model.setAttribute('text', 'changed');
    expect(model.getDirty()).toEqual({ text: 'changed' });
    expect(clone).not.toHaveBeenCalled();
  });

  it.each([
    ['function', () => 'invalid'],
    ['symbol', Symbol('invalid')],
    ['nested function', { invalid: () => 'invalid' }],
    ['nested symbol', { invalid: Symbol('invalid') }],
  ])('retains structuredClone errors for a %s attribute', (_name, value) => {
    const clone = vi.spyOn(globalThis, 'structuredClone');
    expect(() => Model.hydrate({ value })).toThrow(/clone/i);
    expect(() => new Model({ value })).toThrow(/clone/i);
    expect(() => new Model().setAttribute('value', value)).toThrow(/clone/i);
    expect(clone).toHaveBeenCalledWith(value);
  });

  it('isolates Buffer, Date, JSON objects and arrays from input rows and sibling hydrations', () => {
    const row = {
      bytes: Buffer.from([1, 2]), date: new Date('2026-01-01T00:00:00Z'),
      metadata: { nested: { count: 1 }, list: [1] }, list: [{ count: 1 }],
    };
    const model = Model.hydrate(row);
    const sibling = Model.hydrate(row);
    row.bytes[0] = 9; row.date.setUTCDate(9); row.metadata.nested.count = 9; row.list[0].count = 9;
    expect(model.getAttributes()).toEqual(sibling.getAttributes());
    model.getAttribute('bytes')[0] = 2;
    model.getAttribute('date').setUTCDate(2);
    model.getAttribute('metadata').nested.count = 2;
    model.getAttribute('metadata').list.push(2);
    model.getAttribute('list')[0].count = 2;
    const original = sibling.getAttributes();
    expect(model.getOriginal()).toEqual(original);
    expect(Buffer.isBuffer(model.getOriginal('bytes'))).toBe(true);
    expect(model.getDirty()).toEqual({
      bytes: Buffer.from([2, 2]), date: new Date('2026-01-02T00:00:00Z'),
      metadata: { nested: { count: 2 }, list: [1, 2] }, list: [{ count: 2 }],
    });
    for (const snapshot of [model.getAttributes(), model.getDirty(), model.getOriginal()]) {
      snapshot.bytes[0] = 99; snapshot.date.setUTCDate(20); snapshot.metadata.nested.count = 99;
      snapshot.list[0].count = 99;
    }
    model.getOriginal('bytes')[0] = 99;
    model.getOriginal('date').setUTCDate(20);
    model.getOriginal('metadata').nested.count = 99;
    expect(model.getOriginal()).toEqual(original);
    expect(sibling.getAttributes()).toEqual(original);
    expect(model.getAttribute('bytes')).toEqual(Buffer.from([2, 2]));
    expect(model.getAttribute('date')).toEqual(new Date('2026-01-02T00:00:00Z'));
    expect(model.getAttribute('metadata').nested.count).toBe(2);
  });

  it('retains structured-clone support for cyclic objects and native mutable containers', () => {
    const cycle: { count: number; self?: unknown } = { count: 1 };
    cycle.self = cycle;
    const row = { cycle, map: new Map([['key', { count: 1 }]]), set: new Set([1]), bytes: new Uint8Array([1]) };
    const model = Model.hydrate(row);
    const original = model.getOriginal();
    expect(model.getAttribute('cycle').self).toBe(model.getAttribute('cycle'));
    expect(original.cycle.self).toBe(original.cycle);
    model.getAttribute('cycle').count = 2;
    model.getAttribute('map').get('key').count = 2;
    model.getAttribute('set').add(2);
    model.getAttribute('bytes')[0] = 2;
    expect(model.getOriginal()).toEqual(row);
    expect(model.isDirty('cycle', 'map', 'set', 'bytes')).toBe(true);
  });

  it('keeps own __proto__ columns as isolated data rather than object prototype assignments', () => {
    const row = JSON.parse('{"__proto__":{"count":1},"id":2}');
    const model = Model.hydrate(row);
    row.__proto__.count = 2;
    expect(Object.hasOwn(model.getAttributes(), '__proto__')).toBe(true);
    expect(Object.hasOwn(model.getOriginal(), '__proto__')).toBe(true);
    expect(model.getOriginal('__proto__')).toEqual({ count: 1 });
    const attributes = model.getAttributes(); attributes.__proto__.count = 3;
    expect(model.getAttributes().__proto__).toEqual({ count: 1 });
    expect(model.getOriginal('__proto__')).toEqual({ count: 1 });
  });

  it('preserves constructor-populated cast caches during hydration', () => {
    class ConstructorCast extends Model {
      static casts = { metadata: 'json' } satisfies Record<string, ModelCast>;
      constructor() {
        super({ metadata: { count: 1 } });
        this.getAttribute('metadata').count++;
      }
    }
    const row = { metadata: '{"count":9}' };
    const model = ConstructorCast.hydrate(row);
    expect(model.getAttribute('metadata')).toEqual({ count: 2 });
    expect(model.getOriginal('metadata')).toBe('{"count":2}');
    expect(model.isClean()).toBe(true);
    expect(row.metadata).toBe('{"count":9}');
  });

  it('preserves instance methods, getters, symbols and protected static-config lookups', () => {
    const marker = Symbol('marker');
    class CustomModel extends Model {
      static table = 'model_snapshots';
      static casts = { id: 'number' } satisfies Record<string, ModelCast>;
      declare id: number;
      declare title: string;
      calls = 0;
      [marker] = 'instance';
      get label() { return `${this.id}:${this.title}`; }
      describe() { this.calls++; return this.label; }
    }
    const names = ['table', 'primaryKey', 'incrementing', 'timestamps', 'createdAt', 'updatedAt',
      'softDeletes', 'deletedAt', 'uniqueIds', 'uniqueIdType', 'casts', 'fillable', 'hidden', 'connection'];
    const model = CustomModel.hydrate({ id: '7', title: 'Before', ...Object.fromEntries(names.map((name) => [name, 'column'])) });
    expect(model.describe()).toBe('7:Before');
    expect(model.calls).toBe(1);
    expect(model[marker]).toBe('instance');
    model.title = 'After'; model.id = 8;
    expect(model.describe()).toBe('8:After');
    expect(model.getDirty()).toEqual({ id: 8, title: 'After' });
    for (const name of names) {
      expect(Reflect.get(model, name)).toBeUndefined();
      expect(model.getAttribute(name)).toBe('column');
    }
    expect(model.getOriginal('title')).toBe('Before');
  });

  it('keeps mutable save snapshots separate from live values and observer-returned copies', async () => {
    class SavedModel extends Model { static table = 'model_snapshots'; static timestamps = false; }
    const update = vi.spyOn(QueryBuilder.prototype, 'update').mockResolvedValue(1);
    const model = SavedModel.hydrate({ id: 1, bytes: Buffer.from([1]), date: new Date('2026-01-01T00:00:00Z'), metadata: { count: 1 } });
    const before = model.getOriginal();
    const observed: Array<{ original: unknown; previous: unknown; changes: unknown }> = [];
    SavedModel.observe({ updated(record) {
      observed.push({ original: record.getOriginal(), previous: record.getPreviousOriginal(), changes: record.getChanges() });
      record.getChanges().bytes[0] = 99;
      record.getPreviousOriginal('metadata').count = 99;
    } });
    model.getAttribute('bytes')[0] = 2;
    model.getAttribute('date').setUTCDate(2);
    model.getAttribute('metadata').count = 2;
    const changes = model.getDirty();
    await model.save();
    expect(update).toHaveBeenCalledWith(changes);
    expect(observed).toEqual([{ original: before, previous: before, changes }]);
    expect(model.getPreviousOriginal()).toEqual(before);
    expect(model.getChanges()).toEqual(changes);
    expect(model.getOriginal()).toEqual({ id: 1, ...changes });
    expect(model.isClean()).toBe(true);
    expect(model.wasChanged('bytes', 'date', 'metadata')).toBe(true);
    model.getAttribute('bytes')[0] = 3;
    model.getAttribute('date').setUTCDate(3);
    model.getAttribute('metadata').count = 3;
    const previous = model.getPreviousOriginal();
    previous.bytes[0] = 99; previous.date.setUTCDate(20); previous.metadata.count = 99;
    expect(model.getPreviousOriginal()).toEqual(before);
    expect(model.getChanges()).toEqual(changes);
    expect(model.getOriginal()).toEqual({ id: 1, ...changes });
    expect(model.isDirty()).toBe(true);
    SavedModel.removeObservers();
  });
});

describe('Model static lean', () => {
  it('accepts ordinary row interfaces without requiring an index signature', () => {
    interface UserRow { id: number; name: string; }
    class LeanModel extends Model { static table = 'model_lean_rows'; }
    expectTypeOf(LeanModel.lean<UserRow>()).toEqualTypeOf<QueryBuilder<UserRow>>();
  });

  it('delegates to a model-backed lean query without hydrating, casting or hiding selected columns', async () => {
    class LeanModel extends Model {
      static table = 'model_lean_rows';
      static hidden = ['secret'];
      static casts = { count: 'number' } satisfies Record<string, ModelCast>;
    }
    const row = { id: 1, count: '2', secret: 'selected' };
    vi.spyOn(Connection, 'raw').mockResolvedValue([row]);
    const hydrate = vi.spyOn(LeanModel, 'hydrate');
    const query = LeanModel.lean<typeof row>();
    expectTypeOf(query).toEqualTypeOf<QueryBuilder<typeof row>>();
    expectTypeOf(LeanModel.lean()).toEqualTypeOf<QueryBuilder<Record<string, unknown>>>();
    const rows = await query.get();
    expect(rows).toEqual([row]);
    expect(rows[0]).not.toBeInstanceOf(Model);
    expect(rows[0].count).toBe('2');
    expect(rows[0].secret).toBe('selected');
    expect(hydrate).not.toHaveBeenCalled();
    expect(() => LeanModel.lean().with('anything')).toThrow(/lean/i);
    expect(() => LeanModel.with('anything').lean()).toThrow(/lean/i);
    await expect(LeanModel.lean().update({ count: '3' })).rejects.toThrow(/lean|read.only/i);
  });
});
