import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../src/database/Connection';
import { CreateWebhookDeliveriesTable, CreateWebhookInboxEntriesTable, CreateWebhooksTable } from '../src/database/CoreMigrations';
import { WebhookInbox, WebhookSignatureError, Webhooks } from '../src/webhooks';

let tempRoot: string | null = null;
const originalFetch = globalThis.fetch;
let eventSequence = 0;

function eventName(name: string): string {
  eventSequence += 1;
  return `test.${Date.now()}.${eventSequence}.${name}`;
}

async function useMemoryWebhooks(): Promise<void> {
  await Connection.disconnect();
  Webhooks.configure({
    driver: 'memory',
    maxAttempts: 3,
    retryDelays: [1, 2, 3],
    signatureHeader: 'X-Webhook-Signature',
    timeout: 1000,
  });
}

async function useDatabaseWebhooks(): Promise<void> {
  tempRoot = await mkdtemp(join(tmpdir(), 'svelar-webhooks-'));
  await Connection.disconnect();
  Connection.configure({
    default: 'sqlite',
    connections: {
      sqlite: { driver: 'sqlite', filename: join(tempRoot, 'database.sqlite') },
    },
  });

  await new CreateWebhooksTable().up();
  await new CreateWebhookDeliveriesTable().up();
  await new CreateWebhookInboxEntriesTable().up();
  Webhooks.configure({
    driver: 'database',
    maxAttempts: 2,
    retryDelays: [1],
    signatureHeader: 'X-Custom-Signature',
    timeout: 1000,
  });
  WebhookInbox.configure({ driver: 'database' });
}

describe('Webhooks', () => {
  beforeEach(async () => {
    tempRoot = null;
    globalThis.fetch = originalFetch;
    await useMemoryWebhooks();
  });

  afterEach(async () => {
    Webhooks.configure({ driver: 'memory' });
    WebhookInbox.configure({ driver: 'memory' });
    WebhookInbox.clear();
    globalThis.fetch = originalFetch;
    await Connection.disconnect();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('registers and filters memory-backed endpoints by string or numeric user id', async () => {
    const endpoint = await Webhooks.register({
      userId: 42,
      url: 'https://example.com/webhooks',
      events: ['user.created'],
      active: true,
      metadata: { tenant: 'acme' },
    });

    expect(endpoint.secret).toBeTruthy();
    expect(endpoint).toMatchObject({
      userId: 42,
      url: 'https://example.com/webhooks',
      events: ['user.created'],
      active: true,
      metadata: { tenant: 'acme' },
    });

    expect(await Webhooks.listEndpoints(42)).toHaveLength(1);
    expect(await Webhooks.listEndpoints('42')).toHaveLength(1);
    expect(await Webhooks.listEndpoints('99')).toHaveLength(0);
  });

  it('dispatches only to active matching endpoints and signs payloads', async () => {
    const event = eventName('user.created');
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('ok', { status: 200 });
    }) as any;

    const matching = await Webhooks.register({
      url: 'https://example.com/matching',
      events: [event],
      active: true,
    });
    await Webhooks.register({
      url: 'https://example.com/inactive',
      events: [event],
      active: false,
    });
    await Webhooks.register({
      url: 'https://example.com/other-event',
      events: ['order.created'],
      active: true,
    });

    const payload = { id: 1, email: 'user@example.com' };
    await Webhooks.dispatch(event, payload);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://example.com/matching');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Webhook-Event')).toBe(event);
    expect(headers.get('X-Webhook-Signature')).toBe(Webhooks.sign(JSON.stringify(payload), matching.secret));
    expect(calls[0].init.body).toBe(JSON.stringify(payload));

    const deliveries = await Webhooks.listDeliveries({ status: 'success' });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      webhookId: matching.id,
      event,
      status: 'success',
      statusCode: 200,
      response: 'ok',
      attempts: 1,
    });
  });

  it('schedules retry attempts and marks exhausted deliveries as failed', async () => {
    const event = eventName('invoice.paid');
    globalThis.fetch = vi.fn(async () => new Response('bad gateway', { status: 502 })) as any;

    await Webhooks.register({
      url: 'https://example.com/failing',
      events: ['*'],
      active: true,
    });

    await Webhooks.dispatch(event, { invoice: 123 });

    let [delivery] = await Webhooks.listDeliveries({ event });
    expect(delivery).toMatchObject({
      status: 'pending',
      statusCode: 502,
      response: 'bad gateway',
      attempts: 1,
      maxAttempts: 3,
    });
    expect(delivery.nextRetryAt).toBeGreaterThan(Date.now());

    expect(await Webhooks.deliver(delivery.id)).toBe(false);
    expect(await Webhooks.deliver(delivery.id)).toBe(false);

    [delivery] = await Webhooks.listDeliveries({ event });
    expect(delivery.status).toBe('failed');
    expect(delivery.attempts).toBe(3);

    globalThis.fetch = vi.fn(async () => new Response('recovered', { status: 200 })) as any;
    expect(await Webhooks.retryDelivery(delivery.id)).toBe(true);

    [delivery] = await Webhooks.listDeliveries({ event });
    expect(delivery).toMatchObject({
      status: 'success',
      attempts: 1,
      response: 'recovered',
    });
    expect(delivery.nextRetryAt).toBeUndefined();
  });

  it('persists endpoints and deliveries through the database driver', async () => {
    await useDatabaseWebhooks();
    const event = eventName('database.event');

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(String(url)).toBe('https://example.com/database');
      expect(headers.get('X-Custom-Signature')).toBeTruthy();
      return new Response(JSON.stringify({ received: true }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const endpoint = await Webhooks.register({
      userId: 'user-1',
      url: 'https://example.com/database',
      events: [event],
      active: true,
      metadata: { source: 'test' },
    });

    expect(await Webhooks.listEndpoints('user-1')).toEqual([
      expect.objectContaining({
        id: endpoint.id,
        userId: 'user-1',
        active: true,
        metadata: { source: 'test' },
      }),
    ]);

    await Webhooks.dispatch(event, { ok: true });

    const deliveries = await Webhooks.listDeliveries({ webhookId: endpoint.id, status: 'success' });
    expect(deliveries).toEqual([
      expect.objectContaining({
        webhookId: endpoint.id,
        event,
        payload: { ok: true },
        status: 'success',
        statusCode: 202,
        attempts: 1,
      }),
    ]);

    expect(await Webhooks.deleteEndpoint(endpoint.id)).toBe(true);
    expect(await Webhooks.deleteEndpoint(endpoint.id)).toBe(false);
  });

  it('rejects unsafe database table names in configuration', async () => {
    await useDatabaseWebhooks();
    Webhooks.configure({ driver: 'database', table: 'webhooks; DROP TABLE users' });

    await expect(Webhooks.listEndpoints()).rejects.toThrow('Webhooks table name');
  });
});

