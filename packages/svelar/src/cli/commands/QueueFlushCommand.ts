/**
 * queue:flush — Delete all failed job records
 */

import { Command } from '../Command.js';

export class QueueFlushCommand extends Command {
  name = 'queue:flush';
  description = 'Delete all failed job records';

  async handle(_args: string[], _flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const { Queue } = await import('../../queue/index.js');

    const count = await Queue.flushFailed();

    if (count === 0) {
      this.info('No failed jobs to flush.');
    } else {
      this.success(`Flushed ${count} failed job record(s).`);
    }
  }
}
