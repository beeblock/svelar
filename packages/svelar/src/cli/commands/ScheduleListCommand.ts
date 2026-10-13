import { ScheduleRunCommand } from './ScheduleRunCommand.js';

export class ScheduleListCommand extends ScheduleRunCommand {
  name = 'schedule:list';
  description = 'List registered schedules and shared runtime state';
  flags = [{ name: 'json', description: 'Print structured scheduler status', type: 'boolean' as const }];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    await this.bootstrap();
    const scheduler = await this.loadConfiguredScheduler();
    if (!scheduler) { this.error('No scheduler registry found.'); this.exitCode = 1; return; }
    if (!scheduler.listTaskStatuses) throw new Error('schedule:list requires a registry with listTaskStatuses().');
    const rows = await scheduler.listTaskStatuses();
    if (flags.json) console.log(JSON.stringify({ data: rows, meta: {} }));
    else console.log(JSON.stringify(rows, null, 2));
  }
}
