import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { Job, Queue } from '../src/queue/index.js';
import { QueueWorkCommand } from '../src/cli/commands/QueueWorkCommand.js';
import { Connection } from '../src/database/Connection.js';
import { ApplicationContext } from '../src/support/Context.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';

export { Queue, ApplicationContext };
export { readWorkerTelemetry as readFixtureWorkers } from '../src/queue/BullMQTelemetry.js';
let redis: any;
function client() {
  if (!redis) {
    const Redis = createRequire(import.meta.url)('ioredis');
    redis = new Redis(process.env.SVELAR_TEST_QUEUE_REDIS_URL!, { maxRetriesPerRequest: null });
  }
  return redis;
}
export async function closeFixtureClient() { if (redis) { await redis.quit(); redis = undefined; } }
export async function prepareFixtureDatabase(filename: string) {
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename } } });
  await new Migrator().fresh(svelarCoreMigrations());
}
export async function closeFixtureDatabase() { await Connection.disconnect(); }

export class RecoveryFixtureJob extends Job {
  retryDelay = 0;
  constructor(public label: string, public duration = 0, public barrier?: string, public hang = false, public failBefore = 0) { super(); }
  async handle() {
    process.send?.({ event: 'started', label: this.label, id: this.id, attempts: this.attempts, context: ApplicationContext.snapshot() });
    await this.progress(25, 'started', { label: this.label });
    if (this.attempts <= this.failBefore) throw new Error('Fixture retryable failure');
    if (this.hang) await new Promise(() => {});
    if (this.barrier) {
      while (!await client().get(this.barrier)) await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (this.duration) await new Promise(resolve => setTimeout(resolve, this.duration));
    await this.progress(100, 'finished');
    process.send?.({ event: 'finished', label: this.label, id: this.id });
  }
  retrying(attempt: number) { process.send?.({ event: 'retrying', label: this.label, attempts: attempt, context: ApplicationContext.snapshot() }); }
  failed(error: Error) { process.send?.({ event: 'failed', label: this.label, id: this.id, attempts: this.attempts, context: ApplicationContext.snapshot(), error: error.message }); }
}

export function configureFixture(prefix: string, queue = 'proof') {
  Queue.configure({ default: 'redis', connections: { redis: { driver: 'redis', url: process.env.SVELAR_TEST_QUEUE_REDIS_URL!, prefix } } });
  Queue.register(RecoveryFixtureJob);
  Queue.registerWorkerProfile({ name: 'proof-worker', queue, connection: 'redis', concurrency: 5, lockDuration: 800, stalledInterval: 500 });
}

if (process.env.SVELAR_QUEUE_CHILD === '1') {
  configureFixture(process.env.SVELAR_QUEUE_PREFIX!, process.env.SVELAR_QUEUE_NAME ?? 'proof');
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: process.env.SVELAR_QUEUE_DATABASE ?? ':memory:' } } });
  const command = new QueueWorkCommand();
  const options = Object.fromEntries(command.flags.map(flag => [flag.name, { type: flag.type, ...(flag.default !== undefined ? { default: flag.default } : {}) }]));
  const { values } = parseArgs({ args: process.argv.slice(2), options, strict: true });
  process.send?.({ event: 'ready' });
  try {
    await ApplicationContext.runIsolated({ teamId: 'worker-must-not-leak', userId: 'worker-must-not-leak' }, () => command.handle([], values));
    process.exitCode = command.exitCode;
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    await Queue.stop();
    await closeFixtureClient();
    await closeFixtureDatabase();
    process.send?.({ event: 'stopped' });
    process.disconnect?.();
  }
}
