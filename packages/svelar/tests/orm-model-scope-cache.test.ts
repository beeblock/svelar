import { afterEach, describe, expect, it, vi } from 'vitest';
import { Model, TenantModel } from '../src/orm/Model.js';
import { type GlobalScope, type GlobalScopeQuery } from '../src/orm/QueryBuilder.js';
import { ApplicationContext } from '../src/support/Context.js';

afterEach(() => vi.restoreAllMocks());

describe('Model resolved global scope cache', () => {
  it('resolves inheritance once per constructor until registration invalidates the cache', () => {
    class Parent extends Model {}
    class Child extends Parent {}
    const scope: GlobalScope = (query) => query.where('active', true);
    Parent.addGlobalScope('active', scope);
    const getPrototypeOf = vi.spyOn(Object, 'getPrototypeOf');
    expect(Child.globalScopes().get('active')).toBe(scope);
    expect(getPrototypeOf).toHaveBeenCalledWith(Child);
    getPrototypeOf.mockClear();
    const cached = Child.globalScopes();
    const cacheLookupCalls = getPrototypeOf.mock.calls.length;
    expect(cached.get('active')).toBe(scope);
    expect(cacheLookupCalls).toBe(0);
    Parent.addGlobalScope('visible', (query) => query.where('visible', true));
    expect([...Child.globalScopes().keys()]).toEqual(['active', 'visible']);
    expect(getPrototypeOf).toHaveBeenCalledWith(Child);
  });

  it('invalidates cached children and grandchildren when an ancestor registers or replaces a scope', () => {
    class Parent extends Model {}
    class Child extends Parent {}
    class Grandchild extends Child {}
    class Sibling extends Parent {}
    const initial: GlobalScope = (query) => query.where('active', true);
    const replacement: GlobalScope = (query) => query.where('active', false);
    const childOverride: GlobalScope = (query) => query.where('active', 2);
    Parent.addGlobalScope('active', initial);
    Child.addGlobalScope('active', childOverride);
    Child.addGlobalScope('child', (query) => query.where('child', true));
    const oldSibling = Sibling.globalScopes();
    expect(Grandchild.globalScopes().get('active')).toBe(childOverride);
    Parent.addGlobalScope('active', replacement);
    Parent.addGlobalScope('late', (query) => query.whereNull('deleted_at'));
    expect(Parent.globalScopes().get('active')).toBe(replacement);
    expect(Sibling.globalScopes().get('active')).toBe(replacement);
    expect(oldSibling.get('active')).toBe(initial);
    expect(oldSibling.has('late')).toBe(false);
    expect(Child.globalScopes().get('active')).toBe(childOverride);
    expect(Grandchild.globalScopes().get('active')).toBe(childOverride);
    expect([...Grandchild.globalScopes().keys()]).toEqual(['active', 'late', 'child']);
  });

  it('invalidates an empty inherited registry and keeps late child registrations out of its siblings', () => {
    class Parent extends Model {}
    class Child extends Parent {}
    class Grandchild extends Child {}
    class Sibling extends Parent {}
    expect(Grandchild.globalScopes().size).toBe(0);
    expect(Sibling.globalScopes().size).toBe(0);
    Child.addGlobalScope('child', (query) => query.where('child', true));
    expect([...Grandchild.globalScopes().keys()]).toEqual(['child']);
    expect(Parent.globalScopes().size).toBe(0);
    expect(Sibling.globalScopes().size).toBe(0);
    Parent.addGlobalScope('parent', (query) => query.where('parent', true));
    expect([...Grandchild.globalScopes().keys()]).toEqual(['parent', 'child']);
    expect([...Sibling.globalScopes().keys()]).toEqual(['parent']);
  });

  it('keeps public maps defensive even after they have been cached', () => {
    class Scoped extends Model {}
    const registered = vi.fn((query: GlobalScopeQuery) => query.where('active', true));
    Scoped.addGlobalScope('active', registered);
    const first = Scoped.globalScopes() as Map<string, GlobalScope>;
    const second = Scoped.globalScopes() as Map<string, GlobalScope>;
    first.set('injected', (query) => query.where('other', true));
    first.delete('active'); second.clear();
    expect([...Scoped.globalScopes().keys()]).toEqual(['active']);
    expect(Scoped.globalScopes().get('active')).toBe(registered);
    expect(registered).not.toHaveBeenCalled();
  });

  it('keys the resolved cache by constructor identity rather than class name', () => {
    const First = class Record extends Model {};
    const Second = class Record extends Model {};
    First.addGlobalScope('first', (query) => query.where('first', true));
    Second.addGlobalScope('second', (query) => query.where('second', true));
    expect([...First.globalScopes().keys()]).toEqual(['first']);
    expect([...Second.globalScopes().keys()]).toEqual(['second']);
  });

  it('does not invalidate a warm cache for rejected registrations', () => {
    class Scoped extends Model {}
    Scoped.globalScopes();
    expect(() => Scoped.addGlobalScope(' ', () => {})).toThrow(TypeError);
    expect(() => Scoped.addGlobalScope('invalid', null as unknown as GlobalScope)).toThrow(TypeError);
    const getPrototypeOf = vi.spyOn(Object, 'getPrototypeOf');
    const scopes = Scoped.globalScopes();
    const cacheLookupCalls = getPrototypeOf.mock.calls.length;
    expect(scopes.size).toBe(0);
    expect(cacheLookupCalls).toBe(0);
  });

  it('resolves tenant and actor scope values independently for overlapping request contexts', async () => {
    class Scoped extends TenantModel { static table = 'scope_cache_records'; }
    const actorScope = vi.fn((query: GlobalScopeQuery) => query.where('owner_id', ApplicationContext.get<string>('userId')!));
    Scoped.addGlobalScope('actor', actorScope);
    Scoped.globalScopes();
    const results = await Promise.all(['a', 'b'].map((name) => ApplicationContext.runIsolated({ teamId: `team-${name}`, userId: `user-${name}` }, async () => {
      await Promise.resolve();
      const query = Scoped.query();
      await Promise.resolve();
      return query.toSQL();
    })));
    expect(results[0].bindings).toHaveLength(2);
    expect(results[0].bindings).toEqual(expect.arrayContaining(['team-a', 'user-a']));
    expect(results[1].bindings).toHaveLength(2);
    expect(results[1].bindings).toEqual(expect.arrayContaining(['team-b', 'user-b']));
    expect(actorScope).toHaveBeenCalledTimes(2);
    ApplicationContext.runIsolated({ userId: 'user-without-team' }, () => {
      expect(() => Scoped.query().toSQL()).toThrow(/Tenant context/);
    });
  });

  it('reruns cached callbacks for fresh queries without changing already-compiled query values', () => {
    class Scoped extends Model { static table = 'scope_cache_records'; }
    let actor = 'first';
    const callback = vi.fn((query: GlobalScopeQuery) => query.where('owner_id', actor));
    Scoped.addGlobalScope('actor', callback);
    const original = Scoped.query();
    expect(original.toSQL().bindings).toEqual(['first']);
    actor = 'second';
    expect(Scoped.query().toSQL().bindings).toEqual(['second']);
    expect(original.toSQL().bindings).toEqual(['first']);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
