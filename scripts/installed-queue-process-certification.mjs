#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { bounded, comparePackageFiles, inside, ProcessMailbox, redact, until, verifyInstallation } from './scheduler-installed-process-certification.mjs';

const script = fileURLToPath(import.meta.url);
const repository = resolve(dirname(script), '..');
const execute = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const ownerLabel = 'io.svelar.installed-queue-certification';
export const timing = Object.freeze({ lock: 1500, stalled: 1000, grace: 8, hold: 6500, probe: 20000 });
const resultPrefix = 'SVELAR_INSTALLED_QUEUE_RESULT ';

export function parseOptions(args) {
  const options = { appDir: resolve(repository, '../svelar-testing-area/apps/svelar-smoke-ddd'),
    fixtureRoot: resolve(repository, '../svelar-testing-area/fixtures'), redisImage: 'redis:7-alpine', deadlineMs: 240000 };
  const keys = { '--app-dir': 'appDir', '--tarball': 'tarball', '--expected-sha256': 'expectedSha256', '--identity': 'identity',
    '--fixture-root': 'fixtureRoot', '--report-dir': 'reportDir', '--deadline-ms': 'deadlineMs', '--redis-image': 'redisImage' };
  for (let index = 0; index < args.length; index++) {
    const at = args[index].indexOf('=');
    const name = at < 0 ? args[index] : args[index].slice(0, at);
    const key = keys[name]; assert(key, `Unknown option ${name}.`);
    const value = at < 0 ? args[++index] : args[index].slice(at + 1);
    assert(value && !value.startsWith('--'), `Missing value for ${name}.`);
    options[key] = value;
  }
  for (const key of ['appDir', 'tarball', 'fixtureRoot', 'reportDir']) {
    assert(options[key], `Missing ${key}.`); options[key] = resolve(options[key]);
  }
  assert(/^[a-fA-F0-9]{64}$/.test(options.expectedSha256 ?? ''), 'Explicit --expected-sha256 is required.');
  options.expectedSha256 = options.expectedSha256.toLowerCase();
  if (options.identity) options.identity = resolve(options.identity);
  options.deadlineMs = Number(options.deadlineMs);
  assert(Number.isSafeInteger(options.deadlineMs) && options.deadlineMs >= 90000 && options.deadlineMs <= 600000, 'Deadline must be 90000..600000ms.');
  assert(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(options.redisImage), 'Invalid Redis image.');
  assert(options.fixtureRoot !== options.appDir && !inside(options.appDir, options.fixtureRoot), 'Fixtures must not mutate the selected app.');
  assert(options.reportDir !== options.appDir && !inside(options.appDir, options.reportDir), 'Reports must not mutate the selected app.');
  assert(options.reportDir !== options.fixtureRoot && !inside(options.fixtureRoot, options.reportDir), 'Reports must outlive disposable fixtures.');
  return options;
}

export function workerArguments(cli, queue, concurrency, once = false) {
  assert(Number.isSafeInteger(concurrency) && concurrency > 0 && concurrency <= 5, 'Invalid proof concurrency.');
  assert(/^[a-zA-Z0-9_-]+$/.test(queue), 'Invalid proof queue.');
  return [cli, 'queue:work', `--queue=${queue}`, '--connection=proof', `--concurrency=${concurrency}`,
    `--lock-duration=${timing.lock}`, `--stalled-interval=${timing.stalled}`, `--grace-period=${timing.grace}`, ...(once ? ['--once'] : [])];
}

export function parseCommandResult(stdout) {
  const lines = stdout.split('\n').filter((line) => line.startsWith(resultPrefix));
  assert.equal(lines.length, 1, 'Fixture command must produce exactly one result.');
  return JSON.parse(lines[0].slice(resultPrefix.length));
}

export function assertOrigin(marker, origin, jobId, workerPid) {
  assert(marker && typeof marker === 'object', 'Missing actual job marker.');
  assert.equal(marker.id, jobId, 'Job ID changed at the execution boundary.');
  assert.equal(marker.pid, workerPid, 'Marker was not produced by the actual CLI worker.');
  for (const key of ['teamId', 'tenantId', 'userId', 'actorId', 'correlationId']) {
    assert.equal(marker.context[key], origin[key], `Serialized origin changed: ${key}.`);
  }
  assert.equal(marker.context.jobId, jobId);
  assert(!Object.values(marker.context).includes('unrelated-worker'), 'Worker ambient identity leaked into the job.');
}

