import { ScheduledTask } from 'svelar/scheduler';

/**
 * Clean up expired API tokens.
 * Runs daily at midnight.
 */
export default class CleanupExpiredTokens extends ScheduledTask {
  name = 'cleanup-expired-tokens';

  schedule() {
    return this.daily();
  }

  async handle(): Promise<void> {
  }
}
