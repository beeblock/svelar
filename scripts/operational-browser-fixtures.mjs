import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
export const fixtureSecret = 'OPERATIONAL_BROWSER_SECRET_MUST_NOT_RENDER';
export const dockerOwnerLabel = 'dev.svelar.operational-browser';
const queueScope = { queue: 'default', connection: 'redis' };
const failureNames = ['inspect', 'retry-safe', 'retry-busy', 'cleanup-safe', 'cleanup-busy', 'pagination'];

export async function bounded(work, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function waitUntil(probe, { timeoutMs = 30000, intervalMs = 100, label = 'Operational fixture state' } = {}) {
  let finished = false;
  try {
    return await bounded(async () => {
      while (!finished) {
        const result = await probe();
        if (finished) return;
        if (result) return result;
        await new Promise((done) => setTimeout(done, intervalMs));
      }
    }, timeoutMs, label);
  } finally { finished = true; }
}

export function managedProcess(command, args, options = {}) {
  const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const process = { child, output: '', error: null, settled: false };
  process.closed = new Promise((done) => {
    child.once('error', (error) => { process.error = error; });
    child.once('close', (code, signal) => { process.settled = true; done({ code, signal }); });
  });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (data) => {
    process.output = (process.output + data).slice(-12000);
  });
  return process;
}

