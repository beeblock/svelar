/**
 * Svelar Outgoing Webhooks
 * Send event notifications to external URLs with retry logic.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { singleton } from '../support/singleton.js';
import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { normalizeWebhookInboxTenantId, webhookInboxDeduplicationKey } from './InboxIdentity.js';

export interface WebhookEndpoint {
  id: string;
  userId?: string | number;
  url: string;
  events: string[]; // ['user.created', 'order.completed', '*']
  secret: string; // For signing payloads
  active: boolean;
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: Record<string, any>;
  status: 'pending' | 'success' | 'failed';
  statusCode?: number;
  response?: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: number;
  deliveredAt?: number;
  createdAt: number;
}

export interface WebhookConfig {
  driver: 'database' | 'memory';
  table?: string;
  deliveryTable?: string;
  maxAttempts?: number;
  retryDelays?: number[]; // [1, 10, 60, 300, 3600] seconds
  signatureHeader?: string;
  timeout?: number;
}

export type WebhookInboxStatus = 'received' | 'queued' | 'processing' | 'processed' | 'failed' | 'ignored';

export interface WebhookInboxEntry {
  id: string;
  source: string;
  event?: string;
  tenantId?: string | number;
  actorId?: string | number;
  idempotencyKey: string;
  digest: string;
  status: WebhookInboxStatus;
  headers: Record<string, string>;
  rawBody: string;
  payload?: any;
  metadata?: Record<string, any>;
  attempts: number;
  availableAt?: number;
  processedAt?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookInboxReceiveInput {
  source: string;
  rawBody: string | Buffer | ArrayBuffer | Uint8Array;
  headers?: Headers | Record<string, string | string[] | undefined> | Array<[string, string]>;
  event?: string;
  tenantId?: string | number | null;
  actorId?: string | number;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
  verifier?: WebhookInboxVerifier;
  status?: WebhookInboxStatus;
}

export interface WebhookInboxReceiveResult {
  entry: WebhookInboxEntry;
  duplicate: boolean;
}

export type WebhookInboxVerifier = (input: {
  source: string;
  rawBody: string;
  headers: Record<string, string>;
}) => boolean | Promise<boolean>;

export interface WebhookInboxConfig {
  driver: 'database' | 'memory';
  table?: string;
  redactedHeaders?: string[];
}

class WebhookManager {
  private config: WebhookConfig = {
    driver: 'memory',
    maxAttempts: 5,
    retryDelays: [1, 10, 60, 300, 3600],
    signatureHeader: 'X-Webhook-Signature',
    timeout: 10000,
  };
  private endpoints: WebhookEndpoint[] = [];
  private deliveries: WebhookDelivery[] = [];

  configure(config: WebhookConfig): void {
    this.config = { ...this.config, ...config };
  }

  private toBoolean(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true' || value === 't';
  }

  private endpointsTable(): string {
    return assertSqlIdentifier(this.config.table ?? 'webhooks', 'Webhooks table name');
  }

  private deliveriesTable(): string {
    return assertSqlIdentifier(this.config.deliveryTable ?? 'webhook_deliveries', 'Webhook deliveries table name');
  }

  private endpointQuery(): QueryBuilder<any> {
    return new QueryBuilder(this.endpointsTable());
  }

  private deliveryQuery(): QueryBuilder<any> {
    return new QueryBuilder(this.deliveriesTable());
  }

  private rowToEndpoint(row: any): WebhookEndpoint {
    return {
      id: row.id,
      userId: row.user_id ?? row.userId ?? row.userid ?? undefined,
      url: row.url,
      events: JSON.parse(row.events),
      secret: row.secret,
      active: this.toBoolean(row.active),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at ?? row.createdAt ?? row.createdat,
    };
  }

  private rowToDelivery(row: any): WebhookDelivery {
    return {
      id: row.id,
      webhookId: row.webhook_id ?? row.webhookId ?? row.webhookid,
      event: row.event,
      payload: JSON.parse(row.payload),
      status: row.status,
      statusCode: row.status_code ?? row.statusCode ?? row.statuscode ?? undefined,
      response: row.response ?? undefined,
      attempts: row.attempts,
      maxAttempts: row.max_attempts ?? row.maxAttempts ?? row.maxattempts,
      nextRetryAt: row.next_retry_at ?? row.nextRetryAt ?? row.nextretryat ?? undefined,
      deliveredAt: row.delivered_at ?? row.deliveredAt ?? row.deliveredat ?? undefined,
      createdAt: row.created_at ?? row.createdAt ?? row.createdat,
    };
  }

  private async saveDelivery(delivery: WebhookDelivery): Promise<void> {
    if (this.config.driver === 'memory') {
      this.deliveries.push(delivery);
      return;
    }

    await this.deliveryQuery().insert({
      id: delivery.id,
      webhook_id: delivery.webhookId,
      event: delivery.event,
      payload: JSON.stringify(delivery.payload),
      status: delivery.status,
      status_code: delivery.statusCode ?? null,
      response: delivery.response ?? null,
      attempts: delivery.attempts,
      max_attempts: delivery.maxAttempts,
      next_retry_at: delivery.nextRetryAt ?? null,
      delivered_at: delivery.deliveredAt ?? null,
      created_at: delivery.createdAt,
    });
  }

  private async updateDelivery(delivery: WebhookDelivery): Promise<void> {
    if (this.config.driver === 'memory') return;
    await this.deliveryQuery().where('id', delivery.id).update({
      status: delivery.status,
      status_code: delivery.statusCode ?? null,
      response: delivery.response ?? null,
      attempts: delivery.attempts,
      next_retry_at: delivery.nextRetryAt ?? null,
      delivered_at: delivery.deliveredAt ?? null,
    });
  }

  private async findDelivery(id: string): Promise<WebhookDelivery | null> {
    if (this.config.driver === 'memory') {
      return this.deliveries.find((d) => d.id === id) ?? null;
    }

    const row = await this.deliveryQuery().where('id', id).first();
    return row ? this.rowToDelivery(row) : null;
  }

  private async findEndpoint(id: string): Promise<WebhookEndpoint | null> {
    if (this.config.driver === 'memory') {
      return this.endpoints.find((e) => e.id === id) ?? null;
    }

    const row = await this.endpointQuery().where('id', id).first();
    return row ? this.rowToEndpoint(row) : null;
  }

  /** Register a webhook endpoint */
  async register(
    endpoint: Omit<WebhookEndpoint, 'id' | 'secret' | 'createdAt'>
  ): Promise<WebhookEndpoint> {
    const secret = randomUUID();

    const record: WebhookEndpoint = {
      ...endpoint,
      id: randomUUID(),
      secret,
      createdAt: Date.now(),
    };

    if (this.config.driver === 'memory') {
      this.endpoints.push(record);
    } else if (this.config.driver === 'database') {
      await this.endpointQuery().insert({
        id: record.id,
        user_id: record.userId == null ? null : String(record.userId),
        url: record.url,
        events: JSON.stringify(record.events),
        secret: record.secret,
        active: record.active,
        metadata: record.metadata ? JSON.stringify(record.metadata) : null,
        created_at: record.createdAt,
      });
    }

    return record;
  }

  /** Dispatch an event to all matching endpoints */
  async dispatch(event: string, payload: Record<string, any>): Promise<void> {
    const endpoints = await this.listEndpoints();
    for (const endpoint of endpoints) {
      if (!endpoint.active) continue;

      // Check if endpoint listens to this event
      const listens =
        endpoint.events.includes('*') || endpoint.events.includes(event);
      if (!listens) continue;

      // Create delivery record
      const delivery: WebhookDelivery = {
        id: randomUUID(),
        webhookId: endpoint.id,
        event,
        payload,
        status: 'pending',
        attempts: 0,
        maxAttempts: this.config.maxAttempts || 5,
        createdAt: Date.now(),
      };

      await this.saveDelivery(delivery);

      // Attempt immediate delivery
      await this.deliver(delivery.id);
    }
  }

  /** Deliver a single webhook (with retry) */
  async deliver(deliveryId: string): Promise<boolean> {
    const delivery = await this.findDelivery(deliveryId);
    if (!delivery) return false;

    const endpoint = await this.findEndpoint(delivery.webhookId);
    if (!endpoint) return false;

    delivery.attempts++;

    try {
      const signature = this.sign(JSON.stringify(delivery.payload), endpoint.secret);

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout || 10000
      );

      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [this.config.signatureHeader || 'X-Webhook-Signature']: signature,
          'X-Webhook-Event': delivery.event,
          'X-Webhook-Delivery': deliveryId,
        },
        body: JSON.stringify(delivery.payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      delivery.statusCode = response.status;
      delivery.response = await response.text();

      if (response.ok) {
        delivery.status = 'success';
        delivery.deliveredAt = Date.now();
        await this.updateDelivery(delivery);
        return true;
      } else {
        throw new Error(
          `HTTP ${response.status}: ${delivery.response.slice(0, 100)}`
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';

      if (delivery.attempts < delivery.maxAttempts) {
        // Schedule retry
        const delaySeconds =
          this.config.retryDelays?.[delivery.attempts - 1] || 60;
        delivery.nextRetryAt = Date.now() + delaySeconds * 1000;
        delivery.status = 'pending';
      } else {
        delivery.status = 'failed';
      }

      await this.updateDelivery(delivery);
      return false;
    }
  }

  /** Sign a payload */
  sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /** List endpoints */
  async listEndpoints(userId?: string | number): Promise<WebhookEndpoint[]> {
    if (this.config.driver === 'database') {
      const query = this.endpointQuery();
      if (userId !== undefined) query.where('user_id', String(userId));
      const rows = await query.orderBy('created_at', 'desc').get();
      return rows.map((row: any) => this.rowToEndpoint(row));
    }

    let results = this.endpoints;
    if (userId !== undefined) {
      results = results.filter((e) => String(e.userId) === String(userId));
    }
    return results.map((e) => ({ ...e })); // Return copies
  }

  /** List deliveries with filtering */
  async listDeliveries(filter?: {
    webhookId?: string;
    event?: string;
    status?: string;
    limit?: number;
  }): Promise<WebhookDelivery[]> {
    if (this.config.driver === 'database') {
      const query = this.deliveryQuery();

      if (filter?.webhookId) {
        query.where('webhook_id', filter.webhookId);
      }
      if (filter?.event) {
        query.where('event', filter.event);
      }
      if (filter?.status) {
        query.where('status', filter.status);
      }

      const rows = await query.orderBy('created_at', 'desc').limit(filter?.limit || 100).get();
      return rows.map((row: any) => this.rowToDelivery(row));
    }

    let results = [...this.deliveries];

    if (filter?.webhookId) {
      results = results.filter((d) => d.webhookId === filter.webhookId);
    }
    if (filter?.event) {
      results = results.filter((d) => d.event === filter.event);
    }
    if (filter?.status) {
      results = results.filter((d) => d.status === filter.status);
    }

    // Sort by most recent first
    results.sort((a, b) => b.createdAt - a.createdAt);

    return results.slice(0, filter?.limit || 100);
  }

  /** Retry a failed delivery */
  async retryDelivery(deliveryId: string): Promise<boolean> {
    const delivery = await this.findDelivery(deliveryId);
    if (!delivery) return false;

    delivery.attempts = 0;
    delivery.status = 'pending';
    delivery.nextRetryAt = undefined;
    delivery.deliveredAt = undefined;
    delivery.statusCode = undefined;
    delivery.response = undefined;

    await this.updateDelivery(delivery);

    return this.deliver(deliveryId);
  }

  /** Delete an endpoint */
  async deleteEndpoint(id: string): Promise<boolean> {
    if (this.config.driver === 'database') {
      const existing = await this.findEndpoint(id);
      if (!existing) return false;
      await this.endpointQuery().where('id', id).delete();
      return true;
    }

    const index = this.endpoints.findIndex((e) => e.id === id);
    if (index === -1) return false;

    this.endpoints.splice(index, 1);
    return true;
  }
}

