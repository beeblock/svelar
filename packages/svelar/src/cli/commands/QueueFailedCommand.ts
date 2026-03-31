/**
 * queue:failed — List all failed jobs
 */

import { Command } from '../Command.js';

export class QueueFailedCommand extends Command {
  name = 'queue:failed';
  description = 'List all failed jobs';

  async handle(_args: string[], _flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const { Queue } = await import('../../queue/index.js');

    const failures = await Queue.failed();

    if (failures.length === 0) {
      this.info('No failed jobs.');
      return;
    }

    this.info(`Found ${failures.length} failed job(s):\n`);

    for (const f of failures) {
      const date = new Date(f.failedAt * 1000).toISOString().replace('T', ' ').slice(0, 19);
      this.log(`  ID:    ${f.id}`);
      this.log(`  Job:   ${f.jobClass}`);
      this.log(`  Queue: ${f.queue}`);
      this.log(`  Date:  ${date}`);
      this.log(`  Error: ${f.exception.split('\n')[0]}`);
      this.log('');
    }
  }
}
