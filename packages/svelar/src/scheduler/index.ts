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
import { randomUUID } from 'node:crypto';
import { ApplicationContext } from '../support/Context.js';
import { cronMatches, nextCronDate, parseCron, scheduleTime, validateTimezone } from './cron.js';
import { SchedulerLock, SchedulerLeaseLostError } from './SchedulerLock.js';
import { SchedulerRuntimeStore, schedulerTaskKey, schedulerTenantId, validateMissedRun, type MissedRunPolicy, type SchedulerScope, type SchedulerTaskSettings, type SchedulerRunRequest } from './RuntimeStore.js';

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
  tenantId?: string | null;
  scheduledFor?: Date;
  requestId?: string;
}

export interface TaskExecutionContext {
  signal: AbortSignal;
  tenantId: string | null;
  scheduledFor?: Date;
  requestId?: string;
}

export interface TaskExecutionOptions {
  lockKey?: string;
  connectionName?: string;
  signal?: AbortSignal;
  tenantId?: string | null;
  scheduledFor?: Date;
  requestId?: string;
  /** Internal: a persistent scheduler already holds the invocation lease. */
  leased?: boolean;
}

export interface SchedulerOptions extends SchedulerScope {
  connectionName?: string;
  persistent?: boolean;
  heartbeatMilliseconds?: number;
  requestBatchSize?: number;
}

