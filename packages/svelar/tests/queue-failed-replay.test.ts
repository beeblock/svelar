import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Job, Queue } from '../src/queue/index.js';

class ReplayContractJob extends Job {
  static shouldFail = true;
  retryDelay = 0;
  maxAttempts = 1;
  constructor(public value = 'original') { super(); }
  async handle() { if (ReplayContractJob.shouldFail) throw new Error('bounded failure'); }
  failed() {}
}
beforeEach(async () => {
  await Queue.stop();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
  await new Migrator().fresh(svelarCoreMigrations());
  Queue.configure({ default: 'sql', connections: { sql: { driver: 'database' }, other: { driver: 'database' } } });
  Queue.register(ReplayContractJob); ReplayContractJob.shouldFail = true;
});
afterEach(async () => { vi.restoreAllMocks(); await Queue.stop(); await Connection.disconnect(); });

async function failure() {
  const original = await Queue.dispatch(new ReplayContractJob(), { context: { teamId: 'tenant', userId: 'actor' },
    metadata: { accountId: 'account', resourceId: 'resource', correlationId: 'trace' } });
  await Queue.work({ maxJobs: 1 });
  const [record] = await Queue.failed(); return { original, record };
}

describe('Durable selected failed-job replay', () => {
  it('permits one winner across concurrent live/DLQ/legacy retry paths and retains the receipt', async () => {
    const { original, record } = await failure(); ReplayContractJob.shouldFail = false;
    const adapter = Queue.adapter();
    const results = await Promise.all([
      adapter.retry({ source: 'live', id: original }), adapter.retry({ source: 'dead-letter', id: record.id }),
      ...Array.from({ length: 6 }, () => Queue.retry(record.id)),
    ]);
    expect(results.filter(result => result === true || (typeof result === 'object' && result.outcome === 'accepted'))).toHaveLength(1);
    expect(await Queue.size()).toBe(1); expect(await Queue.failed()).toEqual([]);
    const [receipt] = await adapter.deadLetters({ includeReplayed: true });
    expect(receipt).toMatchObject({ context: { teamId: 'tenant', userId: 'actor' }, maxAttempts: 1, retryDelay: 0, connection: 'sql' });
    expect(receipt.replayedAt).toBeGreaterThan(0);
    expect(await Queue.work({ maxJobs: 1 })).toBe(1);
    expect((await adapter.get(receipt.replayJobId!))?.status).toBe('completed');
    expect(await Queue.retry(record.id)).toBe(false);
  });

  it('rolls back the claim on publishing failure and preserves the original payload/context/policy', async () => {
    const { record } = await failure(); const original = JSON.stringify(record);
    vi.spyOn((Queue as any).resolveDriver('sql'), 'push').mockRejectedValue(new Error('storage unavailable'));
    await expect(Queue.retry(record.id)).rejects.toThrow('storage unavailable');
    expect(JSON.stringify((await Queue.failed())[0])).toBe(original);
    const row = await new QueryBuilder('svelar_failed_jobs').where('id', record.id).first();
    expect(row.replay_token).toBeNull(); expect(row.replay_job_id).toBeNull(); expect(row.replayed_at).toBeNull();
  });

  it('persists the original failure even if the application failed hook throws', async () => {
    vi.spyOn(ReplayContractJob.prototype, 'failed').mockImplementation(() => { throw new Error('failure hook unavailable'); });
    await Queue.dispatch(new ReplayContractJob(), { context: { teamId: 'tenant' } });
    await expect(Queue.work({ maxJobs: 1 })).rejects.toThrow('failure hook unavailable');
    const [record] = await Queue.failed(); expect(record.context?.teamId).toBe('tenant'); expect(record.exception).toContain('bounded failure');
    expect(await Queue.size()).toBe(0);
  });

  it('explicitly reconciles pre-index ledger rows only into their original connection or the default legacy connection', async () => {
    const { record } = await failure();
    await new QueryBuilder('svelar_failed_jobs').where('id', record.id).update({ queue_connection: null, metadata_tenant: null });
    expect(await Queue.adapter().deadLetters()).toEqual([]);
    expect(await Queue.adapter('default', 'other').reconcile()).toMatchObject({ deadLettersIndexed: 0, complete: false });
    expect(await Queue.adapter().reconcile()).toMatchObject({ deadLettersIndexed: 1, complete: true });
    expect((await Queue.adapter().deadLetters({ tenantId: 'tenant' }))[0].id).toBe(record.id);
    await new QueryBuilder('svelar_failed_jobs').where('id', record.id).update({ queue_connection: null, payload: record.payload });
    expect(await Queue.adapter('default', 'other').reconcile()).toMatchObject({ deadLettersIndexed: 0 });
    expect(await Queue.adapter().reconcile()).toMatchObject({ deadLettersIndexed: 1 });
  });

  it('does not claim or replay a foreign connection/queue record', async () => {
    const { record } = await failure();
    expect((await Queue.adapter('default', 'other').retry({ source: 'dead-letter', id: record.id })).outcome).toBe('missing');
    expect((await Queue.adapter('different', 'sql').retry({ source: 'dead-letter', id: record.id })).outcome).toBe('missing');
    expect(await Queue.failed()).toHaveLength(1);
  });

  it('preserves records with missing job definitions, and reports selected batch failures independently', async () => {
    const { record } = await failure();
    await new QueryBuilder('svelar_failed_jobs').where('id', record.id).update({ job_class: 'MissingReplayClass' });
    const result = await Queue.adapter().retryMany([{ source: 'dead-letter', id: record.id }, { source: 'dead-letter', id: 'missing' }]);
    expect(result.failures).toHaveLength(1); expect(result.results[0].outcome).toBe('missing');
    expect(await Queue.failed()).toHaveLength(1);
    expect((await new QueryBuilder('svelar_failed_jobs').first()).replay_token).toBeNull();
  });

  it('retains the failed and replayed timeline after cleanup removes the archived payload', async () => {
    const { record } = await failure(); ReplayContractJob.shouldFail = false;
    const adapter = Queue.adapter(); const reference = { source: 'dead-letter' as const, id: record.id };
    expect((await adapter.retry(reference)).outcome).toBe('accepted');
    expect((await adapter.timeline(reference)).map(event => event.event)).toEqual(expect.arrayContaining(['failed', 'replayed']));
    expect((await adapter.remove(reference)).outcome).toBe('accepted');
    expect(await Queue.retry(record.id)).toBe(false);
    expect((await adapter.timeline(reference)).map(event => event.event)).toContain('replayed');
  });
});
