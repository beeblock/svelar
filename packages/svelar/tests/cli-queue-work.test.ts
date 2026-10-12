import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueWorkCommand } from '../src/cli/commands/QueueWorkCommand.js';
import { Queue } from '../src/queue/index.js';

describe('QueueWorkCommand', () => {
  beforeEach(() => {
    vi.spyOn(QueueWorkCommand.prototype as any, 'bootstrap').mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('passes worker lifecycle options to Queue.work', async () => {
    const work = vi.spyOn(Queue, 'work').mockResolvedValue(10);
    const stop = vi.spyOn(Queue, 'stop').mockResolvedValue(undefined);

    await new QueueWorkCommand().handle([], {
      queue: 'emails',
      'max-jobs': '10',
      sleep: '250',
      concurrency: '4',
      'lock-duration': '45000',
      'stalled-interval': '30000',
    });

    expect(work).toHaveBeenCalledWith({
      queue: 'emails',
      maxJobs: 10,
      sleep: 0.25,
      concurrency: 4,
      lockDuration: 45000,
      stalledInterval: 30000,
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it('stops a long-lived worker when max-time is reached', async () => {
    vi.useFakeTimers();

    let resolveWork!: (processed: number) => void;
    const work = vi.spyOn(Queue, 'work').mockImplementation(async () => {
      return new Promise<number>((resolve) => {
        resolveWork = resolve;
      });
    });
    const stop = vi.spyOn(Queue, 'stop').mockImplementation(async () => {
      resolveWork(3);
    });

    const run = new QueueWorkCommand().handle([], {
      queue: 'default',
      'max-time': '1',
      sleep: '1000',
    });

    await vi.waitFor(() => expect(work).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(1000);
    await run;

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('uses finite worker mode for --once', async () => {
    const work = vi.spyOn(Queue, 'work').mockResolvedValue(0);

    await new QueueWorkCommand().handle([], {
      once: true,
      queue: 'critical',
      'lock-duration': '45000',
    });

    expect(work).toHaveBeenCalledWith({
      queue: 'critical',
      maxJobs: 1,
      sleep: 0,
      lockDuration: 45000,
      stalledInterval: undefined,
    });
  });

  it('rejects invalid numeric flags', async () => {
    await expect(
      new QueueWorkCommand().handle([], { concurrency: '0' }),
    ).rejects.toThrow('--concurrency must be a positive integer.');
  });
});
