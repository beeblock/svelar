/**
 * Svelar Queue / Jobs
 *
 * Background job processing with sync, in-memory, and database-backed queues.
 * Dispatch jobs from anywhere — controllers, services, model hooks, middleware,
 * other jobs, or CLI commands.
 *
 * @example
 * ```ts
 * import { Queue, Job } from '@beeblock/svelar/queue';
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

import { assertSqlIdentifier, Connection } from '../database/Connection.js';
import { createRequire } from 'node:module';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { ApplicationContext, type ApplicationContextSnapshot } from '../support/Context.js';
import { heartbeatConfig, startWorkerHeartbeat, type WorkerHeartbeatConfig } from './BullMQTelemetry.js';
import { FailedJobStore, type FailedJobRecord } from './FailedJobStore.js';
import { metadataRow } from './Metadata.js';
import { QueueEventStore } from './EventStore.js';
import { RedisQueueOperations } from './RedisOperations.js';
import { redisConnection } from './RedisConnection.js';
import { databaseAdapter, redisAdapter, volatileAdapter, type AdapterServices } from './Adapters.js';
import { boundedLimit, pageOptions, QueueCapabilityError, type QueueMonitoringAdapter } from './Monitoring.js';
export type { FailedJobRecord } from './FailedJobStore.js';
export * from './Monitoring.js';

export type { WorkerHeartbeatConfig } from './BullMQTelemetry.js';

// ── Types ──────────────────────────────────────────────────

export type QueueDriver = 'sync' | 'memory' | 'database' | 'redis';

export interface QueueConfig {
  default: string;
  connections: Record<string, QueueConnectionConfig>;
  queues?: readonly QueueDefinition[];
  workers?: readonly WorkerProfile[];
  /** Named application database holding the failed-job ledger. */
  failedConnection?: string;
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
  /** Distributed worker telemetry; false disables publication. */
  workerHeartbeat?: WorkerHeartbeatConfig | false;
  /** Producer connection/command deadline, milliseconds (default 2000, max 60000). */
  producerTimeoutMs?: number;
  databaseConnection?: string;
  /** Renewed database reservation lease, milliseconds (default 30000). */
  leaseDurationMs?: number;
  monitoringCoverage?: 'instrumented' | 'exclusive';
  /** Default job options for BullMQ */
  defaultJobOptions?: {
    removeOnComplete?: boolean | number;
    removeOnFail?: boolean | number;
  };
}

export interface DispatchOptions {
  connection?: string;
  /** Queue name */
  queue?: string;
  /** Delay in seconds before processing */
  delay?: number;
  /** Max retry attempts */
  maxAttempts?: number;
  /** Stable queue job id for idempotency/deduplication */
  jobId?: string;
  /** Driver-supported priority. Lower numbers run first in BullMQ. */
  priority?: number;
  /** Skip enqueueing when a job with the same jobId already exists. */
  deduplicate?: boolean;
  /** Metadata carried in job storage for dashboards/audit; no search index is implied. */
  metadata?: Record<string, any>;
  /** Explicit execution context; {} is a system job with no inherited actor/tenant. */
  context?: ApplicationContextSnapshot;
  /** Native Redis deduplication; unsupported drivers reject instead of approximating it. */
  deduplication?: QueueDeduplication;
}

export type QueueDeduplication =
  | { id: string; mode: 'until-completed' | 'until-processing' | 'coalesce' }
  | { id: string; mode: 'throttle' | 'debounce'; ttl: number };

