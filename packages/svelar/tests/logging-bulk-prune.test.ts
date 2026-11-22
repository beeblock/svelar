import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { CreateSvelarLogsTable } from '../src/database/CoreMigrations.js';
import { AddLogIdempotency } from '../src/database/core/00000000_000050_add_log_idempotency.js';
import { LogViewerService, type LogEntryInput } from '../src/logging/LogViewer.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

let viewer: LogViewerService;
const now = new Date('2026-11-22T12:00:00.000Z');
const entry = (message: string, context: Record<string, any> = {}, timestamp = now.toISOString()): LogEntryInput => ({
  timestamp, level: 'info', channel: 'audit', message, context,
});
beforeEach(async () => {
  await Connection.disconnect();
  Connection.configure({ default: 'logs', connections: { logs: { driver: 'sqlite', filename: ':memory:' } } });
  await new CreateSvelarLogsTable().up();
  viewer = new LogViewerService();
  viewer.configure({ driver: 'database', retentionSeconds: 60 });
});
afterEach(async () => { vi.restoreAllMocks(); await Connection.disconnect(); });

describe('Bulk log viewer writes', () => {
  it('inserts a batch with one multirow INSERT and no per-entry SELECT, preserving old schema and safe filters', async () => {
    const raw = vi.spyOn(Connection, 'raw');
    await viewer.addEntries([
      entry('first password=hidden', { tenantId: 'tenant-a', correlationId: 'corr-a', password: 'hidden' }),
      entry('second', { tenantId: 'tenant-b', correlationId: 'corr-b', nested: { authorization: 'hidden' } }),
      entry('third'),
    ]);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw.mock.calls[0][0]).toMatch(/^INSERT INTO "svelar_logs".*VALUES \([^)]*\), \([^)]*\), \(/);
    expect(raw.mock.calls[0][0]).not.toContain('idempotency_key');
    expect(raw.mock.calls[0][1]).not.toContain('hidden');
    expect(await viewer.query({ tenantId: 'tenant-b', correlationId: 'corr-b' })).toHaveLength(1);
    expect(JSON.stringify(await viewer.query())).not.toContain('hidden');
  });

  it('treats empty batches as no-ops and validates the complete batch before writing', async () => {
    const raw = vi.spyOn(Connection, 'raw');
    await viewer.addEntries([]);
    await expect(viewer.addEntries([entry('valid'), { ...entry('invalid'), timestamp: 'invalid' }])).rejects.toThrow('Invalid log entry');
    expect(raw).not.toHaveBeenCalled();
    expect(await viewer.query()).toEqual([]);
  });

  it('preserves addEntry Promise<void> and caller mutation isolation for memory and database', async () => {
    for (const driver of ['database', 'memory'] as const) {
      viewer.configure({ driver });
      const input = entry('safe', { nested: { action: 'original', token: 'hidden' } });
      expect(await viewer.addEntry(input)).toBeUndefined();
      input.context.nested.action = 'changed';
      const [row] = await viewer.query();
      expect(row.context.nested).toEqual({ action: 'original', token: '[REDACTED]' });
      row.context.nested.action = 'changed again';
      expect((await viewer.query())[0].context.nested.action).toBe('original');
    }
  });

  it('bounds memory entries and notifies subscribers with isolated redacted entries', async () => {
    viewer.configure({ driver: 'memory', maxEntries: 2 });
    const received: string[] = [];
    const stop = viewer.tail((row) => { received.push(row.message); row.context.password = 'changed'; });
    try {
      await viewer.addEntries([entry('one', { password: 'hidden' }), entry('two'), entry('three')]);
      expect(received).toEqual(['one', 'two', 'three']);
      expect((await viewer.query()).map((row) => [row.id, row.message])).toEqual([[2, 'two'], [3, 'three']]);
      expect((await viewer.query())[0].context.password).toBeUndefined();
      const raw = vi.spyOn(Connection, 'raw');
      await expect(viewer.addEntries([entry('valid'), { ...entry('bad'), level: 'invalid' as any }])).rejects.toThrow('Invalid log entry');
      expect(raw).not.toHaveBeenCalled();
      expect(received).toHaveLength(3);
    } finally { stop(); }
  });

  it('propagates storage failures without partial per-entry writes', async () => {
    const raw = vi.spyOn(Connection, 'raw').mockRejectedValue(new Error('storage unavailable'));
    await expect(viewer.addEntries([entry('one'), entry('two')])).rejects.toThrow('storage unavailable');
    expect(raw).toHaveBeenCalledTimes(1);
  });
});

