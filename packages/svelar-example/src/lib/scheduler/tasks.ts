import { ScheduledTask, Scheduler } from 'svelar/scheduler';
import { Connection } from 'svelar/database';
import { Queue } from 'svelar/queue';
import { ApiKeys } from 'svelar/api-keys';
import { Audit } from 'svelar/audit';
import { DailyDigestJob } from '../jobs/DailyDigestJob.js';

/**
 * Clean up expired API tokens.
 * Runs daily at midnight.
 */
class CleanupExpiredTokens extends ScheduledTask {
  name = 'cleanup-expired-tokens';

  schedule() {
    return this.daily();
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Cleaning up expired API tokens...');
    // In a real app:
    // const expiredCount = await ApiKeys.where('expires_at', '<', new Date()).delete();
    // console.log(`[Scheduler] Deleted ${expiredCount} expired tokens`);
  }
}

/**
 * Generate and dispatch daily digest emails.
 * Runs every day at 9:00 AM.
 */
class DailyDigestEmail extends ScheduledTask {
  name = 'daily-digest-email';

  schedule() {
    return this.dailyAt('09:00');
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Dispatching daily digest job...');
    // Queue the job for all subscribed users
    await Queue.dispatch(new DailyDigestJob());
  }
}

/**
 * Prune audit logs older than 90 days.
 * Runs weekly on Sundays at 2:00 AM.
 */
class PruneAuditLogs extends ScheduledTask {
  name = 'prune-audit-logs';

  schedule() {
    return this.weeklyOn(0, '02:00'); // 0 = Sunday
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Pruning old audit logs...');
    // In a real app:
    // const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    // const deletedCount = await Audit.where('created_at', '<', ninetyDaysAgo).delete();
    // console.log(`[Scheduler] Deleted ${deletedCount} old audit entries`);
  }
}

/**
 * Check queue health every 5 minutes.
 * Logs queue size and any pending retries.
 */
class QueueHealthCheck extends ScheduledTask {
  name = 'queue-health-check';

  schedule() {
    return this.everyFiveMinutes();
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Running queue health check...');
    // In a real app:
    // const pendingJobs = await Queue.pending();
    // const failedJobs = await Queue.failed();
    // console.log(`[Scheduler] Queue status: ${pendingJobs} pending, ${failedJobs} failed`);
  }
}

/**
 * Clean up expired sessions from the database.
 * Runs daily at midnight.
 */
class CleanExpiredSessions extends ScheduledTask {
  name = 'clean-expired-sessions';

  schedule() {
    return this.daily();
  }

  async handle(): Promise<void> {
    // Example: clean up expired data
    console.log('[Scheduler] Cleaning expired sessions...');
    // await Connection.raw('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
  }
}

/**
 * Create and configure the application scheduler
 */
export function createScheduler(): Scheduler {
  const scheduler = new Scheduler();
  scheduler.register(new CleanupExpiredTokens());
  scheduler.register(new DailyDigestEmail());
  scheduler.register(new PruneAuditLogs());
  scheduler.register(new QueueHealthCheck());
  scheduler.register(new CleanExpiredSessions());
  return scheduler;
}
