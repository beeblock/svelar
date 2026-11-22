import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Job, Queue, type QueueOperationsIndexPolicy } from '../src/queue/index.js';
import { RedisQueueOperations } from '../src/queue/RedisOperations.js';
import { operationsIndexPolicy } from '../src/queue/OperationsIndexPolicy.js';
import { ApplicationContext } from '../src/support/Context.js';
import { redisAdapter } from '../src/queue/Adapters.js';
import { replayJobId } from '../src/queue/FailedJobStore.js';

function fixture(policy: QueueOperationsIndexPolicy = 'full') {
  const records = new Map<string, string>();
  const client = {
    eval: vi.fn(async (_script: string, keys: number, ...args: any[]) => {
      if (keys === 2) records.set(args[2], args[3]);
      return 1;
    }),
    hget: vi.fn(async (_key: string, id: string) => records.get(id)),
    time: vi.fn(async () => ['1000', '0']),
  };
  const jobs = new Map<string, any>();
  const queue = { client, toKey: (key: string) => `test:orders:${key}`, getJob: vi.fn(async (id: string) => jobs.get(id)),
    isPaused: vi.fn(async () => false), getGlobalConcurrency: vi.fn(async () => null),
    getJobCounts: vi.fn(async () => ({ waiting: 0, paused: 0, prioritized: 0, active: 0 })),
    getJobs: vi.fn(async () => [...jobs.values()]) };
  const provider = vi.fn(async () => queue);
  const operations = new RedisQueueOperations(provider, 'redis', 'orders', policy);
  function job(id = 'job-a', extra: Record<string, any> = {}) {
    const item = { id, name: 'IndexJob', timestamp: Date.now(), data: { jobClass: 'IndexJob', payload: '{}', context: { teamId: 'team' } },
      opts: { attempts: 3 }, attemptsMade: 0, attemptsStarted: 0, stalledCounter: 0, state: 'waiting',
      getState: vi.fn(async () => item.state), updateData: vi.fn(async (data: any) => { item.data = data; }), ...extra };
    jobs.set(id, item);
    return item;
  }
  return { client, records, jobs, queue, provider, operations, job };
}

afterEach(async () => { await Queue.stop(); vi.restoreAllMocks(); });

