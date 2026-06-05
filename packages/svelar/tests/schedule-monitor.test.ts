import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { ScheduledTask, Scheduler } from '../src/scheduler/index.js';
import { ScheduleMonitor } from '../src/scheduler/ScheduleMonitor.js';

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
    const task = new MonitorTestTask();
    const scheduler = new Scheduler();
    scheduler.register(task);
    ScheduleMonitor.configure(scheduler);

    await expect(ScheduleMonitor.runTask('monitor-test-task')).rejects.toThrow('scheduled_task_runs');
    expect(task.handled).toBe(true);
  });
});
