/**
 * Svelar Cache
 *
 * Laravel-inspired cache with memory, file, and Redis drivers.
 *
 * @example
 * ```ts
 * import { Cache } from '@beeblock/svelar/cache';
 *
 * Cache.configure({ default: 'memory', stores: { memory: { driver: 'memory' } } });
 *
 * await Cache.put('key', 'value', 3600); // 1 hour TTL
 * const value = await Cache.get('key', 'default');
 * await Cache.forget('key');
 *
 * // Remember pattern (fetch or compute)
 * const users = await Cache.remember('all-users', 600, async () => {
 *   return await User.all();
 * });
 * ```
 */

import { readFile, writeFile, unlink, readdir, mkdir, rename, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { serializeFileCache } from './FileSerialization.js';
import {
  CacheAtomicUnavailableError, MAX_CAPACITY_CLAIMS, capacityPlan, lockKey, serializedValue, ttlMilliseconds,
  validateAmount, validateAtomicKey, validateClaims, validateCompare, validateOwner,
  REDIS_COMPARE_SCRIPT, REDIS_ACQUIRE_SCRIPT, REDIS_RELEASE_SCRIPT, REDIS_CAPACITY_SCRIPT,
  type CacheCapacityRequest, type CacheCapacityResult,
} from './Atomic.js';

export { CacheAtomicUnavailableError };
export type { CacheCapacityRequest, CacheCapacityResult };

// ── Types ──────────────────────────────────────────────────

export type CacheDriver = 'memory' | 'file' | 'redis' | 'null';

export interface CacheStoreConfig {
  driver: CacheDriver;
  /** Default TTL in seconds */
  ttl?: number;
  /** File cache: directory path */
  path?: string;
  /** Redis cache: connection URL */
  url?: string;
  /** Redis cache: host (alternative to url) */
  host?: string;
  /** Redis cache: port (default: 6379) */
  port?: number;
  /** Redis cache: username for ACL auth */
  username?: string;
  /** Redis cache: password */
  password?: string;
  /** Redis cache: database index */
  db?: number;
  /** Redis cache: existing client instance */
  client?: any;
  /** Owned Redis client startup deadline in milliseconds (default: 2000, maximum: 30000). */
  connectTimeoutMs?: number;
  /** Owned Redis client command deadline in milliseconds (default: 2000, maximum: 30000). */
  commandTimeoutMs?: number;
  /** Key prefix */
  prefix?: string;
}

export interface CacheConfig {
  default: string;
  stores: Record<string, CacheStoreConfig>;
}

interface CacheStore {
  get<T = any>(key: string): Promise<T | null>;
  put(key: string, value: any, ttl?: number): Promise<void>;
  forget(key: string): Promise<boolean>;
  flush(): Promise<void>;
  has(key: string): Promise<boolean>;
  increment(key: string, amount?: number): Promise<number>;
  decrement(key: string, amount?: number): Promise<number>;
  incrementWithTtl(key: string, ttl: number, amount?: number): Promise<CacheIncrementResult>;
  /** JSON value equality; undefined expects absence. Omitted TTL preserves an existing expiry. */
  compareAndSet(key: string, expected: unknown, next: unknown, ttl?: number): Promise<boolean>;
  /** Use a fresh, unpredictable owner token for each lease; acquiring again does not renew. */
  acquireLock(key: string, owner: string, ttl: number): Promise<boolean>;
  releaseLock(key: string, owner: string): Promise<boolean>;
  reserveCapacity(key: string, capacity: number, ttl: number, amount?: number): Promise<CacheCapacityResult>;
  /** At most 16 distinct keys, all-or-none. Redis Cluster keys must share a hash slot. */
  reserveCapacityMany(claims: readonly CacheCapacityRequest[]): Promise<CacheCapacityResult[]>;
}

interface CacheEntry {
  value: any;
  expiresAt: number | null; // null = no expiry
}

export interface CacheIncrementResult {
  value: number;
  expiresAt: number | null;
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === code;
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
}

function expiry(ttl?: number): number | null {
  return ttl === undefined || ttl === 0 ? null : Date.now() + ttlMilliseconds(ttl);
}

function incrementValue(entry: CacheEntry | null, amount: number): number {
  const value = (Number(entry?.value) || 0) + amount;
  if (!Number.isSafeInteger(value)) throw new RangeError('Cache counter exceeds the safe integer range.');
  return value;
}

const REDIS_INCREMENT_SCRIPT = `
local timestamp = redis.call('TIME')
local now = tonumber(timestamp[1]) * 1000 + math.floor(tonumber(timestamp[2]) / 1000)
local raw = redis.call('GET', KEYS[1])
local current = 0

if raw then
  local ok, decoded = pcall(cjson.decode, raw)
  if ok and type(decoded) == 'table' and decoded['value'] ~= nil then
    current = tonumber(decoded['value']) or 0
  else
    current = tonumber(raw) or 0
  end
end

local value = current + tonumber(ARGV[1])
if value ~= math.floor(value) or math.abs(value) > 9007199254740991 then
  return redis.error_reply('Cache counter exceeds the safe integer range')
end
local ttl = tonumber(ARGV[2])
local existingTtl = redis.call('PTTL', KEYS[1])

if ttl > 0 then
  if existingTtl >= 0 then
    ttl = math.max(1, existingTtl)
  end
  redis.call('SET', KEYS[1], '{"value":' .. string.format('%.0f', value) .. '}', 'PX', ttl)
  return { value, now + ttl }
end

if existingTtl >= 0 then
  redis.call('SET', KEYS[1], '{"value":' .. string.format('%.0f', value) .. '}', 'PX', math.max(1, existingTtl))
  return { value, now + math.max(1, existingTtl) }
end

redis.call('SET', KEYS[1], '{"value":' .. string.format('%.0f', value) .. '}')
return { value, -1 }
`;

// ── Memory Store ───────────────────────────────────────────

class MemoryCacheStore implements CacheStore {
  private store = new Map<string, CacheEntry>();

  constructor(private defaultTtl?: number) {
    if (defaultTtl !== undefined) ttlMilliseconds(defaultTtl, true);
  }

  private liveEntry(key: string): CacheEntry | null {
    const entry = this.store.get(key);
    if (entry?.expiresAt !== null && entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry ?? null;
  }

  async get<T = any>(key: string): Promise<T | null> {
    const entry = this.liveEntry(key);
    return entry ? entry.value as T : null;
  }

  async put(key: string, value: any, ttl?: number): Promise<void> {
    const effectiveTtl = ttl ?? this.defaultTtl;
    this.store.set(key, {
      value,
      expiresAt: expiry(effectiveTtl),
    });
  }

  async forget(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async flush(): Promise<void> {
    this.store.clear();
  }

  async has(key: string): Promise<boolean> {
    return this.liveEntry(key) !== null;
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    validateAmount(amount);
    const entry = this.liveEntry(key);
    const value = incrementValue(entry, amount);
    this.store.set(key, { value, expiresAt: entry ? entry.expiresAt : expiry(this.defaultTtl) });
    return value;
  }

  async decrement(key: string, amount: number = 1): Promise<number> {
    return this.increment(key, -amount);
  }

  async incrementWithTtl(key: string, ttl: number, amount: number = 1): Promise<CacheIncrementResult> {
    validateAtomicKey(key);
    validateAmount(amount);
    const ttlMs = ttlMilliseconds(ttl);
    const existing = this.liveEntry(key);
    const expiresAt = existing?.expiresAt ?? Date.now() + ttlMs;
    const value = incrementValue(existing, amount);
    this.store.set(key, { value, expiresAt });
    return { value, expiresAt };
  }

  async compareAndSet(key: string, expected: unknown, next: unknown, ttl?: number): Promise<boolean> {
    validateCompare(key, expected, next, ttl);
    const entry = this.liveEntry(key);
    if (expected === undefined ? entry !== null : !entry || serializedValue(entry.value) !== serializedValue(expected)) return false;
    this.store.set(key, { value: JSON.parse(serializedValue(next)), expiresAt: ttl === undefined && entry ? entry.expiresAt : expiry(ttl ?? this.defaultTtl) });
    return true;
  }

  async acquireLock(key: string, owner: string, ttl: number): Promise<boolean> {
    validateAtomicKey(key); validateOwner(owner);
    const ttlMs = ttlMilliseconds(ttl);
    const internalKey = lockKey(key);
    if (this.liveEntry(internalKey)) return false;
    this.store.set(internalKey, { value: owner, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async releaseLock(key: string, owner: string): Promise<boolean> {
    validateAtomicKey(key); validateOwner(owner);
    const internalKey = lockKey(key);
    if (this.liveEntry(internalKey)?.value !== owner) return false;
    return this.store.delete(internalKey);
  }

  async reserveCapacity(key: string, capacity: number, ttl: number, amount = 1): Promise<CacheCapacityResult> {
    return (await this.reserveCapacityMany([{ key, capacity, ttl, amount }]))[0];
  }

  async reserveCapacityMany(claims: readonly CacheCapacityRequest[]): Promise<CacheCapacityResult[]> {
    validateClaims(claims);
    const result = capacityPlan(claims, claims.map((claim) => this.liveEntry(claim.key)), Date.now());
    if (result[0].allowed) claims.forEach((claim, index) => this.store.set(claim.key, { value: result[index].value, expiresAt: result[index].expiresAt }));
    return result;
  }
}

// ── File Store ─────────────────────────────────────────────

class FileCacheStore implements CacheStore {
  private basePath: string;
  private defaultTtl?: number;

  constructor(config: CacheStoreConfig) {
    this.basePath = config.path ?? 'storage/cache';
    this.defaultTtl = config.ttl;
    if (config.ttl !== undefined) ttlMilliseconds(config.ttl, true);
  }

  private filePath(key: string): string {
    const hash = createHash('md5').update(key).digest('hex');
    return join(this.basePath, hash.slice(0, 2), hash);
  }

  private async readEntry(key: string, assertOwned: () => void, strict = false): Promise<CacheEntry | null> {
    const path = this.filePath(key);
    try {
      const content = await readFile(path, 'utf-8');
      const entry: CacheEntry = JSON.parse(content);
      if (strict && (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, 'value') ||
        (entry.expiresAt !== null && (!Number.isSafeInteger(entry.expiresAt) || entry.expiresAt < 0)))) throw new TypeError('Invalid file-cache entry for atomic coordination.');
      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        assertOwned();
        await unlinkIfExists(path);
        return null;
      }
      return entry;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null;
      if (error instanceof SyntaxError) {
        if (strict) throw error;
        assertOwned();
        await unlinkIfExists(path);
        return null;
      }
      throw error;
    }
  }

  private async writeAtomic(path: string, content: string, assertOwned: () => void): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      assertOwned();
      await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      assertOwned();
      await rename(temporary, path);
    } finally {
      await unlinkIfExists(temporary);
    }
  }

  private journalPath(): string { return join(this.basePath, '.atomic-reservations.json'); }

  private async recover(assertOwned: () => void): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.journalPath(), 'utf-8');
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return;
      throw error;
    }
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_CAPACITY_CLAIMS) throw new Error('Invalid file-cache reservation journal.');
    const entries: { key: string; value: number; expiresAt: number }[] = [];
    const keys = new Set<string>();
    for (const item of parsed as unknown[]) {
      if (!item || typeof item !== 'object') throw new Error('Invalid file-cache reservation journal.');
      const record = item as Record<string, unknown>;
      if (typeof record.key !== 'string' || typeof record.value !== 'number' || typeof record.expiresAt !== 'number' ||
        !Number.isSafeInteger(record.value) || record.value < 0 || !Number.isSafeInteger(record.expiresAt) || record.expiresAt < 0 || keys.has(record.key)) throw new Error('Invalid file-cache reservation journal.');
      validateAtomicKey(record.key);
      keys.add(record.key);
      entries.push({ key: record.key, value: record.value, expiresAt: record.expiresAt });
    }
    // Publishing one journal commits the whole batch. Every observer replays it under the same lock.
    for (const item of entries) {
      await this.writeAtomic(this.filePath(item.key), JSON.stringify({ value: item.value, expiresAt: item.expiresAt }), assertOwned);
    }
    assertOwned();
    await unlinkIfExists(this.journalPath());
  }

  private async serialized<T>(operation: (assertOwned: () => void) => Promise<T>): Promise<T> {
    return serializeFileCache(this.basePath, async (assertOwned) => {
      await this.recover(assertOwned);
      assertOwned();
      return operation(assertOwned);
    });
  }

  async get<T = any>(key: string): Promise<T | null> {
    return this.serialized(async (guard) => {
      const entry = await this.readEntry(key, guard);
      return entry ? entry.value as T : null;
    });
  }

  async put(key: string, value: any, ttl?: number): Promise<void> {
    if (ttl !== undefined) ttlMilliseconds(ttl, true);
    return this.serialized((guard) => this.writeAtomic(this.filePath(key), JSON.stringify({ value, expiresAt: expiry(ttl ?? this.defaultTtl) }), guard));
  }

  async forget(key: string): Promise<boolean> {
    return this.serialized(async (guard) => {
      try {
        guard();
        await unlink(this.filePath(key));
        return true;
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error;
        return false;
      }
    });
  }

  async flush(): Promise<void> {
    return this.serialized(async (guard) => {
      for (const name of await readdir(this.basePath)) {
        guard();
        await rm(join(this.basePath, name), { recursive: true, force: true });
      }
    });
  }

  async has(key: string): Promise<boolean> {
    return this.serialized(async (guard) => (await this.readEntry(key, guard)) !== null);
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    validateAmount(amount);
    return this.serialized(async (guard) => {
      const entry = await this.readEntry(key, guard, true);
      const value = incrementValue(entry, amount);
      await this.writeAtomic(this.filePath(key), JSON.stringify({ value, expiresAt: entry ? entry.expiresAt : expiry(this.defaultTtl) }), guard);
      return value;
    });
  }

  async decrement(key: string, amount: number = 1): Promise<number> {
    return this.increment(key, -amount);
  }

  async incrementWithTtl(key: string, ttl: number, amount: number = 1): Promise<CacheIncrementResult> {
    validateAtomicKey(key); validateAmount(amount);
    const ttlMs = ttlMilliseconds(ttl);
    return this.serialized(async (guard) => {
      const entry = await this.readEntry(key, guard, true);
      const result = { value: incrementValue(entry, amount), expiresAt: entry?.expiresAt ?? Date.now() + ttlMs };
      await this.writeAtomic(this.filePath(key), JSON.stringify(result), guard);
      return result;
    });
  }

  async compareAndSet(key: string, expected: unknown, next: unknown, ttl?: number): Promise<boolean> {
    validateCompare(key, expected, next, ttl);
    const expectedValue = expected === undefined ? undefined : serializedValue(expected);
    const nextValue = serializedValue(next);
    return this.serialized(async (guard) => {
      const entry = await this.readEntry(key, guard, true);
      if (expectedValue === undefined ? entry !== null : !entry || serializedValue(entry.value) !== expectedValue) return false;
      const expiresAt = ttl === undefined && entry ? entry.expiresAt : expiry(ttl ?? this.defaultTtl);
      await this.writeAtomic(this.filePath(key), JSON.stringify({ value: JSON.parse(nextValue), expiresAt }), guard);
      return true;
    });
  }

  async acquireLock(key: string, owner: string, ttl: number): Promise<boolean> {
    validateAtomicKey(key); validateOwner(owner);
    const ttlMs = ttlMilliseconds(ttl);
    return this.serialized(async (guard) => {
      const internalKey = lockKey(key);
      if (await this.readEntry(internalKey, guard, true)) return false;
      await this.writeAtomic(this.filePath(internalKey), JSON.stringify({ value: owner, expiresAt: Date.now() + ttlMs }), guard);
      return true;
    });
  }

  async releaseLock(key: string, owner: string): Promise<boolean> {
    validateAtomicKey(key); validateOwner(owner);
    return this.serialized(async (guard) => {
      const internalKey = lockKey(key);
      if ((await this.readEntry(internalKey, guard, true))?.value !== owner) return false;
      guard();
      await unlink(this.filePath(internalKey));
      return true;
    });
  }

  async reserveCapacity(key: string, capacity: number, ttl: number, amount = 1): Promise<CacheCapacityResult> {
    return (await this.reserveCapacityMany([{ key, capacity, ttl, amount }]))[0];
  }

  async reserveCapacityMany(claims: readonly CacheCapacityRequest[]): Promise<CacheCapacityResult[]> {
    validateClaims(claims);
    claims = claims.map((claim) => ({ ...claim }));
    return this.serialized(async (guard) => {
    const entries: (CacheEntry | null)[] = [];
      for (const claim of claims) entries.push(await this.readEntry(claim.key, guard, true));
      const result = capacityPlan(claims, entries, Date.now());
      if (result[0].allowed) {
        const journal = claims.map((claim, index) => ({ key: claim.key, value: result[index].value, expiresAt: result[index].expiresAt }));
        await this.writeAtomic(this.journalPath(), JSON.stringify(journal), guard);
        await this.recover(guard);
      }
      return result;
    });
  }
}

