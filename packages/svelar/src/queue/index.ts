/**
 * Svelar Queue / Jobs
 *
 * Background job processing with sync, in-memory, and database-backed queues.
 * Dispatch jobs from anywhere — controllers, services, model hooks, middleware,
 * other jobs, or CLI commands.
 *
 * @example
 * ```ts
 * import { Queue, Job } from 'svelar/queue';
 *
 * class SendWelcomeEmail extends Job {
 *   constructor(private userId: number) { super(); }
 *
 *   async handle(): Promise<void> {
 *     const user = await User.findOrFail(this.userId);
 *     await Mailer.send({ to: user.email, template: 'welcome' });
 *   }
 *
 *   failed(error: Error): void {
 *     console.error('Failed to send welcome email:', error);
 *   }
 * }
 *
 * // Register the job class (required for database driver deserialization)
 * Queue.register(SendWelcomeEmail);
 *
 * // Dispatch to queue (async — processed by a worker)
 * await Queue.dispatch(new SendWelcomeEmail(user.id));
 *
 * // Dispatch with delay (seconds)
 * await Queue.dispatch(new SendWelcomeEmail(user.id), { delay: 60 });
 *
 * // Run synchronously regardless of configured driver
 * await Queue.dispatchSync(new SendWelcomeEmail(user.id));
 *
 * // Chain jobs — run in sequence, stop on failure
 * await Queue.chain([
 *   new ProcessPayment(orderId),
 *   new SendReceipt(orderId),
 *   new UpdateInventory(orderId),
 * ]);
 *
 * // Process jobs (in a worker)
 * await Queue.work();
 * ```
 */

import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';

// ── Types ──────────────────────────────────────────────────

export type QueueDriver = 'sync' | 'memory' | 'database' | 'redis';

export interface QueueConfig {
  default: string;
  connections: Record<string, QueueConnectionConfig>;
}

export interface QueueConnectionConfig {
  driver: QueueDriver;
  /** Queue name (default: 'default') */
  queue?: string;
  /** Max retry attempts */
  maxAttempts?: number;
  /** Retry delay in seconds */
  retryDelay?: number;
  /** Database table for database driver */
  table?: string;
  /** Redis connection URL for redis driver (default: redis://localhost:6379) */
  url?: string;
  /** Redis host (alternative to url) */
  host?: string;
  /** Redis port (default: 6379) */
  port?: number;
  /** Redis password */
  password?: string;
  /** Redis database index (default: 0) */
  db?: number;
  /** BullMQ queue prefix (default: 'svelar') */
  prefix?: string;
  /** Default job options for BullMQ */
  defaultJobOptions?: {
    removeOnComplete?: boolean | number;
    removeOnFail?: boolean | number;
  };
}

export interface DispatchOptions {
  /** Queue name */
  queue?: string;
  /** Delay in seconds before processing */
  delay?: number;
  /** Max retry attempts */
  maxAttempts?: number;
}

interface QueuedJob {
  id: string;
  jobClass: string;
  payload: string;
  queue: string;
  attempts: number;
  maxAttempts: number;
  availableAt: number;
  createdAt: number;
  job: Job;
}

// ── Job Base Class ─────────────────────────────────────────

export abstract class Job {
  /** Number of times this job has been attempted */
  attempts: number = 0;

  /** Maximum attempts before failing permanently */
  maxAttempts: number = 3;

  /** Delay before retry (in seconds) */
  retryDelay: number = 60;

  /** Queue to dispatch to */
  queue: string = 'default';

  /**
   * Handle the job — implement your logic here
   */
  abstract handle(): Promise<void>;

  /**
   * Called when the job has failed after all retries
   */
  failed(error: Error): void {
    console.error(`[Queue] Job ${this.constructor.name} permanently failed:`, error.message);
  }

  /**
   * Called before each retry
   */
  retrying(attempt: number): void {
    // Override if needed
  }

  /**
   * Serialize the job for storage.
   * Override this if your job needs custom serialization.
   */
  serialize(): string {
    const data: Record<string, any> = {};
    for (const [key, value] of Object.entries(this)) {
      if (typeof value !== 'function') {
        data[key] = value;
      }
    }
    return JSON.stringify(data);
  }

