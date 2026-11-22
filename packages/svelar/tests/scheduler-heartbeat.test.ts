import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { CreateSchedulerLocksTable } from '../src/database/core/00000000_000024_create_scheduler_locks_table.js';
import { CreateScheduledTaskRunsTable } from '../src/database/core/00000000_000025_create_scheduled_task_runs_table.js';
import { CreateScheduledTaskSettingsTable } from '../src/database/core/00000000_000028_create_scheduled_task_settings_table.js';
import { AddSchedulerSettingsPolicy } from '../src/database/core/00000000_000044_add_scheduler_settings_policy.js';
import { CreateSchedulerRuntimeTable } from '../src/database/core/00000000_000047_create_scheduler_runtime_table.js';
import { CreateSchedulerRequestsTable } from '../src/database/core/00000000_000048_create_scheduler_requests_table.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Scheduler, SchedulerLock, task, type SchedulerOptions, type TaskExecutionContext } from '../src/scheduler/index.js';
import { ApplicationContext } from '../src/support/Context.js';
import { ScheduleWorkCommand } from '../src/cli/commands/ScheduleWorkCommand.js';

class DaemonCommand extends ScheduleWorkCommand {
  constructor(private registry: Scheduler) { super(); }
  protected async bootstrap(): Promise<void> {}
  protected async loadConfiguredScheduler(): Promise<Scheduler> { return this.registry; }
}

const start = new Date('2026-10-14T12:00:01Z');
const minute = Math.floor(start.getTime() / 60000) * 60000;

