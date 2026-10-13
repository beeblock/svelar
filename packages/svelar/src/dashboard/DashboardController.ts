import { Controller, type RequestEvent } from '../routing/Controller.js';
import { FormAuthorizationError, FormValidationError } from '../routing/FormRequest.js';
import { CsrfMiddleware } from '../middleware/Middleware.js';
import { LogViewer } from '../logging/LogViewer.js';
import { Log } from '../logging/index.js';
import { randomUUID } from 'node:crypto';
import { DashboardMutationRequest, dashboardJobSchema, dashboardLogSchema, dashboardMutationRequest, dashboardQueueSchema,
  dashboardListSchema, dashboardTimelineSchema, dashboardProfileScopeSchema, dashboardRunRequestSchema, type DashboardMutationOperation } from './contracts.js';
import { DashboardMutationAction, DashboardOperationError, DashboardService } from './DashboardService.js';
import { ScheduleMonitor } from '../scheduler/ScheduleMonitor.js';
import { dashboardProviders } from './providers.js';
import { DashboardAccessService } from './DashboardAccessService.js';
import { dashboardUserAccessSchema } from './schemas.js';
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

  async console(event: RequestEvent) {
    const access: Record<string, boolean> = {};
    for (const operation of ['view', 'retryJob', 'deleteJob', 'retryJobs', 'cleanupJobs', 'pauseQueue', 'runTask', 'toggleTask', 'users', 'resetPassword', 'deleteUser', 'permissions', 'saveProfile', 'deleteRole', 'features', 'toggleFeature',
      'userAccess', 'createRole', 'assignRole', 'detachRole', 'grantCapability', 'revokeCapability'] as const) access[operation] = await authorizeDashboard(event, operation);
    const user = event.locals.user;
    return this.result({ shell: { title: dashboardProviders.current.shell?.title ?? 'Operations', appPath: dashboardProviders.current.shell?.appPath ?? '/', logoutPath: dashboardProviders.current.shell?.logoutPath ?? '/api/auth/logout' },
      user: user ? { name: user.name ?? null, email: user.email ?? null } : null, access,
      available: { userAccess: !!dashboardProviders.current.users?.access,
        createRole: !!dashboardProviders.current.permissions?.createRole,
        assignRole: !!dashboardProviders.current.users?.access && !!dashboardProviders.current.permissions?.getRole && !!dashboardProviders.current.users?.assignRole,
        detachRole: !!dashboardProviders.current.users?.access && !!dashboardProviders.current.permissions?.getRole && !!dashboardProviders.current.users?.detachRole,
        grantCapability: !!dashboardProviders.current.users?.access && !!dashboardProviders.current.permissions && !!dashboardProviders.current.users?.grantCapability,
        revokeCapability: !!dashboardProviders.current.users?.access && !!dashboardProviders.current.permissions && !!dashboardProviders.current.users?.revokeCapability } });
  }
  async health(event: RequestEvent) {
    const dependencies = dashboardProviders.current.dependencies ? await dashboardProviders.current.dependencies(event) : [];
    if (dependencies.length > 100) throw new DashboardOperationError(503, 'Dependency observation exceeds its bound.');
    const status = !dependencies.length || dependencies.some((item) => item.status === 'unknown') ? 'unknown'
      : dependencies.some((item) => item.status !== 'healthy') ? 'degraded' : 'healthy';
    return this.result({ status, dependencies, uptime: process.uptime(), memory: process.memoryUsage(), nodeVersion: process.version, timestamp: new Date().toISOString() });
  }

  async stats(event: RequestEvent) {
    const queue = await this.service.topology();
    const scheduler = await this.service.scheduler();
    let usersCount: number | null = null; let rolesCount: number | null = null;
    if (dashboardProviders.current.users && await authorizeDashboard(event, 'users')) {
      try { usersCount = (await this.service.users({ limit: 1, offset: 0 }, event)).total; } catch { /* Counts remain unknown. */ }
    }
    if (dashboardProviders.current.permissions && await authorizeDashboard(event, 'permissions')) {
      try { const page = await dashboardProviders.current.permissions.roles({ limit: 1, offset: 0 }, event); rolesCount = page.total; } catch { /* Counts remain unknown. */ }
    }
    return this.result({ queue, scheduler: scheduler.health, usersCount, rolesCount, logs: await LogViewer.getStats(), recentErrors: await LogViewer.getRecentErrors(10), timestamp: new Date().toISOString() });
  }

  async queue(event: RequestEvent) {
    const filter = this.parse(dashboardQueueSchema, Object.fromEntries(event.url.searchParams));
    const { meta, ...data } = await this.service.queue(filter);
    return this.result(data, meta);
  }

  async job(event: RequestEvent) {
    const input = this.parse(dashboardJobSchema, { ...Object.fromEntries(event.url.searchParams), id: event.params.id });
    return this.result(await this.service.job(input));
  }
  async timeline(event: RequestEvent) {
    const input = this.parse(dashboardTimelineSchema, { ...Object.fromEntries(event.url.searchParams), id: event.params.id });
    return this.result((await this.service.job(input, input.limit)).timeline);
  }

  async scheduler() { return this.result(await this.service.scheduler()); }
  async runRequest(event: RequestEvent) {
    const input = this.parse(dashboardRunRequestSchema, { name: event.params.name, requestId: event.params.requestId });
    const request = await ScheduleMonitor.getRunRequest(input.name, input.requestId);
    if (!request) throw new DashboardOperationError(404, 'Run request not found.');
    // Scheduler result objects may contain domain data; never expose them to this operational surface.
    return this.result({ id: request.id, task: request.task, state: request.state, requestedAt: request.requestedAt, attempts: request.attempts, leaseUntil: request.leaseUntil, error: request.error });
  }
  private async authorizeRead(event: RequestEvent, operation: DashboardOperation): Promise<void> {
    if (!await authorizeDashboard(event, operation)) throw new FormAuthorizationError();
  }
  async users(event: RequestEvent) {
    await this.authorizeRead(event, 'users'); const filter = this.parse(dashboardListSchema, Object.fromEntries(event.url.searchParams));
    return this.result(await this.service.users(filter, event), { limit: filter.limit, offset: filter.offset });
  }
  async userAccess(event: RequestEvent) {
    await this.authorizeRead(event, 'userAccess');
    const input = this.parse(dashboardUserAccessSchema, { ...Object.fromEntries(event.url.searchParams), id: event.params.id });
    const snapshot = await new DashboardAccessService().snapshot(input, event);
    const { directCapabilities, ...rest } = snapshot;
    // Validated names are a finite public catalog, not arbitrary payload values subject to 100-item truncation.
    return this.json({ data: { ...redactDashboardValue(rest) as Record<string, unknown>, directCapabilities }, meta: {} }, 200, { 'Cache-Control': 'no-store' });
  }
  async permissions(event: RequestEvent) {
    await this.authorizeRead(event, 'permissions'); const filter = this.parse(dashboardListSchema, Object.fromEntries(event.url.searchParams));
    const data = await this.service.permissions(filter, event);
    const { catalog, aliases, systemProfiles, ...rest } = data;
    // Manifest fields are validated immutable public metadata; don't truncate a dependency graph to 100 entries.
    return this.json({ data: { ...redactDashboardValue(rest) as Record<string, unknown>, catalog, aliases, systemProfiles }, meta: { limit: filter.limit, offset: filter.offset } }, 200, { 'Cache-Control': 'no-store' });
  }
  async profile(event: RequestEvent) {
    await this.authorizeRead(event, 'permissions'); const input = this.parse(dashboardProfileScopeSchema, { ...Object.fromEntries(event.url.searchParams), roleId: event.params.id });
    const provider = dashboardProviders.current.permissions;
    if (!provider?.profile) throw new DashboardOperationError(503, 'Profile editor unavailable.');
    const preview = await provider.profile(input, event);
    const names = (values: readonly string[]) => {
      if (!Array.isArray(values) || values.length > 10_000 || values.some((value) => typeof value !== 'string' || value.length > 255)) throw new DashboardOperationError(503, 'Profile selection exceeds its bound.');
      return values.map((name) => redactDashboardValue(name));
    };
    if (preview.profile && preview.profile.roleId !== input.roleId) throw new DashboardOperationError(503, 'Profile provider returned a different role.');
    const profile = preview.profile ? { roleId: preview.profile.roleId, kind: preview.profile.kind, systemProfile: preview.profile.systemProfile,
      capabilities: names(preview.profile.capabilities), exclusions: names(preview.profile.exclusions), inclusions: names(preview.profile.inclusions) } : null;
    return this.json({ data: { profile, selected: names(preview.selected), staleCapabilities: names(preview.staleCapabilities) }, meta: {} }, 200, { 'Cache-Control': 'no-store' });
  }
  async features(event: RequestEvent) { await this.authorizeRead(event, 'features'); return this.result(await this.service.features()); }

  async logs(event: RequestEvent) {
    const filter = this.parse(dashboardLogSchema, Object.fromEntries(event.url.searchParams));
    return this.result(await this.service.logs(filter));
  }

  async retryJob(event: RequestEvent) { return this.mutate('retryJob', event); }
  async deleteJob(event: RequestEvent) { return this.mutate('deleteJob', event); }
  async runTask(event: RequestEvent) { return this.mutate('runTask', event); }
  async toggleTask(event: RequestEvent) { return this.mutate('toggleTask', event); }
  async retryJobs(event: RequestEvent) { return this.mutate('retryJobs', event); }
  async cleanupJobs(event: RequestEvent) { return this.mutate('cleanupJobs', event); }
  async pauseQueue(event: RequestEvent) { return this.mutate('pauseQueue', event); }
  async resetPassword(event: RequestEvent) { return this.mutate('resetPassword', event); }
  async deleteUser(event: RequestEvent) { return this.mutate('deleteUser', event); }
  async toggleFeature(event: RequestEvent) { return this.mutate('toggleFeature', event); }
  async saveProfile(event: RequestEvent) { return this.mutate('saveProfile', event); }
  async deleteRole(event: RequestEvent) { return this.mutate('deleteRole', event); }
  async createRole(event: RequestEvent) { return this.mutate('createRole', event); }
  async assignRole(event: RequestEvent) { return this.mutate('assignRole', event); }
  async detachRole(event: RequestEvent) { return this.mutate('detachRole', event); }
  async grantCapability(event: RequestEvent) { return this.mutate('grantCapability', event); }
  async revokeCapability(event: RequestEvent) { return this.mutate('revokeCapability', event); }

  private async mutate(operation: DashboardMutationOperation, event: RequestEvent) {
    const dto = await dashboardMutationRequest(operation).validate<DashboardMutationRequest>(event);
    const { message, auditWarning, ...data } = await new DashboardMutationAction(this.service).run(dto, event);
    return this.result(data, { message, ...(auditWarning ? { auditWarning } : {}) });
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
