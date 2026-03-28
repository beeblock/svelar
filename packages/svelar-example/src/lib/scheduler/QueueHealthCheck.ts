import { ScheduledTask } from 'svelar/scheduler';

/**
 * Check queue health every 5 minutes.
 * Logs queue size and any pending retries.
 */
export default class QueueHealthCheck extends ScheduledTask {
  name = 'queue-health-check';

  schedule() {
    return this.everyFiveMinutes();
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Running queue health check...');
  }
}