  /**
   * Restore job properties from deserialized data.
   * Called when reconstructing a job from the database.
   * Override this if your job needs custom deserialization.
   */
  restore(data: Record<string, any>): void {
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'attempts' && key !== 'maxAttempts' && key !== 'retryDelay' && key !== 'queue') {
        (this as any)[key] = value;
      }
    }
  }
}

// ── Queue Drivers ──────────────────────────────────────────

interface QueueDriverInterface {
  push(job: QueuedJob): Promise<void>;
  pop(queue?: string): Promise<QueuedJob | null>;
  size(queue?: string): Promise<number>;
  clear(queue?: string): Promise<void>;
}

// Sync driver — runs immediately in the same process
class SyncDriver implements QueueDriverInterface {
  async push(queuedJob: QueuedJob): Promise<void> {
    try {
      queuedJob.job.attempts = 1;
      await queuedJob.job.handle();
    } catch (error) {
      if (queuedJob.attempts + 1 < queuedJob.maxAttempts) {
        // Retry synchronously
        queuedJob.attempts++;
        queuedJob.job.attempts = queuedJob.attempts + 1;
        queuedJob.job.retrying(queuedJob.job.attempts);
        return this.push(queuedJob);
      }
      queuedJob.job.failed(error as Error);
    }
  }
  async pop(): Promise<QueuedJob | null> { return null; }
  async size(): Promise<number> { return 0; }
  async clear(): Promise<void> {}
}

// Memory driver — in-process queue (lost on restart)
class MemoryDriver implements QueueDriverInterface {
  private queues = new Map<string, QueuedJob[]>();

  async push(job: QueuedJob): Promise<void> {
    const queueName = job.queue;
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, []);
    }
    this.queues.get(queueName)!.push(job);
  }

  async pop(queue: string = 'default'): Promise<QueuedJob | null> {
    const jobs = this.queues.get(queue) ?? [];
    const now = Date.now();

    // Find first available job (respecting delay)
    const idx = jobs.findIndex((j) => j.availableAt <= now);
    if (idx === -1) return null;

    return jobs.splice(idx, 1)[0];
  }

  async size(queue: string = 'default'): Promise<number> {
    return this.queues.get(queue)?.length ?? 0;
  }

  async clear(queue?: string): Promise<void> {
    if (queue) {
      this.queues.delete(queue);
    } else {
      this.queues.clear();
    }
  }
}

// Database driver — persists jobs to a database table
class DatabaseDriver implements QueueDriverInterface {
  constructor(
    private table: string,
    private registry: JobRegistry,
  ) {
    this.table = assertSqlIdentifier(table, 'Queue jobs table name');
  }

  private query(): QueryBuilder<any> {
    return new QueryBuilder(this.table);
  }

  async push(job: QueuedJob): Promise<void> {
    await this.query().insert({
      id: job.id,
      queue: job.queue,
      payload: JSON.stringify({
        jobClass: job.jobClass,
        payload: job.payload,
      }),
      attempts: job.attempts,
      max_attempts: job.maxAttempts,
      reserved_at: null,
      available_at: Math.floor(job.availableAt / 1000),
      created_at: Math.floor(job.createdAt / 1000),
    });
  }

  async pop(queue: string = 'default'): Promise<QueuedJob | null> {
    const nowSec = Math.floor(Date.now() / 1000);

    const row = await this.query()
      .where('queue', queue)
      .where('available_at', '<=', nowSec)
      .whereNull('reserved_at')
      .orderBy('created_at')
      .first();

    if (!row) return null;

    // Reserve the job
    await this.query().where('id', row.id).update({ reserved_at: nowSec });
    await this.query().where('id', row.id).increment('attempts');

    const data = JSON.parse(row.payload);

    // Reconstruct the actual Job instance from the registry
    const jobInstance = this.registry.resolve(data.jobClass, data.payload);

    return {
      id: row.id,
      jobClass: data.jobClass,
      payload: data.payload,
      queue: row.queue,
      attempts: row.attempts + 1,
      maxAttempts: row.max_attempts,
      availableAt: row.available_at * 1000,
      createdAt: row.created_at * 1000,
      job: jobInstance,
    };
  }

  async size(queue: string = 'default'): Promise<number> {
    return this.query().where('queue', queue).whereNull('reserved_at').count();
  }

  async clear(queue?: string): Promise<void> {
    if (queue) {
      await this.query().where('queue', queue).delete();
    } else {
      await this.query().delete();
    }
  }

