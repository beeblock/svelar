import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueRecoveryHarness, withQueueRecovery, type QueueRecoveryHarnessTarget } from '../src/testing/index.js';
import type { QueueJobSnapshot, QueueMonitoringAdapter } from '../src/queue/Monitoring.js';
import { ApplicationContext } from '../src/support/Context.js';
import { Job, Queue } from '../src/queue/index.js';
import { Connection } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';

function job(overrides: Partial<QueueJobSnapshot> = {}): QueueJobSnapshot {
  return { id: 'job-a', connection: 'isolated', queue: 'orders', jobClass: 'RecoveryJob', status: 'active', attempts: 1, attemptsStarted: 1,
    maxAttempts: 3, stalledCount: 0, createdAt: 100, payload: '{}', lock: { source: 'database-lease', state: 'observed', expiresAt: 1000, owner: null }, ...overrides };
}
function fixture(driver: 'redis' | 'database' = 'database') {
  const adapter = { connection: 'isolated', queue: 'orders', driver,
    capabilities: { shared: true, indexedMetadata: true, durableReplay: true, pause: driver === 'redis' },
    get: vi.fn(async () => job()), recover: vi.fn(async () => 1), timeline: vi.fn(async () => [{ id: 'event-a', event: 'stalled', at: 200, attempt: 1 }]),
  } as unknown as QueueMonitoringAdapter;
  const target = { adapter, start: vi.fn(async (_signal: AbortSignal) => {}), stop: vi.fn(async (_signal: AbortSignal) => {}), kill: vi.fn(async (_signal: AbortSignal) => {}) };
  const harness = new QueueRecoveryHarness(target, { timeoutMs: 60, scopeTimeoutMs: 500, cleanupTimeoutMs: 30, pollIntervalMs: 5 });
  return { adapter, target, harness };
}

afterEach(async () => { await Queue.stop(); await Connection.disconnect(); vi.restoreAllMocks(); });

