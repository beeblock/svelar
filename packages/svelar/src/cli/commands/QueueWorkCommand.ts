/**
 * queue:work — Process queued jobs
 */

import { Command } from '../Command.js';

export class QueueWorkCommand extends Command {
  name = 'queue:work';
  description = 'Process queued jobs';
  flags = [
    { name: 'queue', description: 'Queue name to process (default: "default")', type: 'string' as const, default: 'default' },
    { name: 'max-jobs', description: 'Stop after processing N jobs', type: 'string' as const },
    { name: 'max-time', description: 'Stop after N seconds', type: 'string' as const },
    { name: 'sleep', description: 'Sleep N milliseconds between polls (default: 1000)', type: 'string' as const, default: '1000' },
    { name: 'once', description: 'Process a single job and exit', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const { Queue } = await import('../../queue/index.js');

    const queueName = flags.queue ?? 'default';
    const maxJobs = flags['max-jobs'] ? parseInt(flags['max-jobs']) : undefined;
    const maxTime = flags['max-time'] ? parseInt(flags['max-time']) : undefined;
    const sleep = flags.sleep ? parseInt(flags.sleep) : 1000;

    this.info(`Processing queue "${queueName}"...`);
    if (maxJobs) this.info(`Will stop after ${maxJobs} jobs.`);
    if (maxTime) this.info(`Will stop after ${maxTime} seconds.`);
    this.newLine();

    if (flags.once) {
      // Process single job
      const processed = await Queue.work({ queue: queueName, maxJobs: 1, sleep: 0 });
      if (processed === 0) {
        this.info('No jobs to process.');
      } else {
        this.success(`Processed ${processed} job(s).`);
      }
      return;
    }

    // Continuous worker mode
    this.info(`Worker running on "${queueName}". Press Ctrl+C to stop.`);
    this.newLine();

    const startTime = Date.now();
    let totalProcessed = 0;

    while (true) {
      // Check max-time
      if (maxTime && (Date.now() - startTime) / 1000 >= maxTime) {
        this.info(`Max time (${maxTime}s) reached. Stopping.`);
        break;
      }

      // Check max-jobs
      if (maxJobs && totalProcessed >= maxJobs) {
        this.info(`Max jobs (${maxJobs}) reached. Stopping.`);
        break;
      }

      const processed = await Queue.work({
        queue: queueName,
        maxJobs: 1,
        sleep: 0,
      });

      if (processed > 0) {
        totalProcessed += processed;
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        this.success(`[${now}] Processed ${processed} job(s) (total: ${totalProcessed})`);
      } else {
        // No jobs — sleep before polling again
        await new Promise((resolve) => setTimeout(resolve, sleep));
      }
    }

    this.newLine();
    this.info(`Worker stopped. Total jobs processed: ${totalProcessed}`);
  }
}