  /**
   * Remove a completed job from the database
   */
  async delete(jobId: string): Promise<void> {
    await this.query().where('id', jobId).delete();
  }

  /**
   * Release a failed job back to the queue with a delay
   */
  async release(jobId: string, delaySec: number = 0): Promise<void> {
    const availableAt = Math.floor(Date.now() / 1000) + delaySec;
    await this.query().where('id', jobId).update({
      reserved_at: null,
      available_at: availableAt,
    });
  }
}

// ── BullMQ / Redis driver ─────────────────────────────────
// Uses BullMQ under the hood for production-grade Redis queues with
// priorities, rate limiting, retries, delays, and dashboard support.
// Requires: npm install bullmq (peer dependency, loaded dynamically).

class RedisDriver implements QueueDriverInterface {
  private queues = new Map<string, any>();  // BullMQ Queue instances
  private config: QueueConnectionConfig;
  private registry: JobRegistry;
  private _bullmq: any = null;

  constructor(config: QueueConnectionConfig, registry: JobRegistry) {
    this.config = config;
    this.registry = registry;
  }

  private async getBullMQ(): Promise<any> {
    if (this._bullmq) return this._bullmq;
    try {
      this._bullmq = await (Function('return import("bullmq")')() as Promise<any>);
      return this._bullmq;
    } catch {
      throw new Error(
        'bullmq is required for the Redis queue driver. Install it with: npm install bullmq'
      );
    }
  }

  private getRedisConnection(): Record<string, any> {
    if (this.config.url) {
      // Parse redis:// URL
      const url = new URL(this.config.url);
      return {
        host: url.hostname || 'localhost',
        port: parseInt(url.port) || 6379,
        password: url.password || this.config.password || undefined,
        db: parseInt(url.pathname?.slice(1) || '0') || this.config.db || 0,
      };
    }
    return {
      host: this.config.host ?? 'localhost',
      port: this.config.port ?? 6379,
      password: this.config.password,
      db: this.config.db ?? 0,
    };
  }

  private async getQueue(queueName: string): Promise<any> {
    if (this.queues.has(queueName)) return this.queues.get(queueName);

    const bullmq = await this.getBullMQ();
    const connection = this.getRedisConnection();
    const prefix = this.config.prefix ?? 'svelar';

    const queue = new bullmq.Queue(queueName, {
      connection,
      prefix,
      defaultJobOptions: {
        removeOnComplete: this.config.defaultJobOptions?.removeOnComplete ?? 100,
        removeOnFail: this.config.defaultJobOptions?.removeOnFail ?? 500,
      },
    });

    this.queues.set(queueName, queue);
    return queue;
  }

  async push(job: QueuedJob): Promise<void> {
    const queue = await this.getQueue(job.queue);
    const delaySec = Math.max(0, job.availableAt - Date.now());

    await queue.add(
      job.jobClass,
      {
        jobClass: job.jobClass,
        payload: job.payload,
      },
      {
        jobId: job.id,
        delay: delaySec > 0 ? delaySec : undefined,
        attempts: job.maxAttempts,
        backoff: {
          type: 'fixed',
          delay: (job.job.retryDelay ?? 60) * 1000,
        },
      },
    );
  }

  // pop() is not used with BullMQ — the Worker handles consuming.
  // This is kept for interface compatibility but should not be called directly.
  async pop(_queue?: string): Promise<QueuedJob | null> {
    return null;
  }

  async size(queue: string = 'default'): Promise<number> {
    const q = await this.getQueue(queue);
    const counts = await q.getJobCounts('waiting', 'delayed', 'active');
    return counts.waiting + counts.delayed + counts.active;
  }

  async clear(queue?: string): Promise<void> {
    if (queue) {
      const q = await this.getQueue(queue);
      await q.obliterate({ force: true });
    } else {
      for (const q of this.queues.values()) {
        await q.obliterate({ force: true });
      }
    }
  }

