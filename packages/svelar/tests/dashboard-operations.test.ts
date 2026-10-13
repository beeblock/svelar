import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import ts from 'typescript';
import { DashboardController, configureDashboard, redactDashboardPayload, redactDashboardValue } from '../src/dashboard/index.js';
import { dashboardQueueSchema } from '../src/dashboard/contracts.js';
import { Queue, type QueueMonitoringAdapter, type QueueJobSnapshot } from '../src/queue/index.js';
import { ScheduleMonitor } from '../src/scheduler/ScheduleMonitor.js';
import { LogViewer } from '../src/logging/LogViewer.js';
import { Log } from '../src/logging/index.js';
import { Audit } from '../src/audit/index.js';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';
import type { RequestEvent } from '../src/routing/Controller.js';

const counts = { waiting: 2, active: 1, completed: 4, failed: 3, delayed: 0, deadLetter: 0 };
const job: QueueJobSnapshot = { id: '17', connection: 'broker', queue: 'imports', jobClass: 'ImportJob', status: 'failed', attempts: 3, maxAttempts: 3, stalledCount: 0,
  payload: JSON.stringify({ password: 'do-not-send', nested: { access_token: 'do-not-send', title: 'Import' } }),
  metadata: { apiKey: 'do-not-send', correlationId: 'incident-17' },
  error: 'Request failed: Bearer do-not-send\n  at ImportJob.run (worker.ts:10)', createdAt: 1000, processedAt: 2000, finishedAt: 3000,
  lock: { source: 'unavailable', state: 'unknown', expiresAt: null, owner: null } };
const task = { name: 'Import/records', expression: '* * * * *', humanReadable: 'Every minute', nextRun: new Date(),
  enabled: true, isRunning: false, history: [] };

function event(path: string, options: { method?: string; body?: unknown; csrf?: boolean; user?: unknown; headers?: Record<string, string>; params?: Record<string, string>; signal?: AbortSignal } = {}): RequestEvent {
  const headers: Record<string, string> = { ...options.headers };
  if (options.csrf !== false) { headers.cookie = 'session=session-id; XSRF-TOKEN=valid-token'; headers['X-CSRF-Token'] = 'valid-token'; }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const url = new URL(path, 'http://localhost');
  return { request: new Request(url, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal }),
    url, params: options.params ?? {}, locals: { user: options.user === undefined ? { id: 4, role: 'admin' } : options.user },
    cookies: {}, platform: {}, getClientAddress: () => '127.0.0.1' };
}

let monitor: QueueMonitoringAdapter;
beforeEach(() => {
  configureDashboard({ enabled: true, refreshInterval: 0, authorize: (event) => event.locals.user?.role === 'admin', providers: {} });
  vi.spyOn(Audit, 'log').mockResolvedValue();
  vi.spyOn(Log, 'error').mockResolvedValue();
  monitor = {
    connection: 'broker', queue: 'imports', driver: 'redis', capabilities: {shared:true,indexedMetadata:true,durableReplay:true,pause:true},
    counts: vi.fn<QueueMonitoringAdapter['counts']>().mockResolvedValue(counts), get: vi.fn<QueueMonitoringAdapter['get']>().mockResolvedValue(job),
    list: vi.fn<QueueMonitoringAdapter['list']>().mockImplementation(async(filter={})=>({items:filter.status==='delayed'?[]:[job],limit:filter.limit??25,offset:filter.offset??0,indexedCount:counts[filter.status??'failed'],coverage:'instrumented'})),
    runtime: vi.fn<QueueMonitoringAdapter['runtime']>().mockResolvedValue({paused:null,workers:null,globalConcurrency:null,observedConcurrency:null,effectiveConcurrency:null,oldestWaitingAt:null,lag:null,stalled:null,expiredLocks:null,locksComplete:false,coverage:'instrumented'}),
    metrics: vi.fn<QueueMonitoringAdapter['metrics']>().mockResolvedValue({source:'redis',completed:4,failed:3,completedPerMinute:[4],failedPerMinute:[3],minutes:60}),
    retry: vi.fn<QueueMonitoringAdapter['retry']>().mockImplementation(async(reference)=>({...reference,outcome:'accepted'})),
    remove: vi.fn<QueueMonitoringAdapter['remove']>().mockImplementation(async(reference)=>({...reference,outcome:'accepted'})),
    timeline: vi.fn<QueueMonitoringAdapter['timeline']>().mockResolvedValue([{id:'1',event:'created',at:1000},{id:'2',event:'processed',at:2000},{id:'3',event:'failed',at:3000}]),
    deadLetter: vi.fn<QueueMonitoringAdapter['deadLetter']>().mockResolvedValue(null),deadLetters:vi.fn<QueueMonitoringAdapter['deadLetters']>().mockResolvedValue([]),
    retryMany:vi.fn<QueueMonitoringAdapter['retryMany']>().mockResolvedValue({results:[],failures:[]}),cleanup:vi.fn<QueueMonitoringAdapter['cleanup']>().mockResolvedValue({results:[],failures:[]}),
    pause:vi.fn<QueueMonitoringAdapter['pause']>().mockResolvedValue(),resume:vi.fn<QueueMonitoringAdapter['resume']>().mockResolvedValue(),reconcile:vi.fn<QueueMonitoringAdapter['reconcile']>().mockResolvedValue({indexed:0,complete:true}),recover:vi.fn<QueueMonitoringAdapter['recover']>().mockResolvedValue(0),
  };
  vi.spyOn(Queue, 'adapter').mockReturnValue(monitor);
  vi.spyOn(ScheduleMonitor, 'getTask').mockResolvedValue(task);
  vi.spyOn(ScheduleMonitor, 'enableTask').mockResolvedValue();
  vi.spyOn(ScheduleMonitor, 'disableTask').mockResolvedValue();
});
afterEach(() => { configureDashboard({ enabled: false, refreshInterval: 0, providers: {} }); vi.restoreAllMocks(); });

