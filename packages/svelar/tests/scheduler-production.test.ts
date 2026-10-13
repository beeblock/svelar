import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { CreateSchedulerLocksTable } from '../src/database/core/00000000_000024_create_scheduler_locks_table.js';
import { CreateScheduledTaskRunsTable } from '../src/database/core/00000000_000025_create_scheduled_task_runs_table.js';
import { CreateScheduledTaskSettingsTable } from '../src/database/core/00000000_000028_create_scheduled_task_settings_table.js';
import { AddSchedulerSettingsPolicy } from '../src/database/core/00000000_000044_add_scheduler_settings_policy.js';
import { CreateSchedulerRuntimeTable } from '../src/database/core/00000000_000047_create_scheduler_runtime_table.js';
import { CreateSchedulerRequestsTable } from '../src/database/core/00000000_000048_create_scheduler_requests_table.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { ScheduleMonitor } from '../src/scheduler/ScheduleMonitor.js';
import { Scheduler, SchedulerLock, task, type SchedulerOptions } from '../src/scheduler/index.js';
import { ApplicationContext } from '../src/support/Context.js';

const minute = new Date('2026-10-14T12:00:00Z');
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.sequential('Production scheduler durable runtime', () => {
  let root: string;
  const workers: Scheduler[] = [];
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-production-'));
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: join(root, 'runtime.sqlite') } } });
    await new CreateSchedulerLocksTable().up();
    await new CreateScheduledTaskRunsTable().up();
    await new CreateScheduledTaskSettingsTable().up();
    await new AddSchedulerSettingsPolicy().up();
    await new CreateSchedulerRuntimeTable().up();
    await new CreateSchedulerRequestsTable().up();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const worker of workers.splice(0)) await worker.stop();
    vi.restoreAllMocks();
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });
  function worker(options: SchedulerOptions = {}): Scheduler {
    const value = new Scheduler({ persistent: true, timezone: 'UTC', heartbeatMilliseconds: 20, ...options });
    workers.push(value);
    return value;
  }

  it('upgrades old disabled settings without changing global task keys', async () => {
    await new AddSchedulerSettingsPolicy().down();
    await new QueryBuilder('scheduled_task_settings').insert({ task: 'legacy', enabled: false, updated_at: new Date().toISOString() });
    await new AddSchedulerSettingsPolicy().up();
    const app = worker().register(task('legacy', async () => {}));
    expect((await app.listTaskStatuses())[0].enabled).toBe(false);
    expect(await app.run(minute)).toEqual([]);
    expect(await new QueryBuilder('scheduled_task_settings').where('task', 'legacy').first()).toMatchObject({ task_name: 'legacy', enabled: 0, tenant_id: null });
  });

  it('shares enable/disable and next/last execution state after a process restart', async () => {
    let calls = 0;
    const web = worker().register(task('probe', async () => {}));
    const daemon = worker().register(task('probe', async () => { calls++; }));
    await web.configureTask('probe', { enabled: false });
    expect(await daemon.run(minute)).toEqual([]);
    await web.configureTask('probe', { enabled: true });
    expect(await daemon.run(minute)).toEqual([]);
    await daemon.run(new Date(minute.getTime() + 60000));
    const restarted = worker().register(task('probe', async () => {}));
    const [status] = await restarted.listTaskStatuses();
    expect(calls).toBe(1);
    expect(status.enabled).toBe(true);
    expect(status.lastRun).toBeInstanceOf(Date);
    expect(status.nextRun).toEqual(new Date(minute.getTime() + 120000));
    expect(status.lockOwner).toBeNull();
  });

  it('enqueues run-now without inline execution and consumes one request across competing workers', async () => {
    let calls = 0;
    const web = worker().register(task('manual', async () => { throw new Error('must not execute in web'); }, (job) => job.daily()));
    const first = worker().register(task('manual', async () => { calls++; }, (job) => job.daily()));
    const second = worker().register(task('manual', async () => { calls++; }, (job) => job.daily()));
    const request = await web.requestRun('manual');
    expect(request.state).toBe('pending');
    expect(calls).toBe(0);
    await Promise.all([first.run(minute), second.run(minute)]);
    expect(calls).toBe(1);
    expect(await web.getRunRequest('manual', request.id)).toMatchObject({ state: 'succeeded', attempts: 1, owner: null });
    expect(await new QueryBuilder('scheduled_task_runs').where('task', 'manual').get()).toHaveLength(1);
  });

  it('consumes a queued command exactly once across separate worker processes', async () => {
    const web = worker().register(task('process-probe', async () => {}, (job) => job.daily()));
    const request = await web.requestRun('process-probe');
    const bundle = await mkdtemp(resolve('.test-scheduler-production-process-'));
    try {
      const file = join(bundle, 'worker.mjs');
      await build({
        stdin: { resolveDir: process.cwd(), sourcefile: 'scheduler-production-worker.ts', contents: `
          import { Connection } from './src/database/Connection.js';
          import { Scheduler, task } from './src/scheduler/index.js';
          Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: process.argv[2] } } });
          const worker = new Scheduler({ persistent: true, timezone: 'UTC' }).register(task('process-probe', async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
          }, job => job.daily()));
          try { await worker.run(new Date('2026-10-14T12:00:00Z')); }
          finally { await worker.stop(); await Connection.disconnect(); }
        ` },
        outfile: file, bundle: true, splitting: false, packages: 'external',
        platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
      });
      const exec = promisify(execFile);
      await Promise.all([exec(process.execPath, [file, join(root, 'runtime.sqlite')]), exec(process.execPath, [file, join(root, 'runtime.sqlite')])]);
      expect(await web.getRunRequest('process-probe', request.id)).toMatchObject({ state: 'succeeded', attempts: 1 });
      expect(await new QueryBuilder('scheduled_task_runs').where('task', 'process-probe').get()).toHaveLength(1);
    } finally { await rm(bundle, { recursive: true, force: true }); }
  });

  it('honors a disable after enqueue, rejects new requests and supports pending cancellation', async () => {
    let calls = 0;
    const app = worker().register(task('manual', async () => { calls++; }, (job) => job.daily()));
    const request = await app.requestRun('manual');
    await app.configureTask('manual', { enabled: false });
    await app.run(minute);
    expect(calls).toBe(0);
    expect((await app.getRunRequest('manual', request.id))?.state).toBe('pending');
    await expect(app.requestRun('manual')).rejects.toThrow('disabled');
    expect(await app.cancelRunRequest('manual', request.id)).toBe(true);
    expect(await app.cancelRunRequest('manual', request.id)).toBe(false);
  });

  it('recovers an abandoned request lease and rejects completion from its old owner', async () => {
    let calls = 0;
    const app = worker().register(task('abandoned', async () => { calls++; }, (job) => job.daily()));
    const request = await app.requestRun('abandoned');
    await new QueryBuilder('scheduler_requests').where('id', request.id).update({
      state: 'running', owner: 'dead-worker', lease_until: Date.now() - 1000, attempts: 1,
    });
    await app.run(minute);
    expect(calls).toBe(1);
    expect(await app.getRunRequest('abandoned', request.id)).toMatchObject({ state: 'succeeded', attempts: 2 });
    expect(await app.getRuntimeStore().finishRequest('abandoned', request.id, 'dead-worker', { success: false })).toBe(false);
    expect((await app.getRunRequest('abandoned', request.id))?.state).toBe('succeeded');
  });

  it('isolates settings, requests, run history and execution context between tenants', async () => {
    const contexts: unknown[] = [];
    const first = worker({ tenantId: 'one' }).register(task('same', async () => { contexts.push(ApplicationContext.snapshot()); }, (job) => job.daily()));
    const second = worker({ tenantId: 'two' }).register(task('same', async () => { contexts.push(ApplicationContext.snapshot()); }, (job) => job.daily()));
    await second.configureTask('same', { enabled: false });
    const request = await ApplicationContext.runIsolated({ teamId: 'unrelated', userId: 9, correlationId: 'operator' }, () => first.requestRun('same'));
    expect(await second.getRunRequest('same', request.id)).toBeNull();
    expect(await second.cancelRunRequest('same', request.id)).toBe(false);
    await ApplicationContext.runIsolated({ teamId: 'unrelated' }, () => Promise.all([first.run(minute), second.run(minute)]));
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ teamId: 'one', userId: '9', correlationId: 'operator' });
    ScheduleMonitor.configure(second);
    expect(await ScheduleMonitor.getTaskHistory('same')).toEqual([]);
    ScheduleMonitor.configure(first);
    expect(await ScheduleMonitor.getTaskHistory('same')).toHaveLength(1);
    const firstMonitor = ScheduleMonitor.forScheduler(first);
    const secondMonitor = ScheduleMonitor.forScheduler(second);
    const [firstHistory, secondHistory] = await Promise.all([firstMonitor.getTaskHistory('same'), secondMonitor.getTaskHistory('same')]);
    expect(firstHistory).toHaveLength(1);
    expect(secondHistory).toHaveLength(0);
  });

  it('clears ambient tenant/actor context for a global scheduled execution', async () => {
    let context: unknown;
    const app = worker().register(task('global', async () => { context = ApplicationContext.snapshot(); }));
    await ApplicationContext.runIsolated({ teamId: 'unrelated', userId: 99 }, () => app.run(minute));
    expect(context).toMatchObject({ teamId: null, userId: null });
  });

  it('persists tenant timezone overrides without accidentally enabling a disabled task', async () => {
    let firstCalls = 0; let secondCalls = 0;
    const first = worker({ tenantId: 'one' }).register(task('daily', async () => { firstCalls++; }, (job) => job.dailyAt('09:00')));
    const second = worker({ tenantId: 'two' }).register(task('daily', async () => { secondCalls++; }, (job) => job.dailyAt('09:00')));
    await first.configureTask('daily', { timezone: 'UTC' });
    await second.configureTask('daily', { enabled: false });
    await second.configureTask('daily', { timezone: 'Asia/Tokyo' });
    expect((await second.listTaskStatuses())[0]).toMatchObject({ enabled: false, timezone: 'Asia/Tokyo' });
    await second.configureTask('daily', { enabled: true });
    await Promise.all([first.run(new Date('2026-10-14T09:00:00Z')), second.run(new Date('2026-10-14T09:00:00Z'))]);
    expect([firstCalls, secondCalls]).toEqual([1, 0]);
  });

  it.each(['skip', 'latest', 'catch-up'] as const)('bounds missed runs and shares the consumed cursor (%s)', async (policy) => {
    const slots: number[] = [];
    const create = () => task('missed', async () => { slots.push(ApplicationContext.get('scheduler').scheduledFor.getTime()); }, (job) => job.everyMinute().missedRuns(policy, { windowMinutes: 10, maxRuns: 2 }));
    const app = worker().register(create());
    await app.run(minute);
    const later = new Date(minute.getTime() + 5 * 60000);
    const restarted = worker().register(create());
    await restarted.run(later);
    await restarted.run(later);
    const expected = policy === 'catch-up' ? [minute.getTime(), later.getTime() - 60000, later.getTime()] : [minute.getTime(), later.getTime()];
    expect(slots).toEqual(expected);
  });

  it('records durable failed requests without falsely reporting success', async () => {
    const app = worker().register(task('failure', async () => { throw new Error('domain failure'); }, (job) => job.daily()));
    const request = await app.requestRun('failure');
    expect((await app.run(minute))[0]).toMatchObject({ success: false, error: 'domain failure' });
    expect(await app.getRunRequest('failure', request.id)).toMatchObject({ state: 'failed', error: 'domain failure', attempts: 1 });
  });

  it('does not replace a declared catch-up policy when only enabled/timezone settings change', async () => {
    let calls = 0;
    const app = worker().register(task('declared', async () => { calls++; }, (job) => job.missedRuns('catch-up', { windowMinutes: 10, maxRuns: 2 })));
    await app.configureTask('declared', { enabled: true, timezone: 'UTC' });
    expect((await app.listTaskStatuses())[0].missedRun).toEqual({ policy: 'catch-up', windowMinutes: 10, maxRuns: 2 });
    await app.run(minute);
    await app.run(new Date(minute.getTime() + 5 * 60000));
    expect(calls).toBe(3);
  });

  it('renews leases while draining, keeps shared health visible, and starts no more tasks', async () => {
    let entered!: () => void; let finish!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let extraCalls = 0;
    const long = task('long', async () => { entered(); await gate; }, (job) => job.everyMinute().preventOverlap().lockExpiresAfter(0.005));
    const app = worker().register(long).register(task('later', async () => { extraCalls++; }));
    app.start();
    await ready;
    let drained = false;
    const stopping = app.stop().then(() => { drained = true; });
    try {
      await delay(900);
      expect(drained).toBe(false);
      const lease = await SchedulerLock.acquireLease('long', 1);
      expect(lease).toBeNull();
      const processes = await app.getRuntimeStore().processes();
      expect(processes[0].state).toBe('draining');
      expect(Date.now() - Number(processes[0].heartbeat_at)).toBeLessThan(200);
    } finally { finish(); await stopping; }
    expect(extraCalls).toBe(0);
    expect((await app.getRuntimeStore().processes())[0].state).toBe('stopped');
    expect(await new QueryBuilder('scheduler_locks').where('task_key', 'long').first()).toBeNull();
  });

  it('never lets an old invocation release a replacement owner token', async () => {
    const old = (await SchedulerLock.acquireLease('token', 1))!;
    await new QueryBuilder('scheduler_locks').where('task_key', 'token').update({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const next = (await SchedulerLock.acquireLease('token', 1))!;
    await old.release();
    expect((await new QueryBuilder('scheduler_locks').where('task_key', 'token').first())?.owner).toBe(next.owner);
    await next.release();
  });

  it('holds and renews the lease until asynchronous failure hooks actually finish', async () => {
    let entered!: () => void; let finish!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const probe = task('failure-hook', async () => { throw new Error('failure'); }, (job) => job.preventOverlap().lockExpiresAfter(0.005));
    probe.onFailure = vi.fn(async () => { entered(); await gate; });
    const work = probe.executeTask();
    await ready;
    try {
      await delay(900);
      expect(await SchedulerLock.acquireLease('failure-hook', 1)).toBeNull();
    } finally { finish(); }
    expect(await work).toMatchObject({ success: false, error: 'failure' });
    expect(probe.onFailure).toHaveBeenCalledTimes(1);
  });

  it('still drains active work when publishing the initial draining heartbeat fails', async () => {
    let entered!: () => void; let finish!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const app = worker().register(task('heartbeat-failure', async () => { entered(); await gate; }, (job) => job.preventOverlap().lockExpiresAfter(0.005)));
    const run = app.run(minute);
    await ready;
    vi.spyOn(app.getRuntimeStore(), 'process').mockRejectedValueOnce(new Error('heartbeat unavailable'));
    let ended = false;
    const stopping = app.stop().catch((error: Error) => { ended = true; return error; });
    try {
      await delay(400);
      expect(ended).toBe(false);
      expect(await SchedulerLock.acquireLease('heartbeat-failure', 1)).toBeNull();
    } finally { finish(); }
    await run;
    expect((await stopping)?.message).toBe('heartbeat unavailable');
    workers.splice(workers.indexOf(app), 1);
  });

  it('signals lease loss, skips success hooks and cannot release the replacement owner', async () => {
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const probe = task('lost', async () => {
      const signal = probe.getExecutionContext()!.signal;
      entered();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    }, (job) => job.preventOverlap().lockExpiresAfter(0.005));
    probe.onSuccess = vi.fn();
    probe.onFailure = vi.fn();
    const app = worker().register(probe);
    const work = app.run(minute).catch((error: Error) => error);
    await ready;
    await new QueryBuilder('scheduler_locks').where('task_key', 'lost').update({ owner: 'replacement' });
    expect(await work).toMatchObject({ message: 'Scheduler execution lease was lost.' });
    expect(probe.onSuccess).not.toHaveBeenCalled();
    expect(probe.onFailure).toHaveBeenCalledTimes(1);
    expect((await new QueryBuilder('scheduler_locks').where('task_key', 'lost').first())?.owner).toBe('replacement');
  });

  it('fails closed on unavailable runtime storage and invalid scope/policy', async () => {
    expect(() => worker({ tenantId: '' })).toThrow('tenant');
    const app = worker().register(task('probe', async () => {}));
    await expect(app.configureTask('probe', { timezone: 'Invalid/Zone' })).rejects.toThrow();
    await expect(app.configureTask('probe', { missedRun: { policy: 'catch-up', windowMinutes: 0, maxRuns: 1000 } })).rejects.toThrow('bounded');
    await new CreateSchedulerRequestsTable().down();
    await expect(app.requestRun('probe')).rejects.toThrow('scheduler_requests');
  });

  it('exposes queued run-now through the monitor and rejects production inline execution', async () => {
    const app = worker().register(task('manual', async () => {}, (job) => job.daily()));
    ScheduleMonitor.configure(app);
    await expect(ScheduleMonitor.runTask('manual')).rejects.toThrow('requestRun');
    const request = await ScheduleMonitor.requestRun('manual');
    expect(request.state).toBe('pending');
    expect((await ScheduleMonitor.getRunRequest('manual', request.id))?.state).toBe('pending');
  });
});
