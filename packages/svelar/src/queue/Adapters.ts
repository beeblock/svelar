import type { QueryBuilder } from '../orm/QueryBuilder.js';
import { readWorkerTelemetry } from './BullMQTelemetry.js';
import { QueueEventStore } from './EventStore.js';
import { FailedJobStore, replayJobId } from './FailedJobStore.js';
import { metadataColumns, metadataDigest, metadataFields, metadataRow } from './Metadata.js';
import { RedisQueueOperations } from './RedisOperations.js';
import { boundedLimit, pageOptions, QueueCapabilityError, type QueueMonitoringAdapter, type QueueJobFilter,
  type QueueJobReference, type QueueMutationResult, type QueueBatchResult, type QueueJobSnapshot,
  type QueueAdapterRuntime, type QueueSharedMetrics, type QueueJobPage } from './Monitoring.js';

export interface AdapterServices {
  connection: string;
  queue: string;
  ledger: FailedJobStore;
  includeLegacy?: boolean;
  replay(id: string): Promise<boolean>;
}

abstract class AdapterBase implements QueueMonitoringAdapter {
  readonly connection: string;
  readonly queue: string;
  abstract readonly driver: 'redis' | 'database' | 'memory' | 'sync';
  abstract readonly capabilities: Readonly<{ shared: boolean; indexedMetadata: boolean; durableReplay: boolean; pause: boolean }>;
  constructor(protected services: AdapterServices) { this.connection = services.connection; this.queue = services.queue; }
  abstract counts(): ReturnType<QueueMonitoringAdapter['counts']>;
  abstract list(filter?: QueueJobFilter): Promise<QueueJobPage>;
  abstract get(id: string): Promise<QueueJobSnapshot | null>;
  abstract runtime(): Promise<QueueAdapterRuntime>;
  abstract metrics(minutes?: number): Promise<QueueSharedMetrics>;
  abstract pause(): Promise<void>;
  abstract resume(): Promise<void>;
  abstract reconcile(limit?: number): ReturnType<QueueMonitoringAdapter['reconcile']>;
  abstract recover(): Promise<number>;
  protected abstract retryLive(id: string): Promise<QueueMutationResult['outcome']>;
  protected abstract removeLive(id: string): Promise<QueueMutationResult['outcome']>;
  protected abstract liveTimeline(id: string, limit?: number): ReturnType<QueueMonitoringAdapter['timeline']>;
  protected reference(reference: QueueJobReference) {
    if (!reference || !['live', 'dead-letter'].includes(reference.source) || typeof reference.id !== 'string' || !reference.id ||
      reference.id.length > 256 || reference.id.includes('\0')) throw new TypeError('Invalid queue job reference.');
  }
  async deadLetters(filter: QueueJobFilter & { includeReplayed?: boolean } = {}) {
    return this.services.ledger.list(this.connection, this.queue, filter);
  }
  async deadLetter(id: string) {
    this.reference({ id, source: 'dead-letter' });
    const record = await this.services.ledger.find(id, true);
    return record && record.connection === this.connection && record.queue === this.queue ? { ...record, connection: this.connection } : null;
  }
  protected reconcileDeadLetters(limit: number) {
    return this.services.ledger.reconcile(this.connection, this.queue, limit, this.services.includeLegacy);
  }
  async timeline(reference: QueueJobReference, limit?: number) {
    this.reference(reference);
    return reference.source === 'dead-letter'
      ? this.services.ledger.timeline(this.connection, this.queue, reference.id, limit) : this.liveTimeline(reference.id, limit);
  }
  async retry(reference: QueueJobReference): Promise<QueueMutationResult> {
    this.reference(reference);
    if (reference.source === 'live') {
      const original = await this.services.ledger.findOriginal(this.connection, this.queue, reference.id);
      if (original) {
        const accepted = await this.services.replay(original.id);
        return { ...reference, outcome: accepted ? 'accepted' : 'busy', replayJobId: replayJobId(original.id) };
      }
      return { ...reference, outcome: await this.retryLive(reference.id) };
    }
    if (!this.capabilities.durableReplay) throw new QueueCapabilityError('Durable replay', this.driver);
    const record = await this.services.ledger.find(reference.id, true);
    if (!record || record.connection !== this.connection || record.queue !== this.queue) return { ...reference, outcome: 'missing' };
    const accepted = await this.services.replay(reference.id);
    return { ...reference, outcome: accepted ? 'accepted' : 'busy', replayJobId: replayJobId(reference.id) };
  }
  protected async replayProtected(id?: string): Promise<boolean> {
    if (!id) return false;
    const record = await this.services.ledger.find(id, true);
    return record !== null && record.replayedAt === undefined;
  }
  async remove(reference: QueueJobReference): Promise<QueueMutationResult> {
    this.reference(reference);
    if (reference.source === 'live') return { ...reference, outcome: await this.removeLive(reference.id) };
    const record = await this.services.ledger.find(reference.id, true);
    if (!record || record.connection !== this.connection || record.queue !== this.queue) return { ...reference, outcome: 'missing' };
    const delivery = await this.get(replayJobId(reference.id));
    if (delivery?.status === 'active') return { ...reference, outcome: 'busy' };
    if (delivery && record.replayedAt === undefined) return { ...reference, outcome: 'protected' };
    return { ...reference, outcome: await this.services.ledger.forget(reference.id) ? 'accepted' : 'busy' };
  }
  private async batch(references: readonly QueueJobReference[], operation: 'retry' | 'remove'): Promise<QueueBatchResult> {
    if (!Array.isArray(references) || references.length > 1000) throw new RangeError('Queue batches must contain at most 1000 references.');
    const unique = new Map<string, QueueJobReference>();
    for (const reference of references) { this.reference(reference); unique.set(`${reference.source}\0${reference.id}`, reference); }
    const result: QueueBatchResult = { results: [], failures: [] };
    for (const reference of unique.values()) {
      try { result.results.push(await this[operation](reference)); }
      catch { result.failures.push({ ...reference, error: 'Queue mutation failed; the original record has not been discarded.' }); }
    }
    return result;
  }
  retryMany(references: readonly QueueJobReference[]) { return this.batch(references, 'retry'); }
  cleanup(references: readonly QueueJobReference[]) { return this.batch(references, 'remove'); }
}

