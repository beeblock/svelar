import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { Connection, type DatabaseConfig } from '../src/database/Connection.js';
import { CreateWebhookInboxEntriesTable } from '../src/database/core/00000000_000029_create_webhook_inbox_entries_table.js';
import { ScopeWebhookInboxIdempotency } from '../src/database/core/00000000_000034_scope_webhook_inbox_idempotency.js';
import { AddWebhookInboxProcessing } from '../src/database/core/00000000_000037_add_webhook_inbox_processing.js';
import { CreateBackgroundOperationsTable } from '../src/database/core/00000000_000046_create_background_operations_table.js';
import { WebhookInbox, type IncomingWebhookSource } from '../src/webhooks/index.js';
import { BackgroundOperation, type OperationDefinition } from '../src/operations/index.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { ApplicationContext } from '../src/support/Context.js';
import { Queue } from '../src/queue/index.js';
import { Broadcast } from '../src/broadcasting/index.js';
import { Notification, Notifier } from '../src/notifications/index.js';

const secret = 'native-driver-fixture-signing-secret';
const originContext = { tenantId: 'tenant-a', teamId: 'tenant-a', actorId: 'actor-a', correlationId: 'native-origin' };
const workerContext = { tenantId: 'worker-tenant', teamId: 'worker-tenant', actorId: 'worker-actor' };
const inboxRows = () => new QueryBuilder('webhook_inbox_entries');
const operationRows = () => new QueryBuilder('background_operations');
const origin = <T>(callback: () => T) => ApplicationContext.runIsolated(originContext, callback);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const enabled = (value: unknown) => value === true || Number(value) === 1;

interface WorkerOptions {
  role: 'inbox' | 'inbox-replay' | 'operation' | 'operation-sweep';
  name: string;
  id?: string;
  hold?: boolean;
  fail?: boolean;
  notification?: boolean;
  failNotification?: boolean;
  holdNotification?: boolean;
}
interface WorkerEvent {
  type: string;
  id?: string;
  version?: number;
  context?: Record<string, unknown>;
  result?: any;
  message?: string;
}
interface Worker {
  child: ChildProcess;
  events: WorkerEvent[];
  output: string;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  exited: boolean;
}

async function until<T>(callback: () => Promise<T> | T, label: string, timeout = 15_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await callback();
    if (result) return result as NonNullable<T>;
    await delay(20);
  }
  throw new Error('Native fixture timed out: ' + label);
}

async function setup(config: DatabaseConfig): Promise<void> {
  assert.ok(config.driver === 'postgres' || config.driver === 'mysql');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.database, 'inbox_operation_proof');
  Connection.configure({ default: 'native', connections: { native: config } });
  Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
  Broadcast.configure({ default: 'sse', drivers: { sse: { driver: 'sse' } } });
  WebhookInbox.configure({ driver: 'database', table: 'webhook_inbox_entries' });
  await Connection.raw('SELECT 1 AS ready');
}

async function close(): Promise<void> {
  await Queue.stop();
  await Broadcast.drain();
  Broadcast.prune();
  ApplicationContext.clear();
  await Connection.disconnect();
}

function sourceDefinition(handler: IncomingWebhookSource['handler']): IncomingWebhookSource {
  return {
    verifier: WebhookInbox.hmacVerifier(secret),
    resolveTenant: (payload: any) => payload.tenant,
    idempotencyKey: (payload: any) => payload.event_id,
    orderingKey: (payload: any) => payload.resource,
    version: (payload: any) => payload.version,
    actorId: 'integration-actor',
    leaseSeconds: 1,
    retrySeconds: 2,
    maxAttempts: 2,
    handler,
  };
}

function register(name: string): void {
  WebhookInbox.registerSource(name, sourceDefinition(async () => {
    throw new Error('The supervisor must not execute inbox handlers.');
  }));
  BackgroundOperation.register(name, { leaseSeconds: 1, retrySeconds: 1, maxAttempts: 3,
    handle: async () => { throw new Error('The supervisor must not execute operation handlers.'); } });
}

