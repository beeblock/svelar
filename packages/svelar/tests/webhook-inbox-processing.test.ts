import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Connection } from '../src/database/Connection.js';
import { CreateWebhookInboxEntriesTable, ScopeWebhookInboxIdempotency, AddWebhookInboxProcessing } from '../src/database/CoreMigrations.js';
import { WebhookInbox, IncomingWebhookController, type IncomingWebhookSource } from '../src/webhooks/index.js';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Queue } from '../src/queue/index.js';
import { ApplicationContext } from '../src/support/Context.js';

const source = 'signed-integration';
const secret = 'fixture-only-signing-secret';
let handled: any[];
const rows = () => new QueryBuilder('webhook_inbox_entries');
function definition(extra: Partial<IncomingWebhookSource> = {}): IncomingWebhookSource {
  return { verifier: WebhookInbox.hmacVerifier(secret), resolveTenant: (payload: any) => payload.tenant,
    handler: async (entry) => { handled.push(entry); }, idempotencyKey: (payload: any) => payload.event_id,
    orderingKey: (payload: any) => payload.resource, version: (payload: any) => payload.version, ...extra };
}
function request(payload: any, signature?: string): Request {
  const raw = JSON.stringify(payload);
  return new Request('https://app.test/api/webhooks/incoming/' + source, { method: 'POST', body: raw,
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signature ?? createHmac('sha256', secret).update(raw).digest('hex') } });
}
const payload = (id: string, version = 1) => ({ event_id: id, resource: 'resource-1', tenant: 'tenant-1', version, password: 'hidden' });

beforeEach(async () => {
  Connection.configure({ default: 'default', connections: { default: { driver: 'sqlite', filename: ':memory:' } } });
  await new CreateWebhookInboxEntriesTable().up(); await new ScopeWebhookInboxIdempotency().up(); await new AddWebhookInboxProcessing().up();
  WebhookInbox.configure({ driver: 'database', table: 'webhook_inbox_entries' });
  Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
  handled = []; WebhookInbox.registerSource(source, definition());
});
afterEach(async () => { vi.restoreAllMocks(); await Connection.disconnect(); ApplicationContext.clear(); });

