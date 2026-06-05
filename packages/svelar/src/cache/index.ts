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

import { readFile, writeFile, unlink, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

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
}

interface CacheEntry {
  value: any;
  expiresAt: number | null; // null = no expiry
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

// ── Memory Store ───────────────────────────────────────────

class MemoryCacheStore implements CacheStore {
  private store = new Map<string, CacheEntry>();

  constructor(private defaultTtl?: number) {}

  async get<T = any>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async put(key: string, value: any, ttl?: number): Promise<void> {
    const effectiveTtl = ttl ?? this.defaultTtl;
    this.store.set(key, {
      value,
      expiresAt: effectiveTtl ? Date.now() + effectiveTtl * 1000 : null,
    });
  }

  async forget(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async flush(): Promise<void> {
    this.store.clear();
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const newVal = current + amount;
    const entry = this.store.get(key);
    await this.put(key, newVal, entry?.expiresAt ? Math.ceil((entry.expiresAt - Date.now()) / 1000) : undefined);
    return newVal;
  }

  async decrement(key: string, amount: number = 1): Promise<number> {
    return this.increment(key, -amount);
  }
}

// ── File Store ─────────────────────────────────────────────

class FileCacheStore implements CacheStore {
  private basePath: string;
  private defaultTtl?: number;

  constructor(config: CacheStoreConfig) {
    this.basePath = config.path ?? 'storage/cache';
    this.defaultTtl = config.ttl;
  }

  private filePath(key: string): string {
    const hash = createHash('md5').update(key).digest('hex');
    return join(this.basePath, hash.slice(0, 2), hash);
  }

  async get<T = any>(key: string): Promise<T | null> {
    const path = this.filePath(key);
    try {
      const content = await readFile(path, 'utf-8');
      const entry: CacheEntry = JSON.parse(content);
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        await unlinkIfExists(path);
        return null;
      }
      return entry.value as T;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null;
      if (error instanceof SyntaxError) {
        await unlinkIfExists(path);
        return null;
      }
      throw error;
    }
  }

  async put(key: string, value: any, ttl?: number): Promise<void> {
    const path = this.filePath(key);
    const effectiveTtl = ttl ?? this.defaultTtl;
    const entry: CacheEntry = {
      value,
      expiresAt: effectiveTtl ? Date.now() + effectiveTtl * 1000 : null,
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(entry));
  }

  async forget(key: string): Promise<boolean> {
    try {
      await unlink(this.filePath(key));
      return true;
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error;
      return false;
    }
  }

  async flush(): Promise<void> {
    const { rm } = await import('node:fs/promises');
    await rm(this.basePath, { recursive: true, force: true });
    await mkdir(this.basePath, { recursive: true });
  }

  async has(key: string): Promise<boolean> {
    const path = this.filePath(key);
    try {
      const content = await readFile(path, 'utf-8');
      const entry: CacheEntry = JSON.parse(content);
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        await unlinkIfExists(path);
        return false;
      }
      return true;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return false;
      if (error instanceof SyntaxError) {
        await unlinkIfExists(path);
        return false;
      }
      throw error;
    }
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const newVal = current + amount;
    await this.put(key, newVal);
    return newVal;
  }

  async decrement(key: string, amount: number = 1): Promise<number> {
    return this.increment(key, -amount);
  }
}

// ── Redis Store ──────────────────────────────────────────────

class RedisCacheStore implements CacheStore {
  private redis?: any;
  private connecting?: Promise<any>;
  private url?: string;
  private connection?: Record<string, any>;
  private prefix: string;
  private defaultTtl?: number;

  constructor(config: CacheStoreConfig) {
    this.prefix = config.prefix ?? 'svelar_cache:';
    this.defaultTtl = config.ttl;
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
    if (this.redis) return this.redis;

    if (!this.connecting) {
      this.connecting = (async () => {
        try {
          const { default: Redis } = await import('ioredis' as string);
          this.redis = this.url ? new Redis(this.url) : new Redis(this.connection);
          return this.redis;
        } catch {
          throw new Error('Redis cache requires "ioredis" package. Install it: npm install ioredis');
        }
      })();
    }

    return this.connecting;
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
    const raw = await client.get(this.key(key));
    if (raw === null) return null;

    try {
      return this.deserialize<T>(raw);
    } catch {
      return raw as T;
    }
  }

  async put(key: string, value: any, ttl?: number): Promise<void> {
    const client = await this.getClient();
    const payload = this.serialize(value);
    const cacheKey = this.key(key);
    const effectiveTtl = ttl ?? this.defaultTtl;

    if (effectiveTtl && effectiveTtl > 0) {
      await client.set(cacheKey, payload, 'EX', Math.ceil(effectiveTtl));
      return;
    }

    await client.set(cacheKey, payload);
  }

  async forget(key: string): Promise<boolean> {
    const client = await this.getClient();
    return (await client.del(this.key(key))) > 0;
  }

  async flush(): Promise<void> {
    const client = await this.getClient();
    const pattern = `${this.prefix}*`;
    let cursor = '0';

    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } while (cursor !== '0');
  }

  async has(key: string): Promise<boolean> {
    const client = await this.getClient();
    return (await client.exists(this.key(key))) > 0;
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    const client = await this.getClient();
    const cacheKey = this.key(key);
    const [raw, ttlMs] = await Promise.all([client.get(cacheKey), client.pttl(cacheKey)]);
    const current = raw === null ? 0 : Number(this.safeDeserialize(raw));
    const newValue = current + amount;
    const payload = this.serialize(newValue);

    if (ttlMs > 0) {
      await client.set(cacheKey, payload, 'PX', ttlMs);
    } else {
      await client.set(cacheKey, payload);
    }

    return newValue;
  }

  async decrement(key: string, amount: number = 1): Promise<number> {
    return this.increment(key, -amount);
  }

  private safeDeserialize(raw: string): any {
    try {
      return this.deserialize(raw);
    } catch {
      return raw;
    }
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