async function capture(name: string, event: string, version = 1, resource = 'resource-a', padding = '') {
  const body = JSON.stringify({ event_id: event, tenant: 'tenant-a', resource, version, padding });
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return WebhookInbox.capture(name, new Request('https://native.test/webhooks/' + name, {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
  }));
}

async function dispatch(name: string) {
  return origin(() => BackgroundOperation.dispatch(name, { secretInput: 'private-input' },
    { label: 'Native operation', total: 2, returnUrl: '/exports/native' }));
}

function events(workers: Worker[], type: string): WorkerEvent[] {
  return workers.flatMap((worker) => worker.events.filter((event) => event.type === type));
}

function workerFailure(worker: Worker): void {
  const failure = worker.events.find((event) => event.type === 'error');
  if (failure) throw new Error(failure.message + '\n' + worker.output);
  if (worker.exited && !worker.events.some((event) => event.type === 'result')) {
    throw new Error('Native worker exited without a result.\n' + worker.output);
  }
}

async function startWorkers(config: DatabaseConfig, bundle: string, options: WorkerOptions, count: number, all: Worker[]) {
  const workers: Worker[] = [];
  for (let index = 0; index < count; index++) {
    const child = fork(bundle, [], { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, SVELAR_INBOX_OPERATION_WORKER: JSON.stringify({ config, options }) } });
    const worker: Worker = { child, events: [], output: '', exited: false,
      exit: new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => { worker.exited = true; resolve({ code, signal }); });
      }) };
    child.on('message', (message: WorkerEvent) => worker.events.push(message));
    child.stdout?.on('data', (data) => { worker.output += data; });
    child.stderr?.on('data', (data) => { worker.output += data; });
    all.push(worker);
    workers.push(worker);
  }
  await Promise.all(workers.map((worker) => until(() => {
    workerFailure(worker);
    return worker.events.some((event) => event.type === 'ready');
  }, 'worker ready')));
  for (const worker of workers) worker.child.send({ type: 'go' });
  return workers;
}

async function entered(workers: Worker[], type = 'started') {
  return until(() => {
    for (const worker of workers) if (!worker.exited) workerFailure(worker);
    const matches = events(workers, type);
    assert.ok(matches.length <= 1, 'More than one independent process acquired the same lease.');
    return matches.length === 1 && matches[0];
  }, 'exclusive handler entry');
}

function release(workers: Worker[]): void {
  for (const worker of workers) if (worker.child.connected) worker.child.send({ type: 'release' });
}

async function results(workers: Worker[]) {
  const responses = await Promise.all(workers.map(async (worker) => {
    await until(() => { workerFailure(worker); return worker.events.find((event) => event.type === 'result'); }, 'worker result');
    const outcome = await worker.exit;
    assert.deepEqual(outcome, { code: 0, signal: null }, worker.output);
    return worker.events.find((event) => event.type === 'result')!.result;
  }));
  return responses;
}

async function kill(worker: Worker): Promise<void> {
  assert.equal(worker.child.kill('SIGKILL'), true);
  assert.deepEqual(await worker.exit, { code: null, signal: 'SIGKILL' });
}

function assertHandlerContext(event: WorkerEvent, inbox = false): void {
  assert.equal(event.context?.tenantId, 'tenant-a');
  assert.equal(event.context?.teamId, 'tenant-a');
  assert.equal(event.context?.actorId, inbox ? 'integration-actor' : 'actor-a');
  if (!inbox) assert.equal(event.context?.correlationId, 'native-origin');
}

export async function migrate(config: DatabaseConfig): Promise<void> {
  await setup(config);
  try {
    await new CreateWebhookInboxEntriesTable().up();
    await new ScopeWebhookInboxIdempotency().up();
    await new AddWebhookInboxProcessing().up();
    await new CreateBackgroundOperationsTable().up();
  } finally { await close(); }
}

export async function ping(config: DatabaseConfig): Promise<void> {
  try { await setup(config); } finally { await close(); }
}

