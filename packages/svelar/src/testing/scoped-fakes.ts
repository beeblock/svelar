import { AsyncLocalStorage } from 'node:async_hooks';
import { Event, type EventDispatcher } from '../events/index.js';
import { interceptHttpForTesting, type HttpTestingRuntime } from '../http/index.js';
import { Mailer, type MailMessage, type SendResult } from '../mail/index.js';
import { Notifier, type Notifiable, type Notification, type NotificationChannel } from '../notifications/index.js';
import { Queue, type Job } from '../queue/index.js';
import type { ApplicationContextSnapshot } from '../support/Context.js';
import { cloneMailMessage } from './mail-message.js';

export interface FakeOptions {
  /** Maximum captured records per fake. Overflow throws instead of allowing real side effects. */
  maxRecords?: number;
}

export type FakePredicate<T> = (record: T) => boolean;

const scopes = new AsyncLocalStorage<Map<object, symbol>>();
const httpScope = {};

async function runScoped<T>(
  key: object,
  install: (isActive: () => boolean) => () => void,
  callback: () => T | Promise<T>,
): Promise<T> {
  const token = Symbol('svelar.fake');
  const context = new Map(scopes.getStore());
  context.set(key, token);
  const restore = install(() => scopes.getStore()?.get(key) === token);
  try {
    return await scopes.run(context, callback);
  } finally {
    restore();
  }
}

class FakeRecords<T> {
  private captured: T[] = [];
  private running = false;
  private readonly maxRecords: number;

  constructor(options: FakeOptions = {}) {
    this.maxRecords = options.maxRecords ?? 1000;
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords < 1) {
      throw new RangeError('Fake maxRecords must be a positive safe integer.');
    }
  }

  protected capture(record: T): void {
    if (this.captured.length >= this.maxRecords) {
      throw new Error(`Fake record limit (${this.maxRecords}) exceeded. No real side effect was performed.`);
    }
    this.captured.push(record);
  }

  protected async scoped<R>(
    key: object,
    install: (isActive: () => boolean) => () => void,
    callback: (fake: this) => R | Promise<R>,
  ): Promise<R> {
    if (this.running) throw new Error('This fake already has an active scope. Use a separate fake for nested or concurrent scopes.');
    this.running = true;
    try {
      return await runScoped(key, install, () => callback(this));
    } finally {
      this.running = false;
    }
  }

  records(): T[] {
    return [...this.captured];
  }

  count(predicate?: FakePredicate<T>): number {
    return predicate ? this.captured.filter(predicate).length : this.captured.length;
  }

  reset(): void {
    this.captured = [];
  }

  assertCount(expected: number, predicate?: FakePredicate<T>): void {
    const actual = this.count(predicate);
    if (actual !== expected) throw new Error(`Expected ${expected} matching record(s), but captured ${actual}.`);
  }

  protected assertRecorded(predicate: FakePredicate<T>, message: string): void {
    if (!this.captured.some(predicate)) throw new Error(message);
  }

  protected assertNotRecorded(predicate: FakePredicate<T>, message: string): void {
    if (this.captured.some(predicate)) throw new Error(message);
  }

  protected assertEmpty(kind: string): void {
    if (this.captured.length) throw new Error(`Expected no ${kind}, but captured ${this.captured.length} record(s).`);
  }
}

export interface ScopedFakeMailRecord {
  mailer: string;
  message: MailMessage;
  result: SendResult;
  sentAt: Date;
}

export class FakeMail extends FakeRecords<ScopedFakeMailRecord> {
  private sequence = 0;

  run<T>(callback: (fake: this) => T | Promise<T>): Promise<T> {
    const transport = {
      send: async (message: MailMessage, mailer: string): Promise<SendResult> => {
        const snapshot = cloneMailMessage(message);
        const result: SendResult = {
          accepted: Array.isArray(snapshot.to) ? [...snapshot.to] : [snapshot.to],
          rejected: [],
          messageId: `fake-${++this.sequence}`,
        };
        this.capture({
          mailer,
          message: snapshot,
          result: { ...result, accepted: [...result.accepted], rejected: [...result.rejected] },
          sentAt: new Date(),
        });
        return result;
      },
    };
    return this.scoped(Mailer, (isActive) => Mailer.interceptForTesting(() => isActive() ? transport : undefined), callback);
  }

