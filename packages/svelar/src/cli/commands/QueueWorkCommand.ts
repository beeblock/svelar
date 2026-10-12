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
    { name: 'concurrency', description: 'Number of jobs to process in parallel for Redis/BullMQ workers (default: 1)', type: 'string' as const, default: '1' },
    { name: 'lock-duration', description: 'BullMQ lock duration in milliseconds (default: BullMQ default)', type: 'string' as const },
    { name: 'stalled-interval', description: 'BullMQ stalled job check interval in milliseconds (default: BullMQ default)', type: 'string' as const },
    { name: 'grace-period', description: 'Seconds to wait for graceful shutdown before exiting on signal (default: 30)', type: 'string' as const, default: '30' },
    { name: 'once', description: 'Process a single job and exit', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const { Queue } = await import('../../queue/index.js');

    const queueName = flags.queue ?? 'default';
    const maxJobs = parsePositiveInteger(flags['max-jobs'], 'max-jobs');
    const maxTime = parsePositiveInteger(flags['max-time'], 'max-time');
    const sleepMs = parseNonNegativeInteger(flags.sleep, 'sleep') ?? 1000;
    const concurrency = parsePositiveInteger(flags.concurrency, 'concurrency') ?? 1;
    const lockDuration = parsePositiveInteger(flags['lock-duration'], 'lock-duration');
    const stalledInterval = parsePositiveInteger(flags['stalled-interval'], 'stalled-interval');
    const gracePeriod = parsePositiveInteger(flags['grace-period'], 'grace-period') ?? 30;

    this.info(`Processing queue "${queueName}"...`);
    if (maxJobs) this.info(`Will stop after ${maxJobs} jobs.`);
    if (maxTime) this.info(`Will stop after ${maxTime} seconds.`);
    if (concurrency > 1) this.info(`Redis/BullMQ concurrency: ${concurrency}.`);
    this.newLine();

    if (flags.once) {
      // Process single job
      const processed = await Queue.work({
        queue: queueName,
        maxJobs: 1,
        sleep: 0,
        lockDuration,
        stalledInterval,
      });
      if (processed === 0) {
        this.info('No jobs to process.');
      } else {
        this.success(`Processed ${processed} job(s).`);
      }
      return;
    }

    // Continuous worker mode. Redis/BullMQ uses one native Worker; poll drivers
    // loop inside Queue.work() until Queue.stop() is called.
    this.info(`Worker running on "${queueName}". Press Ctrl+C to stop.`);
    this.newLine();

    let stopping = false;
    let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimeTimer: ReturnType<typeof setTimeout> | null = null;

    const stopWorker = async (reason: string, forceExit = false) => {
      if (stopping) return;
      stopping = true;
      this.info(`${reason}. Stopping worker gracefully...`);

      if (forceExit) {
        shutdownTimer = setTimeout(() => {
          this.error(`Worker did not stop within ${gracePeriod}s. Exiting.`);
          process.exit(1);
        }, gracePeriod * 1000);
        shutdownTimer.unref?.();
      }

      await Queue.stop();
    };

    const handleSignal = (signal: NodeJS.Signals) => {
      void stopWorker(`Received ${signal}`, true);
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    if (maxTime) {
      maxTimeTimer = setTimeout(() => {
        void stopWorker(`Max time (${maxTime}s) reached`);
      }, maxTime * 1000);
      maxTimeTimer.unref?.();
    }

    try {
      const processed = await Queue.work({
        queue: queueName,
        maxJobs,
        sleep: sleepMs / 1000,
        concurrency,
        lockDuration,
        stalledInterval,
      });

      this.newLine();
      this.info(`Worker stopped. Total jobs processed: ${processed}`);
    } finally {
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
      if (maxTimeTimer) clearTimeout(maxTimeTimer);
      if (shutdownTimer) clearTimeout(shutdownTimer);
    }
  }
}

function parsePositiveInteger(value: unknown, flag: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: unknown, flag: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${flag} must be a non-negative integer.`);
  }
  return parsed;
}
