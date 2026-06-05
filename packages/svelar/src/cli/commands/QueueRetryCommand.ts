/**
 * queue:retry — Retry failed jobs
 */

import { Command } from '../Command.js';

export class QueueRetryCommand extends Command {
  name = 'queue:retry';
  description = 'Retry a failed job (or all failed jobs)';
  arguments = ['id'];
  flags = [
    { name: 'all', description: 'Retry all failed jobs', type: 'boolean' as const, default: false },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const id = args[0];
    if (!flags.all && !id) {
      throw new Error('Please provide a failed job ID, or use --all to retry all.');
    }

    const { Queue } = await import('../../queue/index.js');

    if (flags.all) {
      let count: number;
      try {
        count = await Queue.retryAll();
      } catch (error: any) {
        if (typeof error?.retried === 'number' && Array.isArray(error?.failures)) {
          if (error.retried > 0) {
            this.success(`Retried ${error.retried} job(s).`);
          }
          for (const failure of error.failures) {
            this.error(`Could not retry ${failure.id} (${failure.jobClass}): ${failure.error}`);
          }
        }
        throw error;
      }

      if (count === 0) {
        this.info('No failed jobs to retry.');
      } else {
        this.success(`Retried ${count} job(s).`);
      }
      return;
    }

    const retried = await Queue.retry(id);
    if (retried) {
      this.success(`Job ${id} has been pushed back onto the queue.`);
    } else {
      throw new Error(`Failed job with ID "${id}" not found.`);
    }
  }
}
