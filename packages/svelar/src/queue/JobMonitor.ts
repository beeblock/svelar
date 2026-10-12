/**
 * Queue Job Monitor
 *
 * Driver-agnostic utilities for querying queue job state.
 * Used by the admin dashboard to display job metrics and manage jobs.
 */

import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { singleton } from '../support/singleton.js';
import { Queue, type QueueDefinition } from './index.js';
import {
  defaultWorkerTelemetryLimit, maxWorkerTelemetryLimit, readWorkerTelemetry,
  type WorkerTelemetrySnapshot,
} from './BullMQTelemetry.js';

export type { WorkerHeartbeatInfo, WorkerTelemetrySnapshot } from './BullMQTelemetry.js';

// Types
export interface JobInfo {
  id: string;
  jobClass: string;
  queue: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  attempts: number;
  maxAttempts: number;
  priority?: number;
  metadata?: Record<string, any>;
  progress?: unknown;
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

export interface JobMonitorConfig {
  driver: string;
  default: string;
  connections: Record<string, any>;
  /** Maximum live Redis jobs inspected for exact creation-order pagination. */
  redisScanLimit?: number;
  /** Bounded distributed worker metadata read, default 100, maximum 1000. */
  workerTelemetryLimit?: number;
  /** Exclusive requires all queue consumers to publish Svelar heartbeats. */
  workerTelemetryCoverage?: 'instrumented' | 'exclusive';
}

export class RedisJobScanLimitError extends Error {
  constructor(
    readonly queue: string,
    readonly scanLimit: number,
    readonly observedJobs: number,
  ) {
    super(`Redis job listing for queue "${queue}" exceeds the ${scanLimit}-job scan limit. Narrow the status filter or configure JobMonitor.redisScanLimit explicitly.`);
    this.name = 'RedisJobScanLimitError';
  }
}

export interface QueueHealth {
  driver: string;
  registry: QueueDefinition[];
  registeredJobs: string[];
  queues: Record<string, JobCounts>;
  runtime: Record<string, QueueRuntime>;
  oldestWaitingJob?: number; // timestamp in milliseconds
  failureRate: number; // percentage of process-local recorded outcomes in the last hour
  throughput: number; // process-local recorded completions in the last hour
}

export interface QueueRuntime {
  workers: number | null;
  paused: boolean | null;
  globalConcurrency: number | null;
  effectiveConcurrency: number | null;
  oldestWaitingJob: number | null;
  /** Age of the oldest ready waiting job, in milliseconds. */
  lag: number | null;
  /** First ordinary waiting-list job's timestamp, not a global oldest age. */
  nextWaitingJob: number | null;
  nextWaitingLag: number | null;
  workerTelemetry: WorkerTelemetrySnapshot | null;
}

const supportedStatuses = new Set<JobInfo['status']>(['waiting', 'active', 'completed', 'failed', 'delayed']);
const defaultRedisScanLimit = 1000;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareJobs(a: JobInfo, b: JobInfo): number {
  return b.createdAt - a.createdAt
    || compareText(a.queue, b.queue)
    || compareText(a.id, b.id)
    || compareText(a.status, b.status);
}

function parseDatabaseJobPayload(
  row: { id: string; payload: string },
  table: string,
): { jobClass?: string; priority?: number; metadata?: Record<string, any> } {
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
  private _config: JobMonitorConfig | null = null;
  private _bullmq: any = null;
  private _metrics: {
    processed: number[];  // timestamps of completed jobs
    failed: number[];     // timestamps of failed jobs
  } = { processed: [], failed: [] };

  configure(config: JobMonitorConfig): void {
    if (config.redisScanLimit !== undefined && (!Number.isSafeInteger(config.redisScanLimit) || config.redisScanLimit < 1)) {
      throw new RangeError('redisScanLimit must be a positive safe integer.');
    }
    if (config.workerTelemetryLimit !== undefined && (!Number.isSafeInteger(config.workerTelemetryLimit)
      || config.workerTelemetryLimit < 1 || config.workerTelemetryLimit > maxWorkerTelemetryLimit)) {
      throw new RangeError(`workerTelemetryLimit must be an integer between 1 and ${maxWorkerTelemetryLimit}.`);
    }
    if (config.workerTelemetryCoverage !== undefined && !['instrumented', 'exclusive'].includes(config.workerTelemetryCoverage)) {
      throw new TypeError('workerTelemetryCoverage must be instrumented or exclusive.');
    }
    this._config = { ...config };
  }

  private getDefaultQueue(): string {
    return this._config?.connections[this._config.default]?.queue ?? 'default';
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
   * Get job counts for a queue on the configured default connection.
   */
  async getCounts(queueName: string = this.getDefaultQueue()): Promise<JobCounts> {
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
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(offset + limit)) {
      throw new RangeError('Job pagination requires non-negative safe integer limit and offset.');
    }
    if (limit === 0 || (filter.status !== undefined && !supportedStatuses.has(filter.status))) return [];

    // Each source contributes its prefix; offset is applied only after the merge.
    const prefix = { ...filter, limit: offset + limit, offset: 0 };
    if (driver === 'redis') prefix.queue ??= this.getDefaultQueue();

    if (filter.status === 'failed') {
      return this.listFailedJobs({ ...prefix, limit, offset });
    }

    let jobs: JobInfo[] = [];
    if (driver === 'redis') {
      jobs = await this._listRedisJobs(prefix);
    } else if (driver === 'database') {
      jobs = await this._listDatabaseJobs(prefix);
    }

    if (!filter.status) {
      jobs.push(...await this.listFailedJobs(prefix));
    }

    return jobs.sort(compareJobs).slice(offset, offset + limit);
  }

  /**
   * Get details for a single job. Pass the queue for queue-local Redis IDs.
   * Ambiguous live/persisted IDs return null instead of selecting either job.
   */
  async getJob(jobId: string, queueName?: string): Promise<JobInfo | null> {
    return (await this.resolveJob(jobId, queueName))?.info ?? null;
  }

  private async resolveJob(jobId: string, queueName?: string): Promise<{
    info: JobInfo;
    source: 'redis' | 'database' | 'failed';
  } | null> {
    const driver = this._config?.connections[this._config.default]?.driver;
    const scope = driver === 'redis' ? queueName ?? this.getDefaultQueue() : queueName;
    let live: JobInfo | null = null;

    if (driver === 'redis') {
      live = await this._getRedisJob(jobId, scope!);
    } else if (driver === 'database') {
      live = await this._getDatabaseJob(jobId, scope);
    }

    const failed = await this.findFailedJob(jobId, scope);
    // IDs can overlap between the live driver and the persisted failure store.
    if (live && failed) return null;
    if (live) return { info: live, source: driver as 'redis' | 'database' };
    return failed ? { info: failed, source: 'failed' } : null;
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string, queueName?: string): Promise<boolean> {
    const target = await this.resolveJob(jobId, queueName);
    if (!target || target.info.status !== 'failed') return false;
    if (target.source === 'failed') {
      return Queue.retry(jobId);
    }

    if (target.source === 'redis') {
      return this._retryRedisJob(jobId, target.info.queue);
    }

    return false;
  }

  /**
   * Delete a job from the queue
   */
  async deleteJob(jobId: string, queueName?: string): Promise<boolean> {
    const target = await this.resolveJob(jobId, queueName);
    if (!target) return false;
    if (target.source === 'failed') {
      return this.deleteFailedJob(jobId, target.info.queue);
    }

    if (target.source === 'redis') {
      return this._deleteRedisJob(jobId, target.info.queue);
    }
    if (target.source === 'database') {
      return this._deleteDatabaseJob(jobId, target.info.queue);
    }

    return false;
  }

  /**
   * Get overall queue health metrics
   */
  async getHealth(): Promise<QueueHealth> {
    const driver = this._config?.connections[this._config.default]?.driver ?? 'sync';
    const registry = Queue.queues();
    const queues: Record<string, JobCounts> = {};
    const runtime: Record<string, QueueRuntime> = {};
    const observedQueues = registry.filter(queue => !queue.connection || queue.connection === this._config?.default);
    for (const name of new Set([this.getDefaultQueue(), ...observedQueues.map(queue => queue.name)])) {
      queues[name] = await this.getCounts(name);
      runtime[name] = await this.getRuntime(name, driver, queues[name]);
    }
    const oldest = Object.values(runtime)
      .map(state => state.oldestWaitingJob)
      .filter((timestamp): timestamp is number => timestamp !== null);

    const hourAgo = Date.now() - 3600000;
    const recentProcessed = this._metrics.processed.filter(t => t > hourAgo).length;
    const recentFailed = this._metrics.failed.filter(t => t > hourAgo).length;
    const total = recentProcessed + recentFailed;

    return {
      driver,
      registry,
      registeredJobs: Queue.registeredJobs(),
      queues,
      runtime,
      oldestWaitingJob: oldest.length ? Math.min(...oldest) : undefined,
      failureRate: total > 0 ? (recentFailed / total) * 100 : 0,
      throughput: recentProcessed,
    };
  }

  /**
   * Flush all completed jobs (cleanup)
   */
  async flushCompleted(queueName: string = this.getDefaultQueue()): Promise<number> {
    const driver = this._config?.connections[this._config.default]?.driver;

    if (driver === 'redis') {
      return this._flushRedisCompleted(queueName);
    }

    return 0;
  }

  /**
   * Flush all failed jobs
   */
  async flushFailed(queueName: string = this.getDefaultQueue()): Promise<number> {
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
      id: String(row.id),
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

    if (filter.queue !== undefined) {
      query.where('queue', filter.queue);
    }
    if (filter.jobClass) {
      query.where('job_class', filter.jobClass);
    }

    const rows = await this.jobRowsPrefix(query, 'failed_at', offset + limit);
    return rows.map((row: any) => this.failedRowToInfo(row)).sort(compareJobs).slice(offset, offset + limit);
  }

  private async jobRowsPrefix(query: QueryBuilder<any>, timestampColumn: string, limit: number): Promise<any[]> {
    const rows = await query.clone().orderBy(timestampColumn, 'desc').limit(limit).get();
    if (!rows.length || rows.length < limit) return rows;
    const boundary = rows[rows.length - 1][timestampColumn];
    // Include the entire boundary tie so database collation cannot change pages.
    const ties = await query.clone().where(timestampColumn, boundary).get();
    return [...rows.filter(row => row[timestampColumn] > boundary), ...ties];
  }

  private async findFailedJob(jobId: string, queueName?: string): Promise<JobInfo | null> {
    const query = this.failedQuery().where('id', jobId);
    if (queueName !== undefined) query.where('queue', queueName);
    const row = await query.first();
    return row ? this.failedRowToInfo(row) : null;
  }

  private async deleteFailedJob(jobId: string, queueName: string): Promise<boolean> {
    const deleted = await this.failedQuery().where('id', jobId).where('queue', queueName).delete();
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
      const counts = await queue.getJobCounts('waiting', 'prioritized', 'active', 'completed', 'delayed');
      const failed = await this.countFailedJobs(queueName);
      const waiting = (counts.waiting ?? 0) + (counts.paused ?? 0) + (counts.prioritized ?? 0);
      return {
        waiting,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed,
        delayed: counts.delayed ?? 0,
        total: waiting + (counts.active ?? 0) + (counts.completed ?? 0) + failed + (counts.delayed ?? 0),
      };
    } finally {
      await queue.close();
    }
  }