  /**
   * Start a BullMQ Worker that processes jobs for a given queue.
   * Returns the Worker instance so you can listen for events.
   *
   * This is called by QueueManager.work() when the redis driver is active.
   */
  async createWorker(
    queueName: string,
    registry: JobRegistry,
    failedStore: FailedJobStore,
    options?: { concurrency?: number },
  ): Promise<any> {
    const bullmq = await this.getBullMQ();
    const connection = this.getRedisConnection();
    const prefix = this.config.prefix ?? 'svelar';

    const worker = new bullmq.Worker(
      queueName,
      async (bullJob: any) => {
        const data = bullJob.data;
        const jobInstance = registry.resolve(data.jobClass, data.payload);
        jobInstance.attempts = bullJob.attemptsMade + 1;
        await jobInstance.handle();
      },
      {
        connection,
        prefix,
        concurrency: options?.concurrency ?? 1,
      },
    );

    worker.on('failed', async (bullJob: any, err: Error) => {
      const data = bullJob?.data;
      if (data) {
        try {
          const jobInstance = registry.resolve(data.jobClass, data.payload);
          // Only call failed() and persist if all retries are exhausted
          if (bullJob.attemptsMade >= (bullJob.opts?.attempts ?? 3)) {
            jobInstance.failed(err);
            await failedStore.store({
              id: bullJob.id,
              jobClass: data.jobClass,
              payload: data.payload,
              queue: queueName,
              attempts: bullJob.attemptsMade,
              maxAttempts: bullJob.opts?.attempts ?? 3,
              availableAt: Date.now(),
              createdAt: bullJob.timestamp ?? Date.now(),
              job: jobInstance,
            }, err);
          }
        } catch {
          console.error(`[Queue] Failed to resolve job for failure handler:`, err.message);
        }
      }
    });

    return worker;
  }
}

// ── Failed Job Store ──────────────────────────────────────

export interface FailedJobRecord {
  id: string;
  queue: string;
  jobClass: string;
  payload: string;
  exception: string;
  failedAt: number;
}

class FailedJobStore {
  private table = assertSqlIdentifier('svelar_failed_jobs', 'Failed jobs table name');

  private query(): QueryBuilder<any> {
    return new QueryBuilder(this.table);
  }

  async store(job: QueuedJob, error: Error): Promise<void> {
    try {
      await this.query().insert({
        id: crypto.randomUUID(),
        queue: job.queue,
        job_class: job.jobClass,
        payload: job.payload,
        exception: error.stack ?? error.message,
        failed_at: Math.floor(Date.now() / 1000),
      });
    } catch {
      // If the failed_jobs table doesn't exist, fall back to console logging
      console.error(`[Queue] Could not persist failed job (run migration to create svelar_failed_jobs table)`);
    }
  }

  async all(): Promise<FailedJobRecord[]> {
    const rows = await this.query().orderBy('failed_at', 'desc').get();
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      queue: r.queue,
      jobClass: r.job_class,
      payload: r.payload,
      exception: r.exception,
      failedAt: r.failed_at,
    }));
  }

  async find(id: string): Promise<FailedJobRecord | null> {
    const r = await this.query().where('id', id).first();
    if (!r) return null;
    return {
      id: r.id,
      queue: r.queue,
      jobClass: r.job_class,
      payload: r.payload,
      exception: r.exception,
      failedAt: r.failed_at,
    };
  }

  async forget(id: string): Promise<boolean> {
    const deleted = await this.query().where('id', id).delete();
    return deleted > 0;
  }

  async flush(): Promise<number> {
    const count = await this.query().count();
    await this.query().delete();
    return count;
  }
}

// ── Job Registry ──────────────────────────────────────────

/**
 * Maps job class names to their constructors so the database driver
 * can reconstruct Job instances from serialized payloads.
 */
class JobRegistry {
  private jobs = new Map<string, new (...args: any[]) => Job>();

  /**
   * Register a job class. Required for the database driver.
   */
  register(JobClass: new (...args: any[]) => Job): void {
    this.jobs.set(JobClass.name, JobClass);
  }

  /**
   * Register multiple job classes at once.
   */
  registerAll(classes: Array<new (...args: any[]) => Job>): void {
    for (const cls of classes) {
      this.register(cls);
    }
  }

  /**
   * Reconstruct a Job instance from its class name and serialized payload.
   */
  resolve(className: string, serializedPayload: string): Job {
    const JobClass = this.jobs.get(className);
    if (!JobClass) {
      throw new Error(
        `Job class "${className}" is not registered. ` +
        `Call Queue.register(${className}) in your app bootstrap. ` +
        `Registered jobs: [${[...this.jobs.keys()].join(', ')}]`
      );
    }

    // Create instance without calling constructor (avoid arg mismatches)
    const instance = Object.create(JobClass.prototype) as Job;

    // Set base defaults
    instance.attempts = 0;
    instance.maxAttempts = 3;
    instance.retryDelay = 60;
    instance.queue = 'default';

    // Restore serialized data
    try {
      const data = JSON.parse(serializedPayload);
      instance.restore(data);
    } catch {
      // If deserialization fails, the instance will run with defaults
    }

    return instance;
  }

