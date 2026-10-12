import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import ts from 'typescript';
import { DashboardController, configureDashboard, redactDashboardPayload, redactDashboardValue } from '../src/dashboard/index.js';
import { dashboardQueueSchema } from '../src/dashboard/contracts.js';
import { JobMonitor, type JobInfo } from '../src/queue/JobMonitor.js';
import { Queue } from '../src/queue/index.js';
import { ScheduleMonitor } from '../src/scheduler/ScheduleMonitor.js';
import { LogViewer } from '../src/logging/LogViewer.js';
import { Log } from '../src/logging/index.js';
import { Audit } from '../src/audit/index.js';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';
import type { RequestEvent } from '../src/routing/Controller.js';

const counts = { waiting: 2, active: 1, completed: 4, failed: 3, delayed: 0, total: 10 };
const job: JobInfo = { id: '17', queue: 'imports', jobClass: 'ImportJob', status: 'failed', attempts: 3, maxAttempts: 3,
  payload: JSON.stringify({ password: 'do-not-send', nested: { access_token: 'do-not-send', title: 'Import' } }),
  metadata: { apiKey: 'do-not-send', correlationId: 'incident-17' },
  error: 'Request failed: Bearer do-not-send\n  at ImportJob.run (worker.ts:10)', createdAt: 1000, processedAt: 2000, failedAt: 3000 };
const task = { name: 'Import/records', expression: '* * * * *', humanReadable: 'Every minute', nextRun: new Date(),
  enabled: true, isRunning: false, history: [] };

function event(path: string, options: { method?: string; body?: unknown; csrf?: boolean; user?: any; headers?: Record<string, string>; params?: Record<string, string>; signal?: AbortSignal } = {}): RequestEvent {
  const headers: Record<string, string> = { ...options.headers };
  if (options.csrf !== false) { headers.cookie = 'session=session-id; XSRF-TOKEN=valid-token'; headers['X-CSRF-Token'] = 'valid-token'; }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const url = new URL(path, 'http://localhost');
  return { request: new Request(url, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal }),
    url, params: options.params ?? {}, locals: { user: options.user === undefined ? { id: 4, role: 'admin' } : options.user },
    cookies: {}, platform: {}, getClientAddress: () => '127.0.0.1' };
}

beforeEach(() => {
  configureDashboard({ enabled: true, refreshInterval: 0, authorize: (event) => event.locals.user?.role === 'admin' });
  vi.spyOn(Audit, 'log').mockResolvedValue();
  vi.spyOn(Log, 'error').mockResolvedValue();
  vi.spyOn(JobMonitor, 'getCounts').mockResolvedValue(counts);
  vi.spyOn(JobMonitor, 'getJob').mockResolvedValue(job);
  vi.spyOn(JobMonitor, 'listJobs').mockResolvedValue([job]);
  vi.spyOn(JobMonitor, 'retryJob').mockResolvedValue(true);
  vi.spyOn(JobMonitor, 'deleteJob').mockResolvedValue(true);
  vi.spyOn(ScheduleMonitor, 'getTask').mockResolvedValue(task);
  vi.spyOn(ScheduleMonitor, 'enableTask').mockResolvedValue();
  vi.spyOn(ScheduleMonitor, 'disableTask').mockResolvedValue();
});
afterEach(() => { configureDashboard({ enabled: false, refreshInterval: 0 }); vi.restoreAllMocks(); });

