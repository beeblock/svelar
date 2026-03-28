import { ScheduledTask } from 'svelar/scheduler';
import { Queue } from 'svelar/queue';
import { DailyDigestJob } from '../jobs/DailyDigestJob.js';

/**
 * Generate and dispatch daily digest emails.
 * Runs every day at 9:00 AM.
 */
export default class DailyDigestEmail extends ScheduledTask {
  name = 'daily-digest-email';

  schedule() {
    return this.dailyAt('09:00');
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Dispatching daily digest job...');
    await Queue.dispatch(new DailyDigestJob());
  }
}