  has(className: string): boolean {
    return this.jobs.has(className);
  }
}

// ── Queue Manager ──────────────────────────────────────────

class QueueManager {
  private config: QueueConfig = {
    default: 'sync',
    connections: { sync: { driver: 'sync' } },
  };
  private drivers = new Map<string, QueueDriverInterface>();
  private processing = false;
  private jobRegistry = new JobRegistry();
  private failedStore = new FailedJobStore();
  private _activeWorker: any = null;

  configure(config: QueueConfig): void {
    this.config = config;
    this.drivers.clear();
  }

  /**
   * Register a job class for database driver deserialization.
   *
   * @example
   * Queue.register(SendWelcomeEmail);
   * Queue.register(ProcessPayment);
   */
  register(JobClass: new (...args: any[]) => Job): void {
    this.jobRegistry.register(JobClass);
  }

  /**
   * Register multiple job classes at once.
   *
   * @example
   * Queue.registerAll([SendWelcomeEmail, ProcessPayment, GenerateReport]);
   */
  registerAll(classes: Array<new (...args: any[]) => Job>): void {
    this.jobRegistry.registerAll(classes);
  }

  /**
   * Dispatch a job to the configured queue driver.
   * The job will be processed asynchronously by a worker (unless using the sync driver).
   *
   * @example
   * // Basic dispatch
   * await Queue.dispatch(new SendWelcomeEmail(user.id));
   *
   * // Dispatch with options
   * await Queue.dispatch(new SendWelcomeEmail(user.id), {
   *   queue: 'emails',
   *   delay: 60,         // Wait 60 seconds before processing
   *   maxAttempts: 5,
   * });
   */
  async dispatch(job: Job, options?: DispatchOptions): Promise<void> {
    const connName = this.config.default;
    const connConfig = this.config.connections[connName];
    const driver = this.resolveDriver(connName);

    // Apply dispatch options to the job instance
    if (options?.queue) {
      job.queue = options.queue;
    }
    if (options?.maxAttempts !== undefined) {
      job.maxAttempts = options.maxAttempts;
    }

    const queuedJob: QueuedJob = {
      id: crypto.randomUUID(),
      jobClass: job.constructor.name,
      payload: job.serialize(),
      queue: job.queue ?? connConfig?.queue ?? 'default',
      attempts: 0,
      maxAttempts: job.maxAttempts,
      availableAt: Date.now() + (options?.delay ?? 0) * 1000,
      createdAt: Date.now(),
      job,
    };

    await driver.push(queuedJob);
  }

  /**
   * Dispatch a job synchronously, bypassing the configured queue driver.
   * The job runs immediately in the current process and the promise
   * resolves when the job completes (or rejects if it fails all retries).
   *
   * Use this when you need the result right away, in tests, or for
   * jobs that must complete before the response is sent.
   *
   * @example
   * // Run immediately regardless of configured driver
   * await Queue.dispatchSync(new SendWelcomeEmail(user.id));
   *
   * // Useful in tests
   * await Queue.dispatchSync(new ProcessPayment(orderId));
   */
  async dispatchSync(job: Job): Promise<void> {
    const syncDriver = new SyncDriver();

    const queuedJob: QueuedJob = {
      id: crypto.randomUUID(),
      jobClass: job.constructor.name,
      payload: job.serialize(),
      queue: job.queue,
      attempts: 0,
      maxAttempts: job.maxAttempts,
      availableAt: Date.now(),
      createdAt: Date.now(),
      job,
    };

    await syncDriver.push(queuedJob);
  }