class RedisAdapter extends AdapterBase {
  readonly driver = 'redis' as const;
  readonly capabilities = Object.freeze({ shared: true, indexedMetadata: true, durableReplay: true, pause: true });
  constructor(services: AdapterServices, private provider: () => Promise<any>, private operations: RedisQueueOperations,
    private coverage: 'instrumented' | 'exclusive') { super(services); }
  async counts() {
    const queue = await this.provider();
    const counts = await queue.getJobCounts('waiting', 'paused', 'prioritized', 'active', 'completed', 'failed', 'delayed');
    return { waiting: (counts.waiting ?? 0) + (counts.paused ?? 0) + (counts.prioritized ?? 0), active: counts.active ?? 0,
      completed: counts.completed ?? 0, failed: counts.failed ?? 0, delayed: counts.delayed ?? 0,
      deadLetter: await this.services.ledger.count(this.connection, this.queue) };
  }
  list(filter?: QueueJobFilter) { return this.operations.list(filter); }
  async get(id: string) { const queue = await this.provider(); const job = await queue.getJob(id); return job ? this.operations.snapshot(job) : null; }
  async pause() { await (await this.provider()).pause(); }
  async resume() { await (await this.provider()).resume(); }
  async runtime(): Promise<QueueAdapterRuntime> {
    const queue = await this.provider();
    const workers = await readWorkerTelemetry(queue, this.queue, 100, this.coverage);
    const paused = await queue.isPaused();
    const globalConcurrency = await queue.getGlobalConcurrency() ?? null;
    const ages = await this.operations.readyAges();
    const observedConcurrency = workers.observed?.concurrency ?? null;
    return { paused, workers, globalConcurrency, observedConcurrency,
      effectiveConcurrency: paused ? 0 : workers.complete && this.coverage === 'exclusive' && observedConcurrency !== null
        ? Math.min(globalConcurrency ?? observedConcurrency, observedConcurrency) : null,
      oldestWaitingAt: ages.oldest, lag: ages.oldest === null ? (await queue.getWaitingCount() === 0 ? 0 : null) : Math.max(0, Date.now() - ages.oldest),
      stalled: ages.stalled, expiredLocks: ages.expiredLocks, locksComplete: ages.complete, coverage: 'instrumented' };
  }
  async metrics(minutes = 60): Promise<QueueSharedMetrics> {
    boundedLimit(minutes, 20160);
    const queue = await this.provider();
    const completed = await queue.getMetrics('completed', 0, minutes - 1);
    const failed = await queue.getMetrics('failed', 0, minutes - 1);
    return { source: 'redis', completed: Number(completed.meta.count), failed: Number(failed.meta.count),
      completedPerMinute: completed.data.map(Number), failedPerMinute: failed.data.map(Number), minutes };
  }
  async recover(): Promise<number> { throw new QueueCapabilityError('Manual stalled recovery (native workers own recovery)', this.driver); }
  async reconcile(limit = 1000) {
    const jobs = await this.operations.reconcile(limit);
    const dead = await this.reconcileDeadLetters(limit);
    return { ...jobs, complete: jobs.complete && dead.complete, deadLettersIndexed: dead.indexed };
  }
  protected liveTimeline(id: string, limit?: number) { return this.operations.timeline(id, limit); }
  protected async retryLive(id: string): Promise<QueueMutationResult['outcome']> {
    const queue = await this.provider(); const job = await queue.getJob(id);
    if (!job) return 'missing'; if (await job.getState() !== 'failed') return 'not-failed';
    try { await job.retry(); await this.operations.refresh(id, 'retried'); return 'accepted'; }
    catch (error) { if (await job.getState() !== 'failed') return 'busy'; throw error; }
  }
  protected async removeLive(id: string): Promise<QueueMutationResult['outcome']> {
    const queue = await this.provider(); const job = await queue.getJob(id);
    if (!job) return 'missing'; if (await job.getState() === 'active') return 'busy';
    if (await this.replayProtected(job.data?.replayRecordId)) return 'protected';
    try { await job.remove(); await this.operations.removeIndex(id); return 'accepted'; }
    catch (error) { if (await job.getState() === 'active') return 'busy'; throw error; }
  }
}

