import type { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache, type CacheStoreConfig } from '../src/cache/index.js';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';

interface FakeClient extends EventEmitter {
  status: string;
  options: Record<string, unknown>;
  url?: string;
  connect: ReturnType<typeof vi.fn<() => Promise<void>>>;
  disconnect: ReturnType<typeof vi.fn<() => void>>;
  get: ReturnType<typeof vi.fn<(key: string) => Promise<string | null>>>;
  exists: ReturnType<typeof vi.fn<(key: string) => Promise<number>>>;
  set: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<string>>>;
  del: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<number>>>;
  scan: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<[string, string[]]>>>;
  eval: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>;
  finishConnect(): void;
  failConnect(error: Error): void;
}

const sdk = vi.hoisted(() => ({ instances: [] as FakeClient[], automaticReady: true }));
vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: class extends EventEmitter {
    status = 'wait';
    options: Record<string, unknown>;
    url?: string;
    private accept?: () => void;
    private reject?: (error: Error) => void;
    connect = vi.fn(() => {
      this.status = 'connecting';
      return new Promise<void>((accept, reject) => {
        this.accept = accept;
        this.reject = reject;
        if (sdk.automaticReady) this.finishConnect();
      });
    });
    disconnect = vi.fn(() => { this.status = 'end'; this.emit('end'); });
    get = vi.fn(async (_key: string): Promise<string | null> => '{"value":"hit"}');
    exists = vi.fn(async (_key: string) => 1);
    set = vi.fn(async (..._args: unknown[]) => 'OK');
    del = vi.fn(async (..._args: unknown[]) => 1);
    scan = vi.fn(async (..._args: unknown[]): Promise<[string, string[]]> => ['0', []]);
    eval = vi.fn(async (..._args: unknown[]): Promise<unknown> => 1);
    constructor(urlOrOptions: string | Record<string, unknown>, options?: Record<string, unknown>) {
      super();
      this.url = typeof urlOrOptions === 'string' ? urlOrOptions : undefined;
      this.options = typeof urlOrOptions === 'string' ? options! : urlOrOptions;
      sdk.instances.push(this);
    }
    finishConnect() { this.status = 'ready'; this.accept?.(); }
    failConnect(error: Error) { this.emit('error', error); this.reject?.(new Error('Connection is closed.')); }
  } };
});

function configure(options: Partial<CacheStoreConfig> = {}) {
  Cache.configure({ default: 'redis', stores: { redis: { driver: 'redis', ...options } } });
  return Cache.store();
}