function signalOwned(process, signal) {
  if (process.settled || !process.child.pid) return;
  try { globalThis.process.kill(-process.child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

export async function stopManagedProcess(process, { timeoutMs = 10000, killTimeoutMs = 3000 } = {}) {
  if (process.settled) return process.closed;
  signalOwned(process, 'SIGTERM');
  try { return await bounded(() => process.closed, timeoutMs, 'Owned process shutdown'); }
  catch (error) {
    signalOwned(process, 'SIGKILL');
    await bounded(() => process.closed, killTimeoutMs, 'Owned process forced shutdown');
    throw error;
  }
}

export async function runCommand(command, args, options = {}) {
  const process = managedProcess(command, args, options);
  try {
    const result = await bounded(() => process.closed, 30000, `${command} ${args[0] ?? ''}`);
    if (process.error) throw process.error;
    if (result.code !== 0) throw new Error(`${command} ${args[0] ?? ''} failed (${result.code ?? result.signal}): ${process.output}`);
    return process.output.trim();
  } finally { if (!process.settled) await stopManagedProcess(process); }
}

export function assertOwnedContainer(inspect, runId) {
  if (!runId || inspect?.Config?.Labels?.[dockerOwnerLabel] !== runId) {
    throw new Error('Refusing to remove a container without this run\'s exact ownership label.');
  }
}

async function unusedPort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  return port;
}

export function validateDeepTarget({ noServer, port, baseUrl }) {
  if (noServer) throw new Error('--operational-deep owns a disposable server; --no-server is not supported.');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || [5330, 5798].includes(port)) {
    throw new Error('Operational browser HTTP port must be a nonprivileged owned port, not 5330 or 5798.');
  }
  if (baseUrl !== `http://127.0.0.1:${port}`) throw new Error('Operational browser base URL must match its owned loopback port.');
}

export function assertOperationalBatch(body, acceptedId, busyId, source = 'live') {
  const results = body.data?.data?.results;
  if (body.data?.partial !== true || !Array.isArray(results) || results.length !== 2
    || body.data.data.failures?.length !== 0
    || !results.some((result) => result.id === acceptedId && result.source === source && result.outcome === 'accepted')
    || !results.some((result) => result.id === busyId && result.source === source && result.outcome === 'busy')) {
    throw new Error(`Expected one accepted and one retained busy record: ${JSON.stringify(body)}`);
  }
}

export function assertSafeOperationalJob(job) {
  if (job?.status !== 'failed' || job.connection !== queueScope.connection || job.queue !== queueScope.queue
    || !job.error?.includes('Operational fixture mail failure') || !Array.isArray(job.stacktrace) || !job.stacktrace.length
    || job.stacktrace.length > 5 || job.stacktrace.reduce((total, trace) => total + trace.length, 0) > 32000
    || JSON.stringify(job).includes(fixtureSecret) || !JSON.stringify(job).includes('[redacted]')) {
    throw new Error('Failed-job page did not expose bounded, redacted real error/stack diagnostics in the selected connection and queue.');
  }
}

async function digest(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }

export async function lockedArtifact(sourceApp, lock, expectedSha256) {
  const entry = lock.packages?.['node_modules/@beeblock/svelar'];
  if (entry?.link || !entry?.resolved?.startsWith('file:') || !entry.resolved.endsWith('.tgz') || !entry.integrity?.startsWith('sha512-')) {
    throw new Error('Operational smoke requires a lockfile-pinned installed core tarball, not a linked/source dependency.');
  }
  const path = resolve(sourceApp, entry.resolved.slice(5));
  const data = await readFile(path);
  const integrity = 'sha512-' + createHash('sha512').update(data).digest('base64');
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (integrity !== entry.integrity || expectedSha256 && sha256 !== expectedSha256) {
    throw new Error('Installed core lockfile or expected immutable tarball SHA does not match the artifact.');
  }
  return { path, sha256, integrity, resolved: entry.resolved };
}

export function installedImportPath(packagePath, packageJson, subpath) {
  const exported = packageJson.exports?.[`./${subpath}`];
  const target = typeof exported === 'string' ? exported : exported?.import;
  if (typeof target !== 'string' || !target.startsWith('./dist/') || target.includes('..')) {
    throw new Error(`Installed package has no public built ESM export for ${subpath}.`);
  }
  return resolve(dirname(packagePath), target);
}

export async function prepareOperationalFixture(sourceApp, { baseUrl, evidenceDir, expectedCoreSha256 } = {}) {
  sourceApp = await realpath(sourceApp);
  const require = createRequire(join(sourceApp, 'package.json'));
  const packagePath = await realpath(require.resolve('@beeblock/svelar/package.json'));
  if (!packagePath.includes('/node_modules/@beeblock/svelar/')) throw new Error('Operational smoke requires an actually installed core package, not a source alias or workspace link.');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  const artifact = await lockedArtifact(sourceApp, JSON.parse(await readFile(join(sourceApp, 'package-lock.json'), 'utf8')), expectedCoreSha256);
  const databaseConfig = JSON.parse(await readFile(join(sourceApp, 'svelar.database.json'), 'utf8'));
  const database = databaseConfig.connections?.[databaseConfig.default];
  if (database?.driver !== 'sqlite' || !database.filename || database.filename === ':memory:') {
    throw new Error('Operational smoke requires a migrated installed SQLite app for read-only online backup.');
  }
  const runId = randomUUID();
  const root = await mkdtemp(join(dirname(sourceApp), '.operational-browser-'));
  const appDir = join(root, 'app');
  evidenceDir = resolve(evidenceDir ?? join(dirname(dirname(sourceApp)), 'artifacts', 'operational-browser', runId));
  const evidence = { runId, mode: 'operational-deep', status: 'running', sourceApp, appDir, baseUrl,
    installed: { version: packageJson.version, packagePath, artifact, entries: {} }, node: process.version, scope: queueScope,
    sourceHashes: {}, checks: [], timeline: [], screenshots: [], cleanup: [] };
  const processes = [];
  let containerCreated = false;
  let service;
  let credentials;
  const workers = [];
  const containerName = `svelar-operational-browser-${runId}`;
  const record = (stage, details = {}) => { evidence.timeline.push({ at: new Date().toISOString(), stage, ...details }); };
  async function persist() {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  async function close(failure) {
    const errors = [];
    for (const peer of [...workers].reverse().concat(service ?? [])) {
      try {
        if (!peer.process.settled) await peer.rpc('stop');
        const exit = await bounded(() => peer.process.closed, 10000, 'Fixture peer teardown');
        if (exit.code !== 0) throw new Error(`Fixture peer exited ${exit.code ?? exit.signal}.`);
        evidence.cleanup.push({ resource: peer.role, outcome: 'closed' });
      } catch (error) { errors.push(error); }
    }
    for (const process of [...processes].reverse()) {
      if (!process.settled) {
        try { await stopManagedProcess(process); }
        catch (error) { errors.push(error); }
      }
    }
    if (containerCreated) {
      try {
        const inspect = JSON.parse(await runCommand('docker', ['inspect', containerName]));
        assertOwnedContainer(inspect[0], runId);
        await runCommand('docker', ['rm', '-f', containerName]);
        evidence.cleanup.push({ resource: containerName, owner: runId, outcome: 'removed' });
      } catch (error) { errors.push(error); }
    }
    for (const [path, sha] of Object.entries(evidence.sourceHashes)) {
      try { if (await digest(join(sourceApp, path)) !== sha) throw new Error(`Source app changed during smoke: ${path}.`); }
      catch (error) { errors.push(error); }
    }
    await rm(root, { recursive: true, force: true }).catch((error) => errors.push(error));
    evidence.status = failure || errors.length ? 'failed' : 'passed';
    if (failure) evidence.failure = String(failure.message ?? failure);
    evidence.cleanupErrors = errors.map((error) => error.message);
    record('teardown-complete');
    await persist();
    if (errors.length) throw new AggregateError(failure ? [failure, ...errors] : errors, 'Operational fixture teardown failed.');
  }
  let env;
  try {
    await mkdir(appDir);
    const excluded = new Set(['node_modules', '.git', '.svelte-kit', 'build', 'docs', 'storage', '.env', '.env.local']);
    for (const entry of await readdir(sourceApp, { withFileTypes: true })) {
      if (excluded.has(entry.name) || /\.(?:sqlite|db)(?:-(?:wal|shm))?$/.test(entry.name)) continue;
      await cp(join(sourceApp, entry.name), join(appDir, entry.name), { recursive: true });
    }
    await symlink(join(sourceApp, 'node_modules'), join(appDir, 'node_modules'), 'dir');
    for (const path of ['package.json', 'package-lock.json', 'src/app.ts', 'src/hooks.server.ts', 'src/routes/admin/dashboard/+page.svelte']) {
      evidence.sourceHashes[path] = await digest(join(sourceApp, path));
    }
    for (const subpath of ['auth', 'dashboard', 'queue', 'cli']) {
      const path = installedImportPath(packagePath, packageJson, subpath);
      evidence.installed.entries[subpath] = { path, sha256: await digest(path) };
    }
    const sourceDatabase = resolve(sourceApp, database.filename);
    const isolatedDatabase = join(appDir, 'operational.sqlite');
    const SQLite = require('better-sqlite3');
    const handle = new SQLite(sourceDatabase, { readonly: true, fileMustExist: true });
    try { await handle.backup(isolatedDatabase); } finally { handle.close(); }
    record('sqlite-online-backup', { source: sourceDatabase, destination: isolatedDatabase, readonlySource: true });
    const redisPort = await unusedPort();
    const configDir = join(appDir, 'config');
    await mkdir(configDir, { recursive: true });
    const overrides = {
      database: { default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: isolatedDatabase } } },
      queue: { default: 'redis', connections: { redis: { host: '127.0.0.1', port: redisPort, db: 0, prefix: `ops-${runId}` } } },
      cache: { default: 'memory' }, mail: { default: 'null' }, app: { url: baseUrl },
      auth: { emailVerification: { required: false } },
    };
    for (const [name, config] of Object.entries(overrides)) await writeFile(join(configDir, `${name}.json`), JSON.stringify(config) + '\n');
    await writeFile(join(appDir, 'svelar.database.json'), JSON.stringify({ ...overrides.database, migrations: databaseConfig.migrations }) + '\n');
    env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: 'development',
      APP_KEY: randomBytes(32).toString('hex'), INTERNAL_SECRET: randomBytes(24).toString('hex'),
      APP_URL: baseUrl, ORIGIN: baseUrl, DB_DRIVER: 'sqlite', DB_PATH: isolatedDatabase,
      QUEUE_DRIVER: 'redis', CACHE_DRIVER: 'memory', MAIL_DRIVER: 'null', REDIS_HOST: '127.0.0.1', REDIS_PORT: String(redisPort),
      AUTH_OTP_ENABLED: 'true', AUTH_EMAIL_VERIFICATION_REQUIRED: 'false', RATE_LIMIT_STORE: 'memory',
      OPERATIONAL_BROWSER_OWNER: runId };
    record('configuration-isolated', { redisPort, prefix: `ops-${runId}`, rateLimit: 'generated global 100 requests/minute; existing observed-budget pacing, no retry on 429' });
    await persist();
  } catch (error) { await close(error); throw error; }

  async function startPeer(role, mode = 'hold') {
    const process = managedProcess(globalThis.process.execPath, [thisFile, '--fixture-peer', role], {
      cwd: appDir, env: { ...env, OPERATIONAL_BROWSER_WORKER_MODE: mode }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    processes.push(process);
    record('owned-peer-started', { role, pid: process.child.pid });
    await persist();
    let nextId = 0;
    const pending = new Map();
    process.child.on('message', (message) => {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
    });
    process.closed.then((exit) => {
      for (const request of pending.values()) request.reject(process.error ?? new Error(`Fixture ${role} exited ${exit.code ?? exit.signal}: ${process.output.replaceAll(fixtureSecret, '[fixture-secret]')}`));
      pending.clear();
    });
    const peer = { role, process, async rpc(operation, input = {}) {
      const id = ++nextId;
      try {
        return await bounded(() => new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          process.child.send({ id, operation, input }, (error) => { if (error) reject(error); });
        }), 30000, `Fixture ${role} ${operation}`);
      } finally { pending.delete(id); }
    } };
    if (role === 'service') service = peer; else workers.push(peer);
    await peer.rpc('ready');
    return peer;
  }

  return { appDir, env, evidenceDir, evidence, record, persist, close,
    get credentials() { return credentials; },
    async start() {
      const kit = await realpath(join(appDir, 'node_modules/.bin/svelte-kit'));
      await runCommand(globalThis.process.execPath, [kit, 'sync'], { cwd: appDir, env });
      record('installed-sveltekit-sync');
      // The name is unique and reserved for this run before docker is called, including partial startup failures.
      containerCreated = true;
      await runCommand('docker', ['run', '--detach', '--pull=never', '--name', containerName, '--label', `${dockerOwnerLabel}=${runId}`,
        '--publish', `127.0.0.1:${env.REDIS_PORT}:6379`, 'redis:7.4-alpine']);
      await waitUntil(async () => (await runCommand('docker', ['exec', containerName, 'redis-cli', 'ping'])) === 'PONG', { label: 'Owned Redis readiness' });
      record('redis-ready', { containerName, label: `${dockerOwnerLabel}=${runId}` });
      await startPeer('service');
      const prepared = await service.rpc('prepare');
      credentials = prepared.credentials;
      evidence.jobs = prepared.jobs;
      evidence.users = prepared.users;
      await startPeer('worker', 'fail'); await startPeer('worker', 'fail');
      evidence.deadLetters = await service.rpc('wait-failures');
      for (const worker of workers) await worker.rpc('mode', { mode: 'hold' });
      await service.rpc('dispatch-holds');
      evidence.observations = await service.rpc('wait-workers');
      record('populated-runtime-ready', evidence.observations);
      await persist();
    },
    startWeb(port) {
      const require = createRequire(join(appDir, 'package.json'));
      const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
      const process = managedProcess(globalThis.process.execPath, [vite, 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: appDir, env: { ...env, HOST: '127.0.0.1', PORT: String(port) },
      });
      processes.push(process);
      record('owned-web-started', { pid: process.child.pid, port });
      return process;
    },
    async makeBusy(id, source) {
      const replay = await service.rpc('requeue-busy', { id, source });
      await startPeer('worker', 'hold');
      const job = await service.rpc('wait-active', { id: replay.replayJobId });
      record('selected-record-became-busy', { id, source, replayJobId: job.id, status: job.status, ...queueScope });
    },
    async state() { return service.rpc('state'); },
  };
}