describe('Persistent scheduler heartbeat query budget', { concurrent: false }, () => {
  let root: string;
  const workers: Scheduler[] = [];
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-heartbeat-'));
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
    vi.useFakeTimers();
    vi.setSystemTime(start);
  });
  afterEach(async () => {
    for (const worker of workers.splice(0)) await worker.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });
  function worker(options: SchedulerOptions = {}): Scheduler {
    const app = new Scheduler({ persistent: true, timezone: 'UTC', heartbeatMilliseconds: 5000, ...options });
    workers.push(app);
    return app;
  }

  it('bounds real database queries for 66 idle tasks, repeated heartbeats and pending manual batches', async () => {
    const executed: string[] = [];
    const app = worker({ requestBatchSize: 2 });
    for (let index = 0; index < 66; index++) {
      const time = `${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`;
      app.register(task(`idle-${index}`, async () => { executed.push(`idle-${index}`); }, (job) => job.dailyAt(time)));
    }
    const queries = vi.spyOn(Connection, 'raw');
    const acquire = vi.spyOn(SchedulerLock, 'acquireLease');
    app.start();
    await vi.advanceTimersByTimeAsync(0);
    const registration = queries.mock.calls.map(([sql]) => sql);
    expect(registration.filter((sql) => sql.startsWith('INSERT') && sql.includes('scheduler_runtime'))).toHaveLength(2);
    expect(registration.filter((sql) => sql.includes('LEFT JOIN'))).toHaveLength(1);
    // One-time registration plus distinct next-run checkpoints, never per-task invocation leases.
    expect(registration.length).toBeLessThanOrEqual(70);
    expect(acquire).not.toHaveBeenCalled();
    queries.mockClear();

    await vi.advanceTimersByTimeAsync(55000);
    expect(queries.mock.calls).toHaveLength(22);
    expect(queries.mock.calls.filter(([sql]) => sql.startsWith('SELECT DISTINCT') && sql.includes('scheduler_requests'))).toHaveLength(11);
    expect(queries.mock.calls.some(([sql]) => sql.includes('scheduled_task_settings') || sql.includes('scheduler_locks'))).toBe(false);
    expect(app.getRuntimeStatus().lastTickAt).toEqual(start);
    expect(executed).toEqual([]);
    queries.mockClear();

    // At the minute boundary there is one request probe, one joined read and one bulk idle checkpoint.
    await vi.advanceTimersByTimeAsync(4000);
    expect(queries.mock.calls).toHaveLength(3);
    expect(acquire).not.toHaveBeenCalled();
    expect(app.getRuntimeStatus().lastTickAt).toEqual(new Date(minute + 60000));

    const requests = [];
    for (let index = 0; index < 3; index++) requests.push(await app.requestRun('idle-0'));
    const other = await app.requestRun('idle-65');
    queries.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(queries.mock.calls.length).toBeLessThanOrEqual(52);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(executed).toEqual(['idle-0', 'idle-0', 'idle-65']);
    expect(await app.getRunRequest('idle-65', other.id)).toMatchObject({ state: 'succeeded', attempts: 1 });
    const states = [];
    for (const request of requests) states.push((await app.getRunRequest('idle-0', request.id))!.state);
    expect(states.sort()).toEqual(['pending', 'succeeded', 'succeeded']);

    queries.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(queries.mock.calls.length).toBeLessThanOrEqual(23);
    expect(acquire).toHaveBeenCalledTimes(3);
    expect(executed).toEqual(['idle-0', 'idle-0', 'idle-65', 'idle-0']);
    for (const request of requests) expect(await app.getRunRequest('idle-0', request.id)).toMatchObject({ state: 'succeeded', attempts: 1 });

    queries.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(queries.mock.calls).toHaveLength(2);
    expect(acquire).toHaveBeenCalledTimes(3);
    expect(await new QueryBuilder('scheduled_task_runs').get()).toHaveLength(4);
    expect((await app.getRuntimeStore().task('idle-64'))?.last_checked_at).toBe(minute + 60000);
  });

  it('polls manual requests before the configured phase without consuming cron or catch-up slots', async () => {
    const contexts: TaskExecutionContext[] = [];
    const app = worker({ evaluationOffsetMilliseconds: 30000 }).register(task('phased', async () => {
      contexts.push(ApplicationContext.get<TaskExecutionContext>('scheduler')!);
    }, (job) => job.everyMinute().missedRuns('catch-up', { windowMinutes: 10, maxRuns: 2 })));
    app.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(contexts.map((context) => context.scheduledFor?.getTime())).toEqual([minute]);
    await vi.advanceTimersByTimeAsync(55000);
    const request = await app.requestRun('phased');
    await vi.advanceTimersByTimeAsync(5000);
    expect(contexts.map((context) => context.scheduledFor?.getTime())).toEqual([minute, undefined]);
    expect((await app.getRuntimeStore().task('phased'))?.last_checked_at).toBe(minute);
    expect(await app.getRunRequest('phased', request.id)).toMatchObject({ state: 'succeeded', attempts: 1 });
    await vi.advanceTimersByTimeAsync(29000);
    expect(contexts.map((context) => context.scheduledFor?.getTime())).toEqual([minute, undefined, minute + 60000]);
  });

  it('keeps heartbeats live and defers a minute evaluation while a manual request holds the task lease', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const contexts: TaskExecutionContext[] = [];
    const app = worker().register(task('long-manual', async () => {
      const context = ApplicationContext.get<TaskExecutionContext>('scheduler')!;
      contexts.push(context);
      if (context.requestId) await gate;
    }, (job) => job.everyMinute().lockExpiresAfter(0.5)));
    app.start();
    await vi.advanceTimersByTimeAsync(55000);
    const request = await app.requestRun('long-manual');
    await vi.advanceTimersByTimeAsync(5000);
    expect(contexts).toHaveLength(3);
    expect(contexts[2].requestId).toBe(request.id);
    try {
      await vi.advanceTimersByTimeAsync(65000);
      const [process] = await app.getRuntimeStore().processes();
      expect(Number(process.heartbeat_at)).toBe(Date.now());
      expect(process.state).toBe('running');
      expect(await SchedulerLock.acquireLease('long-manual', 1)).toBeNull();
      expect(contexts).toHaveLength(3);
    } finally { finish(); }
    await vi.advanceTimersByTimeAsync(0);
    expect(contexts.map((context) => context.scheduledFor?.getTime())).toEqual([minute, minute + 60000, undefined, minute + 120000]);
    expect(await app.getRunRequest('long-manual', request.id)).toMatchObject({ state: 'succeeded', attempts: 1 });
  });

  it('does not let idle checkpointing overwrite an active or newer distributed cursor', async () => {
    const app = worker().register(task('fenced', async () => {}, (job) => job.daily()));
    await app.run(start);
    const store = app.getRuntimeStore();
    await store.updateTask('fenced', { owner: 'another-worker', lease_until: Date.now() + 60000, state: 'running' });
    await app.run(new Date(minute + 60000));
    expect(await store.task('fenced')).toMatchObject({ owner: 'another-worker', state: 'running', last_checked_at: minute });
    const lease = (await SchedulerLock.acquireLease('fenced', 1))!;
    try {
      // The lock is authoritative even before its owner has published the runtime heartbeat.
      await store.updateTask('fenced', { lease_until: Date.now() - 1 });
      await app.run(new Date(minute + 60000));
      expect((await store.task('fenced'))?.last_checked_at).toBe(minute);
    } finally { await lease.release(); }
    await store.updateTask('fenced', { owner: null, lease_until: null, last_checked_at: minute + 120000 });
    await app.run(start);
    expect((await store.task('fenced'))?.last_checked_at).toBe(minute + 120000);
  });

  it('rechecks durable pause/resume controls on polls and recovers only its own expired requests after restart', async () => {
    const executed: string[] = [];
    const app = worker({ tenantId: 'one' }).register(task('controlled', async () => {
      executed.push(ApplicationContext.get<TaskExecutionContext>('scheduler')!.requestId!);
    }, (job) => job.daily()));
    const web = worker({ tenantId: 'one' }).register(task('controlled', async () => {}, (job) => job.daily()));
    const foreign = worker({ tenantId: 'two' }).register(task('controlled', async () => {}, (job) => job.daily()));
    const abandoned = await web.requestRun('controlled');
    const cancelled = await web.requestRun('controlled');
    const live = await web.requestRun('controlled');
    const foreignRequest = await foreign.requestRun('controlled');
    await web.cancelRunRequest('controlled', cancelled.id);
    await new QueryBuilder('scheduler_requests').where('id', abandoned.id).update({ state: 'running', owner: 'dead-worker', lease_until: Date.now() - 1, attempts: 1 });
    await new QueryBuilder('scheduler_requests').where('id', live.id).update({ state: 'running', owner: 'live-worker', lease_until: Date.now() + 600000, attempts: 1 });
    await web.configureTask('controlled', { enabled: false });
    const acquire = vi.spyOn(SchedulerLock, 'acquireLease');
    app.start();
    await vi.advanceTimersByTimeAsync(10000);
    expect(executed).toEqual([]);
    expect(acquire).not.toHaveBeenCalled();
    expect((await app.getRuntimeStore().task('controlled'))?.state).toBe('disabled');
    await app.stop();

    // A fresh process retains configuration and the pending/expired request, not an in-memory wake-up.
    const restarted = worker({ tenantId: 'one' }).register(task('controlled', async () => {
      executed.push(ApplicationContext.get<TaskExecutionContext>('scheduler')!.requestId!);
    }, (job) => job.daily()));
    restarted.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(acquire).not.toHaveBeenCalled();
    await web.configureTask('controlled', { enabled: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(executed).toEqual([abandoned.id]);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(await web.getRunRequest('controlled', abandoned.id)).toMatchObject({ state: 'succeeded', attempts: 2 });
    expect(await web.getRunRequest('controlled', cancelled.id)).toMatchObject({ state: 'cancelled', attempts: 0 });
    expect(await web.getRunRequest('controlled', live.id)).toMatchObject({ state: 'running', owner: 'live-worker', attempts: 1 });
    expect(await foreign.getRunRequest('controlled', foreignRequest.id)).toMatchObject({ state: 'pending', attempts: 0 });
  });

  it('validates the independent timing bounds', () => {
    for (const evaluationOffsetMilliseconds of [-1, 60000, 0.5, NaN]) {
      expect(() => new Scheduler({ evaluationOffsetMilliseconds })).toThrow('bounds');
    }
    for (const heartbeatMilliseconds of [0, 9, 60001, 10.5]) {
      expect(() => new Scheduler({ heartbeatMilliseconds })).toThrow('bounds');
    }
    expect(() => new Scheduler({ evaluationOffsetMilliseconds: 59999, heartbeatMilliseconds: 10 })).not.toThrow();
  });

  it('uses the real native ticker through the CLI daemon, preserving scope, filtering, phase, requests and catch-up', async () => {
    const contexts: TaskExecutionContext[] = [];
    const app = worker({ tenantId: 'selected-tenant', evaluationOffsetMilliseconds: 30000 });
    app.register(task('selected-group', async () => {
      contexts.push(ApplicationContext.get<TaskExecutionContext>('scheduler')!);
    }, (job) => job.everyMinute().missedRuns('catch-up', { windowMinutes: 10, maxRuns: 2 })));
    const excluded = vi.fn(async () => {});
    app.register(task('other-group', excluded));
    app.remove('other-group');
    const previous = process.listeners('SIGTERM');
    const ticker = vi.spyOn(app, 'start');
    const evaluate = vi.spyOn(app, 'run');
    const command = new DaemonCommand(app);
    const work = command.handle([], { sleep: '1000' });
    try {
      await vi.advanceTimersByTimeAsync(55000);
      expect(ticker).toHaveBeenCalledTimes(1);
      expect(evaluate).toHaveBeenCalledTimes(2); // Startup and :30, not the 55 CLI supervision polls.
      expect(contexts.map((context) => context.scheduledFor?.getTime())).toEqual([minute]);

      const request = await app.requestRun('selected-group');
      const queries = vi.spyOn(Connection, 'raw');
      await vi.advanceTimersByTimeAsync(5000);
      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(contexts.map((context) => context.scheduledFor?.getTime())).toEqual([minute, undefined]);
      expect(await app.getRunRequest('selected-group', request.id)).toMatchObject({ state: 'succeeded', attempts: 1 });
      queries.mockClear();
      await vi.advanceTimersByTimeAsync(5000);
      expect(queries.mock.calls).toHaveLength(2); // Native liveness write + durable request probe only.

      await vi.advanceTimersByTimeAsync(24000);
      expect(contexts.map((context) => context.scheduledFor?.getTime())).toEqual([minute, undefined, minute + 60000]);
      vi.setSystemTime(new Date(minute + 5 * 60000 + 30000));
      await vi.advanceTimersByTimeAsync(60000);
      expect(contexts.map((context) => context.scheduledFor?.getTime())).toEqual([minute, undefined, minute + 60000, minute + 5 * 60000, minute + 6 * 60000]);
      expect(contexts.every((context) => context.tenantId === 'selected-tenant')).toBe(true);
      expect(excluded).not.toHaveBeenCalled();
      expect(command.exitCode).toBe(0);
    } finally {
      process.listeners('SIGTERM').find((handler) => !previous.includes(handler))?.();
      await work;
    }
    expect(process.listeners('SIGTERM')).toEqual(previous);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps native daemon failures visible even if a later successful request clears the runtime status', async () => {
    let calls = 0;
    const app = worker().register(task('outcome', async () => {
      if (calls++ === 0) throw new Error('native domain failure');
    }, (job) => job.daily()));
    const previous = process.listeners('SIGTERM');
    const command = new DaemonCommand(app);
    const work = command.handle([], { sleep: '60000' });
    try {
      await vi.advanceTimersByTimeAsync(0);
      const failed = await app.requestRun('outcome');
      await vi.advanceTimersByTimeAsync(5000);
      expect(await app.getRunRequest('outcome', failed.id)).toMatchObject({ state: 'failed', error: 'native domain failure' });
      const success = await app.requestRun('outcome');
      await vi.advanceTimersByTimeAsync(5000);
      expect(await app.getRunRequest('outcome', success.id)).toMatchObject({ state: 'succeeded' });
      expect(app.getRuntimeStatus().lastError).toBeNull();
      expect(command.exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('outcome: failed'));
      vi.spyOn(app.getRuntimeStore(), 'process').mockRejectedValueOnce(new Error('native heartbeat unavailable'));
      await vi.advanceTimersByTimeAsync(5000);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('native heartbeat unavailable'));
    } finally {
      process.listeners('SIGTERM').find((handler) => !previous.includes(handler))?.();
      await work;
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drains the real daemon on both signals while renewing the active task lease and process heartbeat', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let entered = false;
    const later = vi.fn(async () => {});
    const app = worker().register(task('daemon-drain', async () => { entered = true; await gate; }, (job) => job.everyMinute().lockExpiresAfter(0.5)))
      .register(task('later-group-task', later));
    const previousTerm = process.listeners('SIGTERM');
    const previousInt = process.listeners('SIGINT');
    const stop = vi.spyOn(app, 'stop');
    let finished = false;
    const work = new DaemonCommand(app).handle([], { sleep: '60000', 'grace-period': '1' }).then(() => { finished = true; });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(entered).toBe(true);
      process.listeners('SIGTERM').find((handler) => !previousTerm.includes(handler))!();
      process.listeners('SIGINT').find((handler) => !previousInt.includes(handler))!();
      await vi.advanceTimersByTimeAsync(90000);
      expect(finished).toBe(false);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(later).not.toHaveBeenCalled();
      expect(await SchedulerLock.acquireLease('daemon-drain', 1)).toBeNull();
      const [runtimeProcess] = await app.getRuntimeStore().processes();
      expect(runtimeProcess.state).toBe('draining');
      expect(Number(runtimeProcess.heartbeat_at)).toBe(Date.now());
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Still draining'));
    } finally {
      finish();
      await vi.advanceTimersByTimeAsync(0);
      await work;
    }
    expect(process.listeners('SIGTERM')).toEqual(previousTerm);
    expect(process.listeners('SIGINT')).toEqual(previousInt);
    expect(vi.getTimerCount()).toBe(0);
    expect(await new QueryBuilder('scheduler_locks').where('task_key', 'daemon-drain').first()).toBeNull();
    expect((await app.getRuntimeStore().processes())[0].state).toBe('stopped');
  });

  it('records observer failures without changing persisted task outcomes', async () => {
    const app = worker().register(task('observer-probe', async () => {}));
    app.start({ onResult: () => { throw new Error('observer unavailable'); } });
    await vi.advanceTimersByTimeAsync(0);
    expect(app.getHistory()[0]).toMatchObject({ task: 'observer-probe', success: true });
    expect(app.getRuntimeStatus().lastError).toBe('observer unavailable');
    expect((await new QueryBuilder('scheduled_task_runs').where('task', 'observer-probe').first())?.success).toBe(1);
  });
});
