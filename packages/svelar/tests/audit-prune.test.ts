import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Audit } from '../src/audit/index.js';
import { Connection } from '../src/database/Connection.js';
import { CreateAuditLogsTable } from '../src/database/CoreMigrations.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

const maximumDate = 8_640_000_000_000_000;
async function record(timestamp: number, action: string) {
  vi.spyOn(Date, 'now').mockReturnValue(timestamp);
  await Audit.log({ userId: null, action, modelType: 'RetentionFixture', modelId: action });
}
beforeEach(async () => {
  await Connection.disconnect();
  Audit.configure({ driver: 'memory', enabled: true, table: 'audit_logs', exclude: [] });
  await Audit.pruneBefore(maximumDate);
});
afterEach(async () => {
  Audit.configure({ driver: 'memory', enabled: true }); await Audit.pruneBefore(maximumDate);
  await Connection.disconnect(); vi.restoreAllMocks();
});

describe('Public audit retention', () => {
  it.each([new Date(1000), '1970-01-01T00:00:01.000Z', 1000])('accurately prunes memory strictly before %s and retains the exact boundary', async cutoff => {
    await record(0, 'expired'); await record(1000, 'boundary'); await record(2000, 'recent');
    expect(await Audit.pruneBefore(cutoff)).toBe(1);
    expect((await Audit.query({})).map(entry => entry.action)).toEqual(['recent', 'boundary']);
    expect(await Audit.pruneBefore(cutoff)).toBe(0);
    expect((await Audit.getStats()).total).toBe(2);
  });

  it('accepts the Unix epoch cutoff without truthiness coercion', async () => {
    await record(-1, 'before-epoch'); await record(0, 'epoch');
    expect(await Audit.pruneBefore(0)).toBe(1);
    expect((await Audit.query({}))[0].timestamp).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, new Date('invalid'), 'invalid', '', ' ', maximumDate + 1,
    null, undefined, false, {}, [], 1n])('rejects invalid cutoff %s before any database operation', async cutoff => {
    Audit.configure({ driver: 'database' }); const raw = vi.spyOn(Connection, 'raw');
    await expect(Audit.pruneBefore(cutoff as Date | string | number)).rejects.toThrow(/cutoff/);
    expect(raw).not.toHaveBeenCalled();
  });

  it('prunes only the configured table through the ORM and propagates missing-table failures', async () => {
    Connection.configure({ default: 'test', connections: { test: { driver: 'sqlite', filename: ':memory:' } } });
    await new CreateAuditLogsTable().up();
    await new Schema().renameTable('audit_logs', 'custom_audit');
    await new Schema().createTable('audit_logs', table => { table.string('id').primary(); table.bigInteger('timestamp'); });
    await new QueryBuilder('audit_logs').insert({ id: 'untouched-default', timestamp: 0 });
    Audit.configure({ driver: 'database', table: 'custom_audit' });
    await record(0, 'expired'); await record(1000, 'boundary');
    const raw = vi.spyOn(Connection, 'raw');
    expect(await Audit.pruneBefore(new Date(1000))).toBe(1);
    expect(await Audit.pruneBefore(1000)).toBe(0);
    expect((await Audit.query({})).map(entry => entry.action)).toEqual(['boundary']);
    expect(await new QueryBuilder('audit_logs').count()).toBe(1);
    expect(raw.mock.calls.some(([sql]) => /\b(CREATE|DROP|ALTER)\b/i.test(sql))).toBe(false);
    Audit.configure({ driver: 'database', table: 'missing_audit' });
    await expect(Audit.pruneBefore(1000)).rejects.toThrow('missing_audit');
    Audit.configure({ driver: 'database', table: 'invalid;table' });
    await expect(Audit.pruneBefore(1000)).rejects.toThrow('Audit table name');
  });

  it('participates in an existing database transaction and preserves rows on rollback', async () => {
    Connection.configure({ default: 'test', connections: { test: { driver: 'sqlite', filename: ':memory:' } } });
    await new CreateAuditLogsTable().up(); Audit.configure({ driver: 'database', table: 'audit_logs' });
    await record(0, 'expired');
    const failure = new Error('rollback retention');
    await expect(Connection.transaction(async () => {
      expect(await Audit.pruneBefore(1)).toBe(1); expect(await Audit.query({})).toHaveLength(0); throw failure;
    })).rejects.toBe(failure);
    expect(await Audit.query({})).toHaveLength(1);
  });

  it('does not erase committed memory history when an enclosing transaction rolls back', async () => {
    Connection.configure({ default: 'test', connections: { test: { driver: 'sqlite', filename: ':memory:' } } });
    await record(0, 'expired'); const failure = new Error('rollback memory retention');
    await expect(Connection.transaction(async () => { expect(await Audit.pruneBefore(1)).toBe(1); throw failure; })).rejects.toBe(failure);
    expect(await Audit.query({})).toHaveLength(1);
    await Connection.transaction(async () => { expect(await Audit.pruneBefore(1)).toBe(1); });
    expect(await Audit.query({})).toHaveLength(0);
  });

  it('rejects external log-driver purging instead of claiming a successful zero-row cleanup', async () => {
    Audit.configure({ driver: 'log' }); const output = vi.spyOn(console, 'log'); const raw = vi.spyOn(Connection, 'raw');
    await expect(Audit.pruneBefore(1000)).rejects.toThrow('unsupported by the log driver');
    expect(output).not.toHaveBeenCalled(); expect(raw).not.toHaveBeenCalled();
  });
});
