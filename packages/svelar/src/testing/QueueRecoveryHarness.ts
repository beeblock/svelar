import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueueJobSnapshot, QueueMonitoringAdapter, QueueTimelineEvent } from '../queue/Monitoring.js';
import { runWithContext, type TestApplicationContext } from './context.js';

export interface QueueRecoveryHarnessTarget {
  readonly adapter: QueueMonitoringAdapter;
  /** Caller owns this isolated consumer and must honor startup/shutdown cancellation. */
  start(signal: AbortSignal): void | Promise<void>;
  stop(signal: AbortSignal): void | Promise<void>;
  kill(signal: AbortSignal): void | Promise<void>;
}
export interface QueueRecoveryHarnessOptions {
  context?: TestApplicationContext;
  timeoutMs?: number;
  scopeTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  pollIntervalMs?: number;
  maxOperations?: number;
  signal?: AbortSignal;
}
export interface QueueRecoveryExpectation {
  status?: QueueJobSnapshot['status'];
  lock?: QueueJobSnapshot['lock']['state'];
  stalledCountAtLeast?: number;
  attemptsAtLeast?: number;
  attemptsStartedAtLeast?: number;
}

function integer(value: number, name: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new RangeError(`Queue recovery ${name} must be 1..${max}.`);
  return value;
}
function reason(signal: AbortSignal): unknown { return signal.reason ?? new Error('Queue recovery aborted.'); }
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(reason(signal)); return; }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(reason(signal)); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Real consumer acceptance harness: configuration, migrations and native resource ownership remain caller-owned. */
export class QueueRecoveryHarness {
  readonly adapter: QueueMonitoringAdapter;
  private readonly scopes = new AsyncLocalStorage<symbol>();
  private readonly timeoutMs: number;
  private readonly scopeTimeoutMs: number;
  private readonly cleanupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxOperations: number;
  private readonly context: TestApplicationContext;
  private token?: symbol;
  private controller?: AbortController;
  private accepting = false;
  private ownsConsumer = false;
  private lifecyclePending = false;
  private operations = 0;
  private pending = new Set<Promise<unknown>>();

  constructor(private readonly target: QueueRecoveryHarnessTarget, private readonly options: QueueRecoveryHarnessOptions = {}) {
    if (!target?.adapter || !target.adapter.capabilities.shared || !['redis', 'database'].includes(target.adapter.driver)) {
      throw new TypeError('Queue recovery requires a public shared Redis/database adapter.');
    }
    for (const name of ['start', 'stop', 'kill'] as const) if (typeof target[name] !== 'function') throw new TypeError(`Queue recovery target requires ${name}.`);
    this.adapter = target.adapter;
    this.timeoutMs = integer(options.timeoutMs ?? 10_000, 'timeoutMs', 120_000);
    this.scopeTimeoutMs = integer(options.scopeTimeoutMs ?? 30_000, 'scopeTimeoutMs', 300_000);
    this.cleanupTimeoutMs = integer(options.cleanupTimeoutMs ?? 5000, 'cleanupTimeoutMs', 30_000);
    this.pollIntervalMs = integer(options.pollIntervalMs ?? 25, 'pollIntervalMs', 1000);
    this.maxOperations = integer(options.maxOperations ?? 1000, 'maxOperations', 10_000);
    this.context = { ...options.context };
  }

