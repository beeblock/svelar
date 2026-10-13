import { singleton } from '../support/singleton.js';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export interface DeploymentRuntimeConfig {
  checks?: Record<string, (signal: AbortSignal) => boolean | Promise<boolean>>;
  timeoutMs?: number;
  cacheMs?: number;
  traffic?: { slot: 'blue' | 'green'; file: string };
}

class DeploymentRuntimeManager {
  private booted = false;
  private draining = false;
  private config: DeploymentRuntimeConfig = {};
  private generation = 0;
  private flight: { generation: number; result: Promise<boolean> } | null = null;
  private cached: { generation: number; at: number; ready: boolean } | null = null;
  configure(config: DeploymentRuntimeConfig): void {
    const timeout = config.timeoutMs ?? 2000;
    const cache = config.cacheMs ?? 250;
    const traffic = config.traffic ?? (process.env.SVELAR_DEPLOY_SLOT || process.env.SVELAR_DEPLOY_TRAFFIC_FILE
      ? { slot: process.env.SVELAR_DEPLOY_SLOT as 'blue' | 'green', file: process.env.SVELAR_DEPLOY_TRAFFIC_FILE! } : undefined);
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000) throw new RangeError('Readiness timeoutMs must be 1..60000.');
    if (!Number.isSafeInteger(cache) || cache < 0 || cache > 10000) throw new RangeError('Readiness cacheMs must be 0..10000.');
    if (Object.values(config.checks ?? {}).some(check => typeof check !== 'function')) throw new TypeError('Readiness checks must be functions.');
    if (traffic && (!['blue', 'green'].includes(traffic.slot) || typeof traffic.file !== 'string' || !isAbsolute(traffic.file))) throw new TypeError('Traffic eligibility requires a blue/green slot and an absolute control-file path.');
    this.config = { ...config, checks: { ...config.checks }, timeoutMs: timeout, cacheMs: cache, traffic: traffic ? { ...traffic } : undefined };
    this.booted = false; this.draining = false;
    this.generation++; this.cached = null;
  }
  ready(): void { this.booted = true; }
  beginDrain(): void { this.draining = true; }
  isDraining(): boolean { return this.draining; }
  async traffic(): Promise<{ ready: boolean; slot: 'blue' | 'green' | null }> {
    const generation = this.generation;
    const traffic = this.config.traffic;
    if (!traffic || !(await this.readiness()).ready) return { ready: false, slot: traffic?.slot ?? null };
    try {
      const text = await readFile(traffic.file, 'utf8');
      if (Buffer.byteLength(text) > 1024) return { ready: false, slot: traffic.slot };
      const value = JSON.parse(text);
      const valid = Array.isArray(value.slots) && value.slots.length <= 2 && value.slots.every((slot: string) => ['blue', 'green'].includes(slot));
      return { ready: valid && value.slots.includes(traffic.slot) && generation === this.generation && this.booted && !this.draining, slot: traffic.slot };
    } catch { return { ready: false, slot: traffic.slot }; }
  }
  async readiness(): Promise<{ ready: boolean }> {
    if (!this.booted || this.draining) return { ready: false };
    const generation = this.generation;
    if (this.cached?.generation === generation && Date.now() - this.cached.at < (this.config.cacheMs ?? 250)) return { ready: this.cached.ready };
    const current = this.flight;
    if (current) return { ready: await current.result && current.generation === generation && this.generation === generation && this.booted && !this.draining };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probes = Promise.all(Object.values(this.config.checks ?? {}).map(check => Promise.resolve().then(() => check(controller.signal)).catch(() => false)))
      .then(results => results.every(result => result === true) && !controller.signal.aborted);
    const flight = { generation, result: Promise.race([probes,
      new Promise<boolean>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, this.config.timeoutMs ?? 2000); }),
    ]).then(ready => {
      if (timer) clearTimeout(timer);
      if (this.generation === generation) this.cached = { generation, at: Date.now(), ready };
      return ready;
    }) };
    this.flight = flight;
    // A timed-out probe remains the one tracked flight until it actually settles.
    // Ignoring AbortSignal can make readiness unavailable, never unbounded.
    void probes.then(() => { if (this.flight === flight) this.flight = null; });
    return { ready: await flight.result && this.generation === generation && this.booted && !this.draining };
  }
}

export const DeploymentRuntime = singleton('svelar.deployment.runtime', () => new DeploymentRuntimeManager());
