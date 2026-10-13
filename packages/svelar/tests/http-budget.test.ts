import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache, type CacheCapacityRequest, type CacheCapacityResult } from '../src/cache/index';
import { Http, HttpClient, HttpBudgetExceededError, HttpBudgetUnavailableError, type HttpBudgetConfig } from '../src/http/index';
import { fakeHttp } from '../src/testing/index';

const ok = () => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
let namespace: string;

beforeEach(() => {
  namespace = `budget-test-${randomUUID()}`;
  Cache.configure({ default: 'memory', stores: { memory: { driver: 'memory' } } });
  vi.stubGlobal('fetch', vi.fn(async () => ok()));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function config(overrides: Partial<HttpBudgetConfig> = {}): HttpBudgetConfig {
  return {
    namespace,
    store: Cache.store(),
    limits: [{ scope: 'credential', key: 'credential-secret', limit: 10, window: 60 }, { scope: 'account', key: 'account-secret', limit: 5, window: 60 }],
    ...overrides,
  };
}

describe('HTTP distributed request budgets', () => {
  it('shares limits between independently created clients and admits only capacity', async () => {
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => new HttpClient({ budget: config() }).get('https://provider.test/items')));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    expect(globalThis.fetch).toHaveBeenCalledTimes(5);
    const denied = results.filter((result) => result.status === 'rejected');
    expect(denied.every((result) => result.status === 'rejected' && result.reason instanceof HttpBudgetExceededError)).toBe(true);
  });

  it('charges both scopes once per actual HTTP attempt, including status retries', async () => {
    const store = Cache.store();
    const reserve = vi.spyOn(store, 'reserveCapacityMany');
    const transport = vi.fn().mockImplementationOnce(async () => new Response('retry', { status: 503 })).mockImplementation(async () => ok());
    vi.stubGlobal('fetch', transport);
    const client = Http.budget(config()).retry({ times: 1, delay: 0, sleep: async () => {} });
    expect((await client.get('https://provider.test/retry')).ok).toBe(true);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledTimes(2);
    for (const claim of reserve.mock.calls[0][0]) expect(await store.get(claim.key)).toBe(2);
  });

  it('charges network failure attempts but never retries a denied budget', async () => {
    const transport = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', transport);
    const errors = vi.fn();
    const client = Http.budget(config({ limits: [{ scope: 'credential', key: 'one-attempt', limit: 1, window: 60 }] }))
      .retry({ times: 5, delay: 0, sleep: async () => {} }).onError(errors);
    await expect(client.get('https://provider.test/network')).rejects.toBeInstanceOf(HttpBudgetExceededError);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('does not consume a free credential quota when the account quota is exhausted', async () => {
    const store = Cache.store();
    const reserve = vi.spyOn(store, 'reserveCapacityMany');
    await Http.budget(config({ limits: [{ scope: 'credential', key: 'a', limit: 10, window: 60 }, { scope: 'account', key: 'shared', limit: 1, window: 60 }] })).get('https://provider.test/a');
    await expect(Http.budget(config({ limits: [{ scope: 'credential', key: 'b', limit: 10, window: 60 }, { scope: 'account', key: 'shared', limit: 1, window: 60 }] })).get('https://provider.test/b')).rejects.toBeInstanceOf(HttpBudgetExceededError);
    const rejectedClaims = reserve.mock.calls[1][0];
    expect(await store.get(rejectedClaims[0].key)).toBeNull();
    expect(await store.get(rejectedClaims[1].key)).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('isolates namespaces and scopes without exposing identifiers in cache keys or errors', async () => {
    const store = Cache.store();
    const reserve = vi.spyOn(store, 'reserveCapacityMany');
    const limits = [{ scope: 'credential' as const, key: 'credential-secret', limit: 1, window: 60 }, { scope: 'account' as const, key: 'credential-secret', limit: 1, window: 60 }];
    const client = Http.budget(config({ namespace: 'tenant-secret', limits }));
    await client.get('https://provider.test/once');
    const claims = reserve.mock.calls[0][0];
    expect(claims[0].key).not.toBe(claims[1].key);
    expect(claims[0].key.match(/\{(.+)\}/)?.[1]).toBe(claims[1].key.match(/\{(.+)\}/)?.[1]);
    expect(JSON.stringify(claims)).not.toContain('secret');
    let denied: unknown;
    try { await client.get('https://provider.test/twice'); } catch (error) { denied = error; }
    expect(denied).toBeInstanceOf(HttpBudgetExceededError);
    expect(String(denied)).not.toContain('secret');
    expect((denied as HttpBudgetExceededError).headers.get('Retry-After')).toBe('60');
    await expect(Http.budget(config({ namespace: 'other', limits })).get('https://provider.test/isolated')).resolves.toMatchObject({ ok: true });
  });

  it('runs hooks before charging and preserves immutable fluent configuration', async () => {
    const budget = config({ limits: [{ scope: 'account', key: 'original', limit: 1, window: 60 }] });
    const base = new HttpClient({ budget });
    budget.limits[0].key = 'mutated';
    const store = Cache.store();
    const reserve = vi.spyOn(store, 'reserveCapacityMany');
    await expect(base.beforeRequest(() => { throw new Error('hook failed'); }).get('https://provider.test/hook')).rejects.toThrow('hook failed');
    expect(reserve).not.toHaveBeenCalled();
    const child = base.withToken('token').query({ page: 1 });
    await child.get('https://provider.test/first');
    await expect(base.get('https://provider.test/second')).rejects.toBeInstanceOf(HttpBudgetExceededError);
    await expect(new HttpClient({ budget: config({ limits: [{ scope: 'account', key: 'mutated', limit: 1, window: 60 }] }) }).get('https://provider.test/new')).resolves.toMatchObject({ ok: true });
  });

  it('fails closed for null or unavailable stores, does not retry, and redacts store errors', async () => {
    Cache.configure({ default: 'null', stores: { null: { driver: 'null' } } });
    const hooks = vi.fn();
    const client = Http.budget(config()).retry({ times: 4, delay: 0, sleep: async () => {} }).onError(hooks);
    await expect(client.get('https://provider.test/null')).rejects.toBeInstanceOf(HttpBudgetUnavailableError);
    const reserve = vi.fn(async (): Promise<CacheCapacityResult[]> => { throw new Error('redis://password-secret@host'); });
    await expect(Http.budget(config({ store: { reserveCapacityMany: reserve } })).get('https://provider.test/broken')).rejects.toThrow('HTTP request budget is unavailable.');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(hooks).toHaveBeenCalledTimes(1);
    expect(String(hooks.mock.calls[0][0].error)).not.toContain('secret');
  });

  it('does not fabricate a retry time when denied counter expiry is unknown', async () => {
    const reserveCapacityMany = vi.fn(async () => [{ allowed: false, value: 1, remaining: 0, expiresAt: null }]);
    const client = Http.budget(config({ store: { reserveCapacityMany }, limits: [{ scope: 'account', key: 'unknown', limit: 1, window: 60 }] }));
    await expect(client.get('https://provider.test/unknown')).rejects.toMatchObject({ retryAt: null });
    try { await client.get('https://provider.test/unknown'); } catch (error) { expect((error as HttpBudgetExceededError).headers.has('Retry-After')).toBe(false); }
  });

  it('does not open a provider circuit for local quota or cache failures', async () => {
    let broken = true;
    const reserveCapacityMany = vi.fn(async () => {
      if (broken) throw new Error('storage');
      return [{ allowed: true, value: 1, remaining: 1, expiresAt: Date.now() + 60_000 }];
    });
    const client = Http.budget(config({ store: { reserveCapacityMany }, limits: [{ scope: 'account', key: 'state', limit: 2, window: 60 }] }))
      .circuitBreaker({ key: namespace, failureThreshold: 1 });
    await expect(client.get('https://provider.test/failure')).rejects.toBeInstanceOf(HttpBudgetUnavailableError);
    broken = false;
    await expect(client.get('https://provider.test/success')).resolves.toMatchObject({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('applies budgets to scoped fake HTTP without leaking fake state or replacing transport', async () => {
    const fetch = globalThis.fetch;
    const client = Http.budget(config({ limits: [{ scope: 'credential', key: 'fake', limit: 1, window: 60 }] }));
    await fakeHttp(async (http) => {
      http.respondWith(ok());
      await client.get('https://provider.test/fake');
      await expect(client.get('https://provider.test/denied')).rejects.toBeInstanceOf(HttpBudgetExceededError);
      http.assertCount(1);
      expect(globalThis.fetch).toBe(fetch);
    });
    await Http.get('https://provider.test/outside');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed store responses without issuing a transport request', async () => {
    const invalidResponses: CacheCapacityResult[][] = [[], [{ allowed: true, value: NaN, remaining: 0, expiresAt: null }], [{ allowed: true, value: 1, remaining: 0, expiresAt: Infinity }]];
    for (const results of invalidResponses) {
      const store = { reserveCapacityMany: async (_claims: readonly CacheCapacityRequest[]) => results };
      await expect(Http.budget(config({ store })).get('https://provider.test/invalid')).rejects.toBeInstanceOf(HttpBudgetUnavailableError);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('validates limits and windows before any request', () => {
    for (const window of [0, -1, NaN, Infinity, 31_536_001]) expect(() => Http.budget(config({ limits: [{ scope: 'account', key: 'x', limit: 1, window }] }))).toThrow();
    expect(() => Http.budget(config({ limits: [] }))).toThrow();
    expect(() => Http.budget(config({ namespace: '' }))).toThrow();
    expect(() => Http.budget(config({ limits: [{ scope: 'account', key: 'x', limit: 1, window: 60, amount: 2 }] }))).toThrow();
    const repeated = { scope: 'account' as const, key: 'x', limit: 1, window: 60 };
    expect(() => Http.budget(config({ limits: [repeated, repeated] }))).toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
