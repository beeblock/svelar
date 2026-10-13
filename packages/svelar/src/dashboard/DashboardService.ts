import { Queue, type QueueJobSnapshot, type QueueDeadLetterRecord, type QueueJobFilter, type QueueDefinition, type QueueAdapterCounts,
  type QueueAdapterRuntime, type QueueSharedMetrics, type QueueMonitoringAdapter } from '../queue/index.js';
import { ScheduleMonitor, type SchedulerHealth } from '../scheduler/ScheduleMonitor.js';
import { LogViewer } from '../logging/LogViewer.js';
import { Features } from '../feature-flags/index.js';
import { PermissionManifest } from '../permissions/PermissionManifest.js';
import { Audit } from '../audit/index.js';
import { DashboardAccessService } from './DashboardAccessService.js';
import { Log } from '../logging/index.js';
import type { RequestEvent } from '../routing/Controller.js';
import { dashboardJobSchema, dashboardBatchSchema, dashboardPauseSchema, dashboardToggleSchema, dashboardRunSchema,
  dashboardUserSchema, dashboardDeleteUserSchema, dashboardFeatureSchema, dashboardProfileSchema, dashboardDeleteRoleSchema,
  type DashboardMutationDto } from './contracts.js';
import { dashboardProviders, safeDashboardPath, type DashboardListFilter, type DashboardPage } from './providers.js';
import { redactDashboardPayload, redactDashboardText, redactDashboardValue } from './security.js';

export class DashboardOperationError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export interface DashboardQueueTopologyEntry {
  name: string; connection: string | null; definition: unknown; registered: boolean; discovered: boolean;
  jobs: unknown[]; workerProfiles: unknown[];
  registryMeta: { jobsTotal: number; workerProfilesTotal: number; truncated: boolean };
  driver?: QueueMonitoringAdapter['driver']; capabilities?: QueueMonitoringAdapter['capabilities'];
  counts: QueueAdapterCounts | null; runtime: QueueAdapterRuntime | null; metrics: QueueSharedMetrics | null; error: string | null;
}

export function dashboardSchedulerHealth(health: SchedulerHealth, limit = 100, offset = 0) {
  const processes = health.processes;
  // The public scheduler source reads at most 100 process observations; a full source page is not an exact global total.
  const sourceTruncated = !!processes && processes.length >= 100;
  return { ...health, processes: processes?.slice(offset, offset + limit),
    processesMeta: { total: processes && !sourceTruncated ? processes.length : null, observedTotal: processes?.length ?? null, sourceLimit: 100, sourceTruncated,
      limit, offset, hasMore: processes ? offset + limit < processes.length : false,
      truncated: sourceTruncated || (processes ? offset > 0 || offset + limit < processes.length : false) } };
}

