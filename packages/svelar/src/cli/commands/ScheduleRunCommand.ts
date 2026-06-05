/**
 * schedule:run — Run the task scheduler
 */

import { Command } from '../Command.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type SchedulerLike = {
  getTasks(): Array<{ name: string }>;
  run(): Promise<Array<{ task: string; success: boolean; duration: number; error?: string }>>;
};

export class ScheduleRunCommand extends Command {
  name = 'schedule:run';
  description = 'Run the task scheduler';
  flags = [
    { name: 'once', description: 'Run due tasks once and exit', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const scheduler = await this.loadConfiguredScheduler();
    if (!scheduler) {
      this.error(
        'No scheduler registry found. Create src/lib/shared/scheduler/index.ts (DDD) or src/lib/scheduler/index.ts (flat) and export createScheduler() or scheduler.'
      );
      return;
    }

    const tasks = scheduler.getTasks();
    if (tasks.length === 0) {
      this.warn('No scheduled tasks registered in the scheduler registry.');
      return;
    }

    for (const task of tasks) {
      this.info(`Registered task: ${task.name}`);
    }

    this.newLine();

    if (flags.once) {
      this.info('Running due tasks (once)...');
      const results = await scheduler.run();
      if (results.length === 0) {
        this.info('No tasks were due.');
      } else {
        for (const result of results) {
          if (result.success) {
            this.success(`${result.task}: completed in ${result.duration}ms`);
          } else {
            this.error(`${result.task}: failed — ${result.error}`);
          }
        }
      }
      return;
    }

    // Continuous mode — aligned to the top of each minute like crontab
    this.info('Scheduler running. Press Ctrl+C to stop.');
    this.newLine();

    const tick = async () => {
      const results = await scheduler.run();
      for (const result of results) {
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        if (result.success) {
          this.success(`[${now}] ${result.task}: completed in ${result.duration}ms`);
        } else {
          this.error(`[${now}] ${result.task}: failed — ${result.error}`);
        }
      }
    };

    // Run immediately for the current minute
    await tick();

    // Wait until the next minute boundary, then tick every 60s
    const msUntilNextMinute = 60_000 - (Date.now() % 60_000);
    this.info(`Next tick aligned to minute boundary in ${Math.round(msUntilNextMinute / 1000)}s.`);

    await new Promise<void>((resolve) => setTimeout(resolve, msUntilNextMinute));
    await tick();
    setInterval(tick, 60_000);

    // Keep process alive
    await new Promise(() => {});
  }

  private async loadConfiguredScheduler(): Promise<SchedulerLike | null> {
    const candidates = [
      join(process.cwd(), 'src', 'lib', 'shared', 'scheduler', 'index.ts'),
      join(process.cwd(), 'src', 'lib', 'shared', 'scheduler', 'index.js'),
      join(process.cwd(), 'src', 'lib', 'scheduler', 'index.ts'),
      join(process.cwd(), 'src', 'lib', 'scheduler', 'index.js'),
    ];

    const entry = candidates.find((file) => existsSync(file));
    if (!entry) return null;

    try {
      const mod = await import(pathToFileURL(entry).href);
      const scheduler = typeof mod.createScheduler === 'function'
        ? mod.createScheduler()
        : mod.scheduler;

      if (this.isSchedulerLike(scheduler)) {
        return scheduler;
      }

      throw new Error('export createScheduler() or scheduler with run() and getTasks()');
    } catch (err: any) {
      throw new Error(`Failed to load scheduler registry: ${err.message ?? err}`);
    }
  }

  private isSchedulerLike(value: unknown): value is SchedulerLike {
    return !!value
      && typeof (value as SchedulerLike).run === 'function'
      && typeof (value as SchedulerLike).getTasks === 'function';
  }
}
