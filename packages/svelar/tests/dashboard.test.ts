import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../src/container/Container.js';
import { Dashboard, configureDashboard } from '../src/dashboard/index.js';
import { JobMonitor } from '../src/queue/JobMonitor.js';
import { ScheduleMonitor } from '../src/scheduler/ScheduleMonitor.js';

describe('Dashboard health collection', () => {
  afterEach(async () => {
    await Dashboard.shutdown();
    configureDashboard({ enabled: false, refreshInterval: 0 });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records successful background health collection state', async () => {
    vi.spyOn(JobMonitor, 'getHealth').mockResolvedValue({
      driver: 'memory',
      registry: [],
      registeredJobs: [],
      queues: {},
      runtime: {},
      failureRate: 0,
      throughput: 0,
    });
    vi.spyOn(ScheduleMonitor, 'getHealth').mockResolvedValue({
      totalTasks: 0,
      enabledTasks: 0,
      runningTasks: 0,
      lastErrors: [],
      uptime: 0,
    });

    configureDashboard({ enabled: true, refreshInterval: 60_000 });

    await Dashboard.boot(new Container());

    const status = Dashboard.getHealthCollectionStatus();
    expect(status.lastRunAt).not.toBeNull();
    expect(status.lastSuccessAt).not.toBeNull();
    expect(status.lastError).toBeNull();
    expect(status.failures).toBe(0);
    expect(Dashboard.getLatestHealthSnapshot()?.status).toBe('healthy');

    const data = await Dashboard.getDashboardData();
    expect(data.healthCollection.lastSuccessAt).not.toBeNull();
  });

  it('records failed background health collection state and rejects startup collection', async () => {
    vi.spyOn(JobMonitor, 'getHealth').mockRejectedValue(new Error('queue monitor unavailable'));
    vi.spyOn(ScheduleMonitor, 'getHealth').mockResolvedValue({
      totalTasks: 0,
      enabledTasks: 0,
      runningTasks: 0,
      lastErrors: [],
      uptime: 0,
    });

    configureDashboard({ enabled: true, refreshInterval: 60_000 });

    await expect(Dashboard.boot(new Container())).rejects.toThrow('queue monitor unavailable');

    const status = Dashboard.getHealthCollectionStatus();
    expect(status.lastRunAt).not.toBeNull();
    expect(status.lastErrorAt).not.toBeNull();
    expect(status.lastError).toBe('queue monitor unavailable');
    expect(status.failures).toBe(1);
  });

  it('starts polling only after boot and does not accumulate timers on repeated boot/configuration', async () => {
    vi.useFakeTimers();
    vi.spyOn(JobMonitor, 'getHealth').mockResolvedValue({ driver: 'sync', registry: [], registeredJobs: [], queues: {}, runtime: {}, failureRate: 0, throughput: 0 });
    vi.spyOn(ScheduleMonitor, 'getHealth').mockResolvedValue({ totalTasks: 0, enabledTasks: 0, runningTasks: 0, lastErrors: [], uptime: 0 });
    configureDashboard({ enabled: true, refreshInterval: 100 });
    expect(vi.getTimerCount()).toBe(0);
    await Dashboard.boot(new Container());
    expect(vi.getTimerCount()).toBe(1);
    await Dashboard.boot(new Container());
    expect(vi.getTimerCount()).toBe(1);
    configureDashboard({ refreshInterval: 200 });
    expect(vi.getTimerCount()).toBe(1);
    await Dashboard.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overlap slow health snapshots', async () => {
    vi.useFakeTimers();
    const health = { driver: 'sync', registry: [], registeredJobs: [], queues: {}, runtime: {}, failureRate: 0, throughput: 0 };
    const monitor = vi.spyOn(JobMonitor, 'getHealth').mockResolvedValue(health);
    vi.spyOn(ScheduleMonitor, 'getHealth').mockResolvedValue({ totalTasks: 0, enabledTasks: 0, runningTasks: 0, lastErrors: [], uptime: 0 });
    configureDashboard({ enabled: true, refreshInterval: 100 });
    await Dashboard.boot(new Container());
    let resolve!: (value: typeof health) => void;
    monitor.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await vi.advanceTimersByTimeAsync(500);
    expect(monitor).toHaveBeenCalledTimes(2);
    resolve(health);
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each([-1, NaN, Infinity, 0.5, 2_147_483_648])('rejects invalid timer intervals %s', (refreshInterval) => {
    expect(() => configureDashboard({ refreshInterval })).toThrow('refreshInterval');
  });

  it('does not restart polling if shutdown happens during the initial snapshot', async () => {
    vi.useFakeTimers();
    const health = { driver: 'sync', registry: [], registeredJobs: [], queues: {}, runtime: {}, failureRate: 0, throughput: 0 };
    let resolve!: (value: typeof health) => void;
    vi.spyOn(JobMonitor, 'getHealth').mockImplementation(() => new Promise((done) => { resolve = done; }));
    vi.spyOn(ScheduleMonitor, 'getHealth').mockResolvedValue({ totalTasks: 0, enabledTasks: 0, runningTasks: 0, lastErrors: [], uptime: 0 });
    configureDashboard({ enabled: true, refreshInterval: 100 });
    const boot = Dashboard.boot(new Container());
    await vi.advanceTimersByTimeAsync(0);
    await Dashboard.shutdown();
    resolve(health);
    await boot;
    expect(vi.getTimerCount()).toBe(0);
  });
});
