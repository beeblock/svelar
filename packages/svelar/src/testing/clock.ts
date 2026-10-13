import { AsyncLocalStorage } from 'node:async_hooks';
import { singleton } from '../support/singleton.js';

export interface FakeClockAdapter {
  isFakeTimers(): boolean;
  getMockedSystemTime(): Date | null;
  useFakeTimers(options: { now?: number; loopLimit: number; toFake: ('Date' | 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval' | 'setImmediate' | 'clearImmediate')[] }): unknown;
  useRealTimers(): unknown;
  clearAllTimers(): unknown;
  advanceTimersByTimeAsync(ms: number): Promise<unknown>;
  setSystemTime(time: number): unknown;
  getTimerCount(): number;
  isMockFunction?(value: unknown): boolean;
}

export interface FakeClockOptions {
  /** Pass the public Vitest callback context. Concurrent tests cannot own a process-global clock. */
  testContext: { task: { concurrent?: boolean }; onTestFinished(callback: () => void): void };
  /** Defaults to the existing optional Vitest peer's vi adapter. */
  adapter?: FakeClockAdapter;
  now?: Date | number;
  loopLimit?: number;
}

const state = singleton('svelar.testing.clock', () => ({
  owner: undefined as symbol | undefined,
  scopes: new AsyncLocalStorage<symbol>(),
  original: { Date, dateNow: Date.now, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate },
}));

function timestamp(value: Date | number): number {
  const result = typeof value === 'number' ? value : value instanceof state.original.Date ? value.getTime() : NaN;
  if (!Number.isSafeInteger(result) || Math.abs(result) > 8_640_000_000_000_000) throw new RangeError('Fake clock time must be a valid Date or integer epoch milliseconds.');
  return result;
}

async function adapterFor(options: FakeClockOptions): Promise<FakeClockAdapter> {
  let candidate: unknown = options.adapter;
  if (!candidate) {
    try { candidate = (await import('vitest' as string)).vi; }
    catch { throw new Error('fakeClock requires the optional Vitest peer in a Vitest test, or an explicit compatible vi adapter.'); }
  }
  const methods: (keyof FakeClockAdapter)[] = ['isFakeTimers', 'getMockedSystemTime', 'useFakeTimers', 'useRealTimers', 'clearAllTimers', 'advanceTimersByTimeAsync', 'setSystemTime', 'getTimerCount'];
  if (!candidate || typeof candidate !== 'object' || methods.some((method) => typeof (candidate as Record<string, unknown>)[method] !== 'function')) {
    throw new Error('fakeClock requires a vi adapter with the public fake-timer and mocked-system-time APIs.');
  }
  return candidate as FakeClockAdapter;
}

export class FakeClock {
  private token?: symbol;
  private adapter?: FakeClockAdapter;
  private advancing?: Promise<unknown>;

  constructor(private readonly options: FakeClockOptions) {}

  async run<T>(callback: (clock: this) => T | Promise<T>): Promise<T> {
    if (!this.options.testContext?.task || this.options.testContext.task.concurrent) throw new Error('fakeClock requires a sequential Vitest test context; test.concurrent is unsafe for global timers.');
    if (typeof this.options.testContext.onTestFinished !== 'function') throw new Error('fakeClock requires the public TestContext.onTestFinished cleanup hook.');
    if (typeof callback !== 'function') throw new TypeError('fakeClock requires a callback.');
    if (state.owner || this.token) throw new Error('A fake clock scope is already active; nested and concurrent clock scopes are not supported.');
    const now = this.options.now === undefined ? state.original.dateNow() : timestamp(this.options.now);
    const loopLimit = this.options.loopLimit ?? 1000;
    if (!Number.isSafeInteger(loopLimit) || loopLimit < 1 || loopLimit > 100_000) throw new RangeError('Fake clock loopLimit must be 1 to 100000.');
    const token = Symbol('svelar.clock');
    state.owner = token;
    const errors: unknown[] = [];
    let value: T | undefined;
    let installed = false;
    let installedAdapter: FakeClockAdapter | undefined;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      this.token = undefined;
      this.adapter = undefined;
      if (installed && installedAdapter) {
        const adapter = installedAdapter;
        try { adapter.clearAllTimers(); } catch (error) { errors.push(error); }
        try { adapter.useRealTimers(); } catch (error) { errors.push(error); }
        try {
          const original = state.original;
          if (adapter.isFakeTimers() || adapter.getMockedSystemTime() !== null || Date !== original.Date || Date.now !== original.dateNow
            || setTimeout !== original.setTimeout || clearTimeout !== original.clearTimeout || setInterval !== original.setInterval
            || clearInterval !== original.clearInterval || setImmediate !== original.setImmediate || clearImmediate !== original.clearImmediate) throw new Error('Fake clock restoration failed.');
        } catch (error) { errors.push(error); }
      }
      if (state.owner === token) state.owner = undefined;
    };
    try {
      // Public lifecycle cleanup also covers a runner timeout while the callback remains pending.
      this.options.testContext.onTestFinished(() => {
        if (restored || state.owner !== token) return;
        errors.push(new Error('Fake clock callback outlived its test; global timers were restored.'));
        restore();
        throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'Fake clock test-finish cleanup failed.');
      });
      const adapter = await adapterFor(this.options);
      if (restored) throw new Error('Fake clock test ended before adapter initialization.');
      installedAdapter = adapter;
      const original = state.original;
      if (adapter.isFakeTimers() || adapter.getMockedSystemTime() !== null || Date !== original.Date || Date.now !== original.dateNow
        || setTimeout !== original.setTimeout || clearTimeout !== original.clearTimeout || setInterval !== original.setInterval
        || clearInterval !== original.clearInterval || setImmediate !== original.setImmediate || clearImmediate !== original.clearImmediate
        || 'clock' in setTimeout || 'isFake' in Date || adapter.isMockFunction?.(Date.now)) throw new Error('A foreign timer/date mock is already installed; fakeClock will not replace or restore it.');
      this.token = token;
      this.adapter = adapter;
      // Even a partial backend installation must be followed by restoration.
      installed = true;
      adapter.useFakeTimers({ now, loopLimit, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'] });
      value = await state.scopes.run(token, () => callback(this));
      if (this.advancing) throw new Error('Await every fake clock tick before returning from its scope.');
    } catch (error) { errors.push(error); }
    finally {
      if (this.advancing && !restored) {
        try { await this.advancing; } catch (error) { errors.push(error); }
      }
      restore();
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Fake clock callback or restoration failed.');
    return value as T;
  }

  private active(): FakeClockAdapter {
    if (!this.token || state.owner !== this.token || state.scopes.getStore() !== this.token || !this.adapter) throw new Error('Fake clock controls can only be used inside their active callback.');
    return this.adapter;
  }

  now(): number { this.active(); return Date.now(); }
  pendingTimers(): number { return this.active().getTimerCount(); }

  setSystemTime(value: Date | number): void {
    const adapter = this.active();
    if (this.advancing) throw new Error('Do not change system time during a fake clock tick.');
    adapter.setSystemTime(timestamp(value));
  }

  async tick(ms: number): Promise<void> {
    const adapter = this.active();
    if (!Number.isSafeInteger(ms) || ms < 0 || ms > 31_536_000_000) throw new RangeError('Fake clock tick must be 0 to 31536000000 integer milliseconds.');
    if (this.advancing) throw new Error('Concurrent fake clock ticks are not supported.');
    const advancing = adapter.advanceTimersByTimeAsync(ms);
    this.advancing = advancing;
    try { await advancing; } finally { if (this.advancing === advancing) this.advancing = undefined; }
  }
}

export function fakeClock<T>(callback: (clock: FakeClock) => T | Promise<T>, options: FakeClockOptions): Promise<T> {
  return new FakeClock(options).run(callback);
}
