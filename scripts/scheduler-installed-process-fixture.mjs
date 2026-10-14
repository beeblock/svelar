#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

export const fixturePublicApi = {
  database: ['Connection.configure', 'Connection.rawClient', 'Connection.disconnect', 'Migration', 'CreateSessionsTable',
    'CreateAuditLogsTable', 'CreateSchedulerLocksTable', 'CreateScheduledTaskRunsTable', 'CreateScheduledTaskSettingsTable',
    'AddSchedulerSettingsPolicy', 'CreateSchedulerRuntimeTable', 'CreateSchedulerRequestsTable'],
  orm: ['Model', 'Model.create', 'Model.query', 'Model.prototype.getAttribute', 'Model.prototype.toJSON', 'QueryBuilder',
    'QueryBuilder.prototype.where', 'QueryBuilder.prototype.orderBy', 'QueryBuilder.prototype.get'],
  scheduler: ['Scheduler', 'task', 'Scheduler.prototype.register', 'Scheduler.prototype.configureTask', 'Scheduler.prototype.start',
    'Scheduler.prototype.stop', 'Scheduler.prototype.getRuntimeStatus', 'Scheduler.prototype.getRuntimeStore',
    'Scheduler.prototype.listTaskStatuses', 'Scheduler.prototype.getRunRequest'],
  'scheduler/ScheduleMonitor': ['ScheduleMonitor.configure'], support: ['ApplicationContext.get'],
  hashing: ['Hash.configure', 'Hash.make'], auth: ['AuthManager', 'AuthManager.prototype.attempt', 'AuthenticateMiddleware'],
  session: ['DatabaseSessionStore', 'SessionMiddleware'],
  middleware: ['MiddlewareStack', 'MiddlewareStack.prototype.use', 'MiddlewareStack.prototype.execute', 'OriginMiddleware', 'CsrfMiddleware'],
  routing: ['Controller', 'Controller.prototype.handle', 'Controller.prototype.json', 'FormRequest', 'FormRequest.validate'],
  actions: ['Action', 'Action.prototype.run'], services: ['Service'], validation: ['z.object', 'z.string'],
  dashboard: ['DashboardController', 'DashboardController.prototype.scheduler', 'DashboardController.prototype.toggleTask',
    'DashboardController.prototype.runTask'],
};

export function fixtureEntryTarget(manifest, subpath) {
  const entry = manifest.exports?.['./' + subpath];
  for (const [condition, extension] of [['import', '.js'], ['types', '.d.ts']]) {
    const target = entry?.[condition];
    assert(typeof target === 'string' && target.startsWith('./dist/') && target.endsWith(extension)
      && !target.includes('\\') && !target.slice(2).split('/').some((part) => !part || part === '..' || part === '.'),
    `Missing public installed ${condition} export: ${subpath}`);
  }
  return entry.import;
}

export function assertFixtureApi(subpath, namespace) {
  assert(Object.hasOwn(fixturePublicApi, subpath), `Unknown fixture API contract: ${subpath}`);
  for (const member of fixturePublicApi[subpath]) {
    const value = member.split('.').reduce((current, key) => current?.[key], namespace);
    assert.equal(typeof value, 'function', `Missing installed public API: ${subpath}:${member}`);
  }
}

export async function importFixtureApi(packageRoot, manifest, subpath, entries = {}) {
  const path = resolve(packageRoot, fixtureEntryTarget(manifest, subpath));
  entries[subpath] = createHash('sha256').update(await readFile(path)).digest('hex');
  const namespace = await import(pathToFileURL(path).href);
  assertFixtureApi(subpath, namespace);
  return namespace;
}