  sent(): ScopedFakeMailRecord[] { return this.records(); }
  assertSent(predicate: FakePredicate<ScopedFakeMailRecord>, message = 'Expected mail was not sent.'): void {
    this.assertRecorded(predicate, message);
  }
  assertNotSent(predicate: FakePredicate<ScopedFakeMailRecord>, message = 'Unexpected mail was sent.'): void {
    this.assertNotRecorded(predicate, message);
  }
  assertNothingSent(): void { this.assertEmpty('mail sent'); }
}

export interface FakeQueueRecord {
  id: string;
  job: Job;
  jobClass: string;
  /** Serialized dispatch-time snapshot; job itself retains its original identity. */
  payload: string;
  queue: string;
  mode: 'async' | 'sync';
  maxAttempts: number;
  priority?: number;
  deduplicate?: boolean;
  metadata?: Record<string, unknown>;
  context?: ApplicationContextSnapshot;
  availableAt: number;
  createdAt: number;
}

export class FakeQueue extends FakeRecords<FakeQueueRecord> {
  run<T>(callback: (fake: this) => T | Promise<T>): Promise<T> {
    return this.scoped(Queue, (isActive) => Queue.interceptForTesting((job, mode) => {
      if (!isActive()) return false;
      this.capture({
        id: job.id,
        job: job.job,
        jobClass: job.jobClass,
        payload: job.payload,
        queue: job.queue,
        mode,
        maxAttempts: job.maxAttempts,
        priority: job.priority,
        deduplicate: job.deduplicate,
        metadata: job.metadata === undefined ? undefined : structuredClone(job.metadata),
        context: job.context === undefined ? undefined : structuredClone(job.context),
        availableAt: job.availableAt,
        createdAt: job.createdAt,
      });
      return true;
    }), callback);
  }

  pushed(): FakeQueueRecord[] { return this.records(); }
  assertPushed(predicate: FakePredicate<FakeQueueRecord>, message = 'Expected job was not pushed.'): void {
    this.assertRecorded(predicate, message);
  }
  assertNotPushed(predicate: FakePredicate<FakeQueueRecord>, message = 'Unexpected job was pushed.'): void {
    this.assertNotRecorded(predicate, message);
  }
  assertNothingPushed(): void { this.assertEmpty('jobs pushed'); }
}

export interface FakeEventRecord {
  name: string;
  event: unknown;
  dispatchedAt: Date;
}

export interface FakeEventsOptions extends FakeOptions {
  dispatcher?: EventDispatcher;
}

export class FakeEvents extends FakeRecords<FakeEventRecord> {
  private readonly dispatcher: EventDispatcher;

  constructor(options: FakeEventsOptions = {}) {
    super(options);
    this.dispatcher = options.dispatcher ?? Event;
  }

  run<T>(callback: (fake: this) => T | Promise<T>): Promise<T> {
    return this.scoped(this.dispatcher, (isActive) => this.dispatcher.interceptForTesting((name, event) => {
      if (!isActive()) return false;
      this.capture({ name, event, dispatchedAt: new Date() });
      return true;
    }), callback);
  }

  dispatched(): FakeEventRecord[] { return this.records(); }
  assertDispatched(predicate: FakePredicate<FakeEventRecord>, message = 'Expected event was not dispatched.'): void {
    this.assertRecorded(predicate, message);
  }
  assertNotDispatched(predicate: FakePredicate<FakeEventRecord>, message = 'Unexpected event was dispatched.'): void {
    this.assertNotRecorded(predicate, message);
  }
  assertNothingDispatched(): void { this.assertEmpty('events dispatched'); }
}

export interface FakeNotificationRecord {
  notifiable: Notifiable;
  notification: Notification;
  channels: NotificationChannel[];
  sentAt: Date;
}

export class FakeNotifications extends FakeRecords<FakeNotificationRecord> {
  run<T>(callback: (fake: this) => T | Promise<T>): Promise<T> {
    return this.scoped(Notifier, (isActive) => Notifier.interceptForTesting((notifiable, notification, channels) => {
      if (!isActive()) return false;
      this.capture({ notifiable, notification, channels: [...channels], sentAt: new Date() });
      return true;
    }), callback);
  }

