import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer, type Socket } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const require = createRequire(resolve(process.env.SVELAR_TEST_REDIS_CLIENT ?? 'package.json'));
let dependencyRoot: string | undefined;
try { dependencyRoot = dirname(dirname(require.resolve('ioredis/package.json'))); } catch { /* Optional Redis peer. */ }

describe.skipIf(!dependencyRoot)('real ioredis owned cache lifecycle', () => {
  let directory: string;
  let entry: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'svelar-cache-redis-lifecycle-'));
    entry = join(directory, 'cache.mjs');
    await symlink(dependencyRoot!, join(directory, 'node_modules'), 'dir');
    await build({ entryPoints: [resolve('src/cache/index.ts')], outfile: entry, bundle: true, packages: 'external',
      platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    if (process.env.SVELAR_CACHE_REDIS_EVIDENCE_DIR) {
      await mkdir(process.env.SVELAR_CACHE_REDIS_EVIDENCE_DIR, { recursive: true });
      await writeFile(join(process.env.SVELAR_CACHE_REDIS_EVIDENCE_DIR, 'source-identity.json'), JSON.stringify({
        scope: 'source-native; not an installed immutable artifact', node: process.version,
        source: resolve('src/cache/index.ts'),
        sourceSha256: createHash('sha256').update(await readFile('src/cache/index.ts')).digest('hex'),
        bundleSha256: createHash('sha256').update(await readFile(entry)).digest('hex'), dependencyRoot,
      }, null, 2) + '\n');
    }
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  async function childProbe(name: string, program: string, deadlineMs = 5000) {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ['--input-type=module', '--eval',
      `import assert from 'node:assert/strict';
       import { setTimeout as sleep } from 'node:timers/promises';
       import { Cache } from ${JSON.stringify(pathToFileURL(entry).href)};
       ${program}`], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let killed = false;
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, deadlineMs);
    let result: { code: number | null; signal: NodeJS.Signals | null };
    try {
      result = await new Promise((accept, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => accept({ code, signal }));
      });
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); }
    const evidence = { name, pid: child.pid, deadlineMs, elapsedMs: Date.now() - startedAt, killed, ...result, stdout, stderr };
    if (process.env.SVELAR_CACHE_REDIS_EVIDENCE_DIR) {
      await mkdir(process.env.SVELAR_CACHE_REDIS_EVIDENCE_DIR, { recursive: true });
      await writeFile(join(process.env.SVELAR_CACHE_REDIS_EVIDENCE_DIR, `${name}.json`), JSON.stringify(evidence, null, 2) + '\n');
    }
    expect(evidence, stdout + stderr).toMatchObject({ code: 0, signal: null, killed: false });
    expect(stderr).not.toContain('Unhandled error event');
    const report = JSON.parse(stdout.trim().split('\n').at(-1)!);
    expect(report.resources).not.toContain('TCPSocketWrap');
    expect(report.resources).not.toContain('Timeout');
    return report;
  }

  it('rejects concurrent closed-port reads and naturally exits with no retries or retained sockets', async () => {
    const server = createServer();
    await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected owned TCP address.');
    await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
    const report = await childProbe('closed-port', `
      Cache.configure({ default: 'redis', stores: { redis: { driver: 'redis', host: '127.0.0.1', port: ${address.port},
        connectTimeoutMs: 250, commandTimeoutMs: 250, prefix: 'owned-closed-port:' } } });
      const started = Date.now();
      const first = await Promise.allSettled(Array.from({length: 8}, () => Cache.get('unreachable', 'not-a-miss')));
      assert(first.every(result => result.status === 'rejected'));
      assert(first.every(result => /ECONNREFUSED/.test(String(result.reason))));
      await assert.rejects(Cache.get('later'), /ECONNREFUSED/);
      const operationMs = Date.now() - started;
      await sleep(150);
      console.log(JSON.stringify({ rejected: first.length + 1, operationMs, resources: process.getActiveResourcesInfo() }));`);
    expect(report.rejected).toBe(9);
    expect(report.operationMs).toBeLessThan(1000);
  });

  it('bounds a TCP connection that never completes the Redis INFO readiness check', async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected owned TCP address.');
      const report = await childProbe('silent-readiness', `
        Cache.configure({ default: 'redis', stores: { redis: { driver: 'redis', host: '127.0.0.1', port: ${address.port},
          connectTimeoutMs: 200, commandTimeoutMs: 400 } } });
        const started = Date.now();
        await assert.rejects(Cache.get('unreachable'), /connect timed out after 200 milliseconds/);
        const operationMs = Date.now() - started;
        await sleep(150);
        console.log(JSON.stringify({ operationMs, resources: process.getActiveResourcesInfo() }));`);
      expect(report.operationMs).toBeGreaterThanOrEqual(200);
      expect(report.operationMs).toBeLessThan(1000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
    }
  });

  it.skipIf(process.env.SVELAR_TEST_CACHE_REDIS_DOCKER !== '1')('preserves atomic/TTL contracts and recovers after a real Redis outage and command stall', async () => {
    const name = `svelar-cache-lifecycle-${randomUUID()}`;
    try {
      const probe = createServer();
      await new Promise<void>((accept) => probe.listen(0, '127.0.0.1', accept));
      const address = probe.address();
      if (!address || typeof address === 'string') throw new Error('Expected owned TCP address.');
      const port = address.port;
      await new Promise<void>((accept, reject) => probe.close((error) => error ? reject(error) : accept()));
      await execute('docker', ['run', '--detach', '--name', name, '--label', 'svelar.fixture=cache-lifecycle',
        '--publish', `127.0.0.1:${port}:6379`, 'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no'], { timeout: 10_000 });
      const { stdout } = await execute('docker', ['inspect', '--format', '{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostPort}}', name], { timeout: 5000 });
      expect(Number(stdout.trim())).toBe(port);
      await execute('docker', ['exec', name, 'redis-cli', 'ping'], { timeout: 5000 });
      const report = await childProbe('outage-recovery', `
        import Redis from 'ioredis';
        import { execFile } from 'node:child_process';
        import { promisify } from 'node:util';
        const execute = promisify(execFile);
        const name = ${JSON.stringify(name)};
        const url = 'redis://127.0.0.1:${port}';
        const prefix = 'owned-lifecycle:${randomUUID()}:';
        // Fixture-only readiness polling: Cache operations below are never retried.
        async function waitForRedis() {
          const deadline = Date.now()+3000;
          for (;;) {
            const probe = new Redis(url, {lazyConnect:true,maxRetriesPerRequest:1,retryStrategy:()=>null,
              enableOfflineQueue:false,connectTimeout:500,commandTimeout:500,disconnectTimeout:1});
            probe.on('error', () => {});
            try { await probe.connect(); assert.equal(await probe.ping(),'PONG'); return; }
            catch (error) { if (Date.now() >= deadline) throw error; }
            finally { probe.disconnect(); probe.stream?.destroy(); }
            await sleep(25);
          }
        }
        await waitForRedis();
        const admin = new Redis(url, {lazyConnect:true, maxRetriesPerRequest:1, retryStrategy:()=>null,
          enableOfflineQueue:false, connectTimeout:1000, commandTimeout:2000, disconnectTimeout:1});
        admin.on('error', () => {});
        await admin.connect();
        console.log('phase:ready');
        const listeners = admin.eventNames().map(name => [String(name), admin.listenerCount(name)]);
        Cache.configure({default:'redis',stores:{redis:{driver:'redis',url,prefix,ttl:30,connectTimeoutMs:500,commandTimeoutMs:150},
          borrowed:{driver:'redis',client:admin,prefix}}});
        const store = Cache.store();
        await store.put('persistent', 'value', 0);
        assert.equal(await admin.pttl(prefix+'persistent'), -1);
        assert.equal(await store.get('persistent'), 'value');
        const increment = await store.incrementWithTtl('counter', 10, 2);
        assert.equal(increment.value, 2);
        assert.equal(await store.increment('counter', 3), 5);
        assert(await admin.pttl(prefix+'counter') > 9000);
        const claims = await Promise.all(Array.from({length: 50}, () => store.reserveCapacityMany([
          {key:'{budget}:one',capacity:17,ttl:10}, {key:'{budget}:two',capacity:100,ttl:10}])));
        assert.equal(claims.filter(result=>result[0].allowed).length, 17);
        assert.equal(await store.get('{budget}:two'), 17);
        const winners = await Promise.all(Array.from({length:8}, (_,i)=>store.compareAndSet('cas',undefined,{winner:i},10)));
        assert.equal(winners.filter(Boolean).length, 1);
        assert(await store.acquireLock('lock','owner',10));
        assert.equal(await store.releaseLock('lock','other'), false);
        assert(await store.releaseLock('lock','owner'));
        console.log('phase:atomic');
        await admin.call('CLIENT','PAUSE','600','ALL');
        await assert.rejects(store.get('persistent'), /timed out/);
        await sleep(650);
        assert.equal(await store.get('persistent'), 'value');
        console.log('phase:command-recovered');
        const borrowed = Cache.store('borrowed');
        assert.equal(await borrowed.get('persistent'), 'value');
        assert.deepEqual(admin.eventNames().map(name => [String(name), admin.listenerCount(name)]), listeners);
        await execute('docker', ['stop','--time','0',name], {timeout:5000});
        await assert.rejects(Cache.get('persistent','not-a-fallback'));
        console.log('phase:outage-rejected');
        admin.disconnect();
        await execute('docker', ['start',name], {timeout:5000});
        await execute('docker', ['exec',name,'redis-cli','ping'], {timeout:5000});
        await waitForRedis();
        await store.put('recovered','available',0);
        assert.equal(await Cache.get('recovered'), 'available');
        console.log('phase:service-recovered');
        await execute('docker', ['stop','--time','0',name], {timeout:5000});
        await assert.rejects(store.get('recovered'));
        await sleep(150);
        console.log(JSON.stringify({ capacityWinners:17, casWinners:1, recovered:true, resources:process.getActiveResourcesInfo() }));`, 15_000);
      expect(report).toMatchObject({ capacityWinners: 17, casWinners: 1, recovered: true });
    } finally { await execute('docker', ['rm', '--force', name], { timeout: 5000 }); }
  }, 25_000);

  it.skipIf(process.env.SVELAR_TEST_CACHE_REDIS_DOCKER !== '1')('closes owned clients naturally, retains Redis data and leaves borrowed clients usable', async () => {
    const name = `svelar-cache-close-${randomUUID()}`;
    const prefix = `owned-close:${randomUUID()}:`;
    const probe = createServer();
    await new Promise<void>((accept) => probe.listen(0, '127.0.0.1', accept));
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Expected owned TCP address.');
    const port = address.port;
    await new Promise<void>((accept, reject) => probe.close((error) => error ? reject(error) : accept()));
    try {
      await execute('docker', ['run', '--detach', '--pull=never', '--name', name,
        '--label', `io.svelar.runtime-certification=${name}`, '--publish', `127.0.0.1:${port}:6379`,
        'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no'], { timeout: 10_000 });
      await execute('docker', ['exec', name, 'redis-cli', 'ping'], { timeout: 5000 });
      const report = await childProbe('owned-close', `
        import Redis from 'ioredis';
        const url = 'redis://127.0.0.1:${port}';
        const prefix = ${JSON.stringify(prefix)};
        Cache.configure({default:'redis',stores:{redis:{driver:'redis',url,prefix}, idle:{driver:'redis',url}}});
        const old = Cache.store();
        await old.put('retained', {value:'still-present'}, 0);
        await Promise.all([Cache.close(), Cache.close(), old.close()]);
        await assert.rejects(old.get('retained'), /store is closed/);
        assert.deepEqual(await Cache.get('retained'), {value:'still-present'});
        await Cache.close();
        const borrowed = new Redis(url, {lazyConnect:true,retryStrategy:()=>null,disconnectTimeout:1});
        borrowed.on('error', () => {});
        await borrowed.connect();
        const disconnect = borrowed.disconnect;
        let disconnects = 0;
        borrowed.disconnect = function(...args) { disconnects++; return disconnect.apply(this,args); };
        Cache.configure({default:'redis',stores:{redis:{driver:'redis',client:borrowed,prefix}}});
        const borrowedStore = Cache.store();
        assert.deepEqual(await borrowedStore.get('retained'), {value:'still-present'});
        await Cache.close();
        assert.equal(disconnects, 0);
        assert.equal(borrowed.status, 'ready');
        assert.equal(await borrowed.ping(), 'PONG');
        assert.deepEqual(JSON.parse(await borrowed.get(prefix+'retained')).value, {value:'still-present'});
        await assert.rejects(borrowedStore.get('retained'), /store is closed/);
        borrowed.disconnect();
        borrowed.stream?.destroy();
        await sleep(150);
        console.log(JSON.stringify({ownedClosed:true,borrowedPreserved:true,dataRetained:true,
          resources:process.getActiveResourcesInfo()}));`);
      expect(report).toMatchObject({ ownedClosed: true, borrowedPreserved: true, dataRetained: true });
      const independent = await childProbe('close-independent-reader', `
        Cache.configure({default:'redis',stores:{redis:{driver:'redis',url:'redis://127.0.0.1:${port}',prefix:${JSON.stringify(prefix)}}}});
        assert.deepEqual(await Cache.get('retained'), {value:'still-present'});
        await Cache.close();
        await sleep(150);
        console.log(JSON.stringify({independentDataRetained:true,resources:process.getActiveResourcesInfo()}));`);
      expect(independent.independentDataRetained).toBe(true);
    } finally { await execute('docker', ['rm', '--force', name], { timeout: 5000 }); }
  }, 15_000);
});