describe('Durable incoming webhook processing', () => {
  it('rejects ambiguous source names and unsafe numeric configuration', () => {
    expect(() => WebhookInbox.registerSource(' spaced ', definition())).toThrow('Invalid incoming webhook source');
    expect(() => WebhookInbox.registerSource('provider', definition({ maxBodyBytes: 16_777_217 }))).toThrow('Invalid webhook maxBodyBytes');
    expect(() => WebhookInbox.registerSource('provider', definition({ maxAttempts: 1001 }))).toThrow('Invalid webhook maxAttempts');
    expect(() => WebhookInbox.registerSource('provider', definition({ leaseSeconds: Number.MAX_SAFE_INTEGER }))).toThrow('Invalid webhook leaseSeconds');
  });

  it('keeps a failed receipt deduplicated while it is awaiting retry, even after the window', async () => {
    WebhookInbox.registerSource(source, definition({ deduplicationWindowSeconds: 1, handler: async () => { throw new Error('retry later'); } }));
    const first = await WebhookInbox.capture(source, request(payload('pending-retry')));
    expect((await WebhookInbox.process(source)).failed).toBe(1);
    await rows().where('id', first.entry.id).update({ created_at: Date.now() - 10_000 });
    const duplicate = await WebhookInbox.capture(source, request(payload('pending-retry')));
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.entry.id).toBe(first.entry.id);
    expect(await rows().count()).toBe(1);
  });

  it('captures once, acknowledges before handlers run and restores tenant/actor only at processing', async () => {
    WebhookInbox.registerSource(source, definition({ actorId: 'integration-actor' }));
    const captured = await WebhookInbox.capture(source, request(payload('one')));
    expect(captured.duplicate).toBe(false); expect(handled).toEqual([]);
    expect((await WebhookInbox.capture(source, request(payload('one')))).duplicate).toBe(true);
    WebhookInbox.registerSource(source, definition({ actorId: 'integration-actor', handler: async (entry) => {
      expect(ApplicationContext.get('teamId')).toBe('tenant-1'); expect(ApplicationContext.get('actorId')).toBe('integration-actor'); handled.push(entry);
    } }));
    await ApplicationContext.run({ teamId: 'unrelated', actorId: 'other-user' }, async () => {
      expect(await WebhookInbox.process(source)).toEqual({ processed: 1, failed: 0, ignored: 0 });
    });
    expect(handled).toHaveLength(1);
    expect(await WebhookInbox.stats(source)).toMatchObject({ byStatus: { processed: 1 } });
  });

  it('rejects invalid signatures, unknown tenants, oversized bodies and unknown sources before storage', async () => {
    await expect(WebhookInbox.capture(source, request(payload('bad'), 'forged'))).rejects.toMatchObject({ status: 401 });
    await expect(WebhookInbox.capture(source, request({ ...payload('missing'), tenant: null }))).rejects.toMatchObject({ status: 403 });
    WebhookInbox.registerSource(source, definition({ maxBodyBytes: 2 }));
    await expect(WebhookInbox.capture(source, request(payload('large')))).rejects.toMatchObject({ status: 413 });
    await expect(WebhookInbox.capture('not-registered', request(payload('unknown')))).rejects.toMatchObject({ status: 404 });
    expect(await rows().count()).toBe(0);
  });

  it('discards transactional receipt and queued publication on rollback', async () => {
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    const dispatch = vi.spyOn(Queue, 'dispatch');
    await expect(Connection.transaction(async () => {
      await WebhookInbox.capture(source, request(payload('rolled-back')));
      expect(dispatch).not.toHaveBeenCalled(); throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await rows().count()).toBe(0); expect(dispatch).not.toHaveBeenCalled();
  });

  it('orders versions and ignores an older replay without repeating handler work', async () => {
    await WebhookInbox.capture(source, request(payload('newer', 3)));
    await WebhookInbox.capture(source, request(payload('older', 2)));
    expect((await WebhookInbox.process(source)).processed).toBe(2);
    expect(handled.map((entry) => entry.payload.version)).toEqual([2, 3]);
    await WebhookInbox.capture(source, request(payload('stale', 1)));
    expect((await WebhookInbox.process(source)).ignored).toBe(1);
    expect(handled).toHaveLength(2);
  });

  it('coalesces waiting versions while retaining their receipt history', async () => {
    WebhookInbox.registerSource(source, definition({ coalesce: true }));
    await WebhookInbox.capture(source, request(payload('one', 1))); await WebhookInbox.capture(source, request(payload('two', 2)));
    expect(await WebhookInbox.process(source)).toEqual({ processed: 1, failed: 0, ignored: 1 });
    expect(handled[0].payload.version).toBe(2); expect(await rows().count()).toBe(2);
  });

  it('normalizes tenant identifiers before coalescing and safely ignores a blocking DLQ entry', async () => {
    WebhookInbox.registerSource(source, definition({ coalesce: true }));
    await WebhookInbox.capture(source, request({ ...payload('numeric-tenant', 1), tenant: 42 }));
    await WebhookInbox.capture(source, request({ ...payload('string-tenant', 2), tenant: '42' }));
    expect(await WebhookInbox.process(source)).toEqual({ processed: 1, failed: 0, ignored: 1 });
    expect(handled[0].payload.version).toBe(2);
    WebhookInbox.registerSource(source, definition({ maxAttempts: 1, handler: async (entry) => {
      if (entry.payload.version === 3) throw new Error('manual review'); handled.push(entry);
    } }));
    const blocked = await WebhookInbox.capture(source, request({ ...payload('blocking', 3), tenant: 42 }));
    await WebhookInbox.capture(source, request({ ...payload('after-blocked', 4), tenant: '42' }));
    expect((await WebhookInbox.process(source)).failed).toBe(1);
    expect((await WebhookInbox.process(source)).processed).toBe(0);
    expect(await WebhookInbox.ignore(blocked.entry.id, 'Reviewed by authorized operator')).toMatchObject({ status: 'ignored' });
    expect((await WebhookInbox.process(source)).processed).toBe(1);
  });

  it('requires the configured HMAC algorithm prefix instead of accepting a mislabeled digest', async () => {
    const raw = JSON.stringify(payload('prefix'));
    const digest = createHmac('sha256', secret).update(raw).digest('hex');
    const verifier = WebhookInbox.hmacVerifier(secret, { prefix: 'sha256' });
    expect(await verifier({ source, rawBody: raw, headers: { 'x-webhook-signature': `sha256=${digest}` } })).toBe(true);
    expect(await verifier({ source, rawBody: raw, headers: { 'x-webhook-signature': `sha1=${digest}` } })).toBe(false);
  });

  it('retains failed attempts for DLQ/replay and recovers expired owners', async () => {
    WebhookInbox.registerSource(source, definition({ maxAttempts: 1, handler: async () => { throw new Error('password=hidden provider failed'); } }));
    const captured = await WebhookInbox.capture(source, request(payload('retry')));
    expect((await WebhookInbox.process(source)).failed).toBe(1);
    expect((await rows().first()).available_at).toBeNull();
    expect((await rows().first()).error).not.toContain('hidden');
    WebhookInbox.registerSource(source, definition());
    await WebhookInbox.replay(captured.entry.id);
    await rows().where('id', captured.entry.id).update({ status: 'processing', lock_owner: 'killed-worker', locked_until: Date.now() - 1 });
    expect((await WebhookInbox.process(source)).processed).toBe(1);
    expect((await rows().first()).lock_owner).toBeNull();
  });

  it('preserves durable capture when Redis publication fails', async () => {
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(Queue, 'dispatch').mockRejectedValue(new Error('Redis unavailable'));
    await expect(WebhookInbox.capture(source, request(payload('durable')))).resolves.toMatchObject({ duplicate: false });
    expect((await WebhookInbox.process(source)).processed).toBe(1);
  });

  it('redacts terminal payloads, performs reconciliation and prunes only terminal receipts', async () => {
    const reconcile = vi.fn(async () => {});
    WebhookInbox.registerSource(source, definition({ redactAfterProcessing: ['password'], reconcile }));
    await WebhookInbox.capture(source, request(payload('redact'))); await WebhookInbox.process(source);
    const row = await rows().first(); expect(row.payload).not.toContain('hidden'); expect(row.raw_body).not.toContain('hidden');
    await WebhookInbox.reconcile(source); expect(reconcile).toHaveBeenCalledOnce();
    await WebhookInbox.capture(source, request(payload('pending', 2)));
    expect(await WebhookInbox.prune(Date.now() + 1)).toBe(1); expect(await rows().count()).toBe(1);
  });

  it('verifies exact binary bytes, preserves them and rejects malformed signature suffixes', async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x80]);
    const signature = createHmac('sha256', secret).update(bytes).digest('hex');
    const captured = await WebhookInbox.receive({ source, tenantId: 'tenant-1', rawBody: bytes,
      headers: { 'x-webhook-signature': signature }, verifier: WebhookInbox.hmacVerifier(secret) });
    expect(captured.entry.rawBodyEncoding).toBe('base64');
    expect(WebhookInbox.bodyBytes((await WebhookInbox.find(captured.entry.id))!)).toEqual(bytes);
    expect(WebhookInbox.verifyHmac(bytes, { 'x-webhook-signature': signature + 'garbage' }, secret)).toBe(false);
  });

  it('applies an exact deduplication window only after a terminal receipt, retaining history', async () => {
    WebhookInbox.registerSource(source, definition({ deduplicationWindowSeconds: 60 }));
    const first = await WebhookInbox.capture(source, request(payload('reusable', 1)));
    expect((await WebhookInbox.capture(source, request(payload('reusable', 1)))).duplicate).toBe(true);
    await WebhookInbox.process(source);
    await rows().where('id', first.entry.id).update({ created_at: Date.now() - 60_001 });
    const next = await WebhookInbox.capture(source, request(payload('reusable', 2)));
    expect(next.duplicate).toBe(false); expect(next.entry.id).not.toBe(first.entry.id);
    expect(await rows().count()).toBe(2);
    await expect(WebhookInbox.replay(first.entry.id)).resolves.not.toBeNull();
  });

  it.each([200, 202, 204] as const)('uses the controller/request/DTO/action/resource flow with ack=%s', async (status) => {
    WebhookInbox.registerSource(source, definition({ ackStatus: status }));
    const incoming = request(payload('http-' + status));
    const event = { request: incoming, url: new URL(incoming.url), params: { source }, locals: {}, cookies: {}, platform: {}, getClientAddress: () => '127.0.0.1' } as any;
    const response = await new IncomingWebhookController().handle('receive')(event);
    expect(response.status).toBe(status); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.text();
    if (status === 204) expect(body).toBe('');
    else { const result = JSON.parse(body); expect(result.data).toMatchObject({ status: 'received', duplicate: false }); expect(result.meta).toEqual({}); expect(body).not.toContain('hidden'); }
    expect(handled).toEqual([]);
    expect(NewCommandTemplates.apiIncomingWebhooks()).toContain("controller.handle('receive')");
  });

  it('returns a signature rejection rather than generic 500 or successful acknowledgement', async () => {
    const incoming = request(payload('invalid-http'), 'forged');
    const event = { request: incoming, url: new URL(incoming.url), params: { source }, locals: {}, cookies: {}, platform: {}, getClientAddress: () => '127.0.0.1' } as any;
    const response = await new IncomingWebhookController().handle('receive')(event);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ data: null, meta: { message: 'Invalid webhook signature.' } });
    expect(await rows().count()).toBe(0);
  });
});
