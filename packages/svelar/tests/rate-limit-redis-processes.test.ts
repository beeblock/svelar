import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SVELAR_TEST_REDIS_URL;
const manifest = process.env.SVELAR_TEST_REDIS_CLIENT;
describe.skipIf(!url || !manifest)('Distributed HTTP admission through real Redis', () => {
  let directory: string;
  let client: any;
  const children: Array<{ child: ChildProcess; exit: Promise<void> }> = [];
  const namespace = `svelar-http-admission:${crypto.randomUUID()}:`;
  const ports: number[] = [];
  beforeAll(async () => {
    const require = createRequire(manifest!); const Redis = require('ioredis');
    client = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 3000 }); await client.ping();
    directory = await mkdtemp(join(tmpdir(), 'svelar-http-admission-'));
    await symlink(resolve('../../node_modules'), join(directory, 'node_modules'));
    const bundle = join(directory, 'fixture.mjs');
    await build({ entryPoints: [resolve('tests/rate-limit-process-fixture.ts')], outfile: bundle,
      bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent' });
    for (let index = 0; index < 4; index++) {
      const child = fork(bundle, [], { env: { ...process.env, SVELAR_RATE_NAMESPACE: namespace }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      const exit = new Promise<void>((resolve) => child.once('exit', () => resolve())); children.push({ child, exit });
      let output = ''; child.stderr?.on('data', (data) => { output += data; });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`HTTP limiter startup timed out: ${output}`)), 10_000);
        child.once('exit', () => { clearTimeout(timeout); reject(new Error(`HTTP limiter exited: ${output}`)); });
        child.once('message', (message: any) => { clearTimeout(timeout); ports.push(message.port); resolve(); });
      });
    }
  }, 30_000);
  afterAll(async () => {
    for (const entry of children) {
      if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill('SIGKILL');
      await entry.exit;
    }
    if (client) {
      const keys = await client.keys(`${namespace}*`); if (keys.length) await client.del(...keys);
      await client.quit();
    }
    if (directory) await rm(directory, { force: true, recursive: true });
  });
  it('admits exactly the configured limit across 1,000 HTTP requests without losing TTL or trusting spoofed headers', async () => {
    const outcomes: Array<{ status: number; headers: Headers }> = [];
    for (let start = 0; start < 1000; start += 50) {
      const batch = await Promise.all(Array.from({ length: 50 }, async (_, offset) => {
        const index = start + offset;
        const response = await fetch(`http://127.0.0.1:${ports[index % ports.length]}/api/proof`, {
          headers: { 'X-Forwarded-For': `192.0.2.${index % 200 + 1}` },
        });
        await response.text(); return { status: response.status, headers: response.headers };
      }));
      outcomes.push(...batch);
    }
    expect(outcomes.filter((entry) => entry.status === 200)).toHaveLength(137);
    expect(outcomes.filter((entry) => entry.status === 429)).toHaveLength(863);
    expect(outcomes.every((entry) => entry.headers.get('X-RateLimit-Limit') === '137')).toBe(true);
    expect(outcomes.filter((entry) => entry.status === 429).every((entry) => Number(entry.headers.get('Retry-After')) > 0)).toBe(true);
    const keys = await client.keys(`${namespace}*`); expect(keys).toHaveLength(1);
    expect(await client.pttl(keys[0])).toBeGreaterThan(0);
    expect(await client.pttl(keys[0])).toBeLessThanOrEqual(60_000);
  }, 25_000);
});