describe('Dashboard operational boundaries', () => {
  it.each([null, { id: 2, role: 'member' }])('denies every endpoint before accessing monitors for %j', async (user) => {
    const response = await new DashboardController().handle('queue')(event('/api/admin/queue', { user }));
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(monitor.counts).not.toHaveBeenCalled();
  });

  it('denies disabled dashboards and operation-specific policy failures', async () => {
    configureDashboard({ enabled: false });
    expect((await new DashboardController().handle('health')(event('/api/admin/health'))).status).toBe(403);
    configureDashboard({ enabled: true, authorize: (_event, operation) => operation === 'view' });
    const response = await new DashboardController().handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', params: { id: '17' } }));
    expect(response.status).toBe(403);
    expect(monitor.retry).not.toHaveBeenCalled();
    expect(Audit.log).not.toHaveBeenCalled();
  });

  it.each<Record<string,string>>([{}, { authorization: 'Bearer forged-token' }])('requires CSRF even with session-authorized caller headers %j', async (headers) => {
    const response = await new DashboardController().handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', csrf: false, params: { id: '17' }, headers }));
    expect(response.status).toBe(419);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(monitor.retry).not.toHaveBeenCalled();
  });

  it.each(['limit=0', 'limit=101', 'limit=2oops', 'limit=-1', 'limit=Infinity', 'offset=-1', 'offset=1.5', 'offset=1000001', 'status=invalid'])('rejects unsafe query %s', async (query) => {
    const response = await new DashboardController().handle('queue')(event('/api/admin/queue?' + query));
    expect(response.status).toBe(422);
    expect(monitor.list).not.toHaveBeenCalled();
  });

  it('returns filtered pagination metadata and redacted inspection without mutating monitor records', async () => {
    const response = await new DashboardController().handle('queue')(event('/api/admin/queue?queue=imports&status=failed&limit=2&offset=1'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Queue.adapter).toHaveBeenCalledWith('imports', undefined);
    expect(monitor.list).toHaveBeenCalledWith({ status: 'failed', limit: 2, offset: 1 });
    expect(payload.meta).toMatchObject({ total: 3, offset: 1, limit: 2, hasMore: true });
    expect(JSON.stringify(payload)).not.toContain('do-not-send');
    expect(payload.data.jobs[0].payload.nested.title).toBe('Import');
    const detail = await new DashboardController().handle('job')(event('/api/admin/queue/17?queue=imports', {params:{id:'17'}}));
    expect((await detail.json()).data.timeline).toHaveLength(3);
    expect(payload.data.jobs[0].error).toContain('worker.ts:10');
    expect(job.payload).toContain('do-not-send');
  });

  it('uses a bounded indexed status query even when broker counts report no delayed jobs', async () => {
    const response = await new DashboardController().handle('queue')(event('/api/admin/queue?status=delayed'));
    expect((await response.json()).meta.total).toBe(0);
    expect(monitor.list).toHaveBeenCalledWith({status:'delayed',offset:0,limit:25});
  });

  it('passes explicit queue scope to detail/retry/delete and records no payload in audit', async () => {
    const controller = new DashboardController();
    const options = { params: { id: '17' } };
    expect((await controller.handle('job')(event('/api/admin/queue/17?queue=imports', options))).status).toBe(200);
    expect((await controller.handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { ...options, method: 'POST' }))).status).toBe(200);
    expect((await controller.handle('deleteJob')(event('/api/admin/queue/17?queue=imports', { ...options, method: 'DELETE', body: { confirmed: true, id: 'another-id', queue: 'another-queue' } }))).status).toBe(200);
    expect(Queue.adapter).toHaveBeenCalledWith('imports', undefined);
    expect(monitor.get).toHaveBeenCalledWith('17');
    expect(monitor.retry).toHaveBeenCalledWith({id:'17',source:'live'});
    expect(monitor.remove).toHaveBeenCalledWith({id:'17',source:'live'});
    expect(JSON.stringify(vi.mocked(Audit.log).mock.calls)).not.toContain('do-not-send');
    expect(Audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'dashboard.deleteJob.completed', userId: 4, modelId: '17', metadata: { queue: 'imports', connection:null, source:'live' } }));
  });

  it.each([false, 'true', null, undefined])('requires explicit deletion confirmation %j', async (confirmed) => {
    const response = await new DashboardController().handle('deleteJob')(event('/api/admin/queue/17?queue=imports', { method: 'DELETE', params: { id: '17' }, body: { confirmed } }));
    expect(response.status).toBe(422);
    expect(monitor.remove).not.toHaveBeenCalled();
  });

  it('refuses active deletion and nonfailed retry', async () => {
    vi.mocked(monitor.remove).mockResolvedValue({id:'17',source:'live',outcome:'busy'});
    vi.mocked(monitor.retry).mockResolvedValue({id:'17',source:'live',outcome:'not-failed'});
    const controller = new DashboardController();
    expect((await controller.handle('deleteJob')(event('/api/admin/queue/17?queue=imports', { method: 'DELETE', params: { id: '17' }, body: { confirmed: true } }))).status).toBe(409);
    expect((await controller.handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', params: { id: '17' } }))).status).toBe(409);
    expect(monitor.remove).toHaveBeenCalledWith({id:'17',source:'live'});
    expect(monitor.retry).toHaveBeenCalledWith({id:'17',source:'live'});
  });

  it('returns 404 for missing records and 409 for nonaccepted atomic outcomes', async () => {
    const controller = new DashboardController();
    const input = event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', params: { id: '17' } });
    vi.mocked(monitor.retry).mockResolvedValue({id:'17',source:'live',outcome:'missing'});
    expect((await controller.handle('retryJob')(input)).status).toBe(404);
    vi.mocked(monitor.retry).mockResolvedValue({id:'17',source:'live',outcome:'busy'});
    expect((await controller.handle('retryJob')(input)).status).toBe(409);
  });

  it('blocks mutations if auditing intent fails and reports a safe incident', async () => {
    vi.mocked(Audit.log).mockRejectedValue(new Error('postgres://user:do-not-send@host audit unavailable'));
    const response = await new DashboardController().handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', params: { id: '17' } }));
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).toContain('incidentId');
    expect(text).not.toContain('do-not-send');
    expect(monitor.retry).not.toHaveBeenCalled();
    expect(Log.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(Log.error).mock.calls)).not.toContain('do-not-send');
  });

  it('does not invite replay after completion audit failure', async () => {
    vi.mocked(Audit.log).mockResolvedValueOnce().mockRejectedValueOnce(new Error('audit unavailable'));
    const response = await new DashboardController().handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', params: { id: '17' } }));
    expect(response.status).toBe(200);
    expect((await response.json()).meta.auditWarning).toContain('Do not repeat');
    expect(monitor.retry).toHaveBeenCalledOnce();
  });

  it.each([true, false])('awaits persisted schedule controls for enabled=%s', async (enabled) => {
    const response = await new DashboardController().handle('toggleTask')(event('/api/admin/scheduler/Import%2Frecords/toggle', { method: 'POST', params: { name: task.name }, body: { enabled, name: 'untrusted' } }));
    expect(response.status).toBe(200);
    expect(enabled ? ScheduleMonitor.enableTask : ScheduleMonitor.disableTask).toHaveBeenCalledWith(task.name);
  });

  it.each(['false', 0, null, undefined])('rejects nonboolean schedule control %j', async (enabled) => {
    const response = await new DashboardController().handle('toggleTask')(event('/api/admin/scheduler/task/toggle', { method: 'POST', params: { name: task.name }, body: { enabled } }));
    expect(response.status).toBe(422);
    expect(ScheduleMonitor.enableTask).not.toHaveBeenCalled();
    expect(ScheduleMonitor.disableTask).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before persisting task settings', async () => {
    const input = event('/api/admin/scheduler/task/toggle', { method: 'POST', params: { name: task.name } });
    input.request = new Request(input.url, { method: 'POST', headers: { cookie: 'XSRF-TOKEN=valid-token', 'X-CSRF-Token': 'valid-token', 'Content-Type': 'application/json' }, body: '{' });
    const response = await new DashboardController().handle('toggleTask')(input);
    expect(response.status).toBe(422);
    expect(ScheduleMonitor.enableTask).not.toHaveBeenCalled();
  });

  it('surfaces persisted schedule-control failures instead of optimistic success', async () => {
    vi.mocked(ScheduleMonitor.disableTask).mockRejectedValue(new Error('password=do-not-send'));
    const response = await new DashboardController().handle('toggleTask')(event('/api/admin/scheduler/task/toggle', { method: 'POST', params: { name: task.name }, body: { enabled: false } }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('do-not-send');
  });

  it('queues persistent scheduler requests, surfaces enqueue failures and never executes tasks in web', async () => {
    const run = vi.spyOn(ScheduleMonitor, 'runTask');
    const request = vi.spyOn(ScheduleMonitor, 'requestRun').mockResolvedValue({id:'request',task:task.name,tenantId:null,state:'pending',requestedAt:new Date(),requestedBy:'4',owner:null,leaseUntil:null,attempts:0,result:null,error:null});
    const controller = new DashboardController();
    const input = () => event('/api/admin/scheduler/task/run', { method: 'POST', params: { name: task.name } });
    expect((await controller.handle('runTask')(input())).status).toBe(200);
    vi.mocked(ScheduleMonitor.getTask).mockResolvedValue({...task,isRunning:true});
    expect((await controller.handle('runTask')(input())).status).toBe(409);
    vi.mocked(ScheduleMonitor.getTask).mockResolvedValue(task);
    request.mockRejectedValue(new Error('password=do-not-send'));
    expect((await controller.handle('runTask')(input())).status).toBe(503);
    expect(JSON.stringify(vi.mocked(Log.error).mock.calls)).not.toContain('do-not-send');
    expect(run).not.toHaveBeenCalled();
  });

  it('uses observed topology rather than default-only counts or fabricated worker concurrency', async () => {
    vi.spyOn(Queue, 'configuredConnections').mockReturnValue({ connections: [{ name: 'primary', driver: 'redis', queue: 'imports', isDefault: true },
      { name: 'unobserved', driver: 'memory', queue: 'other', isDefault: false }], total: 2, limit: 100, offset: 0, hasMore: false });
    vi.spyOn(Queue, 'discoverQueuesPage').mockResolvedValue({ queues: [{ name: 'imports', connection: 'primary' }], total: null, complete: true, nextCursor: null, coverage: 'instrumented' });
    vi.spyOn(Queue, 'queues').mockReturnValue([{ name: 'imports', connection: 'primary', label: 'Imports', concurrency: 5 }, { name: 'other', connection: 'unobserved' }]);
    vi.mocked(monitor.runtime).mockResolvedValue({paused:false,workers:{source:'heartbeat',complete:false,observedAt:1000,limit:100,invalidRecords:0,reason:null,records:[],coverage:'instrumented',observed:{live:2,active:2,paused:0,draining:0,stale:0,concurrency:5}},effectiveConcurrency:null,globalConcurrency:8,observedConcurrency:5,oldestWaitingAt:null,lag:null,stalled:null,expiredLocks:null,locksComplete:false,coverage:'instrumented'});
    vi.mocked(Queue.adapter).mockImplementation((_queue,connection)=>connection==='unobserved'?{...monitor,driver:'memory',capabilities:{shared:false,indexedMetadata:false,durableReplay:false,pause:false}}:monitor);
    vi.spyOn(ScheduleMonitor, 'listTasks').mockResolvedValue([{ ...task, enabled: false }]);
    vi.spyOn(ScheduleMonitor, 'getHealth').mockResolvedValue({ totalTasks: 1, enabledTasks: 1, runningTasks: 0, lastErrors: [], uptime: 0 });
    const response = await new DashboardController().handle('stats')(event('/api/admin/stats'));
    const payload = await response.json();
    expect(payload.data.queue.topology[0].runtime.workers.observed.live).toBe(2);
    expect(payload.data.queue.topology[0].runtime.effectiveConcurrency).toBeNull();
    expect(payload.data.queue.topology[1].counts).toBeNull();
    expect(payload.data.scheduler.enabledTasks).toBe(0);
    expect(monitor.counts).toHaveBeenCalledTimes(1);
  });

  it('reports filtered log totals, redacted context, and process scope', async () => {
    LogViewer.configure({ driver: 'memory' });
    await LogViewer.clear();
    await LogViewer.addEntry({ timestamp: new Date().toISOString(), level: 'info', message: 'Other', context: {} });
    await LogViewer.addEntry({ timestamp: new Date().toISOString(), level: 'error', channel: 'imports', message: 'password=do-not-send', context: { api_key: 'do-not-send', correlationId: 'incident-17' } });
    const response = await new DashboardController().handle('logs')(event('/api/admin/logs?level=error&channel=imports&limit=1'));
    const payload = await response.json();
    expect(payload.data.total).toBe(1);
    expect(payload.data.scope).toBe('process');
    expect(JSON.stringify(payload)).not.toContain('do-not-send');
    await LogViewer.clear();
  });

  it('redacts log streams and unsubscribes on cancellation', async () => {
    let callback: Parameters<typeof LogViewer.tail>[0] | undefined;
    const unsubscribe = vi.fn();
    vi.spyOn(LogViewer, 'tail').mockImplementation((listener) => { callback = listener; return unsubscribe; });
    const response = await new DashboardController().handle('logsTail')(event('/api/admin/logs/tail'));
    const reader = response.body!.getReader();
    callback!({ timestamp: new Date().toISOString(), level: 'error', channel: 'imports', message: 'Bearer do-not-send', context: { password: 'do-not-send' } });
    const value = await reader.read();
    const text = new TextDecoder().decode(value.value);
    expect(text).toContain('data: ');
    expect(text).not.toContain('do-not-send');
    await reader.cancel();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('closes live-log subscriptions on abort and reauthorization timeout', async () => {
    vi.useFakeTimers();
    try {
      const unsubscribe = vi.fn();
      vi.spyOn(LogViewer, 'tail').mockReturnValue(unsubscribe);
      const signal = new AbortController();
      await new DashboardController().handle('logsTail')(event('/api/admin/logs/tail', { signal: signal.signal }));
      signal.abort();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      const response = await new DashboardController().handle('logsTail')(event('/api/admin/logs/tail'));
      const reader = response.body!.getReader();
      const read = async () => { for (;;) { if ((await reader.read()).done) return; } };
      const draining = read();
      await vi.advanceTimersByTimeAsync(60_000);
      await draining;
      expect(unsubscribe).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe('Dashboard serialization and generated contracts', () => {
  it('handles malformed payloads, nested serialized context, credentials, cycles and limits', () => {
    expect(redactDashboardPayload('not-json password=hidden')).toBe('[redacted: invalid JSON]');
    const circular: Record<string, unknown> = { nested: JSON.stringify({ clientSecret: 'hidden', title: 'Safe' }), url: 'https://user:hidden@host/path?access_token=hidden', headers: { Cookie: 'hidden' } };
    circular.self = circular;
    const result = JSON.stringify(redactDashboardValue(circular));
    expect(result).not.toContain('hidden');
    expect(result).toContain('Safe');
    expect(result).toContain('circular reference');
    expect(redactDashboardPayload('x'.repeat(33_000))).toBe('[redacted: size limit]');
  });

  it('has bounded default paging and compiles every generated TS and Svelte artifact', () => {
    expect(dashboardQueueSchema.parse({})).toEqual({ queue: 'default', status: 'failed', offset: 0, limit: 25 });
    const files = new MakeDashboardCommand().files();
    expect(files).toHaveLength(33);
    for (const file of files) {
      if (file.path.endsWith('.svelte')) {
        for (const generate of ['client', 'server'] as const) expect(() => compile(file.content, { filename: file.path, generate })).not.toThrow();
        if (file.path.endsWith('admin/dashboard/+page.svelte')) {
          expect(file.content).toContain('replaceState');
          expect(file.content).toContain('confirmed:true');
        }
        expect(file.content).not.toContain('on:click');
      } else {
        const result = ts.transpileModule(file.content, { fileName: file.path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
        expect(result.diagnostics).toEqual([]);
        if (file.path.endsWith('+server.ts')) {
          expect(file.content).toContain('DashboardController');
          expect(file.content).not.toContain('request.json');
        }
      }
    }
  });
});
