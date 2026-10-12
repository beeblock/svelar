/**
 * Svelar Task Scheduler
 *
 * Laravel-inspired task scheduler with cron expressions.
 * Schedule recurring tasks, chain operations, and manage
 * background work.
 *
 * @example
 * ```ts
 * import { Scheduler, ScheduledTask } from '@beeblock/svelar/scheduler';
 * import { QueryBuilder } from '@beeblock/svelar/orm';
 *
 * // Define tasks
 * class PruneExpiredTokens extends ScheduledTask {
 *   schedule() { return this.daily(); }
 *
 *   async handle(): Promise<void> {
 *     await new QueryBuilder('tokens')
 *       .where('expires_at', '<', new Date().toISOString())
 *       .delete();
 *   }
 * }
 *
 * class SendDailyReport extends ScheduledTask {
 *   schedule() { return this.dailyAt('09:00'); }
 *
 *   async handle(): Promise<void> {
 *     const users = await User.count();
 *     await Mailer.send({ to: 'admin@example.com', body: `Users: ${users}` });
 *   }
 * }
 *
 * // Register tasks
 * const scheduler = new Scheduler();
 * scheduler.register(new PruneExpiredTokens());
 * scheduler.register(new SendDailyReport());
 *
 * // Run the scheduler (call every minute, e.g., via cron or setInterval)
 * await scheduler.run();
 *
 * // Or start the built-in ticker
 * scheduler.start();
 * ```
 */

import { QueryBuilder } from '../orm/QueryBuilder.js';
import { cronMatches, parseCron, scheduleTime, validateTimezone } from './cron.js';

// ── Types ──────────────────────────────────────────────────

export interface TaskSchedule {
  expression: string;
  timezone?: string;
  withoutOverlapping?: boolean;
  onSuccess?: () => void | Promise<void>;
  onFailure?: (error: Error) => void | Promise<void>;
}

export interface TaskResult {
  task: string;
  success: boolean;
  duration: number;
  error?: string;
  timestamp: Date;
  /** The task did not execute because an overlap lock was already held. */
  skipped?: boolean;
}

export interface SchedulerRuntimeStatus {
  running: boolean;
  lastTickAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  failures: number;
}

// ── Scheduled Task Base Class ──────────────────────────────

export abstract class ScheduledTask {
  /** Task name (defaults to class name) */
  name: string = this.constructor.name;

  /** Whether this task is currently running */
  private _running = false;

  /** Whether to prevent overlapping execution */
  protected withoutOverlapping = false;

  /** Lock TTL in minutes for distributed locking (default: 5) */
  protected _lockTtlMinutes: number = 5;

  /** The cron expression */
  private _expression: string = '* * * * *';

  private _timezone?: string;

  /**
   * Define the schedule for this task.
   * Return `this` after calling a scheduling method.
   */
  schedule(): this {
    return this;
  }

  /**
   * The task logic — override this.
   */
  abstract handle(): Promise<void>;

  /**
   * Called when the task succeeds
   */
  onSuccess(): void | Promise<void> {}

  /**
   * Called when the task fails
   */
  onFailure(error: Error): void | Promise<void> {
    console.error(`[Scheduler] Task "${this.name}" failed:`, error.message);
  }

  // ── Scheduling Helpers ─────────────────────────────────

  /** Run every minute */
  everyMinute(): this {
    return this.cron('* * * * *');
  }

  /** Run every N minutes */
  everyMinutes(n: number): this {
    return this.cron(`*/${n} * * * *`);
  }

  /** Run every 5 minutes */
  everyFiveMinutes(): this {
    return this.everyMinutes(5);
  }

  /** Run every 10 minutes */
  everyTenMinutes(): this {
    return this.everyMinutes(10);
  }

  /** Run every 15 minutes */
  everyFifteenMinutes(): this {
    return this.everyMinutes(15);
  }

  /** Run every 30 minutes */
  everyThirtyMinutes(): this {
    return this.everyMinutes(30);
  }

  /** Run every hour */
  hourly(): this {
    return this.cron('0 * * * *');
  }

  /** Run every hour at a specific minute */
  hourlyAt(minute: number): this {
    return this.cron(`${minute} * * * *`);
  }

  /** Run every day at midnight */
  daily(): this {
    return this.cron('0 0 * * *');
  }

  /** Run every day at a specific time (HH:MM) */
  dailyAt(time: string): this {
    const { hour, minute } = scheduleTime(time);
    return this.cron(`${minute} ${hour} * * *`);
  }

  /** Run twice daily at specific hours */
  twiceDaily(hour1: number = 1, hour2: number = 13): this {
    return this.cron(`0 ${hour1},${hour2} * * *`);
  }

  /** Run every week (Sunday at midnight) */
  weekly(): this {
    return this.cron('0 0 * * 0');
  }

  /** Run on a specific day and time */
  weeklyOn(day: number, time: string = '00:00'): this {
    const { hour, minute } = scheduleTime(time);
    return this.cron(`${minute} ${hour} * * ${day}`);
  }