export function dashboardJobResource(job: QueueJobSnapshot) {
  const mapped = job.metadata && dashboardProviders.current.resourcePath?.(job.metadata);
  const retained = job.stacktrace ?? []; let remaining = 32_000;
  const stacktrace = retained.slice(-5).map((trace) => { const safe = redactDashboardText(trace); const text = safe.slice(0, remaining); remaining -= text.length; return text; });
  const stacktraceMeta = { total: job.stacktraceMeta?.total ?? retained.length,
    truncated: job.stacktraceMeta?.truncated === true || retained.length > 5 || retained.some((trace) => trace.length > 32_000)
      || retained.slice(-5).reduce((total, trace) => total + redactDashboardText(trace).length, 0) > 32_000 };
  return { id: job.id, connection: job.connection, queue: job.queue, jobClass: job.jobClass, source: 'live' as const,
    status: job.status, attempts: job.attempts, attemptsStarted: job.attemptsStarted, maxAttempts: job.maxAttempts, stalledCount: job.stalledCount,
    createdAt: job.createdAt, processedAt: job.processedAt, finishedAt: job.finishedAt, delayedUntil: job.delayedUntil,
    payload: redactDashboardPayload(job.payload), metadata: redactDashboardValue(job.metadata), progress: redactDashboardValue(job.progress),
    error: job.error ? redactDashboardText(job.error) : null, errorTruncated: (job.error?.length ?? 0) > 32_000,
    stacktrace, stacktraceMeta, lock: job.lock, replayRecordId: job.replayRecordId,
    resourcePath: safeDashboardPath(mapped) ? mapped : null };
}
export function dashboardDeadLetterResource(job: QueueDeadLetterRecord) {
  const mapped = job.metadata && dashboardProviders.current.resourcePath?.(job.metadata);
  return { id: job.id, connection: job.connection, queue: job.queue, jobClass: job.jobClass, source: 'dead-letter' as const,
    status: 'dead-letter' as const, maxAttempts: job.maxAttempts, failedAt: job.failedAt * 1000,
    replayedAt: job.replayedAt, replayJobId: job.replayJobId, originalJobId: job.originalJobId,
    payload: redactDashboardPayload(job.payload), metadata: redactDashboardValue(job.metadata), error: redactDashboardText(job.exception),
    resourcePath: safeDashboardPath(mapped) ? mapped : null };
}
export function checkedDashboardPage<T>(page: DashboardPage<T>, limit: number): DashboardPage<T> {
  if (!page || !Array.isArray(page.items) || page.items.length > limit || typeof page.hasMore !== 'boolean'
    || page.total !== null && (!Number.isSafeInteger(page.total) || page.total < 0)
    || !['shared', 'process', 'unknown'].includes(page.scope)) throw new Error('Invalid or unbounded dashboard provider page.');
  return page;
}

