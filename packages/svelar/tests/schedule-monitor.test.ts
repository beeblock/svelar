import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { ScheduledTask, Scheduler } from '../src/scheduler/index.js';
import { ScheduleMonitor } from '../src/scheduler/ScheduleMonitor.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Schema } from '../src/database/SchemaBuilder.js';

class MonitorTestTask extends ScheduledTask {
  name = 'monitor-test-task';
  handled = false;

  async handle(): Promise<void> {
    this.handled = true;
  }
}

describe.sequential('ScheduleMonitor', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-schedule-monitor-'));
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: join(root, 'database.sqlite') },
      },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });

  it('fails task listing when scheduled_task_runs migration is missing', async () => {
    const scheduler = new Scheduler();
    scheduler.register(new MonitorTestTask());
    ScheduleMonitor.configure(scheduler);

    await expect(ScheduleMonitor.listTasks()).rejects.toThrow('scheduled_task_runs');
  });

  it('fails manual task runs when scheduled_task_runs persistence is unavailable', async () => {
    await new Schema().createTable('scheduled_task_settings', (table) => {
      table.string('task').primary();
      table.boolean('enabled');
      table.timestamp('updated_at');
    });
    const task = new MonitorTestTask();
    const scheduler = new Scheduler();
    scheduler.register(task);
    ScheduleMonitor.configure(scheduler);

    await expect(ScheduleMonitor.runTask('monitor-test-task')).rejects.toThrow('scheduled_task_runs');
    expect(task.handled).toBe(true);
  });

  it('does not execute when persisted enablement controls are unavailable', async () => {
    const task = new MonitorTestTask();
    const scheduler = new Scheduler();
    scheduler.register(task);
    ScheduleMonitor.configure(scheduler);

    await expect(ScheduleMonitor.runTask(task.name)).rejects.toThrow('scheduled_task_settings');
    expect(task.handled).toBe(false);
  });

  it('does not turn a controls permission error into an enabled task', async () => {
    const task = new MonitorTestTask();
    const scheduler = new Scheduler();
    scheduler.register(task);
    ScheduleMonitor.configure(scheduler);
    vi.spyOn(QueryBuilder.prototype, 'get').mockRejectedValueOnce(new Error('permission denied for table scheduled_task_settings'));

    await expect(ScheduleMonitor.runTask(task.name)).rejects.toThrow('permission denied');
    expect(task.handled).toBe(false);
  });

  it('keeps the latest result of quiet tasks when another task dominates history', async () => {
    await new Migrator().fresh(svelarCoreMigrations());
    const busy = new MonitorTestTask();
    const quiet = new MonitorTestTask();
    quiet.name = 'quiet-task';
    const scheduler = new Scheduler();
    scheduler.register(busy).register(quiet);
    ScheduleMonitor.configure(scheduler);
    await new QueryBuilder('scheduled_task_runs').insert({
      task: quiet.name, success: false, duration: 7, error: 'Quiet task failed', ran_at: '2026-10-10T12:00:00.000Z',
    });
    for (let i = 0; i < 50; i++) {
      await new QueryBuilder('scheduled_task_runs').insert({
        task: busy.name, success: true, duration: 1, error: null, ran_at: new Date(Date.UTC(2026, 9, 12, 12, i)).toISOString(),
      });
    }

    const tasks = await ScheduleMonitor.listTasks();
    expect(tasks.find((task) => task.name === quiet.name)).toMatchObject({
      lastStatus: 'failed', lastDuration: 7,
      history: [expect.objectContaining({ error: 'Quiet task failed' })],
    });
    expect(tasks.find((task) => task.name === busy.name)?.history).toHaveLength(5);
  });

  it('persists task enablement and scheduler processes respect it after restart', async () => {
    await new Migrator().fresh(svelarCoreMigrations());

    const task = new MonitorTestTask();
    const webScheduler = new Scheduler();
    webScheduler.register(task);
    ScheduleMonitor.configure(webScheduler);

    await ScheduleMonitor.disableTask('monitor-test-task');
    await expect(ScheduleMonitor.getTask('monitor-test-task')).resolves.toMatchObject({
      enabled: false,
    });
    await expect(ScheduleMonitor.runTask('monitor-test-task')).rejects.toThrow('disabled');

    const workerTask = new MonitorTestTask();
    const workerScheduler = new Scheduler().persistTaskSettings();
    workerScheduler.register(workerTask);

    await expect(workerScheduler.run(new Date('2026-06-04T12:00:00Z'))).resolves.toEqual([]);
    expect(workerTask.handled).toBe(false);

    await ScheduleMonitor.enableTask('monitor-test-task');
    await expect(workerScheduler.run(new Date('2026-06-04T12:01:00Z'))).resolves.toHaveLength(1);
    expect(workerTask.handled).toBe(true);
  });

  it('does not mark tasks with no history as failed and reports the real manual result', async () => {
    await new Migrator().fresh(svelarCoreMigrations());
    const scheduler = new Scheduler();
    const task = new MonitorTestTask();
    scheduler.register(task);
    ScheduleMonitor.configure(scheduler);
    await ScheduleMonitor.enableTask(task.name);

    expect((await ScheduleMonitor.getTask(task.name))?.lastStatus).toBeUndefined();
    expect(await ScheduleMonitor.runTask(task.name)).toMatchObject({ success: true, task: task.name });
    expect((await ScheduleMonitor.getTask(task.name))?.lastStatus).toBe('success');
  });

  it('honors settings changed by another process instead of stale local state', async () => {
    await new Migrator().fresh(svelarCoreMigrations());
    const task = new MonitorTestTask();
    const scheduler = new Scheduler();
    scheduler.register(task);
    ScheduleMonitor.configure(scheduler);
    await ScheduleMonitor.disableTask(task.name);
    await new QueryBuilder('scheduled_task_settings').where('task', task.name).update({ enabled: true });

    expect((await ScheduleMonitor.getHealth()).enabledTasks).toBe(1);
    expect(await ScheduleMonitor.runTask(task.name)).toMatchObject({ success: true });
    await new QueryBuilder('scheduled_task_settings').where('task', task.name).update({ enabled: false });
    expect((await ScheduleMonitor.getHealth()).enabledTasks).toBe(0);
    await expect(ScheduleMonitor.runTask(task.name)).rejects.toThrow('disabled');
  });

  it('returns failed task outcomes instead of swallowing them as a void success', async () => {
    await new Migrator().fresh(svelarCoreMigrations());
    class FailedTask extends ScheduledTask {
      name = 'failed-monitor-task';
      async handle() { throw new Error('Task failed'); }
    }
    const scheduler = new Scheduler();
    scheduler.register(new FailedTask());
    ScheduleMonitor.configure(scheduler);

    expect(await ScheduleMonitor.runTask('failed-monitor-task')).toMatchObject({ success: false, error: 'Task failed' });
    expect((await ScheduleMonitor.getTask('failed-monitor-task'))?.lastStatus).toBe('failed');
  });
});
