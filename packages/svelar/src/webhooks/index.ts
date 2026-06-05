/**
 * Svelar Outgoing Webhooks
 * Send event notifications to external URLs with retry logic.
 */

import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';
import { singleton } from '../support/singleton.js';
import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';

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
      active: Boolean(row.active),
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
        active: record.active ? 1 : 0,
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

export const Webhooks = singleton(
  'svelar.webhooks',
  () => new WebhookManager()
);
