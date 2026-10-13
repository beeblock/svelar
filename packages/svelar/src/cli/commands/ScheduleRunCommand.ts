/**
 * schedule:run — Run the task scheduler
 */

import { Command } from '../Command.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type SchedulerLike = {
  getTasks(): Array<{ name: string }>;
  run(): Promise<Array<{ task: string; success: boolean; duration: number; error?: string; skipped?: boolean }>>;
  stop?(): Promise<void>;
  requestRun?(name: string): Promise<{ id: string; state: string }>;
  listTaskStatuses?(): Promise<unknown[]>;
  hasPersistentRuntime?(): boolean;
};

export class ScheduleRunCommand extends Command {
  name = 'schedule:run';
  description = 'Run the task scheduler';
  flags = [
    { name: 'once', description: 'Run due tasks once and exit', type: 'boolean' as const },
    { name: 'task', description: 'Enqueue a registered task for the scheduler worker and exit', type: 'string' as const },
    { name: 'sleep', description: 'Worker polling interval in milliseconds (default: 1000)', type: 'string' as const },
    { name: 'max-time', description: 'Begin draining after N seconds', type: 'string' as const },
    { name: 'grace-period', description: 'Warn after N seconds of draining; leases remain held until tasks finish', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const scheduler = await this.loadConfiguredScheduler();
    if (!scheduler) {
      this.error(
        'No scheduler registry found. Create src/lib/shared/scheduler/index.ts (DDD) or src/lib/scheduler/index.ts (flat) and export createScheduler() or scheduler.'
      );
      this.exitCode = 1;
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

    if (flags.task !== undefined) {
      if (!scheduler.requestRun || typeof flags.task !== 'string' || !flags.task.trim()) throw new Error('--task requires a persistent scheduler and a registered task name.');
      const request = await scheduler.requestRun(flags.task);
      this.success(`Queued ${flags.task}: ${request.id} (${request.state})`);
      return;
    }

    if (flags.once) {
      this.info('Running due tasks (once)...');
      const results = await scheduler.run();
      if (results.length === 0) {
        this.info('No tasks were due.');
      } else {
        for (const result of results) {
          if (result.skipped) this.info(`${result.task}: skipped (lease held)`);
          else if (result.success) {
            this.success(`${result.task}: completed in ${result.duration}ms`);
          } else {
            this.error(`${result.task}: failed — ${result.error}`);
            this.exitCode = 1;
          }
        }
      }
      await scheduler.stop?.();
      return;
    }

    const sleep = this.integerFlag(flags.sleep, 'sleep', 1000, 10, 60000);
    const maxTime = flags['max-time'] === undefined ? undefined : this.integerFlag(flags['max-time'], 'max-time', 0, 1, 2147483);
    const grace = this.integerFlag(flags['grace-period'], 'grace-period', 30, 1, 2147483);
    if (!scheduler.stop) throw new Error('Continuous scheduling requires a registry with graceful stop().');
    let stopped = false;
    let shutdown: Promise<void> | null = null;
    let shutdownFailure: unknown;
    let warningTimer: ReturnType<typeof setTimeout> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let lastMinute = -1;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      wake?.();
      this.info('Draining scheduler. Active leases remain held until execution finishes.');
      warningTimer = setTimeout(() => this.warn(`Still draining after ${grace}s; waiting for active tasks.`), grace * 1000);
      shutdown = scheduler.stop!().catch((error) => { shutdownFailure = error; });
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    if (maxTime !== undefined) maxTimer = setTimeout(stop, maxTime * 1000);
    this.info('Scheduler running. Press Ctrl+C to drain.');
    try {
      while (!stopped) {
        const minute = Math.floor(Date.now() / 60000);
        const results = scheduler.hasPersistentRuntime?.() || minute !== lastMinute ? await scheduler.run() : [];
        lastMinute = minute;
        for (const result of results) {
          if (result.skipped) continue;
          if (result.success) this.success(`${result.task}: completed in ${result.duration}ms`);
          else { this.error(`${result.task}: failed — ${result.error}`); this.exitCode = 1; }
        }
        if (!stopped) await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { wake = undefined; resolve(); }, sleep);
          wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
        });
      }
      if (shutdown) await shutdown;
      if (shutdownFailure) throw shutdownFailure;
    } finally {
      stop();
      if (shutdown) await shutdown;
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      if (maxTimer) clearTimeout(maxTimer);
      if (warningTimer) clearTimeout(warningTimer);
      if (shutdownFailure) throw shutdownFailure;
    }
  }

  protected async loadConfiguredScheduler(): Promise<SchedulerLike | null> {
    const candidates = [
      join(process.cwd(), 'src', 'lib', 'shared', 'scheduler', 'index.ts'),
      join(process.cwd(), 'src', 'lib', 'shared', 'scheduler', 'index.js'),
      join(process.cwd(), 'src', 'lib', 'scheduler', 'index.ts'),
      join(process.cwd(), 'src', 'lib', 'scheduler', 'index.js'),
    ];

    const entry = candidates.find((file) => existsSync(file));
    if (!entry) return null;

    try {
      const mod = await this.importUserModule(entry);
      const scheduler = typeof mod.createScheduler === 'function'
        ? await mod.createScheduler()
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

  private integerFlag(value: unknown, flag: string, fallback: number, min: number, max: number): number {
    const number = value === undefined ? fallback : Number(value);
    if ((value !== undefined && !/^[0-9]+$/.test(String(value))) || !Number.isSafeInteger(number) || number < min || number > max) throw new Error(`--${flag} must be an integer between ${min} and ${max}.`);
    return number;
  }
}