export class DashboardService {
  async topology() {
    const configured = Queue.configuredConnections({ limit: 100, offset: 0 });
    const local = Queue.queues(); const definitions = new Map<string, QueueDefinition>();
    const key = (name: string, connection?: string) => JSON.stringify([connection ?? null, name]);
    const localKeys = new Set(local.map((definition) => key(definition.name, definition.connection)));
    const observed = new Set<string>();
    const discovery: Array<{ connection: string; complete: boolean; nextCursor: string | null; coverage: 'instrumented'; error: string | null }> = [];
    for (const connection of configured.connections) {
      definitions.set(key(connection.queue, connection.name), { name: connection.queue, connection: connection.name });
      if (connection.driver !== 'redis' && connection.driver !== 'database') {
        if (connection.driver === 'unknown') discovery.push({ connection: connection.name, complete: false, nextCursor: null, coverage: 'instrumented', error: 'Connection driver unavailable.' });
        continue;
      }
      try {
        const page = await Queue.discoverQueuesPage(connection.name, { limit: 100 });
        for (const definition of page.queues) { const identity = key(definition.name, connection.name); observed.add(identity); definitions.set(identity, { ...definition, connection: connection.name }); }
        discovery.push({ connection: connection.name, complete: page.complete, nextCursor: page.nextCursor, coverage: page.coverage, error: null });
      } catch { discovery.push({ connection: connection.name, complete: false, nextCursor: null, coverage: 'instrumented', error: 'Shared queue discovery unavailable.' }); }
    }
    // Local labels/configuration survive discovery; identical queue names on another connection remain distinct.
    for (const definition of local) { const identity = key(definition.name, definition.connection); definitions.set(identity, { ...definitions.get(identity), ...definition }); }
    const registry = [...definitions.values()].sort((a, b) => (a.connection ?? '').localeCompare(b.connection ?? '') || a.name.localeCompare(b.name));
    const jobs = Queue.jobDefinitions(); const workers = Queue.workerProfiles(); const defaultConnection = configured.connections.find((connection) => connection.isDefault);
    const topology: DashboardQueueTopologyEntry[] = [];
    for (const definition of registry.slice(0, 100)) {
      const matchingJobs = jobs.filter((job) => (job.connection ?? defaultConnection?.name) === definition.connection
        && (job.queue ?? configured.connections.find((connection) => connection.name === definition.connection)?.queue) === definition.name);
      const matchingWorkers = workers.filter((worker) => (worker.connection ?? defaultConnection?.name) === definition.connection && worker.queue === definition.name);
      const identity = key(definition.name, definition.connection);
      const base = { name: definition.name, connection: definition.connection ?? null, definition: redactDashboardValue(definition),
        registered: localKeys.has(identity), discovered: observed.has(identity),
        jobs: matchingJobs.slice(0, 100).map((job) => redactDashboardValue(job)), workerProfiles: matchingWorkers.slice(0, 100).map((worker) => redactDashboardValue(worker)),
        registryMeta: { jobsTotal: matchingJobs.length, workerProfilesTotal: matchingWorkers.length, truncated: matchingJobs.length > 100 || matchingWorkers.length > 100 } };
      try {
        const adapter = Queue.adapter(definition.name, definition.connection);
        if (!adapter.capabilities.shared) { topology.push({ ...base, driver: adapter.driver, capabilities: adapter.capabilities, counts: null, runtime: null, metrics: null, error: 'Shared monitoring unavailable for this driver.' }); continue; }
        const counts = await adapter.counts(); let runtime: QueueAdapterRuntime | null = null; let metrics: QueueSharedMetrics | null = null; const errors: string[] = [];
        try { runtime = await adapter.runtime(); } catch { errors.push('Runtime unavailable.'); }
        try { metrics = await adapter.metrics(60); } catch { errors.push('Metrics unavailable.'); }
        topology.push({ ...base, driver: adapter.driver, capabilities: adapter.capabilities, counts, runtime, metrics, error: errors.join(' ') || null });
      } catch { topology.push({ ...base, counts: null, runtime: null, metrics: null, error: 'Queue monitoring unavailable.' }); }
    }
    const truncated = registry.length > 100 || configured.hasMore;
    const complete = !truncated && discovery.every((page) => page.complete && !page.error);
    let aggregateCounts: QueueAdapterCounts | null = null;
    if (complete && topology.length && topology.every((queue) => queue.counts !== null)) {
      aggregateCounts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, deadLetter: 0 };
      for (const queue of topology) for (const field of Object.keys(aggregateCounts) as Array<keyof QueueAdapterCounts>) aggregateCounts[field] += queue.counts![field];
    }
    const locksComplete = complete && topology.length > 0 && topology.every((queue) => queue.runtime?.locksComplete === true);
    const sum = (field: 'stalled' | 'expiredLocks') => locksComplete && topology.every((queue) => typeof queue.runtime?.[field] === 'number')
      ? topology.reduce((total, queue) => total + queue.runtime![field]!, 0) : null;
    return { topology, registryCount: registry.length, truncated, coverage: 'configured, registered and shared-observed queues' as const,
      discovery: { connectionsTotal: configured.total, connectionsObserved: configured.connections.length, complete, pages: discovery },
      aggregate: { counts: aggregateCounts, stalled: sum('stalled'), expiredLocks: sum('expiredLocks'), locksComplete } };
  }
  async queue(filter: { queue: string; connection?: string; status: QueueJobFilter['status'] | 'dead-letter'; limit: number; offset: number } & Omit<QueueJobFilter, 'status'>) {
    const adapter = Queue.adapter(filter.queue, filter.connection);
    if (!adapter.capabilities.shared) throw new DashboardOperationError(503, 'Shared queue monitoring is unavailable for this driver.');
    const { queue, connection, status, ...criteria } = filter; const counts = await adapter.counts();
    if (status === 'dead-letter') {
      const items = await adapter.deadLetters({ ...criteria, limit: filter.limit + 1 });
      return { jobs: items.slice(0, filter.limit).map(dashboardDeadLetterResource), counts, queueName: adapter.queue, connection: adapter.connection,
        meta: { total: null, limit: filter.limit, offset: filter.offset, hasMore: items.length > filter.limit, status, coverage: 'instrumented' } };
    }
    const page = await adapter.list({ ...criteria, status });
    return { jobs: page.items.map(dashboardJobResource), counts, queueName: adapter.queue, connection: adapter.connection,
      meta: { total: page.indexedCount, limit: page.limit, offset: page.offset, hasMore: page.offset + page.items.length < page.indexedCount, status, coverage: page.coverage } };
  }
  async job(input: { id: string; queue: string; connection?: string; source: 'live' | 'dead-letter' }, timelineLimit = 50) {
    const adapter = Queue.adapter(input.queue, input.connection); const timeline = await adapter.timeline({ id: input.id, source: input.source }, timelineLimit);
    if (input.source === 'dead-letter') { const job = await adapter.deadLetter(input.id); if (!job) throw new DashboardOperationError(404, 'Dead letter not found in this connection and queue.'); return { ...dashboardDeadLetterResource(job), timeline }; }
    const job = await adapter.get(input.id); if (!job) throw new DashboardOperationError(404, 'Job not found in this connection and queue.');
    return { ...dashboardJobResource(job), timeline };
  }
  async scheduler(filter = { limit: 25, offset: 0, processOffset: 0 }) {
    if (!Number.isSafeInteger(filter.limit) || filter.limit < 1 || filter.limit > 100 || !Number.isSafeInteger(filter.offset) || filter.offset < 0
      || !Number.isSafeInteger(filter.processOffset) || filter.processOffset < 0) throw new DashboardOperationError(422, 'Invalid scheduler page.');
    const tasks = await ScheduleMonitor.listTasks(); const health = await ScheduleMonitor.getHealth();
    if (tasks.length > 1000) throw new DashboardOperationError(503, 'Scheduler registry exceeds the console limit.');
    tasks.sort((a, b) => a.name.localeCompare(b.name));
    return { tasks: tasks.slice(filter.offset, filter.offset + filter.limit).map((task) => redactDashboardValue(task)),
      health: redactDashboardValue(dashboardSchedulerHealth({ ...health, totalTasks: tasks.length,
        enabledTasks: tasks.filter((task) => task.enabled).length, runningTasks: tasks.filter((task) => task.isRunning).length }, filter.limit, filter.processOffset)),
      meta: { total: tasks.length, limit: filter.limit, offset: filter.offset, hasMore: filter.offset + filter.limit < tasks.length,
        truncated: filter.offset > 0 || filter.offset + filter.limit < tasks.length }, runtimeScope: health.processes === undefined ? 'unknown' : 'shared' };
  }
  async users(filter: DashboardListFilter, event: RequestEvent) {
    const provider = dashboardProviders.current.users; if (!provider) throw new DashboardOperationError(503, 'User directory unavailable.');
    const page = checkedDashboardPage(await provider.list(filter, event), filter.limit);
    return { ...page, items: page.items.map((user) => ({ id: user.id, name: user.name, email: user.email, globalRole: user.globalRole,
      protected: user.protected, canResetPassword: user.canResetPassword, canDelete: user.canDelete })) };
  }
  async permissions(filter: DashboardListFilter, event: RequestEvent) {
    const provider = dashboardProviders.current.permissions; if (!provider) throw new DashboardOperationError(503, 'Permission catalog unavailable.');
    const page = checkedDashboardPage(await provider.roles(filter, event), filter.limit); const manifest = new PermissionManifest(await provider.manifest(event));
    return { ...page, items: page.items.map((role) => ({ id: role.id, name: role.name, label: role.label, guard: role.guard, protected: role.protected })),
      catalog: manifest.capabilities().map((entry) => ({ ...entry, label: redactDashboardText(entry.label), group: redactDashboardText(entry.group) })),
      aliases: manifest.aliases().map((alias) => ({ ...alias, label: redactDashboardText(alias.label) })),
      systemProfiles: manifest.systemProfiles().map((profile) => ({ name: profile.name, label: redactDashboardText(profile.label), scope: profile.scope, defaults: profile.defaults })), editable: !!provider.profile && !!provider.saveProfile };
  }
  async features() {
    const config = dashboardProviders.current.features; if (!config) throw new DashboardOperationError(503, 'Feature registry unavailable.');
    const flags = [];
    for (const name of config.names) {
      const flag = await Features.getFlag(name);
      flags.push(flag ? { name: flag.name, description: redactDashboardText(flag.description), enabled: flag.enabled, percentage: flag.percentage, updatedAt: flag.updatedAt, available: true }
        : { name, enabled: null, percentage: null, updatedAt: null, available: false });
    }
    return { flags, scope: config.scope };
  }
  async mutate(dto: DashboardMutationDto, event: RequestEvent) {
    switch (dto.operation) {
      case 'createRole': case 'assignRole': case 'detachRole': case 'grantCapability': case 'revokeCapability':
        return new DashboardAccessService().mutate(dto.operation, dto.input, event);
      case 'retryJob': case 'deleteJob': {
        const input = dashboardJobSchema.parse(dto.input); const adapter = Queue.adapter(input.queue, input.connection); const reference = { id: input.id, source: input.source };
        const result = dto.operation === 'retryJob' ? await adapter.retry(reference) : await adapter.remove(reference);
        if (result.outcome !== 'accepted') throw new DashboardOperationError(result.outcome === 'missing' ? 404 : 409, 'Job state changed or operation is protected. Refresh before trying again.');
        return { message: dto.operation === 'retryJob' ? 'Job queued for retry.' : 'Job removed.', data: result };
      }
      case 'retryJobs': case 'cleanupJobs': {
        const input = dashboardBatchSchema.parse(dto.input); const adapter = Queue.adapter(input.queue, input.connection);
        const result = dto.operation === 'retryJobs' ? await adapter.retryMany(input.references) : await adapter.cleanup(input.references);
        const accepted = result.results.filter((item) => item.outcome === 'accepted').length;
        return { message: `${accepted} accepted; ${result.failures.length + result.results.length - accepted} not accepted.`, data: result, partial: result.failures.length > 0 || accepted !== result.results.length };
      }
      case 'pauseQueue': {
        const input = dashboardPauseSchema.parse(dto.input); const adapter = Queue.adapter(input.queue, input.connection);
        if (!adapter.capabilities.pause) throw new DashboardOperationError(409, 'Pause controls are unsupported by this driver.');
        if (input.paused) await adapter.pause(); else await adapter.resume(); return { message: input.paused ? 'Queue paused.' : 'Queue resumed.' };
      }
      case 'runTask': case 'toggleTask': {
        const input = dashboardRunSchema.parse(dto.input); const task = await ScheduleMonitor.getTask(input.name);
        if (!task) throw new DashboardOperationError(404, 'Scheduled task not found.');
        if (dto.operation === 'toggleTask') { const toggle = dashboardToggleSchema.parse(dto.input); if (toggle.enabled) await ScheduleMonitor.enableTask(input.name); else await ScheduleMonitor.disableTask(input.name); return { message: toggle.enabled ? 'Task enabled.' : 'Task disabled.' }; }
        if (!task.enabled || task.isRunning) throw new DashboardOperationError(409, 'Task is disabled or already running.');
        const request = await ScheduleMonitor.requestRun(input.name);
        return { message: 'Run request queued.', data: { id: request.id, task: request.task, state: request.state, requestedAt: request.requestedAt, attempts: request.attempts }, queued: true };
      }
      case 'deleteUser': case 'resetPassword': {
        const provider = dashboardProviders.current.users; if (!provider) throw new DashboardOperationError(503, 'User operations unavailable.');
        const input = dto.operation === 'deleteUser' ? dashboardDeleteUserSchema.parse(dto.input) : dashboardUserSchema.parse(dto.input);
        if (dto.operation === 'deleteUser') { await provider.delete(input.id, event); return { message: 'User removed.' }; }
        const result = await provider.resetPassword(input.id, event); return { message: result.queued ? 'Password reset queued.' : 'Password reset accepted.', queued: result.queued };
      }
      case 'toggleFeature': {
        const input = dashboardFeatureSchema.parse(dto.input);
        if (!dashboardProviders.current.features?.names.includes(input.name)) throw new DashboardOperationError(404, 'Feature is not registered for this console.');
        if (!await Features.getFlag(input.name)) throw new DashboardOperationError(404, 'Feature not found.');
        const flag = await Features.updateFlag(input.name, { enabled: input.enabled }); if (!flag || flag.enabled !== input.enabled) throw new DashboardOperationError(409, 'Feature was not updated.');
        return { message: input.enabled ? 'Feature enabled.' : 'Feature disabled.' };
      }
      case 'saveProfile': case 'deleteRole': {
        const provider = dashboardProviders.current.permissions;
        if (dto.operation === 'saveProfile') {
          if (!provider?.saveProfile) throw new DashboardOperationError(503, 'Profile editor unavailable.');
          const input = dashboardProfileSchema.parse(dto.input); const catalog = new PermissionManifest(await provider.manifest(event));
          try {
            if (input.kind === 'custom') catalog.exactNames(input.capabilities, input.scope);
            else { const profile = catalog.systemProfile(input.systemProfile!); if (!profile || profile.scope !== input.scope) throw new Error('Invalid system profile.'); catalog.exactNames(input.exclusions, input.scope); catalog.exactNames(input.inclusions, input.scope); }
          } catch { throw new DashboardOperationError(422, 'Invalid or out-of-scope permission selection.'); }
          await provider.saveProfile(input, event); return { message: 'Permission profile saved.' };
        }
        if (!provider?.deleteRole) throw new DashboardOperationError(503, 'Role deletion unavailable.');
        await provider.deleteRole(dashboardDeleteRoleSchema.parse(dto.input), event); return { message: 'Role removed from its assignment scope.' };
      }
    }
  }
  async logs(filter: Parameters<typeof LogViewer.query>[0]) { const page = await LogViewer.page(filter); return { logs: redactDashboardValue(page.data), stats: await LogViewer.getStats(), limit: filter?.limit, offset: filter?.offset, ...page.meta }; }
}