export interface SchedulerRuntimeStatus {
  running: boolean;
  lastTickAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  failures: number;
  draining?: boolean;
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
  private _missedRun: MissedRunPolicy = { policy: 'skip', windowMinutes: 60, maxRuns: 10 };

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
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10080) throw new Error('Invalid scheduler lease duration.');
    this._lockTtlMinutes = minutes;
    return this;
  }

  missedRuns(policy: MissedRunPolicy['policy'], options: { windowMinutes?: number; maxRuns?: number } = {}): this {
    const value = { policy, windowMinutes: options.windowMinutes ?? 60, maxRuns: options.maxRuns ?? 10 };
    validateMissedRun(value);
    this._missedRun = value;
    return this;
  }

  getMissedRunPolicy(): MissedRunPolicy { this.schedule(); return { ...this._missedRun }; }
  getLockTtlMinutes(): number { this.schedule(); return this._lockTtlMinutes; }
  getExecutionContext(): TaskExecutionContext | null { return ApplicationContext.get<TaskExecutionContext>('scheduler') ?? null; }

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
  async executeTask(options: TaskExecutionOptions = {}): Promise<TaskResult> {
    this.getExpression();
    // Fast-path: local in-memory overlap check
    if (this.withoutOverlapping && this._running) {
      return { task: this.name, success: true, skipped: true, duration: 0, timestamp: new Date() };
    }

    const start = Date.now();
    let failureNotified = false;
    const fail = async (error: unknown): Promise<TaskResult> => {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (!failureNotified) { failureNotified = true; await this.onFailure(failure); }
      return { task: this.name, success: false, duration: Date.now() - start, error: failure.message, timestamp: new Date(),
        tenantId: options.tenantId, scheduledFor: options.scheduledFor, requestId: options.requestId };
    };

    // Mark running before any awaited lock work so concurrent calls in this
    // process cannot both pass the local overlap gate.
    this._running = true;

    try {
      const execute = async (signal: AbortSignal): Promise<TaskResult> => {
        const context: TaskExecutionContext = { signal, tenantId: options.tenantId ?? null, scheduledFor: options.scheduledFor, requestId: options.requestId };
        return ApplicationContext.run({ scheduler: context }, async () => {
          try {
            signal.throwIfAborted();
            await this.handle();
            signal.throwIfAborted();
            await this.onSuccess();
            return {
              task: this.name, success: true, duration: Date.now() - start, timestamp: new Date(),
              tenantId: context.tenantId, scheduledFor: context.scheduledFor, requestId: context.requestId,
            };
          } catch (error) { return fail(error); }
        });
      };
      if (this.withoutOverlapping && !options.leased) {
        const lease = await SchedulerLock.acquireLease(options.lockKey ?? this.name, this._lockTtlMinutes, options.connectionName);
        if (!lease) return { task: this.name, success: true, skipped: true, duration: 0, timestamp: new Date() };
        return await lease.run(execute);
      }
      return await execute(options.signal ?? new AbortController().signal);
    } catch (error) { return fail(error); }
    finally {
      this._running = false;
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
  private _persistRuntime = false;
  private readonly store: SchedulerRuntimeStore;
  private readonly options: SchedulerOptions;
  private readonly owner = `${SchedulerLock.getOwnerId()}:${randomUUID()}`;
  private readonly startedAt = Date.now();
  private activeRuns = new Set<Promise<TaskResult[]>>();
  private accepting = true;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatWork: Promise<void> | null = null;
  private stopWork: Promise<void> | null = null;
  private ticking = false;
  private runtimeStatus: SchedulerRuntimeStatus = {
    running: false,
    lastTickAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    failures: 0,
  };

  constructor(options: SchedulerOptions = {}) {
    this.options = { heartbeatMilliseconds: 5000, requestBatchSize: 20, ...options };
    if (!Number.isInteger(this.options.heartbeatMilliseconds) || this.options.heartbeatMilliseconds! < 10 || this.options.heartbeatMilliseconds! > 60000
      || !Number.isInteger(this.options.requestBatchSize) || this.options.requestBatchSize! < 1 || this.options.requestBatchSize! > 100) throw new Error('Invalid scheduler runtime bounds.');
    this.store = new SchedulerRuntimeStore(options, options.connectionName);
    if (options.persistent || schedulerTenantId(options) !== null) this.persistRuntimeToDatabase();
  }

  /** Requires settings policy, runtime, requests, locks and history core migrations. */
  persistRuntimeToDatabase(): this {
    this._persistRuntime = true;
    this._persistToDb = true;
    this._persistTaskSettings = true;
    return this;
  }

  hasPersistentRuntime(): boolean { return this._persistRuntime; }
  getScope(): SchedulerScope { return { ...this.store.scope }; }
  getRuntimeStore(): SchedulerRuntimeStore { return this.store; }
  getHeartbeatMilliseconds(): number { return this.options.heartbeatMilliseconds!; }

  async configureTask(name: string, settings: SchedulerTaskSettings): Promise<void> {
    this.requireTask(name);
    if (!this._persistRuntime) throw new Error('Persistent scheduler runtime is not enabled.');
    await this.store.setSettings(name, settings);
  }

  async requestRun(name: string): Promise<SchedulerRunRequest> {
    this.requireTask(name);
    if (!this._persistRuntime) throw new Error('Persistent scheduler runtime is not enabled.');
    if ((await this.store.settings(name))?.enabled === false) throw new Error(`Task "${name}" is disabled`);
    return this.store.enqueue(name, ApplicationContext.get('userId'), ApplicationContext.get('correlationId'));
  }

  async getRunRequest(name: string, id: string): Promise<SchedulerRunRequest | null> {
    this.requireTask(name);
    return this.store.request(name, id);
  }

  async cancelRunRequest(name: string, id: string): Promise<boolean> {
    this.requireTask(name);
    return this.store.cancelRequest(name, id);
  }

  private requireTask(name: string): ScheduledTask {
    const task = this.tasks.find((value) => value.name === name);
    if (!task) throw new Error(`Task "${name}" not found`);
    return task;
  }

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
    schedulerTaskKey(task.name, this.store.scope);
    if (this.tasks.some((registered) => registered.name === task.name)) throw new Error(`Duplicate scheduler task "${task.name}".`);
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
    if (!this.accepting) return [];
    const date = now ?? new Date();
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid scheduler date.');
    const work = Promise.resolve().then(() => this.performRun(date));
    this.activeRuns.add(work);
    try { return await work; }
    finally { this.activeRuns.delete(work); }
  }

  private async performRun(date: Date): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    this.runtimeStatus.lastTickAt = date;
    if (this._persistRuntime) await this.writeHeartbeat();

    for (const task of this.tasks) {
      if (!this.accepting) break;
      if (this._persistRuntime) {
        results.push(...await this.runPersistentTask(task, date));
        continue;
      }
      const expression = task.getExpression();
      if (cronMatches(expression, date, task.getTimezone()) && await this.isTaskEnabled(task.name)) {
        const result = await ApplicationContext.runIsolated({ teamId: schedulerTenantId(this.store.scope) }, () => task.executeTask());
        results.push(result);
        if (!result.skipped) await this.addToHistory(result);
      }
    }

    return results;
  }

  private async runPersistentTask(task: ScheduledTask, date: Date): Promise<TaskResult[]> {
    const lease = await SchedulerLock.acquireLease(this.store.key(task.name), task.getLockTtlMinutes(), this.options.connectionName);
    if (!lease) return [{ task: task.name, success: true, skipped: true, duration: 0, timestamp: new Date() }];
    let activeRequest: string | null = null;
    const results: TaskResult[] = [];
    try {
      await this.store.ensureTask(task.name);
      await this.store.updateTask(task.name, { owner: lease.owner, lease_until: lease.expiresAt, heartbeat_at: Date.now() });
      return await lease.run(async (signal) => {
        const setting = await this.store.settings(task.name);
        const timezone = setting?.timezone ?? this.store.scope.timezone ?? task.getTimezone();
        const minute = Math.floor(date.getTime() / 60000) * 60000;
        const next = nextCronDate(task.getExpression(), new Date(minute), timezone).getTime();
        if (setting?.enabled === false) {
          await this.store.updateTask(task.name, { last_checked_at: minute, next_run_at: null, state: 'disabled' }, lease.owner);
          return results;
        }
        const runtime = (await this.store.task(task.name))!;
        const policy = setting?.missedRun ?? task.getMissedRunPolicy();
        const slots = this.dueSlots(task, minute, runtime.last_checked_at === null ? null : Number(runtime.last_checked_at), timezone, policy);
        const execute = async (scheduledFor?: Date, requestId?: string, actor?: string | null, correlationId?: string | null) => {
          signal.throwIfAborted();
          await lease.renew();
          if (requestId && !await this.store.renewRequest(task.name, requestId, lease.owner, lease.expiresAt)) throw new SchedulerLeaseLostError();
          await this.store.updateTask(task.name, { state: 'running', started_at: Date.now(), heartbeat_at: Date.now(), lease_until: lease.expiresAt, next_run_at: next }, lease.owner);
          const tenantId = schedulerTenantId(this.store.scope);
          const result = await ApplicationContext.runIsolated({ teamId: tenantId, userId: actor ?? null, correlationId: correlationId ?? null }, () => task.executeTask({
            leased: true, signal, tenantId, scheduledFor, requestId,
          }));
          signal.throwIfAborted();
          await lease.renew();
          if (requestId && !await this.store.renewRequest(task.name, requestId, lease.owner, lease.expiresAt)) throw new SchedulerLeaseLostError();
          results.push(result);
          if (!result.skipped) await this.addToHistory(result);
          if (!await this.store.updateTask(task.name, {
            state: result.success ? 'succeeded' : 'failed', last_run_at: result.timestamp.getTime(),
            last_duration: result.duration, last_error: result.error ?? null, heartbeat_at: Date.now(), lease_until: lease.expiresAt,
          }, lease.owner)) throw new SchedulerLeaseLostError();
          if (requestId && !await this.store.finishRequest(task.name, requestId, lease.owner, result)) throw new SchedulerLeaseLostError();
        };
        for (const slot of slots) {
          if (!this.accepting) break;
          await execute(new Date(slot));
          await this.store.updateTask(task.name, { last_checked_at: slot }, lease.owner);
        }
        if (this.accepting) await this.store.updateTask(task.name, { last_checked_at: Math.max(minute, Number(runtime.last_checked_at ?? minute)), next_run_at: next }, lease.owner);
        for (const request of await this.store.pending(task.name, this.options.requestBatchSize!)) {
          if (!this.accepting) break;
          signal.throwIfAborted();
          if (!await this.store.claim(request, lease.owner, lease.expiresAt)) continue;
          activeRequest = request.id;
          await execute(undefined, request.id, request.requested_by, request.correlation_id);
          activeRequest = null;
        }
        return results;
      }, async () => {
        if (!await this.store.updateTask(task.name, { heartbeat_at: Date.now(), lease_until: lease.expiresAt }, lease.owner)) throw new SchedulerLeaseLostError();
        if (activeRequest && !await this.store.renewRequest(task.name, activeRequest, lease.owner, lease.expiresAt)) throw new SchedulerLeaseLostError();
      });
    } finally {
      await this.store.updateTask(task.name, { owner: null, lease_until: null, heartbeat_at: Date.now() }, lease.owner);
      await lease.release();
    }
  }

  private dueSlots(task: ScheduledTask, minute: number, checked: number | null, timezone: string | undefined, policy: MissedRunPolicy): number[] {
    if (checked !== null && checked >= minute) return [];
    if (checked === null || policy.policy === 'skip') return cronMatches(task.getExpression(), new Date(minute), timezone) ? [minute] : [];
    const slots: number[] = [];
    let cursor = Math.max(checked, minute - policy.windowMinutes * 60000);
    const limit = policy.policy === 'latest' ? 1 : policy.maxRuns;
    for (let scanned = 0; scanned <= policy.windowMinutes; scanned++) {
      cursor = nextCronDate(task.getExpression(), new Date(cursor), timezone).getTime();
      if (cursor > minute) break;
      slots.push(cursor);
      if (slots.length > limit) slots.shift();
    }
    return slots;
  }

  /**
   * Start the scheduler, aligned to the top of each minute like crontab.
   */
  start(): void {
    if (this.timer) return;
    this.accepting = true;
    this.stopWork = null;
    this.runtimeStatus.running = true;
    this.runtimeStatus.draining = false;

    if (this._persistRuntime) {
      this.heartbeatTimer = setInterval(() => {
        if (this.heartbeatWork) return;
        this.heartbeatWork = this.writeHeartbeat().catch((error) => this.recordFailure(error)).finally(() => { this.heartbeatWork = null; });
      }, this.options.heartbeatMilliseconds);
      this.timer = setInterval(() => { void this.runTick(); }, this.options.heartbeatMilliseconds);
      void this.runTick();
      return;
    }

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
    if (this.stopWork) return this.stopWork;
    this.accepting = false;
    this.runtimeStatus.draining = true;
    this.stopWork = this.drain();
    return this.stopWork;
  }

  private async drain(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer as any);
      clearInterval(this.timer as any);
      this.timer = null;
    }
    let heartbeatFailure: unknown;
    if (this._persistRuntime) {
      try { await this.writeHeartbeat(); }
      catch (error) { heartbeatFailure = error; this.recordFailure(error); }
    }
    try {
      await Promise.allSettled([...this.activeRuns]);
    } finally {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      if (this.heartbeatWork) await this.heartbeatWork;
      this.runtimeStatus.running = false;
      this.runtimeStatus.draining = false;
      if (this._persistRuntime) await this.writeHeartbeat('stopped');
    }

    if (!this._persistRuntime && this.tasks.some((task) => task.usesDistributedLock())) {
      await SchedulerLock.releaseAll();
    }
    if (heartbeatFailure) throw heartbeatFailure;

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

  async listTaskStatuses(): Promise<Array<{
    name: string; tenantId: string | null; expression: string; timezone?: string; enabled: boolean;
    nextRun: Date | null; lastRun: Date | null; lastDuration: number | null; lastStatus: string | null;
    isRunning: boolean; lockOwner: string | null; leaseUntil: Date | null; missedRun: MissedRunPolicy;
  }>> {
    const rows = [];
    for (const task of this.tasks) {
      const setting = this._persistRuntime ? await this.store.settings(task.name) : null;
      const runtime = this._persistRuntime ? await this.store.task(task.name) : null;
      const timezone = setting?.timezone ?? this.store.scope.timezone ?? task.getTimezone();
      const enabled = setting?.enabled ?? await this.isTaskEnabled(task.name);
      const leaseUntil = runtime?.lease_until === null || runtime?.lease_until === undefined ? null : new Date(Number(runtime.lease_until));
      rows.push({
        name: task.name, tenantId: schedulerTenantId(this.store.scope), expression: task.getExpression(), timezone, enabled,
        nextRun: enabled ? runtime?.next_run_at === null || runtime?.next_run_at === undefined ? nextCronDate(task.getExpression(), new Date(), timezone) : new Date(Number(runtime.next_run_at)) : null,
        lastRun: runtime?.last_run_at === null || runtime?.last_run_at === undefined ? null : new Date(Number(runtime.last_run_at)),
        lastDuration: runtime?.last_duration ?? null, lastStatus: runtime?.state ?? null,
        isRunning: runtime ? runtime.state === 'running' && !!leaseUntil && leaseUntil.getTime() > Date.now() : task.isRunning(),
        lockOwner: runtime?.owner ?? null, leaseUntil, missedRun: setting?.missedRun ?? task.getMissedRunPolicy(),
      });
    }
    return rows;
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
    await new QueryBuilder('scheduled_task_runs', undefined, this.options.connectionName).insert({
      task: this.store.key(result.task),
      success: result.success,
      duration: result.duration,
      error: result.error || null,
      ran_at: result.timestamp.toISOString(),
    });
  }

  private async isTaskEnabled(taskName: string): Promise<boolean> {
    if (!this._persistTaskSettings) return true;

    const row = await new QueryBuilder('scheduled_task_settings', undefined, this.options.connectionName)
      .select('enabled')
      .where('task', taskName)
      .first();

    return row ? !!row.enabled : true;
  }

  private async runTick(): Promise<void> {
    if (this.ticking || !this.accepting) return;
    this.ticking = true;
    const tickAt = new Date();
    this.runtimeStatus.lastTickAt = tickAt;

    try {
      const results = await this.run(tickAt);
      const failed = results.find((result) => !result.success);
      if (failed) this.recordFailure(new Error(failed.error ?? `Task "${failed.task}" failed`));
      else {
        this.runtimeStatus.lastSuccessAt = new Date();
        this.runtimeStatus.lastErrorAt = null;
        this.runtimeStatus.lastError = null;
        this.runtimeStatus.failures = 0;
      }
    } catch (error: unknown) {
      this.recordFailure(error);
    } finally {
      this.ticking = false;
      if (this._persistRuntime) {
        try { await this.writeHeartbeat(); } catch (error) { this.recordFailure(error); }
      }
    }
  }

  private recordFailure(error: unknown): void {
    this.runtimeStatus.lastErrorAt = new Date();
    this.runtimeStatus.lastError = error instanceof Error ? error.message : String(error);
    this.runtimeStatus.failures += 1;
  }

  private async writeHeartbeat(state?: string): Promise<void> {
    await this.store.process(this.owner, {
      state: state ?? (this.runtimeStatus.draining ? 'draining' : this.runtimeStatus.running || this.activeRuns.size > 0 ? 'running' : 'stopped'),
      started_at: this.startedAt, heartbeat_at: Date.now(),
      last_tick_at: this.runtimeStatus.lastTickAt?.getTime() ?? null,
      last_success_at: this.runtimeStatus.lastSuccessAt?.getTime() ?? null,
      last_error_at: this.runtimeStatus.lastErrorAt?.getTime() ?? null,
      last_error: this.runtimeStatus.lastError, failures: this.runtimeStatus.failures,
    });
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
export { SchedulerRuntimeStore, schedulerTaskKey } from './RuntimeStore.js';
export type { SchedulerScope, SchedulerTaskSettings, SchedulerRunRequest, MissedRunPolicy } from './RuntimeStore.js';
