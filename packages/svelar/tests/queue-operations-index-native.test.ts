import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { Job, Queue, type QueueOperationsIndexPolicy } from '../src/queue/index.js';
import { RedisQueueOperations } from '../src/queue/RedisOperations.js';
import { ApplicationContext } from '../src/support/Context.js';

const url = process.env.SVELAR_TEST_QUEUE_REDIS_URL;
const manifest = process.env.SVELAR_TEST_QUEUE_CLIENT;

class PolicyNativeJob extends Job {
  static seen: any[] = [];
  static recovered = false;
  constructor(public failUntilAttempt = 0) { super(); this.retryDelay = 0; }
  async handle() {
    PolicyNativeJob.seen.push({ attempts: this.attempts, context: ApplicationContext.snapshot() });
    if (!PolicyNativeJob.recovered && this.attempts <= this.failUntilAttempt) throw new Error('Native policy retry');
  }
}

describe.skipIf(!url || !manifest)('Native Redis operations-index policies, retention and finite retries', () => {
  let native: any;
  let redis: any;
  let prefix: string;
  beforeAll(async () => {
    const require = createRequire(resolve(manifest!));
    native = require('bullmq');
    const Redis = require('ioredis'); redis = new Redis(url);
  });
  beforeEach(async () => {
    prefix = `svelar-policy-${crypto.randomUUID()}`;
    PolicyNativeJob.seen = []; PolicyNativeJob.recovered = false;
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    await new Migrator().fresh(svelarCoreMigrations());
    configure(); Queue.register(PolicyNativeJob);
  });
  afterEach(async () => {
    try { await Queue.stop(); }
    finally {
      await Connection.disconnect();
      const keys = await redis.keys(`${prefix}:*`); if (keys.length) await redis.del(...keys);
    }
  });
  afterAll(async () => { await redis?.quit(); });

  function configure(operationsIndex: QueueOperationsIndexPolicy = 'full') {
    Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis', url, prefix, workerHeartbeat: false,
      operationsIndex, defaultJobOptions: { removeOnComplete: false, removeOnFail: false } } }, queues: [{ name: 'orders', connection: 'redis' }] });
    // Resolve optional peers from the caller-owned native fixture, without installing them in core.
    (Queue as any).resolveDriver('redis')._bullmq = native;
  }
  async function operations(policy: QueueOperationsIndexPolicy) {
    const queue = await (Queue as any).resolveDriver('redis').getQueue('orders');
    return { queue, operations: new RedisQueueOperations(async () => queue, 'redis', 'orders', policy),
      namespace: queue.toKey('svelar:operations:v1') };
  }
  function snapshot(id: string, state: string, finishedOn = Date.now()) {
    return { id, name: 'PolicyNativeJob', timestamp: Date.now() - 86400000, finishedOn,
      attemptsMade: state === 'completed' ? 1 : 0, attemptsStarted: 1, opts: { attempts: 3 },
      data: { payload: '{}', replayRecordId: 'protected-replay', metadata: { tenantId: 'tenant', resourceId: id } },
      getState: async () => state };
  }

  it.each(['failures-only', 'off'] as const)('%s clean jobs leave no operations keys and keep native counts/metrics', async policy => {
    configure(policy);
    const id = await Queue.dispatch(new PolicyNativeJob(), { queue: 'orders', priority: 1 });
    const adapter = Queue.adapter('orders', 'redis');
    expect(await adapter.runtime()).toMatchObject({ oldestWaitingAt: null, lag: null, stalled: null, expiredLocks: null, locksComplete: false });
    expect(await Queue.work({ queue: 'orders', maxJobs: 1 })).toBe(1);
    expect(await adapter.get(id)).toBeNull();
    expect(await adapter.counts()).toMatchObject({ completed: 1, failed: 0, deadLetter: 0 });
    expect((await adapter.metrics()).completed).toBe(1);
    expect(await redis.keys(`${prefix}:orders:svelar:operations:v1*`)).toEqual([]);
  });

  it('drains the real BullMQ retry/getState handler before finite close and retains a later success', async () => {
    configure('failures-only');
    const id = await Queue.dispatch(new PolicyNativeJob(1), { queue: 'orders', maxAttempts: 2,
      context: { teamId: 'original-team', userId: 'actor' }, metadata: { correlationId: 'native-trace' } });
    expect(await Queue.work({ queue: 'orders', maxJobs: 1 })).toBe(0);
    expect(await Queue.failed()).toHaveLength(0);
    expect(await Queue.work({ queue: 'orders', maxJobs: 1 })).toBe(1);
    const adapter = Queue.adapter('orders', 'redis');
    expect(await adapter.get(id)).toMatchObject({ status: 'completed', attempts: 2, metadata: { correlationId: 'native-trace' } });
    expect((await adapter.timeline({ source: 'live', id })).map(event => event.event)).toEqual(expect.arrayContaining(['retrying', 'failed', 'active', 'completed']));
    expect(PolicyNativeJob.seen.map(entry => [entry.attempts, entry.context.teamId, entry.context.userId]))
      .toEqual([[1, 'original-team', 'actor'], [2, 'original-team', 'actor']]);
  });

  it.each(['failures-only', 'off'] as const)('%s preserves the dead-letter ledger, idempotent replay, context and native delivery', async policy => {
    configure(policy);
    await Queue.dispatch(new PolicyNativeJob(99), { queue: 'orders', maxAttempts: 1,
      context: { teamId: 'replay-team', userId: 'actor' }, metadata: { resourceId: 'invoice' } });
    expect(await Queue.work({ queue: 'orders', maxJobs: 1 })).toBe(0);
    const adapter = Queue.adapter('orders', 'redis'); const [record] = await adapter.deadLetters();
    expect(record).toMatchObject({ maxAttempts: 1, context: { teamId: 'replay-team', userId: 'actor' }, metadata: { resourceId: 'invoice' } });
    const result = await adapter.retry({ source: 'dead-letter', id: record.id });
    expect(result.outcome).toBe('accepted');
    expect((await adapter.retry({ source: 'dead-letter', id: record.id })).outcome).not.toBe('accepted');
    PolicyNativeJob.recovered = true;
    expect(await Queue.work({ queue: 'orders', maxJobs: 1 })).toBe(1);
    expect(PolicyNativeJob.seen.at(-1).context).toMatchObject({ teamId: 'replay-team', userId: 'actor' });
    const { queue } = await operations(policy);
    expect(await (await queue.getJob(result.replayJobId)).getState()).toBe('completed');
    if (policy === 'failures-only') expect(await adapter.get(result.replayJobId!)).toMatchObject({ status: 'completed', replayRecordId: record.id });
    else expect(await adapter.get(result.replayJobId!)).toBeNull();
  });

  it('bounds protected completed/failed snapshots, deletes hashes/index memberships/timelines and retains live history', async () => {
    const test = await operations({ maxJobs: 3, maxAgeSeconds: 3600 });
    const at = Date.now();
    for (const state of ['waiting', 'active', 'delayed']) await test.operations.capture(snapshot(`live-${state}`, state), state);
    const discarded: any[] = [];
    for (const state of ['completed', 'failed']) for (let index = 0; index < 20; index++) {
      const id = `${state}-${index}`;
      await test.operations.capture(snapshot(id, state, at + index), state);
      if (index === 0) discarded.push(JSON.parse(await redis.hget(`${test.namespace}:jobs`, id)));
    }
    expect(await redis.hlen(`${test.namespace}:jobs`)).toBe(9);
    for (const data of discarded) {
      expect(await redis.hget(`${test.namespace}:jobs`, data.id)).toBeNull();
      expect(await redis.exists(`${test.namespace}:timeline:${data.id}`)).toBe(0);
      for (const key of data.indexKeys) expect(await redis.zscore(key, data.id)).toBeNull();
    }
    for (const state of ['waiting', 'active', 'delayed']) expect(await redis.hget(`${test.namespace}:jobs`, `live-${state}`)).not.toBeNull();
  });

  it('prunes legacy protected terminal hashes in bounded passes, using finish rather than creation time', async () => {
    const test = await operations({ maxJobs: 1000, maxAgeSeconds: 3600 });
    const now = Date.now();
    for (let index = 0; index < 12; index++) {
      const id = `legacy-${index}`; const state = index % 2 ? 'completed' : 'failed';
      await test.operations.capture(snapshot(id, state, now - 120000), state);
      await redis.zadd(`${test.namespace}:status:${state}`, now - 86400000, id);
    }
    await test.operations.capture(snapshot('recent', 'completed', now), 'completed');
    await redis.zadd(`${test.namespace}:status:completed`, now - 86400000, 'recent');
    await test.operations.capture(snapshot('live', 'active'), 'active');
    const prune = (await operations({ maxJobs: 1000, maxAgeSeconds: 60 })).operations;
    let removed = 0; let complete = false;
    for (let pass = 0; pass < 20 && !complete; pass++) {
      const result = await prune.prune(2); removed += result.removed; complete = result.complete;
      expect(result.removed).toBeLessThanOrEqual(4);
    }
    expect(complete).toBe(true); expect(removed).toBe(12);
    expect(await redis.hkeys(`${test.namespace}:jobs`)).toEqual(expect.arrayContaining(['recent', 'live']));
    expect(await redis.hlen(`${test.namespace}:jobs`)).toBe(2);
    expect(await prune.timeline('legacy-0')).toEqual([]);
    await prune.removeIndex('recent');
    expect(await prune.timeline('recent')).toEqual([]);
  });

  it('keeps terminal state against late active events but permits an explicit retry with reset counters', async () => {
    const test = await operations('full');
    const job = { ...snapshot('ordering', 'completed'), attemptsStarted: 3, attemptsMade: 3 };
    await test.operations.capture(job, 'completed', 'completed');
    const active = { ...job, finishedOn: undefined, attemptsStarted: 2 };
    expect(await test.operations.capture(active, 'active', 'active')).toBe(false);
    expect(JSON.parse(await redis.hget(`${test.namespace}:jobs`, job.id)).status).toBe('completed');
    const retried = { ...active, attemptsStarted: 0, attemptsMade: 0, getState: async () => 'waiting' };
    expect(await test.operations.capture(retried, 'retried')).toBe(true);
    expect(JSON.parse(await redis.hget(`${test.namespace}:jobs`, job.id)).status).toBe('waiting');
    await test.operations.capture({ ...retried, attemptsStarted: 1 }, 'active', 'active');
    expect(JSON.parse(await redis.hget(`${test.namespace}:jobs`, job.id)).status).toBe('active');
  });

  it('prunes the index of completed durable replays without deleting their broker id or ledger receipt', async () => {
    configure('failures-only');
    await Queue.dispatch(new PolicyNativeJob(99), { queue: 'orders', maxAttempts: 1 });
    await Queue.work({ queue: 'orders', maxJobs: 1 });
    const adapter = Queue.adapter('orders', 'redis'); const [record] = await adapter.deadLetters();
    const replay = await adapter.retry({ source: 'dead-letter', id: record.id }); PolicyNativeJob.recovered = true;
    await Queue.work({ queue: 'orders', maxJobs: 1 });
    Queue.registerQueue({ name: 'orders', connection: 'redis', operationsIndex: { mode: 'failures-only', maxJobs: 0 } });
    expect((await Queue.pruneOperations('orders', 'redis')).complete).toBe(true);
    const { queue, namespace } = await operations('failures-only');
    expect(await redis.hlen(`${namespace}:jobs`)).toBe(0);
    expect(await redis.keys(`${namespace}:timeline:*`)).toEqual([]);
    expect(await (await queue.getJob(replay.replayJobId)).getState()).toBe('completed');
    expect(await adapter.deadLetter(record.id)).toMatchObject({ id: record.id, replayJobId: replay.replayJobId });
  });
});
