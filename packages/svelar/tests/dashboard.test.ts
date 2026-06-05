import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../src/container/Container.js';
import { Dashboard, configureDashboard } from '../src/dashboard/index.js';
import { JobMonitor } from '../src/queue/JobMonitor.js';
import { ScheduleMonitor } from '../src/scheduler/ScheduleMonitor.js';

describe('Dashboard health collection', () => {
  afterEach(async () => {
    await Dashboard.shutdown();
    configureDashboard({ enabled: false, refreshInterval: 0 });
    vi.restoreAllMocks();
  });

  it('records successful background health collection state', async () => {
    vi.spyOn(JobMonitor, 'getHealth').mockResolvedValue({
      driver: 'memory',
      queues: {},
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
});
