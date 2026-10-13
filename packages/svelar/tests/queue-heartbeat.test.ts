import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heartbeatConfig, readWorkerTelemetry, startWorkerHeartbeat } from '../src/queue/BullMQTelemetry.js';
import { JobMonitor } from '../src/queue/JobMonitor.js';
import { Job, Queue } from '../src/queue/index.js';
import { fakeQueue } from '../src/testing/index.js';

const namespace = 'svelar:workers:v1';
const zeroCounts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

class TelemetryRedis {
  now = 1_800_000_000_000;
  values = new Map<string, { value: string; expires: number }>();
  indexes = new Map<string, Map<string, number>>();
  failPublication = false;
  failRemoval = false;
  time = vi.fn(async () => [String(Math.floor(this.now / 1000)), String((this.now % 1000) * 1000)]);
  getrange = vi.fn(async (key: string, start: number, end: number) => {
    const entry = this.values.get(key);
    return entry && entry.expires > this.now ? entry.value.slice(start, end + 1) : '';
  });
  zrangebyscore = vi.fn(async (key: string, since: number, _end: string, _scores: string, _limit: string, offset: number, count: number) => {
    return [...(this.indexes.get(key) ?? new Map())]
      .filter(([, score]) => score >= since).sort((a, b) => a[1] - b[1])
      .slice(offset, offset + count).flatMap(([member, score]) => [member, String(score)]);
  });
  eval = vi.fn(async (_script: string, keyCount: number, ...args: any[]) => {
    const [index, record] = args;
    if (keyCount === 2) {
      if (this.failRemoval) throw new Error('redis://private-secret removal denied');
      this.values.delete(record);
      return this.indexes.get(index)?.delete(args[2]) ? 1 : 0;
    }
    if (this.failPublication) throw new Error('redis://private-secret publication denied');
    const [, , marker, workerId, payload, startedAt, staleAfterMs, retentionMs] = args;
    const data = {
      ...JSON.parse(payload), startedAt: startedAt || this.now,
      lastSeenAt: this.now, staleAt: this.now + staleAfterMs, expiresAt: this.now + retentionMs,
    };
    this.values.set(record, { value: JSON.stringify(data), expires: data.expiresAt });
    this.values.set(marker, { value: '1', expires: Math.max(this.values.get(marker)?.expires ?? 0, data.expiresAt) });
    if (!this.indexes.has(index)) this.indexes.set(index, new Map());
    this.indexes.get(index)!.set(workerId, data.expiresAt);
    const expired = [...this.indexes.get(index)!].filter(([, expires]) => expires <= this.now).slice(0, 100);
    for (const [expiredId] of expired) this.indexes.get(index)!.delete(expiredId);
    return data.startedAt;
  });
}

