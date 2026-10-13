import { mkdtemp, mkdir, readFile, rm, writeFile, utimes, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Cache, CacheAtomicUnavailableError, type CacheStore } from '../src/cache/index';
import { atomicContract } from './cache-atomic-contract';

const exec = promisify(execFile);
let roots: string[] = [];

afterEach(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}.lock`, { recursive: true, force: true });
  }
  roots = [];
});

for (const driver of ['memory', 'file'] as const) {
  describe(driver, () => {
    let store: CacheStore;
    beforeEach(async () => {
      const path = driver === 'file' ? await mkdtemp(join(tmpdir(), 'svelar-cache-atomic-')) : undefined;
      if (path) roots.push(path);
      Cache.configure({ default: driver, stores: { [driver]: { driver, path } } });
      store = Cache.store();
    });
    atomicContract(driver, () => store);
  });
}

describe('file cross-process coordination', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-cache-atomic-process-'));
    roots.push(root);
    Cache.configure({ default: 'file', stores: { file: { driver: 'file', path: root } } });
  });

  it('admits only 137 of 1000 claims across eight independent processes, with matching account counters', async () => {
    const jitiPath = resolve('../../node_modules/jiti/lib/jiti.mjs');
    const cachePath = resolve('src/cache/index.ts');
    const script = `
      import { createJiti } from ${JSON.stringify(jitiPath)};
      const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
      const { Cache } = await jiti.import(${JSON.stringify(cachePath)});
      Cache.configure({ default:'file', stores:{file:{driver:'file',path:process.argv[1]}} });
      let admitted = 0;
      for (let i = 0; i < 125; i++) {
        const result = await Cache.reserveCapacityMany([{key:'credential',capacity:137,ttl:60},{key:'account',capacity:1000,ttl:60}]);
        if(result[0].allowed) admitted++;
      }
      const cas = await Cache.compareAndSet('process-cas', undefined, process.pid);
      const lock = await Cache.acquireLock('process-lock', String(process.pid), 60);
      for(let i = 0; i < 25; i++) await Cache.incrementWithTtl('process-increment',60);
      process.stdout.write(JSON.stringify({admitted,cas,lock}));
    `;
    const children = await Promise.allSettled(Array.from({ length: 8 }, () => exec(process.execPath, ['--input-type=module', '-e', script, root], { timeout: 30_000 })));
    const failures = children.filter((child) => child.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map((child) => child.status === 'rejected' ? child.reason : undefined), 'File-cache child processes failed.');
    const results = children.flatMap((child) => child.status === 'fulfilled' ? [JSON.parse(child.value.stdout) as { admitted: number; cas: boolean; lock: boolean }] : []);
    expect(results.reduce((sum, result) => sum + result.admitted, 0)).toBe(137);
    expect(results.filter((result) => result.cas)).toHaveLength(1);
    expect(results.filter((result) => result.lock)).toHaveLength(1);
    expect(await Cache.get('credential')).toBe(137);
    expect(await Cache.get('account')).toBe(137);
    expect(await Cache.get('process-increment')).toBe(200);
  }, 40_000);

  it('recovers a published batch journal before reads and rejects a malformed journal', async () => {
    const expiresAt = Date.now() + 60_000;
    await writeFile(join(root, '.atomic-reservations.json'), JSON.stringify([{ key: 'one', value: 2, expiresAt }, { key: 'two', value: 3, expiresAt }]));
    expect(await Cache.get('one')).toBe(2);
    expect(await Cache.get('two')).toBe(3);
    await expect(readFile(join(root, '.atomic-reservations.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(join(root, '.atomic-reservations.json'), '[{"key":"one","value":"bad","expiresAt":null}]');
    await expect(Cache.get('two')).rejects.toThrow('Invalid file-cache reservation journal');
  });

  it('safely recovers a stale proper-lockfile lock and leaves no lock behind flush', async () => {
    await mkdir(`${root}.lock`);
    const old = new Date(Date.now() - 60_000);
    await utimes(`${root}.lock`, old, old);
    await Cache.put('before', 1);
    await Cache.flush();
    await Cache.put('after', 2);
    expect(await Cache.get('before')).toBeNull();
    expect(await Cache.get('after')).toBe(2);
    await expect(readFile(`${root}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains the existing hashed path contract and uses restrictive file permissions', async () => {
    await Cache.put('compatibility', 'value');
    const hash = createHash('md5').update('compatibility').digest('hex');
    expect(JSON.parse(await readFile(join(root, hash.slice(0, 2), hash), 'utf8')).value).toBe('value');
    expect((await stat(join(root, hash.slice(0, 2), hash))).mode & 0o777).toBe(0o600);
  });

  it('rejects corrupt atomic entries without replacing them or consuming another scope', async () => {
    const hash = createHash('md5').update('corrupt').digest('hex');
    await mkdir(join(root, hash.slice(0, 2)), { recursive: true });
    const path = join(root, hash.slice(0, 2), hash);
    await writeFile(path, '{broken json');
    await expect(Cache.reserveCapacityMany([{ key: 'free', capacity: 1, ttl: 60 }, { key: 'corrupt', capacity: 1, ttl: 60 }])).rejects.toThrow();
    await expect(Cache.compareAndSet('corrupt', undefined, 1)).rejects.toThrow();
    expect(await Cache.has('free')).toBe(false);
    expect(await readFile(path, 'utf8')).toBe('{broken json');
    await writeFile(path, '{"value":1,"expiresAt":"unknown"}');
    await expect(Cache.reserveCapacity('corrupt', 1, 60)).rejects.toThrow('Invalid file-cache entry');
  });
});

it('null stores explicitly reject atomic coordination instead of manufacturing success', async () => {
  Cache.configure({ default: 'null', stores: { null: { driver: 'null' } } });
  await expect(Cache.compareAndSet('key', undefined, 1)).rejects.toBeInstanceOf(CacheAtomicUnavailableError);
  await expect(Cache.acquireLock('key', 'owner', 60)).rejects.toBeInstanceOf(CacheAtomicUnavailableError);
  await expect(Cache.releaseLock('key', 'owner')).rejects.toBeInstanceOf(CacheAtomicUnavailableError);
  await expect(Cache.reserveCapacity('key', 1, 60)).rejects.toBeInstanceOf(CacheAtomicUnavailableError);
  await expect(Cache.incrementWithTtl('key', 60)).rejects.toBeInstanceOf(CacheAtomicUnavailableError);
  expect(await Cache.get('key')).toBeNull();
});
