import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { SchedulerLock } from '../src/scheduler/SchedulerLock.js';
import { ScheduledTask, Scheduler } from '../src/scheduler/index.js';

class LockedTask extends ScheduledTask {
  ran = false;
  failure: string | undefined;

  schedule(): this {
    return this.everyMinute().preventOverlap();
  }

  async handle(): Promise<void> {
    this.ran = true;
  }

  onFailure(error: Error): void {
    this.failure = error.message;
  }
}

class SlowLockedTask extends ScheduledTask {
  name = 'slow-locked-task';
  runs = 0;

  schedule(): this {
    return this.everyMinute().preventOverlap().lockExpiresAfter(1);
  }

  async handle(): Promise<void> {
    this.runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

class DueTask extends ScheduledTask {
  schedule(): this {
    return this.everyMinute();
  }

  async handle(): Promise<void> {}
}

describe('SchedulerLock', () => {
  it('acquires and releases database-backed locks through the query builder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-lock-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      await new Migrator().fresh(svelarCoreMigrations());

      const transactionSpy = vi.spyOn(Connection, 'transaction');
      await expect(SchedulerLock.acquire('billing-digest')).resolves.toBe(true);
      await expect(SchedulerLock.acquire('billing-digest')).resolves.toBe(false);
      expect(transactionSpy).not.toHaveBeenCalled();

      const rows = await Connection.raw(
        'SELECT owner FROM scheduler_locks WHERE task_key = ?',
        ['billing-digest'],
      );
      expect(rows[0]?.owner).toBe(SchedulerLock.getOwnerId());

      await SchedulerLock.release('billing-digest');
      await expect(SchedulerLock.acquire('billing-digest')).resolves.toBe(true);
      transactionSpy.mockRestore();
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips concurrent preventOverlap runs for the same due task', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-overlap-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      await new Migrator().fresh(svelarCoreMigrations());

      const scheduler = new Scheduler();
      const task = new SlowLockedTask();
      scheduler.register(task);

      const [first, second] = await Promise.all([
        scheduler.run(new Date('2026-06-04T12:00:00Z')),
        scheduler.run(new Date('2026-06-04T12:00:00Z')),
      ]);
      const results = [...first, ...second].filter((result) => result.task === task.name);

      expect(task.runs).toBe(1);
      expect(results).toHaveLength(2);
      expect(results.some((result) => result.success && result.duration === 0)).toBe(true);
      expect(results.some((result) => result.success && result.duration > 0)).toBe(true);
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails preventOverlap tasks when the database lock table is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-lock-missing-table-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      const task = new LockedTask();
      task.getExpression();
      const result = await task.executeTask();

      expect(result.success).toBe(false);
      expect(result.error).toContain('scheduler_locks');
      expect(task.failure).toContain('scheduler_locks');
      expect(task.ran).toBe(false);
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists task run history when database persistence is enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-history-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      await new Migrator().fresh(svelarCoreMigrations());

      const scheduler = new Scheduler().persistToDatabase();
      scheduler.register(new DueTask());
      await scheduler.run(new Date('2026-06-04T12:00:00Z'));

      const rows = await Connection.raw(
        'SELECT task, success FROM scheduled_task_runs WHERE task = ?',
        ['DueTask'],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ task: 'DueTask', success: 1 });
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails scheduler runs when persisted history cannot be written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-history-missing-table-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      const scheduler = new Scheduler().persistToDatabase();
      scheduler.register(new DueTask());

      await expect(scheduler.run(new Date('2026-06-04T12:00:00Z'))).rejects.toThrow(
        'scheduled_task_runs'
      );
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records runtime ticker failures for health checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-runtime-failure-'));
    const filename = join(root, 'database.sqlite');
    const scheduler = new Scheduler().persistToDatabase();

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      scheduler.register(new DueTask());
      scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const status = scheduler.getRuntimeStatus();
      expect(status.running).toBe(true);
      expect(status.lastTickAt).toBeInstanceOf(Date);
      expect(status.lastErrorAt).toBeInstanceOf(Date);
      expect(status.lastError).toContain('scheduled_task_runs');
      expect(status.failures).toBe(1);

      await expect(scheduler.stop()).resolves.toBeUndefined();
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not require lock storage when stopping a scheduler without overlapping tasks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-stop-without-locks-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      const scheduler = new Scheduler();
      scheduler.register(new DueTask());

      await expect(scheduler.stop()).resolves.toBeUndefined();
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails scheduler stop when distributed lock cleanup storage is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-stop-missing-locks-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      const scheduler = new Scheduler();
      scheduler.register(new LockedTask());

      await expect(scheduler.stop()).rejects.toThrow('scheduler_locks');
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });
});
