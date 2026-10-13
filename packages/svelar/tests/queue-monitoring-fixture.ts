import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { Queue, Job } from '../src/queue/index.js';
import { replayJobId } from '../src/queue/FailedJobStore.js';
import { QueueWorkCommand } from '../src/cli/commands/QueueWorkCommand.js';
import { Connection } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { ApplicationContext } from '../src/support/Context.js';

export { Queue, Connection, replayJobId };
export { QueueRecoveryHarness } from '../src/testing/QueueRecoveryHarness.js';
let redis: any;
export class MonitoringProcessJob extends Job {
  retryDelay = 0;
  constructor(public label: string, public duration = 0, public barrier?: string) { super(); }
  async handle() {
    process.send?.({ event: 'started', id: this.id, label: this.label, context: ApplicationContext.snapshot() });
    if (this.label.startsWith('failure') && process.env.SVELAR_QUEUE_SERVICE_RECOVERED !== '1') throw new Error('Fixture service unavailable');
    if (this.barrier) {
      if (!redis) { const Redis = createRequire(import.meta.url)('ioredis'); redis = new Redis(process.env.SVELAR_TEST_QUEUE_REDIS_URL!); }
      while (!await redis.get(this.barrier)) await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (this.duration) await new Promise(resolve => setTimeout(resolve, this.duration));
    await this.progress(100);
    process.send?.({ event: 'finished', id: this.id, label: this.label });
  }
  failed() { process.send?.({ event: 'failed', id: this.id, label: this.label }); }
}
export async function migrate(filename: string) {
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename } } });
  await new Migrator().fresh(svelarCoreMigrations()); await Connection.disconnect();
}
export function setup(prefix: string, filename: string, alphaUrl = process.env.SVELAR_TEST_QUEUE_REDIS_URL!) {
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename } } });
  Queue.configure({ default: 'alpha', connections: {
    alpha: { driver: 'redis', url: alphaUrl, prefix: `${prefix}-alpha`, monitoringCoverage: 'exclusive', producerTimeoutMs: 500 },
    beta: { driver: 'redis', url: process.env.SVELAR_TEST_QUEUE_REDIS_URL!, prefix: `${prefix}-beta`, monitoringCoverage: 'exclusive', producerTimeoutMs: 500 },
    sql: { driver: 'database', leaseDurationMs: 300 },
  }, queues: [{ name: 'orders', connection: 'alpha' }, { name: 'orders', connection: 'beta' }, { name: 'orders', connection: 'sql' }] });
  Queue.register(MonitoringProcessJob);
}
export async function close() { await Queue.stop(); if (redis) { await redis.quit(); redis = undefined; } await Connection.disconnect(); }

export async function sqlProof(driver: 'postgres' | 'mysql', port: number) {
  Connection.configure({ default: 'proof', connections: { proof: { driver, host: '127.0.0.1', port,
    user: driver === 'postgres' ? 'svelar_queue' : 'root', password: 'queue-proof', database: 'queue_proof' } } });
  const migrations = svelarCoreMigrations().filter(file => /^00000000_000(026|027|038|039|043)_/.test(file.name));
  await new Migrator('proof').fresh(migrations);
  Queue.configure({ default: 'sql', connections: { sql: { driver: 'database', databaseConnection: 'proof', leaseDurationMs: 300 } } });
  Queue.register(MonitoringProcessJob);
  try {
    await Queue.dispatch(new MonitoringProcessJob('failure-real-driver'), { queue: 'orders', maxAttempts: 1,
      context: { teamId: 'tenant' }, metadata: { accountId: 'account', correlationId: 'correlation' } });
    await Queue.work({ queue: 'orders', maxJobs: 1 });
    const adapter = Queue.adapter('orders'); const [record] = await adapter.deadLetters({ tenantId: 'tenant', accountId: 'account' });
    const results = await Promise.all(Array.from({ length: 5 }, () => adapter.retry({ source: 'dead-letter', id: record.id })));
    const winners = results.filter(result => result.outcome === 'accepted').length;
    process.env.SVELAR_QUEUE_SERVICE_RECOVERED = '1';
    const completed = await Queue.work({ queue: 'orders', maxJobs: 1 });
    return { winners, completed, metrics: await adapter.metrics(5), receipt: (await adapter.deadLetters({ includeReplayed: true }))[0],
      snapshot: await adapter.get(replayJobId(record.id)), pending: (await adapter.deadLetters()).length,
      timeline: (await adapter.timeline({ source: 'dead-letter', id: record.id })).map(event => event.event) };
  } finally { await close(); }
}

if (process.env.SVELAR_QUEUE_MONITOR_CHILD) {
  setup(process.env.SVELAR_QUEUE_PREFIX!, process.env.SVELAR_QUEUE_DATABASE!);
  const connection = process.env.SVELAR_QUEUE_CONNECTION ?? 'alpha';
  try {
    const role = process.env.SVELAR_QUEUE_MONITOR_CHILD;
    if (role === 'worker') {
      const command = new QueueWorkCommand();
      const options = Object.fromEntries(command.flags.map(flag => [flag.name, { type: flag.type, ...(flag.default !== undefined ? { default: flag.default } : {}) }]));
      const { values } = parseArgs({ args: process.argv.slice(2), options });
      process.send?.({ event: 'ready' });
      await ApplicationContext.runIsolated({ teamId: 'worker-must-not-leak', userId: 'worker-must-not-leak' }, () => command.handle([], values));
      process.exitCode = command.exitCode;
    } else if (role === 'metrics') {
      process.send?.({ event: 'metrics', result: await Queue.adapter('orders', connection).metrics() });
    } else {
      if (role === 'crash-replay') {
        const raw = Connection.raw.bind(Connection);
        Connection.raw = async (sql: string, bindings?: any[], name?: string) => {
          if (sql.startsWith('UPDATE "svelar_failed_jobs" SET "replayed_at"')) {
            process.send?.({ event: 'broker-published-before-db-ack' }); await new Promise(() => {});
          }
          return raw(sql, bindings, name);
        };
      }
      process.send?.({ event: 'result', result: await Queue.adapter('orders', connection).retry({ source: 'dead-letter', id: process.env.SVELAR_QUEUE_REPLAY_ID! }) });
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await close(); process.disconnect?.(); }
}