class DatabaseAdapter extends AdapterBase {
  readonly driver = 'database' as const;
  readonly capabilities = Object.freeze({ shared: true, indexedMetadata: true, durableReplay: true, pause: false });
  constructor(services: AdapterServices, private query: () => QueryBuilder<any>, private events: QueueEventStore,
    private recovery: () => Promise<number>) { super(services); }
  private scoped() { return this.query().where('queue', this.queue); }
  private async info(row: any): Promise<QueueJobSnapshot> {
    const data = JSON.parse(row.payload);
    const active = row.reserved_at != null;
    const completed = row.completed_at != null;
    const delayed = !active && Number(row.available_at) > Date.now() / 1000;
    return { id: row.id, connection: this.connection, queue: this.queue, jobClass: data.jobClass,
      status: completed ? 'completed' : active ? 'active' : delayed ? 'delayed' : 'waiting', attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
      stalledCount: await this.events.stalledCount(this.connection, this.queue, row.id), createdAt: Number(row.created_at) * 1000,
      processedAt: active ? Number(row.reserved_at) * 1000 : undefined,
      finishedAt: completed ? Number(row.completed_at) : undefined, delayedUntil: delayed ? Number(row.available_at) * 1000 : undefined,
      metadata: data.metadata, payload: data.payload, replayRecordId: row.replay_id ?? undefined,
      lock: { source: 'database-lease', state: !active ? 'none' : row.lease_expires_at == null ? 'unknown' : Number(row.lease_expires_at) > Date.now() ? 'observed' : 'expired',
        expiresAt: row.lease_expires_at == null ? null : Number(row.lease_expires_at), owner: null } };
  }
  async counts() {
    const ready = Math.floor(Date.now() / 1000);
    return { waiting: await this.scoped().whereNull('reserved_at').whereNull('completed_at').where('available_at', '<=', ready).count(),
      active: await this.scoped().whereNotNull('reserved_at').whereNull('completed_at').count(),
      completed: await this.scoped().whereNotNull('completed_at').count(), failed: 0,
      delayed: await this.scoped().whereNull('reserved_at').whereNull('completed_at').where('available_at', '>', ready).count(),
      deadLetter: await this.services.ledger.count(this.connection, this.queue) };
  }
  async list(filter: QueueJobFilter = {}): Promise<QueueJobPage> {
    const { limit, offset } = pageOptions(filter); const query = this.scoped();
    if (filter.status === 'failed') return { items: [], limit, offset, indexedCount: 0, coverage: 'instrumented' };
    if (filter.status === 'completed') query.whereNotNull('completed_at');
    else if (filter.status) {
      query.whereNull('completed_at');
      if (filter.status === 'active') query.whereNotNull('reserved_at');
      else query.whereNull('reserved_at').where('available_at', filter.status === 'delayed' ? '>' : '<=', Math.floor(Date.now() / 1000));
    }
    for (const field of metadataFields) if (filter[field] !== undefined) query.where(metadataColumns[field], metadataDigest(filter[field]));
    if (filter.jobClass) throw new QueueCapabilityError('Database class filtering without a class index', this.driver);
    const indexedCount = await query.clone().count();
    const rows = await query.orderBy('created_at', 'desc').orderBy('id', 'desc').offset(offset).limit(limit).get();
    return { items: await Promise.all(rows.map(row => this.info(row))), limit, offset, indexedCount, coverage: 'instrumented' };
  }
  async get(id: string) { const row = await this.scoped().where('id', id).first(); return row ? this.info(row) : null; }
  async pause(): Promise<void> { throw new QueueCapabilityError('Pause', this.driver); }
  async resume(): Promise<void> { throw new QueueCapabilityError('Resume', this.driver); }
  async runtime(): Promise<QueueAdapterRuntime> {
    const row = await this.scoped().whereNull('reserved_at').whereNull('completed_at').where('available_at', '<=', Math.floor(Date.now() / 1000)).orderBy('created_at').first();
    const oldest = row ? Number(row.created_at) * 1000 : null;
    const expired = await this.scoped().whereNotNull('reserved_at').where('lease_expires_at', '<=', Date.now()).count();
    const complete = await this.scoped().whereNotNull('reserved_at').whereNull('lease_expires_at').count() === 0;
    return { paused: null, workers: null, globalConcurrency: null, observedConcurrency: null, effectiveConcurrency: null,
      oldestWaitingAt: oldest, lag: oldest === null ? 0 : Math.max(0, Date.now() - oldest), stalled: complete ? expired : null,
      expiredLocks: complete ? expired : null, locksComplete: complete, coverage: 'instrumented' };
  }
  metrics(minutes?: number) { return this.events.metrics(this.connection, this.queue, minutes); }
  recover() { return this.recovery(); }
  protected liveTimeline(id: string, limit?: number) { return this.events.timeline(this.connection, this.queue, id, 'live', limit); }
  protected async retryLive(): Promise<QueueMutationResult['outcome']> { return 'not-failed'; }
  protected async removeLive(id: string): Promise<QueueMutationResult['outcome']> {
    const row = await this.scoped().where('id', id).first(); if (!row) return 'missing';
    if (row.reserved_at != null) return 'busy'; if (await this.replayProtected(row.replay_id)) return 'protected';
    return await this.scoped().where('id', id).whereNull('reserved_at').delete() === 1 ? 'accepted' : 'busy';
  }
  async reconcile(limit = 1000) {
    boundedLimit(limit, 10000);
    const rows = await this.scoped().orderBy('created_at').limit(limit + 1).get();
    for (const row of rows.slice(0, limit)) {
      const data = JSON.parse(row.payload);
      await this.scoped().where('id', row.id).update({ queue_connection: this.connection, ...metadataRow(data.metadata, data.context) });
    }
    const dead = await this.reconcileDeadLetters(limit);
    return { indexed: Math.min(rows.length, limit), complete: rows.length <= limit && dead.complete, deadLettersIndexed: dead.indexed };
  }
}