export async function proof(config: DatabaseConfig, scenario: string, bundle: string) {
  await setup(config);
  const all: Worker[] = [];
  const name = 'native.' + scenario;
  register(name);
  try {
    await inboxRows().delete();
    await operationRows().delete();
    let evidence: Record<string, unknown>;
    if (scenario === 'migrations') {
      const tables = config.driver === 'postgres'
        ? await Connection.raw("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
        : await Connection.raw('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()');
      assert.deepEqual(tables.map((row: any) => row.table_name ?? row.TABLE_NAME).sort(),
        ['background_operations', 'webhook_inbox_entries']);
      const columns = await Connection.raw('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? AND table_schema = ' +
        (config.driver === 'postgres' ? "'public'" : 'DATABASE()'), ['webhook_inbox_entries']);
      const types = Object.fromEntries(columns.map((row: any) => [row.column_name ?? row.COLUMN_NAME, row.data_type ?? row.DATA_TYPE]));
      for (const column of ['managed', 'lock_owner', 'locked_until', 'ordering_key', 'event_version', 'raw_body_encoding']) assert.ok(types[column], column);
      if (config.driver === 'mysql') { assert.equal(types.raw_body, 'longtext'); assert.equal(types.payload, 'longtext'); }
      const [version] = await Connection.raw('SELECT VERSION() AS version');
      evidence = { tables: tables.length, migrations: [29, 34, 37, 46], serverVersion: version.version, types };
    } else if (scenario === 'inbox.exclusive' || scenario === 'operation.exclusive') {
      const inbox = scenario.startsWith('inbox');
      const id = inbox ? (await capture(name, 'exclusive')).entry.id : (await dispatch(name)).id;
      const workers = await startWorkers(config, bundle, { role: inbox ? 'inbox' : 'operation', name, id, hold: true }, 5, all);
      const first = await entered(workers);
      assert.equal(first.id, id);
      assertHandlerContext(first, inbox);
      const rows = inbox ? inboxRows : operationRows;
      const initial = await rows().where('id', id).first();
      assert.equal(Number(initial.attempts), 1);
      assert.ok(initial.lock_owner);
      await until(async () => {
        const renewed = await rows().where('id', id).first();
        return Number(renewed.locked_until) > Number(initial.locked_until) + 1_000;
      }, 'multiple real heartbeat renewals');
      const contenders = await startWorkers(config, bundle, { role: inbox ? 'inbox' : 'operation', name, id }, 5, all);
      const rejected = await results(contenders);
      assert.equal(events([...workers, ...contenders], 'started').length, 1);
      assert.ok(rejected.every((result) => inbox ? result.processed === 0 : result === false));
      release(workers);
      const outcomes = await results(workers);
      assert.equal(outcomes.filter((result) => inbox ? result.processed === 1 : result === true).length, 1);
      const settled = await rows().where('id', id).first();
      assert.equal(inbox ? settled.status : settled.state, inbox ? 'processed' : 'succeeded');
      assert.equal(Number(settled.attempts), 1);
      assert.equal(settled.lock_owner, null);
      assert.equal(settled.locked_until, null);
      assert.equal(events(workers, 'finished').length, 1);
      evidence = { contenders: 10, handlerStarts: 1, completed: 1, attempts: 1, heartbeatRenewed: true };
    } else if (scenario === 'inbox.ordering') {
      const captured = [];
      for (const version of [3, 2, 1]) captured.push((await capture(name, 'version-' + version, version)).entry.id);
      const workers = await startWorkers(config, bundle, { role: 'inbox', name, hold: true }, 5, all);
      assert.equal((await entered(workers)).version, 1);
      await delay(150);
      assert.equal(events(workers, 'started').length, 1);
      release(workers);
      assert.equal((await results(workers)).reduce((sum, result) => sum + result.processed, 0), 3);
      assert.deepEqual(events(workers, 'started').map((event) => event.version), [1, 2, 3]);
      assert.deepEqual(events(workers, 'finished').map((event) => event.version), [1, 2, 3]);
      const stale = await capture(name, 'stale-version', 0);
      const equal = await capture(name, 'equal-version', 3);
      const ignored = await startWorkers(config, bundle, { role: 'inbox', name }, 1, all);
      assert.deepEqual(await results(ignored), [{ processed: 0, failed: 0, ignored: 2 }]);
      assert.equal(events(ignored, 'started').length, 0);
      for (const id of captured) assert.equal((await WebhookInbox.find(id))!.status, 'processed');
      for (const entry of [stale, equal]) assert.equal((await WebhookInbox.find(entry.entry.id))!.status, 'ignored');
      evidence = { receivedVersions: [3, 2, 1], handledVersions: [1, 2, 3], staleIgnored: 2, concurrentStarts: 1 };
    } else if (scenario === 'inbox.dead-worker' || scenario === 'operation.dead-worker') {
      const inbox = scenario.startsWith('inbox');
      const id = inbox ? (await capture(name, 'dead-worker')).entry.id : (await dispatch(name)).id;
      const dead = await startWorkers(config, bundle, { role: inbox ? 'inbox' : 'operation', name, id, hold: true }, 1, all);
      assertHandlerContext(await entered(dead), inbox);
      const rows = inbox ? inboxRows : operationRows;
      const leased = await rows().where('id', id).first();
      assert.ok(Number(leased.locked_until) > Date.now());
      await kill(dead[0]);
      const pending = await rows().where('id', id).first();
      assert.equal(Number(pending.attempts), 1);
      assert.equal(pending.lock_owner, leased.lock_owner);
      await until(() => Date.now() > Number(pending.locked_until) + 30, 'real dead-worker lease expiry');
      const replacements = await startWorkers(config, bundle, { role: inbox ? 'inbox' : 'operation', name, id, hold: true }, 5, all);
      const recovered = await entered(replacements);
      assertHandlerContext(recovered, inbox);
      const claimed = await rows().where('id', id).first();
      assert.notEqual(claimed.lock_owner, pending.lock_owner);
      assert.equal(Number(claimed.attempts), 2);
      release(replacements);
      const outcomes = await results(replacements);
      assert.equal(outcomes.filter((result) => inbox ? result.processed === 1 : result === true).length, 1);
      assert.equal(events(dead, 'finished').length, 0);
      assert.equal(events(replacements, 'finished').length, 1);
      const settled = await rows().where('id', id).first();
      assert.equal(inbox ? settled.status : settled.state, inbox ? 'processed' : 'succeeded');
      assert.equal(settled.lock_owner, null);
      evidence = { signal: 'SIGKILL', originalAttempts: 1, recoveredAttempts: 2, replacementContenders: 5, completed: 1 };
    } else if (scenario === 'inbox.retry-dlq') {
      const failed = await capture(name, 'retry-before-dlq', 1);
      const later = await capture(name, 'blocked-later-version', 2);
      const first = await startWorkers(config, bundle, { role: 'inbox', name, fail: true }, 1, all);
      assert.deepEqual(await results(first), [{ processed: 0, failed: 1, ignored: 0 }]);
      const retry = await inboxRows().where('id', failed.entry.id).first();
      assert.equal(Number(retry.attempts), 1);
      assert.ok(Number(retry.available_at) > Date.now());
      assert.ok(!retry.error.includes('do-not-store-this'));
      const early = await startWorkers(config, bundle, { role: 'inbox', name }, 1, all);
      assert.deepEqual(await results(early), [{ processed: 0, failed: 0, ignored: 0 }]);
      await until(() => Date.now() >= Number(retry.available_at), 'actual retry deadline');
      const second = await startWorkers(config, bundle, { role: 'inbox', name, fail: true }, 1, all);
      assert.deepEqual(await results(second), [{ processed: 0, failed: 1, ignored: 0 }]);
      const dlq = await inboxRows().where('id', failed.entry.id).first();
      assert.equal(Number(dlq.attempts), 2);
      assert.equal(dlq.available_at, null);
      assert.equal(dlq.status, 'failed');
      const blocked = await startWorkers(config, bundle, { role: 'inbox', name }, 1, all);
      assert.deepEqual(await results(blocked), [{ processed: 0, failed: 0, ignored: 0 }]);
      assert.equal((await WebhookInbox.find(later.entry.id))!.status, 'received');
      const replayers = await startWorkers(config, bundle, { role: 'inbox-replay', name, id: failed.entry.id }, 5, all);
      const accepted = (await results(replayers)).filter(Boolean);
      assert.equal(accepted.length, 1);
      const replacement = await startWorkers(config, bundle, { role: 'inbox', name }, 1, all);
      assert.deepEqual(await results(replacement), [{ processed: 2, failed: 0, ignored: 0 }]);
      assert.deepEqual(events(replacement, 'finished').map((event) => event.version), [1, 2]);
      assert.equal(await inboxRows().count(), 2);
      evidence = { failedAttempts: 2, scheduledRetry: true, dlqBlockedNewer: true, replayContenders: 5, replayWinners: 1, completedAfterReplay: 2 };
    } else if (scenario === 'inbox.large-binary') {
      const bytes = new Uint8Array(96 * 1024 + 17);
      for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;
      const signature = createHmac('sha256', secret).update(bytes).digest('hex');
      const input = { source: name, tenantId: 'tenant-a', actorId: 'integration-actor', managed: true,
        rawBody: bytes, headers: { 'x-webhook-signature': signature }, verifier: WebhookInbox.hmacVerifier(secret) };
      const receipt = await WebhookInbox.receive(input);
      const duplicate = await WebhookInbox.receive(input);
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.entry.id, receipt.entry.id);
      const loaded = (await WebhookInbox.find(receipt.entry.id))!;
      assert.equal(loaded.rawBodyEncoding, 'base64');
      assert.deepEqual(WebhookInbox.bodyBytes(loaded), bytes);
      assert.equal(loaded.digest, createHash('sha256').update(bytes).digest('hex'));
      await assert.rejects(WebhookInbox.receive({ ...input, headers: { 'x-webhook-signature': signature + 'invalid' } }));
      const json = await capture(name, 'large-json', 1, 'large-json-resource', 'p'.repeat(96 * 1024));
      assert.equal((await WebhookInbox.find(json.entry.id))!.payload.padding.length, 96 * 1024);
      const workers = await startWorkers(config, bundle, { role: 'inbox', name }, 1, all);
      assert.deepEqual(await results(workers), [{ processed: 2, failed: 0, ignored: 0 }]);
      const binary = events(workers, 'finished').find((event) => event.id === receipt.entry.id)!.result;
      assert.equal(binary.byteLength, bytes.byteLength);
      assert.equal(binary.digest, loaded.digest);
      assert.deepEqual(WebhookInbox.bodyBytes((await WebhookInbox.find(receipt.entry.id))!), bytes);
      assert.equal(await inboxRows().count(), 2);
      evidence = { binaryBytes: bytes.byteLength, jsonPaddingBytes: 96 * 1024, exactBytes: true, authenticated: true, rejectedForgedSignature: true, processed: 2 };
    } else if (scenario === 'operation.cancel') {
      const operation = await dispatch(name);
      const workers = await startWorkers(config, bundle, { role: 'operation', name, id: operation.id, hold: true }, 1, all);
      await entered(workers);
      assert.equal(await origin(() => BackgroundOperation.cancel(operation.id)), true);
      await until(() => events(workers, 'aborted').length === 1, 'cooperative abort signal after heartbeat');
      release(workers);
      assert.deepEqual(await results(workers), [true]);
      assert.equal(events(workers, 'finished')[0].result.cancelled, true);
      const settled = await origin(() => BackgroundOperation.find(operation.id));
      assert.equal(settled!.state, 'cancelled');
      assert.equal(settled!.result, null);
      assert.equal((await operationRows().where('id', operation.id).first()).lock_owner, null);
      const repeat = await startWorkers(config, bundle, { role: 'operation', name, id: operation.id }, 1, all);
      assert.deepEqual(await results(repeat), [false]);
      assert.equal(events(repeat, 'started').length, 0);
      evidence = { cancelAccepted: true, abortObserved: true, state: settled!.state, result: null, repeatedHandlers: 0 };
    } else if (scenario === 'operation.boundaries') {
      const owner = await dispatch(name);
      const contexts = [{ tenantId: 'tenant-a', actorId: 'foreign-actor' },
        { tenantId: 'foreign-tenant', actorId: 'actor-a' }, { actorId: 'actor-a' }];
      for (const context of contexts) await ApplicationContext.runIsolated(context, async () => {
        assert.equal(await BackgroundOperation.find(owner.id), null);
        assert.deepEqual((await BackgroundOperation.list()).data, []);
        assert.equal(await BackgroundOperation.cancel(owner.id), false);
      });
      const other = await ApplicationContext.runIsolated(contexts[1], () =>
        BackgroundOperation.dispatch(name, {}, { label: 'Same actor, different tenant' }));
      const unscoped = await ApplicationContext.runIsolated(contexts[2], () =>
        BackgroundOperation.dispatch(name, {}, { label: 'Same actor, platform scope' }));
      const owned = await origin(() => BackgroundOperation.list());
      assert.deepEqual(owned.data.map((entry) => entry.id), [owner.id]);
      assert.ok(!('payload' in owned.data[0]) && !('context' in owned.data[0]));
      assert.notEqual(BackgroundOperation.channel(owner), BackgroundOperation.channel(other));
      assert.notEqual(BackgroundOperation.channel(owner), BackgroundOperation.channel(unscoped));
      await assert.rejects(ApplicationContext.runIsolated({}, () => BackgroundOperation.find(owner.id)), /actor/);
      await assert.rejects(ApplicationContext.runIsolated({ tenantId: 'one', teamId: 'two', actorId: 'actor-a' },
        () => BackgroundOperation.dispatch(name, {}, { label: 'Conflicting tenant' })), /inconsistent/);
      assert.equal(await origin(() => BackgroundOperation.cancel(owner.id)), true);
      const workers = await startWorkers(config, bundle, { role: 'operation', name, id: owner.id }, 1, all);
      assert.deepEqual(await results(workers), [false]);
      assert.equal(events(workers, 'started').length, 0);
      evidence = { deniedContexts: contexts.length, ownedRecords: 1, distinctChannels: 3, cancelledBeforeExecution: true, handlers: 0 };
    } else if (scenario === 'operation.notifier-retry') {
      const operation = await dispatch(name);
      const initial = await startWorkers(config, bundle, { role: 'operation', name, id: operation.id,
        notification: true, failNotification: true }, 1, all);
      assert.deepEqual(await results(initial), [true]);
      assert.equal(events(initial, 'started').length, 1);
      assert.equal(events(initial, 'notifying').length, 1);
      assert.equal(events(initial, 'notified').length, 0);
      const pending = await operationRows().where('id', operation.id).first();
      assert.equal(pending.state, 'succeeded');
      assert.equal(enabled(pending.notification_pending), true);
      assert.equal(pending.lock_owner, null);
      const retries = await startWorkers(config, bundle, { role: 'operation-sweep', name, id: operation.id,
        notification: true, holdNotification: true }, 5, all);
      assertHandlerContext(await entered(retries, 'notifying'));
      assert.equal(events(retries, 'started').length, 0);
      assert.ok((await operationRows().where('id', operation.id).first()).lock_owner);
      release(retries);
      assert.deepEqual(await results(retries), [0, 0, 0, 0, 0]);
      assert.equal(events(retries, 'notifying').length, 1);
      assert.equal(events(retries, 'notified').length, 1);
      const settled = await operationRows().where('id', operation.id).first();
      assert.equal(enabled(settled.notification_pending), false);
      assert.equal(Number(settled.attempts), 1);
      assert.equal(settled.state, 'succeeded');
      assert.equal(settled.lock_owner, null);
      evidence = { operationHandlers: 1, failedNotifications: 1, retryContenders: 5, successfulNotifications: 1, repeatedOperationHandlers: 0 };
    } else throw new Error('Unknown native scenario: ' + scenario);
    return { scenario, driver: config.driver, passed: true, evidence };
  } finally {
    for (const worker of all) {
      if (!worker.exited) worker.child.kill('SIGKILL');
      await worker.exit;
    }
    await close();
  }
}