  /**
   * Chain multiple jobs to run in sequence.
   * Each job runs after the previous one completes successfully.
   * If any job fails (after all retries), the chain stops.
   *
   * @example
   * await Queue.chain([
   *   new ProcessPayment(orderId),
   *   new SendReceipt(orderId),
   *   new UpdateInventory(orderId),
   * ]);
   *
   * // Chain with options
   * await Queue.chain([
   *   new ProcessPayment(orderId),
   *   new SendReceipt(orderId),
   * ], { queue: 'orders' });
   */
  async chain(jobs: Job[], options?: DispatchOptions): Promise<void> {
    if (jobs.length === 0) return;

    // Wrap jobs in a ChainedJob that runs them sequentially
    const chainJob = new ChainedJob(jobs);

    if (options?.queue) {
      chainJob.queue = options.queue;
    }
    if (options?.maxAttempts !== undefined) {
      chainJob.maxAttempts = options.maxAttempts;
    }

    await this.dispatch(chainJob, options);
  }

  /**
   * Process jobs from the queue (worker loop).
   *
   * For sync/memory/database drivers this runs a poll loop.
   * For the redis driver this starts a BullMQ Worker that processes
   * jobs natively — no polling required.
   *
   * @returns Number of processed jobs (poll drivers) or 0 (redis — the
   *          worker runs indefinitely until stop() is called).
   */
  async work(options?: {
    queue?: string;
    maxJobs?: number;
    sleep?: number;
    /** BullMQ concurrency (redis driver only, default: 1) */
    concurrency?: number;
  }): Promise<number> {
    const connName = this.config.default;
    const driver = this.resolveDriver(connName);
    const queue = options?.queue ?? 'default';

    // ── Redis / BullMQ path ──────────────────────────────────
    if (driver instanceof RedisDriver) {
      const worker = await driver.createWorker(queue, this.jobRegistry, this.failedStore, {
        concurrency: options?.concurrency ?? 1,
      });

      this.processing = true;
      this._activeWorker = worker;

      // Block until stop() is called
      await new Promise<void>((resolve) => {
        const check = () => {
          if (!this.processing) {
            worker.close().then(resolve).catch(resolve);
          } else {
            setTimeout(check, 500);
          }
        };
        check();
      });

      return 0; // BullMQ tracks its own processed count
    }

    // ── Poll-based path (sync / memory / database) ───────────
    const maxJobs = options?.maxJobs ?? Infinity;
    const sleepMs = (options?.sleep ?? 1) * 1000;

    let processed = 0;
    this.processing = true;

    while (this.processing && processed < maxJobs) {
      const queuedJob = await driver.pop(queue);

      if (!queuedJob) {
        // No jobs available — wait and try again
        if (maxJobs === Infinity) {
          await new Promise((r) => setTimeout(r, sleepMs));
          continue;
        }
        break;
      }

      queuedJob.attempts++;
      queuedJob.job.attempts = queuedJob.attempts;

      try {
        await queuedJob.job.handle();
        processed++;

        // If database driver, delete the completed job
        if (driver instanceof DatabaseDriver) {
          await (driver as DatabaseDriver).delete(queuedJob.id);
        }
      } catch (error) {
        if (queuedJob.attempts < queuedJob.maxAttempts) {
          // Retry
          queuedJob.job.retrying(queuedJob.attempts);
          const retryDelay = queuedJob.job.retryDelay ?? 60;

          if (driver instanceof DatabaseDriver) {
            // Release back to DB with delay
            await (driver as DatabaseDriver).release(queuedJob.id, retryDelay);
          } else {
            queuedJob.availableAt = Date.now() + retryDelay * 1000;
            await driver.push(queuedJob);
          }
        } else {
          // Permanently failed
          queuedJob.job.failed(error as Error);

          // Persist to failed_jobs table
          await this.failedStore.store(queuedJob, error as Error);

          // Clean up from database
          if (driver instanceof DatabaseDriver) {
            await (driver as DatabaseDriver).delete(queuedJob.id);
          }
        }
      }
    }

    return processed;
  }

  /**
   * Stop the worker loop (poll drivers) or close the BullMQ Worker (redis).
   */
  async stop(): Promise<void> {
    this.processing = false;
    if (this._activeWorker) {
      await this._activeWorker.close();
      this._activeWorker = null;
    }
  }

  /**
   * Get the size of a queue
   */
  async size(queue?: string): Promise<number> {
    return this.resolveDriver(this.config.default).size(queue);
  }

  /**
   * Clear all jobs from a queue
   */
  async clear(queue?: string): Promise<void> {
    return this.resolveDriver(this.config.default).clear(queue);
  }

  // ── Failed Jobs API ─────────────────────────────────────

