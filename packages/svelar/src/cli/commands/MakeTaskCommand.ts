/**
 * make:task — Generate a new scheduled task class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeTaskCommand extends Command {
  name = 'make:task';
  description = 'Create a new scheduled task class';
  arguments = ['name'];
  flags = [];

  async handle(args: string[]): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a task name.');
      return;
    }

    const taskName = name.endsWith('Task') ? name : name;
    const schedulerDir = join(process.cwd(), 'src', 'lib', 'shared', 'scheduler');
    mkdirSync(schedulerDir, { recursive: true });

    const filePath = join(schedulerDir, `${taskName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Task ${taskName} already exists.`);
      return;
    }

    const content = `import { ScheduledTask } from '@beeblock/svelar/scheduler';

export class ${taskName} extends ScheduledTask {
  name = '${this.toKebabCase(taskName)}';

  schedule() {
    return this.daily(); // Run daily at midnight
    // Other options:
    // return this.everyMinute();
    // return this.everyFiveMinutes();
    // return this.everyMinutes(30);
    // return this.hourly();
    // return this.daily();
    // return this.dailyAt('03:00');
    // return this.weekly();
    // return this.weeklyOn(1, '08:00'); // Monday at 8am
    // return this.monthly();
    // return this.cron('0 */6 * * *'); // Every 6 hours
  }

  async handle(): Promise<void> {
    // Implement your scheduled task logic here
    console.log('Running ${taskName}...');
  }

  onSuccess(): void {
    // Called after successful execution (optional)
  }

  onFailure(error: Error): void {
    console.error('${taskName} failed:', error.message);
  }
}
`;

    writeFileSync(filePath, content);
    this.success(`Scheduled task created: src/lib/shared/scheduler/${taskName}.ts`);
  }

  private toKebabCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '');
  }
}