  private async timed<T>(callback: (signal: AbortSignal) => T | Promise<T>, timeout: number, parent?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const forward = () => controller.abort(parent ? reason(parent) : new Error('Queue recovery aborted.'));
    if (parent?.aborted) forward(); else parent?.addEventListener('abort', forward, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`Queue recovery timed out after ${timeout}ms.`)), timeout);
    let abort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(reason(controller.signal));
      if (controller.signal.aborted) abort(); else controller.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const operation = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw reason(controller.signal);
        return runWithContext(this.context, () => callback(controller.signal));
      });
      return await Promise.race([operation, aborted]);
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener('abort', forward);
      controller.signal.removeEventListener('abort', abort);
    }
  }

  async run<T>(callback: (harness: this) => T | Promise<T>): Promise<T> {
    if (this.token) throw new Error('This queue recovery harness already has an active scope.');
    if (this.ownsConsumer) throw new Error('The previous queue consumer cleanup failed; recover its owned resources before reusing the harness.');
    if (typeof callback !== 'function') throw new TypeError('Queue recovery requires a callback.');
    const token = Symbol('svelar.queueRecovery');
    this.token = token;
    this.controller = new AbortController();
    this.accepting = true;
    this.operations = 0;
    const errors: unknown[] = [];
    let result: T | undefined;
    try {
      result = await this.timed(signal => {
        const forward = () => this.controller?.abort(reason(signal));
        if (signal.aborted) forward(); else signal.addEventListener('abort', forward, { once: true });
        return Promise.resolve(this.scopes.run(token, () => callback(this)))
          .finally(() => signal.removeEventListener('abort', forward));
      }, this.scopeTimeoutMs, this.options.signal);
    } catch (error) { errors.push(error); }
    finally {
      this.accepting = false;
      if (this.pending.size && errors.length === 0) errors.push(new Error('Await every queue recovery operation before returning from its callback.'));
      this.controller.abort(new Error('Queue recovery scope closed.'));
      await Promise.allSettled([...this.pending]);
      // Cleanup gets a fresh signal, even if the scenario timed out or its caller aborted.
      if (this.ownsConsumer) {
        try { await this.timed(signal => this.target.stop(signal), this.cleanupTimeoutMs); this.ownsConsumer = false; }
        catch (error) {
          errors.push(error);
          try { await this.timed(signal => this.target.kill(signal), this.cleanupTimeoutMs); this.ownsConsumer = false; }
          catch (failure) { errors.push(failure); }
        }
      }
      this.token = undefined;
      this.controller = undefined;
      this.lifecyclePending = false;
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Queue recovery scenario or consumer cleanup failed.');
    return result as T;
  }

  private operation<T>(callback: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
    if (!this.accepting || !this.token || this.scopes.getStore() !== this.token) return Promise.reject(new Error('Queue recovery operations require their active callback.'));
    if (this.operations++ >= this.maxOperations) return Promise.reject(new Error('Queue recovery operation limit exceeded.'));
    const pending = this.timed(callback, this.timeoutMs, this.controller!.signal);
    this.pending.add(pending);
    void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending));
    return pending;
  }

  private lifecycle(action: 'start' | 'stop' | 'kill'): Promise<void> {
    return this.operation(async signal => {
      if (this.lifecyclePending) throw new Error('Await the previous queue consumer lifecycle operation.');
      if (action === 'start' && this.ownsConsumer) throw new Error('Stop or kill the owned consumer before restarting.');
      if (action !== 'start' && !this.ownsConsumer) throw new Error('No queue consumer is owned by this scope.');
      this.lifecyclePending = true;
      const token = this.token;
      if (action === 'start') this.ownsConsumer = true;
      try {
        await this.target[action](signal);
        if (action !== 'start' && this.token === token && !signal.aborted) this.ownsConsumer = false;
      } finally { if (this.token === token) this.lifecyclePending = false; }
    });
  }
  start(): Promise<void> { return this.lifecycle('start'); }
  stop(): Promise<void> { return this.lifecycle('stop'); }
  kill(): Promise<void> { return this.lifecycle('kill'); }

  private id(id: string): void {
    if (typeof id !== 'string' || !id || id.length > 256 || id.includes('\0')) throw new TypeError('Queue recovery requires a bounded job id.');
  }
  get(id: string): Promise<QueueJobSnapshot | null> { this.id(id); return this.operation(() => this.adapter.get(id)); }

  waitForJob(id: string, expected: QueueRecoveryExpectation = {}): Promise<QueueJobSnapshot> {
    this.id(id);
    if (expected.status !== undefined && !['waiting', 'active', 'completed', 'failed', 'delayed'].includes(expected.status)
      || expected.lock !== undefined && !['observed', 'expired', 'none', 'unknown'].includes(expected.lock)) throw new TypeError('Invalid queue recovery expectation.');
    for (const field of ['stalledCountAtLeast', 'attemptsAtLeast', 'attemptsStartedAtLeast'] as const) {
      if (expected[field] !== undefined && (!Number.isSafeInteger(expected[field]) || expected[field]! < 0)) throw new TypeError('Queue recovery counters must be non-negative safe integers.');
    }
    return this.operation(async signal => {
      while (!signal.aborted) {
        const job = await this.adapter.get(id);
        if (job && (expected.status === undefined || job.status === expected.status) && (expected.lock === undefined || job.lock.state === expected.lock)
          && (expected.stalledCountAtLeast === undefined || job.stalledCount >= expected.stalledCountAtLeast)
          && (expected.attemptsAtLeast === undefined || job.attempts >= expected.attemptsAtLeast)
          && (expected.attemptsStartedAtLeast === undefined || job.attemptsStarted !== undefined && job.attemptsStarted >= expected.attemptsStartedAtLeast)) return job;
        await delay(this.pollIntervalMs, signal);
      }
      throw reason(signal);
    });
  }
  /** SQL queues normally remove successful rows; do not fabricate a retained completed snapshot. */
  waitForMissing(id: string): Promise<void> {
    this.id(id);
    return this.operation(async signal => {
      while (!signal.aborted) {
        if (await this.adapter.get(id) === null) return;
        await delay(this.pollIntervalMs, signal);
      }
      throw reason(signal);
    });
  }
  recover(): Promise<number> {
    return this.operation(() => {
      if (this.adapter.driver !== 'database') throw new Error('Native Redis workers own stalled recovery; start a replacement consumer.');
      return this.adapter.recover();
    });
  }
  timeline(id: string, limit = 100): Promise<QueueTimelineEvent[]> {
    this.id(id); integer(limit, 'timeline limit', 1000);
    return this.operation(() => this.adapter.timeline({ id, source: 'live' }, limit));
  }
}

export function withQueueRecovery<T>(target: QueueRecoveryHarnessTarget, callback: (harness: QueueRecoveryHarness) => T | Promise<T>, options: QueueRecoveryHarnessOptions = {}): Promise<T> {
  return new QueueRecoveryHarness(target, options).run(callback);
}
