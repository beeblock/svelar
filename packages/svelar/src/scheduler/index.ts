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

// ── Cron Expression Parser ─────────────────────────────────

interface CronFields {
  minute: number[] | null;    // 0-59
  hour: number[] | null;      // 0-23
  dayOfMonth: number[] | null; // 1-31
  month: number[] | null;     // 1-12
  dayOfWeek: number[] | null;  // 0-6 (Sun=0)
}

function parseCronField(field: string, min: number, max: number): number[] | null {
  if (field === '*') return null; // matches all

  const values = new Set<number>();

  for (const part of field.split(',')) {
    // Handle step: */5 or 1-10/2
    const [rangePart, stepStr] = part.split('/');
    const step = stepStr ? parseInt(stepStr, 10) : 1;

    if (rangePart === '*') {
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (rangePart.includes('-')) {
      const [startStr, endStr] = rangePart.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      for (let i = start; i <= end; i += step) values.add(i);
    } else {
      values.add(parseInt(rangePart, 10));
    }
  }

  return [...values].sort((a, b) => a - b);
}

function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${expression}". Expected 5 fields.`);
  }

  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dayOfMonth: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    dayOfWeek: parseCronField(parts[4], 0, 6),
  };
}

function cronMatches(expression: string, date: Date): boolean {
  const fields = parseCron(expression);

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();

  if (fields.minute && !fields.minute.includes(minute)) return false;
  if (fields.hour && !fields.hour.includes(hour)) return false;
  if (fields.dayOfMonth && !fields.dayOfMonth.includes(dayOfMonth)) return false;
  if (fields.month && !fields.month.includes(month)) return false;
  if (fields.dayOfWeek && !fields.dayOfWeek.includes(dayOfWeek)) return false;

  return true;
}

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
    this._expression = '* * * * *';
    return this;
  }

  /** Run every N minutes */
  everyMinutes(n: number): this {
    this._expression = `*/${n} * * * *`;
    return this;
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
    this._expression = '0 * * * *';
    return this;
  }

  /** Run every hour at a specific minute */
  hourlyAt(minute: number): this {
    this._expression = `${minute} * * * *`;
    return this;
  }

  /** Run every day at midnight */
  daily(): this {
    this._expression = '0 0 * * *';
    return this;
  }

  /** Run every day at a specific time (HH:MM) */
  dailyAt(time: string): this {
    const [hour, minute] = time.split(':').map(Number);
    this._expression = `${minute ?? 0} ${hour} * * *`;
    return this;
  }

  /** Run twice daily at specific hours */
  twiceDaily(hour1: number = 1, hour2: number = 13): this {
    this._expression = `0 ${hour1},${hour2} * * *`;
    return this;
  }

  /** Run every week (Sunday at midnight) */
  weekly(): this {
    this._expression = '0 0 * * 0';
    return this;
  }

  /** Run on a specific day and time */
  weeklyOn(day: number, time: string = '00:00'): this {
    const [hour, minute] = time.split(':').map(Number);
    this._expression = `${minute ?? 0} ${hour} * * ${day}`;
    return this;
  }

  /** Run on weekdays (Mon-Fri) */
  weekdays(): this {
    this._expression = `${this._expression.split(' ').slice(0, 4).join(' ')} 1-5`;
    return this;
  }

  /** Run on weekends (Sat-Sun) */
  weekends(): this {
    this._expression = `${this._expression.split(' ').slice(0, 4).join(' ')} 0,6`;
    return this;
  }

  /** Run monthly (1st at midnight) */
  monthly(): this {
    this._expression = '0 0 1 * *';
    return this;
  }

  /** Run monthly on a specific day and time */
  monthlyOn(day: number, time: string = '00:00'): this {
    const [hour, minute] = time.split(':').map(Number);
    this._expression = `${minute ?? 0} ${hour} ${day} * *`;
    return this;
  }

  /** Run quarterly (1st of Jan, Apr, Jul, Oct) */
  quarterly(): this {
    this._expression = '0 0 1 1,4,7,10 *';
    return this;
  }

  /** Run yearly (Jan 1st at midnight) */
  yearly(): this {
    this._expression = '0 0 1 1 *';
    return this;
  }

  /** Set a custom cron expression */
  cron(expression: string): this {
    this._expression = expression;
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
    return this._expression;
  }

  /** @internal */
  isRunning(): boolean {
    return this._running;
  }

  /** @internal */
  async executeTask(): Promise<TaskResult> {
    // Fast-path: local in-memory overlap check
    if (this.withoutOverlapping && this._running) {
      return { task: this.name, success: true, duration: 0, timestamp: new Date() };
    }

    // Distributed lock: acquire before running if preventOverlap is enabled
    let lockAcquired = false;
    if (this.withoutOverlapping) {
      try {
        const { SchedulerLock } = await import('./SchedulerLock.js');
        lockAcquired = await SchedulerLock.acquire(this.name, this._lockTtlMinutes);
        if (!lockAcquired) {
          return { task: this.name, success: true, duration: 0, timestamp: new Date() };
        }
      } catch {
        // Database not available — fall back to local-only overlap check
      }
    }

    this._running = true;
    const start = Date.now();

    try {
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
        error: error.message,
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

  /**
   * Enable database persistence for task run history.
   * Requires the `scheduled_task_runs` table to exist.
   */
  persistToDatabase(): this {
    this._persistToDb = true;
    return this;
  }

  /**
   * Register a scheduled task
   */
  register(task: ScheduledTask): this {
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
      if (cronMatches(expression, date)) {
        const result = await task.executeTask();
        results.push(result);
        this.addToHistory(result);
      }
    }

    return results;
  }

  /**
   * Start the scheduler, aligned to the top of each minute like crontab.
   */
  start(): void {
    if (this.timer) return;

    // Run immediately for the current minute
    this.run().catch((err) => console.error('[Scheduler] Error:', err));

    // Wait until the next minute boundary, then tick every 60s
    const now = Date.now();
    const msUntilNextMinute = 60_000 - (now % 60_000);

    this.timer = setTimeout(() => {
      this.run().catch((err) => console.error('[Scheduler] Error:', err));
      this.timer = setInterval(() => {
        this.run().catch((err) => console.error('[Scheduler] Error:', err));
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

    // Release all distributed locks held by this process
    try {
      const { SchedulerLock } = await import('./SchedulerLock.js');
      await SchedulerLock.releaseAll();
    } catch { /* best-effort */ }

    console.log('[Scheduler] Stopped.');
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
    return this.tasks.filter((task) => cronMatches(task.getExpression(), date));
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

  private addToHistory(result: TaskResult): void {
    this.history.push(result);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    if (this._persistToDb) {
      this.persistResult(result).catch(() => {});
    }
  }

  private async persistResult(result: TaskResult): Promise<void> {
    try {
      await new QueryBuilder('scheduled_task_runs').insert({
        task: result.task,
        success: result.success ? 1 : 0,
        duration: result.duration,
        error: result.error || null,
        ran_at: result.timestamp.toISOString(),
      });
    } catch {
      // Database not available — silently skip
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
