import { JobMonitor, type JobInfo } from '../queue/JobMonitor.js';
import { Queue } from '../queue/index.js';
import { ScheduleMonitor } from '../scheduler/ScheduleMonitor.js';
import { LogViewer } from '../logging/LogViewer.js';
import { Audit } from '../audit/index.js';
import { Log } from '../logging/index.js';
import type { RequestEvent } from '../routing/Controller.js';
import type { DashboardMutationDto } from './contracts.js';
import { redactDashboardPayload, redactDashboardValue } from './security.js';

export class DashboardOperationError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function dashboardJobResource(job: JobInfo) {
  return {
    ...job,
    payload: redactDashboardPayload(job.payload),
    metadata: redactDashboardValue(job.metadata),
    progress: redactDashboardValue(job.progress),
    error: job.error ? redactDashboardValue(job.error) : undefined,
    timeline: [
      { event: 'created', timestamp: job.createdAt },
      ...(job.processedAt ? [{ event: 'processed', timestamp: job.processedAt }] : []),
      ...(job.failedAt ? [{ event: 'failed', timestamp: job.failedAt }] : []),
      ...(job.delayedUntil ? [{ event: 'scheduled', timestamp: job.delayedUntil }] : []),
    ],
  };
}

export class DashboardService {
  async topology() {
    const health = await JobMonitor.getHealth();
    const registry = Queue.queues();
    const names = [...new Set([...registry.map((entry) => entry.name), ...Object.keys(health.queues)])];
    const queues = names.map((name) => ({
      name,
      definition: redactDashboardValue(registry.find((entry) => entry.name === name) ?? { name }),
      counts: health.queues[name] ?? null,
      runtime: health.runtime?.[name] ?? null,
    }));
    return { ...health, topology: queues };
  }

  async scheduler() {
    const tasks = await ScheduleMonitor.listTasks();
    const health = await ScheduleMonitor.getHealth();
    return {
      tasks: redactDashboardValue(tasks),
      health: redactDashboardValue({ ...health, totalTasks: tasks.length,
        enabledTasks: tasks.filter((task) => task.enabled).length,
        runningTasks: tasks.filter((task) => task.isRunning).length }),
    };
  }

  async mutate(dto: DashboardMutationDto) {
    const input = dto.input;
    if ('id' in input) {
      const job = await JobMonitor.getJob(input.id, input.queue);
      if (!job) throw new DashboardOperationError(404, 'Job not found.');
      if (job.queue !== input.queue) throw new DashboardOperationError(409, 'Job queue does not match the requested queue.');
      if (dto.operation === 'retryJob') {
        if (job.status !== 'failed') throw new DashboardOperationError(409, 'Only failed jobs can be retried.');
        if (!await JobMonitor.retryJob(input.id, input.queue)) throw new DashboardOperationError(409, 'Job was not retried. Refresh before retrying.');
        return 'Job queued for retry.';
      }
      if (job.status === 'active') throw new DashboardOperationError(409, 'Active jobs cannot be deleted.');
      if (!await JobMonitor.deleteJob(input.id, input.queue)) throw new DashboardOperationError(409, 'Job was not deleted. Refresh before retrying.');
      return 'Job removed.';
    }
    const task = await ScheduleMonitor.getTask(input.name);
    if (!task) throw new DashboardOperationError(404, 'Scheduled task not found.');
    if (dto.operation === 'toggleTask' && 'enabled' in input) {
      if (input.enabled) await ScheduleMonitor.enableTask(input.name);
      else await ScheduleMonitor.disableTask(input.name);
      return input.enabled ? 'Task enabled.' : 'Task disabled.';
    }
    if (!task.enabled || task.isRunning) throw new DashboardOperationError(409, 'Task is disabled or already running.');
    const result = await ScheduleMonitor.runTask(input.name);
    if (result.skipped) throw new DashboardOperationError(409, 'Task is already running.');
    if (!result.success) {
      await Log.error('Dashboard scheduled task failed', redactDashboardValue({ task: input.name, error: result.error }) as Record<string, unknown>);
      throw new DashboardOperationError(503, 'Task failed. Check persisted task history for the error.');
    }
    return 'Task completed successfully.';
  }

  async logs(filter: Parameters<typeof LogViewer.query>[0]) {
    const page = await LogViewer.page(filter);
    return { logs: redactDashboardValue(page.data), stats: await LogViewer.getStats(),
      limit: filter?.limit, offset: filter?.offset, ...page.meta };
  }
}

export class DashboardMutationAction {
  constructor(private service = new DashboardService()) {}

  async run(dto: DashboardMutationDto, event: RequestEvent) {
    const identity = 'id' in dto.input ? dto.input.id : dto.input.name;
    const audit = { userId: event.locals.user?.id ?? null, modelType: 'DashboardOperation', modelId: identity,
      metadata: 'queue' in dto.input ? { queue: dto.input.queue } : {} };
    // Refuse to mutate when the configured audit store cannot record intent.
    await Audit.log({ ...audit, action: `dashboard.${dto.operation}.requested` });
    const message = await this.service.mutate(dto);
    try {
      await Audit.log({ ...audit, action: `dashboard.${dto.operation}.completed` });
    } catch {
      void Log.error('Dashboard completion audit failed', { operation: dto.operation, modelId: identity }).catch(() => {});
      return { message, auditWarning: 'Operation finished, but completion audit could not be recorded. Do not repeat it without checking its state.' };
    }
    return { message };
  }
}
