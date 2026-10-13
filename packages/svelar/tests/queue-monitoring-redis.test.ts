import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const url = process.env.SVELAR_TEST_QUEUE_REDIS_URL;
const manifest = process.env.SVELAR_TEST_QUEUE_CLIENT;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(callback: () => T | Promise<T>, timeout = 15000): Promise<T> {
  const start = Date.now(); while (Date.now() - start < timeout) { const result = await callback(); if (result) return result; await sleep(25); }
  throw new Error('Native queue monitor condition timed out.');
}

describe.skipIf(!url || !manifest)('Native named queue operations and durable recovery', () => {
  let directory: string;
  let bundle: string;
  let source: any;
  let redis: any;
  let native: any;
  let prefix: string;
  let database: string;
  let children: Array<{ child: ChildProcess; events: any[]; output: string; exit: Promise<any> }>;
  beforeAll(async () => {
    const require = createRequire(resolve(manifest!)); const Redis = require('ioredis'); native = require('bullmq'); redis = new Redis(url);
    directory = await mkdtemp(join(tmpdir(), 'svelar-monitor-native-'));
    await symlink(join(dirname(resolve(manifest!)), 'node_modules'), join(directory, 'node_modules'));
    bundle = join(directory, 'fixture.mjs');
    await build({ entryPoints: [resolve('tests/queue-monitoring-fixture.ts')], outfile: bundle, bundle: true,
      platform: 'node', format: 'esm', packages: 'external', keepNames: true, target: 'node22', logLevel: 'silent' });
    source = await import(pathToFileURL(bundle).href);
  }, 30000);
  beforeEach(async () => {
    prefix = `svelar-monitor-${crypto.randomUUID()}`; database = join(directory, `${crypto.randomUUID()}.sqlite`); children = [];
    await source.migrate(database); source.setup(prefix, database);
  });
  afterEach(async () => {
    for (const entry of children) { if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill('SIGKILL'); await entry.exit; }
    await source.close();
    const keys = await redis.keys(`${prefix}*`); if (keys.length) await redis.del(...keys);
  });
  afterAll(async () => { await redis?.quit(); await rm(directory, { recursive: true, force: true }); });

  function spawn(role: string, connection = 'alpha', args: string[] = [], extra: Record<string, string> = {}) {
    const child = fork(bundle, role === 'worker' ? ['--queue=orders', `--connection=${connection}`, '--grace-period=3',
      ...(connection === 'sql' ? [] : ['--lock-duration=800', '--stalled-interval=500']), ...args] : [], {
      env: { ...process.env, SVELAR_QUEUE_MONITOR_CHILD: role, SVELAR_QUEUE_CONNECTION: connection,
        SVELAR_QUEUE_PREFIX: prefix, SVELAR_QUEUE_DATABASE: database, ...extra }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const entry = { child, events: [] as any[], output: '', exit: new Promise<any>(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))) };
    child.on('message', event => entry.events.push(event)); child.stdout?.on('data', data => { entry.output += data; }); child.stderr?.on('data', data => { entry.output += data; });
    children.push(entry); return entry;
  }
  async function stop(entry: ReturnType<typeof spawn>) { entry.child.kill('SIGTERM'); expect(await entry.exit, entry.output).toEqual({ code: 0, signal: null }); }
  async function fail(connection = 'alpha') {
    await source.Queue.dispatch(new source.MonitoringProcessJob('failure-service'), { queue: 'orders', connection, maxAttempts: 1,
      context: { teamId: 'original-team', userId: 'original-actor' }, metadata: { accountId: 'account', resourceId: 'resource', correlationId: 'trace' } });
    const entry = spawn('worker', connection, ['--once']); expect(await entry.exit, entry.output).toEqual({ code: 0, signal: null });
    const [record] = await source.Queue.adapter('orders', connection).deadLetters(); return record;
  }

  it('isolates identical job ids, pause state, metadata indexes and distributed registry across named connections', async () => {
    for (const connection of ['alpha', 'beta']) await source.Queue.dispatch(new source.MonitoringProcessJob(connection), {
      queue: 'orders', connection, jobId: 'same-id', context: { teamId: connection }, metadata: { accountId: 'account', resourceId: 'resource', correlationId: connection } });
    const alpha = source.Queue.adapter('orders', 'alpha'); const beta = source.Queue.adapter('orders', 'beta');
    await alpha.pause(); expect((await alpha.runtime()).paused).toBe(true); expect((await beta.runtime()).paused).toBe(false);
    expect((await alpha.list({ tenantId: 'alpha', accountId: 'account', correlationId: 'alpha' })).items[0].id).toBe('same-id');
    expect((await alpha.list({ tenantId: 'beta' })).items).toEqual([]); expect((await beta.get('same-id')).metadata.correlationId).toBe('beta');
    expect((await source.Queue.discoverQueues('beta')).some((queue: any) => queue.name === 'orders' && queue.connection === 'beta')).toBe(true);
    expect((await alpha.runtime()).oldestWaitingAt).not.toBeNull(); await alpha.resume();
  });

  it('observes real workers, renewed lock leases, five-way concurrency, active-delete refusal and metrics from another process', async () => {
    const barrier = `${prefix}:barrier`;
    await source.Queue.dispatchBulk(Array.from({ length: 5 }, (_, index) => ({ job: new source.MonitoringProcessJob(`parallel-${index}`, 0, barrier),
      options: { jobId: `parallel-${index}`, metadata: { tenantId: 'team' } } })), { queue: 'orders', connection: 'alpha' });
    const worker = spawn('worker', 'alpha', ['--concurrency=5']);
    await until(() => worker.events.filter(event => event.event === 'started').length === 5);
    const adapter = source.Queue.adapter('orders', 'alpha');
    const runtime = await adapter.runtime(); expect(runtime.workers.observed.live).toBe(1); expect(runtime.effectiveConcurrency).toBe(5);
    await sleep(1200); expect((await adapter.get('parallel-0')).lock.state).toBe('observed');
    expect((await adapter.remove({ source: 'live', id: 'parallel-0' })).outcome).toBe('busy');
    await redis.set(barrier, 'released'); await until(() => worker.events.filter(event => event.event === 'finished').length === 5);
    await stop(worker);
    const reader = spawn('metrics'); expect(await reader.exit, reader.output).toEqual({ code: 0, signal: null });
    expect(reader.events.find(event => event.event === 'metrics').result.completed).toBe(5);
    expect((await adapter.timeline({ source: 'live', id: 'parallel-0' })).map((event: any) => event.event)).toEqual(expect.arrayContaining(['dispatched', 'active', 'completed']));
  }, 20000);

  it('reports an expired killed-worker lease and native stalled recovery in the public snapshot/timeline', async () => {
    await source.Queue.dispatch(new source.MonitoringProcessJob('killed', 1400), { queue: 'orders', connection: 'alpha', jobId: 'killed' });
    const first = spawn('worker'); await until(() => first.events.some(event => event.event === 'started')); first.child.kill('SIGKILL'); await first.exit;
    await sleep(1000); const adapter = source.Queue.adapter('orders', 'alpha'); expect((await adapter.get('killed')).lock.state).toBe('expired');
    const replacement = spawn('worker'); await until(() => replacement.events.some(event => event.event === 'finished')); await stop(replacement);
    expect((await adapter.get('killed')).stalledCount).toBeGreaterThanOrEqual(1);
    expect((await adapter.timeline({ source: 'live', id: 'killed' })).map((event: any) => event.event)).toContain('stalled');
  }, 20000);

  it('archives a native terminal stalled failure even when normal attempt retries were not exhausted', async () => {
    await source.Queue.dispatch(new source.MonitoringProcessJob('stalled-terminal', 5000), { queue: 'orders', connection: 'alpha', jobId: 'stalled-terminal',
      maxAttempts: 3, context: { teamId: 'stalled-tenant' } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const worker = spawn('worker'); await until(() => worker.events.some(event => event.event === 'started'));
      worker.child.kill('SIGKILL'); await worker.exit; await sleep(900);
    }
    const final = spawn('worker'); const adapter = source.Queue.adapter('orders', 'alpha');
    await until(async () => (await adapter.deadLetters()).length === 1); await stop(final);
    const [record] = await adapter.deadLetters({ tenantId: 'stalled-tenant' });
    expect(record.originalJobId).toBe('stalled-terminal'); expect(record.maxAttempts).toBe(3);
    expect(record.exception).toContain('stalled'); expect((await adapter.get('stalled-terminal')).status).toBe('failed');
  }, 20000);

  it('allows one replay winner across independent admin processes and preserves original execution context/policy', async () => {
    const record = await fail();
    const admins = Array.from({ length: 5 }, () => spawn('replay', 'alpha', [], { SVELAR_QUEUE_REPLAY_ID: record.id }));
    for (const admin of admins) expect(await admin.exit, admin.output).toEqual({ code: 0, signal: null });
    expect(admins.flatMap(admin => admin.events).filter(event => event.event === 'result' && event.result.outcome === 'accepted')).toHaveLength(1);
    const adapter = source.Queue.adapter('orders', 'alpha'); const [receipt] = await adapter.deadLetters({ includeReplayed: true });
    expect(receipt.context).toEqual({ teamId: 'original-team', userId: 'original-actor' }); expect(receipt.maxAttempts).toBe(1); expect(receipt.retryDelay).toBe(0);
    const replay = await adapter.get(receipt.replayJobId); expect(replay.replayRecordId).toBe(record.id);
    const worker = spawn('worker', 'alpha', ['--once'], { SVELAR_QUEUE_SERVICE_RECOVERED: '1' }); expect(await worker.exit, worker.output).toEqual({ code: 0, signal: null });
    expect(worker.events.find(event => event.event === 'started').context).toMatchObject({ teamId: 'original-team', userId: 'original-actor' });
    expect((await adapter.metrics()).failed).toBe(1); expect((await adapter.metrics()).completed).toBe(1);
    const batch = await adapter.retryMany([{ source: 'dead-letter', id: record.id }, { source: 'live', id: receipt.replayJobId }]);
    expect(batch.results.every((item: any) => item.outcome !== 'accepted')).toBe(true);
  }, 20000);

  it('survives a killed admin after broker publish but before the database acknowledgement without duplicate delivery', async () => {
    const record = await fail(); const crashed = spawn('crash-replay', 'alpha', [], { SVELAR_QUEUE_REPLAY_ID: record.id });
    await until(() => crashed.events.some(event => event.event === 'broker-published-before-db-ack'));
    crashed.child.kill('SIGKILL'); await crashed.exit;
    const adapter = source.Queue.adapter('orders', 'alpha');
    expect(await adapter.deadLetters()).toHaveLength(1);
    const candidate = source.replayJobId(record.id); expect((await adapter.get(candidate)).status).toBe('waiting');
    expect((await adapter.remove({ source: 'live', id: candidate })).outcome).toBe('protected');
    expect((await adapter.retry({ source: 'dead-letter', id: record.id })).outcome).toBe('accepted');
    expect((await adapter.counts()).waiting).toBe(1);
    const worker = spawn('worker', 'alpha', ['--once'], { SVELAR_QUEUE_SERVICE_RECOVERED: '1' }); expect(await worker.exit, worker.output).toEqual({ code: 0, signal: null });
    expect(worker.events.filter(event => event.event === 'started')).toHaveLength(1);
  }, 20000);

  it('retains DLQ records when the actual broker is unavailable and permits a later replay', async () => {
    const record = await fail(); await source.close(); source.setup(prefix, database, 'redis://127.0.0.1:1');
    const adapter = source.Queue.adapter('orders', 'alpha'); const start = Date.now();
    await expect(adapter.retry({ source: 'dead-letter', id: record.id })).rejects.toThrow(); expect(Date.now() - start).toBeLessThan(2000);
    expect((await adapter.deadLetters())[0].context).toEqual(record.context);
    const rows = await source.Connection.raw('SELECT replay_token,replayed_at FROM svelar_failed_jobs WHERE id=?', [record.id]);
    expect(rows[0]).toMatchObject({ replay_token: null, replayed_at: null });
    await source.close(); source.setup(prefix, database);
    expect((await source.Queue.adapter('orders', 'alpha').retry({ source: 'dead-letter', id: record.id })).outcome).toBe('accepted');
  }, 15000);

  it('recovers a database reservation after a real worker SIGKILL in another process', async () => {
    await source.Queue.dispatch(new source.MonitoringProcessJob('sql-killed', 1800), { queue: 'orders', connection: 'sql', maxAttempts: 3 });
    const first = spawn('worker', 'sql', ['--once']); await until(() => first.events.some(event => event.event === 'started'));
    first.child.kill('SIGKILL'); await first.exit; await sleep(450);
    const adapter = source.Queue.adapter('orders', 'sql'); expect((await adapter.runtime()).expiredLocks).toBe(1);
    const replacement = spawn('worker', 'sql', ['--once']); expect(await replacement.exit, replacement.output).toEqual({ code: 0, signal: null });
    expect(replacement.events.filter(event => event.event === 'finished')).toHaveLength(1);
    expect((await adapter.metrics()).completed).toBe(1);
  }, 20000);
});
