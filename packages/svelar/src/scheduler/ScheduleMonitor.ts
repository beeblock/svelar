/**
 * Schedule Monitor
 *
 * Utility for inspecting and managing scheduled tasks from the admin dashboard.
 * Tracks task execution history, health metrics, and provides task management
 * capabilities.
 *
 * @example
 * ```ts
 * import { ScheduleMonitor } from '@beeblock/svelar/scheduler';
 *
 * // Configure with your scheduler instance
 * ScheduleMonitor.configure(scheduler);
 *
 * // List all tasks with their status
 * const tasks = ScheduleMonitor.listTasks();
 *
 * // Get health metrics
 * const health = ScheduleMonitor.getHealth();
 *
 * // Manually run a task
 * await ScheduleMonitor.runTask('SendDailyReport');
 *
 * // Toggle task enabled state
 * await ScheduleMonitor.disableTask('SendDailyReport');
 * ```
 */

import { nextCronDate } from './cron.js';
import type { Scheduler, ScheduledTask, TaskResult } from './index.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { singleton } from '../support/singleton.js';
import type { MissedRunPolicy, SchedulerRunRequest } from './RuntimeStore.js';

type SharedTaskStatus = Awaited<ReturnType<Scheduler['listTaskStatuses']>>[number];

// ── Types ──────────────────────────────────────────────────

export interface TaskRunRecord {
  /** When the task was run */
  timestamp: Date;
  /** Whether execution succeeded */
  success: boolean;
  /** How long the task took (ms) */
  duration: number;
  /** Error message if failed */
  error?: string;
}

export interface TaskInfo {
  /** Task name */
  name: string;
  /** Cron expression */
  expression: string;
  /** Human-readable schedule description */
  humanReadable: string;
  /** Next scheduled run time, or null when unavailable */
  nextRun: Date | null;
  /** Safe preview failure feedback */
  nextRunError?: string;
  /** Explicit task timezone; undefined means system time */
  timezone?: string;
  /** Last execution timestamp */
  lastRun?: Date;
  /** Duration of last execution (ms) */
  lastDuration?: number;
  /** Success/failure status of last run */
  lastStatus?: 'success' | 'failed';
  /** Whether the task is enabled */
  enabled: boolean;
  /** Whether the task is currently running */
  isRunning: boolean;
  /** Recent execution history */
  history: TaskRunRecord[];
  tenantId?: string | null;
  lockOwner?: string | null;
  leaseUntil?: Date | null;
  missedRun?: MissedRunPolicy;
}

export interface SchedulerHealth {
  /** Total registered tasks */
  totalTasks: number;
  /** Number of enabled tasks */
  enabledTasks: number;
  /** Number of currently running tasks */
  runningTasks: number;
  /** Recent errors */
  lastErrors: Array<{ task: string; error: string; timestamp: Date }>;
  /** Scheduler uptime in milliseconds */
  uptime: number;
  processes?: Array<{ owner: string | null; state: string; heartbeatAt: Date; healthy: boolean; lastError: string | null }>;
}

interface TaskSetting {
  enabled: boolean;
  updatedAt: Date;
}

// ── Schedule Monitor Service ───────────────────────────────

export class ScheduleMonitorService {
  private scheduler: Scheduler | null = null;
  private startTime: Date = new Date();
  private taskEnabled: Map<string, boolean> = new Map();

  /** Use a separate monitor for each explicit tenant scope; never reconfigure a singleton per request. */
  forScheduler(scheduler: Scheduler): ScheduleMonitorService {
    const monitor = new ScheduleMonitorService();
    monitor.configure(scheduler);
    return monitor;
  }

  /**
   * Configure the monitor with a scheduler instance
   */
  configure(scheduler: Scheduler): void {
    this.scheduler = scheduler;
    this.startTime = new Date();
    this.taskEnabled.clear();

    // Initialize enabled state for all current tasks
    for (const task of scheduler.getTasks()) {
      if (!this.taskEnabled.has(task.name)) {
        this.taskEnabled.set(task.name, true);
      }
    }
  }