describe('Redis operations-index policies', () => {
  it('defaults to full with bounded terminal retention', () => {
    expect(operationsIndexPolicy()).toEqual({ mode: 'full', maxAgeSeconds: 604800, maxJobs: 1000 });
    expect(operationsIndexPolicy({ mode: undefined, maxAgeSeconds: undefined, maxJobs: undefined })).toEqual(operationsIndexPolicy());
  });

  it.each([
    'sample', { mode: 'invalid' }, { maxJobs: -1 }, { maxJobs: 1.5 }, { maxJobs: Infinity },
    { maxAgeSeconds: -1 }, { maxAgeSeconds: NaN }, { maxAgeSeconds: Number.MAX_SAFE_INTEGER },
  ])('rejects invalid policy %j before driver I/O', policy => {
    expect(() => Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis', operationsIndex: policy as any } } })).toThrow();
    expect(() => Queue.registerQueue({ name: 'invalid', operationsIndex: policy as any })).toThrow();
  });

  it('makes a clean successful lifecycle cost zero index I/O in failures-only mode', async () => {
    const test = fixture('failures-only'); const job = test.job();
    await test.operations.capture(job, 'dispatched');
    job.state = 'active'; job.attemptsStarted = 1;
    await test.operations.capture(job, 'active', 'active', { duration: 30000, owner: 'worker' });
    await test.operations.observeLocks([job.id], 30000, 'worker');
    job.state = 'completed'; job.attemptsMade = 1;
    await test.operations.capture(job, 'completed', 'completed');
    expect(test.provider).not.toHaveBeenCalled();
    expect(job.getState).not.toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
    expect(test.client.eval).not.toHaveBeenCalled();
    expect(await test.operations.snapshot(job)).toBeNull();
    expect(test.provider).not.toHaveBeenCalled();
  });

  it('keeps failure history across worker restarts and terminal success even with empty native diagnostics', async () => {
    const test = fixture('failures-only'); const job = test.job();
    job.state = 'active'; job.attemptsStarted = 1;
    await test.operations.capture(job, 'retrying');
    expect(job.updateData).toHaveBeenCalledOnce();
    const restored = test.job(job.id, { data: structuredClone(job.data), state: 'completed', attemptsMade: 1, attemptsStarted: 1 });
    const next = new RedisQueueOperations(test.provider, 'redis', 'orders', 'failures-only');
    expect(await next.capture(restored, 'completed', 'completed')).toBe(true);
    expect(JSON.parse(test.records.get(job.id)!)).toMatchObject({ status: 'completed' });
    expect(restored.updateData).not.toHaveBeenCalled();
    expect(await next.snapshot(restored)).toMatchObject({ status: 'completed' });
  });

  it.each(['stalled', 'retried', 'lock-renewal-failed', 'failed'])('tracks exceptional event %s', async event => {
    const test = fixture('failures-only'); const job = test.job();
    job.state = event === 'failed' ? 'failed' : 'waiting';
    expect(await test.operations.capture(job, event)).toBe(true);
    expect(JSON.parse(test.records.get(job.id)!)).toMatchObject({ status: job.state });
  });

  it.each([
    { failedReason: 'previous failure' }, { stacktrace: ['previous failure'] }, { stalledCounter: 1 },
    { attemptsStarted: 2 }, { attemptsMade: 1 }, { data: { replayRecordId: 'failure-receipt', payload: '{}' } },
  ])('tracks existing native failure/replay history %j', async extra => {
    const test = fixture('failures-only');
    expect(await test.operations.capture(test.job('history', extra), 'active', 'active')).toBe(true);
    expect(test.client.eval).toHaveBeenCalledOnce();
  });

  it('turns lock-renewal failure into durable history, without observing healthy locks', async () => {
    const test = fixture('failures-only'); const job = test.job(); job.state = 'active';
    await test.operations.observeLocks([job.id], 0, 'worker');
    expect(job.updateData).toHaveBeenCalledOnce();
    expect(test.client.eval).toHaveBeenCalledTimes(2);
    expect(JSON.parse(test.records.get(job.id)!)).toMatchObject({ status: 'active' });
  });

  it('off skips successes, failures, replay, reconcile and lock I/O without changing job data', async () => {
    const test = fixture('off'); const job = test.job('off', { data: { replayRecordId: 'receipt' } });
    for (const event of ['dispatched', 'active', 'retrying', 'failed', 'completed']) await test.operations.capture(job, event);
    await test.operations.refresh(job.id, 'stalled');
    await test.operations.observeLocks([job.id], 0, 'worker');
    expect(await test.operations.snapshot(job)).toBeNull();
    expect(await test.operations.reconcile()).toEqual({ indexed: 0, complete: true });
    expect((await test.operations.list()).items).toEqual([]);
    expect(await test.operations.timeline(job.id)).toEqual([]);
    expect(test.provider).not.toHaveBeenCalled();
    expect(job.getState).not.toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
  });

  it('batches full-mode snapshot, timeline, initial lease and retention into one mutation', async () => {
    const test = fixture({ mode: 'full', maxAgeSeconds: 60, maxJobs: 3 }); const job = test.job();
    await test.operations.capture(job, 'active', 'active', { duration: 1234, owner: 'worker' });
    expect(test.client.eval).toHaveBeenCalledOnce();
    const [script, keys, jobs, timeline, id, data, event, attempt, prefix, age, maximum, duration, owner] = test.client.eval.mock.calls[0];
    expect({ keys, jobs, timeline, id, event, attempt, prefix, age, maximum, duration, owner }).toEqual({ keys: 2,
      jobs: 'test:orders:svelar:operations:v1:jobs', timeline: 'test:orders:svelar:operations:v1:timeline:job-a',
      id: job.id, event: 'active', attempt: 0, prefix: 'test:orders:svelar:operations:v1', age: 60000, maximum: 3, duration: 1234, owner: 'worker' });
    expect(JSON.parse(data)).toMatchObject({ status: 'active' });
    expect(script).toContain("redis.call('DEL', prefix .. ':timeline:' .. id)");
    expect(test.queue.getJob).not.toHaveBeenCalled();
    expect(job.getState).not.toHaveBeenCalled();
  });

  it('batches lock observations and does not write for empty batches', async () => {
    const test = fixture();
    await test.operations.observeLocks([], 100, 'worker');
    expect(test.provider).not.toHaveBeenCalled();
    await test.operations.observeLocks(['a', 'b', 'c'], 100, 'worker');
    expect(test.client.eval).toHaveBeenCalledOnce();
    expect(test.client.eval.mock.calls[0].slice(1)).toEqual([1, 'test:orders:svelar:operations:v1:jobs', 100, 'worker', 'a', 'b', 'c']);
  });

  it.each(['off', 'failures-only'] as const)('returns unknown ages/locks for unindexed ready jobs in %s', async policy => {
    const test = fixture(policy);
    test.queue.getJobCounts.mockResolvedValue({ waiting: 0, paused: 0, prioritized: 1, active: 1 });
    expect(await test.operations.readyAges()).toEqual({ oldest: null, stalled: null, expiredLocks: null, complete: false });
    test.queue.getJobCounts.mockResolvedValue({ waiting: 0, paused: 0, prioritized: 0, active: 0 });
    expect(await test.operations.readyAges()).toEqual({ oldest: null, stalled: 0, expiredLocks: 0, complete: true });
    expect(test.client.eval).not.toHaveBeenCalled();
  });

  it('resolves queue overrides per named connection, including registrations after driver creation', async () => {
    Queue.configure({ default: 'primary', connections: { primary: { driver: 'redis', operationsIndex: 'off' }, secondary: { driver: 'redis', operationsIndex: 'full' } },
      queues: [{ name: 'policy-orders', connection: 'primary', operationsIndex: 'failures-only' }] });
    const primary = (Queue as any).resolveDriver('primary'); const secondary = (Queue as any).resolveDriver('secondary');
    const test = fixture(); vi.spyOn(primary, 'getQueue').mockResolvedValue(test.queue); vi.spyOn(secondary, 'getQueue').mockResolvedValue(test.queue);
    await primary.operations('policy-orders').capture(test.job());
    expect(test.client.eval).not.toHaveBeenCalled();
    await secondary.operations('policy-orders').capture(test.job());
    expect(test.client.eval).toHaveBeenCalledOnce();
    Queue.registerQueue({ name: 'policy-orders', connection: 'primary', operationsIndex: 'full' });
    await primary.operations('policy-orders').capture(test.job());
    expect(test.client.eval).toHaveBeenCalledTimes(2);
  });

  it('does not report zero lag for unindexed prioritized jobs through the public adapter', async () => {
    Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis', workerHeartbeat: false, operationsIndex: 'failures-only' } } });
    const test = fixture(); test.queue.getJobCounts.mockResolvedValue({ waiting: 0, paused: 0, prioritized: 1, active: 0 });
    vi.spyOn((Queue as any).resolveDriver('redis'), 'getQueue').mockResolvedValue(test.queue);
    expect(await Queue.adapter('orders', 'redis').runtime()).toMatchObject({ oldestWaitingAt: null, lag: null,
      stalled: null, expiredLocks: null, locksComplete: false });
  });

  it('reconcile counts only captured jobs under the selected policy', async () => {
    const test = fixture('failures-only'); test.job('success'); test.job('failure', { state: 'failed', failedReason: 'failed' });
    expect(await test.operations.reconcile()).toEqual({ indexed: 1, complete: true });
  });

  it.each(['off', 'full'] as const)('preserves replay receipt protections independently of %s snapshots and retention', async policy => {
    const test = fixture(policy); const id = replayJobId('receipt');
    const job = test.job(id, { state: 'active', data: { replayRecordId: 'receipt' } });
    const ledger = { find: vi.fn(async () => ({ id: 'receipt', connection: 'redis', queue: 'orders' })), forget: vi.fn(async () => true) };
    const adapter = redisAdapter({ connection: 'redis', queue: 'orders', ledger: ledger as any, replay: async () => false },
      test.provider, test.operations, 'instrumented');
    expect(await adapter.remove({ source: 'dead-letter', id: 'receipt' })).toMatchObject({ outcome: 'busy' });
    job.state = 'completed';
    expect(await adapter.remove({ source: 'dead-letter', id: 'receipt' })).toMatchObject({ outcome: 'protected' });
    expect(ledger.forget).not.toHaveBeenCalled();
    expect(test.client.eval).not.toHaveBeenCalled();
  });

  it('offers bounded terminal pruning even when indexing is off and rejects unsupported drivers', async () => {
    Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis', operationsIndex: 'off' } } });
    const driver = (Queue as any).resolveDriver('redis'); const test = fixture();
    vi.spyOn(driver, 'getQueue').mockResolvedValue(test.queue);
    test.client.eval.mockResolvedValue([17, 0] as any);
    expect(await Queue.pruneOperations('orders', 'redis', 7)).toEqual({ removed: 17, complete: false });
    expect(test.client.eval.mock.calls[0].slice(-4)).toEqual(['test:orders:svelar:operations:v1', 604800000, 1000, 7]);
    await expect(Queue.pruneOperations('orders', 'redis', 0)).rejects.toThrow('limit');
    Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
    await expect(Queue.pruneOperations()).rejects.toThrow('unsupported');
  });
});

describe('Finite Redis worker event-handler drain', () => {
  function workerFixture(policy: QueueOperationsIndexPolicy = 'failures-only') {
    Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis', workerHeartbeat: false, operationsIndex: policy } } });
    const test = fixture(policy); const order: string[] = []; const workers: FakeWorker[] = [];
    const store = { store: vi.fn(async (_job: any, _error: Error) => {}), storeRaw: vi.fn(async (_job: any, _error: Error) => {}) };
    (Queue as any).failedStore = store;
    const driver = (Queue as any).resolveDriver('redis');
    class FakeWorker extends EventEmitter {
      opts: any;
      closed = false;
      constructor(_name: string, private processor: (job: any) => Promise<void>, options: any) {
        super(); this.opts = { lockDuration: 30000, ...options }; workers.push(this);
      }
      async startStalledCheckTimer() {}
      async pause() { order.push('pause'); }
      async getNextJob() { return [...test.jobs.values()].find(job => job.state === 'waiting'); }
      async processJob(job: any) {
        job.state = 'active'; job.attemptsStarted++;
        job.getState.mockImplementation(async () => {
          order.push('state:start');
          await new Promise<void>(resolve => setImmediate(resolve));
          if (this.closed) throw new Error('Connection is closed.');
          order.push('state:finish'); return job.state;
        });
        try {
          await this.processor(job); job.attemptsMade++; job.state = 'completed'; job.finishedOn = Date.now(); this.emit('completed', job);
        } catch (error) {
          job.attemptsMade++; job.state = job.attemptsMade >= job.opts.attempts ? 'failed' : 'waiting'; this.emit('failed', job, error);
        }
      }
      async close() { this.closed = true; order.push('close'); }
    }
    driver._bullmq = { Worker: FakeWorker };
    vi.spyOn(driver, 'getQueue').mockResolvedValue(test.queue);
    vi.spyOn(driver, 'size').mockResolvedValue(1);
    const seen: any[] = []; let failing = true;
    class DrainJob extends Job {
      async handle() { seen.push(['handle', this.attempts, ApplicationContext.snapshot()]); if (failing) throw new Error('retry me'); }
      retrying(attempt: number) { seen.push(['retrying', attempt, ApplicationContext.snapshot()]); }
      failed() { seen.push(['failed', this.attempts, ApplicationContext.snapshot()]); }
    }
    const name = `drain-${crypto.randomUUID()}`;
    Queue.register(DrainJob, { name });
    const job = test.job('drain', { data: { jobClass: name, payload: '{}', context: { teamId: 'original', userId: 'actor' }, metadata: { resourceId: 'invoice' } } });
    return { ...test, order, workers, store, seen, job, recover: () => { failing = false; } };
  }

  it('drains retry handlers before disconnect, then captures terminal success in another finite worker', async () => {
    const test = workerFixture();
    expect(await Queue.work({ queue: 'orders', maxJobs: 1 })).toBe(0);
    expect(test.workers[0].closed).toBe(true);
    expect(test.order.lastIndexOf('state:finish')).toBeLessThan(test.order.indexOf('close'));
    expect(test.store.store).not.toHaveBeenCalled();
    expect(test.job.state).toBe('waiting'); expect(test.job.attemptsMade).toBe(1);
    expect(test.seen.map(entry => [entry[0], entry[1], entry[2].teamId, entry[2].userId]))
      .toEqual([['handle', 1, 'original', 'actor'], ['retrying', 1, 'original', 'actor']]);
    test.recover();
    expect(await Queue.work({ queue: 'orders', maxJobs: 1 })).toBe(1);
    expect(JSON.parse(test.records.get(test.job.id)!)).toMatchObject({ status: 'completed', attempts: 2, metadata: { resourceId: 'invoice' } });
  });

  it('off leaves retries and terminal failure hooks/ledger intact, without index writes', async () => {
    const test = workerFixture('off'); test.job.opts.attempts = 2;
    expect(await Queue.work({ queue: 'orders', maxJobs: 2 })).toBe(0);
    expect(test.store.store).toHaveBeenCalledOnce();
    expect(test.store.store.mock.calls[0][0]).toMatchObject({ attempts: 2, maxAttempts: 2, context: { teamId: 'original', userId: 'actor' }, metadata: { resourceId: 'invoice' } });
    expect(test.seen.at(-1)[0]).toBe('failed');
    expect(test.client.eval).not.toHaveBeenCalled();
  });

  it('propagates asynchronous failure-ledger errors after draining and still closes native resources', async () => {
    const test = workerFixture('off'); test.job.opts.attempts = 1;
    test.store.store.mockRejectedValue(new Error('failure ledger denied'));
    const error = await Queue.work({ queue: 'orders', maxJobs: 1 }).then(() => null, error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((entry: Error) => entry.message)).toContain('failure ledger denied');
    expect(test.workers[0].closed).toBe(true);
  });

  it('shutdown waits for a pending terminal ledger write before disconnecting', async () => {
    const test = workerFixture('off'); test.job.opts.attempts = 1;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    test.store.store.mockImplementation(async () => { await gate; test.order.push('ledger:finished'); });
    const work = Queue.work({ queue: 'orders', maxJobs: 1 });
    let stopping: Promise<void> | undefined;
    try {
      await vi.waitFor(() => expect(test.store.store).toHaveBeenCalledOnce());
      stopping = Queue.stop();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(test.workers[0].closed).toBe(false);
    } finally {
      release();
      await stopping;
      await work;
    }
    expect(test.order.indexOf('ledger:finished')).toBeLessThan(test.order.indexOf('close'));
    expect(test.workers[0].closed).toBe(true);
  });

  it('does not hide an index capture failure during async completion', async () => {
    const test = workerFixture('full'); test.recover();
    test.client.eval.mockImplementation(async (_script, keys, ...args) => {
      if (keys === 2 && args[4] === 'completed') throw new Error('index denied');
      return 1;
    });
    await expect(Queue.work({ queue: 'orders', maxJobs: 1 })).rejects.toThrow('Failed to persist queue failures');
    expect(test.workers[0].closed).toBe(true);
  });
});
