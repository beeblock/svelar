import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DeploymentRuntime } from '../src/deployment/Runtime.js';
import { DeploymentController } from '../src/deployment/Controller.js';

beforeEach(() => DeploymentRuntime.configure({ timeoutMs: 20, cacheMs: 0 }));
let directory: string | undefined;
afterEach(async () => { if (directory) { await rm(directory, { recursive: true, force: true }); directory = undefined; } });
describe('Deployment readiness', () => {
  it('is unavailable before bootstrap and during drain, without disclosing dependency errors', async () => {
    const controller = new DeploymentController();
    expect((await controller.ready()).status).toBe(503);
    DeploymentRuntime.ready(); expect((await controller.ready()).status).toBe(200);
    DeploymentRuntime.beginDrain(); DeploymentRuntime.ready();
    const response = await controller.ready(); expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ data: { ready: false }, meta: {} });
  });
  it('requires every configured dependency and safely handles thrown checks', async () => {
    DeploymentRuntime.configure({ checks: { database: () => true, secret: () => { throw new Error('private password'); } } });
    DeploymentRuntime.ready(); const response = await new DeploymentController().ready();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('password');
  });
  it('keeps one tracked hung flight under repeated concurrent readiness requests and aborts it at the deadline', async () => {
    let calls = 0; let signal!: AbortSignal; let settle!: (value: boolean) => void;
    DeploymentRuntime.configure({ timeoutMs: 10, cacheMs: 0, checks: { hung: current => {
      signal = current; calls++; return new Promise<boolean>(resolve => { settle = resolve; });
    } } }); DeploymentRuntime.ready();
    expect((await Promise.all(Array.from({ length: 100 }, () => DeploymentRuntime.readiness()))).every(result => !result.ready)).toBe(true);
    expect(signal.aborted).toBe(true);
    await Promise.all(Array.from({ length: 100 }, () => DeploymentRuntime.readiness())); expect(calls).toBe(1);
    settle(true); await new Promise(resolve => setTimeout(resolve, 0));
    DeploymentRuntime.configure({ checks: { healthy: () => true }, cacheMs: 0 }); DeploymentRuntime.ready();
    expect(await DeploymentRuntime.readiness()).toEqual({ ready: true });
  });
  it('shares successful concurrent probes and briefly caches their result', async () => {
    let calls = 0;
    DeploymentRuntime.configure({ cacheMs: 100, checks: { database: async () => { calls++; await Promise.resolve(); return true; } } }); DeploymentRuntime.ready();
    expect((await Promise.all(Array.from({ length: 50 }, () => DeploymentRuntime.readiness()))).every(result => result.ready)).toBe(true);
    expect(await DeploymentRuntime.readiness()).toEqual({ ready: true }); expect(calls).toBe(1);
  });
  it('does not let a previous generation or a drain transition make the process ready', async () => {
    let settle!: (value: boolean) => void;
    DeploymentRuntime.configure({ timeoutMs: 100, checks: { pending: () => new Promise<boolean>(resolve => { settle = resolve; }) } }); DeploymentRuntime.ready();
    const pending = DeploymentRuntime.readiness(); await Promise.resolve();
    DeploymentRuntime.configure({ checks: { fresh: () => true }, cacheMs: 0 }); DeploymentRuntime.ready();
    settle(true); expect(await pending).toEqual({ ready: false });
    await Promise.resolve(); DeploymentRuntime.beginDrain(); expect(await DeploymentRuntime.readiness()).toEqual({ ready: false });
  });
  it('rejects invalid readiness bounds and check definitions', () => {
    expect(() => DeploymentRuntime.configure({ timeoutMs: 0 })).toThrow('timeoutMs');
    expect(() => DeploymentRuntime.configure({ cacheMs: 10001 })).toThrow('cacheMs');
    expect(() => DeploymentRuntime.configure({ checks: { bad: true as any } })).toThrow('functions');
  });
  it('separates candidate readiness from safely shared, read-only traffic eligibility', async () => {
    directory = await mkdtemp(join(tmpdir(), 'svelar-traffic-state-')); const file = join(directory, 'traffic.json');
    DeploymentRuntime.configure({ traffic: { slot: 'green', file }, cacheMs: 0 }); DeploymentRuntime.ready();
    expect(await DeploymentRuntime.readiness()).toEqual({ ready: true }); expect(await DeploymentRuntime.traffic()).toEqual({ ready: false, slot: 'green' });
    await writeFile(file, JSON.stringify({ slots: ['blue'] })); expect((await DeploymentRuntime.traffic()).ready).toBe(false);
    await writeFile(file, JSON.stringify({ slots: ['blue', 'green'] })); expect((await new DeploymentController().traffic()).status).toBe(200);
    await writeFile(file, JSON.stringify({ slots: ['unknown'] })); expect((await new DeploymentController().traffic()).status).toBe(503);
    await writeFile(file, 'invalid-secret-payload'); const response = await new DeploymentController().traffic();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret');
  });
});
