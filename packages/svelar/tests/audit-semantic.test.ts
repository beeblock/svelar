import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Audit, auditable } from '../src/audit/index.js';
import { Connection } from '../src/database/Connection.js';
import { CreateAuditLogsTable } from '../src/database/CoreMigrations.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Model } from '../src/orm/Model.js';
import { ApplicationContext } from '../src/support/Context.js';

async function makeAuditedModel(tableName: string) {
  await new Schema().createTable(tableName, (table) => {
    table.increments('id'); table.string('title'); table.string('price'); table.text('settings');
    table.string('heartbeat').nullable(); table.timestamps(); table.softDeletes();
  });
  class AuditRow extends Model {
    static table = tableName;
    static softDeletes = true;
    static fillable = ['title', 'price', 'settings', 'heartbeat'];
    static casts = { price: 'decimal:3', settings: 'json' } as const;
  }
  return auditable(AuditRow, { ignore: ['heartbeat'], redact: ['settings.sessionId'] });
}

beforeEach(async () => {
  await Connection.disconnect();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
  await new CreateAuditLogsTable().up();
  Audit.configure({ driver: 'database', table: 'audit_logs', enabled: true, exclude: [], ignore: [], redact: [] });
  ApplicationContext.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  Audit.configure({ driver: 'memory', table: 'audit_logs', enabled: true, exclude: [], ignore: [], redact: [] });
  ApplicationContext.clear();
  await Connection.disconnect();
});

describe('Audit semantic Model lifecycle', () => {
  it('records create/update/delete/restore/forceDelete once with persisted before/after and actor context', async () => {
    const Row = await makeAuditedModel('audit_semantic_rows');
    await ApplicationContext.runIsolated({
      userId: 77, teamId: 'tenant-one', tenantId: 'tenant-one', actorId: 'erp-agent', actorType: 'service_account',
      serviceAccountId: 'erp', apiKeyId: 'key-one', ipAddress: '192.0.2.5', userAgent: 'ERP/1', correlationId: 'req-one',
    }, async () => {
      const row = await Row.create({ title: 'Draft', price: '400.000', settings: { nested: [{ token: 'secret' }] } });
      await row.update({ title: 'Published', price: '401' });
      expect(row.wasChanged('price')).toBe(true);
      await row.delete();
      await row.restore();
      await row.forceDelete();
    });
    const entries = await Audit.query({ modelType: 'AuditRow', limit: 20 });
    expect(entries.map((entry) => entry.action).sort()).toEqual(['created', 'updated', 'deleted', 'restored', 'forceDeleted'].sort());
    for (const entry of entries) expect(entry).toMatchObject({
      userId: '77', ipAddress: '192.0.2.5', userAgent: 'ERP/1', metadata: {
        teamId: 'tenant-one', tenantId: 'tenant-one', actorId: 'erp-agent', actorType: 'service_account',
        serviceAccountId: 'erp', apiKeyId: 'key-one', correlationId: 'req-one',
      },
    });
    expect(entries.find((entry) => entry.action === 'updated')).toMatchObject({
      oldValues: { title: 'Draft', price: '400.000' }, newValues: { title: 'Published', price: '401.000' },
    });
    expect(JSON.stringify(entries)).not.toContain('secret');
  });

  it('skips equivalent large decimals and updates containing only ignored timestamps/fields', async () => {
    const Row = await makeAuditedModel('audit_semantic_money');
    const row = await Row.create({ title: 'Stable', price: '9007199254740993.000', heartbeat: 'one', settings: { heartbeat: 'one', safe: 1 } });
    await row.update({ price: '9007199254740993', heartbeat: 'two', settings: { heartbeat: 'two', safe: 1 } });
    expect((await Audit.query({ modelType: 'AuditRow' })).map((entry) => entry.action)).toEqual(['created']);
    await row.update({ price: '9007199254740993.001' });
    expect((await Audit.query({ action: 'updated' }))[0]).toMatchObject({
      oldValues: { price: '9007199254740993.000' }, newValues: { price: '9007199254740993.001' },
    });
  });

  it('does not suppress a sensitive-only change just because both rendered values redact identically', async () => {
    const Row = await makeAuditedModel('audit_semantic_secret_changes');
    const row = await Row.create({ title: 'Stable', price: '1', settings: { sessionId: 'before', password: 'old' } });
    await row.update({ settings: { sessionId: 'after', password: 'new' } });
    const [entry] = await Audit.query({ action: 'updated' });
    expect(entry).toBeDefined();
    expect(entry.oldValues?.settings).toBe('{"sessionId":"[redacted]","password":"[redacted]"}');
    expect(entry.newValues?.settings).toBe(entry.oldValues?.settings);
  });

  it('keeps same-name Model constructors isolated and records each instance only once', async () => {
    const Left = await makeAuditedModel('audit_semantic_left');
    const Right = await makeAuditedModel('audit_semantic_right');
    await Left.create({ title: 'Left', price: '1', settings: {} });
    await Right.create({ title: 'Right', price: '2', settings: {} });
    const entries = await Audit.query({ action: 'created', modelType: 'AuditRow' });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.newValues?.title).sort()).toEqual(['Left', 'Right']);
  });

  it('restores force-delete tracking after a failed operation so a later ordinary delete is audited', async () => {
    const Row = await makeAuditedModel('audit_semantic_failed_force');
    const row = await Row.create({ title: 'Keep', price: '1', settings: {} });
    let fail = true;
    Row.observe({ forceDeleting() { if (fail) throw new Error('force-delete blocked'); } });
    await expect(row.forceDelete()).rejects.toThrow('force-delete blocked');
    fail = false;
    await row.delete();
    expect(await Audit.query({ action: 'deleted' })).toHaveLength(1);
    expect(await Audit.query({ action: 'forceDeleted' })).toHaveLength(0);
  });
});