describe('Public queue recovery acceptance harness', () => {
  it('isolates inherited actor/tenant context in the scenario and every lifecycle callback', async () => {
    const test = fixture(); const contexts: unknown[] = [];
    test.target.start.mockImplementation(async () => { contexts.push(ApplicationContext.snapshot()); });
    test.target.stop.mockImplementation(async () => { contexts.push(ApplicationContext.snapshot()); });
    await ApplicationContext.runIsolated({ teamId: 'operator', userId: 'operator', private: 'must-not-inherit' }, async () => {
      await test.harness.run(async harness => { contexts.push(ApplicationContext.snapshot()); await harness.start(); });
      expect(ApplicationContext.get('teamId')).toBe('operator');
    });
    expect(contexts).toEqual([{}, {}, {}]);
  });

  it('runs with explicit validated test context and restores the surrounding context', async () => {
    const test = fixture();
    const harness = new QueueRecoveryHarness(test.target, { context: { tenantId: 'test-team', actorId: 'test-actor' } });
    await harness.run(async () => {
      expect(ApplicationContext.snapshot()).toEqual({ teamId: 'test-team', tenantId: 'test-team', actorId: 'test-actor' });
    });
    await expect(new QueueRecoveryHarness(test.target, { context: { teamId: 'a', tenantId: 'b' } }).run(() => {})).rejects.toThrow('same tenant');
  });

  it('requires the active async scope and rejects concurrent runs without touching the consumer', async () => {
    const test = fixture();
    await expect(test.harness.start()).rejects.toThrow('active callback');
    await expect(test.harness.get('job-a')).rejects.toThrow('active callback');
    await test.harness.run(async () => {
      await expect(test.harness.run(() => {})).rejects.toThrow('active scope');
    });
    expect(test.target.start).not.toHaveBeenCalled();
  });

  it('awaits start/kill/restart/stop and prohibits overlapping owned consumers', async () => {
    const test = fixture();
    await test.harness.run(async harness => {
      await expect(harness.stop()).rejects.toThrow('No queue consumer');
      await harness.start(); await expect(harness.start()).rejects.toThrow('before restarting');
      await harness.kill(); await harness.start(); await harness.stop();
    });
    expect(test.target.start).toHaveBeenCalledTimes(2);
    expect(test.target.kill).toHaveBeenCalledTimes(1);
    expect(test.target.stop).toHaveBeenCalledTimes(1);
  });

  it('polls only public adapter fields for actual recovered state and uses public SQL recovery', async () => {
    const test = fixture();
    vi.mocked(test.adapter.get).mockResolvedValueOnce(job()).mockResolvedValueOnce(job({ status: 'completed', stalledCount: 1, attemptsStarted: 2 }));
    await test.harness.run(async harness => {
      expect(await harness.recover()).toBe(1);
      expect(await harness.waitForJob('job-a', { status: 'completed', stalledCountAtLeast: 1, attemptsStartedAtLeast: 2 })).toMatchObject({ stalledCount: 1 });
      expect(await harness.timeline('job-a', 10)).toEqual([{ id: 'event-a', event: 'stalled', at: 200, attempt: 1 }]);
    });
    expect(test.adapter.timeline).toHaveBeenCalledWith({ id: 'job-a', source: 'live' }, 10);
  });

  it('does not substitute manual Redis recovery or report absent counters as zero healthy', async () => {
    const test = fixture('redis');
    vi.mocked(test.adapter.get).mockResolvedValue(job({ attemptsStarted: undefined }));
    await test.harness.run(async harness => {
      await expect(harness.recover()).rejects.toThrow('replacement consumer');
      await expect(harness.waitForJob('job-a', { attemptsStartedAtLeast: 0 })).rejects.toThrow('timed out');
    });
    expect(test.adapter.recover).not.toHaveBeenCalled();
  });

  it('bounds hung probes and clears their wait without erasing the original consumer failure', async () => {
    const test = fixture(); const failure = new Error('actual consumer failure');
    vi.mocked(test.adapter.get).mockImplementation(() => new Promise(() => {}));
    await expect(test.harness.run(async harness => {
      await harness.start(); await expect(harness.waitForJob('job-a')).rejects.toThrow('timed out'); throw failure;
    })).rejects.toBe(failure);
    expect(test.target.stop).toHaveBeenCalledTimes(1);
  });

  it('aborts waits on external cancellation and cleans its consumer with a fresh nonaborted signal', async () => {
    const test = fixture(); const controller = new AbortController(); const failure = new Error('cancel acceptance');
    const harness = new QueueRecoveryHarness(test.target, { signal: controller.signal, pollIntervalMs: 5 });
    vi.mocked(test.adapter.get).mockResolvedValue(null);
    await expect(harness.run(async scope => {
      await scope.start(); const waiting = scope.waitForJob('job-a'); controller.abort(failure); await waiting;
    })).rejects.toBe(failure);
    expect(test.target.stop.mock.calls[0][0].aborted).toBe(false);
  });

  it('bounds a hung scope and startup, stops the owned consumer, and preserves aborted startup signal', async () => {
    const test = fixture();
    test.target.start.mockImplementation(signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
    await expect(test.harness.run(async harness => { await harness.start(); })).rejects.toThrow('timed out');
    expect(test.target.start.mock.calls[0][0].aborted).toBe(true);
    expect(test.target.stop).toHaveBeenCalledTimes(1);
    const harness = new QueueRecoveryHarness(test.target, { scopeTimeoutMs: 20 });
    await expect(harness.run(() => new Promise(() => {}))).rejects.toThrow('timed out');
  });

  it('uses kill only as cleanup fallback and retains both scenario and cleanup errors', async () => {
    const test = fixture(); const original = new Error('scenario failure'); const stop = new Error('stop failure');
    test.target.stop.mockRejectedValue(stop);
    try {
      await test.harness.run(async harness => { await harness.start(); throw original; });
      throw new Error('Expected scenario failure');
    } catch (error) { expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([original, stop]); }
    expect(test.target.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects dropped operations and closes their signals before scope cleanup', async () => {
    const test = fixture(); vi.mocked(test.adapter.get).mockResolvedValue(null);
    await expect(test.harness.run(harness => { void harness.waitForJob('job-a'); })).rejects.toThrow('Await every');
  });

  it('validates bounds, ids, expectations and nonshared drivers before consuming anything', async () => {
    const test = fixture();
    for (const timeoutMs of [0, -1, NaN, Infinity, 120001]) expect(() => new QueueRecoveryHarness(test.target, { timeoutMs })).toThrow('timeoutMs');
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
    expect(() => new QueueRecoveryHarness({ ...test.target, adapter: Queue.adapter() })).toThrow('shared');
    expect(() => test.harness.waitForJob('')).toThrow('job id');
    expect(() => test.harness.waitForJob('job-a', { stalledCountAtLeast: -1 })).toThrow('counters');
    const harness = new QueueRecoveryHarness(test.target, { maxOperations: 1 });
    await harness.run(async scope => { await scope.get('job-a'); await expect(scope.get('job-a')).rejects.toThrow('operation limit'); });
    expect(test.target.start).not.toHaveBeenCalled();
  });

  it('accepts actual public database consumers with standard migrated test storage and stored job context', async () => {
    Connection.configure({ default: 'test', connections: { test: { driver: 'sqlite', filename: ':memory:' } } });
    await new Migrator().fresh(svelarCoreMigrations());
    Queue.configure({ default: 'sql', connections: { sql: { driver: 'database' } } });
    let observed: unknown;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    class StoredContextJob extends Job { async handle() { observed = ApplicationContext.snapshot(); await barrier; } }
    const id = await Queue.dispatch(new StoredContextJob(), { context: { teamId: 'stored-team' }, metadata: { resourceId: 'invoice' } });
    let consumer: Promise<number> | undefined;
    const target: QueueRecoveryHarnessTarget = { adapter: Queue.adapter(),
      start: async () => { consumer = Queue.work({ sleep: 0.005 }); },
      stop: async () => { await Queue.stop(); await consumer; },
      kill: async () => { await Queue.stop(); await consumer; },
    };
    const raw = vi.spyOn(Connection, 'raw');
    await ApplicationContext.runIsolated({ teamId: 'operator', userId: 'operator' }, () => withQueueRecovery(target, async harness => {
      await harness.start(); expect(await harness.waitForJob(id, { status: 'active' })).toMatchObject({ metadata: { resourceId: 'invoice' } });
      release(); await harness.waitForMissing(id);
      expect((await harness.adapter.metrics()).completed).toBe(1);
    }));
    expect(observed).toMatchObject({ teamId: 'stored-team' });
    expect(observed).not.toHaveProperty('userId');
    expect(raw.mock.calls.some(([sql]) => /\b(CREATE|DROP|ALTER)\b/i.test(sql))).toBe(false);
  });
});
