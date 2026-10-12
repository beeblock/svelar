import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { CreateSvelarJobsTable } from '../src/database/core/00000000_000026_create_svelar_jobs_table.js';
import { CreateSvelarFailedJobsTable } from '../src/database/core/00000000_000027_create_svelar_failed_jobs_table.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Job, Queue } from '../src/queue/index.js';
import { JobMonitor, RedisJobScanLimitError, type JobFilter } from '../src/queue/JobMonitor.js';

const now = 1_800_000_000_000;
const nowSec = now / 1000;

async function liveRow(id: string, createdAt: number, options: Record<string, any> = {}) {
  const { jobClass = 'MonitorJob', ...columns } = options;
  await new QueryBuilder('svelar_jobs').insert({
    id, queue: 'emails', payload: JSON.stringify({ jobClass, payload: '{}' }),
    attempts: 2, max_attempts: 3, reserved_at: null,
    available_at: nowSec - 100, created_at: createdAt, ...columns,
  });
}

async function failedRow(id: string, failedAt: number, queue = 'emails', jobClass = 'MonitorJob') {
  await new QueryBuilder('svelar_failed_jobs').insert({
    id, queue, job_class: jobClass, payload: '{}', exception: 'monitor test failure', failed_at: failedAt,
  });
}

function redisJob(id: string, timestamp: number, status = 'waiting', options: Record<string, any> = {}) {
  return {
    id, timestamp, name: 'MonitorJob', data: { jobClass: 'MonitorJob' },
    opts: { attempts: 3 }, attemptsMade: 1, getState: vi.fn(async () => status),
    retry: vi.fn(async () => {}), remove: vi.fn(async () => {}), ...options,
  };
}

function redisQueue(jobs: ReturnType<typeof redisJob>[] = []) {
  return {
    jobs,
    getJob: vi.fn(async (id: string) => jobs.find(job => String(job.id) === id) ?? null),
    getJobs: vi.fn(async (statuses: string[], start = 0, end = -1) => {
      const matches = [];
      for (const job of jobs) {
        const state = await job.getState();
        if (statuses.includes(state) || (state === 'waiting' && statuses.includes('wait'))
          || (state === 'paused' && statuses.includes('waiting'))) matches.push(job);
      }
      return matches.slice(start, end === -1 ? undefined : end + 1);
    }),
    getWaiting: vi.fn(async (start: number, end: number) => {
      const matches = [];
      for (const job of jobs) {
        if (['waiting', 'paused'].includes(await job.getState())) matches.push(job);
      }
      return matches.slice(start, end + 1);
    }),
    getJobCounts: vi.fn(async (...statuses: string[]) => {
      const counts: Record<string, number> = {};
      for (const job of jobs) {
        const state = await job.getState();
        if (state === 'waiting' && statuses.includes('wait')) {
          counts.wait = (counts.wait ?? 0) + 1;
          continue;
        }
        if (statuses.includes(state) || (state === 'paused' && statuses.includes('waiting'))) {
          counts[state] = (counts[state] ?? 0) + 1;
        }
      }
      return counts;
    }),
    getWorkers: vi.fn(async (): Promise<any[]> => []),
    isPaused: vi.fn(async () => false),
    getGlobalConcurrency: vi.fn(async (): Promise<number | null> => null),
    close: vi.fn(async () => {}),
  };
}

