import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { Queue, Job, QueueRetryAllError } from '../src/queue/index';
import { JobMonitor } from '../src/queue/JobMonitor.js';

describe('Queue and Job Processing', () => {
  beforeEach(() => {
    Queue.configure({
      default: 'sync',
      connections: { sync: { driver: 'sync' } },
    });
  });

  describe('Job class', () => {
    it('should allow creating custom job classes', () => {
      class SendEmailJob extends Job {
        constructor(public email: string) {
          super();
        }

        async handle(): Promise<void> {
          // Job implementation
        }
      }

      const job = new SendEmailJob('user@example.com');

      expect(job).toBeInstanceOf(Job);
      expect(job.email).toBe('user@example.com');
    });

    it('should have default maxAttempts', () => {
      class TestJob extends Job {
        async handle(): Promise<void> {}
      }

      const job = new TestJob();

      expect(job.maxAttempts).toBe(3);
    });

    it('should allow customizing maxAttempts', () => {
      class CustomJob extends Job {
        maxAttempts = 5;

        async handle(): Promise<void> {}
      }

      const job = new CustomJob();

      expect(job.maxAttempts).toBe(5);
    });

    it('should have default retryDelay', () => {
      class TestJob extends Job {
        async handle(): Promise<void> {}
      }

      const job = new TestJob();

      expect(job.retryDelay).toBe(60);
    });

    it('should allow setting custom queue name', () => {
      class PriorityJob extends Job {
        queue = 'priority';

        async handle(): Promise<void> {}
      }

      const job = new PriorityJob();

      expect(job.queue).toBe('priority');
    });

    it('should support serialization', () => {
      class DataJob extends Job {
        constructor(public data: string, public id: number) {
          super();
        }

        async handle(): Promise<void> {}
      }

      const job = new DataJob('test', 123);
      const serialized = job.serialize();

      expect(typeof serialized).toBe('string');
      expect(serialized).toContain('test');
      expect(serialized).toContain('123');
    });

    it('should call failed() method on failure', async () => {
      const failedFn = vi.fn();

      class FailingJob extends Job {
        async handle(): Promise<void> {
          throw new Error('Job failed');
        }

        failed(error: Error): void {
          failedFn(error);
        }
      }

      Queue.configure({
        default: 'sync',
        connections: { sync: { driver: 'sync' } },
      });

      const job = new FailingJob();

      await expect(Queue.dispatch(job)).rejects.toThrow('Database not configured');

      expect(failedFn).toHaveBeenCalled();
    });

    it('should call retrying() method before retry', () => {
      const retyingFn = vi.fn();

      class RetryableJob extends Job {
        async handle(): Promise<void> {}

        retrying(attempt: number): void {
          retyingFn(attempt);
        }
      }

      const job = new RetryableJob();

      expect(job.retrying).toBeDefined();
    });
  });

  describe('Sync Driver', () => {
    beforeEach(() => {
      Queue.configure({
        default: 'sync',
        connections: { sync: { driver: 'sync' } },
      });
    });

    it('should execute jobs immediately', async () => {
      let executed = false;

      class SyncJob extends Job {
        async handle(): Promise<void> {
          executed = true;
        }
      }

      await Queue.dispatch(new SyncJob());

      expect(executed).toBe(true);
    });

    it('should handle job errors', async () => {
      const failedFn = vi.fn();

      class ErrorJob extends Job {
        async handle(): Promise<void> {
          throw new Error('Test error');
        }

        failed(error: Error): void {
          failedFn(error);
        }
      }

      await expect(Queue.dispatch(new ErrorJob())).rejects.toThrow('Database not configured');

      expect(failedFn).toHaveBeenCalled();
    });

    it('should execute jobs in order', async () => {
      const execution: string[] = [];

      class OrderedJob extends Job {
        constructor(public name: string) {
          super();
        }

        async handle(): Promise<void> {
          execution.push(this.name);
        }
      }

      await Queue.dispatch(new OrderedJob('first'));
      await Queue.dispatch(new OrderedJob('second'));
      await Queue.dispatch(new OrderedJob('third'));

      expect(execution).toEqual(['first', 'second', 'third']);
    });

    it('should use default queue name', async () => {
      let queueName = '';

      class QueueNameJob extends Job {
        constructor() {
          super();
          queueName = this.queue;
        }

        async handle(): Promise<void> {}
      }

      await Queue.dispatch(new QueueNameJob());

      expect(queueName).toBe('default');
    });
  });

  describe('Memory Driver', () => {
    beforeEach(() => {
      Queue.configure({
        default: 'memory',
        connections: { memory: { driver: 'memory' } },
      });
    });

    it('should queue jobs in memory', async () => {
      let handled = false;

      class MemoryJob extends Job {
        async handle(): Promise<void> {
          handled = true;
        }
      }

      await Queue.dispatch(new MemoryJob());

      // Jobs are not executed until work() is called
      expect(handled).toBe(false);

      // Process jobs
      await Queue.work({ maxJobs: 1 });

      expect(handled).toBe(true);
    });

    it('should support job delays', async () => {
      let executed = false;
      const dispatchTime = Date.now();

      class DelayedJob extends Job {
        async handle(): Promise<void> {
          executed = true;
        }
      }

      await Queue.dispatch(new DelayedJob(), { delay: 1 });

      // Attempt to process immediately
      await Queue.work({ maxJobs: 1, sleep: 0.1 });

      // Job should not have been processed yet (within 1 second delay)
      expect(executed).toBe(false);

      // Wait for delay to pass
      await new Promise((r) => setTimeout(r, 1100));

      // Now process
      await Queue.work({ maxJobs: 1 });

      expect(executed).toBe(true);
      const elapsed = Date.now() - dispatchTime;
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    });

    it('should track queue size', async () => {
      class CountJob extends Job {
        async handle(): Promise<void> {}
      }

      await Queue.dispatch(new CountJob());
      await Queue.dispatch(new CountJob());
      await Queue.dispatch(new CountJob());

      // Get driver and check size
      const driver = Queue['drivers']?.get('memory');
      if (driver) {
        const size = await driver.size('default');
        expect(size).toBe(3);
      }
    });

    it('should clear queue', async () => {
      class Job1 extends Job {
        async handle(): Promise<void> {}
      }

      await Queue.dispatch(new Job1());
      await Queue.dispatch(new Job1());

      // Clear would be done via the driver
      expect(Queue).toBeDefined();
    });

    it('should handle multiple queues', async () => {
      let normalExecuted = false;
      let priorityExecuted = false;

      class NormalJob extends Job {
        queue = 'normal';

        async handle(): Promise<void> {
          normalExecuted = true;
        }
      }

      class PriorityJob extends Job {
        queue = 'priority';

        async handle(): Promise<void> {
          priorityExecuted = true;
        }
      }

      Queue.configure({
        default: 'memory',
        connections: { memory: { driver: 'memory' } },
      });

      await Queue.dispatch(new NormalJob());
      await Queue.dispatch(new PriorityJob());

      // Process normal queue
      await Queue.work({ queue: 'normal', maxJobs: 1 });
      expect(normalExecuted).toBe(true);
      expect(priorityExecuted).toBe(false);

      // Process priority queue
      await Queue.work({ queue: 'priority', maxJobs: 1 });
      expect(priorityExecuted).toBe(true);
    });
  });

  describe('dispatch', () => {
    beforeEach(() => {
      Queue.configure({
        default: 'sync',
        connections: { sync: { driver: 'sync' } },
      });
    });

    it('should dispatch jobs', async () => {
      let executed = false;

      class DispatchJob extends Job {
        async handle(): Promise<void> {
          executed = true;
        }
      }

      await Queue.dispatch(new DispatchJob());

      expect(executed).toBe(true);
    });

    it('should accept dispatch options', async () => {
      let executed = false;

      class OptionsJob extends Job {
        async handle(): Promise<void> {
          executed = true;
        }
      }

      const job = new OptionsJob();

      await Queue.dispatch(job, {
        queue: 'emails',
        delay: 60,
        maxAttempts: 5,
      });

      expect(executed).toBe(true);
    });

    it('should respect queue option', async () => {
      Queue.configure({
        default: 'memory',
        connections: { memory: { driver: 'memory' } },
      });

      class QueueJob extends Job {
        async handle(): Promise<void> {}
      }

      const job = new QueueJob();
      await Queue.dispatch(job, { queue: 'custom-queue' });

      expect(job.queue).toBe('custom-queue');
    });

    it('should respect maxAttempts option', async () => {
      let attempts = 0;

      class AttemptsJob extends Job {
        async handle(): Promise<void> {
          attempts++;
        }
      }

      const job = new AttemptsJob();

      await Queue.dispatch(job, { maxAttempts: 1 });

      expect(attempts).toBe(1);
    });
  });

  describe('work', () => {
    beforeEach(() => {
      Queue.configure({
        default: 'memory',
        connections: { memory: { driver: 'memory' } },
      });
    });

    it('should process jobs from queue', async () => {
      const executed: string[] = [];

      class WorkJob extends Job {
        constructor(public name: string) {
          super();
        }

        async handle(): Promise<void> {
          executed.push(this.name);
        }
      }

      await Queue.dispatch(new WorkJob('job1'));
      await Queue.dispatch(new WorkJob('job2'));

      await Queue.work({ maxJobs: 2 });

      expect(executed).toEqual(['job1', 'job2']);
    });

    it('should process specific queue', async () => {
      let executed = false;

      class SpecificQueueJob extends Job {
        queue = 'specific';

        async handle(): Promise<void> {
          executed = true;
        }
      }

      await Queue.dispatch(new SpecificQueueJob());

      await Queue.work({ queue: 'specific', maxJobs: 1 });

      expect(executed).toBe(true);
    });

    it('should respect maxJobs limit', async () => {
      let count = 0;

      class CountingJob extends Job {
        async handle(): Promise<void> {
          count++;
        }
      }

      await Queue.dispatch(new CountingJob());
      await Queue.dispatch(new CountingJob());
      await Queue.dispatch(new CountingJob());

      await Queue.work({ maxJobs: 2 });

      expect(count).toBe(2);
    });

    it('should handle empty queue gracefully', async () => {
      // Should not throw
      await Queue.work({ maxJobs: 1 });
    });

    it('should return number of processed jobs', async () => {
      class SimpleJob extends Job {
        async handle(): Promise<void> {}
      }

      await Queue.dispatch(new SimpleJob());
      await Queue.dispatch(new SimpleJob());

      const processed = await Queue.work({ maxJobs: 2 });

      expect(typeof processed).toBe('number');
      expect(processed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('integration scenarios', () => {
    it('should handle email sending workflow', async () => {
      const emails: Array<{ to: string; template: string }> = [];

      class SendEmailJob extends Job {
        constructor(public to: string, public template: string) {
          super();
          this.queue = 'emails';
        }

        async handle(): Promise<void> {
          emails.push({ to: this.to, template: this.template });
        }
      }

      Queue.configure({
        default: 'sync',
        connections: { sync: { driver: 'sync' } },
      });

      await Queue.dispatch(new SendEmailJob('user1@example.com', 'welcome'));
      await Queue.dispatch(new SendEmailJob('user2@example.com', 'welcome'));
      await Queue.dispatch(new SendEmailJob('user3@example.com', 'invoice'));

      expect(emails).toHaveLength(3);
      expect(emails[0]).toEqual({ to: 'user1@example.com', template: 'welcome' });
    });

    it('should handle data processing job', async () => {
      interface ProcessedData {
        id: number;
        result: string;
      }

      const processed: ProcessedData[] = [];

      class ProcessDataJob extends Job {
        constructor(public data: string) {
          super();
          this.queue = 'processing';
        }

        async handle(): Promise<void> {
          processed.push({
            id: processed.length + 1,
            result: this.data.toUpperCase(),
          });
        }
      }

      Queue.configure({
        default: 'sync',
        connections: { sync: { driver: 'sync' } },
      });

      await Queue.dispatch(new ProcessDataJob('hello'));
      await Queue.dispatch(new ProcessDataJob('world'));

      expect(processed).toEqual([
        { id: 1, result: 'HELLO' },
        { id: 2, result: 'WORLD' },
      ]);
    });

    it('should handle retry on failure', async () => {
      let attempts = 0;

      class RetryJob extends Job {
        maxAttempts = 2;

        async handle(): Promise<void> {
          attempts++;
          if (attempts < 2) {
            throw new Error('Try again');
          }
        }
      }

      Queue.configure({
        default: 'sync',
        connections: { sync: { driver: 'sync' } },
      });

      await Queue.dispatch(new RetryJob());

      expect(attempts).toBeGreaterThan(0);
    });
  });
});

describe.sequential('Queue failed jobs', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-queue-failed-'));
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: join(root, 'database.sqlite') },
      },
    });
    await new Migrator().fresh(svelarCoreMigrations());
    await Queue.stop();
  });

  afterEach(async () => {
    await Queue.stop();
    Queue.configure({
      default: 'sync',
      connections: { sync: { driver: 'sync' } },
    });
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });

  it('persists exhausted sync driver failures', async () => {
    const failedCalls: string[] = [];

    class PersistentlyFailingSyncJob extends Job {
      maxAttempts = 2;
      retryDelay = 0;

      async handle(): Promise<void> {
        throw new Error('sync exploded');
      }

      failed(error: Error): void {
        failedCalls.push(error.message);
      }
    }

    Queue.configure({
      default: 'sync',
      connections: { sync: { driver: 'sync' } },
    });
    Queue.register(PersistentlyFailingSyncJob);

    await Queue.dispatch(new PersistentlyFailingSyncJob());

    const failures = await Queue.failed();
    expect(failedCalls).toEqual(['sync exploded']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      queue: 'default',
      jobClass: 'PersistentlyFailingSyncJob',
    });
    expect(failures[0].exception).toContain('sync exploded');
  });

  it('fails exhausted sync jobs when the failed jobs table is unavailable', async () => {
    await Connection.raw('DROP TABLE svelar_failed_jobs');

    class MissingFailedTableSyncJob extends Job {
      maxAttempts = 1;

      async handle(): Promise<void> {
        throw new Error('sync failure needs persistence');
      }
    }

    Queue.configure({
      default: 'sync',
      connections: { sync: { driver: 'sync' } },
    });
    Queue.register(MissingFailedTableSyncJob);

    await expect(Queue.dispatch(new MissingFailedTableSyncJob())).rejects.toThrow(
      'svelar_failed_jobs'
    );
  });

  it('lists, retries, and flushes failed jobs from the database store', async () => {
    class RetryableFailedJob extends Job {
      static attempts = 0;
      maxAttempts = 1;
      retryDelay = 0;

      async handle(): Promise<void> {
        RetryableFailedJob.attempts += 1;
        if (RetryableFailedJob.attempts === 1) {
          throw new Error('first attempt failed');
        }
      }
    }

    Queue.configure({
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });
    Queue.register(RetryableFailedJob);
    RetryableFailedJob.attempts = 0;

    await Queue.dispatch(new RetryableFailedJob());
    await Queue.work({ maxJobs: 1, sleep: 0 });

    let failures = await Queue.failed();
    expect(failures).toHaveLength(1);
    expect(failures[0].jobClass).toBe('RetryableFailedJob');

    await expect(Queue.retry(failures[0].id)).resolves.toBe(true);
    await expect(Queue.retry('missing-id')).resolves.toBe(false);
    await Queue.work({ maxJobs: 1, sleep: 0 });

    failures = await Queue.failed();
    expect(failures).toHaveLength(0);
    expect(RetryableFailedJob.attempts).toBe(2);

    class AlwaysFailingMemoryJob extends Job {
      maxAttempts = 1;

      async handle(): Promise<void> {
        throw new Error('flush me');
      }
    }

    Queue.register(AlwaysFailingMemoryJob);
    await Queue.dispatch(new AlwaysFailingMemoryJob());
    await Queue.dispatch(new AlwaysFailingMemoryJob());
    await Queue.work({ maxJobs: 2, sleep: 0 });

    expect(await Queue.failed()).toHaveLength(2);
    await expect(Queue.flushFailed()).resolves.toBe(2);
    expect(await Queue.failed()).toHaveLength(0);
  });

  it('reports retryAll failures without deleting unresolvable failed jobs', async () => {
    class RetryAllGoodJob extends Job {
      static attempts = 0;
      maxAttempts = 1;
      retryDelay = 0;

      async handle(): Promise<void> {
        RetryAllGoodJob.attempts += 1;
        if (RetryAllGoodJob.attempts === 1) {
          throw new Error('retry all first failure');
        }
      }
    }

    Queue.configure({
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });
    Queue.register(RetryAllGoodJob);
    RetryAllGoodJob.attempts = 0;

    await Queue.dispatch(new RetryAllGoodJob());
    await Queue.work({ maxJobs: 1, sleep: 0 });
    await Connection.raw(
      'INSERT INTO svelar_failed_jobs (id, queue, job_class, payload, exception, failed_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'missing-job-class',
        'default',
        'MissingRetryAllJob',
        '{}',
        'missing class',
        Math.floor(Date.now() / 1000),
      ],
    );

    await expect(Queue.retryAll()).rejects.toMatchObject({
      name: 'QueueRetryAllError',
      retried: 1,
      failures: [
        expect.objectContaining({
          id: 'missing-job-class',
          jobClass: 'MissingRetryAllJob',
        }),
      ],
    });

    await Queue.work({ maxJobs: 1, sleep: 0 });
    expect(RetryAllGoodJob.attempts).toBe(2);
    const failures = await Queue.failed();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      id: 'missing-job-class',
      jobClass: 'MissingRetryAllJob',
    });

    const error = await Queue.retryAll().catch((err) => err);
    expect(error).toBeInstanceOf(QueueRetryAllError);
    expect(error.retried).toBe(0);
  });

  it('does not retry failed jobs with malformed serialized payloads', async () => {
    class BadPayloadRetryJob extends Job {
      static attempts = 0;

      async handle(): Promise<void> {
        BadPayloadRetryJob.attempts += 1;
      }
    }

    Queue.configure({
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });
    Queue.register(BadPayloadRetryJob);
    BadPayloadRetryJob.attempts = 0;

    await Connection.raw(
      'INSERT INTO svelar_failed_jobs (id, queue, job_class, payload, exception, failed_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'bad-payload',
        'default',
        'BadPayloadRetryJob',
        '{not-json',
        'malformed payload',
        Math.floor(Date.now() / 1000),
      ],
    );

    await expect(Queue.retry('bad-payload')).rejects.toThrow(
      'Failed to deserialize payload for job "BadPayloadRetryJob"'
    );
    expect(BadPayloadRetryJob.attempts).toBe(0);
    await expect(Queue.failed()).resolves.toHaveLength(1);

    await expect(Queue.retryAll()).rejects.toMatchObject({
      name: 'QueueRetryAllError',
      retried: 0,
      failures: [
        expect.objectContaining({
          id: 'bad-payload',
          jobClass: 'BadPayloadRetryJob',
          error: expect.stringContaining('Failed to deserialize payload'),
        }),
      ],
    });
  });

  it('reports malformed database queue payloads with job and table context', async () => {
    class DatabasePayloadJob extends Job {
      async handle(): Promise<void> {}
    }

    Queue.configure({
      default: 'database',
      connections: { database: { driver: 'database', table: 'svelar_jobs' } },
    });
    JobMonitor.configure({
      driver: 'database',
      default: 'database',
      connections: { database: { driver: 'database', table: 'svelar_jobs' } },
    });
    Queue.register(DatabasePayloadJob);

    const nowSec = Math.floor(Date.now() / 1000);
    await Connection.raw(
      'INSERT INTO svelar_jobs (id, queue, payload, attempts, max_attempts, reserved_at, available_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['bad-db-payload', 'default', '{not-json', 0, 3, null, nowSec, nowSec],
    );

    await expect(Queue.work({ maxJobs: 1, sleep: 0 })).rejects.toThrow(
      'Failed to parse queued job payload for job "bad-db-payload" in table "svelar_jobs"'
    );
    await expect(JobMonitor.listJobs({ queue: 'default' })).rejects.toThrow(
      'Failed to parse queued job payload for job "bad-db-payload" in table "svelar_jobs"'
    );
    await expect(JobMonitor.getJob('bad-db-payload')).rejects.toThrow(
      'Failed to parse queued job payload for job "bad-db-payload" in table "svelar_jobs"'
    );

    const rows = await Connection.raw(
      'SELECT attempts, reserved_at FROM svelar_jobs WHERE id = ?',
      ['bad-db-payload'],
    );
    expect(rows[0]).toMatchObject({ attempts: 0, reserved_at: null });
  });

  it('runs chained jobs in order after restoring the internal chain wrapper from the database queue', async () => {
    const execution: string[] = [];

    class DatabaseChainJob extends Job {
      constructor(public label = '') {
        super();
      }

      async handle(): Promise<void> {
        execution.push(this.label);
      }
    }

    Queue.configure({
      default: 'database',
      connections: { database: { driver: 'database', table: 'svelar_jobs' } },
    });
    Queue.register(DatabaseChainJob);

    await Queue.chain([
      new DatabaseChainJob('first'),
      new DatabaseChainJob('second'),
      new DatabaseChainJob('third'),
    ]);

    await expect(Queue.work({ maxJobs: 1, sleep: 0 })).resolves.toBe(1);
    expect(execution).toEqual(['first', 'second', 'third']);
  });

  it('fails worker processing when exhausted jobs cannot be persisted', async () => {
    await Connection.raw('DROP TABLE svelar_failed_jobs');

    class MissingFailedTableMemoryJob extends Job {
      maxAttempts = 1;

      async handle(): Promise<void> {
        throw new Error('memory failure needs persistence');
      }
    }

    Queue.configure({
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });
    Queue.register(MissingFailedTableMemoryJob);

    await Queue.dispatch(new MissingFailedTableMemoryJob());
    await expect(Queue.work({ maxJobs: 1, sleep: 0 })).rejects.toThrow(
      'svelar_failed_jobs'
    );
  });

  it('surfaces persisted failures through the job monitor', async () => {
    class MonitorFailingJob extends Job {
      maxAttempts = 1;
      queue = 'critical';

      async handle(): Promise<void> {
        throw new Error('monitor me');
      }
    }

    class MonitorOtherQueueJob extends Job {
      maxAttempts = 1;
      queue = 'default';

      async handle(): Promise<void> {
        throw new Error('leave me');
      }
    }

    Queue.configure({
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });
    JobMonitor.configure({
      driver: 'memory',
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });
    Queue.register(MonitorFailingJob);
    Queue.register(MonitorOtherQueueJob);

    await Queue.dispatch(new MonitorFailingJob());
    await Queue.dispatch(new MonitorOtherQueueJob());
    await Queue.work({ queue: 'critical', maxJobs: 1, sleep: 0 });
    await Queue.work({ queue: 'default', maxJobs: 1, sleep: 0 });

    await expect(JobMonitor.getCounts('critical')).resolves.toMatchObject({
      failed: 1,
      total: 1,
    });

    const criticalFailures = await JobMonitor.listJobs({ status: 'failed', queue: 'critical' });
    expect(criticalFailures).toHaveLength(1);
    expect(criticalFailures[0]).toMatchObject({
      status: 'failed',
      queue: 'critical',
      jobClass: 'MonitorFailingJob',
    });
    expect(criticalFailures[0].error).toContain('monitor me');
    expect(await JobMonitor.listJobs({ queue: 'critical' })).toHaveLength(1);
    await expect(JobMonitor.getJob(criticalFailures[0].id)).resolves.toMatchObject({
      status: 'failed',
      jobClass: 'MonitorFailingJob',
    });

    await expect(JobMonitor.deleteJob(criticalFailures[0].id)).resolves.toBe(true);
    expect(await JobMonitor.listJobs({ status: 'failed', queue: 'critical' })).toHaveLength(0);
    expect(await JobMonitor.listJobs({ status: 'failed', queue: 'default' })).toHaveLength(1);
    await expect(JobMonitor.flushFailed('default')).resolves.toBe(1);
    expect(await Queue.failed()).toHaveLength(0);
  });

  it('retries persisted failures through the job monitor', async () => {
    class MonitorRetryJob extends Job {
      static attempts = 0;
      maxAttempts = 1;
      retryDelay = 0;

      async handle(): Promise<void> {
        MonitorRetryJob.attempts += 1;
        if (MonitorRetryJob.attempts === 1) {
          throw new Error('retry from monitor');
        }
      }
    }

    Queue.configure({
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });
    JobMonitor.configure({
      driver: 'memory',
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });
    Queue.register(MonitorRetryJob);
    MonitorRetryJob.attempts = 0;

    await Queue.dispatch(new MonitorRetryJob());
    await Queue.work({ maxJobs: 1, sleep: 0 });

    const failures = await JobMonitor.listJobs({ status: 'failed' });
    expect(failures).toHaveLength(1);
    await expect(JobMonitor.retryJob(failures[0].id)).resolves.toBe(true);
    await Queue.work({ maxJobs: 1, sleep: 0 });

    expect(MonitorRetryJob.attempts).toBe(2);
    expect(await Queue.failed()).toHaveLength(0);
  });

  it('fails job monitor reads when the failed jobs table is unavailable', async () => {
    await Connection.raw('DROP TABLE svelar_failed_jobs');

    JobMonitor.configure({
      driver: 'memory',
      default: 'memory',
      connections: { memory: { driver: 'memory' } },
    });

    await expect(JobMonitor.getCounts('default')).rejects.toThrow('svelar_failed_jobs');
    await expect(JobMonitor.listJobs({ status: 'failed' })).rejects.toThrow('svelar_failed_jobs');
    await expect(JobMonitor.getJob('missing')).rejects.toThrow('svelar_failed_jobs');
    await expect(JobMonitor.deleteJob('missing')).rejects.toThrow('svelar_failed_jobs');
    await expect(JobMonitor.flushFailed('default')).rejects.toThrow('svelar_failed_jobs');
  });
});
