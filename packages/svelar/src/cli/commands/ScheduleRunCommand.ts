/**
 * schedule:run — Run the task scheduler
 */

import { Command } from '../Command.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class ScheduleRunCommand extends Command {
  name = 'schedule:run';
  description = 'Run the task scheduler';
  flags = [
    { name: 'once', description: 'Run due tasks once and exit', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const { Scheduler } = await import('../../scheduler/index.js');
    const scheduler = new Scheduler();

    // Load tasks from src/lib/scheduler/
    const schedulerDir = join(process.cwd(), 'src', 'lib', 'scheduler');
    const tasks = await this.loadTasks(schedulerDir);

    if (tasks.length === 0) {
      this.warn('No scheduled tasks found in src/lib/scheduler/');
      return;
    }

    for (const task of tasks) {
      scheduler.register(task);
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

    // Continuous mode — check every 60 seconds
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

    await tick();
    setInterval(tick, 60_000);

    // Keep process alive
    await new Promise(() => {});
  }

  private async loadTasks(dir: string): Promise<any[]> {
    let files: string[];
    try {
      files = readdirSync(dir)
        .filter((f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.startsWith('index'))
        .sort();
    } catch {
      return [];
    }

    const tasks: any[] = [];

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const module = await import(pathToFileURL(filePath).href);
        const TaskClass = module.default ?? Object.values(module).find(
          (v: any) => typeof v === 'function' && v.prototype && typeof v.prototype.handle === 'function'
        );

        if (TaskClass) {
          const instance = new (TaskClass as any)();
          instance.schedule(); // Initialize the cron expression
          tasks.push(instance);
        }
      } catch (err: any) {
        this.error(`Failed to load task ${file}: ${err.message ?? err}`);
      }
    }

    return tasks;
  }
}