describe.sequential('Distributed BullMQ worker telemetry', () => {
  let redis: TelemetryRedis;
  let workers: TestWorker[];
  let stops: Array<() => Promise<void>>;
  let outcomes: Promise<unknown>[];

  class TestWorker extends EventEmitter {
    client: Promise<TelemetryRedis>;
    opts: Record<string, any>;
    concurrency: number;
    running: boolean;
    paused = false;
    nativeClose = vi.fn(async () => { this.running = false; });
    close = this.nativeClose;
    constructor(public name: string, _processor?: unknown, options: Record<string, any> = {}) {
      super();
      this.client = Promise.resolve(redis);
      this.opts = { prefix: 'test', concurrency: 1, lockDuration: 30000, stalledInterval: 30000, ...options };
      this.concurrency = this.opts.concurrency;
      this.running = options.autorun !== false;
      workers.push(this);
    }
    isRunning() { return this.running; }
    async run() { this.running = true; }
    isPaused() { return this.paused; }
    toKey(suffix: string) { return `${this.opts.prefix}:${this.name}:${suffix}`; }
    async getNextJob() { return null; }
  }

  class TestQueue {
    client = Promise.resolve(redis);
    getWaiting = vi.fn(async () => []);
    getJobCounts = vi.fn(async () => ({ waiting: 1 }));
    getGlobalConcurrency = vi.fn(async (): Promise<number | null> => null);
    isPaused = vi.fn(async () => false);
    close = vi.fn(async () => {});
    add = vi.fn(async () => {});
    getWorkers = vi.fn(() => { throw new Error('CLIENT LIST must not be used'); });
    constructor(public name: string, public opts = { prefix: 'test' }) {}
    toKey(suffix: string) { return `${this.opts.prefix}:${this.name}:${suffix}`; }
  }

  function driver(options: Record<string, any> = {}) {
    Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis', prefix: 'test', ...options } } });
    const instance = (Queue as any).resolveDriver('redis');
    instance._bullmq = { Worker: TestWorker, Queue: TestQueue };
    return instance;
  }

  async function health(queue: TestQueue, limit = 100, coverage: 'instrumented' | 'exclusive' = 'exclusive', workerHeartbeat?: false) {
    JobMonitor.configure({ driver: 'redis', default: 'redis', connections: { redis: { driver: 'redis', workerHeartbeat } },
      workerTelemetryLimit: limit, workerTelemetryCoverage: coverage });
    vi.spyOn(Queue, 'queues').mockReturnValue([{ name: queue.name }]);
    vi.spyOn(JobMonitor, 'getCounts').mockResolvedValue(zeroCounts);
    vi.spyOn(JobMonitor as any, 'getDefaultQueue').mockReturnValue(queue.name);
    vi.spyOn(JobMonitor as any, 'getRedisQueue').mockResolvedValue(queue);
    return (await JobMonitor.getHealth()).runtime[queue.name];
  }

  beforeEach(() => {
    vi.useFakeTimers();
    redis = new TelemetryRedis();
    workers = [];
    stops = [];
    outcomes = [];
    Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
  });

  afterEach(async () => {
    redis.failPublication = false;
    redis.failRemoval = false;
    for (const stop of stops) await stop().catch(() => {});
    await Queue.stop().catch(() => {});
    await vi.runOnlyPendingTimersAsync();
    await Promise.all(outcomes);
    vi.restoreAllMocks();
    vi.useRealTimers();
    Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
    JobMonitor.configure({ driver: 'sync', default: 'sync', connections: { sync: { driver: 'sync' } } });
  });

  it('publishes only redacted actual options and derives distributed capacity from separate worker objects', async () => {
    const instance = driver();
    await instance.createWorker('emails', {}, {}, { concurrency: 5, lockDuration: 45000, stalledInterval: 31000 });
    await instance.createWorker('emails', {}, {}, { concurrency: 3 });
    const queue = new TestQueue('emails');
    queue.getGlobalConcurrency.mockResolvedValue(6);
    const state = await health(queue);
    expect(state).toMatchObject({ workers: 2, effectiveConcurrency: 6 });
    expect(state.workerTelemetry).toMatchObject({ source: 'heartbeat', complete: true, reason: null, invalidRecords: 0 });
    expect(state.workerTelemetry!.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ concurrency: 5, lockDuration: 45000, stalledInterval: 31000, running: true, paused: false }),
    ]));
    expect(queue.getWorkers).not.toHaveBeenCalled();
    expect(state.workerTelemetry!.records.every(record => record.lastSeenAt === redis.now)).toBe(true);

    workers[0].opts.connection = { password: 'never-public', host: 'secret-host' };
    workers[0].opts.name = 'sensitive-machine-name';
    workers[0].concurrency = 2;
    workers[1].paused = true;
    redis.now += 5000;
    await vi.advanceTimersByTimeAsync(5000);
    queue.getGlobalConcurrency.mockResolvedValue(null);
    const refreshed = await health(queue);
    expect(refreshed).toMatchObject({ workers: 2, effectiveConcurrency: 2 });
    expect(JSON.stringify(refreshed.workerTelemetry)).not.toMatch(/never-public|secret-host|sensitive-machine-name|password/);
    queue.isPaused.mockResolvedValue(true);
    expect((await health(queue)).effectiveConcurrency).toBe(0);
    queue.isPaused.mockResolvedValue(false);
    delete (queue as any).getGlobalConcurrency;
    expect((await health(queue)).effectiveConcurrency).toBeNull();
  });

  it('excludes stale workers without inventing healthy capacity and expires retained records', async () => {
    const worker = new TestWorker('emails');
    stops.push(await startWorkerHeartbeat(worker, 'emails'));
    const queue = new TestQueue('emails');
    redis.now += 15000;
    const stale = await health(queue);
    expect(stale).toMatchObject({ workers: 0, effectiveConcurrency: 0 });
    expect(stale.workerTelemetry!.records).toEqual([expect.objectContaining({ status: 'stale' })]);
    redis.now += 45001;
    expect(await health(queue)).toMatchObject({ workers: null, effectiveConcurrency: null });
    expect((await readWorkerTelemetry(queue, 'emails', 100)).source).toBe('unavailable');
  });

  it('leaves pool totals unknown for partial coverage even with fresh records or an empty recent registry', async () => {
    const stop = await startWorkerHeartbeat(new TestWorker('emails'), 'emails');
    stops.push(stop);
    const queue = new TestQueue('emails');
    expect(await health(queue, 100, 'instrumented')).toMatchObject({
      workers: null, effectiveConcurrency: null,
      workerTelemetry: { coverage: 'instrumented', complete: true, observed: { live: 1, concurrency: 1 } },
    });
    await stop();
    expect(await health(queue, 100, 'instrumented')).toMatchObject({
      workers: null, effectiveConcurrency: null,
      workerTelemetry: { complete: true, observed: { live: 0, concurrency: 0 } },
    });
    expect(await health(queue, 100, 'exclusive')).toMatchObject({ workers: 0, effectiveConcurrency: 0 });
    expect(await health(queue, 100, 'exclusive', false)).toMatchObject({ workers: null, effectiveConcurrency: null });
    expect(queue.getWorkers).not.toHaveBeenCalled();
  });

  it('keeps draining workers visible and fresh but excludes them from intake capacity until native close finishes', async () => {
    const instance = driver();
    const worker = await instance.createWorker('emails', {}, {}, { concurrency: 4 });
    let finishNative!: () => void;
    worker.nativeClose.mockImplementation(() => new Promise<void>(resolve => { finishNative = resolve; }));
    const closing = worker.close();
    try {
      await vi.waitFor(() => expect(worker.nativeClose).toHaveBeenCalled());
      const queue = new TestQueue('emails');
      expect(await health(queue)).toMatchObject({
        workers: 1, effectiveConcurrency: 0,
        workerTelemetry: { observed: { live: 1, active: 0, draining: 1 }, records: [expect.objectContaining({ draining: true })] },
      });
      redis.now += 5000;
      await vi.advanceTimersByTimeAsync(5000);
      expect((await health(queue)).workerTelemetry!.records[0]).toMatchObject({ status: 'live', draining: true });
    } finally {
      finishNative?.();
      await closing;
    }
    expect((await readWorkerTelemetry(new TestQueue('emails'), 'emails', 100)).records).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps queues and prefixes isolated without disclosing another scope', async () => {
    stops.push(await startWorkerHeartbeat(new TestWorker('emails'), 'emails'));
    const own = await readWorkerTelemetry(new TestQueue('emails'), 'emails', 100);
    expect(own.records).toHaveLength(1);
    expect((await readWorkerTelemetry(new TestQueue('pdf'), 'pdf', 100)).source).toBe('unavailable');
    expect((await readWorkerTelemetry(new TestQueue('emails', { prefix: 'other' }), 'emails', 100)).source).toBe('unavailable');
    expect(redis.eval.mock.calls[0][2]).toBe('test:emails:svelar:workers:v1');
  });

  it('bounds worker reads, record bytes and overflow detection even for a million registrations', async () => {
    const worker = new TestWorker('emails');
    stops.push(await startWorkerHeartbeat(worker, 'emails'));
    redis.zrangebyscore.mockImplementation(async (_key, _since, _end, _scores, _limit, offset, count) => {
      expect(offset).toBe(0);
      expect(count).toBe(4);
      return Array.from({ length: count }, (_, index) => [id(index), String(redis.now + 60000)]).flat();
    });
    const queue = new TestQueue('emails');
    const state = await health(queue, 3);
    expect(state).toMatchObject({ workers: null, effectiveConcurrency: null });
    expect(state.workerTelemetry).toMatchObject({ complete: false, reason: 'truncated', limit: 3 });
    expect(state.workerTelemetry!.records.length).toBeLessThanOrEqual(3);
    expect(redis.getrange.mock.calls.length).toBeLessThanOrEqual(4);
    for (const [, start, end] of redis.getrange.mock.calls) {
      expect(start).toBe(0);
      expect(end).toBeLessThanOrEqual(2048);
    }
  });

  it.each(['oversized', 'cross-queue', 'invalid-concurrency', 'future', 'missing'] as const)(
    'rejects %s metadata without leaking stored fields or trusting capacity', async corruption => {
      stops.push(await startWorkerHeartbeat(new TestWorker('emails'), 'emails'));
      const recordKey = [...redis.values.keys()].find(key => key !== `test:emails:${namespace}:seen`)!;
      const entry = redis.values.get(recordKey)!;
      const data = JSON.parse(entry.value);
      if (corruption === 'oversized') entry.value = JSON.stringify({ ...data, secret: 'x'.repeat(5000) });
      else if (corruption === 'cross-queue') entry.value = JSON.stringify({ ...data, queue: 'pdf', secret: 'private' });
      else if (corruption === 'invalid-concurrency') entry.value = JSON.stringify({ ...data, concurrency: 0 });
      else if (corruption === 'future') entry.value = JSON.stringify({ ...data, lastSeenAt: redis.now + 100000 });
      else redis.values.delete(recordKey);
      const state = await health(new TestQueue('emails'));
      expect(state).toMatchObject({ workers: null, effectiveConcurrency: null });
      expect(state.workerTelemetry).toMatchObject({ complete: false, invalidRecords: 1, records: [] });
      expect(JSON.stringify(state.workerTelemetry)).not.toContain('private');
    },
  );

  it('strips additional fields even from otherwise valid stored JSON', async () => {
    stops.push(await startWorkerHeartbeat(new TestWorker('emails'), 'emails'));
    const recordKey = [...redis.values.keys()].find(key => !key.endsWith(':seen'))!;
    const entry = redis.values.get(recordKey)!;
    entry.value = JSON.stringify({ ...JSON.parse(entry.value), password: 'private-secret', pid: 123, host: 'private-host', payload: 'private-job' });
    const snapshot = await readWorkerTelemetry(new TestQueue('emails'), 'emails', 100);
    expect(snapshot.complete).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/private-|password|payload|pid|host/);
  });

  it('does not use healthy fallbacks when Redis metadata reads are denied or unavailable', async () => {
    redis.getrange.mockRejectedValue(new Error('NOPERM redis://private-credential'));
    const queue = new TestQueue('emails');
    const state = await health(queue);
    expect(state).toMatchObject({ workers: null, effectiveConcurrency: null });
    expect(state.workerTelemetry).toMatchObject({ source: 'unavailable', complete: false, reason: 'unavailable', records: [] });
    expect(JSON.stringify(state.workerTelemetry)).not.toContain('private-credential');
    expect(queue.getWorkers).not.toHaveBeenCalled();
  });

  it('cleans heartbeat timers and registrations when Queue.stop closes the real worker path', async () => {
    driver();
    const run = Queue.work({ queue: 'emails', concurrency: 4 });
    outcomes.push(run.catch(() => {}));
    await vi.waitFor(() => expect((Queue as any)._activeWorker).not.toBeNull());
    expect((await readWorkerTelemetry(new TestQueue('emails'), 'emails', 100)).records).toHaveLength(1);
    await Queue.stop();
    await vi.advanceTimersByTimeAsync(500);
    await expect(run).resolves.toBe(0);
    expect(workers[0].close).not.toHaveProperty('mock');
    expect((await readWorkerTelemetry(new TestQueue('emails'), 'emails', 100))).toMatchObject({ complete: true, records: [] });
    expect(vi.getTimerCount()).toBe(0);
    const writes = redis.eval.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(redis.eval.mock.calls.length).toBe(writes);
  });

  it('rejects worker startup if heartbeat publication fails and closes the native worker', async () => {
    driver();
    redis.failPublication = true;
    await expect(Queue.work({ queue: 'emails' })).rejects.toThrow('Redis worker heartbeat publication failed.');
    expect(workers[0].close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a running worker on heartbeat publication failure without leaking connection errors', async () => {
    driver();
    const outcome = Queue.work({ queue: 'emails' }).then(() => 'resolved', error => error);
    outcomes.push(outcome);
    await vi.waitFor(() => expect((Queue as any)._activeWorker).not.toBeNull());
    redis.failPublication = true;
    redis.now += 5000;
    await vi.advanceTimersByTimeAsync(5000);
    const error = await outcome;
    expect(error.message).toBe('Redis worker heartbeat publication failed.');
    expect(error.message).not.toContain('private-secret');
    expect(vi.getTimerCount()).toBe(0);
    expect((await readWorkerTelemetry(new TestQueue('emails'), 'emails', 100)).records).toHaveLength(0);
  });

  it('still closes native workers and clears timers if heartbeat removal fails', async () => {
    const instance = driver();
    const worker = await instance.createWorker('emails', {}, {}, {});
    redis.failRemoval = true;
    await expect(worker.close()).rejects.toThrow('records will expire');
    expect(worker.running).toBe(false);
    expect(instance.workers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    redis.now += 15000;
    expect((await readWorkerTelemetry(new TestQueue('emails'), 'emails', 100)).records[0].status).toBe('stale');
  });

  it.each(['drain', 'cleanup', 'native'] as const)(
    'attempts every worker and queue close before aggregating %s failures', async failure => {
      const instance = driver();
      const first = await instance.createWorker('emails', {}, {}, {});
      const second = await instance.createWorker('pdf', {}, {}, {});
      const firstQueue = await instance.getQueue('emails');
      const secondQueue = await instance.getQueue('pdf');
      const queueError = new Error('queue close failed');
      firstQueue.close.mockImplementation(() => { throw queueError; });
      if (failure === 'drain') redis.failPublication = true;
      else if (failure === 'cleanup') redis.failRemoval = true;
      else first.nativeClose.mockRejectedValue(new Error('native worker close failed'));

      const error = await instance.close().then(() => null, (error: unknown) => error);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toContain(queueError);
      expect((error as AggregateError).errors).toHaveLength(failure === 'native' ? 2 : 3);
      expect(first.nativeClose).toHaveBeenCalledOnce();
      expect(second.nativeClose).toHaveBeenCalledOnce();
      expect(firstQueue.close).toHaveBeenCalledOnce();
      expect(secondQueue.close).toHaveBeenCalledOnce();
      expect(instance.workers.size).toBe(0);
      expect(instance.queues.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('Queue.stop closes other resources even when the active worker has a known rejected close promise', async () => {
    const instance = driver();
    const otherWorker = await instance.createWorker('pdf', {}, {}, {});
    const firstQueue = await instance.getQueue('emails');
    const secondQueue = await instance.getQueue('pdf');
    const activeError = new Error('active close already failed');
    const active = { close: vi.fn(async () => { throw activeError; }) };
    instance.workers.add(active);
    (Queue as any)._activeWorker = active;
    const queueError = new Error('queue close failed');
    firstQueue.close.mockRejectedValue(queueError);

    await expect(Queue.stop()).rejects.toMatchObject({
      name: 'AggregateError', errors: [activeError, queueError],
    });
    expect(active.close).toHaveBeenCalledTimes(2);
    expect(otherWorker.nativeClose).toHaveBeenCalledOnce();
    expect(firstQueue.close).toHaveBeenCalledOnce();
    expect(secondQueue.close).toHaveBeenCalledOnce();
    expect((Queue as any)._activeWorker).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fake dispatch never creates workers or heartbeat registrations and restores real dispatch', async () => {
    class HeartbeatJob extends Job { async handle() {} }
    driver();
    const resolve = vi.spyOn(Queue as any, 'resolveDriver');
    await fakeQueue(async fake => {
      await Queue.dispatch(new HeartbeatJob());
      fake.assertCount(1);
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await Queue.dispatch(new HeartbeatJob());
    expect(resolve).toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('allows explicit telemetry opt-out without claiming distributed worker health', async () => {
    const instance = driver({ workerHeartbeat: false });
    await instance.createWorker('emails', {}, {}, {});
    const state = await health(new TestQueue('emails'));
    expect(state).toMatchObject({ workers: null, effectiveConcurrency: null });
    expect(redis.eval).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('validates heartbeat timing and bounded reader limits', async () => {
    for (const config of [{ intervalMs: 0 }, { staleAfterMs: 1000 }, { retentionMs: 15000 }, { intervalMs: Infinity }]) {
      expect(() => heartbeatConfig(config)).toThrow(RangeError);
    }
    for (const limit of [0, -1, 0.5, Infinity, 1001]) {
      await expect(readWorkerTelemetry(new TestQueue('emails'), 'emails', limit)).rejects.toThrow(RangeError);
      expect(() => JobMonitor.configure({ driver: 'redis', default: 'redis', connections: {}, workerTelemetryLimit: limit }))
        .toThrow(RangeError);
    }
    expect(redis.getrange).not.toHaveBeenCalled();
  });
});
