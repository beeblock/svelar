import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleRunCommand, type SchedulerLike } from '../src/cli/commands/ScheduleRunCommand.js';
import { ScheduleWorkCommand } from '../src/cli/commands/ScheduleWorkCommand.js';
import { ScheduleListCommand } from '../src/cli/commands/ScheduleListCommand.js';

class WorkerCommand extends ScheduleWorkCommand {
  constructor(private registry: SchedulerLike | null) { super(); }
  protected async bootstrap(): Promise<void> {}
  protected async loadConfiguredScheduler(): Promise<SchedulerLike | null> { return this.registry; }
}
class ListCommand extends ScheduleListCommand {
  constructor(private registry: SchedulerLike) { super(); }
  protected async bootstrap(): Promise<void> {}
  protected async loadConfiguredScheduler(): Promise<SchedulerLike> { return this.registry; }
}
function registry(): SchedulerLike {
  return { getTasks: () => [{ name: 'probe' }], run: vi.fn(async () => []), stop: vi.fn(async () => {}), hasPersistentRuntime: () => true };
}

describe('Production scheduler CLI control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('sets failure status for a missing registry', async () => {
    const command = new WorkerCommand(null);
    await command.handle([], { once: true });
    expect(command.exitCode).toBe(1);
  });

  it('sets failure status for task failure and awaits one-shot cleanup', async () => {
    const app = registry();
    app.run = vi.fn(async () => [{ task: 'probe', success: false, duration: 1, error: 'failure' }]);
    const command = new WorkerCommand(app);
    await command.handle([], { once: true });
    expect(command.exitCode).toBe(1);
    expect(app.stop).toHaveBeenCalledTimes(1);
  });

  it('queues --task without running a task in the command process', async () => {
    const app = registry();
    app.requestRun = vi.fn(async () => ({ id: 'durable-request', state: 'pending' }));
    await new WorkerCommand(app).handle([], { task: 'probe' });
    expect(app.requestRun).toHaveBeenCalledWith('probe');
    expect(app.run).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('durable-request (pending)'));
  });

  it.each([{ sleep: '0' }, { 'max-time': '-1' }, { 'max-time': 'Infinity' }, { 'grace-period': '0' }])('rejects invalid worker bounds before attaching signal handlers (%j)', async (flags) => {
    const listeners = process.listenerCount('SIGTERM');
    await expect(new WorkerCommand(registry()).handle([], flags)).rejects.toThrow('must be an integer');
    expect(process.listenerCount('SIGTERM')).toBe(listeners);
  });

  it('drains once on repeated signals, warns without releasing active work, and removes listeners', async () => {
    const previous = process.listeners('SIGTERM');
    let entered!: () => void; let finish!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const app = registry();
    app.run = vi.fn(async () => { entered(); await gate; return []; });
    app.stop = vi.fn(async () => { await gate; });
    let finished = false;
    const work = new WorkerCommand(app).handle([], { sleep: '10', 'grace-period': '1' }).then(() => { finished = true; });
    await started;
    const signal = process.listeners('SIGTERM').find((handler) => !previous.includes(handler))!;
    signal(); signal();
    await vi.advanceTimersByTimeAsync(3000);
    expect(app.stop).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Still draining'));
    finish(); await work;
    expect(process.listeners('SIGTERM')).toEqual(previous);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('begins graceful drain at max-time and wakes the sleeping poll loop', async () => {
    const app = registry();
    const work = new WorkerCommand(app).handle([], { sleep: '60000', 'max-time': '1' });
    await vi.advanceTimersByTimeAsync(1000);
    await work;
    expect(app.stop).toHaveBeenCalledTimes(1);
    expect(app.run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not rerun legacy minute-based schedules on every polling interval', async () => {
    const previous = process.listeners('SIGTERM');
    const app = registry(); app.hasPersistentRuntime = () => false;
    const work = new WorkerCommand(app).handle([], { sleep: '1000' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(app.run).toHaveBeenCalledTimes(1);
    process.listeners('SIGTERM').find((handler) => !previous.includes(handler))!();
    await work;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('prints shared status as a data/meta envelope without invoking execution', async () => {
    const app = registry();
    app.listTaskStatuses = vi.fn(async () => [{ name: 'probe', enabled: false, lockOwner: 'worker', isRunning: true }]);
    await new ListCommand(app).handle([], { json: true });
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ data: [{ name: 'probe', enabled: false, lockOwner: 'worker', isRunning: true }], meta: {} }));
    expect(app.run).not.toHaveBeenCalled();
    expect(new ScheduleRunCommand().flags.some((flag) => flag.name === 'task')).toBe(true);
  });
});
