import { ScheduledTask } from 'svelar/scheduler';

/**
 * Clean up expired sessions from the database.
 * Runs daily at midnight.
 */
export default class CleanExpiredSessions extends ScheduledTask {
  name = 'clean-expired-sessions';

  schedule() {
    return this.daily();
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Cleaning expired sessions...');
  }
}