  /** Run on weekdays (Mon-Fri) */
  weekdays(): this {
    return this.cron(`${this._expression.trim().split(/\s+/).slice(0, 4).join(' ')} 1-5`);
  }

  /** Run on weekends (Sat-Sun) */
  weekends(): this {
    return this.cron(`${this._expression.trim().split(/\s+/).slice(0, 4).join(' ')} 0,6`);
  }

  /** Run monthly (1st at midnight) */
  monthly(): this {
    return this.cron('0 0 1 * *');
  }

  /** Run monthly on a specific day and time */
  monthlyOn(day: number, time: string = '00:00'): this {
    const { hour, minute } = scheduleTime(time);
    return this.cron(`${minute} ${hour} ${day} * *`);
  }

  /** Run quarterly (1st of Jan, Apr, Jul, Oct) */
  quarterly(): this {
    return this.cron('0 0 1 1,4,7,10 *');
  }

  /** Run yearly (Jan 1st at midnight) */
  yearly(): this {
    return this.cron('0 0 1 1 *');
  }

  /** Set a custom cron expression */
  cron(expression: string): this {
    parseCron(expression);
    this._expression = expression;
    return this;
  }

  /** Interpret this task's schedule in an explicit timezone. Defaults to system time. */
  timezone(timezone: string): this {
    validateTimezone(timezone);
    this._timezone = timezone;
    return this;
  }

  /** Prevent overlapping execution (uses distributed lock across processes) */
  preventOverlap(): this {
    this.withoutOverlapping = true;
    return this;
  }

  /** Set the distributed lock TTL (default: 5 minutes). If a task takes longer, increase this. */
  lockExpiresAfter(minutes: number): this {
    this._lockTtlMinutes = minutes;
    return this;
  }

  // ── Internal ───────────────────────────────────────────

  /** @internal */
  getExpression(): string {
    this.schedule(); // ensure schedule() has been called
    parseCron(this._expression);
    return this._expression;
  }

  getTimezone(): string | undefined {
    this.schedule();
    return this._timezone;
  }

  /** @internal */
  isRunning(): boolean {
    return this._running;
  }

  /** @internal */
  usesDistributedLock(): boolean {
    this.schedule();
    return this.withoutOverlapping;
  }

  /** @internal */
  async executeTask(): Promise<TaskResult> {
    // Fast-path: local in-memory overlap check
    if (this.withoutOverlapping && this._running) {
      return { task: this.name, success: true, skipped: true, duration: 0, timestamp: new Date() };
    }

    const start = Date.now();
    let lockAcquired = false;

    // Mark running before any awaited lock work so concurrent calls in this
    // process cannot both pass the local overlap gate.
    this._running = true;

    try {
      // Distributed lock: acquire before running if preventOverlap is enabled
      if (this.withoutOverlapping) {
        try {
          const { SchedulerLock } = await import('./SchedulerLock.js');
          lockAcquired = await SchedulerLock.acquire(this.name, this._lockTtlMinutes);
          if (!lockAcquired) {
            return { task: this.name, success: true, skipped: true, duration: 0, timestamp: new Date() };
          }
        } catch (error: any) {
          await this.onFailure(error);

          return {
            task: this.name,
            success: false,
            duration: Date.now() - start,
            error: error?.message ?? String(error),
            timestamp: new Date(),
          };
        }
      }

      await this.handle();
      const duration = Date.now() - start;

      await this.onSuccess();

      return {
        task: this.name,
        success: true,
        duration,
        timestamp: new Date(),
      };
    } catch (error: any) {
      const duration = Date.now() - start;

      await this.onFailure(error);

      return {
        task: this.name,
        success: false,
        duration,
        error: error?.message ?? String(error),
        timestamp: new Date(),
      };
    } finally {
      this._running = false;
      if (lockAcquired) {
        try {
          const { SchedulerLock } = await import('./SchedulerLock.js');
          await SchedulerLock.release(this.name);
        } catch { /* TTL will handle cleanup */ }
      }
    }
  }
}

// ── Scheduler ──────────────────────────────────────────────