async function workerMain(config: DatabaseConfig, options: WorkerOptions): Promise<void> {
  let unlock!: () => void;
  const gate = new Promise<void>((resolve) => { unlock = resolve; });
  let go!: () => void;
  const ready = new Promise<void>((resolve) => { go = resolve; });
  const send = (event: WorkerEvent) => process.send?.(event);
  process.on('message', (message: { type: string }) => {
    if (message.type === 'release') unlock();
    if (message.type === 'go') go();
  });
  await setup(config);
  WebhookInbox.registerSource(options.name, sourceDefinition(async (entry) => {
    send({ type: 'started', id: entry.id, version: entry.payload?.version, context: ApplicationContext.snapshot() });
    if (options.hold) await gate;
    if (options.fail) throw new Error('password=do-not-store-this provider unavailable');
    const bytes = WebhookInbox.bodyBytes(entry);
    send({ type: 'finished', id: entry.id, version: entry.payload?.version,
      result: { byteLength: bytes.byteLength, digest: createHash('sha256').update(bytes).digest('hex') } });
  }));
  class NativeReady extends Notification { channels() { return ['native-proof']; } }
  Notifier.configure({ channels: { 'native-proof': { driver: 'custom', handler: { send: async (recipient) => {
    assert.equal(recipient.getAttribute('id'), 'actor-a');
    send({ type: 'notifying', id: options.id, context: ApplicationContext.snapshot() });
    if (options.failNotification) throw new Error('Fixture delivery provider unavailable');
    if (options.holdNotification) await gate;
    send({ type: 'notified', id: options.id, context: ApplicationContext.snapshot() });
  } } } } });
  const definition: OperationDefinition = { leaseSeconds: 1, retrySeconds: 1, maxAttempts: 3,
    handle: async (execution) => {
      assert.notEqual(options.role, 'operation-sweep', 'A notification retry repeated the operation handler.');
      assert.deepEqual(execution.payload, { secretInput: 'private-input' });
      await execution.report(1);
      execution.signal.addEventListener('abort', () => send({ type: 'aborted', id: execution.operation.id }), { once: true });
      send({ type: 'started', id: execution.operation.id, context: ApplicationContext.snapshot() });
      if (options.hold) await gate;
      const cancelled = await execution.isCancelled();
      if (!cancelled) await execution.report(2);
      send({ type: 'finished', id: execution.operation.id, result: { cancelled, aborted: execution.signal.aborted } });
      return { download: '/exports/native' };
    },
    ...(options.notification ? { notify: async () => ({
      recipient: { getAttribute: () => 'actor-a' }, notification: new NativeReady(),
    }) } : {}),
  };
  BackgroundOperation.register(options.name, definition);
  send({ type: 'ready' });
  await ready;
  const result = await ApplicationContext.runIsolated(workerContext, async () => {
    let outcome: unknown;
    if (options.role === 'inbox') outcome = await WebhookInbox.process(options.name);
    else if (options.role === 'inbox-replay') outcome = !!await WebhookInbox.replay(options.id!);
    else if (options.role === 'operation') outcome = await BackgroundOperation.process(options.id!);
    else outcome = await BackgroundOperation.sweep();
    assert.deepEqual(ApplicationContext.snapshot(), workerContext, 'Handler context leaked into the worker.');
    return outcome;
  });
  send({ type: 'result', result });
}

if (process.env.SVELAR_INBOX_OPERATION_WORKER) {
  const { config, options } = JSON.parse(process.env.SVELAR_INBOX_OPERATION_WORKER);
  // An interrupted supervisor must not leave a child renewing database leases.
  const orphaned = () => process.exit(1);
  process.once('disconnect', orphaned);
  try { await workerMain(config, options); }
  catch (error) {
    process.send?.({ type: 'error', message: error instanceof Error ? error.stack : String(error) });
    process.exitCode = 1;
  } finally {
    await close();
    process.removeListener('disconnect', orphaned);
    process.disconnect?.();
  }
}
