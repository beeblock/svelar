import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection';
import { CreateWebhookInboxEntriesTable, ScopeWebhookInboxIdempotency, svelarCoreMigrations } from '../src/database/CoreMigrations';
import { QueryBuilder } from '../src/orm/QueryBuilder';
import { WebhookInbox, WebhookSignatureError } from '../src/webhooks';
import { webhookInboxDeduplicationKey } from '../src/webhooks/InboxIdentity';

const tableName = 'webhook_inbox_entries';
let tempRoot: string | undefined;

async function useDatabase(upgrade = true): Promise<void> {
  tempRoot = await mkdtemp(join(tmpdir(), 'svelar-inbox-isolation-'));
  Connection.configure({
    default: 'sqlite',
    connections: { sqlite: { driver: 'sqlite', filename: join(tempRoot, 'inbox.sqlite') } },
  });
  await new CreateWebhookInboxEntriesTable().up();
  if (upgrade) await new ScopeWebhookInboxIdempotency().up();
  WebhookInbox.configure({ driver: 'database', table: tableName, redactedHeaders: [] });
}

function legacyRow(id: string, tenantId: string | number | null, key = `key-${id}`): Record<string, unknown> {
  return {
    id, source: 'provider', event: 'legacy.event', tenant_id: tenantId, actor_id: 'actor-7',
    idempotency_key: key, digest: 'legacy-digest', status: 'failed',
    headers: '{"content-type":"application/json"}', raw_body: `{"legacy":"${id}"}`,
    payload: `{"legacy":"${id}"}`, metadata: '{"custom":true}', attempts: 3,
    available_at: 123, processed_at: null, error: 'original failure', created_at: 100, updated_at: 200,
  };
}

async function indexNames(): Promise<string[]> {
  const rows = await Connection.raw(`PRAGMA index_list('${tableName}')`);
  return rows.map((row: { name: string }) => row.name).sort();
}

async function hasDeduplicationColumn(): Promise<boolean> {
  const rows = await Connection.raw(`PRAGMA table_info('${tableName}')`);
  return rows.some((row: { name: string }) => row.name === 'deduplication_key');
}

