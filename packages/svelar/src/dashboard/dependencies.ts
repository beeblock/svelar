import { ApplicationContext } from '../support/Context.js';
import type { DashboardDependency } from './providers.js';

export interface DashboardDependencyProbe {
  name: string;
  scope: 'shared' | 'process' | 'unknown';
  /** Read-only reachability proof, not configuration presence. Omit when the public driver cannot prove it. */
  check?: (signal: AbortSignal) => Promise<DashboardDependency['status']>;
}
export interface DashboardDependencyOptions { timeoutMs?: number; cacheMs?: number; concurrency?: number; }

/** Retain hung SDK calls in a finite pool; a health refresh cannot launch another copy after its deadline. */
export function createDashboardDependencyObserver(probes: () => readonly DashboardDependencyProbe[], options: DashboardDependencyOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 1000;
  const cacheMs = options.cacheMs ?? 5000;
  const concurrency = options.concurrency ?? 4;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000 || !Number.isSafeInteger(cacheMs) || cacheMs < 0 || cacheMs > 60000
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new RangeError('Invalid dashboard dependency observation bounds.');
  type Entry = { check: DashboardDependencyProbe['check']; scope: DashboardDependencyProbe['scope']; result?: DashboardDependency; at?: number; flight?: Promise<DashboardDependency>; };
  const entries = new Map<string, Entry>();
  let active = 0;
  let flight: Promise<readonly DashboardDependency[]> | null = null;
  const observe = async (probe: DashboardDependencyProbe): Promise<DashboardDependency> => {
    const base = { name: probe.name, scope: probe.scope, latencyMs: null };
    if (!probe.check) return { ...base, status: 'unknown', reason: 'unsupported' };
    let entry = entries.get(probe.name);
    if (!entry) { entry = { check: probe.check, scope: probe.scope }; entries.set(probe.name, entry); }
    if (entry.result && entry.check === probe.check && entry.scope === probe.scope && Date.now() - (entry.at ?? 0) < cacheMs) return entry.result;
    if (entry.flight) return { ...base, status: 'unknown', reason: 'timeout' };
    if (active >= concurrency) return { ...base, status: 'unknown', reason: 'capacity' };
    entry.check = probe.check; entry.scope = probe.scope;
    const selected = entry; const started = performance.now(); const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    active++;
    const pending = Promise.resolve(ApplicationContext.runIsolated({}, async (): Promise<DashboardDependency> => {
      try {
        const status = await probe.check!(controller.signal);
        if (!['healthy', 'degraded', 'unavailable', 'unknown'].includes(status)) throw new Error('Invalid probe status.');
        return controller.signal.aborted ? { ...base, status: 'unknown', reason: 'timeout' }
          : { ...base, status, latencyMs: performance.now() - started };
      } catch { return { ...base, status: 'unavailable', latencyMs: performance.now() - started, reason: 'probe-failed' }; }
    }));
    selected.flight = pending;
    void pending.then(() => { active--; if (selected.flight === pending) selected.flight = undefined; });
    const result = await Promise.race([pending, new Promise<DashboardDependency>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve({ ...base, status: 'unknown', reason: 'timeout' }); }, timeoutMs);
    })]);
    if (timer) clearTimeout(timer);
    selected.result = result; selected.at = Date.now();
    return result;
  };
  return async (): Promise<readonly DashboardDependency[]> => {
    if (flight) return flight;
    const configured = probes();
    if (configured.length > 100 || configured.some((probe) => !probe || typeof probe.name !== 'string' || !probe.name || probe.name.length > 255
      || /[\x00-\x1f\x7f]/.test(probe.name) || !['shared', 'process', 'unknown'].includes(probe.scope) || probe.check !== undefined && typeof probe.check !== 'function')
      || new Set(configured.map((probe) => probe.name)).size !== configured.length) throw new TypeError('Dependencies require at most 100 unique bounded probe names.');
    for (const [name, entry] of entries) if (!entry.flight && !configured.some((probe) => probe.name === name)) entries.delete(name);
    const pending = (async () => {
      const result: DashboardDependency[] = new Array(configured.length); let next = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, configured.length) }, async () => {
        while (next < configured.length) { const index = next++; result[index] = await observe(configured[index]); }
      }));
      return result;
    })();
    flight = pending;
    try { return await pending; } finally { if (flight === pending) flight = null; }
  };
}