export interface WorkerOptions {
  concurrency?: number;
  lockDuration?: number;
  stalledInterval?: number;
  maxStalledCount?: number;
}
export interface WorkOptions extends WorkerOptions {
  queue?: string;
  connection?: string;
  profile?: string;
  maxJobs?: number;
  sleep?: number;
}
export interface ResolvedWorkOptions extends WorkOptions { queue: string; connection: string; concurrency: number; }
export interface WorkerProfile extends WorkerOptions {
  name: string;
  queue: string;
  connection?: string;
}
export interface JobDefinition {
  name?: string;
  label?: string;
  queue?: string;
  connection?: string;
  dispatch?: Omit<DispatchOptions, 'queue' | 'connection'>;
}
export interface JobConstructor<T extends Job = Job> {
  new (...args: any[]): T;
  readonly name: string;
  readonly queueJob?: boolean;
  readonly definition?: JobDefinition;
}
export interface RegisteredJobDefinition extends JobDefinition { name: string; }
export interface BulkDispatchItem { job: Job; options?: DispatchOptions; }

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive safe integer.`);
}

function validateWorkerOptions(options: WorkerOptions): void {
  for (const field of ['concurrency', 'lockDuration', 'stalledInterval'] as const) {
    if (options[field] !== undefined) positiveInteger(options[field]!, field);
  }
  for (const field of ['lockDuration', 'stalledInterval'] as const) {
    if (options[field] !== undefined && options[field]! > 2_147_483_647) throw new RangeError(`${field} exceeds the supported timer duration.`);
  }
  if (options.maxStalledCount !== undefined && (!Number.isSafeInteger(options.maxStalledCount) || options.maxStalledCount < 0)) {
    throw new RangeError('maxStalledCount must be a non-negative safe integer.');
  }
}

function validateDeduplication(options: QueueDeduplication): void {
  if (!options || typeof options.id !== 'string' || !options.id || options.id.length > 256 ||
      !['until-completed', 'until-processing', 'throttle', 'debounce', 'coalesce'].includes(options.mode)) {
    throw new TypeError('Invalid native deduplication id or mode.');
  }
  if (options.mode === 'throttle' || options.mode === 'debounce') positiveInteger(options.ttl, 'Deduplication ttl');
  for (const key of Object.keys(options)) {
    if (!['id', 'mode', ...(options.mode === 'throttle' || options.mode === 'debounce' ? ['ttl'] : [])].includes(key)) {
      throw new TypeError(`Unsupported deduplication option "${key}".`);
    }
  }
}

export interface QueueDefinition {
  name: string;
  label?: string;
  description?: string;
  connection?: string;
  concurrency?: number;
  metadata?: Record<string, any>;
  workerProfile?: string;
}

export interface QueueConnectionCatalogEntry {
  name: string;
  driver: QueueDriver | 'unknown';
  queue: string;
  isDefault: boolean;
}
export interface QueueConnectionCatalogPage {
  connections: QueueConnectionCatalogEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
export interface QueueDiscoveryOptions { limit?: number; cursor?: string; }
export interface QueueDiscoveryPage {
  queues: QueueDefinition[];
  total: null;
  /** End of this weakly consistent registry scan, not proof of foreign broker coverage. */
  complete: boolean;
  nextCursor: string | null;
  coverage: 'instrumented';
}

interface QueueDiscoveryPosition { scan?: string; skip?: number; after?: string; }
interface QueueDiscoveryBatch { names: string[]; position: QueueDiscoveryPosition | null; }

function discoveryCursor(cursor: string | undefined, connection: string, driver: QueueDriver, limit: number): QueueDiscoveryPosition {
  if (cursor === undefined) return {};
  if (typeof cursor !== 'string' || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new TypeError('Invalid queue discovery cursor.');
  let value: any;
  try {
    const buffer = Buffer.from(cursor, 'base64url');
    if (buffer.toString('base64url') !== cursor) throw new Error('Invalid encoding');
    value = JSON.parse(buffer.toString('utf8'));
  } catch { throw new TypeError('Invalid queue discovery cursor.'); }
  if (value?.version !== 1 || value.connection !== connection || value.driver !== driver || value.limit !== limit || !value.position
    || typeof value.position !== 'object' || Array.isArray(value.position)) throw new TypeError('Queue discovery cursor does not match its connection, driver and limit.');
  const position = value.position;
  if (driver === 'redis') {
    if (typeof position.scan !== 'string' || !/^\d{1,20}$/.test(position.scan) || BigInt(position.scan) > 18_446_744_073_709_551_615n
      || !Number.isSafeInteger(position.skip) || position.skip < 0 || !Number.isSafeInteger(position.skip + limit)
      || Object.keys(position).some(key => !['scan', 'skip'].includes(key))) throw new TypeError('Invalid Redis queue discovery cursor.');
  } else if (typeof position.after !== 'string' || !position.after || Buffer.byteLength(position.after) > 1024
    || Object.keys(position).some(key => key !== 'after')) throw new TypeError('Invalid database queue discovery cursor.');
  return position;
}

function discoveredNames(names: unknown[]): string[] {
  if (names.some(name => typeof name !== 'string' || !name || Buffer.byteLength(name) > 1024 || name.includes(':') || name.includes('\0'))) {
    throw new TypeError('Invalid shared queue registry entry.');
  }
  return names as string[];
}

export type QueueProgressValue = number | string | Record<string, any>;

export interface QueueProgressUpdate {
  value: QueueProgressValue;
  message?: string;
  metadata?: Record<string, any>;
  updatedAt: number;
}

type QueueProgressReporter = (update: QueueProgressUpdate) => void | Promise<void>;

interface QueuedJob {
  id: string;
  jobClass: string;
  payload: string;
  queue: string;
  attempts: number;
  maxAttempts: number;
  priority?: number;
  deduplicate?: boolean;
  metadata?: Record<string, any>;
  availableAt: number;
  createdAt: number;
  job: Job;
  context?: ApplicationContextSnapshot;
  connection?: string;
  deduplication?: QueueDeduplication;
  replayRecordId?: string;
  reservationToken?: string;
}

function normalizeProgressUpdate(
  value: QueueProgressValue,
  message?: string,
  metadata?: Record<string, any>,
): QueueProgressUpdate {
  return {
    value,
    message,
    metadata,
    updatedAt: Date.now(),
  };
}

function parseDatabaseJobPayload(
  row: { id: string; payload: string },
  table: string,
): {
  jobClass: string;
  payload: string;
  context?: ApplicationContextSnapshot;
  priority?: number;
  metadata?: Record<string, any>;
  retryDelay?: number;
  connection?: string;
} {
  try {
    const data = JSON.parse(row.payload);
    if (!data || typeof data.jobClass !== 'string' || typeof data.payload !== 'string') {
      throw new Error('expected object with string jobClass and payload fields');
    }
    return data;
  } catch (error: any) {
    throw new Error(
      `Failed to parse queued job payload for job "${row.id}" in table "${table}": ${error.message ?? error}`
    );
  }
}

function withJobContext<T>(queuedJob: QueuedJob, callback: () => T): T | Promise<T> {
  return ApplicationContext.runIsolated({
    ...(queuedJob.context ?? {}),
    jobId: queuedJob.id,
    jobClass: queuedJob.jobClass,
    queue: queuedJob.queue,
  }, callback);
}

async function handleQueuedJob(queuedJob: QueuedJob): Promise<void> {
  queuedJob.job.id = queuedJob.id;
  queuedJob.job.queue = queuedJob.queue;
  queuedJob.job.maxAttempts = queuedJob.maxAttempts;

  await withJobContext(queuedJob, () => queuedJob.job.handle());
}

// ── Job Base Class ─────────────────────────────────────────

export abstract class Job {
  static readonly queueJob = true;
  static definition?: JobDefinition;
  /** Queue job id assigned at dispatch/processing time */
  id?: string;

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
   * Report progress for long-running jobs.
   *
   * Redis/BullMQ workers persist this through BullMQ's native progress field.
   * Other drivers expose jobId/jobClass/queue in ApplicationContext so tests
   * and custom runners can observe progress with queueProgressReporter.
   */
  protected async progress(
    value: QueueProgressValue,
    message?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const reporter = ApplicationContext.get<QueueProgressReporter>('queueProgressReporter');
    if (reporter) {
      await reporter(normalizeProgressUpdate(value, message, metadata));
    }
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
      if (['__proto__', 'prototype', 'constructor'].includes(key) || typeof (this as any)[key] === 'function') {
        throw new TypeError(`Cannot restore reserved job attribute "${key}".`);
      }
      if (key === 'attempts') continue;
      if (key === 'maxAttempts' && (!Number.isSafeInteger(value) || value < 1)) throw new TypeError('Invalid restored maxAttempts.');
      if (key === 'retryDelay' && (!Number.isFinite(value) || value < 0)) throw new TypeError('Invalid restored retryDelay.');
      if (key === 'queue' && (typeof value !== 'string' || !value)) throw new TypeError('Invalid restored queue.');
      (this as any)[key] = value;
    }
  }
}

// ── Queue Drivers ──────────────────────────────────────────

interface QueueDriverInterface {
  push(job: QueuedJob): Promise<string | void>;
  pushBulk?(jobs: QueuedJob[]): Promise<string[]>;
  pop(queue?: string): Promise<QueuedJob | null>;
  size(queue?: string): Promise<number>;
  clear(queue?: string): Promise<void>;
  close?(): Promise<void>;
}

interface FailedJobRecorder {
  store(job: QueuedJob, error: Error): Promise<void>;
}

// Sync driver — runs immediately in the same process
class SyncDriver implements QueueDriverInterface {
  constructor(private failedStore?: FailedJobRecorder) {}

  async push(queuedJob: QueuedJob): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = queuedJob.attempts + 1; attempt <= queuedJob.maxAttempts; attempt += 1) {
      queuedJob.attempts = attempt;
      queuedJob.job.attempts = attempt;

      try {
        await handleQueuedJob(queuedJob);
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < queuedJob.maxAttempts) {
          await withJobContext(queuedJob, () => queuedJob.job.retrying(attempt));
        }
      }
    }

    if (lastError) {
      await withJobContext(queuedJob, () => queuedJob.job.failed(lastError!));
      await this.failedStore?.store(queuedJob, lastError);
    }
  }
  async pop(): Promise<QueuedJob | null> { return null; }
  async size(): Promise<number> { return 0; }
  async clear(): Promise<void> {}
}

// Memory driver — in-process queue (lost on restart)
class MemoryDriver implements QueueDriverInterface {
  private queues = new Map<string, QueuedJob[]>();

  async pushBulk(jobs: QueuedJob[]): Promise<string[]> {
    const ids = new Set((this.queues.get(jobs[0].queue) ?? []).map((job) => job.id));
    for (const job of jobs) {
      if (ids.has(job.id) && !job.deduplicate) throw new Error(`Queue job id "${job.id}" already exists.`);
      ids.add(job.id);
    }
    const result: string[] = [];
    for (const job of jobs) result.push(await this.push(job));
    return result;
  }

  async push(job: QueuedJob): Promise<string> {
    const queueName = job.queue;
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, []);
    }
    const jobs = this.queues.get(queueName)!;
    if (jobs.some((queued) => queued.id === job.id)) {
      if (!job.deduplicate) throw new Error(`Queue job id "${job.id}" already exists.`);
      return job.id;
    }
    jobs.push(job);
    jobs.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.createdAt - b.createdAt);
    return job.id;
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
    private config: QueueConnectionConfig,
    private connectionName: string,
    private failedStore: FailedJobStore,
    private includeLegacy: boolean,
  ) {
    this.table = assertSqlIdentifier(table, 'Queue jobs table name');
    const lease = config.leaseDurationMs ?? 30000;
    if (!Number.isSafeInteger(lease) || lease < 100 || lease > 3600000) throw new RangeError('Database queue leaseDurationMs must be 100..3600000.');
  }

  private query(): QueryBuilder<any> {
    return new QueryBuilder(this.table, undefined, this.config.databaseConnection).whereNested(query => {
      query.where('queue_connection', this.connectionName);
      if (this.includeLegacy) query.orWhereNull('queue_connection');
    });
  }
  private events() { return new QueueEventStore(this.config.databaseConnection); }
  adapter(services: AdapterServices): QueueMonitoringAdapter {
    return databaseAdapter(services, () => this.query(), this.events(), () => this.recover(services.queue));
  }
  async discoverPage(position: QueueDiscoveryPosition, limit: number): Promise<QueueDiscoveryBatch> {
    const query = this.query().select('queue').distinct().orderBy('queue').limit(limit + 1);
    if (position.after !== undefined) query.where('queue', '>', position.after);
    const names = discoveredNames((await query.get()).map(row => row.queue));
    return { names: names.slice(0, limit), position: names.length > limit ? { after: names[limit - 1] } : null };
  }

  async push(job: QueuedJob): Promise<void> {
    await Connection.transaction(async () => {
      try { await Connection.withSavepointIfNeeded(() => this.query().insert(this.row(job)), this.config.databaseConnection); }
      catch (error: any) {
        const uniqueViolation = ['23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE'].includes(error?.code) ||
          error?.code === 'ERR_SQLITE_ERROR' && [1555, 2067].includes(error?.errcode);
        if (!job.deduplicate || !uniqueViolation) throw error;
        if (!await this.query().where('id', job.id).where('queue', job.queue).exists()) throw error;
        return;
      }
      await this.events().record(this.connectionName, job.queue, job.id, 'live', 'dispatched');
    }, this.config.databaseConnection);
  }

  async pushBulk(jobs: QueuedJob[]): Promise<string[]> {
    if (jobs.some((job) => job.deduplicate)) throw new Error('Database bulk dispatch does not support deduplication.');
    await Connection.transaction(async () => {
      await this.query().insertMany(jobs.map((job) => this.row(job)));
      for (const job of jobs) await this.events().record(this.connectionName, job.queue, job.id, 'live', 'dispatched');
    }, this.config.databaseConnection);
    return jobs.map((job) => job.id);
  }

  private row(job: QueuedJob): Record<string, any> {
    return {
      id: job.id,
      queue: job.queue,
      payload: JSON.stringify({
        jobClass: job.jobClass,
        payload: job.payload,
        context: job.context,
        priority: job.priority,
        metadata: job.metadata,
        connection: job.connection,
        retryDelay: job.job.retryDelay,
      }),
      attempts: job.attempts,
      max_attempts: job.maxAttempts,
      reserved_at: null,
      available_at: Math.floor(job.availableAt / 1000),
      created_at: Math.floor(job.createdAt / 1000),
      queue_connection: this.connectionName,
      reservation_token: null, lease_expires_at: null, completed_at: null,
      replay_id: job.replayRecordId ?? null,
      ...metadataRow(job.metadata, job.context),
    };
  }

  async pop(queue: string = 'default'): Promise<QueuedJob | null> {
    await this.recover(queue);
    const nowSec = Math.floor(Date.now() / 1000);

    const row = await this.query()
      .where('queue', queue)
      .where('available_at', '<=', nowSec)
      .whereNull('reserved_at')
      .whereNull('completed_at')
      .orderBy('created_at')
      .first();

    if (!row) return null;

    const data = parseDatabaseJobPayload(row, this.table);

    // Reconstruct the actual Job instance from the registry
    const jobInstance = this.registry.resolve(data.jobClass, data.payload);
    if (data.retryDelay !== undefined) jobInstance.retryDelay = data.retryDelay;

    // Reserve the job after validating that it can be parsed and restored.
    const token = crypto.randomUUID();
    const reserved = await this.query().where('id', row.id).whereNull('reserved_at').whereNull('completed_at').where('attempts', Number(row.attempts))
      .update({ reserved_at: nowSec, attempts: Number(row.attempts) + 1, reservation_token: token,
        lease_expires_at: Date.now() + (this.config.leaseDurationMs ?? 30000), queue_connection: this.connectionName,
        ...metadataRow(data.metadata, data.context) });
    if (reserved === 0) return null;

    await this.events().record(this.connectionName, queue, row.id, 'live', 'active', { attempt: Number(row.attempts) + 1 });
    return {
      id: row.id,
      jobClass: data.jobClass,
      payload: data.payload,
      queue: row.queue,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      availableAt: row.available_at * 1000,
      createdAt: row.created_at * 1000,
      job: jobInstance,
      context: data.context,
      connection: data.connection,
      priority: data.priority,
      metadata: data.metadata,
      reservationToken: token,
      replayRecordId: row.replay_id ?? undefined,
    };
  }

  async size(queue: string = 'default'): Promise<number> {
    return this.query().where('queue', queue).whereNull('reserved_at').whereNull('completed_at').count();
  }

  async clear(queue?: string): Promise<void> {
    if (queue) {
      await this.query().where('queue', queue).whereNull('reserved_at').whereNull('replay_id').delete();
    } else {
      await this.query().whereNull('reserved_at').whereNull('replay_id').delete();
    }
  }

  /**
   * Remove a completed job from the database
   */
  private owned(job: QueuedJob) { return this.query().where('id', job.id).where('reservation_token', job.reservationToken); }
  async delete(job: QueuedJob): Promise<void> {
    await Connection.transaction(async () => {
      const changed = job.replayRecordId
        ? await this.owned(job).update({ completed_at: Date.now(), reserved_at: null, reservation_token: null, lease_expires_at: null })
        : await this.owned(job).delete();
      if (changed !== 1) throw new Error('Database queue reservation was lost.');
      await this.events().record(this.connectionName, job.queue, job.id, 'live', 'completed', { attempt: job.attempts });
    }, this.config.databaseConnection);
  }

  /**
   * Release a failed job back to the queue with a delay
   */
  async release(job: QueuedJob, delaySec: number = 0): Promise<void> {
    const availableAt = delaySec === 0 ? Math.floor(Date.now() / 1000) : Math.ceil(Date.now() / 1000 + delaySec);
    if (await this.owned(job).update({
      reserved_at: null,
      available_at: availableAt,
      reservation_token: null, lease_expires_at: null,
    }) !== 1) throw new Error('Database queue reservation was lost.');
    await this.events().record(this.connectionName, job.queue, job.id, 'live', 'retrying', { attempt: job.attempts });
  }
  async exhaust(job: QueuedJob, error: Error): Promise<void> {
    await Connection.transaction(async () => {
      if (!await this.owned(job).exists()) throw new Error('Database queue reservation was lost.');
      await this.failedStore.store(job, error);
      if (await this.owned(job).delete() !== 1) throw new Error('Database queue reservation was lost.');
      await this.events().record(this.connectionName, job.queue, job.id, 'live', 'failed', { attempt: job.attempts });
    }, this.config.databaseConnection);
  }
  async execute(job: QueuedJob, callback: () => Promise<void>): Promise<void> {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = Promise.resolve();
    let failure: unknown;
    const lease = this.config.leaseDurationMs ?? 30000;
    const renew = () => {
      timer = setTimeout(() => {
        pending = (async () => {
          if (await this.owned(job).update({ lease_expires_at: Date.now() + lease }) !== 1) throw new Error('Database queue reservation was lost.');
        })().catch(error => { failure = error; }).then(() => { if (!stopped && !failure) renew(); });
      }, Math.floor(lease / 3));
    };
    renew();
    try { await callback(); }
    finally { stopped = true; if (timer) clearTimeout(timer); await pending; }
    if (failure) throw failure;
  }
  async recover(queue: string): Promise<number> {
    const now = Date.now();
    const rows = await this.query().where('queue', queue).whereNotNull('reserved_at').whereNull('completed_at')
      .whereNested(query => query.where('lease_expires_at', '<=', now).orWhereNested(nested => nested.whereNull('lease_expires_at')
        .where('reserved_at', '<=', Math.floor((now - (this.config.leaseDurationMs ?? 30000)) / 1000))))
      .orderBy('reserved_at').limit(100).get();
    let recovered = 0;
    for (const row of rows) {
      await Connection.transaction(async () => {
        const query = this.query().where('id', row.id).where('reserved_at', row.reserved_at);
        if (row.reservation_token == null) query.whereNull('reservation_token'); else query.where('reservation_token', row.reservation_token);
        if (row.lease_expires_at == null) query.whereNull('lease_expires_at'); else query.where('lease_expires_at', row.lease_expires_at);
        const token = crypto.randomUUID();
        if (await query.update({ reservation_token: token, lease_expires_at: now + (this.config.leaseDurationMs ?? 30000) }) !== 1) return;
        const data = parseDatabaseJobPayload(row, this.table);
        await this.events().record(this.connectionName, queue, row.id, 'live', 'stalled', { attempt: Number(row.attempts) });
        if (Number(row.attempts) >= Number(row.max_attempts)) {
          await this.failedStore.storeRaw({ id: row.id, queue, connection: this.connectionName, jobClass: data.jobClass,
            payload: data.payload, context: data.context, metadata: data.metadata, maxAttempts: Number(row.max_attempts), retryDelay: data.retryDelay,
          }, new Error('Database queue worker lost its reservation after the final attempt.'));
          await this.query().where('id', row.id).where('reservation_token', token).delete();
          await this.events().record(this.connectionName, queue, row.id, 'live', 'failed', { attempt: Number(row.attempts) });
        } else await this.query().where('id', row.id).where('reservation_token', token)
          .update({ reserved_at: null, reservation_token: null, lease_expires_at: null });
        recovered++;
      }, this.config.databaseConnection);
    }
    return recovered;
  }
}

// ── BullMQ / Redis driver ─────────────────────────────────
// Uses BullMQ under the hood for production-grade Redis queues with
// priorities, rate limiting, retries, delays, and dashboard support.
// Requires: npm install bullmq (peer dependency, loaded dynamically).

class RedisDriver implements QueueDriverInterface {
  private queues = new Map<string, any>();  // BullMQ Queue instances
  private pendingQueues = new Map<string, Promise<any>>();
  private workers = new Set<any>();
  private config: QueueConnectionConfig;
  private registry: JobRegistry;
  private _bullmq: any = null;
  private peerChecked = false;
  private operationStores = new Map<string, RedisQueueOperations>();

  constructor(config: QueueConnectionConfig, registry: JobRegistry, private connectionName: string) {
    if (config.workerHeartbeat !== false) heartbeatConfig(config.workerHeartbeat);
    positiveInteger(config.producerTimeoutMs ?? 2000, 'producerTimeoutMs');
    if ((config.producerTimeoutMs ?? 2000) > 60000) throw new RangeError('producerTimeoutMs must not exceed 60000.');
    this.config = config;
    this.registry = registry;
  }
  private operations(queue: string): RedisQueueOperations {
    if (!this.operationStores.has(queue)) this.operationStores.set(queue, new RedisQueueOperations(() => this.getQueue(queue), this.connectionName, queue));
    return this.operationStores.get(queue)!;
  }
  async observeLock(queue: string, id: string, duration: number, owner: string): Promise<void> {
    await this.operations(queue).observeLocks([id], duration, owner);
  }
  adapter(services: AdapterServices): QueueMonitoringAdapter {
    return redisAdapter(services, () => this.getQueue(services.queue), this.operations(services.queue), this.config.monitoringCoverage ?? 'instrumented');
  }
  async discoverPage(position: QueueDiscoveryPosition, limit: number): Promise<QueueDiscoveryBatch> {
    const queue = await this.getQueue(this.config.queue ?? 'default');
    const scan = position.scan ?? '0';
    const skip = position.skip ?? 0;
    const [next, batch] = await (await queue.client).sscan(`${this.config.prefix ?? 'svelar'}:svelar:registered-queues:v1`, scan, 'COUNT', limit);
    const names = discoveredNames(batch);
    const end = skip + limit;
    // COUNT is a Redis hint. Replay an oversized bucket rather than silently dropping its tail.
    return { names: names.slice(skip, end), position: end < names.length ? { scan, skip: end }
      : next !== '0' ? { scan: next, skip: 0 } : null };
  }

  private async getBullMQ(): Promise<any> {
    if (this._bullmq) return this._bullmq;
    try {
      const module = 'bullmq';
      this._bullmq = await import(/* @vite-ignore */ module);
      return this._bullmq;
    } catch {
      throw new Error(
        'bullmq is required for the Redis queue driver. Install it with: npm install bullmq'
      );
    }
  }

  private getRedisConnection(): Record<string, any> {
    return redisConnection(this.config);
  }

  private async getQueue(queueName: string): Promise<any> {
    const pending = this.pendingQueues.get(queueName);
    if (pending) return pending;
    if (this.queues.has(queueName)) return this.queues.get(queueName);
    const opening = this.openQueue(queueName);
    this.pendingQueues.set(queueName, opening);
    try { return await opening; }
    finally { if (this.pendingQueues.get(queueName) === opening) this.pendingQueues.delete(queueName); }
  }

  private async openQueue(queueName: string): Promise<any> {
    const bullmq = await this.getBullMQ();
    const timeout = this.config.producerTimeoutMs ?? 2000;
    const connection = { ...this.getRedisConnection(), maxRetriesPerRequest: 1, enableOfflineQueue: false,
      connectTimeout: timeout, commandTimeout: timeout, retryStrategy: () => null };
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
    queue.on?.('error', () => {}); // Dispatch reports errors; native emitters must not crash the HTTP process.
    if (typeof queue.waitUntilReady === 'function') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          queue.waitUntilReady(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Redis queue producer connection timed out.')), timeout); }),
        ]);
      } catch (error) {
        if (this.queues.get(queueName) === queue) this.queues.delete(queueName);
        await queue.close().catch(() => {});
        throw error;
      } finally { if (timer) clearTimeout(timer); }
    }
    if ('client' in queue) {
      try {
        const client = await queue.client;
        if (typeof client.sadd === 'function') await client.sadd(`${prefix}:svelar:registered-queues:v1`, queueName);
      } catch (error) { await this.discardQueue(queueName, queue); throw error; }
    }
    return queue;
  }

  async push(job: QueuedJob): Promise<string> {
    if (job.deduplication) this.assertNativeDeduplicationPeer();
    const queue = await this.getQueue(job.queue);
    const item = this.nativeJob(job);
    let result: any;
    try { result = await queue.add(item.name, item.data, item.opts); }
    catch (error) { await this.discardQueue(job.queue, queue); throw error; }
    if (result?.id !== undefined) await this.operations(job.queue).capture(result, 'dispatched');
    return result?.id === undefined ? job.id : String(result.id);
  }

  async pushBulk(jobs: QueuedJob[]): Promise<string[]> {
    if (jobs.some((job) => job.deduplication)) this.assertNativeDeduplicationPeer();
    const queue = await this.getQueue(jobs[0].queue);
    if (typeof queue.addBulk !== 'function') throw new Error('This Redis adapter does not support native bulk dispatch.');
    let results: any[];
    try { results = await queue.addBulk(jobs.map((job) => this.nativeJob(job))); }
    catch (error) { await this.discardQueue(jobs[0].queue, queue); throw error; }
    for (const job of results) if (job?.id !== undefined) await this.operations(jobs[0].queue).capture(job, 'dispatched');
    return results.map((job: any, index: number) => job?.id === undefined ? jobs[index].id : String(job.id));
  }

  private async discardQueue(name: string, queue: any): Promise<void> {
    if (this.queues.get(name) === queue) this.queues.delete(name);
    await queue.close().catch(() => {});
  }

  private assertNativeDeduplicationPeer(): void {
    if (this.peerChecked) return;
    const version = createRequire(import.meta.url)('bullmq/package.json').version as string;
    const match = /^5\.(\d+)\.(\d+)$/.exec(version);
    if (!match || Number(match[1]) < 77 || Number(match[1]) === 77 && Number(match[2]) < 4) {
      throw new Error('Native deduplication requires BullMQ >=5.77.4 <6; older versions must not silently ignore its options.');
    }
    this.peerChecked = true;
  }

  private nativeJob(job: QueuedJob): { name: string; data: Record<string, any>; opts: Record<string, any> } {
    const deduplication = job.deduplication;
    const native = deduplication ? {
      id: deduplication.id,
      ...('ttl' in deduplication ? { ttl: deduplication.ttl } : {}),
      ...(deduplication.mode === 'debounce' ? { extend: true, replace: true } : {}),
      ...(deduplication.mode === 'coalesce' ? { keepLastIfActive: true } : {}),
    } : undefined;
    const delay = deduplication?.mode === 'debounce' ? deduplication.ttl : Math.max(0, job.availableAt - Date.now());
    return { name: job.jobClass,
      data: { jobClass: job.jobClass, payload: job.payload, context: job.context, metadata: job.metadata, connection: job.connection, replayRecordId: job.replayRecordId,
        retryDelay: job.job.retryDelay, releaseDeduplicationOnStart: deduplication?.mode === 'until-processing' },
      opts: { jobId: job.id, delay: delay > 0 ? delay : undefined, attempts: job.maxAttempts, priority: job.priority,
        ...(job.replayRecordId ? { removeOnComplete: false, removeOnFail: false } : {}),
        deduplication: native, backoff: { type: 'fixed', delay: job.job.retryDelay * 1000 } },
    };
  }

  // pop() is not used with BullMQ — the Worker handles consuming.
  // This is kept for interface compatibility but should not be called directly.
  async pop(_queue?: string): Promise<QueuedJob | null> {
    return null;
  }

  async size(queue: string = 'default'): Promise<number> {
    const q = await this.getQueue(queue);
    const counts = await q.getJobCounts('waiting', 'delayed', 'active', 'prioritized');
    return (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0) + (counts.prioritized ?? 0);
  }

  async clear(queue?: string): Promise<void> {
    if (queue) {
      const q = await this.getQueue(queue);
      await q.obliterate({ force: false });
    } else {
      for (const q of this.queues.values()) {
        await q.obliterate({ force: false });
      }
    }
  }

  async close(): Promise<void> {
    const workerResults = await Promise.allSettled([...this.workers].map(async worker => worker.close()));
    await Promise.allSettled([...this.pendingQueues.values()]);
    const queueResults = await Promise.allSettled([...this.queues.values()].map(async queue => queue.close()));
    this.workers.clear();
    this.queues.clear();
    const failures = [...workerResults, ...queueResults]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Failed to close Redis queue resources.');
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
    options?: {
      concurrency?: number;
      autorun?: boolean;
      lockDuration?: number;
      stalledInterval?: number;
      maxStalledCount?: number;
    },
  ): Promise<any> {
    const bullmq = await this.getBullMQ();
    const connection = this.getRedisConnection();
    const prefix = this.config.prefix ?? 'svelar';

    const worker = new bullmq.Worker(
      queueName,
      async (bullJob: any) => {
        const data = bullJob.data;
        const jobInstance = registry.resolve(data.jobClass, data.payload);
        jobInstance.id = String(bullJob.id);
        jobInstance.queue = queueName;
        jobInstance.attempts = bullJob.attemptsMade + 1;
        if (data.releaseDeduplicationOnStart) await bullJob.removeDeduplicationKey();
        if (data.retryDelay !== undefined) jobInstance.retryDelay = data.retryDelay;
        jobInstance.maxAttempts = bullJob.opts?.attempts ?? jobInstance.maxAttempts;
        await this.operations(queueName).capture(bullJob, 'active', 'active');
        await this.operations(queueName).observeLocks([String(bullJob.id)], options?.lockDuration ?? 30000, worker.svelarWorkerId ?? 'starting');
        await ApplicationContext.runIsolated({
          ...(data.context ?? {}),
          jobId: String(bullJob.id),
          jobClass: data.jobClass,
          queue: queueName,
          queueProgressReporter: async (update: QueueProgressUpdate) => {
            await bullJob.updateProgress(update);
          },
        }, async () => {
          try { await jobInstance.handle(); }
          catch (error) {
            if (jobInstance.attempts < jobInstance.maxAttempts) {
              await jobInstance.retrying(jobInstance.attempts);
              await this.operations(queueName).capture(bullJob, 'retrying');
            }
            throw error;
          }
        });
      },
      {
        connection,
        prefix,
        concurrency: options?.concurrency ?? 1,
        autorun: options?.autorun ?? true,
        metrics: { maxDataPoints: 20160 },
        ...(options?.lockDuration !== undefined ? { lockDuration: options.lockDuration } : {}),
        ...(options?.stalledInterval !== undefined ? { stalledInterval: options.stalledInterval } : {}),
        ...(options?.maxStalledCount !== undefined ? { maxStalledCount: options.maxStalledCount } : {}),
      },
    );

    const failureTasks = new Set<Promise<void>>();
    const failureErrors: Error[] = [];
    worker.on('failed', (bullJob: any, err: Error) => {
      const task = (async () => {
        const data = bullJob?.data;
        const attemptsMade = bullJob?.attemptsMade ?? 0;
        const maxAttempts = bullJob?.opts?.attempts ?? 3;
        if (bullJob) {
          try { await this.operations(queueName).capture(bullJob, 'failed'); }
          catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            failureErrors.push(failure); worker.emit('svelar:error', failure);
          }
        }

        if (attemptsMade < maxAttempts && (typeof bullJob?.getState !== 'function' || await bullJob.getState() !== 'failed')) {
          return;
        }

        if (!data) {
          await failedStore.storeRaw({
            id: bullJob?.id, connection: this.connectionName,
            queue: queueName,
            jobClass: bullJob?.name ?? 'Unknown',
            payload: '{}',
          }, err);
          return;
        }

        let jobInstance: Job;
        try {
          jobInstance = registry.resolve(data.jobClass, data.payload);
        } catch (resolveError: any) {
          const failure = resolveError instanceof Error ? resolveError : err;
          await failedStore.storeRaw({
            id: bullJob?.id,
            queue: queueName,
            jobClass: data.jobClass ?? bullJob?.name ?? 'Unknown',
            payload: typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload ?? {}),
            context: data.context, metadata: data.metadata, connection: this.connectionName,
            maxAttempts, retryDelay: data.retryDelay, priority: bullJob?.opts?.priority,
          }, failure);
          return;
        }

        const queuedJob: QueuedJob = {
          id: bullJob.id,
          jobClass: data.jobClass,
          payload: data.payload,
          queue: queueName,
          attempts: attemptsMade,
          maxAttempts,
          availableAt: Date.now(),
          createdAt: bullJob.timestamp ?? Date.now(),
          job: jobInstance,
          context: data.context,
          connection: this.connectionName,
          metadata: data.metadata,
          priority: bullJob.opts?.priority,
        };
        jobInstance.id = String(bullJob.id);
        jobInstance.queue = queueName;
        jobInstance.attempts = attemptsMade;
        jobInstance.maxAttempts = maxAttempts;
        if (data.retryDelay !== undefined) jobInstance.retryDelay = data.retryDelay;
        try { await withJobContext(queuedJob, () => jobInstance.failed(err)); }
        finally { await failedStore.store(queuedJob, err); }
      })().catch((error: any) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        failureErrors.push(failure);
        worker.emit('svelar:error', failure);
      });
      failureTasks.add(task);
      void task.finally(() => failureTasks.delete(task));
    });
    const observe = (callback: () => Promise<void>) => {
      const task = callback().catch(error => {
        failureErrors.push(error instanceof Error ? error : new Error(String(error)));
        worker.emit('svelar:error', error instanceof Error ? error : new Error(String(error)));
      });
      failureTasks.add(task);
      void task.finally(() => failureTasks.delete(task));
    };
    worker.on('completed', (job: any) => observe(() => this.operations(queueName).capture(job, 'completed', 'completed')));
    worker.on('stalled', (id: string) => observe(() => this.operations(queueName).refresh(id, 'stalled')));
    worker.on('locksRenewed', (data: { jobIds: string[] }) => observe(() => this.operations(queueName)
      .observeLocks(data.jobIds, worker.opts.lockDuration, worker.svelarWorkerId)));
    worker.on('lockRenewalFailed', (ids: string[]) => observe(() => this.operations(queueName)
      .observeLocks(ids, 0, worker.svelarWorkerId)));

    const nativeClose = worker.close.bind(worker);
    let stopHeartbeat: Awaited<ReturnType<typeof startWorkerHeartbeat>>;
    const onStartupError = () => {};
    worker.on('error', onStartupError);
    try {
      stopHeartbeat = await startWorkerHeartbeat(worker, queueName, this.config.workerHeartbeat);
    } catch (error) {
      await nativeClose();
      throw error;
    } finally {
      worker.off('error', onStartupError);
    }
    let closing: Promise<void> | null = null;
    worker.svelarWorkerId = stopHeartbeat.id ?? crypto.randomUUID();
    worker.svelarRefreshHeartbeat = () => stopHeartbeat.refresh();
    worker.close = (...args: any[]) => closing ??= (async () => {
      // Mark BullMQ closing immediately; Redis telemetry publication must not delay acquisition stop.
      const nativeClosing = nativeClose(...args);
      void nativeClosing.catch(() => {});
      try {
        await stopHeartbeat.drain();
      } finally {
        try {
          await nativeClosing;
          await Promise.all([...failureTasks]);
          if (failureErrors.length) throw new AggregateError(failureErrors, 'Failed to persist queue failures.');
        } finally {
          try {
            await stopHeartbeat();
          } finally {
            this.workers.delete(worker);
          }
        }
      }
    })();
    this.workers.add(worker);
    return worker;
  }
}

// ── Failed Job Store ──────────────────────────────────────

export interface QueueRetryFailure {
  id: string;
  queue: string;
  jobClass: string;
  error: string;
}

export class QueueRetryAllError extends Error {
  constructor(
    public retried: number,
    public failures: QueueRetryFailure[],
  ) {
    super(
      `Retried ${retried} failed job(s), but ${failures.length} failed to retry: ${failures
        .map((failure) => `${failure.id} (${failure.jobClass}): ${failure.error}`)
        .join('; ')}`
    );
    this.name = 'QueueRetryAllError';
  }
}

// ── Job Registry ──────────────────────────────────────────

/**
 * Maps job class names to their constructors so the database driver
 * can reconstruct Job instances from serialized payloads.
 */
class JobRegistry {
  private jobs = new Map<string, JobConstructor>();
  private definitions = new Map<string, RegisteredJobDefinition>();
  private byClass = new WeakMap<JobConstructor, RegisteredJobDefinition>();
  private automatic = new Set<string>();

  /**
   * Register a job class. Required for the database driver.
   */
  register(JobClass: JobConstructor, definition?: JobDefinition, automatic = false): RegisteredJobDefinition {
    if (typeof JobClass !== 'function' || typeof JobClass.prototype?.handle !== 'function') throw new TypeError('Register an implemented Job class.');
    const registered = this.byClass.get(JobClass);
    if (registered && definition === undefined) {
      if (!automatic) this.automatic.delete(registered.name);
      return registered;
    }
    let declared = definition;
    if (declared === undefined) {
      for (let current: any = JobClass; current && !declared; current = Object.getPrototypeOf(current)) {
        const property = Object.getOwnPropertyDescriptor(current, 'definition');
        if (property?.get) throw new TypeError('Job definitions must be static data, not getters.');
        declared = property?.value;
      }
    }
    const result = { ...declared, name: declared?.name ?? JobClass.name };
    if (typeof result.name !== 'string' || !result.name || result.name.length > 256) throw new TypeError('Invalid registered job name.');
    if (result.name === ChainedJob.name && JobClass !== ChainedJob) throw new Error('The chained job name is reserved.');
    const existing = this.jobs.get(result.name);
    if (existing && existing !== JobClass) throw new Error(`Job name "${result.name}" is already registered. Use an explicit unique definition.name.`);
    this.jobs.set(result.name, JobClass);
    this.definitions.set(result.name, { ...result, dispatch: result.dispatch ? { ...result.dispatch } : undefined });
    this.byClass.set(JobClass, result);
    if (automatic) this.automatic.add(result.name); else this.automatic.delete(result.name);
    return result;
  }

  /**
   * Register multiple job classes at once.
   */
  registerAll(classes: readonly JobConstructor[]): void {
    for (const cls of classes) {
      this.register(cls);
    }
  }

  /**
   * Reconstruct a Job instance from its class name and serialized payload.
   */
  resolve(className: string, serializedPayload: string): Job {
    if (className === ChainedJob.name) {
      return ChainedJob.restoreFrom(serializedPayload, this);
    }

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
    let data: Record<string, any>;
    try {
      data = JSON.parse(serializedPayload);
    } catch (error: any) {
      throw new Error(
        `Failed to deserialize payload for job "${className}": ${error.message ?? error}`
      );
    }
    instance.restore(data);

    return instance;
  }

  has(className: string): boolean {
    return this.jobs.has(className);
  }

  all(): string[] {
    return [...this.jobs.keys()].sort();
  }

  profiles(): RegisteredJobDefinition[] {
    return [...this.definitions.values()].map((definition) => ({ ...definition, dispatch: definition.dispatch ? { ...definition.dispatch } : undefined }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  forgetAutomatic(): void {
    for (const name of this.automatic) {
      const ctor = this.jobs.get(name);
      if (ctor) this.byClass.delete(ctor);
      this.jobs.delete(name); this.definitions.delete(name);
    }
    this.automatic.clear();
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
  private queueRegistry = new Map<string, QueueDefinition>();
  private workerRegistry = new Map<string, WorkerProfile>();
  private automaticQueues = new Set<string>();
  private testingInterceptors = new Set<(job: Readonly<QueuedJob>, mode: 'async' | 'sync') => boolean>();

  /** @internal Intercept dispatch without replacing configuration or initialized drivers. */
  interceptForTesting(interceptor: (job: Readonly<QueuedJob>, mode: 'async' | 'sync') => boolean): () => void {
    const handler = (job: Readonly<QueuedJob>, mode: 'async' | 'sync') => interceptor(job, mode);
    this.testingInterceptors.add(handler);
    return () => { this.testingInterceptors.delete(handler); };
  }

  configure(config: QueueConfig): void {
    if (this.processing || this._activeWorker) throw new Error('Stop queue workers before reconfiguring the queue.');
    this.jobRegistry.forgetAutomatic();
    for (const name of this.automaticQueues) this.queueRegistry.delete(name);
    this.automaticQueues.clear();
    this.config = config;
    this.failedStore = new FailedJobStore(config.failedConnection);
    this.drivers.clear();
    const defaultQueue = config.connections[config.default]?.queue ?? 'default';
    this.registerQueue({ name: defaultQueue, connection: config.default });
    if (config.queues) this.registerQueues([...config.queues]);
    if (config.workers) for (const profile of config.workers) this.registerWorkerProfile(profile);
  }

  registerQueue(definition: QueueDefinition): void {
    if (typeof definition.name !== 'string' || !definition.name || definition.name.includes(':')) throw new TypeError('Invalid queue name.');
    if (definition.concurrency !== undefined) positiveInteger(definition.concurrency, 'Queue concurrency');
    const connection = definition.connection ?? this.config.default;
    const key = this.queueKey(definition.name, connection);
    this.automaticQueues.delete(key);
    this.queueRegistry.set(key, {
      ...this.queueRegistry.get(key),
      ...definition,
      connection,
    });
  }
  private queueKey(queue: string, connection: string) { return `${connection}\0${queue}`; }
  private queueDefinition(queue: string, connection?: string): QueueDefinition | undefined {
    if (connection) return this.queueRegistry.get(this.queueKey(queue, connection));
    const preferred = this.queueRegistry.get(this.queueKey(queue, this.config.default));
    if (preferred) return preferred;
    const matches = [...this.queueRegistry.values()].filter(definition => definition.name === queue);
    if (matches.length > 1) throw new Error(`Queue "${queue}" exists on multiple connections; choose an explicit connection.`);
    return matches[0];
  }

  registerQueues(definitions: QueueDefinition[]): void {
    for (const definition of definitions) {
      this.registerQueue(definition);
    }
  }

  queues(): QueueDefinition[] {
    return [...this.queueRegistry.values()].map((definition) => ({ ...definition })).sort((a, b) => a.name.localeCompare(b.name)
      || (a.connection === this.config.default ? -1 : b.connection === this.config.default ? 1 : (a.connection ?? '').localeCompare(b.connection ?? '')));
  }

  registeredJobs(): string[] {
    return this.jobRegistry.all();
  }

  jobDefinitions(): RegisteredJobDefinition[] { return this.jobRegistry.profiles(); }

  registerWorkerProfile(profile: WorkerProfile): void {
    if (typeof profile.name !== 'string' || !profile.name) throw new TypeError('A worker profile requires a name.');
    validateWorkerOptions(profile);
    this.registerQueue({ name: profile.queue, ...(profile.connection ? { connection: profile.connection } : {}) });
    this.workerRegistry.set(profile.name, { ...profile });
  }

  workerProfiles(): WorkerProfile[] {
    return [...this.workerRegistry.values()].map((profile) => ({ ...profile })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Discover exported Job subclasses without invoking their constructors. */
  discoverJobs(exports: Readonly<Record<string, unknown>>): string[] {
    const names: string[] = [];
    for (const value of Object.values(exports)) {
      if (typeof value === 'function' && (value as unknown as JobConstructor).queueJob === true && typeof value.prototype?.handle === 'function') {
        names.push(this.register(value as unknown as JobConstructor).name);
      }
    }
    return names;
  }

  getDriver(connection?: string): QueueDriver {
    const name = connection ?? this.config.default;
    const config = this.config.connections[name];
    if (!config) throw new Error(`Queue connection "${name}" is not defined.`);
    return config.driver;
  }

  /** Safe configuration inventory; reading it never acquires a database or Redis client. */
  configuredConnections(options: { limit?: number; offset?: number } = {}): QueueConnectionCatalogPage {
    const { limit, offset } = pageOptions({ limit: options.limit ?? 100, offset: options.offset });
    const names = Object.keys(this.config.connections).sort();
    const connections = names.slice(offset, offset + limit).map(name => {
      const config = this.config.connections[name];
      return { name, driver: ['sync', 'memory', 'database', 'redis'].includes(config.driver) ? config.driver : 'unknown' as const,
        queue: config.queue ?? 'default', isDefault: name === this.config.default };
    });
    return { connections, total: names.length, limit, offset, hasMore: offset + connections.length < names.length };
  }

  adapter(queue?: string, connection?: string): QueueMonitoringAdapter {
    const name = connection ?? (queue ? this.queueDefinition(queue)?.connection : undefined) ?? this.config.default;
    const config = this.config.connections[name];
    if (!config) throw new Error(`Queue connection "${name}" is not defined.`);
    const queueName = queue ?? config.queue ?? 'default';
    if (!queueName || queueName.includes(':')) throw new TypeError('Invalid adapter queue name.');
    const services: AdapterServices = { connection: name, queue: queueName, ledger: this.ledgerFor(name), includeLegacy: name === this.config.default,
      replay: id => this.replayFailed(id, { connection: name, queue: queueName }) };
    const driver = this.resolveDriver(name);
    if (driver instanceof RedisDriver || driver instanceof DatabaseDriver) return driver.adapter(services);
    return volatileAdapter(services, config.driver as 'sync' | 'memory');
  }

  async discoverQueuesPage(connection = this.config.default, options: QueueDiscoveryOptions = {}): Promise<QueueDiscoveryPage> {
    const limit = boundedLimit(options.limit ?? 100);
    const kind = this.getDriver(connection);
    if (kind !== 'redis' && kind !== 'database') throw new QueueCapabilityError('Shared queue discovery', kind);
    const position = discoveryCursor(options.cursor, connection, kind, limit);
    const driver = this.resolveDriver(connection);
    if (!(driver instanceof RedisDriver || driver instanceof DatabaseDriver)) throw new QueueCapabilityError('Shared queue discovery', kind);
    const batch = await driver.discoverPage(position, limit);
    const queues = [...new Set(batch.names)].map(name => ({ ...this.queueDefinition(name, connection), name, connection }));
    const nextCursor = batch.position === null ? null : Buffer.from(JSON.stringify({ version: 1, connection, driver: kind, limit, position: batch.position })).toString('base64url');
    return { queues, total: null, complete: nextCursor === null, nextCursor, coverage: 'instrumented' };
  }

  /** Compatibility inventory is bounded; pollers should use the read-only cursor API. */
  async discoverQueues(connection = this.config.default): Promise<QueueDefinition[]> {
    const kind = this.getDriver(connection);
    if (!['redis', 'database', 'memory', 'sync'].includes(kind)) throw new QueueCapabilityError('Queue discovery', kind);
    const discovered = new Set<string>();
    if (kind === 'redis' || kind === 'database') {
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await this.discoverQueuesPage(connection, { limit: 100, cursor });
        for (const queue of result.queues) discovered.add(queue.name);
        if (result.complete) { cursor = undefined; break; }
        cursor = result.nextCursor!;
      }
      if (cursor !== undefined) throw new RangeError('Queue discovery exceeds the compatibility scan limit. Continue with discoverQueuesPage().');
    }
    for (const name of discovered) if (!this.queueDefinition(name, connection)) this.registerQueue({ name, connection });
    return this.queues().filter(queue => queue.connection === connection);
  }

  /**
   * Register a job class for database driver deserialization.
   *
   * @example
   * Queue.register(SendWelcomeEmail);
   * Queue.register(ProcessPayment);
   */
  register(JobClass: JobConstructor, definition?: JobDefinition): RegisteredJobDefinition {
    const registered = this.jobRegistry.register(JobClass, definition);
    if (registered.queue) this.registerQueue({ name: registered.queue, ...(registered.connection ? { connection: registered.connection } : {}) });
    return registered;
  }

  /**
   * Register multiple job classes at once.
   *
   * @example
   * Queue.registerAll([SendWelcomeEmail, ProcessPayment, GenerateReport]);
   */
  registerAll(classes: readonly JobConstructor[]): void {
    for (const JobClass of classes) this.register(JobClass);
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
  async dispatch(job: Job, options?: DispatchOptions): Promise<string> {
    const { connection: connName, job: queuedJob } = this.prepareDispatch(job, options);

    for (const interceptor of [...this.testingInterceptors].reverse()) {
      if (interceptor(queuedJob, 'async')) return queuedJob.id;
    }
    this.validateDispatchCapabilities(queuedJob, connName);
    return await this.resolveDriver(connName).push(queuedJob) ?? queuedJob.id;
  }

  /** A bulk is restricted to one queue/connection; Redis uses native BullMQ addBulk. */
  async dispatchBulk(items: readonly (Job | BulkDispatchItem)[], options?: DispatchOptions): Promise<string[]> {
    const prepared = items.map((item) => typeof (item as Job).handle === 'function'
      ? this.prepareDispatch(item as Job, options)
      : this.prepareDispatch((item as BulkDispatchItem).job, { ...options, ...(item as BulkDispatchItem).options }));
    if (!prepared.length) return [];
    const first = prepared[0];
    if (prepared.some((item) => item.connection !== first.connection || item.job.queue !== first.job.queue)) {
      throw new Error('Bulk dispatch requires one queue and one connection.');
    }
    const real = prepared.filter(({ job }) => ![...this.testingInterceptors].reverse().some((interceptor) => interceptor(job, 'async')));
    if (!real.length) return prepared.map(({ job }) => job.id);
    for (const item of real) this.validateDispatchCapabilities(item.job, item.connection);
    const driver = this.resolveDriver(first.connection);
    const ids = driver.pushBulk ? await driver.pushBulk(real.map(({ job }) => job))
      : await Promise.all(real.map(async ({ job }) => await driver.push(job) ?? job.id));
    const assigned = new Map(real.map(({ job }, index) => [job, ids[index]]));
    return prepared.map(({ job }) => assigned.get(job) ?? job.id);
  }

  private prepareDispatch(job: Job, options: DispatchOptions = {}): { connection: string; job: QueuedJob } {
    if (!job || typeof job.handle !== 'function' || typeof job.serialize !== 'function') throw new TypeError('Dispatch a Job instance.');
    const definition = this.jobRegistry.register(job.constructor as JobConstructor, undefined, true);
    const explicitAttempts = options.maxAttempts;
    options = { ...definition.dispatch, ...options };
    const context = options.context === undefined ? ApplicationContext.snapshot() : { ...options.context };
    metadataRow(options.metadata, context);
    const queue = options.queue ?? (job.queue !== 'default' ? job.queue : definition.queue ?? this.config.connections[this.config.default]?.queue ?? 'default');
    const connection = options.connection ?? definition.connection ?? this.queueDefinition(queue)?.connection ?? this.config.default;
    this.getDriver(connection);
    const key = this.queueKey(queue, connection);
    const automaticallyRegistered = !this.queueRegistry.has(key) || this.automaticQueues.has(key);
    if (automaticallyRegistered) this.registerQueue({ name: queue, connection });
    if (automaticallyRegistered) this.automaticQueues.add(key);
    const attempts = explicitAttempts ?? (job.maxAttempts !== 3 ? job.maxAttempts : definition.dispatch?.maxAttempts ?? this.config.connections[connection]?.maxAttempts ?? job.maxAttempts);
    positiveInteger(attempts, 'Job maxAttempts');
    if (!Number.isFinite(job.retryDelay) || job.retryDelay < 0) throw new RangeError('Job retryDelay must be non-negative and finite.');
    if (options.delay !== undefined && (!Number.isFinite(options.delay) || options.delay < 0)) throw new RangeError('Job delay must be non-negative and finite.');
    if (options.jobId !== undefined && (typeof options.jobId !== 'string' || !options.jobId || options.jobId.includes(':'))) throw new TypeError('jobId must be a nonempty string without colons.');
    if (options.priority !== undefined && (!Number.isSafeInteger(options.priority) || options.priority < 0 || options.priority > 2097152)) throw new RangeError('Job priority must be 0..2097152.');
    if (options.deduplicate !== undefined && typeof options.deduplicate !== 'boolean') throw new TypeError('deduplicate must be boolean.');
    if (options.deduplicate && !options.jobId) throw new Error('Legacy deduplicate requires an explicit jobId.');
    if (options.deduplication) validateDeduplication(options.deduplication);
    if (options.deduplication?.mode === 'debounce' && options.delay !== undefined && options.delay * 1000 !== options.deduplication.ttl) {
      throw new Error('Debounce delay must match its ttl, or be omitted.');
    }
    if (options.deduplicate && options.deduplication) throw new Error('Choose jobId deduplication or a native deduplication mode, not both.');
    job.queue = queue; job.maxAttempts = attempts;
    const now = Date.now();
    return { connection, job: {
      id: options.jobId ?? crypto.randomUUID(), jobClass: definition.name, payload: job.serialize(), queue,
      attempts: 0, maxAttempts: attempts, priority: options.priority, deduplicate: options.deduplicate, connection,
      deduplication: options.deduplication ? { ...options.deduplication } : undefined,
      metadata: options.metadata, availableAt: now + (options.delay ?? 0) * 1000, createdAt: now, job,
      context,
    } };
  }

  private validateDispatchCapabilities(job: QueuedJob, connection: string): void {
    const driver = this.getDriver(connection);
    if (driver === 'redis' && /^\d+$/.test(job.id)) throw new TypeError('Redis jobId must not be an integer string.');
    if (job.deduplication && driver !== 'redis') throw new Error(`Native deduplication is unsupported by the ${driver} queue driver.`);
    if (job.priority !== undefined && !['redis', 'memory'].includes(driver)) throw new Error(`Priority is unsupported by the ${driver} queue driver.`);
    if (job.deduplicate && driver === 'sync') throw new Error('Deduplication is unsupported by the sync queue driver.');
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
      context: ApplicationContext.snapshot(),
      connection: this.config.default,
    };

    for (const interceptor of [...this.testingInterceptors].reverse()) {
      if (interceptor(queuedJob, 'sync')) return;
    }
    await new SyncDriver(this.failedStore).push(queuedJob);
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
    const names = jobs.map((job) => this.jobRegistry.register(job.constructor as JobConstructor, undefined, true).name);
    const chainJob = new ChainedJob(jobs, names);

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
  resolveWorkOptions(options: WorkOptions = {}): ResolvedWorkOptions {
    const explicitProfile = options.profile ? this.workerRegistry.get(options.profile) : undefined;
    if (options.profile && !explicitProfile) throw new Error(`Unknown worker profile "${options.profile}".`);
    const queue = options.queue ?? explicitProfile?.queue ?? this.config.connections[options.connection ?? this.config.default]?.queue ?? 'default';
    if (typeof queue !== 'string' || !queue || queue.includes(':')) throw new TypeError('Invalid worker queue name.');
    const definition = this.queueDefinition(queue, options.connection ?? explicitProfile?.connection);
    const profile = explicitProfile ?? (definition?.workerProfile ? this.workerRegistry.get(definition.workerProfile) : undefined);
    if (definition?.workerProfile && !profile) throw new Error(`Unknown worker profile "${definition.workerProfile}".`);
    const connection = options.connection ?? profile?.connection ?? definition?.connection ?? this.config.default;
    const definedOptions = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
    const resolved = { ...profile, ...definedOptions, queue, connection, concurrency: options.concurrency ?? profile?.concurrency ?? definition?.concurrency ?? 1 } as ResolvedWorkOptions;
    validateWorkerOptions(resolved);
    if (resolved.maxJobs !== undefined && (!Number.isSafeInteger(resolved.maxJobs) || resolved.maxJobs < 0)) throw new RangeError('maxJobs must be a non-negative safe integer.');
    if (resolved.sleep !== undefined && (!Number.isFinite(resolved.sleep) || resolved.sleep < 0)) throw new RangeError('sleep must be non-negative and finite.');
    if (this.getDriver(connection) !== 'redis' && (resolved.concurrency !== 1 || resolved.lockDuration !== undefined ||
        resolved.stalledInterval !== undefined || resolved.maxStalledCount !== undefined)) {
      throw new Error('Concurrent workers and Redis lock/stalled options require the Redis driver.');
    }
    if (this.getDriver(connection) === 'redis' && resolved.maxJobs !== undefined && resolved.concurrency !== 1) {
      throw new Error('Finite Redis workers require concurrency 1; omit maxJobs for concurrent daemon workers.');
    }
    return resolved;
  }

  async work(options?: WorkOptions): Promise<number> {
    if (this.processing || this._activeWorker) throw new Error('A queue worker is already running in this process.');
    options = this.resolveWorkOptions(options);
    const connName = options.connection!;
    const driver = this.resolveDriver(connName);
    const queue = options.queue!;

    // ── Redis / BullMQ path ──────────────────────────────────
    if (driver instanceof RedisDriver) {
      const maxJobs = options?.maxJobs;
      if (maxJobs !== undefined && maxJobs <= 0) {
        return 0;
      }
      this.processing = true;
      try {
        if (maxJobs !== undefined && await driver.size(queue) === 0) { this.processing = false; return 0; }
      } catch (error) { this.processing = false; throw error; }

      if (maxJobs !== undefined) {
        const worker = await driver.createWorker(queue, this.jobRegistry, this.failedStore, {
          concurrency: 1,
          autorun: false,
          lockDuration: options?.lockDuration,
          stalledInterval: options?.stalledInterval,
          maxStalledCount: options?.maxStalledCount,
        }).catch((error) => { this.processing = false; throw error; });

        let operation: Promise<boolean> | null = null;
        let closing: Promise<void> | null = null;
        const nativeClose = worker.close.bind(worker);
        // Manual work is not tracked by BullMQ's autorun loop. Drain it before
        // native close disconnects the client needed to acknowledge completion.
        worker.close = (...args: any[]) => closing ??= (async () => {
          await operation?.catch(() => {});
          await nativeClose(...args);
        })();
        this._activeWorker = worker;
        let processed = 0;
        let attempted = 0;
        let workerError: Error | null = null;

        const onCompleted = () => {
          processed += 1;
        };

        const onWorkerError = (error: any) => {
          workerError = error instanceof Error ? error : new Error(String(error));
        };

        worker.on('completed', onCompleted);
        worker.on('svelar:error', onWorkerError);
        worker.on('error', onWorkerError);

        try {
          await worker.startStalledCheckTimer();
          while (this.processing && attempted < maxJobs) {
            operation = (async () => {
              const token = crypto.randomUUID();
              const bullJob = await worker.getNextJob(token, { block: false });
              if (!bullJob) return false;
              if (!this.processing) { await bullJob.moveToWait(token); return false; }
              attempted += 1;
              // Manual finite mode needs public lock renewal; autorun workers renew natively.
              let renewal: ReturnType<typeof setTimeout> | undefined;
              let renewing = Promise.resolve();
              let stopped = false;
              const duration = worker.opts.lockDuration;
              const renew = () => {
                renewal = setTimeout(() => {
                  renewing = (async () => {
                    const renewed = await bullJob.extendLock(token, duration);
                    if (!renewed) throw new Error(`Lost lock for queue job "${bullJob.id}".`);
                    await driver.observeLock(queue, String(bullJob.id), duration, worker.svelarWorkerId);
                  })().catch(onWorkerError).then(() => { if (!stopped) renew(); });
                }, Math.max(1, Math.floor(duration / 2)));
              };
              renew();
              try { await worker.processJob(bullJob, token, () => false); }
              finally { stopped = true; if (renewal) clearTimeout(renewal); await renewing; }
              if (workerError) throw workerError;
              return true;
            })();
            try { if (!await operation) break; }
            finally { operation = null; }
          }
        } finally {
          worker.off('completed', onCompleted);
          worker.off('svelar:error', onWorkerError);
          worker.off('error', onWorkerError);
          try { await worker.close(); }
          finally {
            if (this._activeWorker === worker) this._activeWorker = null;
            this.processing = false;
          }
        }

        return processed;
      }

      const worker = await driver.createWorker(queue, this.jobRegistry, this.failedStore, {
        autorun: false,
        concurrency: options?.concurrency ?? 1,
        lockDuration: options?.lockDuration,
        stalledInterval: options?.stalledInterval,
        maxStalledCount: options?.maxStalledCount,
      }).catch((error) => { this.processing = false; throw error; });

      this._activeWorker = worker;
      let processed = 0;

      // Block until stop() is called, or until BullMQ reports an infrastructure error.
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          worker.off('completed', onCompleted);
          worker.off('svelar:error', onWorkerError);
          worker.off('error', onWorkerError);
        };

        const closeWorker = async () => {
          try {
            await worker.close();
          } finally {
            if (this._activeWorker === worker) {
              this._activeWorker = null;
            }
          }
        };

        const finish = async () => {
          if (settled) return;
          settled = true;
          cleanup();
          try {
            await closeWorker();
            resolve();
          } catch (error) {
            reject(error);
          }
        };

        const onWorkerError = async (error: any) => {
          if (settled) return;
          settled = true;
          cleanup();
          this.processing = false;
          try {
            await closeWorker();
          } catch {
            // Preserve the originating failure; heartbeat TTLs bound stale data.
          } finally {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };

        const onCompleted = () => {
          processed += 1;
          if (maxJobs !== undefined && processed >= maxJobs) {
            void finish();
          }
        };

        const check = () => {
          if (!this.processing) {
            void finish();
          } else {
            timer = setTimeout(check, 500);
          }
        };

        worker.on('completed', onCompleted);
        worker.on('svelar:error', onWorkerError);
        worker.on('error', onWorkerError);
        if (this.processing) {
          void worker.run().catch(onWorkerError);
          void worker.svelarRefreshHeartbeat().catch(onWorkerError);
        }
        check();
      });

      return processed;
    }

    // ── Poll-based path (sync / memory / database) ───────────
    const maxJobs = options?.maxJobs ?? Infinity;
    const sleepMs = (options?.sleep ?? 1) * 1000;

    let processed = 0;
    this.processing = true;

    try { while (this.processing && processed < maxJobs) {
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
        if (driver instanceof DatabaseDriver) await driver.execute(queuedJob, () => handleQueuedJob(queuedJob));
        else await handleQueuedJob(queuedJob);
        processed++;

        // If database driver, delete the completed job
        if (driver instanceof DatabaseDriver) {
          await driver.delete(queuedJob);
        }
      } catch (error) {
        if (queuedJob.attempts < queuedJob.maxAttempts) {
          // Retry
          await withJobContext(queuedJob, () => queuedJob.job.retrying(queuedJob.attempts));
          const retryDelay = queuedJob.job.retryDelay ?? 60;

          if (driver instanceof DatabaseDriver) {
            // Release back to DB with delay
            await driver.release(queuedJob, retryDelay);
          } else {
            queuedJob.availableAt = Date.now() + retryDelay * 1000;
            await driver.push(queuedJob);
          }
        } else {
          // Permanently failed
          try { await withJobContext(queuedJob, () => queuedJob.job.failed(error as Error)); }
          finally {
            if (driver instanceof DatabaseDriver) await driver.exhaust(queuedJob, error as Error);
            else await this.failedStore.store(queuedJob, error as Error);
          }
        }
      }
    } } finally { this.processing = false; }
    return processed;
  }

  /**
   * Stop the worker loop (poll drivers) or close the BullMQ Worker (redis).
   */
  async stop(): Promise<void> {
    this.processing = false;
    try {
      if (this._activeWorker) await this._activeWorker.close();
    } finally {
      this._activeWorker = null;
      const results = await Promise.allSettled([...this.drivers.values()].map((driver) => driver.close?.()));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, 'Queue shutdown failed.');
    }
  }

  /**
   * Get the size of a queue
   */
  async size(queue?: string, connection?: string): Promise<number> {
    return this.resolveDriver(connection ?? (queue ? this.queueDefinition(queue)?.connection : undefined) ?? this.config.default).size(queue);
  }

  /**
   * Clear all jobs from a queue
   */
  async clear(queue?: string, connection?: string): Promise<void> {
    return this.resolveDriver(connection ?? (queue ? this.queueDefinition(queue)?.connection : undefined) ?? this.config.default).clear(queue);
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
    return this.ledgerFor(this.config.default).all();
  }

  /**
   * Retry a failed job by its ID.
   * The job is re-dispatched to the queue and removed from the failed_jobs table.
   *
   * @example
   * await Queue.retry('some-uuid');
   */
  async retry(failedJobId: string): Promise<boolean> {
    return this.replayFailed(failedJobId, undefined, true);
  }

  async replayFailed(id: string, scope?: { connection: string; queue: string }, allowVolatile = false): Promise<boolean> {
    return this.ledgerFor(scope?.connection ?? this.config.default).replay(id, async (record, jobId) => {
      const connection = record.connection ?? this.config.default;
      if (!allowVolatile && !['redis', 'database'].includes(this.getDriver(connection))) throw new Error('Durable replay requires Redis or database queues.');
      const job = this.jobRegistry.resolve(record.jobClass, record.payload);
      if (record.retryDelay !== undefined) job.retryDelay = record.retryDelay;
      const prepared = this.prepareDispatch(job, { queue: record.queue, connection, context: record.context ?? {},
        metadata: record.metadata, maxAttempts: record.maxAttempts, priority: record.priority,
        jobId, deduplicate: true, deduplication: undefined, delay: 0 });
      prepared.job.replayRecordId = record.id;
      this.validateDispatchCapabilities(prepared.job, connection);
      await this.resolveDriver(connection).push(prepared.job);
    }, scope);
  }

  /**
   * Retry all failed jobs.
   *
   * @example
   * const count = await Queue.retryAll();
   * console.log(`Retried ${count} jobs`);
   */
  async retryAll(): Promise<number> {
    const records = await this.failed();
    let count = 0;
    const failures: QueueRetryFailure[] = [];

    for (const record of records) {
      try {
        if (await this.retry(record.id)) count++;
      } catch (error: any) {
        failures.push({
          id: record.id,
          queue: record.queue,
          jobClass: record.jobClass,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failures.length > 0) {
      throw new QueueRetryAllError(count, failures);
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
    return this.ledgerFor(this.config.default).forget(failedJobId);
  }

  /**
   * Remove all failed job records.
   *
   * @example
   * const count = await Queue.flushFailed();
   */
  async flushFailed(): Promise<number> {
    return this.ledgerFor(this.config.default).flush();
  }

  private ledgerFor(connection: string): FailedJobStore {
    const config = this.config.connections[connection];
    if (!config) throw new Error(`Queue connection "${connection}" is not defined.`);
    // DB jobs and their replay receipts must share one transaction/connection.
    return config.driver === 'database' ? new FailedJobStore(config.databaseConnection) : this.failedStore;
  }

  private resolveDriver(name: string): QueueDriverInterface {
    if (this.drivers.has(name)) return this.drivers.get(name)!;

    const config = this.config.connections[name];
    if (!config) throw new Error(`Queue connection "${name}" is not defined.`);

    let driver: QueueDriverInterface;
    switch (config.driver) {
      case 'sync': driver = new SyncDriver(this.failedStore); break;
      case 'memory': driver = new MemoryDriver(); break;
      case 'database':
        driver = new DatabaseDriver(config.table ?? 'svelar_jobs', this.jobRegistry, config, name, this.ledgerFor(name), name === this.config.default);
        break;
      case 'redis':
        driver = new RedisDriver(config, this.jobRegistry, name);
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

  constructor(jobs: Job[], private names = jobs.map((job) => job.constructor.name)) {
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
      jobs: this.remainingJobs.map((j, index) => ({
        jobClass: this.names[index],
        payload: j.serialize(),
      })),
    });
  }

  static restoreFrom(serializedPayload: string, registry: JobRegistry): ChainedJob {
    let data: Record<string, any>;
    try {
      data = JSON.parse(serializedPayload);
    } catch (error: any) {
      throw new Error(
        `Failed to deserialize payload for job "${ChainedJob.name}": ${error.message ?? error}`
      );
    }

    if (!Array.isArray(data.jobs)) {
      throw new Error(`Failed to deserialize payload for job "${ChainedJob.name}": expected jobs array`);
    }

    const jobs = data.jobs.map((item: any) => {
      if (!item || typeof item.jobClass !== 'string' || typeof item.payload !== 'string') {
        throw new Error(
          `Failed to deserialize payload for job "${ChainedJob.name}": expected chained job entries with jobClass and payload`
        );
      }

      return registry.resolve(item.jobClass, item.payload);
    });

    return new ChainedJob(jobs, data.jobs.map((item: any) => item.jobClass));
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global Queue singleton
 */
export const Queue = singleton('svelar.queue', () => new QueueManager());
