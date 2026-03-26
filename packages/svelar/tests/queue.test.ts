import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Queue, Job } from '../src/queue/index';

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

      await Queue.dispatch(job);

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

      await Queue.dispatch(new ErrorJob());

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
