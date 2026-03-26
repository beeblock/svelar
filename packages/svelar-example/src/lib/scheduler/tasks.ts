import { ScheduledTask, Scheduler } from 'svelar/scheduler';
import { Connection } from 'svelar/database';

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
 * Generate a daily stats summary.
 * Runs every day at 9:00 AM.
 */
class DailyStatsSummary extends ScheduledTask {
  name = 'daily-stats';

  schedule() {
    return this.dailyAt('09:00');
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Generating daily stats...');
    // const userCount = await User.count();
    // const postCount = await Post.count();
    // await Mailer.send({ to: 'admin@example.com', body: `Users: ${userCount}, Posts: ${postCount}` });
  }
}

/**
 * Create and configure the application scheduler
 */
export function createScheduler(): Scheduler {
  const scheduler = new Scheduler();
  scheduler.register(new CleanExpiredSessions());
  scheduler.register(new DailyStatsSummary());
  return scheduler;
}