describe('Audit sanitization and aggregation', () => {
  it('redacts recursive arrays, JSON strings, metadata and key variants without changing the caller input', async () => {
    const input = {
      nested: [{ password_hash: 'private-hash', Authorization: 'Bearer private-token', accessToken: 'private-access' }],
      json: '{"secret":"private-json","safe":true}', safe: 'visible', heartbeat: 'ignored',
    };
    Audit.configure({ driver: 'database', redact: ['customSecret'], ignore: ['heartbeat'] });
    await Audit.log({ userId: null, action: 'sanitize', modelType: 'SecretRow', modelId: 1,
      newValues: input, metadata: { customSecret: 'private-custom', nested: { cookie: 'private-cookie' } } });
    const [entry] = await Audit.query({ action: 'sanitize' });
    const stored = JSON.stringify(entry);
    for (const secret of ['private-hash', 'private-token', 'private-access', 'private-json', 'private-custom', 'private-cookie', 'ignored']) expect(stored).not.toContain(secret);
    expect(entry.newValues?.safe).toBe('visible');
    expect(input.nested[0].password_hash).toBe('private-hash');
    expect(input.heartbeat).toBe('ignored');
  });

  it('uses bounded database GROUP BY aggregates rather than loading audit rows', async () => {
    for (let i = 0; i < 12; i++) await Audit.log({ userId: i, action: i % 2 ? 'updated' : 'created', modelType: i % 3 ? 'Post' : 'User', modelId: i });
    const raw = vi.spyOn(Connection, 'raw');
    expect(await Audit.getStats()).toEqual({ total: 12, byAction: { created: 6, updated: 6 }, byModel: { Post: 8, User: 4 } });
    const selects = raw.mock.calls.map(([sql]) => sql).filter((sql) => /^SELECT/i.test(sql));
    expect(selects).toHaveLength(3);
    expect(selects.every((sql) => /COUNT\(/i.test(sql))).toBe(true);
    expect(selects.filter((sql) => /GROUP BY/i.test(sql))).toHaveLength(2);
  });

  it('supports an epoch-zero until filter', async () => {
    await Audit.log({ userId: null, action: 'recent', modelType: 'Epoch', modelId: 1 });
    expect(await Audit.query({ until: 0 })).toEqual([]);
  });

  it.each(['memory', 'log'] as const)('does not publish rolled-back %s audit events', async (driver) => {
    const marker = randomUUID();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    Audit.configure({ driver });
    await expect(Connection.transaction(async () => {
      await Audit.log({ userId: null, action: marker, modelType: 'Transaction', modelId: 1 });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await Audit.query({ action: marker })).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });
});
