/**
 * Svelar Queue / Jobs
 *
 * Background job processing with in-memory and database-backed queues.
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
 * // Dispatch a job
 * await Queue.dispatch(new SendWelcomeEmail(user.id));
 *
 * // Dispatch with delay (seconds)
 * await Queue.dispatch(new SendWelcomeEmail(user.id), { delay: 60 });
 *
 * // Process jobs (in a worker)
 * await Queue.work();
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export type QueueDriver = 'sync' | 'memory' | 'database';

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
   * Serialize the job for storage
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
}

// ── Queue Drivers ──────────────────────────────────────────

interface QueueDriverInterface {
  push(job: QueuedJob): Promise<void>;
  pop(queue?: string): Promise<QueuedJob | null>;
  size(queue?: string): Promise<number>;
  clear(queue?: string): Promise<void>;
}

// Sync driver — runs immediately
class SyncDriver implements QueueDriverInterface {
  async push(queuedJob: QueuedJob): Promise<void> {
    try {
      await queuedJob.job.handle();
    } catch (error) {
      queuedJob.job.failed(error as Error);
    }
  }
  async pop(): Promise<QueuedJob | null> { return null; }
  async size(): Promise<number> { return 0; }
  async clear(): Promise<void> {}
}

// Memory driver — in-process queue
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

    // Find first available job
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
  constructor(private table: string) {}

  private async getConnection() {
    const { Connection } = await import('../database/Connection.js');
    return Connection;
  }

  async push(job: QueuedJob): Promise<void> {
    const conn = await this.getConnection();
    await conn.raw(
      `INSERT INTO ${this.table} (id, queue, payload, attempts, max_attempts, available_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        job.queue,
        JSON.stringify({
          jobClass: job.jobClass,
          payload: job.payload,
        }),
        job.attempts,
        job.maxAttempts,
        Math.floor(job.availableAt / 1000),
        Math.floor(job.createdAt / 1000),
      ]
    );
  }

  async pop(queue: string = 'default'): Promise<QueuedJob | null> {
    const conn = await this.getConnection();
    const nowSec = Math.floor(Date.now() / 1000);

    const rows = await conn.raw(
      `SELECT * FROM ${this.table}
       WHERE queue = ? AND available_at <= ? AND reserved_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
      [queue, nowSec]
    );

    if (!rows || rows.length === 0) return null;

    const row = rows[0];

    // Reserve the job
    await conn.raw(
      `UPDATE ${this.table} SET reserved_at = ?, attempts = attempts + 1 WHERE id = ?`,
      [nowSec, row.id]
    );

    const data = JSON.parse(row.payload);

    // We can't reconstruct the actual job instance from the DB,
    // so we create a placeholder that stores the serialized data.
    // In practice, a job registry would map jobClass -> constructor.
    const placeholderJob = {
      handle: async () => {
        throw new Error(`Cannot deserialize job "${data.jobClass}". Register a job resolver.`);
      },
      failed: (err: Error) => {
        console.error(`[Queue] Database job ${data.jobClass} failed:`, err.message);
      },
      retrying: () => {},
      attempts: row.attempts + 1,
      maxAttempts: row.max_attempts,
      retryDelay: 60,
      queue: row.queue,
      serialize: () => data.payload,
    } as unknown as Job;

    return {
      id: row.id,
      jobClass: data.jobClass,
      payload: data.payload,
      queue: row.queue,
      attempts: row.attempts + 1,
      maxAttempts: row.max_attempts,
      availableAt: row.available_at * 1000,
      createdAt: row.created_at * 1000,
      job: placeholderJob,
    };
  }

  async size(queue: string = 'default'): Promise<number> {
    const conn = await this.getConnection();
    const rows = await conn.raw(
      `SELECT COUNT(*) as count FROM ${this.table} WHERE queue = ? AND reserved_at IS NULL`,
      [queue]
    );
    return rows?.[0]?.count ?? 0;
  }

  async clear(queue?: string): Promise<void> {
    const conn = await this.getConnection();
    if (queue) {
      await conn.raw(`DELETE FROM ${this.table} WHERE queue = ?`, [queue]);
    } else {
      await conn.raw(`DELETE FROM ${this.table}`, []);
    }
  }

  /**
   * Remove a completed job from the database
   */
  async delete(jobId: string): Promise<void> {
    const conn = await this.getConnection();
    await conn.raw(`DELETE FROM ${this.table} WHERE id = ?`, [jobId]);
  }

  /**
   * Release a failed job back to the queue with a delay
   */
  async release(jobId: string, delaySec: number = 0): Promise<void> {
    const conn = await this.getConnection();
    const availableAt = Math.floor(Date.now() / 1000) + delaySec;
    await conn.raw(
      `UPDATE ${this.table} SET reserved_at = NULL, available_at = ? WHERE id = ?`,
      [availableAt, jobId]
    );
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

  configure(config: QueueConfig): void {
    this.config = config;
    this.drivers.clear();
  }

  /**
   * Dispatch a job to the queue
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
   * Process jobs from the queue (worker loop)
   */
  async work(options?: { queue?: string; maxJobs?: number; sleep?: number }): Promise<number> {
    const connName = this.config.default;
    const driver = this.resolveDriver(connName);
    const queue = options?.queue ?? 'default';
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
      } catch (error) {
        if (queuedJob.attempts < queuedJob.maxAttempts) {
          // Retry
          queuedJob.job.retrying(queuedJob.attempts);
          const retryDelay = queuedJob.job.retryDelay ?? 60;
          queuedJob.availableAt = Date.now() + retryDelay * 1000;
          await driver.push(queuedJob);
        } else {
          // Permanently failed
          queuedJob.job.failed(error as Error);
        }
      }
    }

    return processed;
  }

  /**
   * Stop the worker loop
   */
  stop(): void {
    this.processing = false;
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

  private resolveDriver(name: string): QueueDriverInterface {
    if (this.drivers.has(name)) return this.drivers.get(name)!;

    const config = this.config.connections[name];
    if (!config) throw new Error(`Queue connection "${name}" is not defined.`);

    let driver: QueueDriverInterface;
    switch (config.driver) {
      case 'sync': driver = new SyncDriver(); break;
      case 'memory': driver = new MemoryDriver(); break;
      case 'database':
        driver = new DatabaseDriver(config.table ?? 'svelar_jobs');
        break;
      default:
        throw new Error(`Unknown queue driver: ${config.driver}`);
    }

    this.drivers.set(name, driver);
    return driver;
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global Queue singleton
 */
export const Queue = singleton('svelar.queue', () => new QueueManager());
