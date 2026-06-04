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
  /** Redis cache: connection URL or config */
  url?: string;
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

// ── Memory Store ───────────────────────────────────────────

class MemoryCacheStore implements CacheStore {
  private store = new Map<string, CacheEntry>();

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
    this.store.set(key, {
      value,
      expiresAt: ttl ? Date.now() + ttl * 1000 : null,
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

  constructor(config: CacheStoreConfig) {
    this.basePath = config.path ?? 'storage/cache';
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
        await unlink(path).catch(() => {});
        return null;
      }
      return entry.value as T;
    } catch {
      return null;
    }
  }

  async put(key: string, value: any, ttl?: number): Promise<void> {
    const path = this.filePath(key);
    const entry: CacheEntry = {
      value,
      expiresAt: ttl ? Date.now() + ttl * 1000 : null,
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(entry));
  }

  async forget(key: string): Promise<boolean> {
    try {
      await unlink(this.filePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async flush(): Promise<void> {
    const { rm } = await import('node:fs/promises');
    await rm(this.basePath, { recursive: true, force: true });
    await mkdir(this.basePath, { recursive: true });
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
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
      case 'memory': return new MemoryCacheStore();
      case 'file': return new FileCacheStore(config);
      case 'null': return new NullCacheStore();
      case 'redis':
        throw new Error('Redis cache requires ioredis. Install: npm install ioredis');
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
