import { AsyncLocalStorage } from 'node:async_hooks';
import type { WebhookInboxEntry, WebhookInboxReceiveResult, WebhookInboxStatus } from '../webhooks/index.js';

export interface WebhookInboxHarnessTarget {
  capture(source: string, request: Request): Promise<WebhookInboxReceiveResult>;
  process(source: string, limit?: number): Promise<{ processed: number; failed: number; ignored: number }>;
  find(id: string): Promise<WebhookInboxEntry | null>;
}

export interface InboxAcceptanceRecord {
  source: string;
  receipt?: WebhookInboxReceiveResult;
  rejection?: unknown;
}

/** Real acceptance harness, not a fake: the caller owns durable configuration, migrations and signed requests. */
export class WebhookInboxHarness {
  private readonly scopes = new AsyncLocalStorage<symbol>();
  private token?: symbol;
  private accepting = false;
  private operations = 0;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly captured: InboxAcceptanceRecord[] = [];
  private readonly maxOperations: number;

  constructor(private readonly target: WebhookInboxHarnessTarget, options: { maxOperations?: number } = {}) {
    this.maxOperations = options.maxOperations ?? 1000;
    if (!Number.isSafeInteger(this.maxOperations) || this.maxOperations < 1 || this.maxOperations > 10_000) throw new RangeError('Inbox harness maxOperations must be 1 to 10000.');
  }

  async run<T>(callback: (harness: this) => T | Promise<T>): Promise<T> {
    if (this.token) throw new Error('This inbox harness already has an active scope.');
    if (typeof callback !== 'function') throw new TypeError('Inbox harness requires a callback.');
    const token = Symbol('svelar.inboxHarness');
    this.token = token;
    this.accepting = true;
    const errors: unknown[] = [];
    let result: T | undefined;
    try { result = await this.scopes.run(token, () => callback(this)); }
    catch (error) { errors.push(error); }
    finally {
      this.accepting = false;
      if (this.pending.size) {
        errors.push(new Error('Await every inbox harness operation before returning from its callback.'));
        for (const outcome of await Promise.allSettled([...this.pending])) if (outcome.status === 'rejected') errors.push(outcome.reason);
      }
      this.token = undefined;
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Inbox harness callback or outstanding operation failed.');
    return result as T;
  }

  private async operation<T>(callback: () => Promise<T>): Promise<T> {
    if (!this.accepting || !this.token || this.scopes.getStore() !== this.token) throw new Error('Inbox harness operations require their active callback.');
    if (this.operations >= this.maxOperations) throw new Error('Inbox harness operation limit exceeded before calling the inbox.');
    this.operations++;
    const pending = Promise.resolve().then(callback);
    this.pending.add(pending);
    try { return await pending; } finally { this.pending.delete(pending); }
  }

  capture(source: string, signedRequest: Request): Promise<WebhookInboxReceiveResult> {
    return this.operation(async () => {
      try {
        const receipt = await this.target.capture(source, signedRequest);
        this.captured.push({ source, receipt });
        return receipt;
      } catch (rejection) { this.captured.push({ source, rejection }); throw rejection; }
    });
  }

  process(source: string, limit = 100): Promise<{ processed: number; failed: number; ignored: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) return Promise.reject(new RangeError('Inbox harness processing limit must be 1 to 1000.'));
    return this.operation(() => this.target.process(source, limit));
  }

  find(id: string): Promise<WebhookInboxEntry | null> { return this.operation(() => this.target.find(id)); }

  async assertStored(id: string, expected: { status?: WebhookInboxStatus; tenantId?: string | number; actorId?: string | number }): Promise<WebhookInboxEntry> {
    const entry = await this.find(id);
    if (!entry) throw new Error('Expected an inbox entry in durable storage.');
    for (const key of ['status', 'tenantId', 'actorId'] as const) {
      if (Object.hasOwn(expected, key) && entry[key] !== expected[key]) throw new Error(`Stored inbox ${key} does not match the expected acceptance contract.`);
    }
    return entry;
  }

  records(): InboxAcceptanceRecord[] { return [...this.captured]; }
}

export function withWebhookInbox<T>(target: WebhookInboxHarnessTarget, callback: (harness: WebhookInboxHarness) => T | Promise<T>, options: { maxOperations?: number } = {}): Promise<T> {
  return new WebhookInboxHarness(target, options).run(callback);
}
