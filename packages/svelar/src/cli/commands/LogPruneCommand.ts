import { Command } from '../Command.js';
import { LogViewer } from '../../logging/LogViewer.js';

export class LogPruneCommand extends Command {
  name = 'log:prune';
  description = 'Prune expired shared log entries using the configured retention policy';
  flags = [
    { name: 'batch-size', description: 'Rows per delete (1..10000; defaults to viewer configuration or 1000)', type: 'string' as const },
    { name: 'max-batches', description: 'Maximum deletes (1..10000; defaults to viewer configuration or 100)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    if (args.length) throw new Error('log:prune does not accept positional arguments.');
    for (const name of Object.keys(flags)) {
      if (!this.flags.some((flag) => flag.name === name)) throw new Error(`Unsupported log:prune flag --${name}.`);
    }
    const batchSize = this.boundedInteger(flags['batch-size'], 'batch-size');
    const maxBatches = this.boundedInteger(flags['max-batches'], 'max-batches');
    await this.bootstrap();
    if (!LogViewer.isConfigured() || !LogViewer.enabled || LogViewer.scope !== 'shared database') {
      throw new Error('log:prune requires an explicitly configured, enabled database log viewer in the application bootstrap.');
    }
    const deleted = await LogViewer.prune(new Date(), { batchSize, maxBatches });
    this.success(`Pruned ${deleted} expired log entries (bounded run; repeat if more remain).`);
  }

  private boundedInteger(value: unknown, flag: string): number | undefined {
    if (value === undefined) return undefined;
    const number = Number(value);
    if (!/^[0-9]+$/.test(String(value)) || !Number.isSafeInteger(number) || number < 1 || number > 10_000) {
      throw new Error(`--${flag} must be an integer between 1 and 10000.`);
    }
    return number;
  }
}