export async function fixtureMain(role, input, send = (value) => new Promise((accept, reject) => {
  if (!process.connected) { reject(new Error('Fixture IPC disconnected.')); return; }
  process.send(value, (error) => error ? reject(error) : accept());
})) {
  assert(['initialize', 'web', 'scheduler'].includes(role), 'Unknown installed fixture role.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert(major > 22 || major === 22 && minor >= 12, 'Installed acceptance requires Node >=22.12.');
  assert.equal(await readFile(resolve(input.packageRoot, 'package.json')).then((bytes) => createHash('sha256').update(bytes).digest('hex')), input.manifestSha256, 'Installed manifest changed before child startup.');
  assert.equal(dirname(resolve(input.database)), resolve(input.directory), 'Fixture database must be in its owned directory.');
  const manifest = JSON.parse(await readFile(resolve(input.packageRoot, 'package.json'), 'utf8'));
  const entries = {};
  const installed = (subpath) => importFixtureApi(input.packageRoot, manifest, subpath, entries);
  const database = await installed('database');
  const { Connection, Migration } = database;
  const { Model, QueryBuilder } = await installed('orm');
  const { Scheduler, task } = await installed('scheduler');
  const { ScheduleMonitor } = await installed('scheduler/ScheduleMonitor');
  const { ApplicationContext } = await installed('support');
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: input.database } } });
  const native = await Connection.rawClient();
  // SQLite coordination is infrastructure: use WAL and wait for actual lock owners, never retry mutations.
  native.pragma('busy_timeout = 5000');
  const journal = native.pragma('journal_mode');
  assert(journal.some((row) => String(row.journal_mode).toLowerCase() === 'wal'), 'Native fixture requires SQLite WAL.');

  class FixtureUser extends Model {
    static table = 'scheduler_acceptance_users'; static timestamps = false;
    static fillable = ['email', 'password', 'role'];
  }
  class Execution extends Model {
    static table = 'scheduler_acceptance_executions'; static timestamps = false;
    static fillable = ['pid', 'task', 'scheduled_for', 'request_id', 'ran_at'];
  }
  class CreateFixtureUsers extends Migration {
    async up() { await this.schema.createTable(FixtureUser.table, (table) => {
      table.increments('id'); table.string('email').unique(); table.string('password'); table.string('role');
    }); }
    async down() { await this.schema.dropTableIfExists(FixtureUser.table); }
  }
  class CreateFixtureExecutions extends Migration {
    async up() { await this.schema.createTable(Execution.table, (table) => {
      table.increments('id'); table.integer('pid'); table.string('task'); table.timestamp('scheduled_for').nullable();
      table.string('request_id').nullable(); table.timestamp('ran_at');
    }); }
    async down() { await this.schema.dropTableIfExists(Execution.table); }
  }
  const scheduler = new Scheduler({ persistent: true, timezone: 'UTC', heartbeatMilliseconds: 250 }).register(task(input.taskName, async () => {
    assert.equal(role, 'scheduler', 'The HTTP process must never execute the scheduled handler.');
    const execution = ApplicationContext.get('scheduler');
    await Execution.create({ pid: process.pid, task: input.taskName, scheduled_for: execution?.scheduledFor?.toISOString() ?? null,
      request_id: execution?.requestId ?? null, ran_at: new Date().toISOString() });
  }, (job) => job.everyMinute().preventOverlap().lockExpiresAfter(0.05).missedRuns('skip', { windowMinutes: 10, maxRuns: 1 })));
  ScheduleMonitor.configure(scheduler);

  if (role === 'initialize') {
    try {
      for (const name of ['CreateSessionsTable', 'CreateAuditLogsTable', 'CreateSchedulerLocksTable', 'CreateScheduledTaskRunsTable',
        'CreateScheduledTaskSettingsTable', 'AddSchedulerSettingsPolicy', 'CreateSchedulerRuntimeTable', 'CreateSchedulerRequestsTable']) {
        assert.equal(typeof database[name], 'function', `Missing public core migration ${name}`);
        await new database[name]().up();
      }
      await new CreateFixtureUsers().up(); await new CreateFixtureExecutions().up();
      const { Hash } = await installed('hashing'); Hash.configure({ driver: 'scrypt' });
      // Fixture assignments are private test setup, not production seeder or authorization overrides.
      await FixtureUser.create({ email: input.email, password: await Hash.make(input.password), role: 'admin' });
      await scheduler.configureTask(input.taskName, { enabled: true, timezone: 'UTC', missedRun: { policy: 'skip', windowMinutes: 10, maxRuns: 1 } });
      await send({ type: 'ready', pid: process.pid, entries, journalMode: 'wal', migrated: true });
    } finally { await Connection.disconnect(); }
    return;
  }

  const snapshot = async (requestId) => {
    assert.equal(scheduler.getRuntimeStatus().failures, 0, 'Scheduler reported a genuine runtime failure.');
    return { pid: process.pid, journalMode: 'wal', busyTimeoutMs: 5000, daemon: scheduler.getRuntimeStatus(),
      status: (await scheduler.listTaskStatuses())[0], settings: await scheduler.getRuntimeStore().settings(input.taskName),
      runtime: await scheduler.getRuntimeStore().task(input.taskName), processes: await scheduler.getRuntimeStore().processes(),
      executions: (await Execution.query().orderBy('id').get()).map((value) => value.toJSON()),
      history: await new QueryBuilder('scheduled_task_runs').where('task', input.taskName).orderBy('id').get(),
      request: requestId ? await scheduler.getRunRequest(input.taskName, requestId) : null };
  };
  let server; let stopping = false; let stopWork;
  const stop = () => {
    if (stopWork) return stopWork;
    stopping = true;
    stopWork = (async () => {
      if (server) await new Promise((accept, reject) => {
        server.close((error) => error ? reject(error) : accept()); server.closeIdleConnections();
      });
      await scheduler.stop(); await Connection.disconnect();
    })();
    return stopWork;
  };

  if (role === 'web') {
    const { AuthManager, AuthenticateMiddleware } = await installed('auth');
    const { Hash } = await installed('hashing'); Hash.configure({ driver: 'scrypt' });
    const { DatabaseSessionStore, SessionMiddleware } = await installed('session');
    const { MiddlewareStack, OriginMiddleware, CsrfMiddleware } = await installed('middleware');
    const { Controller, FormRequest } = await installed('routing');
    const { Action } = await installed('actions'); const { Service } = await installed('services');
    const { z } = await installed('validation');
    const { DashboardController } = await installed('dashboard');
    const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
    class LoginDto { constructor(data) { this.email = data.email; this.password = data.password; } }
    class LoginRequest extends FormRequest {
      rules() { return loginSchema; }
      authorize(event) { return event.request.method === 'POST' && event.url.pathname === '/login'; }
      passedValidation(data) { return new LoginDto(data); }
    }
    class LoginService extends Service {
      constructor(event) { super(); this.event = event; }
      signIn(dto) { return this.event.locals.auth.attempt({ email: dto.email, password: dto.password }, this.event.locals.session); }
    }
    class LoginAction extends Action {
      constructor(event) { super(); this.service = new LoginService(event); }
      execute(dto) { return this.service.signIn(dto); }
    }
    class LoginController extends Controller {
      async login(event) {
        const dto = await LoginRequest.validate(event);
        const user = await new LoginAction(event).run(dto);
        return this.json({ data: user ? { id: user.getAttribute('id') } : null, meta: {} }, user ? 200 : 401);
      }
      async bootstrap() { return this.json({ data: { pid: process.pid }, meta: {} }); }
    }
    const auth = new AuthManager({ guard: 'session', model: FixtureUser });
    const stack = new MiddlewareStack().use(new SessionMiddleware({ secret: input.secret, store: new DatabaseSessionStore(), lifetime: 1800, secure: false }))
      .use(new AuthenticateMiddleware(auth)).use(new OriginMiddleware()).use(new CsrfMiddleware());
    const dashboard = new DashboardController(); const login = new LoginController();
    server = createServer(async (request, response) => {
      try {
        let length = 0; const chunks = [];
        for await (const chunk of request) { length += chunk.length; assert(length <= 32768, 'HTTP fixture request exceeds 32KiB.'); chunks.push(chunk); }
        const url = new URL(request.url, `http://127.0.0.1:${server.address().port}`);
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        const event = { request: new Request(url, { method: request.method, headers,
          ...(!['GET', 'HEAD'].includes(request.method) ? { body: Buffer.concat(chunks) } : {}) }), url,
          params: { name: input.taskName }, locals: {}, getClientAddress: () => request.socket.remoteAddress };
        const ctx = { event, params: event.params, locals: event.locals };
        const output = await stack.execute(ctx, async () => {
          if (url.pathname === '/bootstrap' && request.method === 'GET') return login.handle('bootstrap')(event);
          if (url.pathname === '/login' && request.method === 'POST') return login.handle('login')(event);
          if (url.pathname === '/scheduler' && request.method === 'GET') return dashboard.handle('scheduler')(event);
          if (url.pathname === '/scheduler/toggle' && request.method === 'POST') return dashboard.handle('toggleTask')(event);
          if (url.pathname === '/scheduler/run' && request.method === 'POST') return dashboard.handle('runTask')(event);
          return Response.json({ data: null, meta: { code: 'NOT_FOUND' } }, { status: 404 });
        });
        assert(output instanceof Response);
        response.statusCode = output.status;
        for (const [name, value] of output.headers) if (name !== 'set-cookie') response.setHeader(name, value);
        response.setHeader('set-cookie', output.headers.getSetCookie());
        response.end(Buffer.from(await output.arrayBuffer()));
      } catch (error) {
        console.error('Fixture HTTP failure:', error.message);
        response.statusCode = 500; response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: null, meta: { code: 'FIXTURE_HTTP_FAILURE' } }));
      }
    });
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  }

  let requests = Promise.resolve();
  process.on('message', (message) => {
    requests = requests.then(async () => {
      try {
        assert(!stopping, 'Fixture is stopping.');
        let data;
        if (message.type === 'start') { assert.equal(role, 'scheduler'); scheduler.start(); data = { pid: process.pid, running: scheduler.getRuntimeStatus().running }; }
        else if (message.type === 'snapshot') data = await snapshot(message.requestId);
        else throw new Error('Unknown fixture RPC.');
        await send({ id: message.id, data });
      } catch (error) { await send({ id: message.id, error: error.message }); }
    }).catch((error) => { console.error('Fixture IPC failure:', error.message); process.exitCode = 1; void stop().finally(() => process.disconnect()); });
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    void stop().then(() => { process.exitCode = 0; if (process.connected) process.disconnect(); })
      .catch((error) => { console.error('Fixture shutdown failed:', error.message); process.exitCode = 1; if (process.connected) process.disconnect(); });
  });
  process.on('disconnect', () => { void stop().catch((error) => { console.error('Orphaned fixture shutdown failed:', error.message); process.exitCode = 1; }); });
  await send({ type: 'ready', pid: process.pid, entries, snapshot: await snapshot(),
    ...(server ? { origin: `http://127.0.0.1:${server.address().port}` } : {}) });
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    let bytes = '';
    for await (const chunk of process.stdin) { bytes += chunk; assert(bytes.length <= 65536, 'Fixture initialization too large.'); }
    await fixtureMain(process.argv[2], JSON.parse(bytes));
    if (process.argv[2] === 'initialize' && process.connected) process.disconnect();
  } catch (error) {
    if (process.connected) await new Promise((done) => process.send({ type: 'fatal', error: error.message, stack: error.stack }, () => done()));
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
}
