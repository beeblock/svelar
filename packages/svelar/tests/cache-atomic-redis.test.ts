import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cache, type CacheStore } from '../src/cache/index';
import { HttpClient, HttpBudgetExceededError } from '../src/http/index';
import { interceptHttpForTesting } from '../src/http/index';
import { atomicContract } from './cache-atomic-contract';

interface RedisClient {
  ping(): Promise<string>;
  quit(): Promise<string>;
  disconnect(): void;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  pttl(key: string): Promise<number>;
}

// Set URL explicitly: never connect to a developer's default Redis or flush another namespace.
describe.skipIf(!process.env.SVELAR_TEST_REDIS_URL)('real Redis atomic coordination', () => {
  const clients: RedisClient[] = [];
  let store: CacheStore;
  let client: RedisClient;
  let peer: RedisClient;
  let prefix: string;
  let redisStores: CacheStore[] = [];

  beforeAll(async () => {
    const require = createRequire(process.env.SVELAR_TEST_REDIS_CLIENT ?? resolve('package.json'));
    const Redis = require('ioredis') as new (url: string, options: { maxRetriesPerRequest: number; connectTimeout: number }) => RedisClient;
    client = new Redis(process.env.SVELAR_TEST_REDIS_URL!, { maxRetriesPerRequest: 1, connectTimeout: 3000 });
    peer = new Redis(process.env.SVELAR_TEST_REDIS_URL!, { maxRetriesPerRequest: 1, connectTimeout: 3000 });
    clients.push(client, peer);
    await client.ping();
    await peer.ping();
  });

  beforeEach(() => {
    prefix = `svelar_atomic_test:${randomUUID()}:`;
    Cache.configure({ default: 'redis', stores: { redis: { driver: 'redis', client, prefix }, peer: { driver: 'redis', client: peer, prefix } } });
    store = Cache.store();
    redisStores.push(store);
  });

  afterAll(async () => {
    const results = await Promise.allSettled(redisStores.map((item) => item.flush()));
    redisStores = [];
    const closed = await Promise.allSettled(clients.map((item) => item.quit()));
    clients.forEach((item) => item.disconnect());
    const errors = [...results, ...closed].filter((result) => result.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map((result) => result.status === 'rejected' ? result.reason : undefined), 'Redis test cleanup failed.');
  });

  atomicContract('Redis Lua', () => store);

  it('coordinates independent Redis clients with one TTL and no partial consumption', async () => {
    const other = Cache.store('peer');
    const claims = [{ key: '{independent}:one', capacity: 37, ttl: 60 }, { key: '{independent}:two', capacity: 500, ttl: 60 }];
    const results = await Promise.all(Array.from({ length: 1000 }, (_, index) => (index % 2 ? store : other).reserveCapacityMany(claims)));
    expect(results.filter((result) => result[0].allowed)).toHaveLength(37);
    expect(await store.get(claims[0].key)).toBe(37);
    expect(await other.get(claims[1].key)).toBe(37);
    expect(await client.pttl(prefix + claims[0].key)).toBeGreaterThan(55_000);
    expect(await client.pttl(prefix + claims[1].key)).toBeGreaterThan(55_000);
  });

  it('uses atomic raw-byte CAS for legacy unordered JSON and rejects a changed observation', async () => {
    await client.set(prefix + 'legacy', '{"value":{"z":2,"a":1}}');
    expect(await store.compareAndSet('legacy', { a: 1, z: 2 }, 'new', 60)).toBe(true);
    const other = Cache.store('peer');
    const results = await Promise.all(Array.from({ length: 100 }, (_, index) => (index % 2 ? store : other).compareAndSet('legacy', 'new', `owner-${index}`)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await client.pttl(prefix + 'legacy')).toBeGreaterThan(55_000);
  });

  it('shares credential/account HTTP budgets across clients using the distributed store', async () => {
    let sent = 0;
    const release = interceptHttpForTesting(() => ({ fetch: async () => { sent++; return new Response('ok'); }, circuitBreakerStates: new Map() }));
    try {
      const namespace = randomUUID();
      const clients = [store, Cache.store('peer')].map((item) => new HttpClient({ budget: {
        store: item, namespace, limits: [{ scope: 'credential', key: 'secret', limit: 25, window: 60 }, { scope: 'account', key: 'account', limit: 7, window: 60 }],
      } }));
      const results = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => clients[index % 2].get('https://provider.test/distributed')));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(7);
      expect(results.filter((result) => result.status === 'rejected').every((result) => result.status === 'rejected' && result.reason instanceof HttpBudgetExceededError)).toBe(true);
      expect(sent).toBe(7);
    } finally { release(); }
  });
});