describe('Dashboard operational boundaries', () => {
  it.each([null, { id: 2, role: 'member' }])('denies every endpoint before accessing monitors for %j', async (user) => {
    const response = await new DashboardController().handle('queue')(event('/api/admin/queue', { user }));
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(JobMonitor.getCounts).not.toHaveBeenCalled();
  });

  it('denies disabled dashboards and operation-specific policy failures', async () => {
    configureDashboard({ enabled: false });
    expect((await new DashboardController().handle('health')(event('/api/admin/health'))).status).toBe(403);
    configureDashboard({ enabled: true, authorize: (_event, operation) => operation === 'view' });
    const response = await new DashboardController().handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', params: { id: '17' } }));
    expect(response.status).toBe(403);
    expect(JobMonitor.retryJob).not.toHaveBeenCalled();
    expect(Audit.log).not.toHaveBeenCalled();
  });

  it.each([{}, { authorization: 'Bearer forged-token' }])('requires CSRF even with session-authorized caller headers %j', async (headers) => {
    const response = await new DashboardController().handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', csrf: false, params: { id: '17' }, headers }));
    expect(response.status).toBe(419);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(JobMonitor.retryJob).not.toHaveBeenCalled();
  });

  it.each(['limit=0', 'limit=101', 'limit=2oops', 'limit=-1', 'limit=Infinity', 'offset=-1', 'offset=1.5', 'offset=1000001', 'status=invalid'])('rejects unsafe query %s', async (query) => {
    const response = await new DashboardController().handle('queue')(event('/api/admin/queue?' + query));
    expect(response.status).toBe(422);
    expect(JobMonitor.listJobs).not.toHaveBeenCalled();
  });

  it('returns filtered pagination metadata and redacted inspection without mutating monitor records', async () => {
    const response = await new DashboardController().handle('queue')(event('/api/admin/queue?queue=imports&status=failed&limit=2&offset=1'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(JobMonitor.listJobs).toHaveBeenCalledWith({ queue: 'imports', status: 'failed', limit: 2, offset: 1 });
    expect(payload.meta).toMatchObject({ total: 3, offset: 1, limit: 2, hasMore: true });
    expect(JSON.stringify(payload)).not.toContain('do-not-send');
    expect(payload.data.jobs[0].payload.nested.title).toBe('Import');
    expect(payload.data.jobs[0].timeline).toHaveLength(3);
    expect(payload.data.jobs[0].error).toContain('worker.ts:10');
    expect(job.payload).toContain('do-not-send');
  });

  it('does not query jobs beyond a filtered total', async () => {
    const response = await new DashboardController().handle('queue')(event('/api/admin/queue?status=delayed'));
    expect((await response.json()).meta.total).toBe(0);
    expect(JobMonitor.listJobs).not.toHaveBeenCalled();
  });

  it('passes explicit queue scope to detail/retry/delete and records no payload in audit', async () => {
    const controller = new DashboardController();
    const options = { params: { id: '17' } };
    expect((await controller.handle('job')(event('/api/admin/queue/17?queue=imports', options))).status).toBe(200);
    expect((await controller.handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { ...options, method: 'POST' }))).status).toBe(200);
    expect((await controller.handle('deleteJob')(event('/api/admin/queue/17?queue=imports', { ...options, method: 'DELETE', body: { confirmed: true, id: 'another-id', queue: 'another-queue' } }))).status).toBe(200);
    expect(JobMonitor.getJob).toHaveBeenCalledWith('17', 'imports');
    expect(JobMonitor.retryJob).toHaveBeenCalledWith('17', 'imports');
    expect(JobMonitor.deleteJob).toHaveBeenCalledWith('17', 'imports');
    expect(JSON.stringify(vi.mocked(Audit.log).mock.calls)).not.toContain('do-not-send');
    expect(Audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'dashboard.deleteJob.completed', userId: 4, modelId: '17', metadata: { queue: 'imports' } }));
  });

  it.each([false, 'true', null, undefined])('requires explicit deletion confirmation %j', async (confirmed) => {
    const response = await new DashboardController().handle('deleteJob')(event('/api/admin/queue/17?queue=imports', { method: 'DELETE', params: { id: '17' }, body: { confirmed } }));
    expect(response.status).toBe(422);
    expect(JobMonitor.deleteJob).not.toHaveBeenCalled();
  });

  it('refuses active deletion and nonfailed retry', async () => {
    vi.mocked(JobMonitor.getJob).mockResolvedValue({ ...job, status: 'active' });
    const controller = new DashboardController();
    expect((await controller.handle('deleteJob')(event('/api/admin/queue/17?queue=imports', { method: 'DELETE', params: { id: '17' }, body: { confirmed: true } }))).status).toBe(409);
    expect((await controller.handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', params: { id: '17' } }))).status).toBe(409);
    expect(JobMonitor.deleteJob).not.toHaveBeenCalled();
    expect(JobMonitor.retryJob).not.toHaveBeenCalled();
  });

  it('returns 404 for missing jobs and 409 when mutations return false', async () => {
    const controller = new DashboardController();
    const input = event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', params: { id: '17' } });
    vi.mocked(JobMonitor.getJob).mockResolvedValue(null);
    expect((await controller.handle('retryJob')(input)).status).toBe(404);
    vi.mocked(JobMonitor.getJob).mockResolvedValue(job);
    vi.mocked(JobMonitor.retryJob).mockResolvedValue(false);
    expect((await controller.handle('retryJob')(input)).status).toBe(409);
  });

  it('blocks mutations if auditing intent fails and reports a safe incident', async () => {
    vi.mocked(Audit.log).mockRejectedValue(new Error('postgres://user:do-not-send@host audit unavailable'));
    const response = await new DashboardController().handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', params: { id: '17' } }));
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).toContain('incidentId');
    expect(text).not.toContain('do-not-send');
    expect(JobMonitor.retryJob).not.toHaveBeenCalled();
    expect(Log.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(Log.error).mock.calls)).not.toContain('do-not-send');
  });

  it('does not invite replay after completion audit failure', async () => {
    vi.mocked(Audit.log).mockResolvedValueOnce().mockRejectedValueOnce(new Error('audit unavailable'));
    const response = await new DashboardController().handle('retryJob')(event('/api/admin/queue/17/retry?queue=imports', { method: 'POST', params: { id: '17' } }));
    expect(response.status).toBe(200);
    expect((await response.json()).meta.auditWarning).toContain('Do not repeat');
    expect(JobMonitor.retryJob).toHaveBeenCalledOnce();
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

  it('distinguishes successful, skipped, and failed schedule execution', async () => {
    const run = vi.spyOn(ScheduleMonitor, 'runTask').mockResolvedValue({ task: task.name, success: true, duration: 1, timestamp: new Date() });
    const controller = new DashboardController();
    const input = () => event('/api/admin/scheduler/task/run', { method: 'POST', params: { name: task.name } });
    expect((await controller.handle('runTask')(input())).status).toBe(200);
    run.mockResolvedValue({ task: task.name, success: true, skipped: true, duration: 0, timestamp: new Date() });
    expect((await controller.handle('runTask')(input())).status).toBe(409);
    run.mockResolvedValue({ task: task.name, success: false, error: 'password=do-not-send', duration: 1, timestamp: new Date() });
    expect((await controller.handle('runTask')(input())).status).toBe(503);
    expect(JSON.stringify(vi.mocked(Log.error).mock.calls)).not.toContain('do-not-send');
  });

  it('uses observed topology rather than default-only counts or fabricated worker concurrency', async () => {
    vi.spyOn(Queue, 'queues').mockReturnValue([{ name: 'imports', label: 'Imports', concurrency: 5 }, { name: 'other', connection: 'unobserved' }]);
    vi.spyOn(JobMonitor, 'getHealth').mockResolvedValue({ driver: 'redis', registry: [], registeredJobs: ['ImportJob'], queues: { imports: counts }, failureRate: 0, throughput: 0,
      runtime: { imports: { workers: 2, effectiveConcurrency: null, globalConcurrency: 8, paused: false, oldestWaitingJob: null, lag: null, nextWaitingJob: null, nextWaitingLag: null } } });
    vi.spyOn(ScheduleMonitor, 'listTasks').mockResolvedValue([{ ...task, enabled: false }]);
    vi.spyOn(ScheduleMonitor, 'getHealth').mockResolvedValue({ totalTasks: 1, enabledTasks: 1, runningTasks: 0, lastErrors: [], uptime: 0 });
    const response = await new DashboardController().handle('stats')(event('/api/admin/stats'));
    const payload = await response.json();
    expect(payload.data.queue.topology[0].runtime.workers).toBe(2);
    expect(payload.data.queue.topology[0].runtime.effectiveConcurrency).toBeNull();
    expect(payload.data.queue.topology[1].counts).toBeNull();
    expect(payload.data.scheduler.enabledTasks).toBe(0);
    expect(JobMonitor.getCounts).not.toHaveBeenCalled();
  });

  it('reports filtered log totals, redacted context, and process scope', async () => {
    LogViewer.clear();
    LogViewer.addEntry({ timestamp: new Date().toISOString(), level: 'info', message: 'Other', context: {} });
    LogViewer.addEntry({ timestamp: new Date().toISOString(), level: 'error', channel: 'imports', message: 'password=do-not-send', context: { api_key: 'do-not-send', correlationId: 'incident-17' } });
    const response = await new DashboardController().handle('logs')(event('/api/admin/logs?level=error&channel=imports&limit=1'));
    const payload = await response.json();
    expect(payload.data.total).toBe(1);
    expect(payload.data.scope).toBe('current web process');
    expect(JSON.stringify(payload)).not.toContain('do-not-send');
    LogViewer.clear();
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
    expect(files).toHaveLength(12);
    for (const file of files) {
      if (file.path.endsWith('.svelte')) {
        for (const generate of ['client', 'server'] as const) expect(() => compile(file.content, { filename: file.path, generate })).not.toThrow();
        expect(file.content).toContain('replaceState');
        expect(file.content).toContain('confirmed: true');
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
