import { describe, expect, it, vi } from 'vitest';
import { EventDispatcher } from '../src/events/index';
import { type EventJson, type NamedEventEnvelope } from '../src/events/ContextEnvelope';
import { ApplicationContext } from '../src/support/Context';
import { FakeEvents } from '../src/testing/scoped-fakes';
import { Job, Queue } from '../src/queue';

describe('event origin context', () => {
  it('delivers regular, once and wildcard listeners from the same origin and restores it', async () => {
    const events = new EventDispatcher();
    class Created {}
    const observed: unknown[] = [];
    events.listen(Created, async () => {
      observed.push(ApplicationContext.snapshot());
      ApplicationContext.set('teamId', 'changed');
      await Promise.resolve();
    });
    events.once(Created, () => { observed.push(ApplicationContext.snapshot()); });
    events.onAny(() => { observed.push(ApplicationContext.snapshot()); });
    await ApplicationContext.runIsolated({ teamId: 'origin', actorId: 42 }, async () => {
      await events.dispatch(new Created());
      expect(ApplicationContext.snapshot()).toEqual({ teamId: 'origin', actorId: 42 });
    });
    expect(observed).toEqual(Array(3).fill({ teamId: 'origin', actorId: 42 }));
  });

  it('explicit system events never inherit unrelated tenant, actor or auth identity', async () => {
    const events = new EventDispatcher();
    class Maintenance {}
    const observed: unknown[] = [];
    events.listen(Maintenance, () => { observed.push(ApplicationContext.snapshot()); });
    events.listen('system.maintenance', () => { observed.push(ApplicationContext.snapshot()); });
    await ApplicationContext.runIsolated({ teamId: 'unrelated', actorId: 5, userId: 8 }, async () => {
      await events.dispatch(new Maintenance(), { context: {} });
      await events.emit('system.maintenance', null, { context: {} });
      expect(ApplicationContext.get('teamId')).toBe('unrelated');
    });
    expect(observed).toEqual([{}, {}]);
  });

  it('restores context on listener errors without swallowing the error', async () => {
    const events = new EventDispatcher();
    const error = new Error('listener');
    events.listen('billing.failed', async () => { ApplicationContext.set('actorId', 'changed'); await Promise.resolve(); throw error; });
    await ApplicationContext.runIsolated({ actorId: 'outer' }, async () => {
      await expect(events.emit('billing.failed', {}, { context: { actorId: 'event' } })).rejects.toBe(error);
      expect(ApplicationContext.get('actorId')).toBe('outer');
    });
  });

  it('keeps simultaneous and nested emissions isolated', async () => {
    const events = new EventDispatcher();
    const observed: unknown[] = [];
    events.listen('app.nested', () => { observed.push(ApplicationContext.get('teamId')); });
    events.listen('app.created', async () => {
      const origin = ApplicationContext.get('teamId');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(ApplicationContext.get('teamId')).toBe(origin);
      await events.emit('app.nested');
    });
    await Promise.all(['a', 'b', 'c'].map((teamId) => events.emit('app.created', null, { context: { teamId } })));
    expect(observed.sort()).toEqual(['a', 'b', 'c']);
  });

  it('captures named JSON once and replays without ambient worker identity', async () => {
    const producer = new EventDispatcher();
    const context = { teamId: 7, actorId: 'origin', correlationId: 'req', metadata: { value: 1 } };
    const payload = { invoiceId: 3, tags: ['new'] };
    const envelope = producer.capture('billing.invoice.created', payload, { context });
    context.teamId = 8;
    context.metadata.value = 2;
    payload.tags.push('mutated');
    const serialized = JSON.stringify(envelope);
    const consumer = new EventDispatcher();
    const observed: unknown[] = [];
    consumer.listen('billing.invoice.created', (value) => {
      expect(value).toEqual({ invoiceId: 3, tags: ['new'] });
      observed.push(ApplicationContext.snapshot());
      ApplicationContext.get('metadata').value = 99;
      ApplicationContext.set('actorId', 'changed');
    });
    consumer.onAny(() => { observed.push(ApplicationContext.snapshot()); });
    await ApplicationContext.runIsolated({ teamId: 'worker', actorId: 'other', userId: 'unrelated' }, async () => {
      await consumer.replay(JSON.parse(serialized));
      expect(ApplicationContext.snapshot()).toEqual({ teamId: 'worker', actorId: 'other', userId: 'unrelated' });
    });
    expect(observed[1]).toEqual({ teamId: 7, actorId: 'origin', correlationId: 'req', metadata: { value: 1 } });
    expect(envelope.context.metadata).toEqual({ value: 1 });
  });

  it('captures system context explicitly and rejects legacy envelopes missing context', async () => {
    const events = new EventDispatcher();
    const listener = vi.fn(() => { expect(ApplicationContext.snapshot()).toEqual({}); });
    events.listen('system.cleanup', listener);
    await ApplicationContext.runIsolated({ teamId: 1, actorId: 'worker' }, async () => {
      await events.replay(events.capture('system.cleanup', null, { context: {} }));
      await expect(events.replay({ version: 1, name: 'system.cleanup', payload: null } as never)).rejects.toThrow('explicit context');
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('takes replay origin synchronously before the caller can mutate it', async () => {
    const events = new EventDispatcher();
    const seen: unknown[] = [];
    events.listen('app.created', async () => { await Promise.resolve(); seen.push(ApplicationContext.get('actorId')); });
    const envelope = events.capture('app.created', null, { context: { actorId: 1 } });
    const replay = events.replay(envelope);
    envelope.context.actorId = 2;
    await replay;
    expect(seen).toEqual([1]);
  });

  it('an explicitly registered app job replays serialized envelopes without inheriting worker identity', async () => {
    const events = new EventDispatcher();
    const seen: unknown[] = [];
    class EnvelopeReplayJob extends Job {
      constructor(public envelope: NamedEventEnvelope = events.capture('test.empty', null, { context: {} })) { super(); }
      async handle(): Promise<void> { await events.replay(this.envelope); }
    }
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    Queue.register(EnvelopeReplayJob, { name: 'testing.explicit-envelope-replay' });
    events.listen('billing.created', () => { seen.push(ApplicationContext.snapshot()); });
    try {
      const captured = events.capture('billing.created', { id: 1 }, { context: { teamId: 'origin', actorId: 'creator' } });
      const job = new EnvelopeReplayJob();
      job.restore(JSON.parse(new EnvelopeReplayJob(captured).serialize()));
      await Queue.dispatch(job, { context: {} });
      await Queue.dispatch(new EnvelopeReplayJob(events.capture('billing.created', null, { context: {} })), { context: {} });
      await ApplicationContext.runIsolated({ teamId: 'worker-tenant', actorId: 'worker-actor', userId: 44 }, async () => {
        expect(await Queue.work({ maxJobs: 2, sleep: 0 })).toBe(2);
        expect(ApplicationContext.snapshot()).toEqual({ teamId: 'worker-tenant', actorId: 'worker-actor', userId: 44 });
      });
      expect(seen).toEqual([{ teamId: 'origin', actorId: 'creator' }, {}]);
    } finally {
      await Queue.clear();
      await Queue.stop();
      Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
    }
  });

  it('callback event fakes record the effective context and restore their interceptor on failure', async () => {
    const events = new EventDispatcher();
    const fake = new FakeEvents({ dispatcher: events });
    const listener = vi.fn();
    events.listen('app.created', listener);
    const error = new Error('callback');
    await expect(fake.run(async () => {
      await events.emit('app.created', 1, { context: { actorId: 'captured', teamId: 3 } });
      throw error;
    })).rejects.toBe(error);
    expect(fake.records()[0].context).toEqual({ actorId: 'captured', teamId: 3 });
    expect(listener).not.toHaveBeenCalled();
    await events.emit('app.created');
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('local class identity versus explicit transport names', () => {
  it('different classes with identical constructor names never share local listeners', async () => {
    const events = new EventDispatcher();
    const A = class Created {};
    const B = class Created {};
    const a = vi.fn();
    const b = vi.fn();
    events.listen(A, a);
    events.once(B, b);
    expect(events.listenerCount(A)).toBe(1);
    expect(events.listenerCount(B)).toBe(1);
    await events.dispatch(new A());
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    events.forget(A);
    expect(events.hasListeners(A)).toBe(false);
    expect(events.hasListeners(B)).toBe(true);
    await events.dispatch(new B());
    expect(b).toHaveBeenCalledOnce();
  });

  it('supports an unambiguous legacy provider string binding but rejects collisions', async () => {
    const events = new EventDispatcher();
    const A = class Created {};
    const B = class Created {};
    const legacy = vi.fn();
    events.listen('Created', legacy);
    await events.dispatch(new A());
    await expect(events.dispatch(new B())).rejects.toThrow('Ambiguous');
    expect(legacy).toHaveBeenCalledOnce();
  });

  it('rejects known ambiguous provider bridges before either module listener runs', async () => {
    const events = new EventDispatcher();
    const A = class Created {};
    const B = class Created {};
    const local = vi.fn();
    events.listen(A, local);
    events.listen(B, local);
    events.listen('Created', local);
    await expect(events.dispatch(new A())).rejects.toThrow('Ambiguous');
    expect(local).not.toHaveBeenCalled();
  });

  it('unsubscribed classes no longer manufacture name ambiguity', async () => {
    const events = new EventDispatcher();
    const A = class Created {};
    const B = class Created {};
    const unsubscribe = events.listen(A, () => {});
    unsubscribe();
    events.listen('Created', () => {});
    await events.dispatch(new B());
    events.flush();
    events.listen('Created', () => {});
    await events.dispatch(new A());
  });

  it('named replay does not instantiate or dispatch to local class listeners', async () => {
    const events = new EventDispatcher();
    class Created {}
    const local = vi.fn();
    const named = vi.fn();
    events.listen(Created, local);
    events.listen('billing.Created', named);
    await events.replay(events.capture('billing.Created', { id: 1 }, { context: {} }));
    expect(local).not.toHaveBeenCalled();
    expect(named).toHaveBeenCalledOnce();
  });

  it.each(['Created', '', 'app..created', 'app/created', 'app.created\n'])('rejects implicit or invalid transport namespace %j', (name) => {
    expect(() => new EventDispatcher().capture(name)).toThrow('namespaced');
  });

  it('once listeners are not repeated by recursive or concurrent named replay', async () => {
    const events = new EventDispatcher();
    const listener = vi.fn(async () => { await events.emit('app.once'); });
    events.once('app.once', listener);
    await Promise.all([events.emit('app.once'), events.emit('app.once')]);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('bounded transport data', () => {
  for (const [index, payload] of [NaN, Infinity, 1n, () => {}, new Date(), new Map(), [undefined]].entries()) it(`rejects non-JSON payload case ${index}`, () => {
    expect(() => new EventDispatcher().capture('app.created', payload as EventJson, { context: {} })).toThrow();
  });

  it('rejects cycles, getters, hidden/symbol properties and sparse arrays without running a serializer', () => {
    const events = new EventDispatcher();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    let read = false;
    const getter = { get value() { read = true; return 1; } };
    const serializer = { toJSON() { read = true; return {}; } };
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
    for (const payload of [cycle, getter, serializer, hidden, { [Symbol()]: 1 }, new Array(2)]) expect(() => events.capture('app.created', payload as EventJson)).toThrow();
    expect(read).toBe(false);
  });

  it('bounds nodes, depth and bytes before transport', () => {
    const events = new EventDispatcher();
    expect(() => events.capture('app.created', Array(10_001).fill(1))).toThrow('limit');
    expect(() => events.capture('app.created', 'x'.repeat(1_048_577))).toThrow('limit');
    let nested: EventJson = null;
    for (let i = 0; i < 35; i++) nested = { nested };
    expect(() => events.capture('app.created', nested)).toThrow('limit');
  });

  it('rejects nontransportable context, invalid identities and tenant alias disagreement', () => {
    const events = new EventDispatcher();
    for (const context of [{ actorId: {} }, { actorId: '' }, { teamId: 1, tenantId: 2 }, { report: () => {} }, { value: undefined }]) {
      expect(() => events.capture('app.created', null, { context })).toThrow();
    }
  });

  it('rejects invalid versions and contexts before any listener delivery', async () => {
    const events = new EventDispatcher();
    const listener = vi.fn();
    events.onAny(listener);
    for (const envelope of [null, { version: 2 }, { version: 1, name: 'app.created', payload: null, context: [] }]) {
      await expect(events.replay(envelope as never)).rejects.toThrow();
    }
    expect(listener).not.toHaveBeenCalled();
  });
});