async function fixturePeer(role) {
  if (!process.send || !process.env.OPERATIONAL_BROWSER_OWNER || !process.cwd().includes('/.operational-browser-')) {
    throw new Error('Fixture peers may only run in the owned disposable app with an IPC parent.');
  }
  const require = createRequire(join(process.cwd(), 'package.json'));
  const packagePath = require.resolve('@beeblock/svelar/package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  const installed = (subpath) => import(pathToFileURL(installedImportPath(packagePath, packageJson, subpath)).href);
  const { Command, QueueWorkCommand } = await installed('cli');
  const { Queue } = await installed('queue');
  const { Connection } = await installed('database');
  const { Dashboard } = await installed('dashboard');
  const { Mailer } = await installed('mail');
  const { Hash } = await installed('hashing');
  const { Permissions, PermissionProfiles } = await installed('permissions');
  let User, SendWelcomeEmail, manifest;
  let jobs = {};
  let deadLetters = {};
  let fixtureUserId;
  let ready = false;
  let stopping = false;
  let mode = process.env.OPERATIONAL_BROWSER_WORKER_MODE;
  const releases = new Set();
  const adapter = () => Queue.adapter(queueScope.queue, queueScope.connection);
  class FixtureCommand extends Command {
    name = 'operational:fixture';
    async handle() {
      await this.bootstrap();
      ({ User } = await this.importUserModule(join(process.cwd(), 'src/lib/modules/auth/domain/models/User.ts')));
      ({ SendWelcomeEmail } = await this.importUserModule(join(process.cwd(), 'src/lib/shared/jobs/SendWelcomeEmail.ts')));
      ({ permissionManifest: manifest } = await this.importUserModule(join(process.cwd(), 'src/lib/shared/permissions/manifest.ts')));
      ready = true;
    }
  }
  class FixtureWorker extends QueueWorkCommand {
    async bootstrap() {
      await super.bootstrap();
      Mailer.configure({ default: 'operational-fixture', mailers: { 'operational-fixture': { driver: 'custom', transport: {
        async send() {
          if (mode === 'fail') throw new Error(`Operational fixture mail failure password=${fixtureSecret} token=${fixtureSecret}`);
          if (!stopping) await new Promise((done) => { releases.add(done); });
          return { success: true };
        },
      } } } });
      ready = true;
    }
  }
  async function dispatch(name) {
    const job = new SendWelcomeEmail(fixtureUserId, `operational-${name}@example.test`, 'Operational browser fixture');
    job.maxAttempts = 1;
    job.retryDelay = 0;
    job.token = fixtureSecret;
    return Queue.dispatch(job, { ...queueScope, priority: name === 'retry-safe' ? 10 : 1, metadata: { correlationId: process.env.OPERATIONAL_BROWSER_OWNER,
      resourceId: name, token: fixtureSecret } });
  }
  async function snapshot() {
    const runtime = await adapter().runtime();
    const counts = await adapter().counts();
    const records = {};
    const ledger = {}, replays = {};
    for (const [name, id] of Object.entries(jobs)) {
      const job = await adapter().get(id);
      records[name] = job ? { id, status: job.status, connection: job.connection, queue: job.queue } : null;
      if (deadLetters[name]) {
        const record = await adapter().deadLetter(deadLetters[name]);
        ledger[name] = record ? { id: record.id, replayJobId: record.replayJobId ?? null, replayedAt: record.replayedAt ?? null } : null;
        if (record?.replayJobId) {
          const replay = await adapter().get(record.replayJobId);
          replays[name] = replay ? { id: replay.id, status: replay.status } : null;
        }
      }
    }
    return { runtime, counts, jobs: records, deadLetters: ledger, replays };
  }
  const operations = {
    async ready() { await waitUntil(() => ready, { label: 'Generated app bootstrap' }); return { role }; },
    async prepare() {
      await Permissions.syncCapabilities();
      const password = randomBytes(18).toString('base64url');
      const suffix = process.env.OPERATIONAL_BROWSER_OWNER;
      const operatorEmail = `operator-${suffix}@example.test`, readerEmail = `reader-${suffix}@example.test`;
      const operator = await User.create({ name: 'Operational browser operator', email: operatorEmail, password: await Hash.make(password), role: 'admin' });
      fixtureUserId = operator.getAttribute('id');
      const reader = await User.create({ name: 'Operational browser reader', email: readerEmail, password: await Hash.make(password), role: 'user' });
      const readerRole = await Permissions.createRole({ name: `operational-reader-${suffix}`, guard: manifest.guard });
      await new PermissionProfiles(manifest).forPlatform().setCustom(readerRole.id, ['screen.operations.view',
        'action.operations.console.view', 'action.operations.stats.view', 'action.operations.health.view',
        'action.operations.queue.view', 'action.operations.queue.inspect', 'action.operations.queue.timeline']);
      await Permissions.global().assignRole('User', reader.getAttribute('id'), readerRole.id);
      for (const name of failureNames) jobs[name] = await dispatch(name);
      return { jobs, credentials: { operator: { email: operatorEmail, password }, reader: { email: readerEmail, password } },
        users: { operatorId: operator.getAttribute('id'), readerId: reader.getAttribute('id'), readerRoleId: readerRole.id } };
    },
    async 'wait-failures'() {
      await waitUntil(async () => {
        for (const name of failureNames) if ((await adapter().get(jobs[name]))?.status !== 'failed') return false;
        const retained = await adapter().deadLetters({ limit: 100 });
        for (const name of failureNames) {
          const record = retained.find((record) => record.originalJobId === jobs[name]);
          if (!record) return false;
          deadLetters[name] = record.id;
        }
        return true;
      }, { label: 'Generated jobs retained failures' });
      return deadLetters;
    },
    async 'dispatch-holds'() { jobs['hold-one'] = await dispatch('hold-one'); jobs['hold-two'] = await dispatch('hold-two'); return true; },
    async 'wait-workers'() {
      return waitUntil(async () => {
        const state = await snapshot();
        return state.runtime.workers?.observed?.live >= 2 && state.jobs['hold-one']?.status === 'active' && state.jobs['hold-two']?.status === 'active' ? state : false;
      }, { label: 'Two real workers and two active generated jobs' });
    },
    async mode(input) { mode = input.mode; return true; },
    async 'requeue-busy'({ id, source }) {
      if (!(source === 'live' ? Object.values(jobs) : Object.values(deadLetters)).includes(id)) throw new Error('Unknown owned job reference.');
      const result = await adapter().retry({ id, source });
      if (result.outcome !== 'accepted' || !result.replayJobId) throw new Error('Owned job could not be durably requeued for busy-race acceptance.');
      return result;
    },
    async 'wait-active'({ id }) {
      return waitUntil(async () => {
        const job = await adapter().get(id);
        return job?.status === 'active' ? { id, status: job.status } : false;
      }, { label: 'Selected job actual worker acquisition' });
    },
    state: snapshot,
    async stop() { stopping = true; for (const release of releases) release(); releases.clear(); await Queue.stop(); return true; },
  };
  const listener = async ({ id, operation, input }) => {
    try {
      if (!operations[operation]) throw new Error('Unknown fixture operation.');
      const result = await operations[operation](input);
      if (process.connected) process.send({ id, result });
    } catch (error) { if (process.connected) process.send({ id, error: error.message }); }
  };
  const parentGone = () => { void operations.stop().catch((error) => { console.error(error.message); process.exitCode = 1; }); };
  process.on('message', listener);
  process.once('disconnect', parentGone);
  try {
    if (role === 'service') {
      await new FixtureCommand().handle();
      await waitUntil(() => stopping, { timeoutMs: 600000, intervalMs: 100, label: 'Fixture service lifetime' });
    } else {
      await new FixtureWorker().handle([], { queue: queueScope.queue, connection: queueScope.connection, concurrency: '1', sleep: '5', 'grace-period': '5' });
    }
  } finally {
    await Queue.stop();
    await Dashboard.shutdown();
    await Connection.disconnect();
    process.off('message', listener);
    process.off('disconnect', parentGone);
    if (process.connected) process.disconnect();
  }
}

if (process.argv[2] === '--fixture-peer') {
  fixturePeer(process.argv[3]).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