describe.sequential('JobMonitor contracts', () => {
  let redisQueues: Map<string, ReturnType<typeof redisQueue>>;
  let opened: string[];

  function configure(driver: 'database' | 'redis' | 'memory' | 'sync', queue = 'default', redisScanLimit?: number) {
    const config = { default: 'monitor', connections: { monitor: { driver, queue } } };
    Queue.configure(config);
    JobMonitor.configure({ ...config, driver, redisScanLimit });
    vi.spyOn(Queue, 'queues').mockReturnValue([
      { name: queue, connection: 'monitor' },
      { name: 'emails', concurrency: 99 },
      { name: 'pdf', connection: 'monitor' },
      { name: 'external', connection: 'another-connection' },
    ]);
  }

  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } },
    });
    await new CreateSvelarJobsTable().up();
    await new CreateSvelarFailedJobsTable().up();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    opened = [];
    redisQueues = new Map();
    (JobMonitor as any)._bullmq = {
      Queue: class {
        constructor(name: string) {
          opened.push(name);
          if (!redisQueues.has(name)) redisQueues.set(name, redisQueue());
          return redisQueues.get(name)! as any;
        }
      },
    };
    configure('database');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    (JobMonitor as any)._bullmq = null;
    Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
    JobMonitor.configure({ driver: 'sync', default: 'sync', connections: { sync: { driver: 'sync' } } });
    await Connection.disconnect();
  });

  it('scopes Redis numeric IDs to the explicit queue for reads, retries and deletion', async () => {
    configure('redis');
    const defaultJob = redisJob('1', now - 1000, 'failed');
    const emailJob = redisJob('1', now - 2000, 'failed');
    redisQueues.set('default', redisQueue([defaultJob]));
    redisQueues.set('emails', redisQueue([emailJob]));

    await expect(JobMonitor.getJob('1', 'emails')).resolves.toMatchObject({ queue: 'emails', id: '1' });
    await expect(JobMonitor.retryJob('1', 'emails')).resolves.toBe(true);
    await expect(JobMonitor.deleteJob('1', 'emails')).resolves.toBe(true);
    expect(emailJob.retry).toHaveBeenCalledOnce();
    expect(emailJob.remove).toHaveBeenCalledOnce();
    expect(defaultJob.retry).not.toHaveBeenCalled();
    expect(defaultJob.remove).not.toHaveBeenCalled();
    expect(opened.every(name => name === 'emails')).toBe(true);
    expect(redisQueues.get('emails')!.close).toHaveBeenCalledTimes(opened.length);
  });

  it('uses the configured Redis default queue when the queue argument is omitted', async () => {
    configure('redis', 'emails');
    const job = redisJob('2', now - 1000, 'failed');
    redisQueues.set('emails', redisQueue([job]));
    await expect(JobMonitor.getJob('2')).resolves.toMatchObject({ queue: 'emails' });
    await expect(JobMonitor.retryJob('2')).resolves.toBe(true);
    await expect(JobMonitor.deleteJob('2')).resolves.toBe(true);
    expect(new Set(opened)).toEqual(new Set(['emails']));
  });

  it.each(['redis', 'database', 'memory', 'sync'] as const)(
    'does not read, retry or delete a persisted failure from the wrong queue (%s)', async driver => {
      configure(driver);
      await failedRow('shared-id', nowSec - 100, 'emails');
      const retry = vi.spyOn(Queue, 'retry');
      await expect(JobMonitor.getJob('shared-id', 'pdf')).resolves.toBeNull();
      await expect(JobMonitor.retryJob('shared-id', 'pdf')).resolves.toBe(false);
      await expect(JobMonitor.deleteJob('shared-id', 'pdf')).resolves.toBe(false);
      expect(retry).not.toHaveBeenCalled();
      expect(await new QueryBuilder('svelar_failed_jobs').count()).toBe(1);
    },
  );

  it('does not fall back to another Redis queue for a missing explicit ID', async () => {
    configure('redis');
    const job = redisJob('1', now, 'failed');
    redisQueues.set('default', redisQueue([job]));
    await expect(JobMonitor.getJob('1', 'missing-queue')).resolves.toBeNull();
    await expect(JobMonitor.retryJob('1', 'missing-queue')).resolves.toBe(false);
    await expect(JobMonitor.deleteJob('1', 'missing-queue')).resolves.toBe(false);
    expect(job.retry).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
    expect(opened).not.toContain('default');
  });

  it('does not confuse a Redis job with a same-ID persisted failure on another queue', async () => {
    configure('redis');
    const job = redisJob('1', now - 1000, 'failed');
    redisQueues.set('emails', redisQueue([job]));
    await failedRow('1', nowSec - 10, 'pdf');
    const retry = vi.spyOn(Queue, 'retry');
    await expect(JobMonitor.getJob('1', 'emails')).resolves.toMatchObject({ queue: 'emails' });
    await expect(JobMonitor.retryJob('1', 'emails')).resolves.toBe(true);
    await expect(JobMonitor.deleteJob('1', 'emails')).resolves.toBe(true);
    expect(retry).not.toHaveBeenCalled();
    expect(job.retry).toHaveBeenCalledOnce();
    expect(job.remove).toHaveBeenCalledOnce();
    expect(await new QueryBuilder('svelar_failed_jobs').first()).toMatchObject({ id: '1', queue: 'pdf' });
  });

  it.each(['database', 'redis'] as const)('fails closed for overlapping live and persisted IDs (%s)', async driver => {
    configure(driver);
    await failedRow('1', nowSec - 10);
    const job = redisJob('1', now - 1000, 'failed');
    if (driver === 'database') await liveRow('1', nowSec - 1);
    else redisQueues.set('emails', redisQueue([job]));
    const retry = vi.spyOn(Queue, 'retry');

    await expect(JobMonitor.getJob('1', 'emails')).resolves.toBeNull();
    await expect(JobMonitor.retryJob('1', 'emails')).resolves.toBe(false);
    await expect(JobMonitor.deleteJob('1', 'emails')).resolves.toBe(false);
    expect(retry).not.toHaveBeenCalled();
    expect(job.retry).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
    expect(await new QueryBuilder('svelar_failed_jobs').count()).toBe(1);
    if (driver === 'database') expect(await new QueryBuilder('svelar_jobs').count()).toBe(1);
  });

  it('scopes database rows for reads and deletion, and never retries live reservations', async () => {
    await liveRow('reserved', nowSec - 10, { reserved_at: 0 });
    await expect(JobMonitor.getJob('reserved', 'pdf')).resolves.toBeNull();
    await expect(JobMonitor.deleteJob('reserved', 'pdf')).resolves.toBe(false);
    await expect(JobMonitor.getJob('reserved', 'emails')).resolves.toMatchObject({ status: 'active', processedAt: 0 });
    await expect(JobMonitor.retryJob('reserved', 'emails')).resolves.toBe(false);
    expect(await new QueryBuilder('svelar_jobs').where('id', 'reserved').first()).toMatchObject({ reserved_at: 0, attempts: 2 });
    await expect(JobMonitor.deleteJob('reserved', 'emails')).resolves.toBe(true);
  });

  it('re-dispatches a scoped persisted failure to its original database queue', async () => {
    class MonitorRetryJob extends Job { async handle(): Promise<void> {} }
    Queue.register(MonitorRetryJob);
    await failedRow('failed-retry', nowSec - 10, 'emails', 'MonitorRetryJob');
    await expect(JobMonitor.retryJob('failed-retry', 'emails')).resolves.toBe(true);
    expect(await new QueryBuilder('svelar_jobs').first()).toMatchObject({ queue: 'emails' });
    expect(await new QueryBuilder('svelar_failed_jobs').count()).toBe(0);
  });

  it.each(['database', 'redis'] as const)('paginates one stable combined live/failed sequence (%s)', async driver => {
    configure(driver);
    // Insertion order intentionally differs from timestamp order.
    if (driver === 'database') {
      await liveRow('live-c', nowSec - 60);
      await liveRow('live-a', nowSec - 10);
      await liveRow('live-b', nowSec - 30);
    } else {
      redisQueues.set('emails', redisQueue([
        redisJob('live-c', now - 60000, 'completed'),
        redisJob('live-a', now - 10000, 'active'),
        redisJob('live-b', now - 30000),
      ]));
    }
    await failedRow('failed-a', nowSec - 20);
    await failedRow('failed-b', nowSec - 40);
    await failedRow('failed-c', nowSec - 50);
    await failedRow('wrong-queue', nowSec, 'pdf');

    const ids = [];
    for (const offset of [0, 2, 4, 6]) {
      ids.push(...(await JobMonitor.listJobs({ queue: 'emails', offset, limit: 2 })).map(job => job.id));
    }
    expect(ids).toEqual(['live-a', 'failed-a', 'live-b', 'failed-b', 'failed-c', 'live-c']);
  });

  it('uses deterministic tie breakers across live and failed database rows', async () => {
    await liveRow('z', nowSec - 10);
    await failedRow('b', nowSec - 10);
    await liveRow('a', nowSec - 10);
    await failedRow('c', nowSec - 10);
    const jobs = [];
    for (let offset = 0; offset < 4; offset++) {
      jobs.push(...await JobMonitor.listJobs({ queue: 'emails', offset, limit: 1 }));
    }
    expect(jobs.map(job => job.id)).toEqual(['a', 'b', 'c', 'z']);
  });

  it('includes entire timestamp ties before paginating persisted failures across queues', async () => {
    await failedRow('z', nowSec - 10, 'pdf');
    await failedRow('z-email', nowSec - 10, 'emails');
    await failedRow('A', nowSec - 10, 'emails');
    await failedRow('a', nowSec - 10, 'emails');
    const ids = [];
    for (let offset = 0; offset < 4; offset++) {
      ids.push(...(await JobMonitor.listJobs({ status: 'failed', offset, limit: 1 })).map(job => job.id));
    }
    expect(ids).toEqual(['A', 'a', 'z-email', 'z']);
  });

  it.each(['database', 'redis'] as const)('filters job classes before applying pagination (%s)', async driver => {
    configure(driver);
    if (driver === 'database') {
      await liveRow('other', nowSec - 1, { jobClass: 'OtherJob' });
      await liveRow('matching-live', nowSec - 20);
    } else {
      redisQueues.set('emails', redisQueue([
        redisJob('other', now - 1000, 'waiting', { data: { jobClass: 'OtherJob' } }),
        redisJob('matching-live', now - 20000),
      ]));
    }
    await failedRow('matching-failed', nowSec - 30);
    expect((await JobMonitor.listJobs({ queue: 'emails', jobClass: 'MonitorJob', limit: 1, offset: 1 }))
      .map(job => job.id)).toEqual(['matching-failed']);
  });

  it('returns only supported database states and no retained completed jobs', async () => {
    await liveRow('waiting', nowSec - 10);
    await liveRow('active', nowSec - 9, { reserved_at: 0 });
    await liveRow('delayed', nowSec - 8, { available_at: nowSec + 60 });
    await failedRow('failed', nowSec - 7);
    for (const status of ['waiting', 'active', 'delayed', 'failed'] as const) {
      expect((await JobMonitor.listJobs({ queue: 'emails', status })).map(job => job.id)).toEqual([status]);
    }
    expect(await JobMonitor.listJobs({ status: 'completed' })).toEqual([]);
    expect(await JobMonitor.listJobs({ status: 'bogus' as JobFilter['status'] })).toEqual([]);
    await expect(JobMonitor.getCounts('emails')).resolves.toEqual({ waiting: 1, active: 1, delayed: 1, failed: 1, completed: 0, total: 4 });
  });

  it('uses native Redis state despite stale processed/delay fields and includes priority/paused jobs', async () => {
    configure('redis');
    redisQueues.set('emails', redisQueue([
      redisJob('retried', now - 1000, 'waiting', { processedOn: now - 5000, delay: 5000 }),
      redisJob('priority', now - 2000, 'prioritized'),
      redisJob('paused', now - 3000, 'paused'),
      redisJob('complete', now - 4000, 'completed', { failedReason: 'previous retry error' }),
      redisJob('unknown', now - 5000, 'unknown'),
    ]));
    expect((await JobMonitor.listJobs({ queue: 'emails', status: 'waiting' })).map(job => job.id))
      .toEqual(['retried', 'priority', 'paused']);
    await expect(JobMonitor.getJob('complete', 'emails')).resolves.toMatchObject({ status: 'completed' });
    await expect(JobMonitor.getJob('unknown', 'emails')).resolves.toBeNull();
    await expect(JobMonitor.retryJob('retried', 'emails')).resolves.toBe(false);
    await expect(JobMonitor.getCounts('emails')).resolves.toMatchObject({ waiting: 3, completed: 1, total: 4 });
  });

  it('validates pagination and returns an empty zero-size page without querying Redis', async () => {
    configure('redis');
    expect(await JobMonitor.listJobs({ limit: 0 })).toEqual([]);
    expect(opened).toEqual([]);
    for (const filter of [{ offset: -1 }, { limit: -1 }, { limit: NaN }, { offset: 0.5 }]) {
      await expect(JobMonitor.listJobs(filter)).rejects.toThrow(RangeError);
    }
  });

  it('reports public Redis worker/pause/cap observations and bounded waiting-head age, not an absolute oldest', async () => {
    configure('redis');
    const queue = redisQueue([
      redisJob('recent', now - 1000), redisJob('oldest', now - 60000, 'prioritized'),
      redisJob('delayed', now - 600000, 'delayed'),
    ]);
    queue.getWorkers.mockResolvedValue([{ id: '101' }, { id: '102' }]);
    queue.getGlobalConcurrency.mockResolvedValue(4);
    redisQueues.set('emails', queue);
    const health = await JobMonitor.getHealth();
    expect(health.runtime.emails).toMatchObject({
      workers: null, paused: false, globalConcurrency: 4, effectiveConcurrency: null,
      oldestWaitingJob: null, lag: null, nextWaitingJob: now - 1000, nextWaitingLag: 1000,
    });
    expect(health.runtime.emails.workerTelemetry).toMatchObject({ source: 'unavailable', complete: false });
    expect(queue.getWorkers).not.toHaveBeenCalled();
    expect(health.oldestWaitingJob).toBeUndefined();
    expect(queue.getWaiting).toHaveBeenCalledExactlyOnceWith(0, 0);
    expect(queue.getJobs).not.toHaveBeenCalled();
    expect(health.queues).toHaveProperty('pdf');
    expect(health.registry).toContainEqual({ name: 'external', connection: 'another-connection' });
    expect(health.runtime.external).toBeUndefined();
    expect(opened).not.toContain('external');

    queue.isPaused.mockResolvedValue(true);
    expect((await JobMonitor.getHealth()).runtime.emails.effectiveConcurrency).toBe(0);
    queue.isPaused.mockResolvedValue(false);
    queue.getWorkers.mockResolvedValue([]);
    expect((await JobMonitor.getHealth()).runtime.emails).toMatchObject({ workers: null, effectiveConcurrency: null });
  });

  it('uses only a bounded public waiting-head read on a million-job Redis backlog', async () => {
    configure('redis');
    const queue = redisQueue();
    queue.getJobCounts.mockResolvedValue({ waiting: 1_000_000, prioritized: 2_000_000 });
    queue.getWaiting.mockResolvedValue([redisJob('next', now - 10000)]);
    queue.getJobs.mockRejectedValue(new Error('health must not scan job ranges'));
    redisQueues.set('emails', queue);

    const runtime = (await JobMonitor.getHealth()).runtime.emails;
    expect(runtime).toMatchObject({
      oldestWaitingJob: null, lag: null, nextWaitingJob: now - 10000, nextWaitingLag: 10000,
    });
    expect(queue.getWaiting).toHaveBeenCalledExactlyOnceWith(0, 0);
    expect(queue.getJobs).not.toHaveBeenCalled();
  });

  it('does not infer an absolute oldest timestamp from ordinary retry/LIFO queue order', async () => {
    configure('redis');
    const queue = redisQueue([
      redisJob('new-at-head', now - 1000), redisJob('old-behind', now - 60000),
    ]);
    redisQueues.set('emails', queue);
    expect((await JobMonitor.getHealth()).runtime.emails).toMatchObject({
      oldestWaitingJob: null, lag: null, nextWaitingJob: now - 1000, nextWaitingLag: 1000,
    });
    expect(queue.getWaiting).toHaveBeenCalledExactlyOnceWith(0, 0);
  });

  it('keeps prioritized-only or missing head observations unknown and empty backlog lag zero', async () => {
    configure('redis');
    const priorityQueue = redisQueue([redisJob('priority', now - 60000, 'prioritized')]);
    redisQueues.set('emails', priorityQueue);
    expect((await JobMonitor.getHealth()).runtime.emails).toMatchObject({
      oldestWaitingJob: null, lag: null, nextWaitingJob: null, nextWaitingLag: null,
    });
    const missingHeadQueue = redisQueue();
    missingHeadQueue.getJobCounts.mockResolvedValue({ waiting: 1 });
    redisQueues.set('emails', missingHeadQueue);
    expect((await JobMonitor.getHealth()).runtime.emails.lag).toBeNull();
    redisQueues.set('emails', redisQueue());
    expect((await JobMonitor.getHealth()).runtime.emails).toMatchObject({
      oldestWaitingJob: null, lag: 0, nextWaitingJob: null, nextWaitingLag: null,
    });
  });

  it('bounds the generic getter fallback when getWaiting is unavailable', async () => {
    configure('redis');
    const queue = redisQueue([redisJob('next', now - 10000)]);
    delete (queue as any).getWaiting;
    redisQueues.set('emails', queue);
    expect((await JobMonitor.getHealth()).runtime.emails.nextWaitingLag).toBe(10000);
    expect(queue.getJobs).toHaveBeenCalledExactlyOnceWith(['waiting'], 0, 0, true);
  });

  it('rejects million-job creation-order listings before fetching any Redis jobs', async () => {
    configure('redis');
    const queue = redisQueue();
    queue.getJobCounts.mockImplementation(async (...statuses: string[]) => Object.fromEntries(
      statuses.map(status => [status, 1_000_000]),
    ));
    redisQueues.set('emails', queue);
    for (const filter of [{}, { status: 'waiting' as const }, { jobClass: 'MonitorJob' }]) {
      await expect(JobMonitor.listJobs({ queue: 'emails', limit: 25, ...filter }))
        .rejects.toMatchObject({ name: 'RedisJobScanLimitError', queue: 'emails', scanLimit: 1000 });
    }
    expect(queue.getJobs).not.toHaveBeenCalled();
    expect(queue.close).toHaveBeenCalledTimes(3);
  });

  it('keeps exact combined pagination within a configured Redis scan limit using finite state ranges', async () => {
    configure('redis', 'default', 3);
    const queue = redisQueue([
      redisJob('new', now - 1000), redisJob('old', now - 3000, 'completed'),
      redisJob('middle', now - 2000, 'prioritized'),
    ]);
    redisQueues.set('emails', queue);
    await failedRow('failure', nowSec - 2);
    expect((await JobMonitor.listJobs({ queue: 'emails', offset: 1, limit: 2 })).map(job => job.id))
      .toEqual(['failure', 'middle']);
    expect(queue.getJobs).toHaveBeenCalled();
    for (const [statuses, start, end] of queue.getJobs.mock.calls) {
      expect(statuses).toHaveLength(1);
      expect(start).toBe(0);
      expect(end).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(3);
    }
  });

  it('detects backlog growth with a bounded lookahead instead of truncating the combined page', async () => {
    configure('redis', 'default', 3);
    const queue = redisQueue();
    queue.getJobCounts.mockResolvedValue({ wait: 1 });
    queue.getJobs.mockImplementation(async (_statuses: string[], start = 0, end = -1) => {
      expect(start).toBe(0);
      expect(end).toBe(3);
      return Array.from({ length: end + 1 }, (_, index) => redisJob(String(index), now - index));
    });
    redisQueues.set('emails', queue);
    await expect(JobMonitor.listJobs({ queue: 'emails', limit: 1 })).rejects.toBeInstanceOf(RedisJobScanLimitError);
    expect(queue.getJobs).toHaveBeenCalledExactlyOnceWith(['wait'], 0, 3);
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it('bounds cumulative scans across states even when each state has grown since the count', async () => {
    configure('redis', 'default', 3);
    const queue = redisQueue();
    queue.getJobCounts.mockResolvedValue({});
    queue.getJobs.mockImplementation(async (statuses: string[], _start = 0, end = -1) => {
      const jobs = Array.from({ length: 2 }, (_, index) => redisJob(`${statuses[0]}-${index}`, now - index));
      return jobs.slice(0, end + 1);
    });
    redisQueues.set('emails', queue);
    await expect(JobMonitor.listJobs({ queue: 'emails' })).rejects.toMatchObject({ scanLimit: 3, observedJobs: 4 });
    expect(queue.getJobs.mock.calls).toEqual([[['wait'], 0, 3], [['paused'], 0, 1]]);
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it('validates the Redis scan budget before replacing monitor configuration', () => {
    for (const redisScanLimit of [0, -1, 0.5, NaN, Infinity]) {
      expect(() => JobMonitor.configure({
        driver: 'redis', default: 'redis', connections: { redis: { driver: 'redis' } }, redisScanLimit,
      })).toThrow(RangeError);
    }
  });

  it.each(['placeholder', 'permission', 'missing'] as const)('keeps unavailable Redis worker state unknown (%s)', async unavailable => {
    configure('redis');
    const queue = redisQueue();
    if (unavailable === 'placeholder') queue.getWorkers.mockResolvedValue([{ name: 'GCP does not support client list' }]);
    else if (unavailable === 'permission') queue.getWorkers.mockRejectedValue(new Error('NOPERM CLIENT LIST'));
    else delete (queue as any).getWorkers;
    delete (queue as any).getGlobalConcurrency;
    redisQueues.set('emails', queue);
    expect((await JobMonitor.getHealth()).runtime.emails).toMatchObject({
      workers: null, globalConcurrency: null, effectiveConcurrency: null, paused: false,
    });
  });

  it('surfaces Redis observation errors and still closes monitor connections', async () => {
    configure('redis', 'emails');
    const queue = redisQueue();
    queue.isPaused.mockRejectedValue(new Error('Redis disconnected'));
    redisQueues.set('emails', queue);
    await expect(JobMonitor.getHealth()).rejects.toThrow('Redis disconnected');
    expect(queue.close).toHaveBeenCalledTimes(2);
  });

  it.each(['memory', 'sync', 'database'] as const)('does not manufacture worker health for %s', async driver => {
    configure(driver);
    await liveRow('waiting-oldest', nowSec - 60);
    await liveRow('active-older', nowSec - 600, { reserved_at: nowSec - 100 });
    await liveRow('delayed-older', nowSec - 700, { available_at: nowSec + 100 });
    const state = (await JobMonitor.getHealth()).runtime.emails;
    expect(state).toMatchObject({ workers: null, paused: null, globalConcurrency: null, effectiveConcurrency: null });
    expect(state.lag).toBe(driver === 'database' ? 60000 : null);
    expect(state.oldestWaitingJob).toBe(driver === 'database' ? now - 60000 : null);
    expect(opened).toEqual([]);
  });
});
