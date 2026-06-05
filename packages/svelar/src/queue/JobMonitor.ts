/**
 * Queue Job Monitor
 *
 * Driver-agnostic utilities for querying queue job state.
 * Used by the admin dashboard to display job metrics and manage jobs.
 */

import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { singleton } from '../support/singleton.js';
import { Queue } from './index.js';

// Types
export interface JobInfo {
  id: string;
  jobClass: string;
  queue: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  attempts: number;
  maxAttempts: number;
  payload: string;
  error?: string;
  createdAt: number;
  processedAt?: number;
  failedAt?: number;
  delayedUntil?: number;
}

export interface JobCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

export interface JobFilter {
  status?: JobInfo['status'];
  queue?: string;
  jobClass?: string;
  limit?: number;
  offset?: number;
}

export interface QueueHealth {
  driver: string;
  queues: Record<string, JobCounts>;
  oldestWaitingJob?: number; // timestamp
  failureRate: number; // percentage in last hour
  throughput: number; // jobs processed in last hour
}

function parseDatabaseJobPayload(row: { id: string; payload: string }, table: string): { jobClass?: string } {
  try {
    const data = JSON.parse(row.payload ?? '{}');
    if (!data || typeof data !== 'object') {
      throw new Error('expected JSON object');
    }
    return data;
  } catch (error: any) {
    throw new Error(
      `Failed to parse queued job payload for job "${row.id}" in table "${table}": ${error.message ?? error}`
    );
  }
}

class JobMonitorService {
  private _config: { driver: string; default: string; connections: Record<string, any> } | null = null;
  private _bullmq: any = null;
  private _metrics: {
    processed: number[];  // timestamps of completed jobs
    failed: number[];     // timestamps of failed jobs
  } = { processed: [], failed: [] };

  configure(config: { driver: string; default: string; connections: Record<string, any> }): void {
    this._config = config;
  }

  /** Record a processed job (called internally by queue system) */
  recordProcessed(): void {
    this._metrics.processed.push(Date.now());
    // Keep only last hour
    const hourAgo = Date.now() - 3600000;
    this._metrics.processed = this._metrics.processed.filter(t => t > hourAgo);
  }

  /** Record a failed job (called internally by queue system) */
  recordFailed(): void {
    this._metrics.failed.push(Date.now());
    const hourAgo = Date.now() - 3600000;
    this._metrics.failed = this._metrics.failed.filter(t => t > hourAgo);
  }