  /**
   * List all registered tasks with their current status.
   * Reads run history from the database so all processes (CLI, web) share the same data.
   */
  async listTasks(): Promise<TaskInfo[]> {
    if (!this.scheduler) {
      return [];
    }

    const tasks = this.scheduler.getTasks();
    const dbHistory = await this.loadHistoryFromDb(
      tasks.map((t) => t.name),
    );
    if (this.scheduler.hasPersistentRuntime()) {
      const status = await this.scheduler.listTaskStatuses();
      return tasks.map((task) => this.createTaskInfo(task, dbHistory.get(task.name) || [], undefined, status.find((row) => row.name === task.name)));
    }
    const settings = await this.loadSettingsFromDb(tasks.map((t) => t.name));

    return tasks.map((task) => this.createTaskInfo(task, dbHistory.get(task.name) || [], settings.get(task.name)));
  }

  /**
   * Get info for a specific task by name
   */
  async getTask(name: string): Promise<TaskInfo | null> {
    if (!this.scheduler) {
      return null;
    }

    const task = this.scheduler.getTasks().find((t) => t.name === name);
    if (!task) return null;

    const dbHistory = await this.loadHistoryFromDb([name]);
    if (this.scheduler.hasPersistentRuntime()) {
      const status = (await this.scheduler.listTaskStatuses()).find((row) => row.name === name);
      return this.createTaskInfo(task, dbHistory.get(name) || [], undefined, status);
    }
    const settings = await this.loadSettingsFromDb([name]);
    return this.createTaskInfo(task, dbHistory.get(name) || [], settings.get(name));
  }

  /**
   * Enable a task
   */
  async enableTask(name: string): Promise<void> {
    await this.persistTaskSetting(name, true);
    this.taskEnabled.set(name, true);
  }

  /**
   * Disable a task
   */
  async disableTask(name: string): Promise<void> {
    await this.persistTaskSetting(name, false);
    this.taskEnabled.set(name, false);
  }

  async requestRun(name: string): Promise<SchedulerRunRequest> {
    if (!this.scheduler) throw new Error('Scheduler not configured');
    return this.scheduler.requestRun(name);
  }

  async getRunRequest(name: string, id: string): Promise<SchedulerRunRequest | null> {
    if (!this.scheduler) throw new Error('Scheduler not configured');
    return this.scheduler.getRunRequest(name, id);
  }

  async cancelRunRequest(name: string, id: string): Promise<boolean> {
    if (!this.scheduler) throw new Error('Scheduler not configured');
    return this.scheduler.cancelRunRequest(name, id);
  }

  /**
   * Manually trigger a task to run (if not disabled).
   * Persists the result to the database.
   */
  async runTask(name: string): Promise<TaskResult> {
    if (!this.scheduler) {
      throw new Error('Scheduler not configured');
    }
    if (this.scheduler.hasPersistentRuntime()) throw new Error('Use requestRun() to enqueue production scheduler execution.');

    const settings = await this.loadSettingsFromDb([name]);
    if ((settings.get(name)?.enabled ?? this.taskEnabled.get(name)) === false) {
      throw new Error(`Task "${name}" is disabled`);
    }

    const task = this.scheduler.getTasks().find((t) => t.name === name);
    if (!task) {
      throw new Error(`Task "${name}" not found`);
    }

    const result = await task.executeTask();

    // Persist to database
    if (!result.skipped) await this.persistResult(result);
    return result;
  }

  /**
   * Get execution history for a task from the database
   */
  async getTaskHistory(name: string, limit: number = 10): Promise<TaskRunRecord[]> {
    const dbHistory = await this.loadHistoryFromDb([name], limit);
    return dbHistory.get(name) || [];
  }