export function assertFinished(job, markers, jobId, starts = 1) {
  assert.equal(job?.id, jobId); assert.equal(job.status, 'completed');
  assert.equal(markers.startedCount, starts, 'Unexpected execution count.');
  assert.equal(markers.finishedCount, 1, 'Job did not finish exactly once.');
  assert.equal(markers.finished.id, jobId);
  assert.equal(job.attemptsStarted, starts);
  if (starts === 1) assert.equal(job.stalledCount, 0, 'Renewal proof unexpectedly stalled.');
}

export function assertRecovered(first, last, job, markers, origin) {
  assert.notEqual(first.pid, last.pid, 'Recovery must use a replacement process.');
  assertFinished(job, markers, first.id, 2);
  assert(job.stalledCount >= 1, 'Native stalled recovery was not observed.');
  assertOrigin(first, origin, job.id, first.pid); assertOrigin(last, origin, job.id, last.pid);
}

function fixturePath(root, path) {
  const target = resolve(root, path); assert(inside(root, target), 'Fixture path escapes its owned root.'); return target;
}

export async function snapshotPaths(root, paths) {
  const result = new Map();
  for (const path of paths) {
    const target = fixturePath(root, path);
    try { assert((await lstat(target)).isFile(), 'Touched fixture files must be physical files.'); result.set(path, await readFile(target)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; result.set(path, null); }
  }
  return result;
}

export async function restorePaths(root, snapshot) {
  for (const [path, bytes] of snapshot) {
    const target = fixturePath(root, path);
    if (bytes === null) await rm(target, { force: true });
    else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); }
  }
  const restored = await snapshotPaths(root, [...snapshot.keys()]);
  for (const [path, bytes] of snapshot) assert.deepEqual(restored.get(path), bytes, `Fixture restoration failed: ${path}.`);
}

export async function removeOwnedFixture(directory, root) {
  assert((await lstat(directory)).isDirectory(), 'Refusing linked fixture cleanup.');
  const physical = await realpath(directory);
  assert.equal(dirname(physical), await realpath(root), 'Refusing cleanup outside the owned fixture root.');
  assert(/^svelar-queue-installed-[a-zA-Z0-9_-]+$/.test(physical.slice(dirname(physical).length + 1)), 'Refusing unowned fixture cleanup.');
  await rm(physical, { recursive: true, force: true });
}