export class WebhookSignatureError extends Error {
  constructor(source: string) {
    super(`Invalid webhook signature for ${source}`);
    this.name = 'WebhookSignatureError';
  }
}

class WebhookInboxManager {
  private config: WebhookInboxConfig = {
    driver: 'memory',
    table: 'webhook_inbox_entries',
  };
  private entries: WebhookInboxEntry[] = [];

  configure(config: WebhookInboxConfig): void {
    this.config = { ...this.config, ...config };
  }

  clear(): void {
    this.entries = [];
  }

  async receive(input: WebhookInboxReceiveInput): Promise<WebhookInboxReceiveResult> {
    const source = input.source.trim();
    if (!source) throw new Error('Webhook inbox source is required.');

    const rawBody = bodyToString(input.rawBody);
    const tenantId = normalizeWebhookInboxTenantId(input.tenantId);
    const digest = createHash('sha256').update(rawBody).digest('hex');
    const idempotencyKey = input.idempotencyKey ?? `${source}:${digest}`;
    const deduplicationKey = webhookInboxDeduplicationKey(source, tenantId, idempotencyKey);
    const verificationHeaders = normalizeHeaders(input.headers);
    const headers = redactHeaders(verificationHeaders, this.config.redactedHeaders);
    const { event, actorId, status, verifier } = input;
    const metadata = input.metadata ? { ...input.metadata } : undefined;
    const query = this.config.driver === 'database' ? this.query() : undefined;

    if (verifier) {
      const valid = await verifier({ source, rawBody, headers: verificationHeaders });
      if (!valid) throw new WebhookSignatureError(source);
    }

    const now = Date.now();
    const entry: WebhookInboxEntry = {
      id: randomUUID(),
      source,
      event,
      tenantId,
      actorId,
      idempotencyKey,
      digest,
      status: status ?? 'received',
      headers,
      rawBody,
      payload: parseJsonOrUndefined(rawBody),
      metadata,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (!query) {
      // Verification may yield; the winner check and commit must not.
      const existing = this.entries.find((item) => item.source === source
        && item.tenantId === tenantId && item.idempotencyKey === idempotencyKey);
      if (existing) return { entry: cloneEntry(existing), duplicate: true };
      this.entries.push(cloneEntry(entry));
      return { entry: cloneEntry(entry), duplicate: false };
    }

    try {
      await query.insert(this.entryToRow(entry));
      return { entry: cloneEntry(entry), duplicate: false };
    } catch (error) {
      if (!isInboxUniqueConflict(error)) throw error;
      query.where('deduplication_key', deduplicationKey)
        .where('source', source)
        .where('idempotency_key', idempotencyKey);
      if (tenantId === undefined) query.whereNull('tenant_id');
      else query.where('tenant_id', tenantId);
      const winner = await query.first();
      if (!winner) throw error;
      return { entry: this.rowToEntry(winner), duplicate: true };
    }
  }

  async receiveRequest(source: string, request: Request, options: Omit<WebhookInboxReceiveInput, 'source' | 'rawBody' | 'headers'> = {}): Promise<WebhookInboxReceiveResult> {
    return this.receive({
      ...options,
      source,
      rawBody: await request.text(),
      headers: request.headers,
    });
  }

  hmacVerifier(secret: string, options: {
    header?: string;
    algorithm?: string;
    prefix?: string;
  } = {}): WebhookInboxVerifier {
    return ({ rawBody, headers }) => this.verifyHmac(rawBody, headers, secret, options);
  }

  verifyHmac(
    rawBody: string,
    headers: Headers | Record<string, string | string[] | undefined> | Array<[string, string]> | undefined,
    secret: string,
    options: { header?: string; algorithm?: string; prefix?: string } = {},
  ): boolean {
    const algorithm = options.algorithm ?? 'sha256';
    const header = (options.header ?? 'x-webhook-signature').toLowerCase();
    const normalized = normalizeHeaders(headers);
    const received = normalized[header];
    if (!received) return false;

    const expected = createHmac(algorithm, secret).update(rawBody).digest('hex');
    const receivedDigest = options.prefix && received.startsWith(`${options.prefix}=`)
      ? received.slice(options.prefix.length + 1)
      : received.includes('=')
        ? received.split('=').at(-1) ?? received
        : received;

    return timingSafeHexEqual(expected, receivedDigest);
  }

  async markQueued(id: string, availableAt?: number): Promise<WebhookInboxEntry | null> {
    return this.transition(id, 'queued', { availableAt, error: undefined });
  }

  async markProcessing(id: string): Promise<WebhookInboxEntry | null> {
    const entry = await this.find(id);
    if (!entry) return null;
    return this.transition(id, 'processing', { attempts: entry.attempts + 1, error: undefined });
  }

  async markProcessed(id: string, metadata?: Record<string, any>): Promise<WebhookInboxEntry | null> {
    const changes: Partial<WebhookInboxEntry> = {
      processedAt: Date.now(),
      error: undefined,
    };

    if (metadata) {
      changes.metadata = { ...(await this.find(id))?.metadata, ...metadata };
    }

    return this.transition(id, 'processed', changes);
  }

  async markFailed(id: string, error: unknown): Promise<WebhookInboxEntry | null> {
    const message = error instanceof Error ? error.message : String(error);
    return this.transition(id, 'failed', { error: message });
  }

  async replay(id: string, availableAt?: number): Promise<WebhookInboxEntry | null> {
    return this.transition(id, 'received', {
      availableAt,
      processedAt: undefined,
      error: undefined,
    });
  }

  async find(id: string): Promise<WebhookInboxEntry | null> {
    if (this.config.driver === 'memory') {
      const entry = this.entries.find((item) => item.id === id);
      return entry ? cloneEntry(entry) : null;
    }

    const row = await this.query().where('id', id).first();
    return row ? this.rowToEntry(row) : null;
  }

  async list(filter: {
    source?: string;
    status?: WebhookInboxStatus;
    tenantId?: string | number;
    limit?: number;
  } = {}): Promise<WebhookInboxEntry[]> {
    if (this.config.driver === 'database') {
      const query = this.query();
      if (filter.source) query.where('source', filter.source);
      if (filter.status) query.where('status', filter.status);
      if (filter.tenantId != null) query.where('tenant_id', String(filter.tenantId));
      const rows = await query.orderBy('created_at', 'desc').limit(filter.limit ?? 100).get();
      return rows.map((row: any) => this.rowToEntry(row));
    }

    return this.entries
      .filter((entry) => !filter.source || entry.source === filter.source)
      .filter((entry) => !filter.status || entry.status === filter.status)
      .filter((entry) => filter.tenantId == null || String(entry.tenantId) === String(filter.tenantId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, filter.limit ?? 100)
      .map(cloneEntry);
  }

  private table(): string {
    return assertSqlIdentifier(this.config.table ?? 'webhook_inbox_entries', 'Webhook inbox table name');
  }

  private query(): QueryBuilder<any> {
    return new QueryBuilder(this.table());
  }

  private async transition(id: string, status: WebhookInboxStatus, changes: Partial<WebhookInboxEntry>): Promise<WebhookInboxEntry | null> {
    const current = await this.find(id);
    if (!current) return null;

    const updated: WebhookInboxEntry = {
      ...current,
      ...changes,
      status,
      updatedAt: Date.now(),
    };

    if (this.config.driver === 'memory') {
      const index = this.entries.findIndex((entry) => entry.id === id);
      if (index === -1) return null;
      this.entries[index] = cloneEntry(updated);
      return cloneEntry(updated);
    }

    await this.query().where('id', id).update(this.entryToRow(updated, false));
    return updated;
  }

  private entryToRow(entry: WebhookInboxEntry, includeId = true): Record<string, any> {
    return {
      ...(includeId ? { id: entry.id } : {}),
      source: entry.source,
      event: entry.event ?? null,
      tenant_id: entry.tenantId == null ? null : String(entry.tenantId),
      actor_id: entry.actorId == null ? null : String(entry.actorId),
      idempotency_key: entry.idempotencyKey,
      deduplication_key: webhookInboxDeduplicationKey(entry.source, entry.tenantId, entry.idempotencyKey),
      digest: entry.digest,
      status: entry.status,
      headers: JSON.stringify(entry.headers),
      raw_body: entry.rawBody,
      payload: entry.payload === undefined ? null : JSON.stringify(entry.payload),
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      attempts: entry.attempts,
      available_at: entry.availableAt ?? null,
      processed_at: entry.processedAt ?? null,
      error: entry.error ?? null,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    };
  }

  private rowToEntry(row: any): WebhookInboxEntry {
    return {
      id: row.id,
      source: row.source,
      event: row.event ?? undefined,
      tenantId: row.tenant_id ?? row.tenantId ?? undefined,
      actorId: row.actor_id ?? row.actorId ?? undefined,
      idempotencyKey: row.idempotency_key ?? row.idempotencyKey,
      digest: row.digest,
      status: row.status,
      headers: JSON.parse(row.headers),
      rawBody: row.raw_body ?? row.rawBody,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      attempts: Number(row.attempts ?? 0),
      availableAt: row.available_at ?? row.availableAt ?? undefined,
      processedAt: row.processed_at ?? row.processedAt ?? undefined,
      error: row.error ?? undefined,
      createdAt: row.created_at ?? row.createdAt,
      updatedAt: row.updated_at ?? row.updatedAt,
    };
  }
}

function isInboxUniqueConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === '23505' || error.code === 'ER_DUP_ENTRY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

function normalizeHeaders(headers: WebhookInboxReceiveInput['headers']): Record<string, string> {
  if (!headers) return {};

  const output: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      output[key.toLowerCase()] = value;
    });
    return output;
  }

  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    output[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return output;
}

