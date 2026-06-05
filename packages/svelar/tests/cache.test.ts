import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import { Cache } from '../src/cache/index';

function fileCachePath(root: string, key: string): string {
  const hash = createHash('md5').update(key).digest('hex');
  return join(root, hash.slice(0, 2), hash);
}

describe('CacheManager (Memory Store)', () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    Cache.configure({
      default: 'memory',
      stores: {
        memory: { driver: 'memory' },
      },
    });
  });

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  describe('get', () => {
    it('should retrieve a cached value', async () => {
      await Cache.put('key', 'value');
      const result = await Cache.get('key');

      expect(result).toBe('value');
    });

    it('should return null for missing key', async () => {
      const result = await Cache.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should return default value if key missing', async () => {
      const result = await Cache.get('missing', 'default');

      expect(result).toBe('default');
    });

    it('should support typed retrieval', async () => {
      const data = { name: 'John', age: 30 };
      await Cache.put('user', data);

      const result = await Cache.get<typeof data>('user');

      expect(result).toEqual(data);
      expect(result?.name).toBe('John');
    });

    it('should return null for expired keys', async () => {
      await Cache.put('key', 'value', 1); // 1 second TTL

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 1100));

      const result = await Cache.get('key');
      expect(result).toBeNull();
    });

    it('should handle complex objects', async () => {
      const obj = {
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
        date: new Date().toISOString(),
      };

      await Cache.put('complex', obj);
      const result = await Cache.get('complex');

      expect(result).toEqual(obj);
    });
  });

  describe('put', () => {
    it('should store a value', async () => {
      await Cache.put('key', 'value');
      const result = await Cache.get('key');

      expect(result).toBe('value');
    });

    it('should store with TTL', async () => {
      await Cache.put('key', 'value', 3600); // 1 hour

      const result = await Cache.get('key');
      expect(result).toBe('value');
    });

    it('should apply store default TTL through the manager and direct store access', async () => {
      Cache.configure({
        default: 'memory',
        stores: {
          memory: { driver: 'memory', ttl: 1 },
          other: { driver: 'memory', ttl: 1 },
        },
      });

      await Cache.put('manager-key', 'value');
      await Cache.store('other').put('store-key', 'value');

      await new Promise((r) => setTimeout(r, 1100));

      expect(await Cache.get('manager-key')).toBeNull();
      expect(await Cache.store('other').get('store-key')).toBeNull();
    });

    it('should overwrite existing key', async () => {
      await Cache.put('key', 'first');
      await Cache.put('key', 'second');

      const result = await Cache.get('key');
      expect(result).toBe('second');
    });

    it('should handle null values', async () => {
      await Cache.put('null-key', null);
      const result = await Cache.get('null-key', 'default');

      expect(result).toBeNull();
    });

    it('should handle boolean values', async () => {
      await Cache.put('bool-true', true);
      await Cache.put('bool-false', false);

      expect(await Cache.get('bool-true')).toBe(true);
      expect(await Cache.get('bool-false')).toBe(false);
    });

    it('should handle zero and empty string', async () => {
      await Cache.put('zero', 0);
      await Cache.put('empty', '');

      expect(await Cache.get('zero')).toBe(0);
      expect(await Cache.get('empty')).toBe('');
    });
  });

  describe('forget', () => {
    it('should remove a key', async () => {
      await Cache.put('key', 'value');
      await Cache.forget('key');

      const result = await Cache.get('key');
      expect(result).toBeNull();
    });

    it('should return true if key was deleted', async () => {
      await Cache.put('key', 'value');
      const result = await Cache.forget('key');

      expect(result).toBe(true);
    });

    it('should return false if key did not exist', async () => {
      const result = await Cache.forget('nonexistent');

      expect(result).toBe(false);
    });

    it('should handle multiple forgets', async () => {
      await Cache.put('key1', 'value1');
      await Cache.put('key2', 'value2');

      await Cache.forget('key1');

      expect(await Cache.get('key1')).toBeNull();
      expect(await Cache.get('key2')).toBe('value2');
    });
  });

  describe('flush', () => {
    it('should clear all cached values', async () => {
      await Cache.put('key1', 'value1');
      await Cache.put('key2', 'value2');

      await Cache.flush();

      expect(await Cache.get('key1')).toBeNull();
      expect(await Cache.get('key2')).toBeNull();
    });

    it('should work after flush', async () => {
      await Cache.put('key', 'value1');
      await Cache.flush();
      await Cache.put('key', 'value2');

      expect(await Cache.get('key')).toBe('value2');
    });
  });

  describe('has', () => {
    it('should return true if key exists', async () => {
      await Cache.put('key', 'value');

      expect(await Cache.has('key')).toBe(true);
    });

    it('should return false if key does not exist', async () => {
      expect(await Cache.has('nonexistent')).toBe(false);
    });

    it('should return false for expired keys', async () => {
      await Cache.put('key', 'value', 1); // 1 second TTL

      await new Promise((r) => setTimeout(r, 1100));

      expect(await Cache.has('key')).toBe(false);
    });
  });

  describe('increment', () => {
    it('should increment a numeric value', async () => {
      await Cache.put('counter', 10);
      const result = await Cache.increment('counter');

      expect(result).toBe(11);
    });

    it('should increment by custom amount', async () => {
      await Cache.put('counter', 10);
      const result = await Cache.increment('counter', 5);

      expect(result).toBe(15);
    });

    it('should default to incrementing by 1', async () => {
      await Cache.put('count', 5);

      const result1 = await Cache.increment('count');
      const result2 = await Cache.increment('count');

      expect(result1).toBe(6);
      expect(result2).toBe(7);
    });

    it('should initialize to 1 if key does not exist', async () => {
      const result = await Cache.increment('new-counter');

      expect(result).toBe(1);
    });

    it('should preserve TTL during increment', async () => {
      await Cache.put('counter', 5, 60); // 60 second TTL
      await Cache.increment('counter', 10);

      // Value should be updated
      expect(await Cache.get('counter')).toBe(15);

      // And still be cached (not expired immediately)
      expect(await Cache.has('counter')).toBe(true);
    });
  });

  describe('decrement', () => {
    it('should decrement a numeric value', async () => {
      await Cache.put('counter', 10);
      const result = await Cache.decrement('counter');

      expect(result).toBe(9);
    });

    it('should decrement by custom amount', async () => {
      await Cache.put('counter', 20);
      const result = await Cache.decrement('counter', 5);

      expect(result).toBe(15);
    });

    it('should handle negative results', async () => {
      await Cache.put('counter', 5);
      const result = await Cache.decrement('counter', 10);

      expect(result).toBe(-5);
    });

    it('should initialize to -1 if key does not exist', async () => {
      const result = await Cache.decrement('new-counter');

      expect(result).toBe(-1);
    });
  });

  describe('remember', () => {
    it('should return cached value if exists', async () => {
      await Cache.put('users', [{ id: 1 }]);

      let callCount = 0;
      const result = await Cache.remember('users', 3600, async () => {
        callCount++;
        return [{ id: 2 }];
      });

      expect(result).toEqual([{ id: 1 }]);
      expect(callCount).toBe(0);
    });

    it('should compute and cache if not exists', async () => {
      let callCount = 0;
      const result = await Cache.remember('key', 3600, async () => {
        callCount++;
        return { data: 'computed' };
      });

      expect(result).toEqual({ data: 'computed' });
      expect(callCount).toBe(1);

      // Subsequent calls should use cache
      const result2 = await Cache.remember('key', 3600, async () => {
        callCount++;
        return { data: 'different' };
      });

      expect(result2).toEqual({ data: 'computed' });
      expect(callCount).toBe(1);
    });

    it('should support sync callbacks', async () => {
      const result = await Cache.remember('key', 3600, () => 'sync-value');

      expect(result).toBe('sync-value');
    });

    it('should use specified TTL', async () => {
      const result = await Cache.remember('key', 1, () => 'value');

      expect(result).toBe('value');

      await new Promise((r) => setTimeout(r, 1100));

      const cached = await Cache.get('key');
      expect(cached).toBeNull();
    });
  });

  describe('rememberForever', () => {
    it('should cache without expiration', async () => {
      let callCount = 0;

      const result = await Cache.rememberForever('key', async () => {
        callCount++;
        return 'value';
      });

      expect(result).toBe('value');
      expect(callCount).toBe(1);

      // Cache should persist
      const result2 = await Cache.rememberForever('key', async () => {
        callCount++;
        return 'different';
      });

      expect(result2).toBe('value');
      expect(callCount).toBe(1);
    });

    it('should return cached value without callback', async () => {
      await Cache.put('data', { cached: true }, undefined); // No TTL

      const result = await Cache.rememberForever('data', () => {
        throw new Error('Should not be called');
      });

      expect(result).toEqual({ cached: true });
    });
  });

  describe('pull', () => {
    it('should get and delete a value', async () => {
      await Cache.put('key', 'value');

      const result = await Cache.pull('key');

      expect(result).toBe('value');
      expect(await Cache.get('key')).toBeNull();
    });

    it('should return default if key does not exist', async () => {
      const result = await Cache.pull('missing', 'default');

      expect(result).toBe('default');
    });

    it('should delete the key even if default is used', async () => {
      const result = await Cache.pull('missing', 'default');

      expect(result).toBe('default');
      expect(await Cache.has('missing')).toBe(false);
    });

    it('should work with complex values', async () => {
      const data = { nested: { value: 123 } };
      await Cache.put('data', data);

      const result = await Cache.pull('data');

      expect(result).toEqual(data);
      expect(await Cache.has('data')).toBe(false);
    });
  });

  describe('store selection', () => {
    it('should use default store', async () => {
      Cache.configure({
        default: 'memory',
        stores: { memory: { driver: 'memory' } },
      });

      await Cache.put('key', 'value');
      const result = await Cache.get('key');

      expect(result).toBe('value');
    });

    it('should support multiple stores', async () => {
      Cache.configure({
        default: 'memory',
        stores: {
          memory: { driver: 'memory' },
          other: { driver: 'memory' },
        },
      });

      const memoryStore = Cache.store('memory');
      const otherStore = Cache.store('other');

      await memoryStore.put('key', 'memory-value');
      await otherStore.put('key', 'other-value');

      expect(await memoryStore.get('key')).toBe('memory-value');
      expect(await otherStore.get('key')).toBe('other-value');
    });
  });

  describe('file store', () => {
    it('should treat stored null values as existing cache entries', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'svelar-file-cache-'));
      tempDirs.push(dir);

      Cache.configure({
        default: 'file',
        stores: {
          file: { driver: 'file', path: dir },
        },
      });

      await Cache.put('nullable', null);

      expect(await Cache.has('nullable')).toBe(true);
      expect(await Cache.get('nullable', 'default')).toBeNull();
    });

    it('should apply file store default TTL through direct store access', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'svelar-file-cache-'));
      tempDirs.push(dir);

      Cache.configure({
        default: 'file',
        stores: {
          file: { driver: 'file', path: dir, ttl: 1 },
        },
      });

      await Cache.store('file').put('key', 'value');
      await new Promise((r) => setTimeout(r, 1100));

      expect(await Cache.store('file').get('key')).toBeNull();
    });

    it('should delete corrupted file cache entries and treat them as missing', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'svelar-file-cache-'));
      tempDirs.push(dir);

      Cache.configure({
        default: 'file',
        stores: {
          file: { driver: 'file', path: dir },
        },
      });

      const key = 'corrupt-cache-key';
      const path = fileCachePath(dir, key);
      const hash = createHash('md5').update(key).digest('hex');
      await mkdir(join(dir, hash.slice(0, 2)), { recursive: true });
      await writeFile(path, '{invalid', 'utf-8');

      expect(await Cache.has(key)).toBe(false);
      expect(await Cache.get(key, 'default')).toBe('default');
      await expect(readFile(path, 'utf-8')).rejects.toThrow();
    });

    it('should throw file cache read errors that are not missing files', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'svelar-file-cache-'));
      tempDirs.push(dir);

      Cache.configure({
        default: 'file',
        stores: {
          file: { driver: 'file', path: dir },
        },
      });

      const path = fileCachePath(dir, 'directory-cache-key');
      await mkdir(path, { recursive: true });

      await expect(Cache.has('directory-cache-key')).rejects.toThrow();
      await expect(Cache.get('directory-cache-key')).rejects.toThrow();
    });

    it('should throw file cache forget errors that are not missing files', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'svelar-file-cache-'));
      tempDirs.push(dir);

      Cache.configure({
        default: 'file',
        stores: {
          file: { driver: 'file', path: dir },
        },
      });

      const path = fileCachePath(dir, 'directory-forget-key');
      await mkdir(path, { recursive: true });

      await expect(Cache.forget('directory-forget-key')).rejects.toThrow();
    });
  });

  describe('integration', () => {
    it('should handle complex cache scenarios', async () => {
      // Cache a database query result
      const cacheKey = 'users:all';

      const users = await Cache.remember(cacheKey, 3600, async () => {
        return [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ];
      });

      expect(users).toHaveLength(2);

      // Verify it's cached
      const cached = await Cache.get(cacheKey);
      expect(cached).toEqual(users);

      // Forget individual cache key
      await Cache.forget(cacheKey);
      expect(await Cache.has(cacheKey)).toBe(false);
    });

    it('should manage counters', async () => {
      const key = 'api:requests:day';

      // First request
      let count = await Cache.increment(key);
      expect(count).toBe(1);

      // More requests
      count = await Cache.increment(key);
      count = await Cache.increment(key);

      expect(count).toBe(3);

      // Reset
      await Cache.forget(key);
      count = await Cache.increment(key);
      expect(count).toBe(1);
    });

    it('should handle cache busting', async () => {
      const key = 'product:1';

      // Initial cache
      await Cache.put(key, { id: 1, name: 'Product' });

      // Verify
      expect(await Cache.get(key)).toEqual({ id: 1, name: 'Product' });

      // Update (bust cache)
      await Cache.put(key, { id: 1, name: 'Updated Product' });

      // Verify update
      expect(await Cache.get(key)).toEqual({ id: 1, name: 'Updated Product' });
    });
  });
});