export function fixtureSources(shared = 'shared/') {
  assert(shared === 'shared/' || shared === '', 'Unknown fixture layout.');
  const app = `import { readFileSync } from 'node:fs';
import { Connection } from '@beeblock/svelar/database';
import { Queue } from '@beeblock/svelar/queue';
import { Cache } from '@beeblock/svelar/cache';
import { Log } from '@beeblock/svelar/logging';
import { ApplicationContext } from '@beeblock/svelar/support';
import { InstalledQueueProbeJob } from '$lib/${shared}jobs/InstalledQueueProbeJob';
const input = JSON.parse(readFileSync(process.env.SVELAR_INSTALLED_QUEUE_CONFIG!, 'utf8'));
Connection.configure({ default: 'proof', connections: { proof: { driver: 'sqlite', filename: input.database } } });
Queue.configure({ default: 'proof', connections: { proof: { driver: 'redis', url: input.redisUrl, prefix: input.prefix,
  producerTimeoutMs: 3000, workerHeartbeat: { intervalMs: 1000, staleAfterMs: 4000, retentionMs: 15000 } } } });
Queue.register(InstalledQueueProbeJob);
Cache.configure({ default: 'proof', stores: { proof: { driver: 'redis', url: input.redisUrl, prefix: input.cachePrefix,
  connectTimeoutMs: 3000, commandTimeoutMs: 3000 } } });
Log.configure({ default: 'fixture', channels: { fixture: { driver: 'null' } }, viewer: { driver: 'database', connection: 'proof' } });
for (const key of ['teamId', 'tenantId', 'userId', 'actorId', 'correlationId']) ApplicationContext.set(key, 'unrelated-worker');
`;
  const job = `import { readFileSync } from 'node:fs';
import { Job } from '@beeblock/svelar/queue';
import { Cache } from '@beeblock/svelar/cache';
import { ApplicationContext } from '@beeblock/svelar/support';
import { Log } from '@beeblock/svelar/logging';
interface ProbeData { label: string; barrier?: string; duration?: number; }
export class InstalledQueueProbeJob extends Job {
  maxAttempts = 3;
  retryDelay = 0;
  constructor(public data: ProbeData) { super(); }
  async handle(): Promise<void> {
    const input = JSON.parse(readFileSync(process.env.SVELAR_INSTALLED_QUEUE_CONFIG!, 'utf8'));
    const context: Record<string, unknown> = {};
    for (const key of ['teamId', 'tenantId', 'userId', 'actorId', 'correlationId', 'jobId', 'jobClass', 'queue']) {
      const value = ApplicationContext.get(key); if (value !== undefined) context[key] = value;
    }
    const marker = { label: this.data.label, id: this.id, pid: process.pid, at: Date.now(), attempts: this.attempts, context };
    await Cache.incrementWithTtl(this.data.label + '-started-count', 180);
    await Cache.put(this.data.label + '-started', marker, 180);
    await this.progress(25, 'actual CLI job started');
    const deadline = Date.now() + 60000;
    if (this.data.barrier) {
      while (!await Cache.get(this.data.barrier)) {
        if (Date.now() >= deadline) throw new Error('Installed proof barrier exceeded its deadline.');
        await new Promise((done) => setTimeout(done, 50));
      }
    }
    if (this.data.duration) await new Promise((done) => setTimeout(done, this.data.duration));
    await Log.info('installed-queue completed ' + this.data.label, { token: input.logSecret });
    await this.progress(100, 'actual CLI job finished');
    await Cache.incrementWithTtl(this.data.label + '-finished-count', 180);
    await Cache.put(this.data.label + '-finished', { ...marker, at: Date.now() }, 180);
  }
}
`;
  const command = `import assert from 'node:assert/strict';
import { Command } from '@beeblock/svelar/cli';
import { Queue } from '@beeblock/svelar/queue';
import { Cache } from '@beeblock/svelar/cache';
import { Migrator, svelarCoreMigrations } from '@beeblock/svelar/database';
import { ApplicationContext } from '@beeblock/svelar/support';
import { InstalledQueueProbeJob } from '$lib/${shared}jobs/InstalledQueueProbeJob';
export class InstalledQueueProbeCommand extends Command {
  name = 'app:installed-queue-probe';
  description = 'Owned installed queue certification fixture';
  arguments = ['operation', 'payload'];
  flags = [];
  async handle(args: string[]): Promise<void> {
    await this.bootstrap();
    try {
      let result: unknown;
      if (args[0] === 'initialize') result = await new Migrator().run(svelarCoreMigrations());
      else {
        assert.equal(args[0], 'dispatch');
        const input = JSON.parse(args[1]);
        assert(Array.isArray(input.jobs) && input.jobs.length > 0 && input.jobs.length <= 5);
        result = await ApplicationContext.runIsolated({}, () => Queue.dispatchBulk(input.jobs.map((item: any) => ({
          job: new InstalledQueueProbeJob(item.data), options: { jobId: item.id, context: item.origin,
            metadata: { tenantId: item.origin.teamId, correlationId: item.origin.correlationId } },
        })), { queue: input.queue, connection: 'proof', maxAttempts: 3 }));
      }
      console.log(${JSON.stringify(resultPrefix)} + JSON.stringify(result));
    } finally { await Cache.close(); }
  }
}
`;
  const observer = `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Cache } from '@beeblock/svelar/cache';
import { Queue } from '@beeblock/svelar/queue';
import { Connection } from '@beeblock/svelar/database';
import { LogViewer } from '@beeblock/svelar/logging/LogViewer';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const require = createRequire(import.meta.url);
const packagePath = require.resolve('@beeblock/svelar/package.json');
assert.equal(createHash('sha256').update(await readFile(packagePath)).digest('hex'), input.manifestSha256);
Connection.configure({ default: 'proof', connections: { proof: { driver: 'sqlite', filename: input.database } } });
Queue.configure({ default: 'proof', connections: { proof: { driver: 'redis', url: input.redisUrl, prefix: input.prefix } } });
Cache.configure({ default: 'proof', stores: { proof: { driver: 'redis', url: input.redisUrl, prefix: input.cachePrefix,
  connectTimeoutMs: 3000, commandTimeoutMs: 3000 } } });
LogViewer.configure({ driver: 'database', connection: 'proof' });
for (const [name, value] of Object.entries({ adapter: Queue.adapter, get: Cache.get, put: Cache.put, close: Cache.close, query: LogViewer.query })) {
  assert.equal(typeof value, 'function', 'Missing installed public API: ' + name);
}
async function snapshot(message) {
  const adapter = Queue.adapter(message.queue, 'proof');
  const jobs = {}; const markers = {};
  for (const item of message.jobs ?? []) {
    jobs[item.id] = await adapter.get(item.id);
    markers[item.id] = { started: await Cache.get(item.data.label + '-started'), finished: await Cache.get(item.data.label + '-finished'),
      startedCount: await Cache.get(item.data.label + '-started-count', 0), finishedCount: await Cache.get(item.data.label + '-finished-count', 0) };
  }
  return { pid: process.pid, at: Date.now(), jobs, markers, runtime: await adapter.runtime() };
}
process.on('message', (message) => { void (async () => {
  try {
    let data;
    if (message.type === 'snapshot') data = await snapshot(message);
    else if (message.type === 'release') { await Cache.put(message.barrier, true, 180); data = true; }
    else if (message.type === 'timeline') data = await Queue.adapter(message.queue, 'proof').timeline({ source: 'live', id: message.jobId }, 100);
    else if (message.type === 'logs') data = await LogViewer.query({ search: 'installed-queue completed', limit: 100 });
    else throw new Error('Unknown owned reader request.');
    process.send({ id: message.id, data });
  } catch (error) { process.send({ id: message.id, error: error.stack ?? String(error) }); }
})(); });
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  try { await Queue.stop(); await Cache.close(); await Connection.disconnect(); process.disconnect(); }
  catch (error) { console.error(error); process.exitCode = 1; process.disconnect(); }
}
process.once('SIGTERM', () => { void stop(); });
process.send({ type: 'ready', pid: process.pid, packagePath });
`;
  return { app, job, command, observer };
}

