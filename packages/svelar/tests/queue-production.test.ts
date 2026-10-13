import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { Job, Queue, type JobDefinition } from '../src/queue/index.js';
import { ApplicationContext } from '../src/support/Context.js';
import { QueueWorkCommand } from '../src/cli/commands/QueueWorkCommand.js';
import { JobMonitor } from '../src/queue/JobMonitor.js';

class ProductionPayloadJob extends Job {
  static observations: any[] = [];
  constructor(public value = 'value') { super(); }
  async handle() {
    ProductionPayloadJob.observations.push({ value: this.value, attempts: this.attempts, maxAttempts: this.maxAttempts,
      retryDelay: this.retryDelay, queue: this.queue, context: ApplicationContext.snapshot() });
    await this.progress(100);
  }
}

beforeEach(async () => {
  await Queue.stop();
  Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' } } });
  ProductionPayloadJob.observations = [];
});
afterEach(async () => { await Queue.stop(); vi.restoreAllMocks(); });

describe('Production queue profiles and dispatch', () => {
  it('discovers static job definitions without invoking constructors', () => {
    class ConstructorTrap extends Job {
      static definition: JobDefinition = { name: 'production.constructor-trap', queue: 'reports', dispatch: { maxAttempts: 7 } };
      constructor() { super(); throw new Error('must never discover by construction'); }
      async handle() {}
    }
    expect(Queue.discoverJobs({ ConstructorTrap, unrelated: class {} })).toEqual(['production.constructor-trap']);
    expect(Queue.jobDefinitions()).toContainEqual(expect.objectContaining({ name: 'production.constructor-trap', queue: 'reports' }));
    expect(Queue.queues()).toContainEqual(expect.objectContaining({ name: 'reports' }));
  });

  it('rejects conflicting wire names instead of deserializing as another job', () => {
    class One extends Job { async handle() {} }
    class Two extends Job { async handle() {} }
    Queue.register(One, { name: 'production.unique-wire-name' });
    expect(() => Queue.register(Two, { name: 'production.unique-wire-name' })).toThrow('already registered');
  });

  it('automatically registers dispatched classes and stable named definitions', async () => {
    class StaticQueue extends ProductionPayloadJob {
      static definition = { name: 'production.static-queue', queue: 'exports', dispatch: { maxAttempts: 6 } };
    }
    await Queue.dispatch(new StaticQueue('static'));
    expect(Queue.registeredJobs()).toContain('production.static-queue');
    expect(await Queue.work({ queue: 'exports', maxJobs: 1 })).toBe(1);
    expect(ProductionPayloadJob.observations[0]).toMatchObject({ value: 'static', maxAttempts: 6, queue: 'exports' });
  });

  it('resolves explicit worker profile, queue and connection defaults without undefined erasing them', () => {
    Queue.configure({ default: 'memory', connections: { memory: { driver: 'memory' }, production: { driver: 'redis' } },
      workers: [{ name: 'production.reports', queue: 'reports', connection: 'production', concurrency: 5, lockDuration: 700, stalledInterval: 900 }] });
    expect(Queue.resolveWorkOptions({ profile: 'production.reports', lockDuration: undefined })).toMatchObject({
      connection: 'production', queue: 'reports', concurrency: 5, lockDuration: 700, stalledInterval: 900,
    });
    expect(Queue.resolveWorkOptions({ profile: 'production.reports', concurrency: 2 })).toMatchObject({ concurrency: 2 });
    expect(() => Queue.resolveWorkOptions({ profile: 'unknown' })).toThrow('Unknown worker profile');
    expect(() => Queue.resolveWorkOptions({ concurrency: 2 })).toThrow('require the Redis driver');
  });

  it('rejects unsupported concurrent finite Redis workers rather than silently ignoring concurrency', () => {
    Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis' } } });
    expect(() => Queue.resolveWorkOptions({ maxJobs: 1, concurrency: 5 })).toThrow('Finite Redis workers require concurrency 1');
  });

  it('rejects reserved Redis integer job ids before connecting', async () => {
    Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis' } } });
    await expect(Queue.dispatch(new ProductionPayloadJob(), { jobId: '123' })).rejects.toThrow('integer string');
  });

  it('preserves TLS, ACL URL credentials and an explicit database zero', () => {
    Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis', url: 'rediss://service%40name:secret%2Fvalue@redis.example:6380/0', db: 7 } } });
    expect((Queue as any).resolveDriver('redis').getRedisConnection()).toMatchObject({
      host: 'redis.example', port: 6380, username: 'service@name', password: 'secret/value', db: 0, tls: {},
    });
  });

  it('rejects unsupported URL protocols and invalid database paths', () => {
    for (const url of ['http://redis.example', 'redis://redis.example/not-a-db']) {
      Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis', url } } });
      expect(() => (Queue as any).resolveDriver('redis').getRedisConnection()).toThrow();
    }
  });

  it.each(['until-completed', 'until-processing', 'coalesce', 'throttle', 'debounce'] as const)('rejects unsupported %s on memory before enqueue', async (mode) => {
    await expect(Queue.dispatch(new ProductionPayloadJob(), { deduplication: { id: 'unique', mode, ...(['throttle', 'debounce'].includes(mode) ? { ttl: 100 } : {}) } as any })).rejects.toThrow('unsupported');
    expect(await Queue.size()).toBe(0);
  });

  it.each([0, -1, 1.5, Infinity])('rejects invalid native ttl %s before connecting', async (ttl) => {
    Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis' } } });
    await expect(Queue.dispatch(new ProductionPayloadJob(), { deduplication: { id: 'unique', mode: 'debounce', ttl } })).rejects.toThrow('ttl');
  });

  it('bulk validates the whole batch and duplicate ids before adding memory jobs', async () => {
    await expect(Queue.dispatchBulk([
      { job: new ProductionPayloadJob('one'), options: { jobId: 'same' } },
      { job: new ProductionPayloadJob('two'), options: { jobId: 'same' } },
    ])).rejects.toThrow('already exists');
    expect(await Queue.size()).toBe(0);
    await expect(Queue.dispatchBulk([
      new ProductionPayloadJob('valid'),
      { job: new ProductionPayloadJob('invalid'), options: { maxAttempts: 0 } },
    ])).rejects.toThrow('maxAttempts');
    expect(await Queue.size()).toBe(0);
  });

  it('does not mutate declared queue topology when a producer overrides its connection', async () => {
    Queue.configure({ default: 'primary', connections: { primary: { driver: 'memory' }, alternate: { driver: 'memory' } },
      queues: [{ name: 'declared', connection: 'primary' }] });
    await Queue.dispatch(new ProductionPayloadJob('alternate'), { queue: 'declared', connection: 'alternate' });
    expect(Queue.queues().find(queue => queue.name === 'declared')?.connection).toBe('primary');
    await Queue.dispatch(new ProductionPayloadJob('primary'), { queue: 'declared' });
    await Queue.work({ queue: 'declared', maxJobs: 1 });
    expect(ProductionPayloadJob.observations[0].value).toBe('primary');
    await Queue.work({ queue: 'declared', connection: 'alternate', maxJobs: 1 });
    expect(ProductionPayloadJob.observations[1].value).toBe('alternate');
  });

  it('bulk preserves base properties, priority and per-job isolated contexts', async () => {
    const updates: any[] = [];
    const first = new ProductionPayloadJob('low'); first.retryDelay = 3; first.maxAttempts = 8;
    const ids = await Queue.dispatchBulk([
      { job: first, options: { jobId: 'low', priority: 9, context: { teamId: 'team-a', queueProgressReporter: (update: any) => updates.push(update) } } },
      { job: new ProductionPayloadJob('high'), options: { jobId: 'high', priority: 1, context: {} } },
    ]);
    expect(ids).toEqual(['low', 'high']);
    await ApplicationContext.runIsolated({ teamId: 'worker-tenant', userId: 'worker-actor' }, () => Queue.work({ maxJobs: 2 }));
    expect(ProductionPayloadJob.observations[0]).toMatchObject({ value: 'high', context: { jobId: 'high' } });
    expect(ProductionPayloadJob.observations[0].context).not.toHaveProperty('teamId');
    expect(ProductionPayloadJob.observations[1]).toMatchObject({ value: 'low', retryDelay: 3, maxAttempts: 8, context: { teamId: 'team-a' } });
    expect(ProductionPayloadJob.observations[1].context).not.toHaveProperty('userId');
    expect(updates).toHaveLength(1);
  });

  it('does not accept mixed queues/connections in one native bulk operation', async () => {
    await expect(Queue.dispatchBulk([
      { job: new ProductionPayloadJob(), options: { queue: 'one' } },
      { job: new ProductionPayloadJob(), options: { queue: 'two' } },
    ])).rejects.toThrow('one queue and one connection');
    expect(await Queue.size('one')).toBe(0);
  });

  it('protects restored methods and preserves base retry settings', () => {
    const job = new ProductionPayloadJob();
    job.restore({ value: 'restored', retryDelay: 2, maxAttempts: 9, queue: 'reports', attempts: 99 });
    expect(job).toMatchObject({ value: 'restored', retryDelay: 2, maxAttempts: 9, queue: 'reports', attempts: 0 });
    expect(() => job.restore({ handle: 'malicious' })).toThrow('reserved');
    expect(() => job.restore(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow('reserved');
  });
});

describe('Production queue database transport and replay', () => {
  beforeEach(async () => {
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    await new Migrator().fresh(svelarCoreMigrations());
  });
  afterEach(async () => { await Connection.disconnect(); });

  it('preserves custom serialized payloads and retries exactly the requested attempts', async () => {
    const seen: any[] = [];
    class CustomTransport extends Job {
      constructor(public value = 'custom') { super(); this.maxAttempts = 3; this.retryDelay = 0; }
      serialize() { return JSON.stringify({ value: this.value }); }
      async handle() { seen.push([this.value, this.attempts, this.maxAttempts, this.retryDelay]); if (this.attempts < 3) throw new Error('retry'); }
    }
    Queue.configure({ default: 'database', connections: { database: { driver: 'database' } } });
    await Queue.dispatchBulk([new CustomTransport()]);
    expect(await Queue.work({ maxJobs: 1 })).toBe(1);
    expect(seen).toEqual([['custom', 1, 3, 0], ['custom', 2, 3, 0], ['custom', 3, 3, 0]]);
    expect(await Queue.size()).toBe(0);
  });

  it('replays original tenant/actor and metadata, isolates hooks, and keeps legacy records system-only', async () => {
    const observations: any[] = [];
    let fail = true;
    class ContextFailure extends Job {
      maxAttempts = 2; retryDelay = 0;
      async handle() { observations.push(['handle', ApplicationContext.snapshot()]); if (fail) throw new Error('original failure'); }
      retrying() { observations.push(['retrying', ApplicationContext.snapshot()]); }
      failed() { observations.push(['failed', ApplicationContext.snapshot()]); }
    }
    await Queue.dispatch(new ContextFailure(), { context: { teamId: 'original-team', userId: 'original-actor' }, metadata: { resourceId: 'invoice-1' } });
    await ApplicationContext.runIsolated({ teamId: 'worker-team', userId: 'worker-actor' }, () => Queue.work({ maxJobs: 1 }));
    const [record] = await Queue.failed();
    expect(record.metadata).toEqual({ resourceId: 'invoice-1' });
    JobMonitor.configure({ driver: 'memory', default: 'memory', connections: { memory: { driver: 'memory' } } });
    const [monitored] = await JobMonitor.listJobs({ status: 'failed' });
    expect(monitored.payload).toBe(record.payload);
    expect(monitored.metadata).toEqual(record.metadata);
    expect(observations.map(([, context]) => [context.teamId, context.userId])).toEqual(Array(4).fill(['original-team', 'original-actor']));
    fail = false;
    await ApplicationContext.runIsolated({ teamId: 'operator-team', userId: 'operator-actor' }, async () => {
      expect(await Queue.retry(record.id)).toBe(true); await Queue.work({ maxJobs: 1 });
    });
    expect(observations.at(-1)[1]).toMatchObject({ teamId: 'original-team', userId: 'original-actor' });
    await Connection.raw('INSERT INTO svelar_failed_jobs (id,queue,job_class,payload,exception,failed_at) VALUES (?,?,?,?,?,?)',
      ['legacy-production', 'default', 'ContextFailure', new ContextFailure().serialize(), 'legacy', 0]);
    await ApplicationContext.runIsolated({ teamId: 'operator-team' }, async () => { await Queue.retry('legacy-production'); await Queue.work({ maxJobs: 1 }); });
    expect(observations.at(-1)[1]).not.toHaveProperty('teamId');
  });

  it('deduplicates database ids only on a verified unique violation and rejects bulk deduplication', async () => {
    Queue.configure({ default: 'database', connections: { database: { driver: 'database' } } });
    await Queue.dispatch(new ProductionPayloadJob(), { jobId: 'database-unique', deduplicate: true });
    await Queue.dispatch(new ProductionPayloadJob(), { jobId: 'database-unique', deduplicate: true });
    expect(await Queue.size()).toBe(1);
    await expect(Queue.dispatch(new ProductionPayloadJob(), { jobId: 'database-unique' })).rejects.toThrow();
    await expect(Queue.dispatchBulk([new ProductionPayloadJob()], { jobId: 'bulk-unique', deduplicate: true })).rejects.toThrow('does not support deduplication');
  });

  it('serializes chain members with their explicit registry names, without requiring constructors on restore', async () => {
    class NamedChainMember extends ProductionPayloadJob {
      static definition = { name: 'production.named-chain-member' };
    }
    Queue.configure({ default: 'database', connections: { database: { driver: 'database' } } });
    await Queue.chain([new NamedChainMember('chain')]);
    expect(await Queue.work({ maxJobs: 1 })).toBe(1);
    expect(ProductionPayloadJob.observations[0].value).toBe('chain');
  });
});

describe('Production queue CLI bounds', () => {
  beforeEach(() => {
    vi.spyOn(QueueWorkCommand.prototype as any, 'bootstrap').mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  it.each(['1.2', '3oops', 'Infinity', '9007199254740992'])('rejects malformed numeric option %s', async (value) => {
    await expect(new QueueWorkCommand().handle([], { concurrency: value })).rejects.toThrow('positive integer');
  });
  it('passes named profile and explicit connection without overriding profile concurrency', async () => {
    const work = vi.spyOn(Queue, 'work').mockResolvedValue(0);
    await new QueueWorkCommand().handle([], { profile: 'reports', connection: 'production', 'max-stalled-count': '0' });
    expect(work).toHaveBeenCalledWith(expect.objectContaining({ profile: 'reports', connection: 'production', concurrency: undefined, maxStalledCount: 0 }));
  });
  it('rejects timer overflow instead of shutting down immediately', async () => {
    await expect(new QueueWorkCommand().handle([], { 'grace-period': '2147484' })).rejects.toThrow('supported timer');
  });
});
