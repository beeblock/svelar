import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Job, Queue } from '../src/queue/index.js';
import { ApplicationContext } from '../src/support/Context.js';
import { QueueEventStore } from '../src/queue/EventStore.js';
import { redisConnection } from '../src/queue/RedisConnection.js';

class MonitoredDatabaseJob extends Job {
  static actions = new Map<string, () => Promise<void>>();
  retryDelay = 0;
  constructor(public label: string) { super(); }
  async handle() { await MonitoredDatabaseJob.actions.get(this.label)?.(); }
  failed() {}
}

beforeEach(async () => {
  await Queue.stop();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
  await new Migrator().fresh(svelarCoreMigrations());
  Queue.configure({ default: 'sql', connections: { sql: { driver: 'database', leaseDurationMs: 120 }, alternate: { driver: 'database', leaseDurationMs: 120 } } });
  Queue.register(MonitoredDatabaseJob);
  MonitoredDatabaseJob.actions.clear();
});
afterEach(async () => { vi.restoreAllMocks(); await Queue.stop(); await Connection.disconnect(); });

describe('Public queue monitoring adapters', () => {
  it('looks up a dead-letter by ID only in its exact connection and queue', async () => {
    MonitoredDatabaseJob.actions.set('dead-letter-lookup', async () => { throw new Error('lookup fixture'); });
    await Queue.dispatch(new MonitoredDatabaseJob('dead-letter-lookup'), { queue: 'reports', connection: 'sql', maxAttempts: 1 });
    await Queue.work({ queue: 'reports', connection: 'sql', maxJobs: 1 });
    const adapter = Queue.adapter('reports', 'sql');
    const [failure] = await adapter.deadLetters();
    expect(await adapter.deadLetter(failure.id)).toMatchObject({ id: failure.id, connection: 'sql', queue: 'reports' });
    expect(await Queue.adapter('reports', 'alternate').deadLetter(failure.id)).toBeNull();
    expect(await Queue.adapter('other', 'sql').deadLetter(failure.id)).toBeNull();
    expect(await adapter.deadLetter('not-found')).toBeNull();
    await expect(adapter.deadLetter('')).rejects.toThrow('Invalid queue job reference');
  });

  it('keeps queue registry and driver reads isolated on named connections', async () => {
    await Queue.dispatch(new MonitoredDatabaseJob('one'), { queue: 'shared', connection: 'sql' });
    await Queue.dispatch(new MonitoredDatabaseJob('two'), { queue: 'shared', connection: 'alternate' });
    expect(Queue.queues()).toEqual(expect.arrayContaining([{ name: 'shared', connection: 'sql' }, { name: 'shared', connection: 'alternate' }]));
    expect((await Queue.adapter('shared', 'sql').counts()).waiting).toBe(1);
    expect((await Queue.adapter('shared', 'alternate').counts()).waiting).toBe(1);
    expect((await Queue.discoverQueues('alternate')).some(queue => queue.name === 'shared')).toBe(true);
  });

  it('filters indexed tenant/account/resource/correlation metadata without changing caller payloads', async () => {
    await Queue.dispatch(new MonitoredDatabaseJob('match'), { context: { teamId: 'team-a', correlationId: 'trace-a' },
      metadata: { accountId: 0, resourceId: 'invoice-a', visible: 'kept' } });
    await Queue.dispatch(new MonitoredDatabaseJob('other'), { context: { teamId: 'team-b' }, metadata: { accountId: 0, resourceId: 'invoice-a' } });
    const adapter = Queue.adapter('default', 'sql');
    const page = await adapter.list({ tenantId: 'team-a', accountId: 0, resourceId: 'invoice-a', correlationId: 'trace-a' });
    expect(page.indexedCount).toBe(1); expect(page.items).toHaveLength(1);
    expect(page.items[0].metadata).toEqual({ accountId: 0, resourceId: 'invoice-a', visible: 'kept' });
    const row = await new QueryBuilder('svelar_jobs').first();
    expect(row.metadata_tenant).toHaveLength(64); expect(row.metadata_tenant).not.toBe('team-a');
    expect((await adapter.list({ tenantId: 'team-b', correlationId: 'trace-a' })).items).toHaveLength(0);
  });

  it('validates metadata and page values before persistence', async () => {
    await expect(Queue.dispatch(new MonitoredDatabaseJob('invalid'), { metadata: { tenantId: { unsafe: true } } })).rejects.toThrow('Indexed queue metadata');
    await expect(Queue.dispatch(new MonitoredDatabaseJob('invalid-context'), { context: { correlationId: '\0' } })).rejects.toThrow('Indexed queue metadata');
    await expect(Queue.adapter().list({ limit: 1001 })).rejects.toThrow('limit');
    await expect(Queue.adapter().list({ offset: -1 })).rejects.toThrow('offset');
    expect(await new QueryBuilder('svelar_jobs').count()).toBe(0);
  });

  it('rolls back single and bulk SQL publication if its operational event cannot be persisted', async () => {
    vi.spyOn(QueueEventStore.prototype, 'record').mockRejectedValue(new Error('event storage unavailable'));
    await expect(Queue.dispatch(new MonitoredDatabaseJob('single'))).rejects.toThrow('event storage unavailable');
    await expect(Queue.dispatchBulk([new MonitoredDatabaseJob('bulk-a'), new MonitoredDatabaseJob('bulk-b')])).rejects.toThrow('event storage unavailable');
    expect(await new QueryBuilder('svelar_jobs').count()).toBe(0);
  });

  it('uses the named job database for atomic receipts even when a separate global failed database is configured', async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'primary', connections: {
      primary: { driver: 'sqlite', filename: ':memory:' }, secondary: { driver: 'sqlite', filename: ':memory:' },
    } });
    await new Migrator('primary').fresh(svelarCoreMigrations()); await new Migrator('secondary').fresh(svelarCoreMigrations());
    Queue.configure({ default: 'sql', failedConnection: 'primary', connections: { sql: { driver: 'database', databaseConnection: 'secondary' } } });
    MonitoredDatabaseJob.actions.set('named-failure', async () => { throw new Error('named storage failure'); });
    await Queue.dispatch(new MonitoredDatabaseJob('named-failure'), { maxAttempts: 1 }); await Queue.work({ maxJobs: 1 });
    expect(await new QueryBuilder('svelar_failed_jobs', undefined, 'primary').count()).toBe(0);
    const [record] = await Queue.failed(); expect(record.connection).toBe('sql');
    expect((await Queue.adapter().retry({ source: 'dead-letter', id: record.id })).outcome).toBe('accepted');
    expect(await new QueryBuilder('svelar_jobs', undefined, 'secondary').count()).toBe(1);
    expect(await new QueryBuilder('svelar_jobs', undefined, 'primary').count()).toBe(0);
  });

  it('does not invent a healthy lock count for legacy active rows without a lease observation', async () => {
    const id = await Queue.dispatch(new MonitoredDatabaseJob('legacy-active'));
    await new QueryBuilder('svelar_jobs').where('id', id).update({ reserved_at: Math.floor(Date.now() / 1000), lease_expires_at: null });
    expect(await Queue.adapter().runtime()).toMatchObject({ locksComplete: false, expiredLocks: null, stalled: null });
  });

  it('preserves TLS, ACL credentials, URL database zero and strict URL parsing for runtime and legacy monitoring', () => {
    expect(redisConnection({ url: 'rediss://worker%40app:p%40ss@redis.example:6380/0', db: 9 })).toEqual({
      host: 'redis.example', port: 6380, username: 'worker@app', password: 'p@ss', db: 0, tls: {},
    });
    expect(() => redisConnection({ url: 'https://redis.example' })).toThrow('redis://');
    expect(() => redisConnection({ url: 'redis://redis.example/0invalid' })).toThrow('database');
  });

  it('renews SQL leases while jobs run and refuses active deletion', async () => {
    let started!: () => void; const active = new Promise<void>(resolve => { started = resolve; });
    MonitoredDatabaseJob.actions.set('long', async () => { started(); await new Promise(resolve => setTimeout(resolve, 450)); });
    const id = await Queue.dispatch(new MonitoredDatabaseJob('long'));
    const run = Queue.work({ maxJobs: 1 }); await active;
    const adapter = Queue.adapter();
    expect((await adapter.get(id))?.lock.state).toBe('observed');
    expect((await adapter.remove({ source: 'live', id })).outcome).toBe('busy');
    await new Promise(resolve => setTimeout(resolve, 280));
    expect((await adapter.get(id))?.lock.state).toBe('observed');
    expect(await adapter.recover()).toBe(0);
    expect(await run).toBe(1);
    expect((await adapter.metrics()).completed).toBe(1);
    expect((await adapter.timeline({ source: 'live', id })).map(event => event.event)).toContain('completed');
  });

  it('recovers expired reservations once and prevents a stale owner from deleting the recovered row', async () => {
    const id = await Queue.dispatch(new MonitoredDatabaseJob('recover'));
    const driver = (Queue as any).resolveDriver('sql'); const claimed = await driver.pop('default');
    await new QueryBuilder('svelar_jobs').where('id', id).update({ lease_expires_at: Date.now() - 1 });
    expect(await Queue.adapter().recover()).toBe(1);
    expect((await Queue.adapter().get(id))?.stalledCount).toBe(1);
    await expect(driver.delete(claimed)).rejects.toThrow('reservation was lost');
    expect(await Queue.work({ maxJobs: 1 })).toBe(1);
    expect((await Queue.adapter().timeline({ source: 'live', id })).map(event => event.event)).toContain('stalled');
  });

  it('moves a killed final-attempt reservation into DLQ instead of executing indefinitely', async () => {
    const id = await Queue.dispatch(new MonitoredDatabaseJob('exhausted'), { maxAttempts: 1, context: { teamId: 'team-a' } });
    const driver = (Queue as any).resolveDriver('sql'); await driver.pop('default');
    await new QueryBuilder('svelar_jobs').where('id', id).update({ lease_expires_at: Date.now() - 1 });
    expect(await Queue.adapter().recover()).toBe(1);
    expect(await Queue.size()).toBe(0);
    const [dead] = await Queue.adapter().deadLetters({ tenantId: 'team-a' });
    expect(dead.originalJobId).toBe(id); expect(dead.context?.teamId).toBe('team-a');
    expect((await Queue.adapter().metrics()).failed).toBe(1);
  });

  it('reports shared SQL outcomes across newly created adapters and keeps ready lag separate from delayed jobs', async () => {
    await Queue.dispatch(new MonitoredDatabaseJob('ready'));
    await Queue.dispatch(new MonitoredDatabaseJob('later'), { delay: 60 });
    const before = await Queue.adapter().runtime(); expect(before.oldestWaitingAt).not.toBeNull(); expect(before.lag).toBeGreaterThanOrEqual(0);
    expect(await Queue.work({ maxJobs: 1 })).toBe(1);
    const metrics = await Queue.adapter('default', 'sql').metrics(5);
    expect(metrics).toMatchObject({ source: 'database', completed: 1, failed: 0 });
    expect(metrics.completedPerMinute.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await Queue.adapter().runtime()).oldestWaitingAt).toBeNull();
  });

  it('returns selected cleanup outcomes and rejects unsupported driver controls', async () => {
    const id = await Queue.dispatch(new MonitoredDatabaseJob('remove'));
    const result = await Queue.adapter().cleanup([{ source: 'live', id }, { source: 'live', id }, { source: 'live', id: 'missing' }]);
    expect(result.results.map(item => item.outcome)).toEqual(['accepted', 'missing']);
    await expect(Queue.adapter().pause()).rejects.toThrow('unsupported');
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    expect(Queue.adapter().capabilities.shared).toBe(false);
    await expect(Queue.adapter().metrics()).rejects.toThrow('unsupported');
    await expect(Queue.adapter().retry({ source: 'dead-letter', id: 'id' })).rejects.toThrow('Durable replay');
  });

  it('does not inherit the operator context while processing a stored tenant job', async () => {
    let observed: any;
    MonitoredDatabaseJob.actions.set('context', async () => { observed = ApplicationContext.snapshot(); });
    await Queue.dispatch(new MonitoredDatabaseJob('context'), { context: { teamId: 'stored-team' } });
    await ApplicationContext.runIsolated({ teamId: 'operator-team', userId: 'operator-user' }, () => Queue.work({ maxJobs: 1 }));
    expect(observed.teamId).toBe('stored-team'); expect(observed).not.toHaveProperty('userId');
  });
});