  sent(): FakeNotificationRecord[] { return this.records(); }
  assertSent(predicate: FakePredicate<FakeNotificationRecord>, message = 'Expected notification was not sent.'): void {
    this.assertRecorded(predicate, message);
  }
  assertNotSent(predicate: FakePredicate<FakeNotificationRecord>, message = 'Unexpected notification was sent.'): void {
    this.assertNotRecorded(predicate, message);
  }
  assertNothingSent(): void { this.assertEmpty('notifications sent'); }
}

export interface FakeHttpRecord {
  url: string;
  method: string;
  headers: Headers;
  /** Normalized request body text, or null when no body was supplied. */
  body: string | null;
  sentAt: Date;
  response?: { status: number; headers: Headers };
  error?: unknown;
}

export type FakeHttpResponse = Response | ((record: FakeHttpRecord) => Response | Promise<Response>);

export class FakeHttp extends FakeRecords<FakeHttpRecord> {
  private responders: Array<{ predicate: FakePredicate<FakeHttpRecord>; response: FakeHttpResponse }> = [];

  /** First matching responder wins. Unmatched requests always fail without network access. */
  respond(predicate: FakePredicate<FakeHttpRecord>, response: FakeHttpResponse): this {
    this.responders.push({ predicate, response });
    return this;
  }

  respondWith(response: FakeHttpResponse): this {
    return this.respond(() => true, response);
  }

  run<T>(callback: (fake: this) => T | Promise<T>): Promise<T> {
    const runtime: HttpTestingRuntime = {
      fetch: (url, init) => this.send(url, init),
      circuitBreakerStates: new Map(),
    };
    return this.scoped(httpScope, (isActive) => interceptHttpForTesting(() => isActive() ? runtime : undefined), callback);
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const record: FakeHttpRecord = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: new Headers(init.headers),
      body: null,
      sentAt: new Date(),
    };
    this.capture(record);
    try {
      init.signal?.throwIfAborted();
      // A local Request normalizes every supported BodyInit without invoking fetch.
      const request = new Request(new URL(url, 'http://svelar.test'), { ...init, signal: undefined });
      record.headers = new Headers(request.headers);
      record.body = init.body == null ? null : await abortable(() => request.text(), init.signal);
      init.signal?.throwIfAborted();
      const responder = this.responders.find(({ predicate }) => predicate(record));
      if (!responder) throw new Error(`No fake HTTP response matched ${record.method} ${url}. Network access is disabled.`);
      const response = await abortable(() => typeof responder.response === 'function'
        ? responder.response(record)
        : responder.response, init.signal);
      const clone = response.clone();
      record.response = { status: clone.status, headers: new Headers(clone.headers) };
      return clone;
    } catch (error) {
      record.error = error;
      throw error;
    }
  }

  requests(): FakeHttpRecord[] { return this.records(); }
  assertSent(predicate: FakePredicate<FakeHttpRecord>, message = 'Expected HTTP request was not sent.'): void {
    this.assertRecorded(predicate, message);
  }
  assertNotSent(predicate: FakePredicate<FakeHttpRecord>, message = 'Unexpected HTTP request was sent.'): void {
    this.assertNotRecorded(predicate, message);
  }
  assertNothingSent(): void { this.assertEmpty('HTTP requests sent'); }
}

async function abortable<T>(callback: () => T | Promise<T>, signal?: AbortSignal | null): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return callback();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(callback), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export function fakeQueue<T>(callback: (fake: FakeQueue) => T | Promise<T>, options?: FakeOptions): Promise<T> {
  return new FakeQueue(options).run(callback);
}

export function fakeMail<T>(callback: (fake: FakeMail) => T | Promise<T>, options?: FakeOptions): Promise<T> {
  return new FakeMail(options).run(callback);
}

export function fakeEvents<T>(callback: (fake: FakeEvents) => T | Promise<T>, options?: FakeEventsOptions): Promise<T> {
  return new FakeEvents(options).run(callback);
}

export function fakeNotifications<T>(callback: (fake: FakeNotifications) => T | Promise<T>, options?: FakeOptions): Promise<T> {
  return new FakeNotifications(options).run(callback);
}

export function fakeHttp<T>(callback: (fake: FakeHttp) => T | Promise<T>, options?: FakeOptions): Promise<T> {
  return new FakeHttp(options).run(callback);
}
