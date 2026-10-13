import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardController, configureDashboard, createDashboardDependencyObserver } from '../src/dashboard/index.js';
import { DashboardService, dashboardJobResource } from '../src/dashboard/DashboardService.js';
import { Queue, Job, type QueueAdapterRuntime, type QueueJobSnapshot, type QueueMonitoringAdapter } from '../src/queue/index.js';
import { ScheduleMonitor, type TaskInfo, type SchedulerHealth } from '../src/scheduler/ScheduleMonitor.js';
import { ApplicationContext } from '../src/support/Context.js';
import { createRequestEvent } from '../src/testing/request.js';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';
import { compile } from 'svelte/compiler';
import { createConfiguredDashboardDependencyObserver } from '../src/dashboard/configuredDependencies.js';
import { Connection } from '../src/database/Connection.js';
import { config } from '../src/config/index.js';
import { Cache } from '../src/cache/index.js';
import { Search } from '../src/search/index.js';
import { PDF } from '../src/pdf/index.js';
import { Broadcast } from '../src/broadcasting/index.js';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';
import { CreateSvelarJobsTable, CreateSvelarFailedJobsTable, AddQueueJobLeases, AddFailedQueueReplay, CreateQueueEventsTable } from '../src/database/index.js';

afterEach(async () => { try { await Queue.stop(); } finally { await Connection.disconnect(); vi.restoreAllMocks(); config.clear();
  Cache.configure({ default: 'memory', stores: { memory: { driver: 'memory' } } }); configureDashboard({ enabled: false, providers: {}, refreshInterval: 0 }); } });
const request = (path: string) => createRequestEvent({ url: 'http://localhost' + path, locals: { user: { id: 1, role: 'admin' } } });
const tasks: TaskInfo[] = Array.from({ length: 150 }, (_, index) => ({ name: 'Task' + String(index).padStart(3, '0'),
  expression: '* * * * *', humanReadable: 'Every minute', nextRun: null, enabled: true, isRunning: false, history: [] })).reverse();
const health: SchedulerHealth = { totalTasks: 150, enabledTasks: 150, runningTasks: 0, lastErrors: [], uptime: 10,
  processes: Array.from({ length: 125 }, (_, index) => ({ owner: 'scheduler-' + index, state: 'running', heartbeatAt: new Date(1000), healthy: true, lastError: null })) };
const runtime: QueueAdapterRuntime = { paused: null, workers: null, globalConcurrency: null, observedConcurrency: null, effectiveConcurrency: null,
  oldestWaitingAt: null, lag: null, stalled: 2, expiredLocks: 0, locksComplete: true, coverage: 'instrumented' };
function monitor(connection: string, queue: string): QueueMonitoringAdapter {
  const adapter = Queue.adapter();
  return { ...adapter, connection, queue, driver: 'redis', capabilities: { shared: true, indexedMetadata: true, durableReplay: true, pause: true },
    counts: vi.fn(async () => ({ waiting: 1, active: 0, completed: 0, failed: 1, delayed: 0, deadLetter: 0 })),
    runtime: vi.fn(async () => runtime), metrics: vi.fn<QueueMonitoringAdapter['metrics']>().mockResolvedValue({ source: 'redis', completed: 0, failed: 0, completedPerMinute: [], failedPerMinute: [], minutes: 60 }) };
}