describe('owned Redis cache lifecycle', () => {
  beforeEach(() => { sdk.instances = []; sdk.automaticReady = true; });
  afterEach(() => {
    for (const client of sdk.instances) client.disconnect();
    Cache.configure({ default: 'memory', stores: { memory: { driver: 'memory' } } });
    vi.useRealTimers();
  });

  it('starts lazily with bounded defaults and no automatic command replay/retries', async () => {
    const store = configure();
    expect(sdk.instances).toHaveLength(0);
    expect(await store.get('key')).toBe('hit');
    const [client] = sdk.instances;
    expect(client.options).toMatchObject({ lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
      connectTimeout: 2000, commandTimeout: 2000, disconnectTimeout: 1, autoResendUnfulfilledCommands: false });
    expect((client.options.retryStrategy as () => null)()).toBeNull();
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.listenerCount('error')).toBe(1);
  });

  it('applies configured deadlines to a URL-owned client', async () => {
    const store = configure({ url: 'redis://127.0.0.1:12345/3', connectTimeoutMs: 300, commandTimeoutMs: 450 });
    await store.has('key');
    expect(sdk.instances[0].url).toBe('redis://127.0.0.1:12345/3');
    expect(sdk.instances[0].options).toMatchObject({ connectTimeout: 300, commandTimeout: 450 });
  });

  it.each(['connectTimeoutMs', 'commandTimeoutMs'] as const)('validates the owned %s bound', (name) => {
    for (const value of [0, -1, 1.5, NaN, Infinity, 30_001]) {
      expect(() => configure({ [name]: value })).toThrow(/integer between 1 and 30000/);
    }
    expect(() => configure({ [name]: 1 })).not.toThrow();
    expect(() => configure({ [name]: 30_000 })).not.toThrow();
  });

  it('shares startup and never dispatches commands before readiness', async () => {
    sdk.automaticReady = false;
    const store = configure();
    const calls = [store.get('a'), store.has('b'), store.put('c', 'value')];
    await vi.waitFor(() => expect(sdk.instances).toHaveLength(1));
    const [client] = sdk.instances;
    expect(client.get).not.toHaveBeenCalled();
    expect(client.exists).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
    client.finishConnect();
    expect(await Promise.all(calls)).toEqual(['hit', true, undefined]);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('propagates the connection error to concurrent readers and recovers on a later call', async () => {
    sdk.automaticReady = false;
    const store = configure();
    const failure = new Error('connect ECONNREFUSED');
    const pending = Promise.allSettled([Cache.get('a', 'not-a-fallback'), store.get('b')]);
    await vi.waitFor(() => expect(sdk.instances).toHaveLength(1));
    const [failed] = sdk.instances;
    failed.failConnect(failure);
    expect(await pending).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }]);
    expect(failed.disconnect).toHaveBeenCalledTimes(1);
    expect(failed.get).not.toHaveBeenCalled();
    sdk.automaticReady = true;
    expect(await store.get('later')).toBe('hit');
    expect(sdk.instances).toHaveLength(2);
  });

  it('disconnects a startup that never reaches ready and clears its deadline timer', async () => {
    vi.useFakeTimers();
    sdk.automaticReady = false;
    const store = configure({ connectTimeoutMs: 25 });
    const pending = store.get('key');
    const assertion = expect(pending).rejects.toThrow('connect timed out after 25 milliseconds');
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(sdk.instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    sdk.automaticReady = true;
    expect(await store.get('later')).toBe('hit');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disconnects an unresponsive command, rejects instead of reporting a miss, and recovers', async () => {
    vi.useFakeTimers();
    const store = configure({ commandTimeoutMs: 25 });
    await store.has('ready');
    const [failed] = sdk.instances;
    failed.get.mockImplementationOnce(() => new Promise(() => {}));
    const assertion = expect(store.get('key')).rejects.toThrow('command timed out after 25 milliseconds');
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(failed.disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(await store.get('later')).toBe('hit');
    expect(sdk.instances).toHaveLength(2);
  });

  it('does not let a late failure from an old client reset a recovered client', async () => {
    const store = configure();
    await store.has('ready');
    const [old] = sdk.instances;
    let rejectOld: (error: Error) => void = () => {};
    old.get.mockImplementationOnce(() => new Promise((_accept, reject) => { rejectOld = reject; }));
    const pending = store.get('old');
    const assertion = expect(pending).rejects.toThrow('old command failed');
    await vi.waitFor(() => expect(old.get).toHaveBeenCalled());
    old.emit('error', new Error('old connection lost'));
    expect(await store.get('recovered')).toBe('hit');
    const recovered = sdk.instances[1];
    rejectOld(new Error('old command failed'));
    await assertion;
    expect(await store.has('still-ready')).toBe(true);
    expect(recovered.disconnect).not.toHaveBeenCalled();
    expect(sdk.instances).toHaveLength(2);
  });

  it('resets an ended owned client before the next operation', async () => {
    const store = configure();
    await store.get('first');
    sdk.instances[0].status = 'end';
    sdk.instances[0].emit('end');
    await store.get('second');
    expect(sdk.instances).toHaveLength(2);
  });

  it('preserves zero TTL, positive TTL and atomic command shapes', async () => {
    vi.useFakeTimers();
    const store = configure({ ttl: 30 });
    await store.put('zero', 'value', 0);
    await store.put('default', 'value');
    const [client] = sdk.instances;
    expect(client.set.mock.calls).toEqual([
      ['svelar_cache:zero', '{"value":"value"}'], ['svelar_cache:default', '{"value":"value"}', 'PX', 30_000],
    ]);
    client.eval.mockResolvedValueOnce([4, -1]).mockResolvedValueOnce([5, 123_456]);
    expect(await store.increment('counter')).toBe(4);
    expect(await store.incrementWithTtl('counter', 10)).toEqual({ value: 5, expiresAt: 123_456 });
    expect(await store.acquireLock('lock', 'owner', 10)).toBe(true);
    expect(await store.releaseLock('lock', 'owner')).toBe(true);
    client.get.mockResolvedValueOnce('{"value":"expected"}');
    expect(await store.compareAndSet('cas', 'expected', 'next', 10)).toBe(true);
    client.eval.mockResolvedValueOnce([[1, 1, 9, 123_456]]);
    expect(await store.reserveCapacity('budget', 10, 30)).toEqual({ allowed: true, value: 1, remaining: 9, expiresAt: 123_456 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['get', 'has', 'put', 'forget', 'flush', 'increment', 'incrementWithTtl', 'compareAndSet', 'acquireLock', 'releaseLock', 'reserveCapacity'] as const)(
    'propagates %s command failures and discards only its owned connection', async (operation) => {
      const store = configure();
      await store.has('ready');
      const [client] = sdk.instances;
      const error = new Error('Redis operation unavailable');
      client.get.mockRejectedValue(error); client.exists.mockRejectedValue(error); client.set.mockRejectedValue(error);
      client.del.mockRejectedValue(error); client.scan.mockRejectedValue(error); client.eval.mockRejectedValue(error);
      const calls = {
        get: () => store.get('key'), has: () => store.has('key'), put: () => store.put('key', 'value'),
        forget: () => store.forget('key'), flush: () => store.flush(), increment: () => store.increment('key'),
        incrementWithTtl: () => store.incrementWithTtl('key', 30), compareAndSet: () => store.compareAndSet('key', undefined, 'next'),
        acquireLock: () => store.acquireLock('key', 'owner', 30), releaseLock: () => store.releaseLock('key', 'owner'),
        reserveCapacity: () => store.reserveCapacity('key', 10, 30),
      };
      await expect(calls[operation]()).rejects.toBe(error);
      expect(client.disconnect).toHaveBeenCalledTimes(1);
    },
  );

  it('never mutates or disconnects a borrowed client, even when its operation fails', async () => {
    const get = vi.fn(async () => '{"value":"borrowed"}');
    const borrowed = Object.freeze({ get, connect: vi.fn(), disconnect: vi.fn(), on: vi.fn(), options: Object.freeze({}) });
    const store = configure({ client: borrowed, connectTimeoutMs: 0, commandTimeoutMs: 0 });
    expect(await store.get('key')).toBe('borrowed');
    const error = new Error('caller-owned outage');
    get.mockRejectedValueOnce(error);
    await expect(store.get('key')).rejects.toBe(error);
    expect(await store.get('later')).toBe('borrowed');
    expect(borrowed.connect).not.toHaveBeenCalled();
    expect(borrowed.disconnect).not.toHaveBeenCalled();
    expect(borrowed.on).not.toHaveBeenCalled();
    expect(borrowed.options).toEqual({});
    expect(sdk.instances).toHaveLength(0);
  });

  it('generates only config-driven Redis startup and command defaults', () => {
    const bootstrap = NewCommandTemplates.appTs();
    expect(bootstrap).toContain("connectTimeoutMs: config.get('cache.stores.redis.connectTimeoutMs', 2000)");
    expect(bootstrap).toContain("commandTimeoutMs: config.get('cache.stores.redis.commandTimeoutMs', 2000)");
  });
});