class VolatileAdapter extends AdapterBase {
  readonly capabilities = Object.freeze({ shared: false, indexedMetadata: false, durableReplay: false, pause: false });
  constructor(services: AdapterServices, readonly driver: 'sync' | 'memory') { super(services); }
  private unavailable(): never { throw new QueueCapabilityError('Shared operational monitoring', this.driver); }
  async counts(): Promise<never> { return this.unavailable(); }
  async list(): Promise<never> { return this.unavailable(); }
  async get(): Promise<never> { return this.unavailable(); }
  async runtime(): Promise<never> { return this.unavailable(); }
  async metrics(): Promise<never> { return this.unavailable(); }
  async pause(): Promise<never> { return this.unavailable(); }
  async resume(): Promise<never> { return this.unavailable(); }
  async reconcile(): Promise<never> { return this.unavailable(); }
  async recover(): Promise<never> { return this.unavailable(); }
  protected async retryLive(): Promise<never> { return this.unavailable(); }
  protected async removeLive(): Promise<never> { return this.unavailable(); }
  protected async liveTimeline(): Promise<never> { return this.unavailable(); }
}

export function redisAdapter(services: AdapterServices, provider: () => Promise<any>, operations: RedisQueueOperations,
  coverage: 'instrumented' | 'exclusive'): QueueMonitoringAdapter { return new RedisAdapter(services, provider, operations, coverage); }
export function databaseAdapter(services: AdapterServices, query: () => QueryBuilder<any>, events: QueueEventStore,
  recover: () => Promise<number>): QueueMonitoringAdapter { return new DatabaseAdapter(services, query, events, recover); }
export function volatileAdapter(services: AdapterServices, driver: 'sync' | 'memory'): QueueMonitoringAdapter { return new VolatileAdapter(services, driver); }