describe('explicit operational observations', () => {
  it('observes a real SQLite worker queue absent from the web registry without leaking connection identity', async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'primary', connections: { primary: { driver: 'sqlite', filename: ':memory:' }, secondary: { driver: 'sqlite', filename: ':memory:' } } });
    try {
      for (const connection of ['primary', 'secondary']) await Connection.usingConnection(connection, async () => {
        for (const Migration of [CreateSvelarJobsTable, CreateSvelarFailedJobsTable, AddQueueJobLeases, AddFailedQueueReplay, CreateQueueEventsTable]) await new Migration().up();
      });
      Queue.configure({ default: 'primary', connections: { primary: { driver: 'database', databaseConnection: 'primary', queue: 'main' }, secondary: { driver: 'database', databaseConnection: 'secondary', queue: 'main' } } });
      class SharedProofJob extends Job { async handle() {} }
      Queue.register(SharedProofJob);
      await Queue.dispatch(new SharedProofJob(), { connection: 'secondary', queue: 'worker-only' });
      vi.spyOn(Queue, 'queues').mockReturnValue([{ name: 'main', connection: 'primary', label: 'Web label' }, { name: 'main', connection: 'secondary' }]);
      const result = await new DashboardService().topology();
      expect(result.registryCount).toBe(3); expect(result.discovery.complete).toBe(true);
      expect(result.topology.find((queue) => queue.name === 'worker-only')).toMatchObject({ connection: 'secondary', registered: false, discovered: true, counts: { waiting: 1 } });
      expect(result.topology.find((queue) => queue.name === 'main' && queue.connection === 'primary')).toMatchObject({ counts: { waiting: 0 }, definition: { label: 'Web label' } });
      expect(result.topology.every((queue) => queue.runtime?.effectiveConcurrency === null)).toBe(true);
    } finally { await Queue.stop(); await Connection.disconnect(); }
  });
  it('discovers every configured shared connection and deduplicates local/default/observed names without erasing metadata', async () => {
    const selected = monitor('primary', 'main');
    vi.spyOn(Queue, 'configuredConnections').mockReturnValue({ connections: [
      { name: 'primary', driver: 'redis', queue: 'main', isDefault: true }, { name: 'secondary', driver: 'database', queue: 'main', isDefault: false },
    ], total: 2, limit: 100, offset: 0, hasMore: false });
    vi.spyOn(Queue, 'queues').mockReturnValue([{ name: 'main', connection: 'primary', label: 'Local label', metadata: { token: 'SECRET', flow: 'Imports' } }]);
    vi.spyOn(Queue, 'jobDefinitions').mockReturnValue([{ name: 'ImportJob', queue: 'main', label: 'Import work' }]);
    vi.spyOn(Queue, 'workerProfiles').mockReturnValue([{ name: 'imports', queue: 'main', concurrency: 6 }]);
    const discover = vi.spyOn(Queue, 'discoverQueuesPage').mockImplementation(async (connection) => ({ queues: connection === 'primary'
      ? [{ name: 'main', connection: 'primary' }, { name: 'observed-only', connection: 'primary' }] : [{ name: 'main', connection: 'secondary' }],
      total: null, complete: true, nextCursor: null, coverage: 'instrumented' }));
    const compatibility = vi.spyOn(Queue, 'discoverQueues'); vi.spyOn(Queue, 'adapter').mockReturnValue(selected);
    const result = await new DashboardService().topology();
    expect(result.registryCount).toBe(3); expect(result.topology.map((row) => [row.connection, row.name])).toEqual([
      ['primary', 'main'], ['primary', 'observed-only'], ['secondary', 'main']]);
    expect(discover.mock.calls).toEqual([['primary', { limit: 100 }], ['secondary', { limit: 100 }]]); expect(compatibility).not.toHaveBeenCalled();
    expect(result.topology[0]).toMatchObject({ registered: true, discovered: true, definition: { label: 'Local label', metadata: { flow: 'Imports', token: '[redacted]' } },
      jobs: [{ name: 'ImportJob' }], workerProfiles: [{ name: 'imports', concurrency: 6 }] });
    expect(result.topology[1]).toMatchObject({ registered: false, discovered: true }); expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result.aggregate).toMatchObject({ counts: { waiting: 3, failed: 3 }, stalled: 6, expiredLocks: 0, locksComplete: true });
  });
  it('does not call a partial discovered page complete or manufacture aggregate counts/locks', async () => {
    const selected = monitor('primary', 'main');
    vi.spyOn(Queue, 'configuredConnections').mockReturnValue({ connections: [{ name: 'primary', driver: 'redis', queue: 'main', isDefault: true }], total: 1, limit: 100, offset: 0, hasMore: false });
    vi.spyOn(Queue, 'queues').mockReturnValue([]); vi.spyOn(Queue, 'adapter').mockReturnValue(selected);
    const discover = vi.spyOn(Queue, 'discoverQueuesPage').mockResolvedValue({ queues: [{ name: 'main', connection: 'primary' }], total: null, complete: false, nextCursor: 'next', coverage: 'instrumented' });
    const result = await new DashboardService().topology();
    expect(discover).toHaveBeenCalledTimes(1); expect(result.discovery).toMatchObject({ complete: false, pages: [{ nextCursor: 'next', complete: false }] });
    expect(result.aggregate).toEqual({ counts: null, stalled: null, expiredLocks: null, locksComplete: false });
  });
  it('exposes bounded, redacted retained stacks, attempts-started and all available timestamps', () => {
    const snapshot: QueueJobSnapshot = { id: '1', connection: 'primary', queue: 'main', jobClass: 'ImportJob', status: 'failed', attempts: 2,
      attemptsStarted: 3, maxAttempts: 4, stalledCount: 1, createdAt: 1000, processedAt: 2000, finishedAt: 3000, delayedUntil: 4000,
      payload: '{}', error: 'token=SECRET\n at handler.ts:1', stacktrace: Array.from({ length: 7 }, (_, index) => 'Trace' + index + ' password=SECRET\n' + 'x'.repeat(20_000)),
      lock: { source: 'worker-observation', state: 'expired', expiresAt: 5000, owner: 'worker-id' } };
    const resource = dashboardJobResource(snapshot);
    expect(resource).toMatchObject({ attemptsStarted: 3, createdAt: 1000, processedAt: 2000, finishedAt: 3000, delayedUntil: 4000,
      stacktraceMeta: { total: 7, truncated: true }, lock: { expiresAt: 5000, source: 'worker-observation' } });
    expect(resource.stacktrace).toHaveLength(5); expect(resource.stacktrace.reduce((total, trace) => total + trace.length, 0)).toBeLessThanOrEqual(32_000);
    expect(resource.stacktrace[0]).toContain('Trace2'); expect(JSON.stringify(resource)).not.toContain('SECRET');
  });
  it('pages every registered scheduler task beyond 100 with exact totals and process coverage', async () => {
    vi.spyOn(ScheduleMonitor, 'listTasks').mockImplementation(async () => [...tasks]); vi.spyOn(ScheduleMonitor, 'getHealth').mockResolvedValue(health);
    configureDashboard({ enabled: true, authorize: () => true, refreshInterval: 0 });
    const response = await new DashboardController().handle('scheduler')(request('/api/admin/scheduler?limit=25&offset=125&processOffset=100'));
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.data.tasks).toHaveLength(25); expect(body.data.tasks[0].name).toBe('Task125'); expect(body.data.tasks[24].name).toBe('Task149');
    expect(body.meta).toEqual({ total: 150, limit: 25, offset: 125, hasMore: false, truncated: true });
    expect(body.data.health.totalTasks).toBe(150); expect(body.data.health.enabledTasks).toBe(150);
    expect(body.data.health.processes).toHaveLength(25); expect(body.data.health.processes[0].owner).toBe('scheduler-100');
    expect(body.data.health.processesMeta).toEqual({ total: null, observedTotal: 125, sourceLimit: 100, sourceTruncated: true, limit: 25, offset: 100, hasMore: false, truncated: true });
  });
  it.each(['limit=0', 'limit=101', 'offset=-1', 'processOffset=-1', 'offset=1.5'])('rejects invalid scheduler page %s before querying', async (query) => {
    const list = vi.spyOn(ScheduleMonitor, 'listTasks'); configureDashboard({ enabled: true, authorize: () => true, refreshInterval: 0 });
    expect((await new DashboardController().handle('scheduler')(request('/api/admin/scheduler?' + query))).status).toBe(422);
    expect(list).not.toHaveBeenCalled();
  });
  it('marks absent scheduler process observations unknown and never manufactures healthy zero', async () => {
    vi.spyOn(ScheduleMonitor, 'listTasks').mockResolvedValue([]); vi.spyOn(ScheduleMonitor, 'getHealth').mockResolvedValue({ ...health, processes: undefined });
    const result = await new DashboardService().scheduler();
    expect(result.runtimeScope).toBe('unknown'); expect(result.health).toMatchObject({ processesMeta: { total: null } });
  });
  it('coalesces concurrent read-only dependency probes and never exposes their exception text or ambient actor', async () => {
    const check = vi.fn(async () => { expect(ApplicationContext.get('actorId')).toBeUndefined(); return 'healthy' as const; });
    const failed = vi.fn(async () => { throw new Error('token=SECRET'); });
    const observe = createDashboardDependencyObserver(() => [{ name: 'database:primary', scope: 'shared', check }, { name: 'mail:smtp', scope: 'unknown' }, { name: 'search', scope: 'shared', check: failed }]);
    const [first, second] = await ApplicationContext.runIsolated({ actorId: 'operator' }, () => Promise.all([observe(), observe()]));
    expect(first).toEqual(second); expect(check).toHaveBeenCalledTimes(1); expect(failed).toHaveBeenCalledTimes(1);
    expect(first[1]).toMatchObject({ status: 'unknown', latencyMs: null, reason: 'unsupported' });
    expect(first[2]).toMatchObject({ status: 'unavailable', reason: 'probe-failed' }); expect(JSON.stringify(first)).not.toContain('SECRET');
    await observe(); expect(check).toHaveBeenCalledTimes(1);
  });
  it('does not start duplicate SDK calls after deadlines and bounds the hung pool across changing configurations', async () => {
    const check = vi.fn(() => new Promise<'healthy'>(() => {})); let name = 'queue:first';
    const observe = createDashboardDependencyObserver(() => [{ name, scope: 'shared', check }], { timeoutMs: 10, cacheMs: 0, concurrency: 1 });
    expect((await observe())[0]).toMatchObject({ status: 'unknown', reason: 'timeout' });
    expect((await observe())[0]).toMatchObject({ status: 'unknown', reason: 'timeout' }); expect(check).toHaveBeenCalledTimes(1);
    name = 'queue:second'; expect((await observe())[0]).toMatchObject({ status: 'unknown', reason: 'capacity' }); expect(check).toHaveBeenCalledTimes(1);
  });
  it('bounds the registered dependency count and validates public metadata before probing', async () => {
    const check = vi.fn(async () => 'healthy' as const);
    const observe = createDashboardDependencyObserver(() => Array.from({ length: 101 }, (_, index) => ({ name: 'probe-' + index, scope: 'shared', check })));
    await expect(observe()).rejects.toThrow('100'); expect(check).not.toHaveBeenCalled();
  });
  it('observes declared named dependencies with public read-only proofs and leaves unsupported optional SDKs unknown', async () => {
    config.load({ database: { connections: { primary: {}, secondary: {} } }, cache: { default: 'fast', stores: { fast: { driver: 'memory' }, disabled: { driver: 'null' }, shared: { driver: 'redis' } } },
      storage: { disks: { uploads: { secretAccessKey: 'SECRET' } } }, mail: { default: 'smtp', mailers: { smtp: { password: 'SECRET' }, resend: { apiKey: 'SECRET' } } } });
    Connection.configure({ default: 'primary', connections: { primary: { driver: 'sqlite', filename: ':memory:' }, secondary: { driver: 'sqlite', filename: ':memory:' } } });
    const query = vi.spyOn(Connection, 'raw').mockResolvedValue([]);
    const read = vi.fn(async () => null); Cache.configure({ default: 'fast', stores: { fast: { driver: 'memory' }, disabled: { driver: 'null' }, shared: { driver: 'redis', client: { get: read } } } });
    vi.spyOn(Queue, 'configuredConnections').mockReturnValue({ connections: [{ name: 'unused-connection', driver: 'redis', queue: 'imports', isDefault: false },
      { name: 'inline', driver: 'sync', queue: 'default', isDefault: true }], total: 2, limit: 100, offset: 0, hasMore: false });
    const selected = monitor('unused-connection', 'imports'); vi.spyOn(Queue, 'adapter').mockReturnValue(selected);
    vi.spyOn(Search, 'isConfigured').mockReturnValue(true); vi.spyOn(Search, 'health').mockResolvedValue({ status: 'available' });
    vi.spyOn(PDF, 'health').mockResolvedValue({ status: 'up', driver: 'pdfkit' }); vi.spyOn(Broadcast, 'ready').mockResolvedValue();
    const results = await createConfiguredDashboardDependencyObserver({ cacheStores: [{ name: 'fast', driver: 'memory' }, { name: 'disabled', driver: 'null' }, { name: 'shared', driver: 'redis' }] })();
    expect(query.mock.calls).toEqual([['SELECT 1'], ['SELECT 1', [], 'primary'], ['SELECT 1', [], 'secondary']]); expect(read).toHaveBeenCalledTimes(1);
    expect(results).toContainEqual(expect.objectContaining({ name: 'queue:unused-connection', status: 'healthy', scope: 'shared' }));
    expect(results).toContainEqual(expect.objectContaining({ name: 'cache:fast', status: 'healthy', scope: 'process' }));
    for (const name of ['storage:uploads', 'mail:smtp', 'mail:resend', 'queue:inline', 'cache:disabled']) expect(results).toContainEqual(expect.objectContaining({ name, status: 'unknown', latencyMs: null }));
    expect(results.find((entry) => entry.name === 'realtime:subscription')?.status).toBe('unknown'); expect(JSON.stringify(results)).not.toContain('SECRET');
    const generated = NewCommandTemplates.dashboardProvidersService();
    expect(generated).toContain('dependencies: createConfiguredDashboardDependencyObserver(health)');
  });
  it('never treats a declared Redis cache name or a successful Null read as runtime driver proof', async () => {
    config.load({ cache: { default: 'redis', stores: { redis: { driver: 'redis' } } } });
    Cache.configure({ default: 'redis', stores: { redis: { driver: 'null' } } });
    const result = await createConfiguredDashboardDependencyObserver()();
    expect(result.find((dependency) => dependency.name === 'cache:redis')).toMatchObject({ status: 'unknown', scope: 'unknown' });
  });
  it('does not hide an observed outage behind an unrelated unknown optional dependency', async () => {
    configureDashboard({ enabled: true, authorize: () => true, providers: { dependencies: async () => [
      { name: 'search', status: 'unavailable', latencyMs: 10 }, { name: 'mail', status: 'unknown', latencyMs: null },
    ] } });
    const response = await new DashboardController().handle('health')(request('/api/admin/health'));
    expect((await response.json()).data.status).toBe('degraded');
  });
  it('renders finite task/process controls, lock provenance, timestamps, progress and timeline attempts with Svelte 5', () => {
    const files = new MakeDashboardCommand().files({ public: true, scope: 'platform', route: '/admin/dashboard' });
    const ui = files.find((file) => file.path.endsWith('/dashboard/+page.svelte'))!.content;
    for (const token of ['Next tasks', 'Next processes', 'taskOffset', 'processOffset', 'Registry metadata', 'Stalls / expired locks',
      'inspected.processedAt', 'inspected.finishedAt', 'inspected.delayedUntil', 'inspected.progress', 'entry.attempt', 'entry.replayJobId', 'record(inspected.lock).expiresAt']) expect(ui).toContain(token);
    expect(compile(ui, { generate: 'client' }).warnings.filter((warning) => warning.code.startsWith('a11y'))).toEqual([]);
  });
});
