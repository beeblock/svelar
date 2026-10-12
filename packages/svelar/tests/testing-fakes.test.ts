import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { Event, EventDispatcher } from '../src/events/index.js';
import { Http, HttpCircuitOpenError, HttpClient, apiFetch, apiFetchJson, signedFetch } from '../src/http/index.js';
import { Mailer, Mailable, type MailMessage, type SendResult } from '../src/mail/index.js';
import { Notification, Notifier, type Notifiable } from '../src/notifications/index.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Job, Queue } from '../src/queue/index.js';
import {
  FakeEvents,
  FakeHttp,
  FakeMail,
  FakeNotifications,
  FakeQueue,
  fakeEvents,
  fakeHttp,
  fakeMail,
  fakeNotifications,
  fakeQueue,
} from '../src/testing/index.js';

const originalFetch = globalThis.fetch;
const handles = vi.fn();

class TestJob extends Job {
  constructor(public label: string) { super(); }
  async handle(): Promise<void> { handles(this.label); }
}

class TestEvent {
  constructor(public label: string) {}
}

class TestNotification extends Notification {
  constructor(public label: string) { super(); }
  channels(): string[] { return ['email', 'database', 'custom']; }
  toEmail(): never { throw new Error('Email rendering must not run.'); }
  toDatabase(): never { throw new Error('Database rendering must not run.'); }
  toChannel(): never { throw new Error('Custom rendering must not run.'); }
}