export class DashboardMutationAction {
  constructor(private service = new DashboardService()) {}
  async run(dto: DashboardMutationDto, event: RequestEvent) {
    const input = dto.input; const identity = 'id' in input ? input.id : 'name' in input ? input.name : 'roleId' in input ? String(input.roleId) : 'queue' in input ? input.queue : 'batch';
    const metadata = 'queue' in input ? { queue: input.queue, connection: input.connection ?? null, ...('references' in input ? { count: input.references.length } : {}), ...('source' in input ? { source: input.source } : {}) } : 'scope' in input ? { scope: input.scope, teamId: input.teamId ?? null,
      ...('id' in input && 'roleId' in input ? { roleId: input.roleId } : {}), ...('capability' in input ? { capability: input.capability } : {}) } : {};
    const audit = { userId: event.locals.user?.id ?? null, modelType: 'DashboardOperation', modelId: identity, metadata };
    await Audit.log({ ...audit, action: `dashboard.${dto.operation}.requested` });
    let result;
    try { result = await this.service.mutate(dto, event); }
    catch (error) { try { await Audit.log({ ...audit, action: `dashboard.${dto.operation}.failed` }); } catch { /* Preserve the original failure. */ } throw error; }
    try { await Audit.log({ ...audit, action: `dashboard.${dto.operation}.completed` }); }
    catch { void Log.error('Dashboard completion audit failed', { operation: dto.operation, modelId: identity }).catch(() => {}); return { ...result, auditWarning: 'Operation finished, but completion audit could not be recorded. Do not repeat it without checking its state.' }; }
    return { ...result, auditWarning: undefined };
  }
}