export class OwnedProcess {
  constructor(child, logs, args, secrets = []) {
    this.child = child; this.args = args; this.logs = logs; this.closed = false; this.startedAt = Date.now(); this.bytes = 0;
    this.exited = new Promise((accept) => { this.acceptExit = accept; });
    child.once('error', (error) => { this.failure = error; });
    child.once('close', (code, signal) => { this.closed = true; this.exit = { pid: child.pid, code, signal, at: Date.now() }; this.acceptExit(this.exit); });
    for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) stream?.on('data', (chunk) => {
      this.bytes += chunk.length;
      if (this.bytes > 2 * 1024 * 1024) { this.failure ??= new Error('Owned CLI output exceeded 2 MiB.'); return; }
      logs.push({ stream: name, text: redact(String(chunk), secrets) });
    });
  }
  sendSignal(signal) { assert(!this.closed, 'Cannot signal an exited owned process.'); this.requestedSignal = signal; assert(this.child.kill(signal), 'Owned process signal was not delivered.'); }
  async wait(signal, milliseconds = 20000) {
    const result = await bounded(this.exited, milliseconds, signal, 'Actual packaged CLI exit');
    if (this.failure) throw this.failure;
    return result;
  }
  async cleanup() {
    if (!this.closed) {
      this.sendSignal('SIGTERM');
      try { await this.wait(undefined, (timing.grace + 3) * 1000); }
      catch (error) {
        if (!this.closed) { this.forcedKill = true; this.child.kill('SIGKILL'); await bounded(this.exited, 5000, undefined, 'Forced owned CLI cleanup'); }
        throw error;
      }
    }
    if (this.failure) throw this.failure;
    if (this.requestedSignal === 'SIGKILL') assert.equal(this.exit.signal, 'SIGKILL');
    else assert.equal(this.exit.code, 0, 'Owned CLI did not exit successfully.');
  }
}

