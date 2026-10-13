import { describe, expect, it } from 'vitest';
import type { CacheStore } from '../src/cache/index';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function atomicContract(driver: string, getStore: () => CacheStore): void {
  describe(`${driver} atomic contract`, () => {
    it('admits exactly one simultaneous absent-key CAS and compares canonical JSON values', async () => {
      const store = getStore();
      const results = await Promise.all(Array.from({ length: 100 }, (_, index) => store.compareAndSet('cas', undefined, index)));
      expect(results.filter(Boolean)).toHaveLength(1);
      await store.put('json', { z: [1, null], a: { b: true } });
      expect(await store.compareAndSet('json', { a: { b: true }, z: [1, null] }, null)).toBe(true);
      expect(await store.compareAndSet('json', undefined, 'not absent')).toBe(false);
      expect(await store.compareAndSet('json', null, 'updated')).toBe(true);
      expect(await store.get('json')).toBe('updated');
      await store.incrementWithTtl('counter-cas', 10);
      expect(await store.compareAndSet('counter-cas', 1, 2)).toBe(true);
    });

    it('preserves CAS expiry unless explicitly replaced, and treats expired keys as absent', async () => {
      const store = getStore();
      await store.put('expires', 'before', 0.5);
      await pause(50);
      expect(await store.compareAndSet('expires', 'before', 'after')).toBe(true);
      await pause(500);
      expect(await store.get('expires')).toBeNull();
      expect(await store.compareAndSet('expires', undefined, 'fresh', 0.05)).toBe(true);
      await pause(80);
      expect(await store.has('expires')).toBe(false);
      await store.put('replace', 'before', 0.5);
      expect(await store.compareAndSet('replace', 'before', 'after', 10)).toBe(true);
      await pause(550);
      expect(await store.get('replace')).toBe('after');
    });

    it('rejects wrong-owner releases and stale owners after lease expiry', async () => {
      const store = getStore();
      const acquired = await Promise.all(Array.from({ length: 100 }, (_, index) => store.acquireLock('lease', `owner-${index}`, 10)));
      const owner = `owner-${acquired.indexOf(true)}`;
      expect(acquired.filter(Boolean)).toHaveLength(1);
      expect(await store.releaseLock('lease', 'wrong')).toBe(false);
      expect(await store.acquireLock('lease', 'wrong', 10)).toBe(false);
      expect(await store.acquireLock('lease', owner, 10)).toBe(false);
      expect(await store.releaseLock('lease', owner)).toBe(true);
      expect(await store.releaseLock('lease', owner)).toBe(false);
      expect(await store.acquireLock('lease', 'old-owner', 0.03)).toBe(true);
      await pause(60);
      expect(await store.releaseLock('lease', 'old-owner')).toBe(false);
      expect(await store.acquireLock('lease', 'new-owner', 10)).toBe(true);
      expect(await store.releaseLock('lease', 'old-owner')).toBe(false);
      expect(await store.releaseLock('lease', 'new-owner')).toBe(true);
      await store.put('lease', 'ordinary value');
      expect(await store.acquireLock('lease', 'separate-keyspace', 10)).toBe(true);
      expect(await store.get('lease')).toBe('ordinary value');
    });

    it('admits no more than capacity under 1000 concurrent all-or-none claims', async () => {
      const store = getStore();
      const claims = [{ key: '{batch}:credential', capacity: 71, ttl: 60 }, { key: '{batch}:account', capacity: 1000, ttl: 60 }];
      const results = await Promise.all(Array.from({ length: 1000 }, () => store.reserveCapacityMany(claims)));
      expect(results.filter((result) => result[0].allowed)).toHaveLength(71);
      expect(results.every((result) => result[0].allowed === result[1].allowed)).toBe(true);
      expect(await store.get('{batch}:credential')).toBe(71);
      expect(await store.get('{batch}:account')).toBe(71);
      expect(results.filter((result) => !result[0].allowed).every((result) => result[0].value === 71 && result[1].value === 71)).toBe(true);
    }, 30_000);

    it('does not create or consume any scope when another scope denies capacity', async () => {
      const store = getStore();
      await store.reserveCapacity('{deny}:account', 1, 60);
      const denied = await store.reserveCapacityMany([{ key: '{deny}:credential', capacity: 20, ttl: 60 }, { key: '{deny}:account', capacity: 1, ttl: 60 }]);
      expect(denied[0]).toMatchObject({ allowed: false, value: 0, remaining: 20, expiresAt: null });
      expect(await store.has('{deny}:credential')).toBe(false);
      expect(await store.get('{deny}:account')).toBe(1);
      expect(await store.reserveCapacity('oversized', 2, 60, 3)).toMatchObject({ allowed: false, value: 0, remaining: 2, expiresAt: null });
      expect(await store.has('oversized')).toBe(false);
    });

    it('keeps the original reservation window and renews only after expiry', async () => {
      const store = getStore();
      const first = await store.reserveCapacity('window', 2, 0.5);
      await pause(30);
      const second = await store.reserveCapacity('window', 2, 10);
      expect(Math.abs(second.expiresAt! - first.expiresAt!)).toBeLessThan(30);
      expect(await store.reserveCapacity('window', 2, 10)).toMatchObject({ allowed: false, value: 2, remaining: 0 });
      await pause(550);
      expect(await store.reserveCapacity('window', 2, 10)).toMatchObject({ allowed: true, value: 1, remaining: 1 });
    });

    it('validates all claims before any write and rejects corrupt capacity counters', async () => {
      const store = getStore();
      await expect(store.reserveCapacityMany([{ key: 'good', capacity: 1, ttl: 60 }, { key: 'bad', capacity: 0, ttl: 60 }])).rejects.toThrow();
      expect(await store.has('good')).toBe(false);
      await store.put('{bad}:counter', 'not a number');
      await expect(store.reserveCapacityMany([{ key: '{bad}:good', capacity: 1, ttl: 60 }, { key: '{bad}:counter', capacity: 1, ttl: 60 }])).rejects.toThrow();
      expect(await store.has('{bad}:good')).toBe(false);
      await expect(store.reserveCapacityMany(Array.from({ length: 17 }, (_, index) => ({ key: String(index), capacity: 1, ttl: 60 })))).rejects.toThrow();
      await expect(store.reserveCapacityMany([{ key: 'dup', capacity: 1, ttl: 60 }, { key: 'dup', capacity: 1, ttl: 60 }])).rejects.toThrow();
    });

    it('increments atomically without rounding or extending an existing expiry', async () => {
      const store = getStore();
      const results = await Promise.all(Array.from({ length: 1000 }, () => store.incrementWithTtl('increment', 60)));
      expect(new Set(results.map((result) => result.value)).size).toBe(1000);
      expect(await store.get('increment')).toBe(1000);
      expect(Math.max(...results.map((result) => result.expiresAt!)) - Math.min(...results.map((result) => result.expiresAt!))).toBeLessThan(40);
      await store.put('ordinary', 0, 0.08);
      await store.increment('ordinary');
      await pause(110);
      expect(await store.has('ordinary')).toBe(false);
      await store.put('overflow', Number.MAX_SAFE_INTEGER);
      await expect(store.increment('overflow')).rejects.toThrow();
      expect(await store.get('overflow')).toBe(Number.MAX_SAFE_INTEGER);
      await store.put('large-capacity', Number.MAX_SAFE_INTEGER - 2);
      expect(await store.reserveCapacity('large-capacity', Number.MAX_SAFE_INTEGER, 60)).toMatchObject({ value: Number.MAX_SAFE_INTEGER - 1 });
      expect(await store.get('large-capacity')).toBe(Number.MAX_SAFE_INTEGER - 1);
    }, 30_000);

    it('bounds TTL, amounts and JSON values before coordinating', async () => {
      const store = getStore();
      for (const ttl of [0, -1, NaN, Infinity, 0.0001, 31_536_001]) {
        await expect(store.acquireLock('invalid', 'owner', ttl)).rejects.toThrow(RangeError);
        await expect(store.reserveCapacity('invalid', 1, ttl)).rejects.toThrow(RangeError);
        await expect(store.incrementWithTtl('invalid', ttl)).rejects.toThrow(RangeError);
        await expect(store.compareAndSet('invalid', undefined, 1, ttl)).rejects.toThrow(RangeError);
      }
      for (const amount of [0, -1, 0.1, Infinity, Number.MAX_SAFE_INTEGER + 1]) await expect(store.reserveCapacity('invalid', 1, 60, amount)).rejects.toThrow(RangeError);
      await expect(store.compareAndSet('invalid', undefined, NaN)).rejects.toThrow(TypeError);
      await expect(store.acquireLock('invalid', '', 60)).rejects.toThrow(TypeError);
      expect(await store.has('invalid')).toBe(false);
    });
  });
}