describe('Opt-in idempotency', () => {
  it('requires the migration when enabled and does not silently downgrade on schema errors', async () => {
    viewer.configure({ driver: 'database', idempotency: { contextKey: 'eventId' } });
    await expect(viewer.addEntries([entry('one', { eventId: 'event-1' })])).rejects.toThrow('idempotency_key');
    expect(await new QueryBuilder('svelar_logs').count()).toBe(0);
  });

  it('deduplicates within/across batches and instances, scoped by channel and trusted tenant', async () => {
    await new AddLogIdempotency().up();
    viewer.configure({ driver: 'database', idempotency: { contextKey: 'eventId' } });
    const same = entry('original', { tenantId: 1, eventId: 'event-1' });
    await viewer.addEntries([same, { ...same, message: 'duplicate in batch' }]);
    const another = new LogViewerService();
    another.configure({ driver: 'database', idempotency: { contextKey: 'eventId' } });
    await Promise.all([
      viewer.addEntry({ ...same, message: 'duplicate retry' }),
      another.addEntries([same, entry('different tenant', { tenantId: 2, eventId: 'event-1' }), { ...same, channel: 'worker' }]),
    ]);
    await another.addEntry(entry('numeric/string tenant retry', { tenantId: '1', eventId: 'event-1' }));
    const rows = await viewer.query();
    expect(rows).toHaveLength(3);
    expect(rows[0].message).toBe('original');
    expect(rows.map((row) => [row.channel, row.context.tenantId])).toEqual([['audit', 1], ['audit', 2], ['worker', 1]]);
    const keys = await new QueryBuilder('svelar_logs').select('idempotency_key').get();
    expect(keys.every((row) => /^[a-f0-9]{64}$/.test(row.idempotency_key))).toBe(true);
  });

  it('permits absent keys and hashes the original key before masking a sensitive context key', async () => {
    await new AddLogIdempotency().up();
    viewer.configure({ driver: 'database', idempotency: { contextKey: 'token' } });
    await viewer.addEntries([entry('no key'), entry('no key'), entry('one', { token: 'one' }), entry('two', { token: 'two' })]);
    await viewer.addEntries([entry('retry one', { token: 'one' }), entry('retry two', { token: 'two' })]);
    expect(await viewer.query()).toHaveLength(4);
    expect((await viewer.query())[2].context.token).toBe('[REDACTED]');
  });

  it.each(['', 12, {}, 'x'.repeat(4097)])('rejects malformed keys atomically', async (key) => {
    viewer.configure({ driver: 'database', idempotency: { contextKey: 'eventId' } });
    const raw = vi.spyOn(Connection, 'raw');
    await expect(viewer.addEntries([entry('valid'), entry('invalid', { eventId: key })])).rejects.toThrow('idempotency key');
    expect(raw).not.toHaveBeenCalled();
  });

  it('retains memory idempotency only while its row is retained, including prune and clear', async () => {
    viewer.configure({ driver: 'memory', maxEntries: 2, retentionSeconds: 60, idempotency: { contextKey: 'eventId' } });
    const old = entry('old', { eventId: 'old' }, '2026-11-22T11:00:00.000Z');
    await viewer.addEntries([old, old, entry('recent', { eventId: 'recent' })]);
    expect(await viewer.query()).toHaveLength(2);
    expect(await viewer.prune(now)).toBe(1);
    await viewer.addEntry(old);
    expect(await viewer.query()).toHaveLength(2);
    await viewer.addEntry(entry('evict', { eventId: 'evict' }));
    await viewer.addEntry(entry('recent again', { eventId: 'recent' }));
    expect((await viewer.query()).map((row) => row.message)).toEqual(['evict', 'recent again']);
    await viewer.clear();
    await viewer.addEntry(entry('evict again', { eventId: 'evict' }));
    expect((await viewer.query())[0].message).toBe('evict again');
  });
});