  /**
   * Get overall scheduler health metrics
   */
  async getHealth(): Promise<SchedulerHealth> {
    if (!this.scheduler) {
      return {
        totalTasks: 0,
        enabledTasks: 0,
        runningTasks: 0,
        lastErrors: [],
        uptime: 0,
      };
    }

    const tasks = this.scheduler.getTasks();
    if (this.scheduler.hasPersistentRuntime()) {
      const status = await this.scheduler.listTaskStatuses();
      const processes = await this.scheduler.getRuntimeStore().processes();
      return {
        totalTasks: tasks.length, enabledTasks: status.filter((task) => task.enabled).length,
        runningTasks: status.filter((task) => task.isRunning).length,
        lastErrors: (await Promise.all(tasks.map(async (task) => {
          const history = await this.loadHistoryFromDb([task.name], 5);
          return (history.get(task.name) ?? []).filter((record) => record.error).map((record) => ({ task: task.name, error: record.error!, timestamp: record.timestamp }));
        }))).flat().sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10),
        uptime: Date.now() - this.startTime.getTime(),
        processes: processes.map((process) => ({
          owner: process.owner ?? process.runtime_key.slice('process:'.length), state: process.state,
          heartbeatAt: new Date(Number(process.heartbeat_at)),
          healthy: process.state === 'running' && Date.now() - Number(process.heartbeat_at) < this.scheduler!.getHeartbeatMilliseconds() * 3,
          lastError: process.last_error,
        })),
      };
    }
    const settings = await this.loadSettingsFromDb(tasks.map((task) => task.name));
    const enabledTasks = tasks.filter(
      (t) => settings.get(t.name)?.enabled ?? this.taskEnabled.get(t.name) ?? true,
    ).length;

    const runningTasks = tasks.filter((t) => t.isRunning()).length;

    // Load recent errors from database
    const lastErrors: Array<{ task: string; error: string; timestamp: Date }> = [];
    try {
      const rows = await new QueryBuilder('scheduled_task_runs', undefined, this.scheduler?.getRuntimeStore().connectionName)
        .select('task', 'error', 'ran_at')
        .whereNotNull('error')
        .orderBy('ran_at', 'desc')
        .limit(10)
        .get();
      for (const row of rows) {
        lastErrors.push({
          task: row.task,
          error: row.error,
          timestamp: new Date(row.ran_at),
        });
      }
    } catch {
      // Table may not exist
    }

    const uptime = Date.now() - this.startTime.getTime();

