/**
 * queue:work — Process queued jobs
 */

import { Command } from '../Command.js';

export class QueueWorkCommand extends Command {
  name = 'queue:work';
  description = 'Process queued jobs';
  flags = [
    { name: 'queue', description: 'Queue name to process (default: profile or configured queue)', type: 'string' as const },
    { name: 'connection', description: 'Configured queue connection', type: 'string' as const },
    { name: 'profile', description: 'Registered worker profile', type: 'string' as const },
    { name: 'max-jobs', description: 'Stop after processing N jobs', type: 'string' as const },
    { name: 'max-time', description: 'Stop after N seconds', type: 'string' as const },
    { name: 'sleep', description: 'Sleep N milliseconds between polls (default: 1000)', type: 'string' as const, default: '1000' },
    { name: 'concurrency', description: 'Parallel Redis jobs (default: profile or 1)', type: 'string' as const },
    { name: 'lock-duration', description: 'BullMQ lock duration in milliseconds (default: BullMQ default)', type: 'string' as const },
    { name: 'stalled-interval', description: 'BullMQ stalled job check interval in milliseconds (default: BullMQ default)', type: 'string' as const },
    { name: 'max-stalled-count', description: 'Maximum stalled recoveries before failing a Redis job', type: 'string' as const },
    { name: 'grace-period', description: 'Seconds to wait for graceful shutdown before exiting on signal (default: 30)', type: 'string' as const, default: '30' },
    { name: 'once', description: 'Process a single job and exit', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const { Queue } = await import('../../queue/index.js');

    const queueName = flags.queue;
    const maxJobs = parsePositiveInteger(flags['max-jobs'], 'max-jobs');
    const maxTime = parsePositiveInteger(flags['max-time'], 'max-time');
    const sleepMs = parseNonNegativeInteger(flags.sleep, 'sleep') ?? 1000;
    const concurrency = parsePositiveInteger(flags.concurrency, 'concurrency');
    const lockDuration = parsePositiveInteger(flags['lock-duration'], 'lock-duration');
    const stalledInterval = parsePositiveInteger(flags['stalled-interval'], 'stalled-interval');
    const maxStalledCount = parseNonNegativeInteger(flags['max-stalled-count'], 'max-stalled-count');
    const gracePeriod = parsePositiveInteger(flags['grace-period'], 'grace-period') ?? 30;
    for (const [flag, value] of [['max-time', maxTime], ['grace-period', gracePeriod]] as const) {
      if (value !== undefined && value > 2_147_483) throw new Error(`--${flag} exceeds the supported timer duration.`);
    }

    this.info(`Processing ${queueName ? `queue "${queueName}"` : flags.profile ? `profile "${flags.profile}"` : 'configured queue'}...`);
    if (maxJobs) this.info(`Will stop after ${maxJobs} jobs.`);
    if (maxTime) this.info(`Will stop after ${maxTime} seconds.`);
    if (concurrency !== undefined && concurrency > 1) this.info(`Redis/BullMQ concurrency: ${concurrency}.`);
    this.newLine();

    // Continuous worker mode. Redis/BullMQ uses one native Worker; poll drivers
    // loop inside Queue.work() until Queue.stop() is called.
    if (!flags.once) {
      this.info(`Worker running. Press Ctrl+C to stop.`);
      this.newLine();
    }

    let shutdown: Promise<void> | null = null;
    let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimeTimer: ReturnType<typeof setTimeout> | null = null;

    const stopWorker = (reason: string): Promise<void> => shutdown ??= (async () => {
      this.info(`${reason}. Stopping worker gracefully...`);

      shutdownTimer = setTimeout(() => {
        this.error(`Worker did not stop within ${gracePeriod}s. Exiting.`);
        process.exit(1);
      }, gracePeriod * 1000);
      shutdownTimer.unref?.();

      await Queue.stop();
    })();

    const handleSignal = (signal: NodeJS.Signals) => {
      void stopWorker(`Received ${signal}`).catch((error) => {
        this.exitCode = 1;
        this.error(error instanceof Error ? error.message : String(error));
      });
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    if (maxTime) {
      maxTimeTimer = setTimeout(() => {
        void stopWorker(`Max time (${maxTime}s) reached`).catch((error) => {
          this.exitCode = 1;
          this.error(error instanceof Error ? error.message : String(error));
        });
      }, maxTime * 1000);
      maxTimeTimer.unref?.();
    }

    try {
      const processed = await Queue.work({
        queue: queueName,
        maxJobs: flags.once ? 1 : maxJobs,
        sleep: flags.once ? 0 : sleepMs / 1000,
        ...(!flags.once || flags.concurrency !== undefined || flags.profile ? { concurrency } : {}),
        lockDuration,
        stalledInterval,
        ...(maxStalledCount !== undefined ? { maxStalledCount } : {}),
        ...(flags.connection ? { connection: flags.connection } : {}),
        ...(flags.profile ? { profile: flags.profile } : {}),
      });

      if (shutdown) await shutdown;
      this.newLine();
      if (flags.once) {
        if (processed === 0) this.info('No jobs to process.');
        else this.success(`Processed ${processed} job(s).`);
      } else this.info(`Worker stopped. Total jobs processed: ${processed}`);
    } finally {
      try { if (shutdown) await shutdown; }
      finally {
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
        if (maxTimeTimer) clearTimeout(maxTimeTimer);
        if (shutdownTimer) clearTimeout(shutdownTimer);
      }
    }
  }
}

function parsePositiveInteger(value: unknown, flag: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!/^[0-9]+$/.test(String(value)) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`--${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: unknown, flag: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!/^[0-9]+$/.test(String(value)) || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`--${flag} must be a non-negative integer.`);
  }
  return parsed;
}
