import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { CreateSessionsTable } from '../src/database/core/00000000_000001_create_sessions_table.js';
import { DatabaseSessionStore, FileSessionStore, MemorySessionStore, RedisSessionStore, type SessionStore } from '../src/session/Session.js';

describe.sequential('Activity policy store conditional persistence', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'svelar-session-activity-')); });
  afterEach(async () => { await Connection.disconnect(); await rm(root, { recursive: true, force: true }); });

  async function store(driver: 'memory' | 'file' | 'database'): Promise<SessionStore> {
    if (driver === 'memory') return new MemorySessionStore();
    if (driver === 'file') return new FileSessionStore(root);
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: join(root, 'sessions.sqlite') } } });
    await new CreateSessionsTable().up();
    return new DatabaseSessionStore();
  }

  it.each(['memory', 'file', 'database'] as const)('permits one conditional update from parallel snapshots (%s)', async (driver) => {
    const sessions = await store(driver);
    await sessions.write('existing', { auth_user_id: 7, touched: 0 }, 60);
    const first = (await sessions.read('existing'))!;
    const second = (await sessions.read('existing'))!;
    const results = await Promise.all([
      sessions.compareAndSwap!('existing', first, { ...first, touched: 1 }, 60),
      sessions.compareAndSwap!('existing', second, { ...second, touched: 2 }, 60),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const current = (await sessions.read('existing'))!;
    expect([1, 2]).toContain(current.touched);
    expect(current.auth_user_id).toBe(7);
  });

  it.each(['memory', 'file', 'database'] as const)('does not recreate a revoked ID or overwrite a changed payload (%s)', async (driver) => {
    const sessions = await store(driver);
    await sessions.write('existing', { auth_user_id: 7 }, 60);
    const original = (await sessions.read('existing'))!;
    await sessions.write('existing', { auth_user_id: 8 }, 60);
    await expect(sessions.compareAndSwap!('existing', original, { auth_user_id: 7 }, 60)).resolves.toBe(false);
    expect((await sessions.read('existing'))!.auth_user_id).toBe(8);
    await sessions.destroy('existing');
    await expect(sessions.compareAndSwap!('existing', original, { auth_user_id: 7 }, 60)).resolves.toBe(false);
    await expect(sessions.read('existing')).resolves.toBeNull();
  });

  it('uses Redis single-command compare-and-set without recreating absent keys', async () => {
    const keys = new Map<string, string>();
    const calls: unknown[][] = [];
    const client = {
      get: async (key: string) => keys.get(key) ?? null,
      set: async (key: string, value: string) => { keys.set(key, value); },
      del: async (key: string) => { keys.delete(key); },
      eval: async (script: string, count: number, key: string, expected: string, value: string, ttl: number) => {
        calls.push([script, count, key, expected, value, ttl]);
        if (keys.get(key) !== expected) return 0;
        keys.set(key, value); return 1;
      },
    };
    const sessions = new RedisSessionStore({ client, prefix: 'activity:' });
    await sessions.write('existing', { auth_user_id: 7 }, 60);
    await expect(sessions.compareAndSwap('existing', { auth_user_id: 7 }, { auth_user_id: 7, touched: 1 }, 30)).resolves.toBe(true);
    await expect(sessions.compareAndSwap('existing', { auth_user_id: 7 }, { auth_user_id: 8 }, 30)).resolves.toBe(false);
    await sessions.destroy('existing');
    await expect(sessions.compareAndSwap('existing', { auth_user_id: 7 }, { auth_user_id: 7 }, 30)).resolves.toBe(false);
    expect(calls[0][0]).toContain("redis.call('GET', KEYS[1]) ~= ARGV[1]");
    expect(calls[0][0]).toContain("'EX', ARGV[3]");
    expect(calls[0].slice(1)).toEqual([1, 'activity:existing', '{"auth_user_id":7}', '{"auth_user_id":7,"touched":1}', 30]);
  });
});