// ── Redis Store ──────────────────────────────────────────────

function redisTimeout(value: number | undefined, name: string): number {
  const timeout = value ?? 2000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) {
    throw new RangeError(`Redis cache ${name} must be an integer between 1 and 30000 milliseconds.`);
  }
  return timeout;
}

class RedisCacheStore implements CacheStore {
  private redis?: any;
  private connecting?: Promise<any>;
  private url?: string;
  private connection?: Record<string, any>;
  private prefix: string;
  private defaultTtl?: number;
  private readonly owned: boolean;
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;

  constructor(config: CacheStoreConfig) {
    this.prefix = config.prefix ?? 'svelar_cache:';
    this.defaultTtl = config.ttl;
    if (config.ttl !== undefined) ttlMilliseconds(config.ttl, true);
    this.owned = !config.client;
    this.connectTimeoutMs = this.owned ? redisTimeout(config.connectTimeoutMs, 'connectTimeoutMs') : 2000;
    this.commandTimeoutMs = this.owned ? redisTimeout(config.commandTimeoutMs, 'commandTimeoutMs') : 2000;
    if (config.client) {
      this.redis = config.client;
    } else {
      this.url = config.url;
      this.connection = {
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        username: config.username,
        password: config.password,
        db: config.db ?? 0,
      };
    }
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  private async getClient(): Promise<any> {
    if (!this.owned) return this.redis;
    if (this.connecting) return this.connecting;
    if (this.redis?.status === 'ready') return this.redis;
    if (this.redis) this.discard(this.redis);

    const opening = this.openClient();
    this.connecting = opening;
    try {
      return await opening;
    } finally {
      if (this.connecting === opening) this.connecting = undefined;
    }
  }

  private async openClient(): Promise<CacheStoreConfig['client']> {
    const { default: Redis } = await import('ioredis' as string).catch((cause: unknown) => {
      throw new Error('Redis cache requires "ioredis" package. Install it: npm install ioredis', { cause });
    });
    const options = {
      ...this.connection,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: this.connectTimeoutMs,
      commandTimeout: this.commandTimeoutMs,
      // Late SDK readiness failures can schedule another disconnect guard after socket close.
      disconnectTimeout: 1,
      retryStrategy: () => null,
      autoResendUnfulfilledCommands: false,
    };
    const client = this.url ? new Redis(this.url, options) : new Redis(options);
    let connectionError: unknown;
    // The operation reports failures; the listener also prevents SDK error-event spam.
    client.on('error', (error: unknown) => {
      connectionError = error;
      if (this.redis === client) this.discard(client);
    });
    client.on('end', () => {
      if (this.redis === client) this.redis = undefined;
    });
    try {
      await this.bounded(client.connect(), this.connectTimeoutMs, 'connect');
      if (client.status !== 'ready') throw connectionError ?? new Error('Redis cache connection did not become ready.');
      this.redis = client;
      return client;
    } catch (error) {
      this.discard(client);
      throw connectionError ?? error;
    }
  }

  private discard(client: CacheStoreConfig['client']): void {
    if (this.redis === client) this.redis = undefined;
    if (client.status !== 'end') client.disconnect();
    // ioredis disconnect() can wait for a half-open peer; failures must release owned sockets now.
    client.stream?.destroy();
  }

  private async bounded<T>(operation: Promise<T>, timeoutMs: number, stage: 'connect' | 'command'): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Redis cache ${stage} timed out after ${timeoutMs} milliseconds.`)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async command<T>(client: CacheStoreConfig['client'], operation: () => Promise<T>): Promise<T> {
    if (!this.owned) return operation();
    try {
      return await this.bounded(operation(), this.commandTimeoutMs, 'command');
    } catch (error) {
      this.discard(client);
      throw error;
    }
  }

  private serialize(value: any): string {
    return JSON.stringify({ value });
  }

  private deserialize<T = any>(raw: string): T {
    const parsed = JSON.parse(raw);
    return parsed.value as T;
  }

  async get<T = any>(key: string): Promise<T | null> {
    const client = await this.getClient();
    const raw = await this.command<string | null>(client, () => client.get(this.key(key)));
    if (raw === null) return null;

    try {
      return this.deserialize<T>(raw);
    } catch {
      return raw as T;
    }
  }

  async put(key: string, value: any, ttl?: number): Promise<void> {
    const effectiveTtl = ttl ?? this.defaultTtl;
    const ttlMs = effectiveTtl === undefined ? 0 : ttlMilliseconds(effectiveTtl, true);
    const client = await this.getClient();
    const payload = this.serialize(value);
    const cacheKey = this.key(key);
    if (ttlMs > 0) {
      await this.command(client, () => client.set(cacheKey, payload, 'PX', ttlMs));
      return;
    }

    await this.command(client, () => client.set(cacheKey, payload));
  }

  async forget(key: string): Promise<boolean> {
    const client = await this.getClient();
    return (await this.command<number>(client, () => client.del(this.key(key)))) > 0;
  }

  async flush(): Promise<void> {
    const client = await this.getClient();
    const pattern = `${this.prefix}*`;
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.command<[string, string[]]>(client, () => client.scan(cursor, 'MATCH', pattern, 'COUNT', 100));
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.command(client, () => client.del(...keys));
      }
    } while (cursor !== '0');
  }

  async has(key: string): Promise<boolean> {
    const client = await this.getClient();
    return (await this.command<number>(client, () => client.exists(this.key(key)))) > 0;
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    validateAmount(amount);
    const client = await this.getClient();
    const cacheKey = this.key(key);
    const [value] = await this.command<[number, number]>(client, () => client.eval(
      REDIS_INCREMENT_SCRIPT,
      1,
      cacheKey,
      String(amount),
      '0',
    ));
    return Number(value);
  }

  async decrement(key: string, amount: number = 1): Promise<number> {
    return this.increment(key, -amount);
  }

  async incrementWithTtl(key: string, ttl: number, amount: number = 1): Promise<CacheIncrementResult> {
    validateAtomicKey(key); validateAmount(amount);
    const ttlDuration = ttlMilliseconds(ttl);
    const client = await this.getClient();
    const cacheKey = this.key(key);
    const [value, expiration] = await this.command<[number, number]>(client, () => client.eval(
      REDIS_INCREMENT_SCRIPT,
      1,
      cacheKey,
      String(amount),
      String(ttlDuration),
    ));

    const expiresAt = Number(expiration) > 0 ? Number(expiration) : null;
    return { value: Number(value), expiresAt };
  }

  async compareAndSet(key: string, expected: unknown, next: unknown, ttl?: number): Promise<boolean> {
    validateCompare(key, expected, next, ttl);
    const expectedValue = expected === undefined ? undefined : serializedValue(expected);
    const payload = `{"value":${serializedValue(next)}}`;
    const ttlMs = ttl === undefined ? -1 : ttlMilliseconds(ttl);
    const client = await this.getClient();
    let raw = '';
    if (expectedValue !== undefined) {
      const observed = await this.command<string | null>(client, () => client.get(this.key(key)));
      if (observed === null || Buffer.byteLength(observed) > 1_048_600) return false;
      try {
        if (serializedValue(this.deserialize(observed)) !== expectedValue) return false;
      } catch { return false; }
      raw = observed;
    }
    // Compare the exact observed bytes inside Lua, never an unguarded GET/SET pair.
    const effectiveTtl = expectedValue === undefined && ttl === undefined
      ? (this.defaultTtl ? ttlMilliseconds(this.defaultTtl) : -1) : ttlMs;
    return Number(await this.command(client, () => client.eval(REDIS_COMPARE_SCRIPT, 1, this.key(key), expectedValue === undefined ? 'missing' : 'value', raw, payload, String(effectiveTtl)))) === 1;
  }

  async acquireLock(key: string, owner: string, ttl: number): Promise<boolean> {
    validateAtomicKey(key); validateOwner(owner);
    const ttlMs = ttlMilliseconds(ttl);
    const client = await this.getClient();
    return Number(await this.command(client, () => client.eval(REDIS_ACQUIRE_SCRIPT, 1, this.key(lockKey(key)), this.serialize(owner), String(ttlMs)))) === 1;
  }

  async releaseLock(key: string, owner: string): Promise<boolean> {
    validateAtomicKey(key); validateOwner(owner);
    const client = await this.getClient();
    return Number(await this.command(client, () => client.eval(REDIS_RELEASE_SCRIPT, 1, this.key(lockKey(key)), this.serialize(owner)))) === 1;
  }

  async reserveCapacity(key: string, capacity: number, ttl: number, amount = 1): Promise<CacheCapacityResult> {
    return (await this.reserveCapacityMany([{ key, capacity, ttl, amount }]))[0];
  }

  async reserveCapacityMany(claims: readonly CacheCapacityRequest[]): Promise<CacheCapacityResult[]> {
    validateClaims(claims);
    const keys = claims.map((claim) => this.key(claim.key));
    const args = claims.flatMap((claim) => [String(claim.capacity), String(ttlMilliseconds(claim.ttl)), String(claim.amount ?? 1)]);
    const client = await this.getClient();
    const raw = await this.command<[number, number, number, number][]>(client, () => client.eval(REDIS_CAPACITY_SCRIPT, keys.length, ...keys, ...args));
    return raw.map(([allowed, value, remaining, expiration]) => ({
      allowed: Number(allowed) === 1, value: Number(value), remaining: Number(remaining),
      expiresAt: Number(expiration) >= 0 ? Number(expiration) : null,
    }));
  }
}

// ── Null Store ─────────────────────────────────────────────

class NullCacheStore implements CacheStore {
  async get(): Promise<null> { return null; }
  async put(): Promise<void> {}
  async forget(): Promise<boolean> { return true; }
  async flush(): Promise<void> {}
  async has(): Promise<boolean> { return false; }
  async increment(): Promise<number> { return 0; }
  async decrement(): Promise<number> { return 0; }
  async incrementWithTtl(key: string, ttl: number, amount = 1): Promise<CacheIncrementResult> {
    validateAtomicKey(key); ttlMilliseconds(ttl); validateAmount(amount);
    throw new CacheAtomicUnavailableError();
  }
  async compareAndSet(key: string, expected: unknown, next: unknown, ttl?: number): Promise<boolean> {
    validateCompare(key, expected, next, ttl);
    throw new CacheAtomicUnavailableError();
  }
  async acquireLock(key: string, owner: string, ttl: number): Promise<boolean> {
    validateAtomicKey(key); validateOwner(owner); ttlMilliseconds(ttl);
    throw new CacheAtomicUnavailableError();
  }
  async releaseLock(key: string, owner: string): Promise<boolean> {
    validateAtomicKey(key); validateOwner(owner);
    throw new CacheAtomicUnavailableError();
  }
  async reserveCapacity(key: string, capacity: number, ttl: number, amount = 1): Promise<CacheCapacityResult> {
    return (await this.reserveCapacityMany([{ key, capacity, ttl, amount }]))[0];
  }
  async reserveCapacityMany(claims: readonly CacheCapacityRequest[]): Promise<CacheCapacityResult[]> {
    validateClaims(claims);
    throw new CacheAtomicUnavailableError();
  }
}

// ── Cache Manager ──────────────────────────────────────────

class CacheManager {
  private config: CacheConfig = {
    default: 'memory',
    stores: { memory: { driver: 'memory' } },
  };
  private stores = new Map<string, CacheStore>();

  configure(config: CacheConfig): void {
    this.config = config;
    this.stores.clear();
  }

  store(name?: string): CacheStore {
    const storeName = name ?? this.config.default;
    if (this.stores.has(storeName)) return this.stores.get(storeName)!;

    const storeConfig = this.config.stores[storeName];
    if (!storeConfig) throw new Error(`Cache store "${storeName}" is not defined.`);

    const store = this.createStore(storeConfig);
    this.stores.set(storeName, store);
    return store;
  }

  // Proxy methods to default store
  async get<T = any>(key: string, defaultValue?: T): Promise<T | null> {
    const store = this.store();
    if (await store.has(key)) {
      return store.get<T>(key);
    }
    return (defaultValue ?? null) as T | null;
  }

  async put(key: string, value: any, ttl?: number): Promise<void> {
    return this.store().put(key, value, ttl ?? this.config.stores[this.config.default]?.ttl);
  }

  async forget(key: string): Promise<boolean> { return this.store().forget(key); }
  async flush(): Promise<void> { return this.store().flush(); }
  async has(key: string): Promise<boolean> { return this.store().has(key); }
  async increment(key: string, amount?: number): Promise<number> { return this.store().increment(key, amount); }
  async decrement(key: string, amount?: number): Promise<number> { return this.store().decrement(key, amount); }
  async incrementWithTtl(key: string, ttl: number, amount?: number): Promise<CacheIncrementResult> {
    return this.store().incrementWithTtl(key, ttl, amount);
  }
  async compareAndSet(key: string, expected: unknown, next: unknown, ttl?: number): Promise<boolean> {
    return this.store().compareAndSet(key, expected, next, ttl);
  }
  async acquireLock(key: string, owner: string, ttl: number): Promise<boolean> { return this.store().acquireLock(key, owner, ttl); }
  async releaseLock(key: string, owner: string): Promise<boolean> { return this.store().releaseLock(key, owner); }
  async reserveCapacity(key: string, capacity: number, ttl: number, amount?: number): Promise<CacheCapacityResult> {
    return this.store().reserveCapacity(key, capacity, ttl, amount);
  }
  async reserveCapacityMany(claims: readonly CacheCapacityRequest[]): Promise<CacheCapacityResult[]> {
    return this.store().reserveCapacityMany(claims);
  }

  /**
   * Get or compute a cached value
   */
  async remember<T>(key: string, ttl: number, callback: () => T | Promise<T>): Promise<T> {
    const cached = await this.store().get<T>(key);
    if (cached !== null) return cached;

    const value = await callback();
    await this.store().put(key, value, ttl);
    return value;
  }

  /**
   * Get or compute, caching forever
   */
  async rememberForever<T>(key: string, callback: () => T | Promise<T>): Promise<T> {
    const cached = await this.store().get<T>(key);
    if (cached !== null) return cached;

    const value = await callback();
    await this.store().put(key, value);
    return value;
  }

  /**
   * Get and delete
   */
  async pull<T = any>(key: string, defaultValue?: T): Promise<T | null> {
    const value = await this.get<T>(key, defaultValue);
    await this.forget(key);
    return value;
  }

  private createStore(config: CacheStoreConfig): CacheStore {
    switch (config.driver) {
      case 'memory': return new MemoryCacheStore(config.ttl);
      case 'file': return new FileCacheStore(config);
      case 'null': return new NullCacheStore();
      case 'redis': return new RedisCacheStore(config);
      default:
        throw new Error(`Unknown cache driver: ${config.driver}`);
    }
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global Cache singleton
 */
export const Cache = singleton('svelar.cache', () => new CacheManager());

export type { CacheStore };