function redactHeaders(headers: Record<string, string>, extra: string[] = []): Record<string, string> {
  const redacted = new Set(['authorization', 'cookie', 'set-cookie', 'x-webhook-signature', 'stripe-signature', ...extra.map((key) => key.toLowerCase())]);
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, redacted.has(key.toLowerCase()) ? '[REDACTED]' : value]),
  );
}

function bodyToString(body: WebhookInboxReceiveInput['rawBody']): string {
  if (typeof body === 'string') return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
  return Buffer.from(body).toString('utf8');
}

function parseJsonOrUndefined(rawBody: string): any | undefined {
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

function timingSafeHexEqual(expected: string, received: string): boolean {
  try {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const receivedBuffer = Buffer.from(received, 'hex');
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch {
    return false;
  }
}

function cloneEntry(entry: WebhookInboxEntry): WebhookInboxEntry {
  return {
    ...entry,
    headers: { ...entry.headers },
    payload: entry.payload === undefined ? undefined : JSON.parse(JSON.stringify(entry.payload)),
    metadata: entry.metadata ? { ...entry.metadata } : undefined,
  };
}

export const Webhooks = singleton(
  'svelar.webhooks',
  () => new WebhookManager()
);

export const WebhookInbox = singleton(
  'svelar.webhookInbox',
  () => new WebhookInboxManager()
);
