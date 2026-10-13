import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../src/database/Connection';
import { CreateWebhookInboxEntriesTable, ScopeWebhookInboxIdempotency, AddWebhookInboxProcessing } from '../src/database/CoreMigrations';
import { Queue } from '../src/queue';
import { QueryBuilder } from '../src/orm/QueryBuilder';
import { ApplicationContext } from '../src/support/Context';
import { WebhookInbox, type WebhookInboxEntry } from '../src/webhooks';
import { IncomingWebhookError } from '../src/webhooks/InboxProcessor';
import { runWithContext } from '../src/testing/context';
import { WebhookInboxHarness, withWebhookInbox } from '../src/testing/inbox';

const SOURCE = 'test.inbox.acceptance';
const SECRET = 'test-only-inbox-secret';
let root: string;
let handler: ReturnType<typeof vi.fn<(entry: WebhookInboxEntry) => Promise<void>>>;

function request(payload: unknown, options: { signature?: string; rawBody?: string } = {}): Request {
  const body = options.rawBody ?? JSON.stringify(payload);
  const signature = options.signature ?? createHmac('sha256', SECRET).update(body).digest('hex');
  return new Request('http://localhost/webhooks/test', { method: 'POST', headers: { 'x-webhook-signature': signature, 'content-type': 'application/json' }, body });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'svelar-inbox-harness-'));
  await Connection.disconnect();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: join(root, 'inbox.sqlite') } } });
  await new CreateWebhookInboxEntriesTable().up();
  await new ScopeWebhookInboxIdempotency().up();
  await new AddWebhookInboxProcessing().up();
  Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
  WebhookInbox.configure({ driver: 'database' });
  handler = vi.fn(async () => {});
  WebhookInbox.registerSource(SOURCE, {
    verifier: WebhookInbox.hmacVerifier(SECRET),
    resolveTenant: (payload) => {
      const value = payload as { tenant?: string };
      return value.tenant ?? null;
    },
    idempotencyKey: (payload) => (payload as { id: string }).id,
    actorId: 'integration-actor',
    handler,
  });
});

