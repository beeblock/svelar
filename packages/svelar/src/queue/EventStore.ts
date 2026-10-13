import { Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { boundedLimit, type QueueTimelineEvent, type QueueSharedMetrics } from './Monitoring.js';

export class QueueEventStore {
  constructor(private databaseConnection?: string) {}
  private query() { return new QueryBuilder<any>('svelar_queue_events', undefined, this.databaseConnection); }
  async record(connection: string, queue: string, jobId: string, source: 'live' | 'dead-letter', event: string,
    data: Pick<QueueTimelineEvent, 'attempt' | 'replayJobId'> = {}): Promise<void> {
    await this.query().insert({ id: crypto.randomUUID(), queue_connection: connection, queue, job_id: jobId, source,
      event, occurred_at: Date.now(), data: JSON.stringify(data) });
  }
  async timeline(connection: string, queue: string, jobId: string, source: 'live' | 'dead-letter', limit = 100): Promise<QueueTimelineEvent[]> {
    boundedLimit(limit);
    const rows = await this.query().where('queue_connection', connection).where('queue', queue).where('job_id', jobId)
      .where('source', source).orderBy('occurred_at', 'desc').orderBy('id', 'desc').limit(limit).get();
    return rows.map(row => ({ id: row.id, event: row.event, at: Number(row.occurred_at), ...JSON.parse(row.data ?? '{}') }));
  }
  async stalledCount(connection: string, queue: string, jobId: string): Promise<number> {
    return this.query().where('queue_connection', connection).where('queue', queue).where('job_id', jobId)
      .where('source', 'live').where('event', 'stalled').count();
  }
  async metrics(connection: string, queue: string, minutes = 60): Promise<QueueSharedMetrics> {
    boundedLimit(minutes, 20160);
    const nowBucket = Math.floor(Date.now() / 60000);
    const driver = Connection.getDriver(this.databaseConnection);
    const bucket = driver === 'mysql' ? 'FLOOR(occurred_at / 60000)' : `CAST(occurred_at / 60000 AS ${driver === 'postgres' ? 'BIGINT' : 'INTEGER'})`;
    const scope = () => this.query().where('queue_connection', connection).where('queue', queue).where('source', 'live');
    const rows = await scope().where('occurred_at', '>=', (nowBucket - minutes + 1) * 60000)
      .whereIn('event', ['completed', 'failed']).selectRaw(`${bucket} AS bucket, event, COUNT(*) AS total`).groupBy('bucket', 'event').get();
    const completedPerMinute = Array<number>(minutes).fill(0);
    const failedPerMinute = Array<number>(minutes).fill(0);
    for (const row of rows) {
      const offset = nowBucket - Number(row.bucket);
      if (offset >= 0 && offset < minutes) (row.event === 'completed' ? completedPerMinute : failedPerMinute)[offset] = Number(row.total);
    }
    return { source: 'database', completed: await scope().where('event', 'completed').count(), failed: await scope().where('event', 'failed').count(),
      completedPerMinute, failedPerMinute, minutes };
  }
}