    return {
      totalTasks: tasks.length,
      enabledTasks,
      runningTasks,
      lastErrors,
      uptime,
    };
  }

  // ── Internal Methods ───────────────────────────────────

  /**
   * Load task run history from the database.
   * Bound history per task so frequent tasks cannot hide other tasks' latest runs.
   */
  private async loadHistoryFromDb(
    taskNames: string[],
    limit: number = 20,
  ): Promise<Map<string, TaskRunRecord[]>> {
    const result = new Map<string, TaskRunRecord[]>();
    if (taskNames.length === 0) return result;

    for (const task of taskNames) {
      const rows = await new QueryBuilder('scheduled_task_runs', undefined, this.scheduler?.getRuntimeStore().connectionName)
        .select('task', 'success', 'duration', 'error', 'ran_at')
        .where('task', this.scheduler?.hasPersistentRuntime() ? this.scheduler.getRuntimeStore().key(task) : task)
        .orderBy('ran_at', 'desc')
        .limit(limit)
        .get();
      result.set(task, rows.map((row) => ({
          timestamp: new Date(row.ran_at),
          success: !!row.success,
          duration: row.duration,
          error: row.error || undefined,
      })));
    }

    return result;
  }

  /**
   * Persist a task result to the database
   */
  private async persistResult(result: { task: string; success: boolean; duration: number; error?: string; timestamp: Date }): Promise<void> {
    await new QueryBuilder('scheduled_task_runs').insert({
      task: result.task,
      success: result.success,
      duration: result.duration,
      error: result.error || null,
      ran_at: result.timestamp.toISOString(),
    });
  }

  private async loadSettingsFromDb(taskNames: string[]): Promise<Map<string, TaskSetting>> {
    const result = new Map<string, TaskSetting>();
    if (taskNames.length === 0) return result;

    const rows = await new QueryBuilder('scheduled_task_settings')
      .select('task', 'enabled', 'updated_at')
      .whereIn('task', taskNames)
      .get();

    for (const row of rows ?? []) {
      result.set(row.task, {
        enabled: !!row.enabled,
        updatedAt: new Date(row.updated_at),
      });
    }

    return result;
  }

  private async persistTaskSetting(name: string, enabled: boolean): Promise<void> {
    if (this.scheduler?.hasPersistentRuntime()) {
      await this.scheduler.configureTask(name, { enabled });
      return;
    }
    const payload = {
      task: name,
      enabled,
      updated_at: new Date().toISOString(),
    };

    await new QueryBuilder('scheduled_task_settings').upsert(payload, ['task'], ['enabled', 'updated_at']);
  }

  /**
   * Create a TaskInfo object from a ScheduledTask and its DB history
   */
  private createTaskInfo(task: ScheduledTask, history: TaskRunRecord[], setting?: TaskSetting, shared?: SharedTaskStatus): TaskInfo {
    const expression = task.getExpression();
    const timezone = shared?.timezone ?? task.getTimezone();
    const nextRun = shared ? shared.nextRun : this.getNextRun(expression, timezone);
    const lastRecord = history.length > 0 ? history[0] : null;

    const enabled =
      setting?.enabled ?? (!this.taskEnabled.has(task.name) || this.taskEnabled.get(task.name) === true);

    return {
      name: task.name,
      expression,
      humanReadable: this.humanizeExpression(expression),
      nextRun,
      nextRunError: nextRun === null && (shared?.enabled ?? enabled) ? 'Unable to calculate the next scheduled run' : undefined,
      timezone,
      lastRun: lastRecord?.timestamp,
      lastDuration: lastRecord?.duration,
      lastStatus: lastRecord ? (lastRecord.success ? 'success' : 'failed') : undefined,
      enabled: shared?.enabled ?? enabled,
      isRunning: shared?.isRunning ?? task.isRunning(),
      history: history.slice(0, 5),
      tenantId: shared?.tenantId, lockOwner: shared?.lockOwner, leaseUntil: shared?.leaseUntil, missedRun: shared?.missedRun,
    };
  }

  /**
   * Convert a cron expression to a human-readable description
   */
  private humanizeExpression(expression: string): string {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      return expression;
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Special patterns
    if (expression === '* * * * *') return 'Every minute';
    if (expression === '*/5 * * * *') return 'Every 5 minutes';
    if (expression === '*/10 * * * *') return 'Every 10 minutes';
    if (expression === '*/15 * * * *') return 'Every 15 minutes';
    if (expression === '*/30 * * * *') return 'Every 30 minutes';
    if (expression === '0 * * * *') return 'Every hour';
    if (expression === '0 0 * * *') return 'Daily at midnight';
    if (expression === '0 0 * * 0') return 'Weekly (Sunday at midnight)';
    if (expression === '0 0 1 * *') return 'Monthly (1st at midnight)';
    if (expression === '0 0 1 1 *') return 'Yearly (Jan 1st at midnight)';

    // Daily at specific time
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
        const h = parseInt(hour, 10);
        const m = parseInt(minute, 10);
        return `Daily at ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      }
    }

    // Weekdays only
    if (dayOfWeek === '1-5' && dayOfMonth === '*' && month === '*') {
      if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
        const h = parseInt(hour, 10);
        const m = parseInt(minute, 10);
        return `Weekdays at ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      }
    }

    // Fallback to expression itself
    return expression;
  }

  /**
   * Calculate the next run time for a task given its cron expression
   */
  private getNextRun(expression: string, timezone?: string): Date | null {
    try {
      return nextCronDate(expression, new Date(), timezone);
    } catch {
      return null;
    }
  }
}

/**
 * Export as a singleton instance
 */
export const ScheduleMonitor = singleton(
  'svelar.scheduleMonitor',
  () => new ScheduleMonitorService(),
);