  private async _listRedisJobs(filter: JobFilter): Promise<JobInfo[]> {
    const queueName = filter.queue ?? this.getDefaultQueue();
    const queue = await this.getRedisQueue(queueName);

    try {
      const statuses = filter.status === 'waiting'
        ? ['wait', 'paused', 'prioritized']
        : filter.status ? [filter.status] : ['wait', 'paused', 'prioritized', 'active', 'completed', 'delayed'];
      const scanLimit = this._config?.redisScanLimit ?? defaultRedisScanLimit;
      const counts = await queue.getJobCounts(...statuses);
      const count = statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);
      if (count > scanLimit) throw new RedisJobScanLimitError(queueName, scanLimit, count);

      // Native ranges are not creation-ordered. Bound exact scans and fail closed
      // on growth beyond the budget rather than returning a misleading partial page.
      const jobs: any[] = [];
      for (const status of statuses) {
        const remaining = scanLimit - jobs.length;
        const batch = await queue.getJobs([status], 0, remaining);
        if (batch.length > remaining) {
          throw new RedisJobScanLimitError(queueName, scanLimit, jobs.length + batch.length);
        }
        jobs.push(...batch);
      }
      const result: JobInfo[] = [];
      for (const job of jobs) {
        if (!job || (filter.jobClass && (job.data?.jobClass ?? job.name) !== filter.jobClass)) continue;
        const info = await this._bullmqJobToInfo(job, queueName);
        if (info && (!filter.status || info.status === filter.status)) result.push(info);
      }
      return result.sort(compareJobs).slice(0, filter.limit ?? 50);
    } finally {
      await queue.close();
    }
  }

  private async _getRedisJob(jobId: string, queueName: string): Promise<JobInfo | null> {
    const queue = await this.getRedisQueue(queueName);
    try {
      const job = await queue.getJob(jobId);
      return job ? await this._bullmqJobToInfo(job, queueName) : null;
    } finally {
      await queue.close();
    }
  }

  private async _retryRedisJob(jobId: string, queueName: string): Promise<boolean> {
    const queue = await this.getRedisQueue(queueName);
    try {
      const job = await queue.getJob(jobId);
      if (!job || await job.getState() !== 'failed') return false;
      await job.retry();
      return true;
    } finally {
      await queue.close();
    }
  }

  private async _deleteRedisJob(jobId: string, queueName: string): Promise<boolean> {
    const queue = await this.getRedisQueue(queueName);
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

  private async _bullmqJobToInfo(job: any, queueName: string): Promise<JobInfo | null> {
    const nativeState = await job.getState();
    const state = nativeState === 'wait' || nativeState === 'paused' || nativeState === 'prioritized'
      ? 'waiting' : nativeState;
    if (!supportedStatuses.has(state)) return null;

    return {
      id: String(job.id),
      jobClass: job.data?.jobClass ?? job.name ?? 'Unknown',
      queue: queueName,
      status: state as JobInfo['status'],
      attempts: job.attemptsMade ?? 0,
      maxAttempts: job.opts?.attempts ?? 3,
      priority: job.opts?.priority,
      metadata: job.data?.metadata,
      progress: job.progress,
      payload: JSON.stringify(job.data ?? {}),
      error: job.failedReason ?? undefined,
      createdAt: job.timestamp ?? 0,
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
    if (filter.status === 'completed') return [];
    const nowSec = Math.floor(Date.now() / 1000);

    const query = this.dbQuery();

    if (filter.queue !== undefined) {
      query.where('queue', filter.queue);
    }

    if (filter.status === 'waiting') {
      query.whereNull('reserved_at').where('available_at', '<=', nowSec);
    } else if (filter.status === 'active') {
      query.whereNotNull('reserved_at');
    } else if (filter.status === 'delayed') {
      query.whereNull('reserved_at').where('available_at', '>', nowSec);
    }

    // The portable database schema stores jobClass inside JSON payloads.
    const rows = filter.jobClass
      ? await query.get()
      : await this.jobRowsPrefix(query, 'created_at', limit);

    return (rows ?? []).map((row: any) => this.databaseRowToInfo(row, nowSec))
      .filter(info => !filter.jobClass || info.jobClass === filter.jobClass)
      .sort(compareJobs)
      .slice(0, limit);
  }

  private async _getDatabaseJob(jobId: string, queueName?: string): Promise<JobInfo | null> {
    const query = this.dbQuery().where('id', jobId);
    if (queueName !== undefined) query.where('queue', queueName);
    const row = await query.first();
    return row ? this.databaseRowToInfo(row, Math.floor(Date.now() / 1000)) : null;
  }

  private databaseRowToInfo(row: any, nowSec: number): JobInfo {
    const data = parseDatabaseJobPayload(row, this.getDbTable());
    const isActive = row.reserved_at != null;
    const isDelayed = !isActive && row.available_at > nowSec;

    return {
      id: String(row.id),
      jobClass: data.jobClass ?? 'Unknown',
      queue: row.queue,
      status: isActive ? 'active' : (isDelayed ? 'delayed' : 'waiting'),
      attempts: row.attempts ?? 0,
      maxAttempts: row.max_attempts ?? 3,
      priority: data.priority,
      metadata: data.metadata,
      payload: row.payload,
      createdAt: (row.created_at ?? 0) * 1000,
      processedAt: isActive ? row.reserved_at * 1000 : undefined,
      delayedUntil: isDelayed ? row.available_at * 1000 : undefined,
    };
  }

  private async _deleteDatabaseJob(jobId: string, queueName: string): Promise<boolean> {
    const deleted = await this.dbQuery().where('id', jobId).where('queue', queueName).delete();
    return deleted > 0;
  }

  private async getRuntime(queueName: string, driver: string, counts: JobCounts): Promise<QueueRuntime> {
    const state: QueueRuntime = {
      workers: null,
      paused: null,
      globalConcurrency: null,
      effectiveConcurrency: null,
      oldestWaitingJob: null,
      lag: null,
      nextWaitingJob: null,
      nextWaitingLag: null,
      workerTelemetry: null,
    };
    if (driver === 'database') {
      const row = await this.dbQuery().select('created_at').where('queue', queueName)
        .whereNull('reserved_at').where('available_at', '<=', Math.floor(Date.now() / 1000))
        .orderBy('created_at').first();
      state.oldestWaitingJob = row ? row.created_at * 1000 : null;
      state.lag = row ? Math.max(0, Date.now() - state.oldestWaitingJob!) : 0;
      state.nextWaitingJob = state.oldestWaitingJob;
      state.nextWaitingLag = row ? state.lag : null;
    } else if (driver === 'redis') {
      const queue = await this.getRedisQueue(queueName);
      try {
        state.workerTelemetry = await readWorkerTelemetry(queue, queueName,
          this._config?.workerTelemetryLimit ?? defaultWorkerTelemetryLimit,
          this._config?.connections[this._config.default]?.workerHeartbeat === false
            ? 'instrumented' : this._config?.workerTelemetryCoverage ?? 'instrumented');
        if (typeof queue.isPaused === 'function') state.paused = await queue.isPaused();
        let globalConcurrencyObserved = false;
        if (typeof queue.getGlobalConcurrency === 'function') {
          const concurrency = await queue.getGlobalConcurrency();
          if (concurrency === null || (Number.isSafeInteger(concurrency) && concurrency >= 0)) {
            state.globalConcurrency = concurrency;
            globalConcurrencyObserved = true;
          }
        }
        if (state.workerTelemetry.complete && state.workerTelemetry.coverage === 'exclusive') {
          state.workers = state.workerTelemetry.observed!.live;
          if (state.paused === false && globalConcurrencyObserved) {
            const capacity = state.workerTelemetry.observed!.concurrency;
            state.effectiveConcurrency = Math.min(capacity, state.globalConcurrency ?? capacity);
          }
        }
        if (state.paused === true) state.effectiveConcurrency = 0;
        const jobs = typeof queue.getWaiting === 'function'
          ? await queue.getWaiting(0, 0)
          : await queue.getJobs(['waiting'], 0, 0, true);
        const head = jobs.length === 1 ? jobs[0] : null;
        if (head && Number.isFinite(head.timestamp)) {
          state.nextWaitingJob = head.timestamp;
          state.nextWaitingLag = Math.max(0, Date.now() - head.timestamp);
        }
        // Queue order (including retries/LIFO) and priority order are not creation
        // order. A bounded head read cannot establish the absolute oldest job.
        if (counts.waiting === 0 && !jobs.some((job: any) => job != null)) state.lag = 0;
      } finally {
        await queue.close();
      }
    }
    return state;
  }

}

export const JobMonitor = singleton('svelar.jobMonitor', () => new JobMonitorService());