export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private history: TaskResult[] = [];
  private maxHistory = 100;
  private _persistToDb = false;
  private _persistTaskSettings = false;
  private runtimeStatus: SchedulerRuntimeStatus = {
    running: false,
    lastTickAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    failures: 0,
  };

  /**
   * Enable database persistence for task run history.
   * Requires the `scheduled_task_runs` table to exist.
   */
  persistToDatabase(): this {
    this._persistToDb = true;
    return this;
  }

  /**
   * Read persistent enable/disable task controls from `scheduled_task_settings`.
   * Use this in the scheduler process when web/admin processes toggle tasks.
   */
  persistTaskSettings(): this {
    this._persistTaskSettings = true;
    return this;
  }

  /**
   * Register a scheduled task
   */
  register(task: ScheduledTask): this {
    task.getExpression();
    this.tasks.push(task);
    return this;
  }

  /**
   * Register multiple tasks
   */
  registerMany(tasks: ScheduledTask[]): this {
    for (const task of tasks) {
      this.register(task);
    }
    return this;
  }

  /**
   * Run all due tasks (call this every minute)
   */
  async run(now?: Date): Promise<TaskResult[]> {
    const date = now ?? new Date();
    const results: TaskResult[] = [];

    for (const task of this.tasks) {
      const expression = task.getExpression();
      if (cronMatches(expression, date, task.getTimezone()) && await this.isTaskEnabled(task.name)) {
        const result = await task.executeTask();
        results.push(result);
        if (!result.skipped) await this.addToHistory(result);
      }
    }

    return results;
  }

  /**
   * Start the scheduler, aligned to the top of each minute like crontab.
   */
  start(): void {
    if (this.timer) return;
    this.runtimeStatus.running = true;

    // Run immediately for the current minute
    void this.runTick();

    // Wait until the next minute boundary, then tick every 60s
    const now = Date.now();
    const msUntilNextMinute = 60_000 - (now % 60_000);

    this.timer = setTimeout(() => {
      void this.runTick();
      this.timer = setInterval(() => {
        void this.runTick();
      }, 60_000);
    }, msUntilNextMinute);

    console.log(`[Scheduler] Started with ${this.tasks.length} task(s). Next tick in ${Math.round(msUntilNextMinute / 1000)}s.`);
  }

  /**
   * Stop the scheduler and release all distributed locks held by this process.
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer as any);
      clearInterval(this.timer as any);
      this.timer = null;
    }
    this.runtimeStatus.running = false;

    if (this.tasks.some((task) => task.usesDistributedLock())) {
      const { SchedulerLock } = await import('./SchedulerLock.js');
      await SchedulerLock.releaseAll();
    }

    console.log('[Scheduler] Stopped.');
  }

  /**
   * Get runtime ticker status for health checks and dashboards.
   */
  getRuntimeStatus(): SchedulerRuntimeStatus {
    return { ...this.runtimeStatus };
  }

  /**
   * Get all registered tasks
   */
  getTasks(): ScheduledTask[] {
    return [...this.tasks];
  }

  /**
   * Get task execution history (in-memory)
   */
  getHistory(): TaskResult[] {
    return [...this.history];
  }

  /**
   * Check which tasks are due right now
   */
  dueTasks(now?: Date): ScheduledTask[] {
    const date = now ?? new Date();
    return this.tasks.filter((task) => cronMatches(task.getExpression(), date, task.getTimezone()));
  }

  /**
   * Remove a task by name
   */
  remove(name: string): boolean {
    const index = this.tasks.findIndex((t) => t.name === name);
    if (index !== -1) {
      this.tasks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all tasks
   */
  clear(): void {
    this.tasks = [];
  }

  private async addToHistory(result: TaskResult): Promise<void> {
    this.history.push(result);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    if (this._persistToDb) {
      await this.persistResult(result);
    }
  }

  private async persistResult(result: TaskResult): Promise<void> {
    await new QueryBuilder('scheduled_task_runs').insert({
      task: result.task,
      success: result.success,
      duration: result.duration,
      error: result.error || null,
      ran_at: result.timestamp.toISOString(),
    });
  }

  private async isTaskEnabled(taskName: string): Promise<boolean> {
    if (!this._persistTaskSettings) return true;

    const row = await new QueryBuilder('scheduled_task_settings')
      .select('enabled')
      .where('task', taskName)
      .first();

    return row ? !!row.enabled : true;
  }

  private async runTick(): Promise<void> {
    const tickAt = new Date();
    this.runtimeStatus.lastTickAt = tickAt;

    try {
      await this.run(tickAt);
      this.runtimeStatus.lastSuccessAt = new Date();
      this.runtimeStatus.lastErrorAt = null;
      this.runtimeStatus.lastError = null;
      this.runtimeStatus.failures = 0;
    } catch (error: any) {
      this.runtimeStatus.lastErrorAt = new Date();
      this.runtimeStatus.lastError = error?.message ?? String(error);
      this.runtimeStatus.failures += 1;
    }
  }
}

// ── Helper: Inline Scheduled Task ──────────────────────────

/**
 * Create a scheduled task from a simple function
 */
export function task(
  name: string,
  handler: () => Promise<void>,
  scheduleConfig?: (task: ScheduledTask) => void,
): ScheduledTask {
  class InlineTask extends ScheduledTask {
    name = name;

    schedule(): this {
      if (scheduleConfig) scheduleConfig(this);
      return this;
    }

    async handle(): Promise<void> {
      return handler();
    }
  }

  return new InlineTask();
}

// ── Export cron helpers for direct use ──────────────────────

export { parseCron, cronMatches };
export { SchedulerLock } from './SchedulerLock.js';
