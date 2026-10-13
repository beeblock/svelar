import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, fakeClock, type FakeClockAdapter } from '../src/testing/clock';

const native = { Date, now: Date.now, setTimeout, setInterval, setImmediate };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('callback fake clock', () => {
  it('uses the optional Vitest peer and advances timers, dates and async callbacks', async (testContext) => {
    const calls: number[] = [];
    const result = await fakeClock(async (clock) => {
      expect(clock.now()).toBe(1000);
      setTimeout(async () => { await Promise.resolve(); calls.push(Date.now()); }, 30);
      const interval = setInterval(() => { calls.push(Date.now()); }, 10);
      await clock.tick(20);
      clearInterval(interval);
      expect(calls).toEqual([1010, 1020]);
      await clock.tick(10);
      expect(calls).toEqual([1010, 1020, 1030]);
      expect(clock.pendingTimers()).toBe(0);
      clock.setSystemTime(new Date(2000));
      expect(new Date().getTime()).toBe(2000);
      return 'result';
    }, { testContext, now: 1000 });
    expect(result).toBe('result');
    expect(Date).toBe(native.Date);
    expect(Date.now).toBe(native.now);
    expect(setTimeout).toBe(native.setTimeout);
    expect(setInterval).toBe(native.setInterval);
    expect(setImmediate).toBe(native.setImmediate);
  });

  it('clears pending callbacks and restores globals on rejection', async (testContext) => {
    const called = vi.fn();
    const failure = new Error('callback failed');
    await expect(fakeClock(() => {
      setTimeout(called, 10);
      throw failure;
    }, { testContext })).rejects.toBe(failure);
    expect(vi.isFakeTimers()).toBe(false);
    expect(Date).toBe(native.Date);
    expect(called).not.toHaveBeenCalled();
    await fakeClock((clock) => { expect(clock.pendingTimers()).toBe(0); }, { testContext });
  });

  it('rejects concurrent test contexts before touching the clock', async () => {
    await expect(fakeClock(() => {}, { testContext: { task: { concurrent: true }, onTestFinished() {} } })).rejects.toThrow('sequential');
    expect(vi.isFakeTimers()).toBe(false);
  });

  it('rejects absent test contexts without probing private Vitest worker state', async () => {
    await expect(fakeClock(() => {}, { testContext: undefined! })).rejects.toThrow('sequential');
  });

  it('rejects nested and overlapping scopes without restoring the owner clock', async (testContext) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const first = fakeClock(async (clock) => {
      entered();
      await expect(fakeClock(() => {}, { testContext })).rejects.toThrow('already active');
      expect(clock.now()).toBe(42);
      await gate;
    }, { testContext, now: 42 });
    await ready;
    await expect(fakeClock(() => {}, { testContext })).rejects.toThrow('already active');
    expect(Date.now()).toBe(42);
    release();
    await first;
    expect(Date).toBe(native.Date);
  });

  it('does not replace or clean up foreign fake timers', async (testContext) => {
    vi.useFakeTimers({ now: 91 });
    const foreignDate = Date;
    await expect(fakeClock(() => {}, { testContext })).rejects.toThrow('foreign');
    expect(Date).toBe(foreignDate);
    expect(Date.now()).toBe(91);
    expect(vi.isFakeTimers()).toBe(true);
  });

  it('rejects foreign date-only mocks and native clock spies', async (testContext) => {
    vi.setSystemTime(100);
    await expect(fakeClock(() => {}, { testContext })).rejects.toThrow('foreign');
    vi.useRealTimers();
    vi.spyOn(Date, 'now').mockReturnValue(8);
    await expect(fakeClock(() => {}, { testContext })).rejects.toThrow('foreign');
    expect(Date.now()).toBe(8);
  });

  it('controls cannot be used outside the callback or after restoration', async (testContext) => {
    const clock = new FakeClock({ testContext });
    expect(() => clock.now()).toThrow('active callback');
    await clock.run((active) => { expect(active.now()).toBeGreaterThan(0); });
    expect(() => clock.now()).toThrow('active callback');
    await expect(clock.tick(1)).rejects.toThrow('active callback');
  });

  it('only restores the installed adapter, even if caller options change', async (testContext) => {
    const options = { testContext, adapter: vi as FakeClockAdapter };
    const other = { ...vi, useRealTimers: vi.fn() };
    await fakeClock(() => { options.adapter = other; }, options);
    expect(other.useRealTimers).not.toHaveBeenCalled();
    expect(vi.isFakeTimers()).toBe(false);
  });

  it('restores a partial backend installation and preserves its error', async (testContext) => {
    const error = new Error('partial install');
    const adapter: FakeClockAdapter = { ...vi, useFakeTimers(options) { vi.useFakeTimers(options); throw error; } };
    await expect(fakeClock(() => {}, { testContext, adapter })).rejects.toBe(error);
    expect(vi.isFakeTimers()).toBe(false);
    expect(Date).toBe(native.Date);
  });

  it('tries real-timer restoration even if clearing timers fails', async (testContext) => {
    const cleanup = new Error('cleanup failed');
    const restore = vi.fn(() => vi.useRealTimers());
    const adapter: FakeClockAdapter = { ...vi, clearAllTimers() { throw cleanup; }, useRealTimers: restore };
    await expect(fakeClock(() => {}, { testContext, adapter })).rejects.toBe(cleanup);
    expect(restore).toHaveBeenCalledOnce();
    expect(Date).toBe(native.Date);
  });

  it('reports callback and cleanup failures together instead of hiding either', async (testContext) => {
    const callback = new Error('callback');
    const cleanup = new Error('cleanup');
    const adapter: FakeClockAdapter = { ...vi, clearAllTimers() { throw cleanup; } };
    const failure = await fakeClock(() => { throw callback; }, { testContext, adapter }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([callback, cleanup]);
    expect(vi.isFakeTimers()).toBe(false);
  });

  it('waits for a detached tick to settle, then fails and restores rather than leaking timers', async (testContext) => {
    let release!: () => void;
    const advancing = new Promise<void>((resolve) => { release = resolve; });
    const adapter: FakeClockAdapter = { ...vi, advanceTimersByTimeAsync: () => advancing };
    let ready!: () => void;
    const entered = new Promise<void>((resolve) => { ready = resolve; });
    let tick!: Promise<void>;
    const scope = fakeClock((clock) => { tick = clock.tick(1); ready(); }, { testContext, adapter });
    await entered;
    expect(vi.isFakeTimers()).toBe(true);
    release();
    await expect(scope).rejects.toThrow('Await every');
    await tick;
    expect(vi.isFakeTimers()).toBe(false);
  });

  it('reports a broken restore and rejects the contaminated globals until their owner repairs them', async (testContext) => {
    const adapter: FakeClockAdapter = { ...vi, useRealTimers() {} };
    await expect(fakeClock(() => {}, { testContext, adapter })).rejects.toThrow('restoration failed');
    await expect(fakeClock(() => {}, { testContext })).rejects.toThrow('foreign');
    vi.useRealTimers();
    await fakeClock(() => {}, { testContext });
  });

  it('rejects controls used from an unrelated async caller while its callback is active', async (testContext) => {
    const clock = new FakeClock({ testContext });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let ready!: () => void;
    const entered = new Promise<void>((resolve) => { ready = resolve; });
    const scope = clock.run(async () => { ready(); await gate; });
    await entered;
    expect(() => clock.now()).toThrow('active callback');
    release();
    await scope;
  });

  it('the public test-finish hook restores a timed-out callback and cannot reset a later owner', async (testContext) => {
    let finish!: () => void;
    const timedOutContext = { task: { concurrent: false }, onTestFinished(callback: () => void) { finish = callback; } };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let ready!: () => void;
    const entered = new Promise<void>((resolve) => { ready = resolve; });
    const scope = fakeClock(async () => { ready(); await gate; }, { testContext: timedOutContext, now: 99 });
    await entered;
    expect(() => finish()).toThrow('outlived its test');
    expect(vi.isFakeTimers()).toBe(false);
    await fakeClock((clock) => {
      finish();
      expect(clock.now()).toBe(42);
      release();
    }, { testContext, now: 42 });
    await expect(scope).rejects.toThrow('outlived its test');
    expect(Date).toBe(native.Date);
  });

  for (const now of [NaN, Infinity, 0.5, 8_640_000_000_000_001]) it(`rejects invalid epoch ${now} before installation`, async (testContext) => {
    await expect(fakeClock(() => {}, { testContext, now })).rejects.toThrow('valid Date');
    expect(vi.isFakeTimers()).toBe(false);
  });

  for (const loopLimit of [0, -1, 0.5, 100_001]) it(`rejects invalid loop limit ${loopLimit}`, async (testContext) => {
    await expect(fakeClock(() => {}, { testContext, loopLimit })).rejects.toThrow('loopLimit');
  });

  it('rejects invalid and overlapping ticks without changing the time', async (testContext) => {
    await fakeClock(async (clock) => {
      for (const ms of [-1, NaN, Infinity, 0.1, 31_536_000_001]) await expect(clock.tick(ms)).rejects.toThrow('integer milliseconds');
      const first = clock.tick(10);
      await expect(clock.tick(1)).rejects.toThrow('Concurrent');
      expect(() => clock.setSystemTime(1)).toThrow('during');
      await first;
      expect(clock.now()).toBe(10);
    }, { testContext, now: 0 });
  });
});
