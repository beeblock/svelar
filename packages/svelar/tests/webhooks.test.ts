import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../src/database/Connection';
import { CreateWebhookDeliveriesTable, CreateWebhooksTable } from '../src/database/CoreMigrations';
import { Webhooks } from '../src/webhooks';

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
  Webhooks.configure({
    driver: 'database',
    maxAttempts: 2,
    retryDelays: [1],
    signatureHeader: 'X-Custom-Signature',
    timeout: 1000,
  });
}

describe('Webhooks', () => {
  beforeEach(async () => {
    tempRoot = null;
    globalThis.fetch = originalFetch;
    await useMemoryWebhooks();
  });

  afterEach(async () => {
    Webhooks.configure({ driver: 'memory' });
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
