import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { CreateBackgroundOperationsTable } from '../src/database/core/00000000_000046_create_background_operations_table.js';
import { BackgroundOperation } from '../src/operations/index.js';
import { ApplicationContext } from '../src/support/Context.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Queue } from '../src/queue/index.js';
import { Broadcast } from '../src/broadcasting/index.js';
import { Notification, Notifier } from '../src/notifications/index.js';
import { fakeQueue, fakeNotifications } from '../src/testing/index.js';

const name = 'export.report';
const rows = () => new QueryBuilder('background_operations');
const origin = <T>(callback: () => T) => ApplicationContext.runIsolated({ tenantId: 'team-one', teamId: 'team-one', actorId: 'owner', correlationId: 'request-one' }, callback);
beforeEach(async () => {
  Connection.configure({ default: 'default', connections: { default: { driver: 'sqlite', filename: ':memory:' } } });
  await new CreateBackgroundOperationsTable().up();
  Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
  Broadcast.configure({ default: 'sse', drivers: { sse: { driver: 'sse' } } });
});
afterEach(async () => { await Broadcast.drain(); Broadcast.prune(); await Connection.disconnect(); vi.restoreAllMocks(); ApplicationContext.clear(); });

describe('Durable background operation lifecycle', () => {
  it('captures origin, reports bounded progress, settles a result and exposes no input payload', async () => {
    const handled = vi.fn();
    BackgroundOperation.register(name, { handle: async (operation) => {
      handled(); expect(ApplicationContext.get('tenantId')).toBe('team-one');
      expect(ApplicationContext.get('actorId')).toBe('owner'); expect(ApplicationContext.get('correlationId')).toBe('request-one');
      expect(operation.payload).toEqual({ internal: 'input' });
      await operation.report(1); await operation.report(2);
      await expect(operation.report(1)).rejects.toThrow('cannot decrease');
      await expect(operation.report(3)).rejects.toThrow('progress');
      return { download: '/exports/one' };
    } });
    const created = await origin(() => BackgroundOperation.dispatch(name, { internal: 'input' }, { label: 'Report', total: 2, returnUrl: '/reports' }));
    expect(handled).not.toHaveBeenCalled(); expect(created.state).toBe('queued'); expect(created).not.toHaveProperty('payload');
    await ApplicationContext.runIsolated({ tenantId: 'other', actorId: 'operator' }, () => BackgroundOperation.process(created.id));
    expect(await origin(() => BackgroundOperation.find(created.id))).toMatchObject({ state: 'succeeded', progress: 2, result: { download: '/exports/one' } });
  });

  it('isolates queries and cancellation by both actor and tenant', async () => {
    BackgroundOperation.register(name, { handle: async () => null });
    const created = await origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Private report' }));
    await ApplicationContext.runIsolated({ tenantId: 'team-one', actorId: 'different' }, async () => {
      expect(await BackgroundOperation.find(created.id)).toBeNull(); expect((await BackgroundOperation.list()).data).toEqual([]);
      expect(await BackgroundOperation.cancel(created.id)).toBe(false);
    });
    await ApplicationContext.runIsolated({ tenantId: 'different', actorId: 'owner' }, async () => {
      expect(await BackgroundOperation.find(created.id)).toBeNull(); expect(await BackgroundOperation.cancel(created.id)).toBe(false);
    });
    expect(await origin(() => BackgroundOperation.cancel(created.id))).toBe(true);
    expect(await origin(() => BackgroundOperation.find(created.id))).toMatchObject({ state: 'cancelled' });
    expect(await BackgroundOperation.process(created.id)).toBe(false);
  });

  it('discards receipts and publication on rollback and uses explicit system queue context', async () => {
    BackgroundOperation.register(name, { handle: async () => null });
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    await fakeQueue(async (queue) => {
      await expect(origin(() => Connection.transaction(async () => {
        await BackgroundOperation.dispatch(name, {}, { label: 'Rolled back' });
        throw new Error('rollback');
      }))).rejects.toThrow('rollback');
      expect(await rows().count()).toBe(0); queue.assertNothingPushed();
      const created = await origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Committed' }));
      queue.assertPushed((entry) => entry.context && Object.keys(entry.context).length === 0 && entry.payload.includes(created.id));
    });
  });

  it('keeps durable work available when a queue producer stalls', async () => {
    BackgroundOperation.register(name, { handle: async () => null });
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    let release!: (id: string) => void;
    vi.spyOn(Queue, 'dispatch').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const created = await origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Broker outage' }));
    expect(created.state).toBe('queued'); release('wake');
    expect(await BackgroundOperation.sweep()).toBe(1);
    expect(await origin(() => BackgroundOperation.find(created.id))).toMatchObject({ state: 'succeeded' });
  });

  it('uses bounded retry attempts and redacts stored errors', async () => {
    BackgroundOperation.register(name, { maxAttempts: 2, retrySeconds: 1, handle: async () => { throw new Error('password=secret provider failed'); } });
    const created = await origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Retry' }));
    await BackgroundOperation.process(created.id);
    expect(await origin(() => BackgroundOperation.find(created.id))).toMatchObject({ state: 'queued', attempts: 1 });
    await rows().where('id', created.id).update({ available_at: Date.now() - 1 });
    await BackgroundOperation.process(created.id);
    const failed = await origin(() => BackgroundOperation.find(created.id));
    expect(failed).toMatchObject({ state: 'failed', attempts: 2 }); expect(failed!.error).not.toContain('secret');
  });

  it('recovers an expired worker lease while rejecting simultaneous double execution', async () => {
    const handler = vi.fn(async () => null); BackgroundOperation.register(name, { handle: handler });
    const created = await origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Recover' }));
    await rows().where('id', created.id).update({ state: 'running', lock_owner: 'dead-owner', locked_until: Date.now() - 1, attempts: 1 });
    const outcomes = await Promise.all([BackgroundOperation.process(created.id), BackgroundOperation.process(created.id)]);
    expect(outcomes.filter(Boolean)).toHaveLength(1); expect(handler).toHaveBeenCalledOnce();
    expect(await origin(() => BackgroundOperation.find(created.id))).toMatchObject({ state: 'succeeded', attempts: 2 });
  });

  it('cooperatively cancels running work and never settles a cancelled result as success', async () => {
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    BackgroundOperation.register(name, { handle: async (operation) => {
      entered(); await waiting; expect(await operation.isCancelled()).toBe(true); expect(operation.signal.aborted).toBe(true);
      return { shouldNotBeStored: true };
    } });
    const created = await origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Cancel' }));
    const processing = BackgroundOperation.process(created.id); await started;
    expect(await origin(() => BackgroundOperation.cancel(created.id))).toBe(true); release(); await processing;
    expect(await origin(() => BackgroundOperation.find(created.id))).toMatchObject({ state: 'cancelled', result: null });
  });

  it('paginates tied timestamps without skipping or repeating operations', async () => {
    BackgroundOperation.register(name, { handle: async () => null }); vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    for (let index = 0; index < 5; index++) await origin(() => BackgroundOperation.dispatch(name, {}, { label: String(index) }));
    const first = await origin(() => BackgroundOperation.list({ limit: 2 }));
    const second = await origin(() => BackgroundOperation.list({ limit: 2, cursor: first.meta.nextCursor! }));
    const third = await origin(() => BackgroundOperation.list({ limit: 2, cursor: second.meta.nextCursor! }));
    expect(new Set([...first.data, ...second.data, ...third.data].map((operation) => operation.id)).size).toBe(5);
    expect(third.meta.nextCursor).toBeNull();
  });

  it('retries a failed completion notification without rerunning the operation', async () => {
    class ReportReady extends Notification { channels() { return ['database']; } }
    let attempts = 0; const handler = vi.fn(async () => null);
    BackgroundOperation.register(name, { handle: handler, notify: async () => {
      if (++attempts === 1) throw new Error('notification unavailable');
      return { recipient: { getAttribute: () => 'owner' }, notification: new ReportReady() };
    } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const created = await origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Notify' }));
    await BackgroundOperation.process(created.id); expect(error).toHaveBeenCalled();
    expect((await rows().where('id', created.id).first()).notification_pending).toBe(1);
    await fakeNotifications(async (notifications) => { await BackgroundOperation.sweep(); notifications.assertCount(1); });
    expect((await rows().where('id', created.id).first()).notification_pending).toBe(0); expect(handler).toHaveBeenCalledOnce();
  });

  it('rejects missing identity, conflicting tenant context and non-local resource links', async () => {
    BackgroundOperation.register(name, { handle: async () => null });
    await expect(BackgroundOperation.dispatch(name, {}, { label: 'Anonymous' })).rejects.toThrow('actor');
    for (const returnUrl of ['https://outside.test', '//outside.test', '/%2foutside.test', '/\\outside.test']) {
      await expect(origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Bad URL', returnUrl }))).rejects.toThrow('local application path');
    }
    await expect(ApplicationContext.runIsolated({ teamId: 'one', tenantId: 'two', actorId: 'owner' }, () =>
      BackgroundOperation.dispatch(name, {}, { label: 'Bad tenant' }))).rejects.toThrow('inconsistent');
    expect(await rows().count()).toBe(0);
  });

  it('prunes only settled operations with completed notification delivery', async () => {
    BackgroundOperation.register(name, { handle: async () => null });
    const settled = await origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Old completed report' }));
    await BackgroundOperation.process(settled.id);
    const queued = await origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Waiting report' }));
    const pending = await origin(() => BackgroundOperation.dispatch(name, {}, { label: 'Waiting notification' }));
    await rows().where('id', pending.id).update({ state: 'succeeded', notification_pending: true });
    await rows().update({ updated_at: 1 });
    expect(await BackgroundOperation.prune(2)).toBe(1);
    expect(await origin(() => BackgroundOperation.find(settled.id))).toBeNull();
    expect(await origin(() => BackgroundOperation.find(queued.id))).not.toBeNull();
    expect(await origin(() => BackgroundOperation.find(pending.id))).not.toBeNull();
  });
});
