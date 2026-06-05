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
 * ScheduleMonitor.disableTask('SendDailyReport');
 * ```
 */

import { cronMatches } from './index.js';
import type { Scheduler, ScheduledTask } from './index.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { singleton } from '../support/singleton.js';

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
  /** Next scheduled run time */
  nextRun: Date;
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
}

// ── Schedule Monitor Service ───────────────────────────────

class ScheduleMonitorService {
  private scheduler: Scheduler | null = null;
  private startTime: Date = new Date();
  private taskEnabled: Map<string, boolean> = new Map();

  /**
   * Configure the monitor with a scheduler instance
   */
  configure(scheduler: Scheduler): void {
    this.scheduler = scheduler;
    this.startTime = new Date();

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

    return tasks.map((task) => this.createTaskInfo(task, dbHistory.get(task.name) || []));
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
    return this.createTaskInfo(task, dbHistory.get(name) || []);
  }

  /**
   * Enable a task
   */
  enableTask(name: string): void {
    this.taskEnabled.set(name, true);
  }

  /**
   * Disable a task
   */
  disableTask(name: string): void {
    this.taskEnabled.set(name, false);
  }

  /**
   * Manually trigger a task to run (if not disabled).
   * Persists the result to the database.
   */
  async runTask(name: string): Promise<void> {
    if (!this.scheduler) {
      throw new Error('Scheduler not configured');
    }

    if (this.taskEnabled.has(name) && !this.taskEnabled.get(name)) {
      throw new Error(`Task "${name}" is disabled`);
    }

    const task = this.scheduler.getTasks().find((t) => t.name === name);
    if (!task) {
      throw new Error(`Task "${name}" not found`);
    }

    const result = await task.executeTask();

    // Persist to database
    await this.persistResult(result);
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
    const enabledTasks = tasks.filter(
      (t) => !this.taskEnabled.has(t.name) || this.taskEnabled.get(t.name),
    ).length;

    const runningTasks = tasks.filter((t) => t.isRunning()).length;

    // Load recent errors from database
    const lastErrors: Array<{ task: string; error: string; timestamp: Date }> = [];
    try {
      const rows = await new QueryBuilder('scheduled_task_runs')
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
   * Single query fetches the latest N records per task.
   */
  private async loadHistoryFromDb(
    taskNames: string[],
    limit: number = 20,
  ): Promise<Map<string, TaskRunRecord[]>> {
    const result = new Map<string, TaskRunRecord[]>();
    if (taskNames.length === 0) return result;

    const rows = await new QueryBuilder('scheduled_task_runs')
      .select('task', 'success', 'duration', 'error', 'ran_at')
      .whereIn('task', taskNames)
      .orderBy('ran_at', 'desc')
      .limit(taskNames.length * limit)
      .get();

    for (const row of rows) {
      if (!result.has(row.task)) {
        result.set(row.task, []);
      }
      const history = result.get(row.task)!;
      if (history.length < limit) {
        history.push({
          timestamp: new Date(row.ran_at),
          success: !!row.success,
          duration: row.duration,
          error: row.error || undefined,
        });
      }
    }

    return result;
  }

  /**
   * Persist a task result to the database
   */
  private async persistResult(result: { task: string; success: boolean; duration: number; error?: string; timestamp: Date }): Promise<void> {
    await new QueryBuilder('scheduled_task_runs').insert({
      task: result.task,
      success: result.success ? 1 : 0,
      duration: result.duration,
      error: result.error || null,
      ran_at: result.timestamp.toISOString(),
    });
  }

  /**
   * Create a TaskInfo object from a ScheduledTask and its DB history
   */
  private createTaskInfo(task: ScheduledTask, history: TaskRunRecord[]): TaskInfo {
    const expression = task.getExpression();
    const lastRecord = history.length > 0 ? history[0] : null;

    const enabled =
      !this.taskEnabled.has(task.name) || this.taskEnabled.get(task.name) === true;

    return {
      name: task.name,
      expression,
      humanReadable: this.humanizeExpression(expression),
      nextRun: this.getNextRun(expression),
      lastRun: lastRecord?.timestamp,
      lastDuration: lastRecord?.duration,
      lastStatus: lastRecord?.success ? 'success' : 'failed',
      enabled,
      isRunning: task.isRunning(),
      history: history.slice(0, 5),
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
      if (hour !== '*' && minute !== '*') {
        const h = parseInt(hour, 10);
        const m = parseInt(minute, 10);
        return `Daily at ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      }
    }

    // Weekdays only
    if (dayOfWeek === '1-5' && dayOfMonth === '*' && month === '*') {
      if (hour !== '*' && minute !== '*') {
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
  private getNextRun(expression: string): Date {
    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0);
    next.setMilliseconds(0);
    next.setMinutes(next.getMinutes() + 1);

    // Simple heuristic: check the next 366 days
    const maxChecks = 366 * 24 * 60;
    let checks = 0;

    while (checks < maxChecks) {
      if (cronMatches(expression, next)) {
        return next;
      }
      next.setMinutes(next.getMinutes() + 1);
      checks++;
    }

    // If no match found in a year, return now
    return now;
  }
}

/**
 * Export as a singleton instance
 */
export const ScheduleMonitor = singleton(
  'svelar.scheduleMonitor',
  () => new ScheduleMonitorService(),
);