afterEach(async () => {
  vi.restoreAllMocks();
  WebhookInbox.clear();
  WebhookInbox.configure({ driver: 'memory', table: tableName, redactedHeaders: [] });
  await Connection.disconnect();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('Webhook inbox canonical identity', () => {
  it('hashes the JSON scope tuple without changing the visible provider key', () => {
    const expected = createHash('sha256').update(JSON.stringify(['provider', '42', 'evt:1'])).digest('hex');
    expect(webhookInboxDeduplicationKey('provider', 42, 'evt:1')).toBe(expected);
    expect(webhookInboxDeduplicationKey('provider', '42', 'evt:1')).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
    expect(webhookInboxDeduplicationKey('provider', null, 'evt:1'))
      .toBe(webhookInboxDeduplicationKey('provider', undefined, 'evt:1'));
  });

  it('keeps global, literal null, empty string, source and delimiter-containing scopes distinct', () => {
    const keys = [
      webhookInboxDeduplicationKey('provider', null, 'evt'),
      webhookInboxDeduplicationKey('provider', 'null', 'evt'),
      webhookInboxDeduplicationKey('provider', '', 'evt'),
      webhookInboxDeduplicationKey('other', null, 'evt'),
      webhookInboxDeduplicationKey('a:b', 'c', 'd'),
      webhookInboxDeduplicationKey('a', 'b:c', 'd'),
      webhookInboxDeduplicationKey('a', 'b', 'c:d'),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe.each(['memory', 'database'] as const)('Webhook inbox isolation (%s)', (driver) => {
  beforeEach(async () => {
    await Connection.disconnect();
    WebhookInbox.clear();
    WebhookInbox.configure({ driver: 'memory', table: tableName, redactedHeaders: [] });
    if (driver === 'database') await useDatabase();
  });

  it('captures a single winner after concurrent asynchronous verification', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let remaining = 16;
    const results = await Promise.all(Array.from({ length: remaining }, (_, i) => WebhookInbox.receive({
      source: ' provider ', tenantId: i % 2 ? 42 : '42', idempotencyKey: 'evt-1',
      rawBody: JSON.stringify({ candidate: i }), metadata: { candidate: i },
      verifier: async () => {
        if (--remaining === 0) release();
        await gate;
        return true;
      },
    })));
    const winners = results.filter((result) => !result.duplicate);
    expect(winners).toHaveLength(1);
    expect(new Set(results.map((result) => result.entry.id)).size).toBe(1);
    for (const result of results) expect(result.entry).toEqual(winners[0].entry);
    expect(winners[0].entry).toMatchObject({ source: 'provider', tenantId: '42', idempotencyKey: 'evt-1' });
    expect(await WebhookInbox.list()).toHaveLength(1);
  });

  it('isolates an identical provider key across three tenants without returning another payload', async () => {
    const results = await Promise.all(['alpha', 'beta', 'gamma'].flatMap((tenantId) =>
      Array.from({ length: 4 }, () => WebhookInbox.receive({
        source: 'provider', tenantId, idempotencyKey: 'same-visible-key',
        rawBody: JSON.stringify({ tenantId }), verifier: async () => true,
      }))));
    expect(results.filter((result) => !result.duplicate)).toHaveLength(3);
    expect(new Set(results.map((result) => result.entry.id)).size).toBe(3);
    for (const result of results) {
      expect(result.entry.payload).toEqual({ tenantId: result.entry.tenantId });
      expect(result.entry.idempotencyKey).toBe('same-visible-key');
    }
    expect(await WebhookInbox.list()).toHaveLength(3);
  });

  it('arbitrates the global null/undefined namespace independently of a literal null tenant', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => WebhookInbox.receive({
      source: 'provider', tenantId: i % 2 ? null : undefined,
      idempotencyKey: 'global-event', rawBody: JSON.stringify({ candidate: i }),
    })));
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(new Set(results.map((result) => result.entry.id)).size).toBe(1);
    expect(results[0].entry.tenantId).toBeUndefined();
    const scoped = await WebhookInbox.receive({
      source: 'provider', tenantId: 'null', idempotencyKey: 'global-event', rawBody: '{"scoped":true}',
    });
    expect(scoped.duplicate).toBe(false);
    expect(scoped.entry.id).not.toBe(results[0].entry.id);
    expect(await WebhookInbox.list()).toHaveLength(2);
  });

  it('verifies even a duplicate and never captures an invalid signature in another tenant', async () => {
    const rawBody = '{"signed":true}';
    const secret = 'test-inbox-secret';
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
    const verifier = WebhookInbox.hmacVerifier(secret);
    const first = await WebhookInbox.receive({
      source: 'provider', tenantId: 'trusted', idempotencyKey: 'signed-event', rawBody,
      headers: { 'x-webhook-signature': signature }, verifier,
    });
    for (const tenantId of ['trusted', 'forged']) {
      await expect(WebhookInbox.receive({
        source: 'provider', tenantId, idempotencyKey: 'signed-event', rawBody,
        headers: { 'x-webhook-signature': 'bad-signature' }, verifier,
      })).rejects.toBeInstanceOf(WebhookSignatureError);
    }
    expect(await WebhookInbox.list()).toEqual([first.entry]);
  });

  it('does not infer tenant identity from untrusted headers or payload', async () => {
    const result = await WebhookInbox.receive({
      source: 'provider', tenantId: 'server-resolved', idempotencyKey: 'evt',
      headers: { 'x-tenant-id': 'victim' }, rawBody: '{"tenantId":"victim"}',
    });
    const victim = await WebhookInbox.receive({
      source: 'provider', tenantId: 'victim', idempotencyKey: 'evt', rawBody: '{"actualVictim":true}',
    });
    expect(result.entry.tenantId).toBe('server-resolved');
    expect(victim.duplicate).toBe(false);
    expect(victim.entry.payload).toEqual({ actualVictim: true });
  });

  it('snapshots scope and body before an asynchronous verifier yields', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const input = {
      source: 'provider', tenantId: 'original', idempotencyKey: 'original-key', rawBody: '{"original":true}',
      verifier: async () => { await gate; return true; },
    };
    const pending = WebhookInbox.receive(input);
    input.tenantId = 'forged';
    input.idempotencyKey = 'forged-key';
    input.rawBody = '{"forged":true}';
    release();
    expect((await pending).entry).toMatchObject({
      tenantId: 'original', idempotencyKey: 'original-key', rawBody: '{"original":true}',
    });
  });

  it.each([NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe numeric tenant identity %s', async (tenantId) => {
    await expect(WebhookInbox.receive({ source: 'provider', tenantId, rawBody: '{}' })).rejects.toThrow('tenantId');
    expect(await WebhookInbox.list()).toHaveLength(0);
  });

  it('rejects object tenant spoofing rather than coercing it into an existing scope', async () => {
    const input = { source: 'provider', tenantId: 'victim', rawBody: '{}' };
    Reflect.set(input, 'tenantId', { toString: () => 'victim' });
    await expect(WebhookInbox.receive(input)).rejects.toThrow('tenantId');
    expect(await WebhookInbox.list()).toHaveLength(0);
  });
});

describe('Webhook inbox database arbitration', () => {
  beforeEach(async () => { await useDatabase(); });

  it.each(['23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_UNIQUE'])('recovers only an exact-scope winner for %s', async (code) => {
    const input = { source: 'provider', tenantId: 'one', idempotencyKey: 'evt', rawBody: '{"winner":true}' };
    const first = await WebhookInbox.receive(input);
    vi.spyOn(QueryBuilder.prototype, 'insert').mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code }));
    const duplicate = await WebhookInbox.receive({ ...input, rawBody: '{"loser":true}' });
    expect(duplicate).toEqual({ entry: first.entry, duplicate: true });
  });

  it.each(['SQLITE_IOERR', 'SQLITE_BUSY', 'SQLITE_CONSTRAINT_PRIMARYKEY', 'EIO'])('propagates %s even if a winner exists', async (code) => {
    const input = { source: 'provider', tenantId: 'one', idempotencyKey: 'evt', rawBody: '{}' };
    await WebhookInbox.receive(input);
    const error = Object.assign(new Error('storage failure'), { code });
    vi.spyOn(QueryBuilder.prototype, 'insert').mockRejectedValueOnce(error);
    const lookup = vi.spyOn(QueryBuilder.prototype, 'first');
    await expect(WebhookInbox.receive(input)).rejects.toBe(error);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rethrows a unique error with no exact-scope winner', async () => {
    await WebhookInbox.receive({ source: 'provider', tenantId: 'other', idempotencyKey: 'evt', rawBody: '{"private":true}' });
    const error = Object.assign(new Error('unrelated unique violation'), { code: '23505' });
    vi.spyOn(QueryBuilder.prototype, 'insert').mockRejectedValueOnce(error);
    await expect(WebhookInbox.receive({ source: 'provider', tenantId: 'requester', idempotencyKey: 'evt', rawBody: '{}' }))
      .rejects.toBe(error);
  });

  it('does not leak another tenant when a persisted hash has been corrupted', async () => {
    const other = await WebhookInbox.receive({ source: 'provider', tenantId: 'other', idempotencyKey: 'evt', rawBody: '{"private":true}' });
    await new QueryBuilder(tableName).where('id', other.entry.id).update({
      deduplication_key: webhookInboxDeduplicationKey('provider', 'requester', 'evt'),
    });
    await expect(WebhookInbox.receive({ source: 'provider', tenantId: 'requester', idempotencyKey: 'evt', rawBody: '{}' }))
      .rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
    expect(await WebhookInbox.list()).toHaveLength(1);
  });

  it('keeps the arbitration key stable through status updates', async () => {
    const input = { source: 'provider', tenantId: 42, idempotencyKey: 'evt', rawBody: '{}' };
    const first = await WebhookInbox.receive(input);
    await WebhookInbox.markProcessed(first.entry.id);
    expect(await WebhookInbox.receive({ ...input, tenantId: '42' }))
      .toMatchObject({ duplicate: true, entry: { id: first.entry.id, status: 'processed' } });
  });
});