function user(id: number): Notifiable {
  return { getAttribute: (key) => key === 'id' ? id : undefined };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('scoped testing fakes', () => {
  beforeEach(() => {
    handles.mockClear();
    Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
    Event.flush();
    Notifier.configure();
    Mailer.configure({ default: 'null', mailers: { null: { driver: 'null' } } });
    globalThis.fetch = vi.fn(async () => { throw new Error('Real HTTP transport must not run.'); });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Event.flush();
    Notifier.configure();
    Mailer.configure({ default: 'null', mailers: { null: { driver: 'null' } } });
    Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
    vi.restoreAllMocks();
  });

  it('captures mail, mailables and existing named handles without resolving or replacing initialized transports', async () => {
    const primary = { send: vi.fn(async (): Promise<SendResult> => ({ accepted: [], rejected: [], messageId: 'primary' })) };
    const secondary = { send: vi.fn(async (): Promise<SendResult> => ({ accepted: [], rejected: [], messageId: 'secondary' })) };
    Mailer.configure({
      default: 'primary',
      from: { name: 'Tests', address: 'tests@example.test' },
      mailers: { primary: { driver: 'custom', transport: primary }, secondary: { driver: 'custom', transport: secondary } },
    });
    const named = Mailer.mailer('secondary');
    const initialized = Mailer.mailer('primary');
    const resolve = vi.spyOn(Mailer as any, 'resolveTransport');
    const message: MailMessage = {
      to: ['one@example.test'], cc: ['cc@example.test'], bcc: ['bcc@example.test'], subject: 'Scoped mail',
      tags: { flow: 'test' }, attachments: [{ filename: 'test.txt', content: Buffer.from('original') }],
    };
    class WelcomeMail extends Mailable {
      build(): this { return this.to('welcome@example.test').subject('Welcome').text('Hello'); }
    }
    let createdInside!: ReturnType<typeof Mailer.mailer>;
    await fakeMail(async (mail) => {
      mail.assertNothingSent();
      const result = await Mailer.send(message);
      result.accepted.push('caller-mutation');
      message.to = ['mutated@example.test'];
      (message.cc as string[]).push('mutated');
      (message.bcc as string[]).push('mutated');
      message.tags!.flow = 'mutated';
      (message.attachments![0].content as Buffer).fill(0);
      await named.send({ to: 'named@example.test', subject: 'Named', from: 'explicit@example.test' });
      await Mailer.sendMailable(new WelcomeMail(), 'secondary');
      createdInside = Mailer.mailer('primary');
      await createdInside.send({ to: 'inside@example.test', subject: 'Inside handle' });
      await Mailer.mailer('unconfigured').send({ to: 'fake@example.test', subject: 'Unconfigured' });
      mail.assertCount(5);
      mail.assertCount(2, (record) => record.mailer === 'secondary');
      mail.assertSent((record) => record.mailer === 'primary' && record.message.subject === 'Scoped mail');
      mail.assertNotSent((record) => record.message.subject === 'Missing');
      expect(mail.sent()[0]).toMatchObject({
        mailer: 'primary',
        message: {
          to: ['one@example.test'], cc: ['cc@example.test'], bcc: ['bcc@example.test'],
          from: { name: 'Tests', address: 'tests@example.test' }, tags: { flow: 'test' },
        },
        result: { accepted: ['one@example.test'], rejected: [], messageId: 'fake-1' },
      });
      expect(mail.sent()[0].message.attachments![0].content.toString()).toBe('original');
      expect(mail.sent()[1].message.from).toBe('explicit@example.test');
      expect(resolve).not.toHaveBeenCalled();
      expect(primary.send).not.toHaveBeenCalled();
      expect(secondary.send).not.toHaveBeenCalled();
    });
    const originalMessage = { to: 'real@example.test', subject: 'Real' };
    expect((await initialized.send(originalMessage)).messageId).toBe('primary');
    expect((await createdInside.send(originalMessage)).messageId).toBe('primary');
    expect((await Mailer.send(originalMessage)).messageId).toBe('primary');
    expect((await named.send(originalMessage)).messageId).toBe('secondary');
    expect(primary.send).toHaveBeenCalledTimes(3);
    expect(secondary.send).toHaveBeenCalledTimes(1);
    expect(primary.send).toHaveBeenCalledWith(expect.objectContaining({ from: { name: 'Tests', address: 'tests@example.test' } }));
  });

  it('intercepts notification email delivery without changing mail configuration', async () => {
    const transport = { send: vi.fn(async (): Promise<SendResult> => ({ accepted: [], rejected: [] })) };
    Mailer.configure({ default: 'custom', mailers: { custom: { driver: 'custom', transport } } });
    class EmailNotification extends Notification {
      channels(): string[] { return ['email']; }
      toEmail() { return { to: 'notify@example.test', subject: 'Notification', text: 'Hello' }; }
    }
    await fakeMail(async (mail) => {
      await Notifier.notify(user(1), new EmailNotification());
      mail.assertSent((record) => record.message.to === 'notify@example.test');
    });
    expect(transport.send).not.toHaveBeenCalled();
    await Notifier.notify(user(1), new EmailNotification());
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('restores enclosing mail fakes after nested errors and keeps mail predicates and reset consistent', async () => {
    const message = { to: 'test@example.test', subject: 'Test' };
    await fakeMail(async (outer) => {
      await Mailer.send(message);
      await expect(fakeMail(async (inner) => {
        await Mailer.send(message);
        inner.assertCount(1);
        throw new Error('inner failure');
      })).rejects.toThrow('inner failure');
      await Mailer.send(message);
      outer.assertCount(2);
      expect(() => outer.assertSent(() => false)).toThrow('Expected mail');
      expect(() => outer.assertNotSent(() => true)).toThrow('Unexpected mail');
      expect(() => outer.assertNothingSent()).toThrow('Expected no mail');
      outer.reset();
      outer.assertNothingSent();
      await Mailer.send(message);
      expect(outer.sent()[0].result.messageId).toBe('fake-3');
    });
    expect((await Mailer.send(message)).messageId).toBeUndefined();
  });

  it('isolates overlapping mail scopes and restores the original transport after callback errors', async () => {
    const send = vi.fn(async (): Promise<SendResult> => ({ accepted: [], rejected: [], messageId: 'real' }));
    Mailer.configure({ default: 'custom', mailers: { custom: { driver: 'custom', transport: { send } } } });
    const firstEntered = deferred();
    const secondEntered = deferred();
    const releaseSecond = deferred();
    const first = fakeMail(async (mail) => {
      firstEntered.resolve();
      await secondEntered.promise;
      await Mailer.send({ to: 'first@example.test', subject: 'First' });
      mail.assertCount(1);
      mail.assertSent((record) => record.message.subject === 'First');
    });
    await firstEntered.promise;
    const second = fakeMail(async (mail) => {
      secondEntered.resolve();
      await releaseSecond.promise;
      await Mailer.send({ to: 'second@example.test', subject: 'Second' });
      mail.assertCount(1);
      mail.assertSent((record) => record.message.subject === 'Second');
    });
    try {
      await first;
      await Mailer.send({ to: 'outside@example.test', subject: 'Outside' });
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      releaseSecond.resolve();
      await second;
    }
    for (const callback of [() => { throw new Error('mail failure'); }, async () => { await Promise.resolve(); throw new Error('mail failure'); }]) {
      await expect(fakeMail(callback)).rejects.toThrow('mail failure');
    }
    await Mailer.send({ to: 'after@example.test', subject: 'After' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('captures dispatch, synchronous dispatch and chains without executing jobs or resolving a driver', async () => {
    Queue.configure({ default: 'db', connections: { db: { driver: 'database' } } });
    const resolve = vi.spyOn(Queue as any, 'resolveDriver');
    const insert = vi.spyOn(QueryBuilder.prototype, 'insert').mockRejectedValue(new Error('Database side effect'));
    const metadata = { source: { name: 'test' } };
    await fakeQueue(async (queue) => {
      queue.assertNothingPushed();
      const job = new TestJob('queued');
      const id = await Queue.dispatch(job, {
        jobId: 'test-id', queue: 'emails', delay: 5, maxAttempts: 7, priority: 2, deduplicate: true, metadata,
      });
      job.label = 'mutated';
      metadata.source.name = 'mutated';
      await Queue.dispatchSync(new TestJob('sync'));
      await Queue.chain([new TestJob('first'), new TestJob('second')], { queue: 'chain' });
      expect(id).toBe('test-id');
      expect(queue.pushed()[0]).toMatchObject({
        id, job, jobClass: 'TestJob', mode: 'async', queue: 'emails', maxAttempts: 7, priority: 2,
        deduplicate: true, metadata: { source: { name: 'test' } },
      });
      expect(JSON.parse(queue.pushed()[0].payload).label).toBe('queued');
      expect(queue.pushed()[0].availableAt - queue.pushed()[0].createdAt).toBeGreaterThanOrEqual(4990);
      expect(queue.pushed()[1].mode).toBe('sync');
      expect(queue.pushed()[2].jobClass).toBe('ChainedJob');
      expect(JSON.parse(queue.pushed()[2].payload).jobs).toHaveLength(2);
      queue.assertPushed((record) => record.queue === 'emails');
      queue.assertNotPushed((record) => record.queue === 'other');
      queue.assertCount(1, (record) => record.mode === 'sync');
      queue.assertCount(3);
    });
    expect(handles).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('preserves the initialized queue driver and its pending jobs', async () => {
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    await Queue.dispatch(new TestJob('before'));
    await fakeQueue(async () => {
      await Queue.dispatch(new TestJob('fake'));
      await Queue.dispatchSync(new TestJob('fake-sync'));
      expect(await Queue.size()).toBe(1);
    });
    await Queue.dispatch(new TestJob('after'));
    expect(await Queue.size()).toBe(2);
    expect(await Queue.work({ maxJobs: 2, sleep: 0 })).toBe(2);
    expect(handles.mock.calls).toEqual([['before'], ['after']]);
  });

  it('captures typed and named events while preserving regular, once and wildcard listeners', async () => {
    const listener = vi.fn();
    const once = vi.fn();
    const wildcard = vi.fn();
    Event.listen(TestEvent, listener);
    Event.once(TestEvent, once);
    Event.onAny(wildcard);
    const event = new TestEvent('test');
    await fakeEvents(async (events) => {
      events.assertNothingDispatched();
      await Event.dispatch(event);
      await Event.emit('named', { value: 3 });
      await Event.emit('empty');
      events.assertDispatched((record) => record.event === event && record.name === 'TestEvent');
      events.assertNotDispatched((record) => record.name === 'missing');
      events.assertCount(3);
      expect(events.dispatched()[1].event).toEqual({ value: 3 });
      expect(events.dispatched()[2].event).toBeUndefined();
      expect(Event.listenerCount(TestEvent)).toBe(2);
      expect(listener).not.toHaveBeenCalled();
      expect(once).not.toHaveBeenCalled();
      expect(wildcard).not.toHaveBeenCalled();
    });
    await Event.dispatch(event);
    await Event.dispatch(event);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(once).toHaveBeenCalledTimes(1);
    expect(wildcard).toHaveBeenCalledTimes(2);
  });

  it('supports independently scoped local event dispatchers', async () => {
    const local = new EventDispatcher();
    await fakeEvents(async (outer) => {
      await fakeEvents(async (inner) => {
        await Event.emit('global');
        await local.emit('local');
        inner.assertCount(1);
      }, { dispatcher: local });
      outer.assertCount(1);
      outer.assertDispatched((record) => record.name === 'global');
    });
  });

  it('captures every recipient and explicit channels without mail, database or custom delivery', async () => {
    const mail = vi.spyOn(Mailer, 'send').mockRejectedValue(new Error('Mail side effect'));
    const insert = vi.spyOn(QueryBuilder.prototype, 'insert').mockRejectedValue(new Error('Database side effect'));
    const custom = vi.fn(async () => {});
    Notifier.extend('custom', { send: custom });
    const one = user(1);
    const two = user(2);
    const notification = new TestNotification('test');
    const channels = ['unconfigured'];
    await fakeNotifications(async (notifications) => {
      notifications.assertNothingSent();
      await Notifier.notify([one, two], notification);
      await Notifier.notifyVia(one, notification, channels);
      channels.push('mutated');
      notifications.assertSent((record) => record.notifiable === two && record.notification === notification);
      notifications.assertNotSent((record) => record.channels.includes('mutated'));
      notifications.assertCount(2, (record) => record.channels.includes('database'));
      notifications.assertCount(3);
      expect(notifications.sent()[2].channels).toEqual(['unconfigured']);
    });
    expect(mail).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(custom).not.toHaveBeenCalled();
    await Notifier.notifyVia(one, notification, ['custom']);
    expect(custom).toHaveBeenCalledWith(one, notification);
    await expect(Notifier.notifyVia(one, notification, ['unconfigured'])).rejects.toThrow('not configured');
  });

  it('fakes pre-existing and fluent HTTP clients plus apiFetch without replacing global fetch', async () => {
    const fetch = globalThis.fetch;
    const client = new HttpClient({ baseUrl: 'https://api.example.test' });
    const response = json({ id: 7 }, 201);
    await fakeHttp(async (http) => {
      http.assertNothingSent();
      http.respond((record) => record.method === 'POST' && record.url.endsWith('/users?active=true'), response);
      http.respondWith(json({ ready: true }));
      const result = await client.withToken('test-token').query({ active: true }).post('/users', { name: 'Test' });
      expect(result).toMatchObject({ data: { id: 7 }, status: 201 });
      await client.query({ active: true }).post('/users', { name: 'Second' });
      expect((await Http.get('https://api.example.test/ready')).data).toEqual({ ready: true });
      expect((await apiFetchJson('/ready', { showToast: false })).data).toEqual({ ready: true });
      await signedFetch('/signed', { method: 'POST', body: '{}', signingSecret: 'test-secret', showToast: false });
      http.assertSent((record) => record.headers.get('authorization') === 'Bearer test-token'
        && JSON.parse(record.body!).name === 'Test');
      http.assertNotSent((record) => record.method === 'DELETE');
      http.assertSent((record) => record.url === '/signed' && record.headers.has('x-signature'));
      http.assertCount(2, (record) => record.response?.status === 201);
      http.assertCount(5);
      expect(globalThis.fetch).toBe(fetch);
      expect(response.bodyUsed).toBe(false);
      expect(http.requests()[0].response?.headers.get('content-type')).toBe('application/json');
    });
    expect(fetch).not.toHaveBeenCalled();
    await expect(client.get('/outside')).rejects.toThrow('Real HTTP transport must not run');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('captures normalized form bodies and errors for unmatched requests without network fallback', async () => {
    await fakeHttp(async (http) => {
      await expect(Http.get('https://api.example.test/missing')).rejects.toThrow('No fake HTTP response matched');
      expect(http.requests()[0].error).toBeInstanceOf(Error);
      http.respondWith(new Response('ok'));
      const body = new URLSearchParams({ name: 'A B' });
      expect(await (await apiFetch('/form', { method: 'POST', body, showToast: false })).text()).toBe('ok');
      expect(http.requests()[1].body).toBe('name=A+B');
      expect(http.requests()[1].headers.get('content-type')).toContain('application/x-www-form-urlencoded');
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('retains retry and request/response hook behavior with fake responses', async () => {
    const sleep = vi.fn(async () => {});
    const before = vi.fn();
    const after = vi.fn();
    await fakeHttp(async (http) => {
      http.respondWith(() => json({ attempt: http.count() }, http.count() === 1 ? 503 : 200));
      const response = await Http.retry({ times: 1, delay: 0, sleep })
        .beforeRequest(before).afterResponse(after).get('https://api.example.test/retry');
      expect(response.data).toEqual({ attempt: 2 });
      http.assertCount(2);
    });
    expect(before).toHaveBeenCalledTimes(2);
    expect(after).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('honors abort signals and HttpClient timeouts without leaking abort listeners', async () => {
    await fakeHttp(async (http) => {
      const controller = new AbortController();
      controller.abort();
      await expect(apiFetch('/abort', { signal: controller.signal, showToast: false })).rejects.toMatchObject({ name: 'AbortError' });
      http.respondWith(() => new Promise<Response>(() => {}));
      await expect(Http.timeout(5).get('https://api.example.test/timeout')).rejects.toThrow('Request timed out');
      http.assertCount(2);
      expect(http.requests().every((record) => record.error instanceof Error)).toBe(true);
    });
    await fakeHttp(async (http) => {
      const controller = new AbortController();
      const added = vi.spyOn(controller.signal, 'addEventListener');
      const removed = vi.spyOn(controller.signal, 'removeEventListener');
      const entered = deferred();
      http.respondWith(() => { entered.resolve(); return new Promise<Response>(() => {}); });
      const pending = apiFetch('/abort-during-response', { signal: controller.signal, showToast: false });
      await entered.promise;
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(added).toHaveBeenCalledTimes(1);
      expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0][1]);
    });
  });

  it('keeps fake circuit-breaker failures out of the original runtime', async () => {
    const client = Http.circuitBreaker({ key: 'fake-circuit-isolation', failureThreshold: 1, cooldown: 60_000 });
    await fakeHttp(async (http) => {
      http.respondWith(json({ unavailable: true }, 503));
      await expect(client.get('https://circuit.example.test')).rejects.toThrow('HTTP 503');
      await expect(client.get('https://circuit.example.test')).rejects.toBeInstanceOf(HttpCircuitOpenError);
      http.assertCount(1);
    });
    globalThis.fetch = vi.fn(async () => json({ real: true }));
    expect((await client.get('https://circuit.example.test')).data).toEqual({ real: true });
  });

  it('does not close or overwrite a pre-existing real circuit breaker', async () => {
    globalThis.fetch = vi.fn(async () => json({}, 503));
    const client = Http.circuitBreaker({ key: 'real-circuit-isolation', failureThreshold: 1, cooldown: 60_000 });
    await expect(client.get('https://real-circuit.example.test')).rejects.toThrow('HTTP 503');
    await fakeHttp(async (http) => {
      http.respondWith(json({ fake: true }));
      expect((await client.get('https://real-circuit.example.test')).data).toEqual({ fake: true });
    });
    await expect(client.get('https://real-circuit.example.test')).rejects.toBeInstanceOf(HttpCircuitOpenError);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001);
    globalThis.fetch = vi.fn(async () => json({ restored: true }));
    await client.get('https://real-circuit.example.test');
  });

  it('restores every runtime after synchronous and asynchronous callback failures', async () => {
    const listener = vi.fn();
    Event.listen(TestEvent, listener);
    const send = vi.fn(async () => {});
    Notifier.extend('custom', { send });
    const error = new Error('scope failure');
    for (const run of [fakeQueue, fakeEvents, fakeNotifications, fakeHttp, fakeMail]) {
      await expect(run(() => { throw error; })).rejects.toBe(error);
      await expect(run(async () => { await Promise.resolve(); throw error; })).rejects.toBe(error);
    }
    await Queue.dispatch(new TestJob('restored'));
    await Queue.dispatchSync(new TestJob('restored-sync'));
    await Event.dispatch(new TestEvent('restored'));
    await Notifier.notifyVia(user(1), new TestNotification('restored'), ['custom']);
    await expect(apiFetch('/restored', { showToast: false })).rejects.toThrow('Real HTTP transport must not run');
    expect(handles).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('supports nested scopes and returns callback values without cross-capturing', async () => {
    const result = await fakeQueue(async (queue) => fakeEvents(async (events) => fakeNotifications(async (notifications) => fakeHttp(async (http) => {
      http.respondWith(json({ scope: 'outer' }));
      await Queue.dispatch(new TestJob('outer-before'));
      await fakeQueue(async (inner) => {
        await Queue.dispatch(new TestJob('inner'));
        inner.assertCount(1);
      });
      await fakeEvents(async (inner) => {
        await Event.dispatch(new TestEvent('inner'));
        inner.assertCount(1);
      });
      await fakeNotifications(async (inner) => {
        await Notifier.notify(user(2), new TestNotification('inner'));
        inner.assertCount(1);
      });
      await fakeHttp(async (inner) => {
        inner.respondWith(json({ scope: 'inner' }));
        expect((await Http.get('https://scope.example.test')).data.scope).toBe('inner');
        inner.assertCount(1);
      });
      await Queue.dispatch(new TestJob('outer-after'));
      await Event.emit('outer');
      await Notifier.notify(user(1), new TestNotification('outer'));
      expect((await Http.get('https://scope.example.test')).data.scope).toBe('outer');
      queue.assertCount(2);
      events.assertCount(1);
      notifications.assertCount(1);
      http.assertCount(1);
      return 'callback-result';
    }))));
    expect(result).toBe('callback-result');
    expect(handles).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('isolates overlapping async scopes even when they tear down out of installation order', async () => {
    const firstEntered = deferred();
    const secondEntered = deferred();
    const releaseSecond = deferred();
    const run = (label: string, wait: () => Promise<void>) => fakeQueue(async (queue) => fakeEvents(async (events) =>
      fakeNotifications(async (notifications) => fakeHttp(async (http) => {
        http.respondWith(json({ label }));
        await wait();
        await Queue.dispatch(new TestJob(label));
        await Event.dispatch(new TestEvent(label));
        await Notifier.notify(user(label === 'first' ? 1 : 2), new TestNotification(label));
        expect((await Http.get('https://concurrent.example.test')).data.label).toBe(label);
        queue.assertCount(1);
        events.assertCount(1);
        notifications.assertCount(1);
        http.assertCount(1);
        expect(queue.pushed()[0].job).toMatchObject({ label });
        expect(events.dispatched()[0].event).toMatchObject({ label });
        expect(notifications.sent()[0].notification).toMatchObject({ label });
      }))));
    const first = run('first', async () => { firstEntered.resolve(); await secondEntered.promise; });
    await firstEntered.promise;
    const second = run('second', async () => { secondEntered.resolve(); await releaseSecond.promise; });
    try {
      await first;
      await Queue.dispatchSync(new TestJob('outside'));
      expect(handles).toHaveBeenCalledWith('outside');
    } finally {
      releaseSecond.resolve();
      await second;
    }
    await Queue.dispatchSync(new TestJob('after-both'));
    expect(handles).toHaveBeenCalledWith('after-both');
  });

  it('provides descriptive predicate/count failures and resettable records', async () => {
    await fakeQueue(async (queue) => {
      await Queue.dispatch(new TestJob('test'));
      expect(() => queue.assertPushed(() => false)).toThrow('Expected job was not pushed');
      expect(() => queue.assertNotPushed(() => true, 'custom failure')).toThrow('custom failure');
      expect(() => queue.assertNothingPushed()).toThrow('Expected no jobs pushed');
      expect(() => queue.assertCount(2)).toThrow('captured 1');
      queue.pushed().pop();
      queue.assertCount(1);
      queue.reset();
      queue.assertNothingPushed();
    });
    await fakeEvents(async (events) => {
      await Event.emit('test');
      expect(() => events.assertDispatched(() => false)).toThrow('Expected event');
      expect(() => events.assertNotDispatched(() => true)).toThrow('Unexpected event');
      expect(() => events.assertNothingDispatched()).toThrow('Expected no events');
      events.reset();
      events.assertNothingDispatched();
    });
    await fakeNotifications(async (notifications) => {
      await Notifier.notify(user(1), new TestNotification('test'));
      expect(() => notifications.assertSent(() => false)).toThrow('Expected notification');
      expect(() => notifications.assertNotSent(() => true)).toThrow('Unexpected notification');
      expect(() => notifications.assertNothingSent()).toThrow('Expected no notifications');
      notifications.reset();
      notifications.assertNothingSent();
    });
    await fakeHttp(async (http) => {
      http.respondWith(json({}));
      await Http.get('https://assertions.example.test');
      expect(() => http.assertSent(() => false)).toThrow('Expected HTTP request');
      expect(() => http.assertNotSent(() => true)).toThrow('Unexpected HTTP request');
      expect(() => http.assertNothingSent()).toThrow('Expected no HTTP requests');
      http.reset();
      http.assertNothingSent();
    });
  });

  it('fails closed at record limits for all fakes and tears down after overflow', async () => {
    const listener = vi.fn();
    Event.listen('limited', listener);
    await expect(fakeQueue(async () => {
      await Queue.dispatch(new TestJob('first'));
      await Queue.dispatchSync(new TestJob('overflow'));
    }, { maxRecords: 1 })).rejects.toThrow('Fake record limit (1) exceeded');
    await expect(fakeMail(async () => {
      await Mailer.send({ to: 'one@example.test', subject: 'First' });
      await Mailer.send({ to: 'two@example.test', subject: 'Overflow' });
    }, { maxRecords: 1 })).rejects.toThrow('Fake record limit (1) exceeded');
    await expect(fakeEvents(async () => {
      await Event.emit('limited');
      await Event.emit('limited');
    }, { maxRecords: 1 })).rejects.toThrow('Fake record limit (1) exceeded');
    await expect(fakeNotifications(async () => {
      await Notifier.notify([user(1), user(2)], new TestNotification('limited'));
    }, { maxRecords: 1 })).rejects.toThrow('Fake record limit (1) exceeded');
    await expect(fakeHttp(async (http) => {
      http.respondWith(json({}));
      await Http.get('https://limit.example.test');
      await Http.get('https://limit.example.test');
    }, { maxRecords: 1 })).rejects.toThrow('Fake record limit (1) exceeded');
    expect(handles).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await Event.emit('limited');
    await Queue.dispatchSync(new TestJob('restored'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(handles).toHaveBeenCalledTimes(1);
  });

  it('validates record limits and rejects re-entrant use of the same fake', async () => {
    for (const Fake of [FakeQueue, FakeEvents, FakeNotifications, FakeHttp, FakeMail]) {
      for (const maxRecords of [0, -1, 1.5, Infinity, NaN]) {
        expect(() => new Fake({ maxRecords })).toThrow('positive safe integer');
      }
    }
    const queue = new FakeQueue();
    await queue.run(async () => {
      await expect(queue.run(() => {})).rejects.toThrow('already has an active scope');
      await Queue.dispatch(new TestJob('still active'));
    });
    await queue.run(async () => { await Queue.dispatch(new TestJob('reused')); });
    queue.assertCount(2);
  });

  it('keeps pre-existing test hooks intact and allows idempotent out-of-order hook teardown', async () => {
    const original = vi.fn(() => true);
    const restore = Queue.interceptForTesting(original);
    const restoreOther = Queue.interceptForTesting(() => false);
    try {
      await fakeQueue(async (queue) => {
        await Queue.dispatch(new TestJob('fake'));
        queue.assertCount(1);
        expect(original).not.toHaveBeenCalled();
      });
      restoreOther();
      restoreOther();
      await Queue.dispatch(new TestJob('original hook'));
      expect(original).toHaveBeenCalledTimes(1);
    } finally {
      restore();
      restoreOther();
    }
    await Queue.dispatchSync(new TestJob('real'));
    expect(handles).toHaveBeenCalledWith('real');
  });

  it('shares scoped interception across independently built package entries and releases every registration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-fake-bundles-'));
    try {
      await build({
        entryPoints: {
          testing: 'src/testing/index.ts',
          queue: 'src/queue/index.ts',
          events: 'src/events/index.ts',
          notifications: 'src/notifications/index.ts',
          http: 'src/http/index.ts',
          mail: 'src/mail/index.ts',
        },
        outdir: root,
        outExtension: { '.js': '.mjs' },
        bundle: true,
        splitting: false,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        packages: 'external',
        logLevel: 'silent',
      });
      const script = `
        import assert from 'node:assert/strict';
        import { pathToFileURL } from 'node:url';
        const load = (name) => import(pathToFileURL(process.argv[1] + '/' + name + '.mjs').href);
        const { fakeQueue, fakeEvents, fakeNotifications, fakeHttp, fakeMail } = await load('testing');
        const { Queue, Job } = await load('queue');
        const { Event } = await load('events');
        const { Notifier, Notification } = await load('notifications');
        const { Http, apiFetch } = await load('http');
        const { Mailer } = await load('mail');
        let handled = 0, listened = 0, delivered = 0, fetched = 0, mailed = 0;
        class TestJob extends Job { async handle() { handled++; } }
        class TestNotification extends Notification { channels() { return ['custom']; } }
        const target = { getAttribute() { return 1; } };
        Event.listen('test', () => { listened++; });
        Notifier.extend('custom', { async send() { delivered++; } });
        Mailer.configure({ default: 'custom', mailers: { custom: { driver: 'custom', transport: {
          async send() { mailed++; return { accepted: [], rejected: [] }; }
        } } } });
        const named = Mailer.mailer('custom');
        globalThis.fetch = async () => { fetched++; return new Response('real'); };
        for (let iteration = 0; iteration < 3; iteration++) {
          await fakeMail(mail => fakeQueue(queue => fakeEvents(events => fakeNotifications(notifications => fakeHttp(async http => {
            http.respondWith(new Response('fake'));
            await Queue.dispatch(new TestJob());
            await Queue.dispatchSync(new TestJob());
            await Event.emit('test');
            await Notifier.notify(target, new TestNotification());
            await Mailer.send({ to: 'bundle@example.test', subject: 'Bundle' });
            await named.send({ to: 'bundle@example.test', subject: 'Named' });
            assert.equal((await Http.get('https://bundle.example.test')).data, 'fake');
            assert.equal(await (await apiFetch('/bundle')).text(), 'fake');
            queue.assertCount(2); events.assertCount(1); notifications.assertCount(1); http.assertCount(2); mail.assertCount(2);
          })))));
          assert.equal(Queue.testingInterceptors.size, 0);
          assert.equal(Event.testingInterceptors.size, 0);
          assert.equal(Notifier.testingInterceptors.size, 0);
          assert.equal(globalThis[Symbol.for('svelar.http.testing-resolvers')].size, 0);
          assert.equal(Mailer.testingResolvers.size, 0);
        }
        assert.deepEqual([handled, listened, delivered, fetched, mailed], [0, 0, 0, 0, 0]);
        await Queue.dispatchSync(new TestJob());
        await Event.emit('test');
        await Notifier.notify(target, new TestNotification());
        await named.send({ to: 'real@example.test', subject: 'Real' });
        assert.equal((await Http.get('https://bundle.example.test')).data, 'real');
        assert.deepEqual([handled, listened, delivered, fetched, mailed], [1, 1, 1, 1, 1]);
        console.log('scoped fake bundles: PASS');
      `;
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, root], { timeout: 10_000 });
      expect(stdout).toContain('scoped fake bundles: PASS');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
