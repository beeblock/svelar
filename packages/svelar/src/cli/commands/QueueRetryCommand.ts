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

    const { Queue } = await import('../../queue/index.js');

    if (flags.all) {
      const count = await Queue.retryAll();
      if (count === 0) {
        this.info('No failed jobs to retry.');
      } else {
        this.success(`Retried ${count} job(s).`);
      }
      return;
    }

    const id = args[0];
    if (!id) {
      this.error('Please provide a failed job ID, or use --all to retry all.');
      process.exit(1);
    }

    const retried = await Queue.retry(id);
    if (retried) {
      this.success(`Job ${id} has been pushed back onto the queue.`);
    } else {
      this.error(`Failed job with ID "${id}" not found.`);
    }
  }
}