describe('Bounded indexed retention', () => {
  it('uses the timestamp index to select each bounded SQLite delete batch', async () => {
    const raw = vi.spyOn(Connection, 'raw');
    await viewer.prune(now, { batchSize: 3, maxBatches: 1 });
    const [sql, bindings] = raw.mock.calls[0];
    const client = await Connection.rawClient();
    const plan = client.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings);
    expect(plan.map((row: any) => row.detail).join('\n')).toMatch(/USING COVERING INDEX .*recorded_at/);
  });

  it('does not prune at configure/write time and uses only the configured database connection', async () => {
    Connection.configure({ default: 'logs', connections: {
      logs: { driver: 'sqlite', filename: ':memory:' }, archive: { driver: 'sqlite', filename: ':memory:' },
    } });
    const { Schema } = await import('../src/database/SchemaBuilder.js');
    await new Schema('archive').createTable('svelar_logs', (table) => {
      table.increments('id'); table.timestamp('recorded_at'); table.string('level'); table.string('channel');
      table.text('message'); table.text('context'); table.string('correlation_id').nullable(); table.string('tenant_id').nullable();
      table.index('recorded_at');
    });
    const archived = new LogViewerService();
    archived.configure({ driver: 'database', connection: 'archive', retentionSeconds: 60 });
    const old = entry('expired', {}, '2026-11-22T11:00:00.000Z');
    await viewer.addEntry(old);
    await archived.addEntry(old);
    expect(await archived.query()).toHaveLength(1);
    expect(await archived.prune(now, { batchSize: 1, maxBatches: 1 })).toBe(1);
    expect(await archived.query()).toEqual([]);
    expect(await viewer.query()).toHaveLength(1);
  });

  it.each(['database', 'memory'] as const)('returns exact deletions and retains boundary/recent rows for %s', async (driver) => {
    viewer.configure({ driver, retentionSeconds: 60, pruneBatchSize: 2, pruneMaxBatches: 2 });
    await viewer.addEntries([
      ...Array.from({ length: 7 }, (_, i) => entry(`expired-${i}`, {}, '2026-11-22T11:00:00.000Z')),
      entry('boundary', {}, '2026-11-22T11:59:00.000Z'), entry('recent'),
    ]);
    const raw = vi.spyOn(Connection, 'raw');
    expect(await viewer.prune(now)).toBe(4);
    if (driver === 'database') {
      expect(raw).toHaveBeenCalledTimes(2);
      expect(raw.mock.calls.every(([sql]) => /^DELETE/.test(sql) && /id IN \(SELECT id FROM \(SELECT "id" FROM "svelar_logs" WHERE "recorded_at" < \? ORDER BY "recorded_at" ASC LIMIT 2\)/.test(sql))).toBe(true);
    }
    expect(await viewer.prune(now, { batchSize: 2, maxBatches: 10 })).toBe(3);
    expect(await viewer.prune(now)).toBe(0);
    expect((await viewer.query()).map((row) => row.message)).toEqual(['boundary', 'recent']);
  });

  it.each([{ batchSize: 0 }, { maxBatches: 10001 }, { batchSize: 1.5 }, { maxBatches: NaN }])('rejects invalid bounds %j without issuing SQL', async (options) => {
    const raw = vi.spyOn(Connection, 'raw');
    await expect(viewer.prune(now, options)).rejects.toThrow('Invalid log prune');
    expect(raw).not.toHaveBeenCalled();
  });

  it('validates the clock and cutoff, surfaces failures and participates in caller transactions', async () => {
    const raw = vi.spyOn(Connection, 'raw');
    await expect(viewer.prune(new Date('invalid'))).rejects.toThrow('Invalid retention clock');
    await expect(viewer.prune(new Date(-8_640_000_000_000_000))).rejects.toThrow('Invalid retention cutoff');
    expect(raw).not.toHaveBeenCalled();
    await viewer.addEntry(entry('expired', {}, '2026-11-22T11:00:00.000Z'));
    await expect(Connection.transaction(async () => { expect(await viewer.prune(now)).toBe(1); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await viewer.query()).toHaveLength(1);
    raw.mockRejectedValueOnce(new Error('delete failed'));
    await expect(viewer.prune(now)).rejects.toThrow('delete failed');
  });

  it.each(['postgres', 'mysql'] as const)('emits one portable derived-subquery delete with configured connection for %s', async (driver) => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    const raw = vi.spyOn(Connection, 'raw').mockResolvedValue(driver === 'postgres' ? { count: 2 } : { affectedRows: 2 });
    viewer.configure({ driver: 'database', connection: 'logs', retentionSeconds: 60 });
    expect(await viewer.prune(now, { batchSize: 2, maxBatches: 1 })).toBe(2);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw.mock.calls[0][0]).toContain('AS svelar_log_prune_batch)');
    expect(raw.mock.calls[0][0]).toContain('LIMIT 2');
    expect(raw.mock.calls[0][1]).toEqual(['2026-11-22T11:59:00.000Z']);
    expect(raw.mock.calls[0][2]).toBe('logs');
  });
});
