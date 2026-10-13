import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer, type Socket } from 'node:net';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const url = process.env.SVELAR_TEST_QUEUE_REDIS_URL;
const clientManifest = process.env.SVELAR_TEST_QUEUE_CLIENT;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(callback: () => T | Promise<T>, timeout = 12_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await callback(); if (value) return value;
    await delay(25);
  }
  throw new Error(`Queue condition timed out after ${timeout}ms.`);
}

describe.skipIf(!url || !clientManifest)('Native Redis queue process recovery', () => {
  let directory: string;
  let bundle: string;
  let source: any;
  let native: any;
  let redis: any;
  let inspector: any;
  let prefix: string;
  let databaseFile: string | undefined;
  let workers: Array<{ child: ChildProcess; events: any[]; output: string; exit: Promise<{ code: number | null; signal: string | null }> }>;

  beforeAll(async () => {
    const require = createRequire(resolve(clientManifest!));
    native = require('bullmq');
    const Redis = require('ioredis'); redis = new Redis(url, { maxRetriesPerRequest: null });
    directory = await mkdtemp(join(tmpdir(), 'svelar-queue-recovery-'));
    await symlink(join(dirname(resolve(clientManifest!)), 'node_modules'), join(directory, 'node_modules'));
    bundle = join(directory, 'fixture.mjs');
    await build({ entryPoints: [resolve('tests/queue-recovery-fixture.ts')], outfile: bundle, bundle: true,
      platform: 'node', format: 'esm', target: 'node22', keepNames: true, packages: 'external', logLevel: 'silent' });
    source = await import(pathToFileURL(bundle).href);
  }, 30_000);
  beforeEach(() => {
    prefix = `svelar-proof-${crypto.randomUUID()}`;
    source.configureFixture(prefix);
    const parsed = new URL(url!);
    inspector = new native.Queue('proof', { connection: { host: parsed.hostname, port: Number(parsed.port || 6379) }, prefix });
    workers = [];
    databaseFile = undefined;
  });
  afterEach(async () => {
    for (const worker of workers) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
      await worker.exit;
    }
    await source.Queue.stop();
    await source.closeFixtureClient();
    await source.closeFixtureDatabase();
    await inspector.obliterate({ force: true }); await inspector.close();
    const telemetryKeys = await redis.keys(`${prefix}:svelar:workers:*`);
    if (telemetryKeys.length) await redis.del(...telemetryKeys);
  });
  afterAll(async () => { await redis?.quit(); if (directory) await rm(directory, { recursive: true, force: true }); });

  async function worker(...args: string[]) {
    const child = fork(bundle, ['--queue=proof', '--lock-duration=800', '--stalled-interval=500', '--grace-period=3', ...args], {
      env: { ...process.env, SVELAR_QUEUE_CHILD: '1', SVELAR_QUEUE_PREFIX: prefix, SVELAR_QUEUE_DATABASE: databaseFile }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const entry = { child, events: [] as any[], output: '', exit: new Promise<{ code: number | null; signal: string | null }>(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))) };
    child.on('message', event => entry.events.push(event));
    child.stdout?.on('data', data => { entry.output += data; }); child.stderr?.on('data', data => { entry.output += data; });
    workers.push(entry);
    await until(() => entry.events.find(event => event.event === 'ready'));
    return entry;
  }
  async function stop(entry: Awaited<ReturnType<typeof worker>>) {
    entry.child.kill('SIGTERM');
    const exit = await entry.exit;
    expect(exit, entry.output).toEqual({ code: 0, signal: null });
  }

  it('renews a long-running native job beyond multiple lock durations and isolates context/progress', async () => {
    await source.Queue.dispatch(new source.RecoveryFixtureJob('renew', 3000), { queue: 'proof', jobId: 'renew', context: {} });
    const entry = await worker();
    const started = await until(() => entry.events.find(event => event.event === 'started'));
    expect(started.context).not.toHaveProperty('teamId'); expect(started.context).not.toHaveProperty('userId');
    for (let sample = 0; sample < 4; sample++) {
      await delay(500);
      expect(await redis.pttl(`${prefix}:proof:renew:lock`)).toBeGreaterThan(0);
    }
    await until(() => entry.events.find(event => event.event === 'finished'));
    const job = await inspector.getJob('renew');
    await until(async () => (await job.getState()) === 'completed');
    const completed = await inspector.getJob('renew');
    expect(completed.attemptsMade).toBe(1); expect(completed.progress).toMatchObject({ value: 100 });
    await stop(entry);
  }, 15_000);

  it('recovers a killed worker through BullMQ stalled checks in another process', async () => {
    await source.Queue.dispatch(new source.RecoveryFixtureJob('recover', 1600), { queue: 'proof', jobId: 'recover' });
    const first = await worker(); await until(() => first.events.find(event => event.event === 'started'));
    first.child.kill('SIGKILL'); expect((await first.exit).signal).toBe('SIGKILL');
    const replacement = await worker();
    await until(() => replacement.events.find(event => event.event === 'finished'));
    const job = await inspector.getJob('recover'); await until(async () => (await job.getState()) === 'completed');
    const events = await redis.xrange(`${prefix}:proof:events`, '-', '+');
    expect(events.some(([, values]: any) => values.includes('stalled'))).toBe(true);
    await stop(replacement);
  }, 15_000);

  it('stops new acquisitions on SIGTERM and drains only its active job', async () => {
    await source.Queue.dispatchBulk([
      { job: new source.RecoveryFixtureJob('drain', 1500), options: { jobId: 'drain' } },
      { job: new source.RecoveryFixtureJob('waiting'), options: { jobId: 'waiting' } },
    ], { queue: 'proof' });
    const entry = await worker('--concurrency=1');
    await until(() => entry.events.find(event => event.event === 'started'));
    const started = Date.now(); await stop(entry);
    expect(Date.now() - started).toBeLessThan(3200);
    expect(entry.events.filter(event => event.event === 'started').map(event => event.label)).toEqual(['drain']);
    expect(await (await inspector.getJob('drain')).getState()).toBe('completed');
    expect(await (await inspector.getJob('waiting')).getState()).toBe('waiting');
  }, 12_000);

  it('enforces a SIGTERM grace deadline for a hung job', async () => {
    await source.Queue.dispatch(new source.RecoveryFixtureJob('hang', 0, undefined, true), { queue: 'proof' });
    const entry = await worker('--grace-period=1'); await until(() => entry.events.find(event => event.event === 'started'));
    const started = Date.now(); entry.child.kill('SIGTERM');
    expect(await entry.exit, entry.output).toEqual({ code: 1, signal: null });
    expect(Date.now() - started).toBeLessThan(2500);
    expect(entry.output).toContain('did not stop within 1s');
  }, 10_000);

  it('starts five simultaneous jobs through CLI profile and concurrency options', async () => {
    const barrier = `${prefix}:barrier`;
    await source.Queue.dispatchBulk(Array.from({ length: 5 }, (_, i) => new source.RecoveryFixtureJob(`parallel-${i}`, 0, barrier)), { queue: 'proof' });
    const entry = await worker('--profile=proof-worker', '--concurrency=5');
    await until(() => entry.events.filter(event => event.event === 'started').length === 5);
    expect(await inspector.getActiveCount()).toBe(5);
    const telemetry = await until(async () => {
      const snapshot = await source.readFixtureWorkers(inspector, 'proof', 100);
      return snapshot.observed?.concurrency === 5 && snapshot;
    }, 1000);
    expect(telemetry.observed).toMatchObject({ live: 1, active: 1, concurrency: 5 });
    expect(entry.events.filter(event => event.event === 'finished')).toHaveLength(0);
    await redis.set(barrier, 'released', 'EX', 20);
    await until(() => entry.events.filter(event => event.event === 'finished').length === 5);
    await stop(entry); await redis.del(barrier);
  }, 12_000);

  it('renews locks in finite --once mode and leaves the second job waiting', async () => {
    await source.Queue.dispatchBulk([new source.RecoveryFixtureJob('once', 2200), new source.RecoveryFixtureJob('untouched')], { queue: 'proof' });
    const entry = await worker('--once');
    expect(await entry.exit, entry.output).toEqual({ code: 0, signal: null });
    expect(entry.events.filter(event => event.event === 'finished').map(event => event.label)).toEqual(['once']);
    expect(await inspector.getWaitingCount()).toBe(1);
    expect(entry.output).not.toContain('Missing lock');
  }, 12_000);

  it('processes a priority-only queue in finite --once mode', async () => {
    await source.Queue.dispatch(new source.RecoveryFixtureJob('priority-once'), { queue: 'proof', priority: 1 });
    expect(await source.Queue.size('proof')).toBe(1);
    const entry = await worker('--once');
    expect(await entry.exit, entry.output).toEqual({ code: 0, signal: null });
    expect(entry.events.filter(event => event.event === 'finished').map(event => event.label)).toEqual(['priority-once']);
  }, 10_000);

  it('drains a finite --once job on SIGTERM without closing its lock/acknowledgement client early', async () => {
    await source.Queue.dispatchBulk([
      { job: new source.RecoveryFixtureJob('finite-drain', 1500), options: { jobId: 'finite-drain' } },
      new source.RecoveryFixtureJob('finite-waiting'),
    ], { queue: 'proof' });
    const entry = await worker('--once'); await until(() => entry.events.find(event => event.event === 'started'));
    await stop(entry);
    expect(await (await inspector.getJob('finite-drain')).getState()).toBe('completed');
    expect(entry.events.filter(event => event.event === 'started').map(event => event.label)).toEqual(['finite-drain']);
    expect(await inspector.getWaitingCount()).toBe(1);
  }, 10_000);

  it('bounds max-time drain even in --once mode', async () => {
    await source.Queue.dispatch(new source.RecoveryFixtureJob('timeout', 0, undefined, true), { queue: 'proof' });
    const started = Date.now(); const entry = await worker('--once', '--max-time=1', '--grace-period=1');
    expect(await entry.exit, entry.output).toEqual({ code: 1, signal: null });
    expect(Date.now() - started).toBeLessThan(4000); expect(entry.output).toContain('Max time (1s)');
  }, 10_000);

  it('uses native priority, stable job ids, deduplication and bulk payloads', async () => {
    const id = await source.Queue.dispatch(new source.RecoveryFixtureJob('simple-first'), { queue: 'proof', jobId: 'simple-first', deduplication: { id: 'simple', mode: 'until-completed' } });
    expect(await source.Queue.dispatch(new source.RecoveryFixtureJob('simple-ignored'), { queue: 'proof', jobId: 'simple-ignored', deduplication: { id: 'simple', mode: 'until-completed' } })).toBe(id);
    await source.Queue.dispatchBulk([
      { job: new source.RecoveryFixtureJob('priority-low'), options: { jobId: 'priority-low', priority: 9 } },
      { job: new source.RecoveryFixtureJob('priority-high'), options: { jobId: 'priority-high', priority: 1 } },
    ], { queue: 'proof', maxAttempts: 7, metadata: { resourceId: 'invoice-1' }, context: { teamId: 'team-1' } });
    const stored = await inspector.getJob('priority-high');
    expect(stored.data.metadata).toEqual({ resourceId: 'invoice-1' }); expect(stored.opts.attempts).toBe(7);
    const entry = await worker('--concurrency=1');
    await until(() => entry.events.filter(event => event.event === 'finished').length === 3);
    expect(entry.events.filter(event => event.event === 'started').map(event => event.label)).toEqual(['simple-first', 'priority-high', 'priority-low']);
    expect(entry.events.find(event => event.label === 'priority-high').context.teamId).toBe('team-1');
    await stop(entry);
  }, 12_000);

  it('debounces to the latest payload and coalesces active work to one latest successor', async () => {
    const debounce = { id: 'debounce', mode: 'debounce', ttl: 300 };
    await source.Queue.dispatch(new source.RecoveryFixtureJob('debounce-first'), { queue: 'proof', deduplication: debounce });
    await source.Queue.dispatch(new source.RecoveryFixtureJob('debounce-last'), { queue: 'proof', deduplication: debounce });
    const barrier = `${prefix}:coalesce-barrier`;
    await source.Queue.dispatch(new source.RecoveryFixtureJob('coalesce-active', 0, barrier), { queue: 'proof', jobId: 'coalesce-active', deduplication: { id: 'coalesce', mode: 'coalesce' } });
    const entry = await worker('--concurrency=1');
    await until(() => entry.events.find(event => event.label === 'coalesce-active'));
    for (const label of ['coalesce-middle', 'coalesce-last']) {
      await source.Queue.dispatch(new source.RecoveryFixtureJob(label), { queue: 'proof', jobId: label, deduplication: { id: 'coalesce', mode: 'coalesce' } });
    }
    await redis.set(barrier, 'released', 'EX', 20);
    await until(() => entry.events.filter(event => event.event === 'finished').length === 3);
    const finished = entry.events.filter(event => event.event === 'finished').map(event => event.label);
    expect(finished).toContain('coalesce-last'); expect(finished).toContain('debounce-last');
    expect(finished).not.toContain('coalesce-middle'); expect(finished).not.toContain('debounce-first');
    await stop(entry); await redis.del(barrier);
  }, 12_000);

  it('releases unique-until-processing at acquisition and respects throttle expiry', async () => {
    const barrier = `${prefix}:unique-barrier`;
    const unique = { id: 'processing-key', mode: 'until-processing' };
    await source.Queue.dispatch(new source.RecoveryFixtureJob('processing-first', 0, barrier), { queue: 'proof', deduplication: unique });
    const entry = await worker('--concurrency=1'); await until(() => entry.events.find(event => event.label === 'processing-first'));
    await source.Queue.dispatch(new source.RecoveryFixtureJob('processing-second'), { queue: 'proof', deduplication: unique });
    expect(await inspector.getWaitingCount()).toBe(1);
    const throttle = { id: 'throttle-key', mode: 'throttle', ttl: 150 };
    const first = await source.Queue.dispatch(new source.RecoveryFixtureJob('throttle-first'), { queue: 'proof', deduplication: throttle });
    expect(await source.Queue.dispatch(new source.RecoveryFixtureJob('throttle-ignored'), { queue: 'proof', deduplication: throttle })).toBe(first);
    await delay(200);
    expect(await source.Queue.dispatch(new source.RecoveryFixtureJob('throttle-next'), { queue: 'proof', deduplication: throttle })).not.toBe(first);
    await redis.set(barrier, 'released', 'EX', 20);
    await until(() => entry.events.filter(event => event.event === 'finished').length === 4);
    expect(entry.events.some(event => event.label === 'throttle-ignored')).toBe(false);
    await stop(entry); await redis.del(barrier);
  }, 12_000);

  it('fails disconnected producers quickly and bounds initial protocol-blackhole connections without late enqueue', async () => {
    await source.Queue.dispatch(new source.RecoveryFixtureJob('connected'), { queue: 'proof' });
    const driver = (source.Queue as any).resolveDriver('redis');
    const producer = await driver.queues.get('proof').client;
    producer.disconnect();
    const disconnectedAt = Date.now();
    await expect(source.Queue.dispatch(new source.RecoveryFixtureJob('disconnected'), { queue: 'proof' })).rejects.toThrow();
    expect(Date.now() - disconnectedAt).toBeLessThan(1000);
    await source.Queue.dispatch(new source.RecoveryFixtureJob('reconnected'), { queue: 'proof' });
    expect(await inspector.getWaitingCount()).toBe(2);
    await source.Queue.stop();
    const sockets = new Set<Socket>();
    const server = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      source.Queue.configure({ default: 'offline', connections: { offline: { driver: 'redis', prefix,
        url: `redis://127.0.0.1:${port}`, producerTimeoutMs: 300 } } });
      const started = Date.now();
      const results = await Promise.allSettled([0, 1].map(() => source.Queue.dispatch(new source.RecoveryFixtureJob('never-enqueue'), { queue: 'proof', connection: 'offline' })));
      expect(results.every(result => result.status === 'rejected')).toBe(true);
      for (const result of results) if (result.status === 'rejected') expect(result.reason.message).toContain('producer connection timed out');
      expect(sockets.size).toBeGreaterThan(0);
      expect(Date.now() - started).toBeLessThan(1500);
      expect((source.Queue as any).resolveDriver('offline').queues.size).toBe(0);
    } finally {
      await source.Queue.stop();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 10_000);

  it('isolates native retry hooks and drains failed ledger writes before finite worker exit', async () => {
    await source.Queue.dispatch(new source.RecoveryFixtureJob('retry', 0, undefined, false, 2), {
      queue: 'proof', context: { teamId: 'original-team', userId: 'original-actor' }, maxAttempts: 3,
    });
    const retries = await worker('--concurrency=1');
    await until(() => retries.events.some(event => event.event === 'finished'));
    expect(retries.events.filter(event => event.event === 'retrying').map(event => [event.attempts, event.context.teamId, event.context.userId]))
      .toEqual([[1, 'original-team', 'original-actor'], [2, 'original-team', 'original-actor']]);
    await stop(retries);
    databaseFile = join(directory, `${crypto.randomUUID()}.sqlite`);
    await source.prepareFixtureDatabase(databaseFile);
    await source.Queue.dispatch(new source.RecoveryFixtureJob('permanent', 0, undefined, false, 5), {
      queue: 'proof', jobId: 'permanent', context: { teamId: 'original-team' }, metadata: { resourceId: 'invoice-1' }, maxAttempts: 1,
    });
    const failed = await worker('--once');
    expect(await failed.exit, failed.output).toEqual({ code: 0, signal: null });
    expect(failed.events.find(event => event.event === 'failed')).toMatchObject({ id: 'permanent', attempts: 1, context: { teamId: 'original-team' } });
    const [record] = await source.Queue.failed();
    expect(record).toMatchObject({ queue: 'proof', jobClass: 'RecoveryFixtureJob', context: { teamId: 'original-team' },
      metadata: { resourceId: 'invoice-1' }, maxAttempts: 1, retryDelay: 0, connection: 'redis' });
    expect(JSON.parse(record.payload).label).toBe('permanent');
  }, 12_000);
});
