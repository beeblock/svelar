import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
import nativeTimers from 'node:timers';
import promiseTimers from 'node:timers/promises';

const transportTimers = {
  setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
};
let schedulerTimers = transportTimers;

/** Fake only scheduler-local timer bindings; native database transport must keep real timers. */
export const schedulerClock = {
  enable(now: Date): void {
    const originalNative = {
      setTimeout: nativeTimers.setTimeout, clearTimeout: nativeTimers.clearTimeout,
      setInterval: nativeTimers.setInterval, clearInterval: nativeTimers.clearInterval,
    };
    const originalPromises = { setTimeout: promiseTimers.setTimeout, setInterval: promiseTimers.setInterval };
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now });
    schedulerTimers = {
      setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    };
    Object.assign(globalThis, transportTimers);
    Object.assign(nativeTimers, originalNative);
    Object.assign(promiseTimers, originalPromises);
    syncBuiltinESMExports();
  },
  tick(milliseconds: number): void { mock.timers.tick(milliseconds); },
  reset(): void { mock.timers.reset(); schedulerTimers = transportTimers; },
};

export function setTimeout(callback: () => void, milliseconds?: number) { return schedulerTimers.setTimeout(callback, milliseconds); }
export function clearTimeout(timer: ReturnType<typeof setTimeout> | null) { schedulerTimers.clearTimeout(timer ?? undefined); }
export function setInterval(callback: () => void, milliseconds?: number) { return schedulerTimers.setInterval(callback, milliseconds); }
export function clearInterval(timer: ReturnType<typeof setInterval> | null) { schedulerTimers.clearInterval(timer ?? undefined); }

/** Match the mutation target, not read-only lock references inside a fenced runtime UPDATE. */
export function isSchedulerLeaseMutation(sql: string): boolean {
  return /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?scheduler_locks["`]?(?:\s|\()/i.test(sql);
}