  /**
   * List all failed jobs.
   *
   * @example
   * const failures = await Queue.failed();
   * for (const f of failures) {
   *   console.log(f.jobClass, f.exception);
   * }
   */
  async failed(): Promise<FailedJobRecord[]> {
    return this.failedStore.all();
  }

  /**
   * Retry a failed job by its ID.
   * The job is re-dispatched to the queue and removed from the failed_jobs table.
   *
   * @example
   * await Queue.retry('some-uuid');
   */
  async retry(failedJobId: string): Promise<boolean> {
    const record = await this.failedStore.find(failedJobId);
    if (!record) return false;

    const jobInstance = this.jobRegistry.resolve(record.jobClass, record.payload);
    jobInstance.queue = record.queue;

    await this.dispatch(jobInstance, { queue: record.queue });
    await this.failedStore.forget(failedJobId);
    return true;
  }

  /**
   * Retry all failed jobs.
   *
   * @example
   * const count = await Queue.retryAll();
   * console.log(`Retried ${count} jobs`);
   */
  async retryAll(): Promise<number> {
    const records = await this.failedStore.all();
    let count = 0;
    for (const record of records) {
      try {
        const jobInstance = this.jobRegistry.resolve(record.jobClass, record.payload);
        jobInstance.queue = record.queue;
        await this.dispatch(jobInstance, { queue: record.queue });
        await this.failedStore.forget(record.id);
        count++;
      } catch {
        // Skip unresolvable jobs
      }
    }
    return count;
  }

  /**
   * Remove a single failed job record.
   *
   * @example
   * await Queue.forgetFailed('some-uuid');
   */
  async forgetFailed(failedJobId: string): Promise<boolean> {
    return this.failedStore.forget(failedJobId);
  }

  /**
   * Remove all failed job records.
   *
   * @example
   * const count = await Queue.flushFailed();
   */
  async flushFailed(): Promise<number> {
    return this.failedStore.flush();
  }

  private resolveDriver(name: string): QueueDriverInterface {
    if (this.drivers.has(name)) return this.drivers.get(name)!;

    const config = this.config.connections[name];
    if (!config) throw new Error(`Queue connection "${name}" is not defined.`);

    let driver: QueueDriverInterface;
    switch (config.driver) {
      case 'sync': driver = new SyncDriver(); break;
      case 'memory': driver = new MemoryDriver(); break;
      case 'database':
        driver = new DatabaseDriver(config.table ?? 'svelar_jobs', this.jobRegistry);
        break;
      case 'redis':
        driver = new RedisDriver(config, this.jobRegistry);
        break;
      default:
        throw new Error(`Unknown queue driver: ${config.driver}`);
    }

    this.drivers.set(name, driver);
    return driver;
  }
}

// ── Chained Job (internal) ────────────────────────────────

/**
 * Internal job that wraps a sequence of jobs and runs them one by one.
 */
class ChainedJob extends Job {
  private remainingJobs: Job[];

  constructor(jobs: Job[]) {
    super();
    this.remainingJobs = [...jobs];
    this.maxAttempts = 1; // Chain itself doesn't retry — individual jobs handle their own retries
  }

  async handle(): Promise<void> {
    for (const job of this.remainingJobs) {
      let lastError: Error | null = null;
      let succeeded = false;

      for (let attempt = 1; attempt <= job.maxAttempts; attempt++) {
        job.attempts = attempt;

        try {
          await job.handle();
          succeeded = true;
          break;
        } catch (error) {
          lastError = error as Error;

          if (attempt < job.maxAttempts) {
            job.retrying(attempt);
            // Wait before retrying
            if (job.retryDelay > 0) {
              await new Promise((r) => setTimeout(r, job.retryDelay * 1000));
            }
          }
        }
      }

      if (!succeeded && lastError) {
        job.failed(lastError);
        throw new Error(
          `Chain stopped: ${job.constructor.name} failed after ${job.maxAttempts} attempt(s). ` +
          `Remaining jobs: [${this.remainingJobs
            .slice(this.remainingJobs.indexOf(job) + 1)
            .map((j) => j.constructor.name)
            .join(', ')}]`
        );
      }
    }
  }

  serialize(): string {
    return JSON.stringify({
      jobs: this.remainingJobs.map((j) => ({
        jobClass: j.constructor.name,
        payload: j.serialize(),
      })),
    });
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global Queue singleton
 */
export const Queue = singleton('svelar.queue', () => new QueueManager());
