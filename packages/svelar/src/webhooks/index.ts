/**
 * Svelar Outgoing Webhooks
 * Send event notifications to external URLs with retry logic.
 */

import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';
import { singleton } from '../support/singleton.js';

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
      try {
        const { Connection } = await import('../database/Connection.js');
        await Connection.connection();
        // Would insert into webhooks table
      } catch {
        this.endpoints.push(record);
      }
    }

    return record;
  }

  /** Dispatch an event to all matching endpoints */
  async dispatch(event: string, payload: Record<string, any>): Promise<void> {
    for (const endpoint of this.endpoints) {
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

      this.deliveries.push(delivery);

      // Attempt immediate delivery
      await this.deliver(delivery.id);
    }
  }

  /** Deliver a single webhook (with retry) */
  async deliver(deliveryId: string): Promise<boolean> {
    const delivery = this.deliveries.find((d) => d.id === deliveryId);
    if (!delivery) return false;

    const endpoint = this.endpoints.find(
      (e) => e.id === delivery.webhookId
    );
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

      return false;
    }
  }

  /** Sign a payload */
  sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /** List endpoints */
  async listEndpoints(userId?: string | number): Promise<WebhookEndpoint[]> {
    let results = this.endpoints;
    if (userId !== undefined) {
      results = results.filter((e) => e.userId === userId);
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
    const delivery = this.deliveries.find((d) => d.id === deliveryId);
    if (!delivery) return false;

    delivery.attempts = 0;
    delivery.status = 'pending';
    delivery.nextRetryAt = undefined;

    return this.deliver(deliveryId);
  }

  /** Delete an endpoint */
  async deleteEndpoint(id: string): Promise<boolean> {
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
