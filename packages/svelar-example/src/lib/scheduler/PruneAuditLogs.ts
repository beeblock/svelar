import { ScheduledTask } from 'svelar/scheduler';

/**
 * Prune audit logs older than 90 days.
 * Runs weekly on Sundays at 2:00 AM.
 */
export default class PruneAuditLogs extends ScheduledTask {
  name = 'prune-audit-logs';

  schedule() {
    return this.weeklyOn(0, '02:00');
  }

  async handle(): Promise<void> {
    // Prune audit logs older than 90 days
  }
}
