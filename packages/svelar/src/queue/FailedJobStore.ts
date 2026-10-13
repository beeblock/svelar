import { createHash } from 'node:crypto';
import { Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import type { ApplicationContextSnapshot } from '../support/Context.js';
import { decodeFailedJobPayload } from './FailedJobPayload.js';
import { QueueEventStore } from './EventStore.js';
import { metadataColumns, metadataDigest, metadataFields, metadataRow } from './Metadata.js';
import { boundedLimit, pageOptions, type QueueDeadLetterRecord, type QueueJobFilter } from './Monitoring.js';

interface FailureTransport {
  id?: string;
  queue: string;
  jobClass: string;
  payload: string;
  context?: ApplicationContextSnapshot;
  metadata?: Record<string, any>;
  connection?: string;
  maxAttempts?: number;
  retryDelay?: number;
  priority?: number;
}
export interface FailedJobRecord extends Omit<QueueDeadLetterRecord, 'connection'> { connection?: string; }
export function replayJobId(id: string): string { return `svelar-replay-${createHash('sha256').update(id).digest('hex')}`; }

export class FailedJobStore {
  constructor(readonly databaseConnection?: string) {}
  private query() { return new QueryBuilder<any>('svelar_failed_jobs', undefined, this.databaseConnection); }
  private events() { return new QueueEventStore(this.databaseConnection); }
  async store(job: FailureTransport & { job: { retryDelay: number } }, error: Error): Promise<void> {
    await this.storeRaw({ ...job, retryDelay: job.job.retryDelay }, error);
  }
  async storeRaw(job: FailureTransport, error: Error): Promise<void> {
    const id = crypto.randomUUID();
    await Connection.transaction(async () => {
      await this.query().insert({ id, queue: job.queue, job_class: job.jobClass,
        payload: JSON.stringify({ __svelarFailedJob: 1, payload: job.payload, context: job.context ?? {}, metadata: job.metadata,
          connection: job.connection, maxAttempts: job.maxAttempts, retryDelay: job.retryDelay, priority: job.priority }),
        exception: error.stack ?? error.message, failed_at: Math.floor(Date.now() / 1000),
        queue_connection: job.connection ?? null, original_job_id: job.id ?? null, replay_token: null, replay_job_id: null, replayed_at: null,
        ...metadataRow(job.metadata, job.context),
      });
      if (job.connection) await this.events().record(job.connection, job.queue, id, 'dead-letter', 'failed');
    }, this.databaseConnection);
  }
  async all(): Promise<FailedJobRecord[]> {
    return (await this.query().whereNull('replayed_at').orderBy('failed_at', 'desc').get()).map(row => this.record(row));
  }
  async list(connection: string, queue: string, filter: QueueJobFilter & { includeReplayed?: boolean } = {}): Promise<QueueDeadLetterRecord[]> {
    const { limit, offset } = pageOptions(filter);
    const query = this.query().where('queue_connection', connection).where('queue', queue);
    if (!filter.includeReplayed) query.whereNull('replayed_at');
    if (filter.jobClass) query.where('job_class', filter.jobClass);
    for (const field of metadataFields) if (filter[field] !== undefined) query.where(metadataColumns[field], metadataDigest(filter[field]));
    return (await query.orderBy('failed_at', 'desc').orderBy('id', 'desc').offset(offset).limit(limit).get())
      .map(row => ({ ...this.record(row), connection: row.queue_connection ?? null }));
  }
  async count(connection: string, queue: string): Promise<number> {
    return this.query().where('queue_connection', connection).where('queue', queue).whereNull('replayed_at').count();
  }
  async reconcile(connection: string, queue: string, limit: number, includeLegacy = false): Promise<{ indexed: number; complete: boolean }> {
    boundedLimit(limit, 10000);
    const rows = await this.query().where('queue', queue).whereNull('queue_connection').orderBy('failed_at').orderBy('id').limit(limit + 1).get();
    let indexed = 0;
    for (const row of rows.slice(0, limit)) {
      const data = decodeFailedJobPayload(row.payload);
      if (data.connection !== connection && !(includeLegacy && data.connection === undefined)) continue;
      indexed += await this.query().where('id', row.id).whereNull('queue_connection')
        .update({ queue_connection: connection, ...metadataRow(data.metadata, data.context) });
    }
    return { indexed, complete: rows.length <= limit && indexed === rows.length };
  }
  private record(row: any): FailedJobRecord {
    return { id: row.id, queue: row.queue, jobClass: row.job_class, ...decodeFailedJobPayload(row.payload),
      connection: row.queue_connection ?? decodeFailedJobPayload(row.payload).connection,
      exception: row.exception, failedAt: Number(row.failed_at), originalJobId: row.original_job_id ?? undefined,
      replayJobId: row.replay_job_id ?? undefined, replayedAt: row.replayed_at == null ? undefined : Number(row.replayed_at) };
  }
  async find(id: string, includeReplayed = false): Promise<FailedJobRecord | null> {
    const query = this.query().where('id', id);
    if (!includeReplayed) query.whereNull('replayed_at');
    const row = await query.first(); return row ? this.record(row) : null;
  }
  async findOriginal(connection: string, queue: string, originalId: string): Promise<FailedJobRecord | null> {
    const row = await this.query().where('queue_connection', connection).where('queue', queue).where('original_job_id', originalId)
      .orderBy('failed_at', 'desc').orderBy('id', 'desc').first();
    return row ? this.record(row) : null;
  }
  async replay(id: string, publish: (record: FailedJobRecord, jobId: string) => Promise<void>,
    scope?: { connection: string; queue: string }): Promise<boolean> {
    return Connection.transaction(async () => {
      const query = this.query().where('id', id).whereNull('replayed_at').whereNull('replay_token');
      if (scope) query.where('queue_connection', scope.connection).where('queue', scope.queue);
      const token = crypto.randomUUID();
      const jobId = replayJobId(id);
      if (await query.update({ replay_token: token, replay_job_id: jobId }) !== 1) return false;
      const record = await this.find(id);
      if (!record) throw new Error('Claimed failed queue record disappeared.');
      await publish(record, jobId);
      // Do not delete the receipt: a broker acknowledgement followed by a DB crash
      // must replay the same retained broker id, never enqueue a new delivery.
      if (await this.query().where('id', id).where('replay_token', token).update({ replayed_at: Date.now() }) !== 1) throw new Error('Queue replay claim was lost.');
      if (record.connection) await this.events().record(record.connection, record.queue, id, 'dead-letter', 'replayed', { replayJobId: jobId });
      return true;
    }, this.databaseConnection);
  }
  async forget(id: string): Promise<boolean> {
    return (await this.query().where('id', id).whereNested(query => query.whereNull('replay_token').orWhereNotNull('replayed_at')).delete()) > 0;
  }
  async flush(): Promise<number> {
    return this.query().whereNull('replayed_at').whereNull('replay_token').delete();
  }
  async timeline(connection: string, queue: string, id: string, limit?: number) {
    return this.events().timeline(connection, queue, id, 'dead-letter', limit);
  }
}