afterEach(async () => {
  await Queue.stop();
  WebhookInbox.configure({ driver: 'memory' });
  WebhookInbox.clear();
  await Connection.disconnect();
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('real signed inbox acceptance harness', () => {
  it('accepts, persists, deduplicates and processes through the facade with isolated tenant/actor context', async () => {
    const seen: unknown[] = [];
    handler.mockImplementation(async () => { seen.push(ApplicationContext.snapshot()); });
    await runWithContext({ tenantId: 'caller-tenant', actorId: 'caller-actor', userId: 99 }, () => withWebhookInbox(WebhookInbox, async (harness) => {
      const payload = { tenant: 'signed-tenant', id: 'event-1', value: 3 };
      const receipt = await harness.capture(SOURCE, request(payload));
      expect(receipt.duplicate).toBe(false);
      await harness.assertStored(receipt.entry.id, { status: 'received', tenantId: 'signed-tenant', actorId: 'integration-actor' });
      const duplicate = await harness.capture(SOURCE, request(payload));
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.entry.id).toBe(receipt.entry.id);
      expect(await harness.process(SOURCE, 2)).toEqual({ processed: 1, failed: 0, ignored: 0 });
      await harness.assertStored(receipt.entry.id, { status: 'processed', tenantId: 'signed-tenant' });
      expect(harness.records()).toHaveLength(2);
      expect(ApplicationContext.get('actorId')).toBe('caller-actor');
    }));
    expect(handler).toHaveBeenCalledOnce();
    expect(seen[0]).toMatchObject({ teamId: 'signed-tenant', tenantId: 'signed-tenant', actorId: 'integration-actor', integration: SOURCE });
    expect((seen[0] as Record<string, unknown>).userId).toBeUndefined();
  });

  it('invalid or tampered signatures do not resolve a tenant, persist or run handlers', async () => {
    const resolveTenant = vi.fn(() => 'signed-tenant');
    WebhookInbox.registerSource(SOURCE, { verifier: WebhookInbox.hmacVerifier(SECRET), resolveTenant, handler });
    const signature = createHmac('sha256', SECRET).update('{"value":1}').digest('hex');
    await withWebhookInbox(WebhookInbox, async (harness) => {
      await expect(harness.capture(SOURCE, request({ value: 2 }, { signature }))).rejects.toMatchObject({ status: 401 });
      await expect(harness.capture(SOURCE, request(null, { rawBody: '{broken', signature: '00' }))).rejects.toMatchObject({ status: 401 });
      expect(await harness.process(SOURCE, 3)).toEqual({ processed: 0, failed: 0, ignored: 0 });
      expect(harness.records().every((record) => record.rejection instanceof IncomingWebhookError)).toBe(true);
    });
    expect(resolveTenant).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(await new QueryBuilder('webhook_inbox_entries').count()).toBe(0);
  });

  it('propagates distinct body and tenant validation failures to caller assertions', async () => {
    await withWebhookInbox(WebhookInbox, async (harness) => {
      await expect(harness.capture(SOURCE, request(null, { rawBody: '{broken' }))).rejects.toMatchObject({ status: 400 });
      await expect(harness.capture(SOURCE, request({ id: 'no-tenant' }))).rejects.toMatchObject({ status: 403 });
    });
  });

  it('refuses to manufacture durable acceptance with the memory driver', async () => {
    WebhookInbox.configure({ driver: 'memory' });
    await expect(withWebhookInbox(WebhookInbox, (harness) => harness.capture(SOURCE, request({ tenant: 'one', id: 'one' })))).rejects.toThrow('database');
    expect(handler).not.toHaveBeenCalled();
  });

  it('records failed processing truthfully and preserves the caller context', async () => {
    handler.mockImplementation(async () => { throw new Error('handler failure'); });
    await withWebhookInbox(WebhookInbox, async (harness) => {
      const receipt = await harness.capture(SOURCE, request({ tenant: 'one', id: 'failed' }));
      await ApplicationContext.runIsolated({ actorId: 'unrelated' }, async () => {
        expect(await harness.process(SOURCE, 1)).toEqual({ processed: 0, failed: 1, ignored: 0 });
        expect(ApplicationContext.get('actorId')).toBe('unrelated');
      });
      const entry = await harness.assertStored(receipt.entry.id, { status: 'failed' });
      expect(entry.attempts).toBe(1);
    });
  });

  it('requires scoped operations and restores callback state after rejection', async () => {
    const harness = new WebhookInboxHarness(WebhookInbox);
    await expect(harness.process(SOURCE)).rejects.toThrow('active callback');
    const error = new Error('callback');
    await expect(harness.run(() => { throw error; })).rejects.toBe(error);
    await harness.run(async (active) => { expect(await active.process(SOURCE, 1)).toEqual({ processed: 0, failed: 0, ignored: 0 }); });
    await expect(harness.find('missing')).rejects.toThrow('active callback');
  });

  it('reserves operation slots before concurrent real captures so overflow cannot persist an extra entry', async () => {
    const harness = new WebhookInboxHarness(WebhookInbox, { maxOperations: 1 });
    await harness.run(async (active) => {
      const outcomes = await Promise.allSettled([
        active.capture(SOURCE, request({ tenant: 'one', id: 'first' })),
        active.capture(SOURCE, request({ tenant: 'one', id: 'second' })),
      ]);
      expect(outcomes[0].status).toBe('fulfilled');
      expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('before calling') }) });
    });
    expect(harness.records()).toHaveLength(1);
    expect(await WebhookInbox.process(SOURCE, 3)).toEqual({ processed: 1, failed: 0, ignored: 0 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('rejects nested scopes and invalid limits without touching durable processing', async () => {
    const harness = new WebhookInboxHarness(WebhookInbox);
    const process = vi.spyOn(WebhookInbox, 'process');
    await harness.run(async (active) => {
      await expect(active.run(() => {})).rejects.toThrow('already has');
      for (const limit of [0, -1, 1.5, 1001]) await expect(active.process(SOURCE, limit)).rejects.toThrow('1 to 1000');
    });
    expect(process).not.toHaveBeenCalled();
    expect(() => new WebhookInboxHarness(WebhookInbox, { maxOperations: 10_001 })).toThrow('1 to 10000');
  });

  it('waits for an unawaited real capture to settle and fails its callback before releasing scope ownership', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const target = {
      async capture(source: string, signedRequest: Request) { await gate; return WebhookInbox.capture(source, signedRequest); },
      process: (source: string, limit?: number) => WebhookInbox.process(source, limit),
      find: (id: string) => WebhookInbox.find(id),
    };
    const harness = new WebhookInboxHarness(target);
    let receipt!: Promise<Awaited<ReturnType<typeof WebhookInbox.capture>>>;
    let ready!: () => void;
    const entered = new Promise<void>((resolve) => { ready = resolve; });
    const scope = harness.run((active) => { receipt = active.capture(SOURCE, request({ tenant: 'one', id: 'detached' })); ready(); });
    await entered;
    await expect(harness.run(() => {})).rejects.toThrow('already has');
    release();
    await expect(scope).rejects.toThrow('Await every');
    const result = await receipt;
    expect(await WebhookInbox.find(result.entry.id)).toMatchObject({ tenantId: 'one', status: 'received' });
    await harness.run(async (active) => { await active.assertStored(result.entry.id, { tenantId: 'one' }); });
  });
});