describe('Webhook inbox additive migration', () => {
  beforeEach(async () => { await useDatabase(false); });

  it('registers a new upgrade migration without changing the legacy create migration', () => {
    const migration = svelarCoreMigrations().find((entry) => entry.name === '00000000_000034_scope_webhook_inbox_idempotency');
    expect(migration?.migration).toBeInstanceOf(ScopeWebhookInboxIdempotency);
  });

  it('backfills multiple ORM chunks while preserving every original column and record', async () => {
    await Connection.transaction(async () => {
      for (let i = 0; i < 503; i++) {
        await new QueryBuilder(tableName).insert(legacyRow(String(i).padStart(4, '0'), i % 3 ? '42' : null));
      }
    });
    const original = await new QueryBuilder<Record<string, unknown>>(tableName).orderBy('id').get();
    expect(await hasDeduplicationColumn()).toBe(false);
    await new ScopeWebhookInboxIdempotency().up();
    const upgraded = await new QueryBuilder<Record<string, unknown>>(tableName).orderBy('id').get();
    expect(upgraded).toHaveLength(503);
    for (let i = 0; i < upgraded.length; i++) {
      const { deduplication_key, ...retained } = upgraded[i];
      expect(retained).toEqual(original[i]);
      expect(deduplication_key).toBe(webhookInboxDeduplicationKey('provider', i % 3 ? '42' : null, `key-${String(i).padStart(4, '0')}`));
    }
    expect(await indexNames()).toContain('idx_webhook_inbox_deduplication');
    expect(await indexNames()).not.toContain('idx_webhook_inbox_source_idempotency');
    const duplicate = await WebhookInbox.receive({ source: 'provider', tenantId: 42, idempotencyKey: 'key-0001', rawBody: '{"replacement":true}' });
    expect(duplicate).toMatchObject({ duplicate: true, entry: { id: '0001', rawBody: '{"legacy":"0001"}' } });
    const differentTenant = await WebhookInbox.receive({ source: 'provider', tenantId: 'different', idempotencyKey: 'key-0001', rawBody: '{"new":true}' });
    expect(differentTenant.duplicate).toBe(false);
  });

  it('rolls back a failed backfill without changing old records or constraints on SQLite', async () => {
    await new QueryBuilder(tableName).insert(legacyRow('old', null));
    const original = await new QueryBuilder(tableName).get();
    const failure = new Error('backfill disk failure');
    vi.spyOn(QueryBuilder.prototype, 'update').mockRejectedValueOnce(failure);
    await expect(new ScopeWebhookInboxIdempotency().up()).rejects.toBe(failure);
    expect(await hasDeduplicationColumn()).toBe(false);
    expect(await new QueryBuilder(tableName).get()).toEqual(original);
    expect(await indexNames()).toContain('idx_webhook_inbox_source_idempotency');
  });

  it('restores the old constraint and original records on a safe rollback', async () => {
    await new QueryBuilder(tableName).insert(legacyRow('old', null));
    const original = await new QueryBuilder(tableName).get();
    const migration = new ScopeWebhookInboxIdempotency();
    await migration.up();
    await migration.down();
    expect(await new QueryBuilder(tableName).get()).toEqual(original);
    expect(await hasDeduplicationColumn()).toBe(false);
    expect(await indexNames()).toContain('idx_webhook_inbox_source_idempotency');
  });

  it('refuses rollback before any schema or data change when tenants share a source/key', async () => {
    const migration = new ScopeWebhookInboxIdempotency();
    await migration.up();
    for (const tenantId of [null, 'one', 'two']) {
      await WebhookInbox.receive({ source: 'provider', tenantId, idempotencyKey: 'shared', rawBody: JSON.stringify({ tenantId }) });
    }
    const original = await new QueryBuilder(tableName).orderBy('id').get();
    const indices = await indexNames();
    await expect(migration.down()).rejects.toThrow('Cannot roll back tenant-scoped webhook idempotency');
    expect(await new QueryBuilder(tableName).orderBy('id').get()).toEqual(original);
    expect(await indexNames()).toEqual(indices);
    expect(await hasDeduplicationColumn()).toBe(true);
  });
});
