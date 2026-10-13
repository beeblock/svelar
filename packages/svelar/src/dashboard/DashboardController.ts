import { Controller, type RequestEvent } from '../routing/Controller.js';
import { FormAuthorizationError, FormValidationError } from '../routing/FormRequest.js';
import { CsrfMiddleware } from '../middleware/Middleware.js';
import { JobMonitor } from '../queue/JobMonitor.js';
import { LogViewer } from '../logging/LogViewer.js';
import { Log } from '../logging/index.js';
import { randomUUID } from 'node:crypto';
import { DashboardMutationRequest, dashboardJobSchema, dashboardLogSchema, dashboardMutationRequest, dashboardQueueSchema } from './contracts.js';
import { DashboardMutationAction, DashboardOperationError, DashboardService, dashboardJobResource } from './DashboardService.js';
import { authorizeDashboard, redactDashboardValue, type DashboardOperation } from './security.js';

export class DashboardController extends Controller {
  private service = new DashboardService();

  constructor() {
    super();
    this.middleware(async (ctx, next) => {
      if (!await authorizeDashboard(ctx.event)) return this.failure(403, 'Dashboard access denied.');
      // This browser console never exempts a session mutation because a caller supplied a Bearer header.
      const request = new Request(ctx.event.request.clone(), { headers: ctx.event.request.headers });
      request.headers.delete('authorization');
      const response = await new CsrfMiddleware().handle({ ...ctx, event: { ...ctx.event, request } }, next);
      if (response) response.headers.set('Cache-Control', 'no-store');
      return response;
    });
  }

  private failure(status: number, message: string, errors?: Record<string, string[]>) {
    return this.json({ data: null, meta: { message, ...(errors ? { errors } : {}) } }, status, { 'Cache-Control': 'no-store' });
  }

  protected handleError(error: unknown, event: RequestEvent): Response {
    if (error instanceof DashboardOperationError) return this.failure(error.status, error.message);
    if (error instanceof FormValidationError) return this.failure(422, error.message, error.errors);
    if (error instanceof FormAuthorizationError) return this.failure(403, 'Dashboard action denied.');
    const incidentId = randomUUID();
    const context = redactDashboardValue({ incidentId, path: event.url.pathname,
      error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
    void Log.error('Dashboard operation failed', context as Record<string, unknown>).catch(() => {
      console.error('Dashboard operation failed', context);
    });
    return this.json({ data: null, meta: { message: 'Dashboard operation unavailable. Check service configuration and server logs.', incidentId } },
      503, { 'Cache-Control': 'no-store' });
  }

  private result(data: unknown, meta: Record<string, unknown> = {}) {
    return this.json({ data: redactDashboardValue(data), meta }, 200, { 'Cache-Control': 'no-store' });
  }

  private parse<T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { flatten(): { fieldErrors: unknown } } } }, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new FormValidationError(result.error.flatten().fieldErrors as Record<string, string[]>);
    return result.data;
  }

  async health() {
    return this.result({ status: 'ok', uptime: process.uptime(), memory: process.memoryUsage(), nodeVersion: process.version });
  }

  async stats() {
    const queue = await this.service.topology();
    const scheduler = await this.service.scheduler();
    return this.result({ queue, scheduler: scheduler.health, logs: await LogViewer.getStats(), recentErrors: await LogViewer.getRecentErrors(10), timestamp: new Date().toISOString() });
  }

  async queue(event: RequestEvent) {
    const filter = this.parse(dashboardQueueSchema, Object.fromEntries(event.url.searchParams));
    const counts = await JobMonitor.getCounts(filter.queue);
    const total = counts[filter.status];
    const jobs = total > filter.offset ? await JobMonitor.listJobs(filter) : [];
    return this.result({ jobs: jobs.map(dashboardJobResource), counts, queueName: filter.queue },
      { total, limit: filter.limit, offset: filter.offset, hasMore: filter.offset + jobs.length < total, status: filter.status });
  }

  async job(event: RequestEvent) {
    const input = this.parse(dashboardJobSchema, { ...Object.fromEntries(event.url.searchParams), id: event.params.id });
    const job = await JobMonitor.getJob(input.id, input.queue);
    if (!job || job.queue !== input.queue) throw new DashboardOperationError(404, 'Job not found in this queue.');
    return this.result(dashboardJobResource(job));
  }

  async scheduler() { return this.result(await this.service.scheduler()); }

  async logs(event: RequestEvent) {
    const filter = this.parse(dashboardLogSchema, Object.fromEntries(event.url.searchParams));
    return this.result(await this.service.logs(filter));
  }

  async retryJob(event: RequestEvent) { return this.mutate('retryJob', event); }
  async deleteJob(event: RequestEvent) { return this.mutate('deleteJob', event); }
  async runTask(event: RequestEvent) { return this.mutate('runTask', event); }
  async toggleTask(event: RequestEvent) { return this.mutate('toggleTask', event); }

  private async mutate(operation: Exclude<DashboardOperation, 'view'>, event: RequestEvent) {
    const dto = await dashboardMutationRequest(operation).validate<DashboardMutationRequest>(event);
    const { message, auditWarning } = await new DashboardMutationAction(this.service).run(dto, event);
    return this.result(null, { message, ...(auditWarning ? { auditWarning } : {}) });
  }

  async logsTail(event: RequestEvent) {
    const filter = this.parse(dashboardLogSchema, { ...Object.fromEntries(event.url.searchParams),
      ...(event.request.headers.has('Last-Event-ID') ? { cursor: event.request.headers.get('Last-Event-ID') } : {}) });
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let unsubscribe = () => {};
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let lifetime: ReturnType<typeof setTimeout> | undefined;
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          event.request.signal.removeEventListener('abort', close);
          try { controller.close(); } catch { /* Already cancelled. */ }
        };
        cleanup = close;
        const encoder = new TextEncoder();
        const send = (text: string) => {
          if (closed) return;
          // Bound slow clients rather than retaining their logs indefinitely.
          if ((controller.desiredSize ?? 0) <= 0) { close(); return; }
          try { controller.enqueue(encoder.encode(text)); } catch { close(); }
        };
        if (event.request.signal.aborted) { close(); return; }
        event.request.signal.addEventListener('abort', close, { once: true });
        unsubscribe = LogViewer.tail((entry) => send(`${entry.id === undefined ? '' : `id: ${entry.id}\n`}data: ${JSON.stringify(redactDashboardValue(entry))}\n\n`), filter);
        heartbeat = setInterval(() => send(': heartbeat\n\n'), 15_000);
        // Reconnect periodically so revoked authorization is checked again.
        lifetime = setTimeout(close, 60_000);
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  }
}