async function sourceHashes(appDir) {
  const hashes = {};
  async function visit(path) {
    const physical = join(appDir, path);
    let info;
    try { info = await lstat(physical); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    assert(!info.isSymbolicLink(), `Selected source must be physical: ${path}.`);
    if (info.isDirectory()) for (const entry of await readdir(physical)) await visit(path + '/' + entry);
    else if (info.isFile()) hashes[path] = hash(await readFile(physical));
  }
  for (const path of ['src', '.env', '.env.example', 'package.json', 'package-lock.json', 'tsconfig.json', 'svelte.config.js', 'svelar.validation.json']) await visit(path);
  return hashes;
}

async function docker(args, signal, timeout = 30000) {
  return (await execute('docker', args, { signal, timeout, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
}

export async function certify(options) {
  const controller = new AbortController(); const signal = controller.signal;
  const interrupted = () => controller.abort(new Error('Installed queue certification interrupted.'));
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  const deadline = setTimeout(() => controller.abort(new Error('Installed queue certification deadline reached.')), options.deadlineMs);
  const runId = randomUUID(); const container = 'svelar-queue-installed-' + runId;
  const reportDirectory = join(options.reportDir, runId);
  const logSecret = 'queue-proof-secret-' + randomUUID(); const secrets = [logSecret];
  const report = { scope: 'installed-immutable-core-actual-packaged-cli-and-independent-node-esm-reader', runId,
    node: process.version, reportDirectory, sourceAliases: false, browserUi: false, httpRequests: false, startedAt: new Date().toISOString(),
    passed: false, complete: false, skipped: 0, checks: [], observations: [], failures: [], timing };
  const logs = {}; const processes = []; let observer; let directory; let app; let verification; let original; let restored; let created = false; let creationAttempted = false;
  const check = (name, evidence) => { report.checks.push(name); if (evidence) report.observations.push({ name, ...evidence }); };
  try {
    await mkdir(reportDirectory, { recursive: true }); await mkdir(options.fixtureRoot, { recursive: true });
    directory = await mkdtemp(join(options.fixtureRoot, 'svelar-queue-installed-'));
    verification = await verifyInstallation(options, directory, signal);
    report.installation = { ...verification.metadata, label: report.scope };
    original = await sourceHashes(options.appDir); report.selectedAppSourceBefore = original;
    report.harnessHashes = Object.fromEntries(await Promise.all(['installed-queue-process-certification.mjs',
      'installed-queue-process-certification.test.mjs'].map(async (name) => [name, hash(await readFile(join(dirname(script), name)))])));
    check('sha-lock-sri-and-every-physical-installed-file-verified');
    const manifest = JSON.parse(await readFile(join(verification.packageRoot, 'package.json'), 'utf8'));
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.svelar;
    assert(typeof bin === 'string', 'Selected archive has no packaged svelar CLI.');
    const cli = fixturePath(verification.packageRoot, bin);
    assert(verification.files.includes(bin.replace(/^\.\//, '')), 'CLI is not a verified archive member.');
    app = join(directory, 'app'); await mkdir(join(app, 'src/lib/modules'), { recursive: true });
    for (const name of ['package.json', 'package-lock.json']) await cp(join(options.appDir, name), join(app, name));
    await symlink(await realpath(join(options.appDir, 'node_modules')), join(app, 'node_modules'), 'dir');
    await writeFile(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      strict: true, skipLibCheck: true, noEmit: true, types: ['node'], paths: { '$lib/*': ['./src/lib/*'] } }, include: ['src/**/*.ts'] }));
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC', NODE_ENV: 'test', JITI_FS_CACHE: 'false',
      SVELAR_INSTALLED_QUEUE_CONFIG: join(app, 'queue-proof.json') };
    const launch = (name, args) => {
      const output = logs[name + '-' + processes.length] = [];
      const handle = new OwnedProcess(spawn(process.execPath, args, { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] }), output, args, secrets);
      processes.push(handle); return handle;
    };
    const command = async (name, args) => {
      const handle = launch(name, [cli, ...args]); const exit = await handle.wait(signal, 30000); assert.equal(exit.code, 0, `Packaged CLI ${name} failed.`);
      return handle.logs.filter((item) => item.stream === 'stdout').map((item) => item.text).join('');
    };
    const touched = ['src/app.ts', 'src/lib/shared/jobs/InstalledQueueProbeJob.ts', 'src/lib/shared/commands/InstalledQueueProbeCommand.ts', 'queue-observer.mjs'];
    restored = await snapshotPaths(app, touched);
    await command('make-job', ['make:job', 'InstalledQueueProbeJob']);
    await command('make-command', ['make:command', 'InstalledQueueProbe', '--command=app:installed-queue-probe']);
    const generated = await snapshotPaths(app, touched.slice(1, 3));
    assert([...generated.values()].every((bytes) => bytes !== null), 'CLI did not generate its declared artifacts.');
    await mkdir(join(reportDirectory, 'generated-originals'), { recursive: true });
    for (const [path, bytes] of generated) await writeFile(join(reportDirectory, 'generated-originals', path.split('/').at(-1)), bytes);
    const sources = fixtureSources();
    for (const [path, content] of [[touched[0], sources.app], [touched[1], sources.job], [touched[2], sources.command], [touched[3], sources.observer]]) {
      await mkdir(dirname(join(app, path)), { recursive: true }); await writeFile(join(app, path), content);
    }
    report.fixtureSources = Object.fromEntries(touched.map((path, index) => [path, hash([sources.app, sources.job, sources.command, sources.observer][index])]));
    await writeFile(join(reportDirectory, 'fixture-sources.json'), JSON.stringify(sources, null, 2));
    check('actual-packaged-cli-generates-job-and-command-before-fixture-edits');
    const require = createRequire(join(options.appDir, 'package.json'));
    const typecheck = launch('fixture-strict-typecheck', [require.resolve('typescript/bin/tsc'), '--project', join(app, 'tsconfig.json')]);
    assert.equal((await typecheck.wait(signal, 30000)).code, 0, 'Owned fixture failed strict installed declaration checking.');
    check('fixture-strict-types-against-selected-physical-installed-public-declarations');
    creationAttempted = true;
    await docker(['create', '--name', container, '--label', `${ownerLabel}=${runId}`, '--publish', '127.0.0.1::6379',
      options.redisImage, 'redis-server', '--save', '', '--appendonly', 'no'], signal, 60000);
    created = true; await docker(['start', container], signal);
    const endpoint = await docker(['port', container, '6379/tcp'], signal); assert(/^127\.0\.0\.1:\d+$/.test(endpoint), 'Redis must use a random loopback-only port.');
    await until(() => docker(['exec', container, 'redis-cli', 'ping'], signal), (value) => value === 'PONG', signal, 'Owned Redis startup', 15000);
    const config = { redisUrl: 'redis://' + endpoint, database: join(app, 'queue.sqlite'), prefix: 'installed-queue-' + runId,
      cachePrefix: 'installed-queue-cache-' + runId + ':', manifestSha256: verification.hashes['package.json'], logSecret };
    await writeFile(env.SVELAR_INSTALLED_QUEUE_CONFIG, JSON.stringify(config), { mode: 0o600 });
    report.redis = { container, ownerLabel, endpoint, image: options.redisImage };
    parseCommandResult(await command('initialize', ['app:installed-queue-probe', 'initialize']));
    check('explicit-cli-fixture-migrations-before-concurrent-workers');
    const readerLogs = logs.reader = [];
    observer = new ProcessMailbox(spawn(process.execPath, [join(app, 'queue-observer.mjs'), env.SVELAR_INSTALLED_QUEUE_CONFIG],
      { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }), readerLogs, secrets);
    const ready = await observer.waitReady(signal); assert.equal(ready.pid, observer.child.pid);
    assert.equal(await realpath(ready.packagePath), join(await realpath(verification.packageRoot), 'package.json'));
    check('independent-node-esm-reader-resolves-selected-physical-public-package', { pid: ready.pid });
    const origin = (name) => ({ teamId: 'tenant-' + name, tenantId: 'tenant-' + name, userId: 'actor-' + name,
      actorId: 'actor-' + name, correlationId: runId + '-' + name });
    const item = (label, context, barrier) => ({ id: runId + '-' + label, data: { label, ...(barrier ? { barrier } : {}) }, origin: context });
    const publish = async (queue, jobs) => {
      const ids = parseCommandResult(await command('dispatch-' + queue, ['app:installed-queue-probe', 'dispatch', JSON.stringify({ queue, jobs })]));
      assert.deepEqual(ids, jobs.map((job) => job.id)); return ids;
    };
    const snapshot = async (queue, jobs) => {
      const value = await observer.request('snapshot', { queue, jobs }, signal);
      report.lastSnapshot = { queue, ...value }; return value;
    };
    const waitSnapshot = (queue, jobs, accept, label, timeout = timing.probe) => until(() => snapshot(queue, jobs), accept, signal, label, timeout);
    const stop = async (worker) => { worker.sendSignal('SIGTERM'); const exit = await worker.wait(signal, (timing.grace + 2) * 1000); assert.equal(exit.code, 0); return exit; };

    const parallelQueue = 'parallel-' + runId;
    const parallel = Array.from({ length: 5 }, (_, index) => item('parallel-' + index, index === 4 ? {} : origin(index % 2 ? 'b' : 'a'), 'parallel-release'));
    await publish(parallelQueue, parallel);
    const parallelWorker = launch('parallel-worker', workerArguments(cli, parallelQueue, 5));
    const active = await waitSnapshot(parallelQueue, parallel, (value) => parallel.every((job) => value.jobs[job.id]?.status === 'active' && value.markers[job.id].started), 'Five actual CLI jobs active');
    for (const job of parallel) assertOrigin(active.markers[job.id].started, job.origin, job.id, parallelWorker.child.pid);
    assert.notEqual(ready.pid, parallelWorker.child.pid);
    check('packaged-cli-concurrency-five-and-two-tenants-plus-system-origin-isolated', { workerPid: parallelWorker.child.pid, active });
    const samples = [];
    const holdUntil = Date.now() + timing.hold;
    while (Date.now() < holdUntil) {
      const value = await snapshot(parallelQueue, parallel);
      for (const job of parallel) { assert.equal(value.jobs[job.id]?.status, 'active'); assert.equal(value.markers[job.id].finishedCount, 0); }
      samples.push({ at: value.at, locks: parallel.map((job) => ({ id: job.id, ...value.jobs[job.id].lock })) });
      await bounded(new Promise((done) => setTimeout(done, 700)), 1000, signal, 'Configured lock hold');
    }
    for (const job of parallel) {
      const observed = samples.flatMap((sample) => sample.locks.filter((lock) => lock.id === job.id && lock.state === 'observed').map((lock) => lock.expiresAt));
      assert(observed.length >= 3 && Math.max(...observed) - Math.min(...observed) > timing.lock * 2, 'Public lock observations did not advance during the long job.');
    }
    await observer.request('release', { barrier: 'parallel-release' }, signal);
    const completed = await waitSnapshot(parallelQueue, parallel, (value) => parallel.every((job) => value.jobs[job.id]?.status === 'completed'), 'Five held jobs completed');
    for (const job of parallel) assertFinished(completed.jobs[job.id], completed.markers[job.id], job.id);
    check('jobs-exceed-four-configured-lock-durations-with-no-stalls-or-reexecution', { samples, completed });
    check('idle-cli-sigterm-exits-zero', { exit: await stop(parallelWorker) });

    const drainQueue = 'drain-' + runId;
    const draining = item('draining', origin('drain'), 'drain-release'); const waiting = item('waiting-after-drain', origin('drain'));
    await publish(drainQueue, [draining]);
    const drainWorker = launch('drain-worker', workerArguments(cli, drainQueue, 1));
    await waitSnapshot(drainQueue, [draining], (value) => value.markers[draining.id].started, 'Drain job entered actual worker');
    await publish(drainQueue, [waiting]);
    drainWorker.sendSignal('SIGTERM'); const signalledAt = Date.now();
    const drainingState = await waitSnapshot(drainQueue, [draining, waiting], (value) => value.runtime.workers?.records.some((worker) => worker.draining), 'Actual CLI publishes draining state', 4000);
    assert.equal(drainWorker.closed, false, 'SIGTERM exited before the active job finished.');
    assert.equal(drainingState.jobs[waiting.id].status, 'waiting'); assert.equal(drainingState.markers[waiting.id].startedCount, 0);
    await observer.request('release', { barrier: 'drain-release' }, signal);
    const drainedExit = await drainWorker.wait(signal, (timing.grace + 1) * 1000); assert.equal(drainedExit.code, 0);
    assert(drainedExit.at - signalledAt < timing.grace * 1000 + 1000, 'SIGTERM exceeded its grace bound.');
    const drained = await snapshot(drainQueue, [draining, waiting]);
    assertFinished(drained.jobs[draining.id], drained.markers[draining.id], draining.id);
    assert.equal(drained.jobs[waiting.id].status, 'waiting'); assert.equal(drained.markers[waiting.id].startedCount, 0);
    check('sigterm-stops-acquisition-waits-active-job-and-exits-zero-within-grace', { signalledAt, drainingState, drainedExit, drained });
    const finiteWorker = launch('post-drain-once', workerArguments(cli, drainQueue, 1, true));
    assert.equal((await finiteWorker.wait(signal)).code, 0);
    const next = await snapshot(drainQueue, [waiting]); assertFinished(next.jobs[waiting.id], next.markers[waiting.id], waiting.id);
    check('replacement-cli-consumes-the-job-left-waiting-after-drain', { snapshot: next, pid: finiteWorker.child.pid });

    const recoveryQueue = 'recovery-' + runId; const recovering = item('recovering', origin('recovery'), 'recovery-release');
    await publish(recoveryQueue, [recovering]);
    const killedWorker = launch('killed-worker', workerArguments(cli, recoveryQueue, 1));
    const beforeKill = await waitSnapshot(recoveryQueue, [recovering], (value) => value.markers[recovering.id].started && value.jobs[recovering.id]?.lock.state === 'observed', 'Recovery job active with observed lock');
    const first = beforeKill.markers[recovering.id].started; assertOrigin(first, recovering.origin, recovering.id, killedWorker.child.pid);
    killedWorker.sendSignal('SIGKILL'); assert.equal((await killedWorker.wait(signal)).signal, 'SIGKILL');
    const expired = await waitSnapshot(recoveryQueue, [recovering], (value) => value.jobs[recovering.id]?.lock.state === 'expired', 'Killed worker lease expires');
    const replacement = launch('replacement-worker', workerArguments(cli, recoveryQueue, 1));
    const restarted = await waitSnapshot(recoveryQueue, [recovering], (value) => value.markers[recovering.id].startedCount === 2 && value.markers[recovering.id].started.pid === replacement.child.pid, 'Native stalled recovery in replacement CLI', 30000);
    await observer.request('release', { barrier: 'recovery-release' }, signal);
    const recovered = await waitSnapshot(recoveryQueue, [recovering], (value) => value.jobs[recovering.id]?.status === 'completed', 'Recovered same-ID job completes');
    assertRecovered(first, restarted.markers[recovering.id].started, recovered.jobs[recovering.id], recovered.markers[recovering.id], recovering.origin);
    const timeline = await observer.request('timeline', { queue: recoveryQueue, jobId: recovering.id }, signal);
    assert(timeline.some((event) => event.event === 'stalled')); assert(timeline.some((event) => event.event === 'completed'));
    check('sigkill-active-job-recovers-same-id-origin-and-finishes-once-in-new-cli', { killed: killedWorker.exit, replacementPid: replacement.child.pid, expired, recovered, timeline });
    await stop(replacement);
    const entries = await observer.request('logs', {}, signal);
    for (const job of [...parallel, draining, waiting, recovering]) {
      const matches = entries.filter((entry) => entry.message === 'installed-queue completed ' + job.data.label);
      assert.equal(matches.length, 1, 'Shared viewer did not persist exactly one completion log.');
      assert.equal(matches[0].context.jobId, job.id);
      for (const key of ['actorId', 'tenantId', 'correlationId']) assert.equal(matches[0].context[key], job.origin[key]);
    }
    assert(!JSON.stringify(entries).includes(logSecret), 'Persisted logs leaked a secret.');
    check('independent-installed-reader-sees-persisted-redacted-job-logs-and-origin', { readerPid: ready.pid, entries });
    report.passed = true; report.complete = true;
  } catch (error) { report.failures.push(redact(error.stack ?? String(error), secrets)); }
  finally {
    clearTimeout(deadline); process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    const cleanupErrors = [];
    for (const child of [...processes].reverse()) {
      try { await child.cleanup(); } catch (error) { cleanupErrors.push(redact(error.stack ?? String(error), secrets)); }
    }
    if (observer) {
      try { const exit = await observer.stop(); assert.equal(exit.code, 0); assert(!observer.forcedKill, 'Reader required forced cleanup.'); }
      catch (error) { cleanupErrors.push(redact(error.stack ?? String(error), secrets)); }
    }
    if (creationAttempted) {
      try {
        const labels = JSON.parse(await docker(['inspect', '--format', '{{json .Config.Labels}}', container]));
        assert.equal(labels[ownerLabel], runId, 'Refusing to remove an unowned Redis container.');
        await writeFile(join(reportDirectory, 'redis.log'), redact(await docker(['logs', container], undefined), secrets));
        await docker(['rm', '--force', container]); report.ownedRedisRemoved = true;
      } catch (error) {
        if (created || !/No such (object|container)/i.test(String(error.stderr ?? error.message))) cleanupErrors.push(redact(error.stack ?? String(error), secrets));
      }
    }
    if (app && restored) { try { await restorePaths(app, restored); report.touchedFixtureFilesRestored = true; } catch (error) { cleanupErrors.push(redact(error.stack ?? String(error), secrets)); } }
    if (verification) {
      try {
        assert.deepEqual(await comparePackageFiles(verification.archiveRoot, verification.packageRoot, verification.files), verification.hashes);
        assert.equal(hash(await readFile(join(options.appDir, 'package.json'))), verification.metadata.appManifestSha256);
        assert.equal(hash(await readFile(join(options.appDir, 'package-lock.json'))), verification.metadata.lockSha256);
        if (original) { const after = await sourceHashes(options.appDir); assert.deepEqual(after, original); report.selectedAppSourceAfter = after; }
        report.selectedAppAndPhysicalCoreUnchanged = true;
      } catch (error) { cleanupErrors.push(redact(error.stack ?? String(error), secrets)); }
    }
    if (directory) { try { await removeOwnedFixture(directory, options.fixtureRoot); report.ownedFixtureRemoved = true; } catch (error) { cleanupErrors.push(redact(error.stack ?? String(error), secrets)); } }
    report.processes = processes.map((child) => ({ pid: child.child.pid, args: child.args, exit: child.exit,
      failure: child.failure?.message, forcedKill: child.forcedKill ?? false }));
    if (observer) report.readerProcess = { pid: observer.child.pid, exit: observer.exit, closed: observer.closed, forcedKill: observer.forcedKill ?? false };
    if (cleanupErrors.length) { report.failures.push(...cleanupErrors); report.passed = false; report.complete = false; }
    report.cleanupErrors = cleanupErrors; report.finishedAt = new Date().toISOString();
    await mkdir(reportDirectory, { recursive: true });
    const safe = redact(report, secrets);
    if (verification) safe.installation.fileHashes = verification.hashes;
    if (original) safe.selectedAppSourceBefore = original;
    if (report.selectedAppSourceAfter) safe.selectedAppSourceAfter = report.selectedAppSourceAfter;
    await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(safe, null, 2), { mode: 0o600 });
    await writeFile(join(reportDirectory, 'process-logs.json'), JSON.stringify(redact(logs, secrets), null, 2), { mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  try {
    const report = await certify(parseOptions(process.argv.slice(2)));
    console.log(`Installed queue processes: ${report.passed ? 'PASS' : 'FAIL'} (${report.checks.length} checks, ${report.skipped} skips).`);
    console.log(`Receipt: ${join(report.reportDirectory, 'report.json')}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) { console.error(redact(error.stack ?? String(error))); process.exitCode = 1; }
}