  /**
   * Get job counts for a queue (or all queues)
   */
  async getCounts(queueName: string = 'default'): Promise<JobCounts> {
    const driver = this._config?.connections[this._config.default]?.driver;

    if (driver === 'redis') {
      return this._getRedisJobCounts(queueName);
    }
    if (driver === 'database') {
      return this._getDatabaseJobCounts(queueName);
    }

    // sync/memory — limited live visibility, but permanent failures are persisted.
    const failed = await this.countFailedJobs(queueName);
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed,
      delayed: 0,
      total: failed,
    };
  }

  /**
   * List jobs with filtering and pagination
   */
  async listJobs(filter: JobFilter = {}): Promise<JobInfo[]> {
    const driver = this._config?.connections[this._config.default]?.driver;

    if (filter.status === 'failed') {
      return this.listFailedJobs(filter);
    }

    if (driver === 'redis') {
      return this._listRedisJobs(filter);
    }
    if (driver === 'database') {
      return this._listDatabaseJobs(filter);
    }

    if (!filter.status) {
      return this.listFailedJobs(filter);
    }

    return [];
  }

  /**
   * Get details for a single job
   */
  async getJob(jobId: string): Promise<JobInfo | null> {
    const driver = this._config?.connections[this._config.default]?.driver;

    if (driver === 'redis') {
      return this._getRedisJob(jobId);
    }
    if (driver === 'database') {
      return this._getDatabaseJob(jobId);
    }

    return this.findFailedJob(jobId);
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<boolean> {
    if (await this.findFailedJob(jobId)) {
      return Queue.retry(jobId);
    }

    const driver = this._config?.connections[this._config.default]?.driver;

    if (driver === 'redis') {
      return this._retryRedisJob(jobId);
    }
    if (driver === 'database') {
      return this._retryDatabaseJob(jobId);
    }

    return false;
  }

  /**
   * Delete a job from the queue
   */
  async deleteJob(jobId: string): Promise<boolean> {
    if (await this.deleteFailedJob(jobId)) {
      return true;
    }

    const driver = this._config?.connections[this._config.default]?.driver;

    if (driver === 'redis') {
      return this._deleteRedisJob(jobId);
    }
    if (driver === 'database') {
      return this._deleteDatabaseJob(jobId);
    }

    return false;
  }

  /**
   * Get overall queue health metrics
   */
  async getHealth(): Promise<QueueHealth> {
    const driver = this._config?.connections[this._config.default]?.driver ?? 'sync';
    const counts = await this.getCounts('default');

    const hourAgo = Date.now() - 3600000;
    const recentProcessed = this._metrics.processed.filter(t => t > hourAgo).length;
    const recentFailed = this._metrics.failed.filter(t => t > hourAgo).length;
    const total = recentProcessed + recentFailed;

    return {
      driver,
      queues: { default: counts },
      failureRate: total > 0 ? (recentFailed / total) * 100 : 0,
      throughput: recentProcessed,
    };
  }

  /**
   * Flush all completed jobs (cleanup)
   */
  async flushCompleted(queueName: string = 'default'): Promise<number> {
    const driver = this._config?.connections[this._config.default]?.driver;

    if (driver === 'redis') {
      return this._flushRedisCompleted(queueName);
    }

    return 0;
  }

  /**
   * Flush all failed jobs
   */
  async flushFailed(queueName: string = 'default'): Promise<number> {
    return this.flushFailedJobs(queueName);
  }

  // ── Persisted failed jobs ─────────────────────────────────

  private getFailedTable(): string {
    return assertSqlIdentifier('svelar_failed_jobs', 'Failed jobs table name');
  }

  private failedQuery(): QueryBuilder<any> {
    return new QueryBuilder(this.getFailedTable());
  }

  private async countFailedJobs(queueName: string): Promise<number> {
    return this.failedQuery().where('queue', queueName).count();
  }

  private failedRowToInfo(row: any): JobInfo {
    return {
      id: row.id,
      jobClass: row.job_class ?? 'Unknown',
      queue: row.queue,
      status: 'failed',
      attempts: 0,
      maxAttempts: 0,
      payload: row.payload,
      error: row.exception,
      createdAt: (row.failed_at ?? 0) * 1000,
      failedAt: (row.failed_at ?? 0) * 1000,
    };
  }

  private async listFailedJobs(filter: JobFilter = {}): Promise<JobInfo[]> {
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const query = this.failedQuery();

    if (filter.queue) {
      query.where('queue', filter.queue);
    }
    if (filter.jobClass) {
      query.where('job_class', filter.jobClass);
    }

    const rows = await query.orderBy('failed_at', 'desc').limit(limit).offset(offset).get();
    return (rows ?? []).map((row: any) => this.failedRowToInfo(row));
  }

  private async findFailedJob(jobId: string): Promise<JobInfo | null> {
    const row = await this.failedQuery().where('id', jobId).first();
    return row ? this.failedRowToInfo(row) : null;
  }

  private async deleteFailedJob(jobId: string): Promise<boolean> {
    const deleted = await this.failedQuery().where('id', jobId).delete();
    return deleted > 0;
  }

  private async flushFailedJobs(queueName: string): Promise<number> {
    const query = this.failedQuery().where('queue', queueName);
    const count = await query.clone().count();
    await query.delete();
    return count;
  }

  // ── Redis (BullMQ) implementations ────────────────────────

  private async getBullMQ(): Promise<any> {
    if (this._bullmq) return this._bullmq;
    try {
      this._bullmq = await (Function('return import("bullmq")')() as Promise<any>);
      return this._bullmq;
    } catch {
      throw new Error('bullmq is required for the Redis queue monitor.');
    }
  }

  private getRedisConnection(): Record<string, any> {
    const config = this._config?.connections[this._config!.default] ?? {};
    if (config.url) {
      const url = new URL(config.url);
      return {
        host: url.hostname || 'localhost',
        port: parseInt(url.port) || 6379,
        password: url.password || config.password || undefined,
        db: parseInt(url.pathname?.slice(1) || '0') || config.db || 0,
      };
    }
    return {
      host: config.host ?? 'localhost',
      port: config.port ?? 6379,
      password: config.password,
      db: config.db ?? 0,
    };
  }

  private async getRedisQueue(queueName: string): Promise<any> {
    const bullmq = await this.getBullMQ();
    const connection = this.getRedisConnection();
    const config = this._config?.connections[this._config!.default] ?? {};
    return new bullmq.Queue(queueName, {
      connection,
      prefix: config.prefix ?? 'svelar',
    });
  }

  private async _getRedisJobCounts(queueName: string): Promise<JobCounts> {
    const queue = await this.getRedisQueue(queueName);
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'delayed');
      const failed = await this.countFailedJobs(queueName);
      return {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed,
        delayed: counts.delayed ?? 0,
        total: (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.completed ?? 0) + failed + (counts.delayed ?? 0),
      };
    } finally {
      await queue.close();
    }
  }

  private async _listRedisJobs(filter: JobFilter): Promise<JobInfo[]> {
    const queue = await this.getRedisQueue(filter.queue ?? 'default');
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    try {
      let jobs: any[];
      if (filter.status) {
        jobs = await queue.getJobs([filter.status], offset, offset + limit - 1);
      } else {
        jobs = await queue.getJobs(['waiting', 'active', 'completed', 'delayed'], offset, offset + limit - 1);
      }

      const liveJobs = jobs
        .filter((j: any) => j != null)
        .filter((j: any) => !filter.jobClass || j.name === filter.jobClass)
        .map((j: any) => this._bullmqJobToInfo(j));

      if (filter.status) {
        return liveJobs;
      }

      const failedJobs = await this.listFailedJobs(filter);
      return [...liveJobs, ...failedJobs]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    } finally {
      await queue.close();
    }
  }

  private async _getRedisJob(jobId: string): Promise<JobInfo | null> {
    const queue = await this.getRedisQueue('default');
    try {
      const job = await queue.getJob(jobId);
      if (!job) return this.findFailedJob(jobId);
      return this._bullmqJobToInfo(job);
    } finally {
      await queue.close();
    }
  }

  private async _retryRedisJob(jobId: string): Promise<boolean> {
    const queue = await this.getRedisQueue('default');
    try {
      const job = await queue.getJob(jobId);
      if (!job) return false;
      await job.retry();
      return true;
    } finally {
      await queue.close();
    }
  }

  private async _deleteRedisJob(jobId: string): Promise<boolean> {
    const queue = await this.getRedisQueue('default');
    try {
      const job = await queue.getJob(jobId);
      if (!job) return false;
      await job.remove();
      return true;
    } finally {
      await queue.close();
    }
  }

  private async _flushRedisCompleted(queueName: string): Promise<number> {
    const queue = await this.getRedisQueue(queueName);
    try {
      const jobs = await queue.getJobs(['completed']);
      let count = 0;
      for (const job of jobs) {
        if (job) {
          await job.remove();
          count++;
        }
      }
      return count;
    } finally {
      await queue.close();
    }
  }

  private async _flushRedisFailed(queueName: string): Promise<number> {
    const queue = await this.getRedisQueue(queueName);
    try {
      const jobs = await queue.getJobs(['failed']);
      let count = 0;
      for (const job of jobs) {
        if (job) {
          await job.remove();
          count++;
        }
      }
      return count;
    } finally {
      await queue.close();
    }
  }

  private _bullmqJobToInfo(job: any): JobInfo {
    const state = job.finishedOn
      ? (job.failedReason ? 'failed' : 'completed')
      : (job.delay && job.delay > 0 && !job.processedOn ? 'delayed' : (job.processedOn ? 'active' : 'waiting'));

    return {
      id: job.id,
      jobClass: job.name ?? job.data?.jobClass ?? 'Unknown',
      queue: job.queueName ?? 'default',
      status: state as JobInfo['status'],
      attempts: job.attemptsMade ?? 0,
      maxAttempts: job.opts?.attempts ?? 3,
      payload: JSON.stringify(job.data ?? {}),
      error: job.failedReason ?? undefined,
      createdAt: job.timestamp ?? Date.now(),
      processedAt: job.processedOn ?? undefined,
      failedAt: job.failedReason ? job.finishedOn : undefined,
      delayedUntil: job.delay ? job.timestamp + job.delay : undefined,
    };
  }

  // ── Database driver implementations ───────────────────────

  private getDbTable(): string {
    return assertSqlIdentifier(
      this._config?.connections[this._config!.default]?.table ?? 'svelar_jobs',
      'Queue jobs table name',
    );
  }

  private dbQuery(): QueryBuilder<any> {
    return new QueryBuilder(this.getDbTable());
  }

  private async _getDatabaseJobCounts(queueName: string): Promise<JobCounts> {
    const nowSec = Math.floor(Date.now() / 1000);

    const rows = await this.dbQuery()
      .select('reserved_at', 'available_at')
      .where('queue', queueName)
      .get();

    const waiting = rows.filter((row) => row.reserved_at == null && row.available_at <= nowSec).length;
    const active = rows.filter((row) => row.reserved_at != null).length;
    const delayed = rows.filter((row) => row.reserved_at == null && row.available_at > nowSec).length;
    const failed = await this.countFailedJobs(queueName);

    return {
      waiting,
      active,
      completed: 0, // database driver deletes completed jobs
      failed,
      delayed,
      total: waiting + active + failed + delayed,
    };
  }

  private async _listDatabaseJobs(filter: JobFilter): Promise<JobInfo[]> {
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);

    const query = this.dbQuery();

    if (filter.queue) {
      query.where('queue', filter.queue);
    }

    if (filter.status === 'waiting') {
      query.whereNull('reserved_at').where('available_at', '<=', nowSec);
    } else if (filter.status === 'active') {
      query.whereNotNull('reserved_at');
    } else if (filter.status === 'delayed') {
      query.whereNull('reserved_at').where('available_at', '>', nowSec);
    }

    const rows = await query.orderBy('created_at', 'desc').limit(limit).offset(offset).get();

    const table = this.getDbTable();
    const liveJobs = (rows ?? []).map((row: any) => {
      const data = parseDatabaseJobPayload(row, table);
      const isActive = row.reserved_at != null;
      const isDelayed = !isActive && row.available_at > nowSec;

      return {
        id: row.id,
        jobClass: data.jobClass ?? 'Unknown',
        queue: row.queue,
        status: isActive ? 'active' : (isDelayed ? 'delayed' : 'waiting'),
        attempts: row.attempts ?? 0,
        maxAttempts: row.max_attempts ?? 3,
        payload: row.payload,
        createdAt: (row.created_at ?? 0) * 1000,
        delayedUntil: isDelayed ? row.available_at * 1000 : undefined,
      } as JobInfo;
    });

    if (filter.status) {
      return liveJobs;
    }

    const failedJobs = await this.listFailedJobs(filter);
    return [...liveJobs, ...failedJobs]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  private async _getDatabaseJob(jobId: string): Promise<JobInfo | null> {
    const row = await this.dbQuery().where('id', jobId).first();
    if (!row) return this.findFailedJob(jobId);

    const data = parseDatabaseJobPayload(row, this.getDbTable());
    const nowSec = Math.floor(Date.now() / 1000);

    return {
      id: row.id,
      jobClass: data.jobClass ?? 'Unknown',
      queue: row.queue,
      status: row.reserved_at ? 'active' : (row.available_at > nowSec ? 'delayed' : 'waiting'),
      attempts: row.attempts ?? 0,
      maxAttempts: row.max_attempts ?? 3,
      payload: row.payload,
      createdAt: (row.created_at ?? 0) * 1000,
    };
  }

  private async _retryDatabaseJob(jobId: string): Promise<boolean> {
    const nowSec = Math.floor(Date.now() / 1000);

    const updated = await this.dbQuery().where('id', jobId).update({
      reserved_at: null,
      available_at: nowSec,
      attempts: 0,
    });
    return updated > 0;
  }

  private async _deleteDatabaseJob(jobId: string): Promise<boolean> {
    const deleted = await this.dbQuery().where('id', jobId).delete();
    return deleted > 0;
  }

}

export const JobMonitor = singleton('svelar.jobMonitor', () => new JobMonitorService());