describe('WebhookInbox', () => {
  beforeEach(async () => {
    tempRoot = null;
    await useMemoryWebhooks();
    WebhookInbox.configure({ driver: 'memory' });
    WebhookInbox.clear();
  });

  afterEach(async () => {
    WebhookInbox.configure({ driver: 'memory' });
    WebhookInbox.clear();
    await Connection.disconnect();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('persists incoming payloads, redacts sensitive headers, and deduplicates by idempotency key', async () => {
    const rawBody = JSON.stringify({ id: 'evt_1', ok: true });
    const signature = Webhooks.sign(rawBody, 'secret');

    const first = await WebhookInbox.receive({
      source: 'stripe',
      event: 'checkout.session.completed',
      tenantId: 42,
      rawBody,
      idempotencyKey: 'evt_1',
      headers: {
        'stripe-signature': `sha256=${signature}`,
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      verifier: WebhookInbox.hmacVerifier('secret', { header: 'stripe-signature', prefix: 'sha256' }),
    });

    const second = await WebhookInbox.receive({
      source: 'stripe',
      rawBody,
      idempotencyKey: 'evt_1',
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(first.entry).toMatchObject({
      source: 'stripe',
      event: 'checkout.session.completed',
      tenantId: 42,
      status: 'received',
      payload: { id: 'evt_1', ok: true },
      attempts: 0,
    });
    expect(first.entry.headers.authorization).toBe('[REDACTED]');
    expect(first.entry.headers['stripe-signature']).toBe('[REDACTED]');
  });

  it('rejects invalid incoming signatures before storing the entry', async () => {
    await expect(WebhookInbox.receive({
      source: 'github',
      rawBody: '{"ping":true}',
      headers: { 'x-hub-signature-256': 'sha256=bad' },
      verifier: WebhookInbox.hmacVerifier('secret', {
        header: 'x-hub-signature-256',
        prefix: 'sha256',
      }),
    })).rejects.toThrow(WebhookSignatureError);

    expect(await WebhookInbox.list()).toHaveLength(0);
  });

  it('tracks processing, failure, replay, and processed transitions', async () => {
    const { entry } = await WebhookInbox.receive({
      source: 'shopify',
      rawBody: '{"order":123}',
      idempotencyKey: 'order-123',
    });

    expect(await WebhookInbox.markQueued(entry.id, 123456)).toMatchObject({ status: 'queued', availableAt: 123456 });
    expect(await WebhookInbox.markProcessing(entry.id)).toMatchObject({ status: 'processing', attempts: 1 });
    expect(await WebhookInbox.markFailed(entry.id, new Error('processor failed'))).toMatchObject({
      status: 'failed',
      error: 'processor failed',
    });
    expect(await WebhookInbox.replay(entry.id)).toMatchObject({ status: 'received', error: undefined });
    expect(await WebhookInbox.markProcessed(entry.id, { jobId: 'job-1' })).toMatchObject({
      status: 'processed',
      metadata: { jobId: 'job-1' },
    });
  });

  it('persists incoming webhook inbox entries through the database driver', async () => {
    await useDatabaseWebhooks();
    const rawBody = JSON.stringify({ ticket: 99 });

    const received = await WebhookInbox.receive({
      source: 'zendesk',
      event: 'ticket.created',
      tenantId: 'tenant-1',
      actorId: 'system',
      rawBody,
      headers: new Headers({ 'content-type': 'application/json' }),
      metadata: { account: 'support' },
    });

    await WebhookInbox.markProcessing(received.entry.id);
    await WebhookInbox.markProcessed(received.entry.id);

    const entries = await WebhookInbox.list({ source: 'zendesk', status: 'processed', tenantId: 'tenant-1' });
    expect(entries).toEqual([
      expect.objectContaining({
        id: received.entry.id,
        source: 'zendesk',
        event: 'ticket.created',
        tenantId: 'tenant-1',
        actorId: 'system',
        payload: { ticket: 99 },
        metadata: { account: 'support' },
        attempts: 1,
        status: 'processed',
      }),
    ]);
  });

  it('rejects unsafe webhook inbox table names', async () => {
    await useDatabaseWebhooks();
    WebhookInbox.configure({ driver: 'database', table: 'webhook_inbox_entries; DROP TABLE users' });

    await expect(WebhookInbox.list()).rejects.toThrow('Webhook inbox table name');
  });
});
