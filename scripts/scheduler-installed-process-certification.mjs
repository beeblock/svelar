#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateArtifactEntries } from './release-smoke.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repository = resolve(dirname(scriptPath), '..');
const execute = promisify(execFile);
export const packageName = '@beeblock/svelar';
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
export const inside = (parent, child) => { const path = relative(parent, child); return path !== '' && !path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path); };

export function parseOptions(args) {
  const options = { fixtureRoot: resolve(repository, '../svelar-testing-area/fixtures'), deadlineMs: 240000 };
  for (let index = 0; index < args.length; index++) {
    const key = { '--app-dir': 'appDir', '--tarball': 'tarball', '--expected-sha256': 'expectedSha256', '--identity': 'identity', '--fixture-root': 'fixtureRoot', '--report-dir': 'reportDir', '--deadline-ms': 'deadlineMs' }[args[index]];
    if (!key) throw new Error(`Unknown option ${args[index]}`);
    const value = args[++index];
    assert(value && !value.startsWith('--'), `Missing value for ${args[index - 1]}`);
    options[key] = value;
  }
  for (const key of ['appDir', 'tarball', 'reportDir']) { assert(options[key], `Missing --${key === 'appDir' ? 'app-dir' : key === 'reportDir' ? 'report-dir' : key}`); options[key] = resolve(options[key]); }
  assert(typeof options.expectedSha256 === 'string', 'Missing --expected-sha256; the caller must select the immutable artifact.');
  options.expectedSha256 = options.expectedSha256.toLowerCase();
  assert(/^[a-f0-9]{64}$/.test(options.expectedSha256), '--expected-sha256 must be a SHA256 hex digest.');
  if (options.identity !== undefined) options.identity = resolve(options.identity);
  options.fixtureRoot = resolve(options.fixtureRoot);
  options.deadlineMs = Number(options.deadlineMs);
  assert(Number.isInteger(options.deadlineMs) && options.deadlineMs >= 180000 && options.deadlineMs <= 600000, 'Deadline must be 180000..600000ms for real minute boundaries.');
  assert(options.reportDir !== options.fixtureRoot && !inside(options.fixtureRoot, options.reportDir), 'Reports must live outside disposable fixtures.');
  assert(options.fixtureRoot !== options.appDir && !inside(options.appDir, options.fixtureRoot), 'Fixtures must not live in the active app.');
  assert(options.reportDir !== options.appDir && !inside(options.appDir, options.reportDir), 'Reports must not mutate the active app.');
  return options;
}

export function archiveFiles(listing) {
  const entries = listing.trim().split('\n').filter(Boolean);
  const seen = new Set();
  for (const entry of entries) {
    assert(entry.startsWith('package/') && !entry.includes('\\') && !entry.replace(/\/$/, '').split('/').some((part) => !part || part === '..' || part === '.' || /[\x00-\x1f\x7f]/.test(part)), 'Unsafe archive member.');
    assert(!seen.has(entry), 'Duplicate archive member.'); seen.add(entry);
  }
  return entries.filter((entry) => !entry.endsWith('/')).map((entry) => entry.slice('package/'.length)).sort();
}

export function assertLockPin(lock, identity) {
  const entry = lock.packages?.['node_modules/@beeblock/svelar'];
  assert(entry && entry.link !== true && entry.version === identity.version, 'Lock must contain the selected installed, non-workspace package version.');
  assert.equal(entry.integrity, identity.integrity, 'Lock integrity differs from the immutable artifact.');
  assert(typeof entry.resolved === 'string' && entry.resolved.startsWith('file:'), 'Lock must reference the physical candidate tarball.');
  return entry;
}

export function assertSelectedArtifact(bytes, identity, expectedSha256) {
  assert(typeof expectedSha256 === 'string' && /^[a-f0-9]{64}$/.test(expectedSha256), 'An explicit expected artifact SHA256 is required.');
  assert.equal(digest(bytes), expectedSha256, 'Tarball differs from the explicitly selected immutable artifact.');
  const integrity = 'sha512-' + digest(bytes, 'sha512', 'base64');
  if (identity !== undefined) {
    assert(identity && typeof identity === 'object' && !Array.isArray(identity), 'Explicit identity must be a metadata object.');
    assert.equal(identity.sha256, expectedSha256, 'Identity differs from the selected artifact SHA256.');
    assert.equal(identity.integrity, integrity, 'Identity integrity differs from the physical tarball.');
    assert.equal(identity.name, packageName);
    assert(typeof identity.version === 'string' && identity.version.length > 0, 'Identity must declare the selected package version.');
    assert(Number.isSafeInteger(identity.files) && identity.files > 0, 'Identity must declare its actual archive file count.');
  }
  return integrity;
}

export function deriveArtifactIdentity(bytes, manifest, files, expectedSha256, metadata) {
  const integrity = assertSelectedArtifact(bytes, metadata, expectedSha256);
  assert.equal(manifest?.name, packageName, 'Archive manifest must name the selected core package.');
  assert(typeof manifest.version === 'string' && manifest.version.length > 0, 'Archive manifest must declare its package version.');
  assert(Array.isArray(files) && files.length > 0 && files.includes('package.json'), 'Archive must contain its package manifest.');
  const identity = { name: manifest.name, version: manifest.version, files: files.length, sha256: expectedSha256, integrity };
  if (metadata !== undefined) {
    assert.equal(metadata.version, identity.version, 'Explicit identity version differs from the archive manifest.');
    assert.equal(metadata.files, identity.files, 'Explicit identity file count differs from the verified archive.');
  }
  return identity;
}

async function filesIn(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name); const key = prefix + entry.name;
    assert(!entry.isSymbolicLink(), `Package symlink is not installed-artifact proof: ${key}`);
    if (entry.isDirectory()) result.push(...await filesIn(path, key + '/'));
    else { assert(entry.isFile(), `Unexpected package member: ${key}`); result.push(key); }
  }
  return result.sort();
}

export async function comparePackageFiles(expectedRoot, installedRoot, files, signal) {
  assert.deepEqual(await filesIn(installedRoot), files, 'Installed package file set differs from the archive.');
  const hashes = {};
  for (const file of files) {
    signal?.throwIfAborted();
    const expected = await readFile(join(expectedRoot, file), { signal });
    const actual = await readFile(join(installedRoot, file), { signal });
    assert.equal(digest(actual), digest(expected), `Installed artifact mismatch: ${file}`);
    hashes[file] = digest(actual);
  }
  return hashes;
}

export async function verifyInstallation(options, scratch, signal) {
  const bytes = await readFile(options.tarball, { signal });
  const metadata = options.identity === undefined ? undefined : JSON.parse(await readFile(options.identity, { encoding: 'utf8', signal }));
  assertSelectedArtifact(bytes, metadata, options.expectedSha256);
  // Extract only the exact SHA-verified bytes, not a tarball path that could change after the check.
  const snapshot = join(scratch, 'verified-artifact.tgz');
  await writeFile(snapshot, bytes, { flag: 'wx', mode: 0o400, signal });
  const tarOptions = { signal, timeout: 15000, maxBuffer: 4 * 1024 * 1024 };
  const listing = (await execute('tar', ['-tzf', snapshot], tarOptions)).stdout;
  const details = (await execute('tar', ['-tvzf', snapshot], tarOptions)).stdout;
  validateArtifactEntries(listing, details);
  const files = archiveFiles(listing);
  await execute('tar', ['-xzf', snapshot, '-C', scratch], tarOptions);
  const archiveRoot = join(scratch, 'package');
  assert.deepEqual(await filesIn(archiveRoot), files);
  const archiveManifest = JSON.parse(await readFile(join(archiveRoot, 'package.json'), { encoding: 'utf8', signal }));
  const identity = deriveArtifactIdentity(bytes, archiveManifest, files, options.expectedSha256, metadata);
  const manifestBytes = await readFile(join(options.appDir, 'package.json'));
  const lockBytes = await readFile(join(options.appDir, 'package-lock.json'));
  const lock = JSON.parse(lockBytes); const pin = assertLockPin(lock, identity);
  assert.equal(await realpath(resolve(options.appDir, decodeURIComponent(pin.resolved.slice(5)))), await realpath(options.tarball), 'Lock resolved path is not the supplied physical tarball.');
  const require = createRequire(join(options.appDir, 'package.json'));
  const packageRoot = dirname(require.resolve('@beeblock/svelar/package.json'));
  assert(!(await lstat(packageRoot)).isSymbolicLink(), 'Core must be physically installed, not a workspace link.');
  const hashes = await comparePackageFiles(archiveRoot, packageRoot, files, signal);
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.name, identity.name); assert.equal(manifest.version, identity.version);
  return { packageRoot, archiveRoot, files, hashes, metadata: { label: 'installed-core-public-http-and-scheduler', name: manifest.name, version: manifest.version,
    generatedSvelteKitUi: false, sourceAliases: false, tarball: await realpath(options.tarball), sha256: identity.sha256, integrity: identity.integrity,
    identitySource: 'sha-verified-archive', identityMetadata: options.identity ?? null, sourceCommit: metadata?.sourceCommit,
    installedRoot: await realpath(packageRoot), verifiedFiles: files.length,
    fileHashes: hashes, appManifestSha256: digest(manifestBytes), lockSha256: digest(lockBytes) } };
}

export function redact(value, secrets = []) {
  const sensitive = /password|_csrf|csrf.?token|cookie|authorization|credential|secret|session.?id|token|api.?key|private.?key/i;
  if (Array.isArray(value)) {
    if (value.length === 2 && typeof value[0] === 'string' && sensitive.test(value[0])) return [value[0], '[redacted]'];
    return value.map((item) => redact(item, secrets));
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    sensitive.test(key) ? '[redacted]' : redact(item, secrets)]));
  if (typeof value !== 'string') return value;
  let result = value.replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
    .replace(/(["']?(?:_csrf|password|cookie|authorization|secret|token)["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[redacted]');
  for (const secret of secrets.filter((item) => typeof item === 'string' && item.length > 0)) result = result.replaceAll(secret, '[redacted]');
  return result.slice(0, 100000);
}

export function assertRestart(previousPid, nextPid, before, after) {
  assert(Number.isInteger(previousPid) && Number.isInteger(nextPid) && previousPid > 0 && nextPid > 0 && previousPid !== nextPid, 'Restart requires a different actual process PID.');
  assert.deepEqual(after.settings, before.settings, 'Restart lost persisted scheduler configuration.');
  assert(before.runtime?.last_run_at != null && before.runtime?.next_run_at != null, 'Restart checkpoint must contain actual last/next execution timestamps.');
  for (const key of ['last_run_at', 'next_run_at', 'last_checked_at']) assert.equal(after.runtime?.[key], before.runtime[key], `Restart lost ${key}.`);
  assert.equal(after.status.lastRun, before.status.lastRun);
  assert.equal(after.status.nextRun, before.status.nextRun);
  assert.deepEqual(after.executions, before.executions, 'Restart unexpectedly repeated the handler before daemon start.');
}

export class ProcessMailbox {
  constructor(child, logs, secrets = []) {
    this.child = child; this.pending = new Map(); this.sequence = 0; this.messages = []; this.closed = false;
    this.ready = new Promise((accept, reject) => { this.acceptReady = accept; this.rejectReady = reject; });
    this.ready.catch(() => {});
    this.exited = new Promise((accept) => { this.acceptExit = accept; });
    child.on('message', (message) => {
      this.messages.push(message);
      if (message.type === 'ready') this.acceptReady(message);
      if (message.type === 'fatal') { this.failure = new Error(message.error); this.rejectReady(this.failure); }
      const pending = this.pending.get(message.id);
      if (pending) { this.pending.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(new Error(message.error)) : pending.accept(message.data); }
    });
    child.on('error', (error) => { this.failure = error; this.rejectReady(error); });
    child.on('close', (code, signal) => {
      this.closed = true; this.exit = { pid: child.pid, code, signal };
      const error = this.failure ?? new Error(`Owned process ${child.pid} closed (${code ?? signal}).`);
      this.rejectReady(error);
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear(); this.acceptExit(this.exit);
    });
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => { logs.push(redact(String(chunk), secrets)); if (logs.length > 200) logs.shift(); });
  }
  async waitReady(signal) { return bounded(this.ready, 20000, signal, 'Owned process startup'); }
  async request(type, input = {}, signal) {
    signal?.throwIfAborted();
    assert(!this.closed && this.child.connected, 'Cannot send to an exited owned process.');
    const id = ++this.sequence;
    const work = new Promise((accept, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Owned process RPC ${type} timed out.`)); }, 10000);
      this.pending.set(id, { accept, reject, timer });
      this.child.send({ id, type, ...input }, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (pending) { this.pending.delete(id); clearTimeout(timer); pending.reject(error); }
      });
    });
    return bounded(work, 11000, signal, type);
  }
  async stop(signal = 'SIGTERM') {
    if (this.closed) return this.exit;
    this.requestedSignal = signal; this.child.kill(signal);
    const timer = setTimeout(() => { if (!this.closed) { this.forcedKill = true; this.child.kill('SIGKILL'); } }, 5000);
    try { return await this.exited; } finally { clearTimeout(timer); }
  }
}

export async function bounded(work, milliseconds, signal, label) {
  signal?.throwIfAborted();
  let timer; let abort;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded its time bound.`)), milliseconds);
    abort = () => reject(signal.reason ?? new Error('Certification cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work, deadline]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function until(read, accept, signal, label, milliseconds = 80000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const value = await read();
    if (accept(value)) return value;
    await bounded(new Promise((done) => setTimeout(done, 250)), 1000, signal, label);
  }
  throw new Error(`${label} did not become true within ${milliseconds}ms.`);
}

export async function removeOwnedFixture(directory, root) {
  const canonical = await realpath(directory); const parent = await realpath(root);
  assert.equal(dirname(canonical), parent, 'Refusing cleanup outside the caller-owned fixture root.');
  assert(basename(canonical).startsWith('svelar-scheduler-installed-'), 'Refusing cleanup of an unowned fixture.');
  await rm(canonical, { recursive: true, force: true });
}

export async function certify(options) {
  const controller = new AbortController();
  const interrupted = () => controller.abort(new Error('Installed scheduler certification interrupted.'));
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  const deadline = setTimeout(() => controller.abort(new Error('Installed scheduler certification deadline reached.')), options.deadlineMs);
  const signal = controller.signal; const processes = []; const logs = {}; let directory; let verification;
  const runId = randomUUID(); const password = 'Scheduler-' + randomBytes(20).toString('hex') + '!';
  const secret = randomBytes(32).toString('hex'); const email = `scheduler-${runId}@example.test`;
  const secrets = [password, secret, email];
  const report = { scope: 'installed-core-public-http-harness', browserUi: false, runId, startedAt: new Date().toISOString(),
    node: process.version, passed: false, complete: false, checks: [], observations: [], failures: [], skipped: 0 };
  const check = (name, evidence) => { report.checks.push(name); if (evidence) report.observations.push({ name, at: new Date().toISOString(), ...evidence }); };
  try {
    await mkdir(options.reportDir, { recursive: true }); await mkdir(options.fixtureRoot, { recursive: true });
    directory = await mkdtemp(join(options.fixtureRoot, 'svelar-scheduler-installed-'));
    verification = await verifyInstallation(options, directory, signal);
    report.installation = verification.metadata;
    report.harnessHashes = Object.fromEntries(await Promise.all(['scheduler-installed-process-certification.mjs',
      'scheduler-installed-process-fixture.mjs', 'scheduler-installed-process-certification.test.mjs'].map(async (name) =>
      [name, digest(await readFile(join(dirname(scriptPath), name)))])));
    check('selected-immutable-artifact-lock-and-every-installed-file');
    await cp(join(options.appDir, 'package.json'), join(directory, 'package.json'));
    await cp(join(options.appDir, 'package-lock.json'), join(directory, 'package-lock.json'));
    await symlink(join(options.appDir, 'node_modules'), join(directory, 'node_modules'), 'dir');
    const config = { directory, database: join(directory, 'scheduler.sqlite'), taskName: 'scheduler-cert-' + runId,
      packageRoot: verification.packageRoot, manifestSha256: verification.hashes['package.json'], password, secret, email };
    const launch = (role) => {
      const output = logs[role + '-' + processes.length] = [];
      const child = spawn(process.execPath, [join(dirname(scriptPath), 'scheduler-installed-process-fixture.mjs'), role], {
        cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC' }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });
      const processHandle = new ProcessMailbox(child, output, secrets); processes.push(processHandle);
      child.stdin.on('error', (error) => { processHandle.failure = error; processHandle.rejectReady(error); });
      child.stdin.end(JSON.stringify(config)); return processHandle;
    };
    const init = launch('initialize'); await init.waitReady(signal);
    assert.equal((await bounded(init.exited, 20000, signal, 'Fixture migrations')).code, 0);
    check('isolated-migrations-completed-before-concurrent-processes');
    const web = launch('web'); const webReady = await web.waitReady(signal);
    assert.equal(webReady.pid, web.child.pid); assert.equal(new URL(webReady.origin).hostname, '127.0.0.1');
    const cookies = new Map();
    const http = async (path, body, { csrf = true, authenticated = true } = {}) => {
      const headers = { ...(authenticated ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}) };
      if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers.Origin = webReady.origin; if (csrf) headers['X-CSRF-Token'] = cookies.get('XSRF-TOKEN') ?? ''; }
      const response = await fetch(webReady.origin + path, { method: body === undefined ? 'GET' : 'POST', headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
      if (authenticated) for (const cookie of response.headers.getSetCookie()) { const first = cookie.split(';')[0]; const at = first.indexOf('='); cookies.set(first.slice(0, at), first.slice(at + 1)); }
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await http('/bootstrap')).status, 200);
    assert.equal((await http('/login', { email, password })).status, 200);
    assert.equal((await http('/scheduler', undefined, { authenticated: false })).status, 403);
    assert.equal((await http('/scheduler/toggle', { enabled: false }, { csrf: false })).status, 419);
    assert.equal((await http('/scheduler/toggle', { enabled: 'false' })).status, 422);
    check('real-session-auth-csrf-and-shared-schema-enforced');
    assert.equal((await http('/scheduler/toggle', { enabled: false })).status, 200);
    const first = launch('scheduler'); const firstReady = await first.waitReady(signal);
    assert(firstReady.pid !== webReady.pid && firstReady.pid !== process.pid);
    assert.equal(firstReady.snapshot.settings.enabled, false);
    await first.request('start', {}, signal);
    await until(() => first.request('snapshot', {}, signal), (value) => value.runtime?.state === 'disabled' && value.executions.length === 0, signal, 'Disabled scheduler observation', 15000);
    check('separate-web-disable-observed-by-live-scheduler', { webPid: webReady.pid, schedulerPid: firstReady.pid });
    assert.equal((await http('/scheduler/toggle', { enabled: true })).status, 200);
    const executed = await until(() => first.request('snapshot', {}, signal), (value) => value.executions.length > 0 && value.runtime?.last_run_at != null && value.runtime.next_run_at != null && value.status.lockOwner === null, signal, 'Enabled real cron execution');
    assert(executed.executions.every((value) => value.pid === firstReady.pid));
    check('separate-web-enable-produces-real-cron-execution', { snapshot: executed });
    const killed = await first.stop('SIGKILL'); assert.equal(killed.signal, 'SIGKILL');
    check('first-scheduler-killed-and-exit-awaited', { exit: killed });
    assert.equal((await http('/scheduler/toggle', { enabled: false })).status, 200);
    const checkpoint = await web.request('snapshot', {}, signal);
    assert(checkpoint.runtime.next_run_at != null && checkpoint.runtime.last_run_at != null);
    const second = launch('scheduler'); const secondReady = await second.waitReady(signal);
    assertRestart(firstReady.pid, secondReady.pid, checkpoint, secondReady.snapshot);
    assert.equal(secondReady.snapshot.settings.enabled, false);
    check('new-pid-retains-disabled-config-and-durable-last-next', { before: checkpoint, after: secondReady.snapshot, oldPid: firstReady.pid, newPid: secondReady.pid });
    await second.request('start', {}, signal);
    const nextDue = Number(checkpoint.runtime.next_run_at);
    const disabled = await until(() => second.request('snapshot', {}, signal), (value) => Date.now() >= nextDue + 1000 && Number(value.runtime?.last_checked_at) >= Math.floor(nextDue / 60000) * 60000, signal, 'Disabled persisted configuration across a real due minute');
    assert.deepEqual(disabled.executions, checkpoint.executions);
    assert.equal(disabled.status.enabled, false); assert.equal(disabled.status.lastRun, checkpoint.status.lastRun);
    check('restarted-disabled-daemon-does-not-execute-at-due-minute', { snapshot: disabled });
    assert.equal((await http('/scheduler/toggle', { enabled: true })).status, 200);
    const requested = await http('/scheduler/run', {}); assert.equal(requested.status, 200);
    assert.equal(requested.body.data.queued, true);
    const requestId = requested.body.data.data.id;
    const resumed = await until(() => second.request('snapshot', { requestId }, signal), (value) => value.request?.state === 'succeeded' && value.status.lockOwner === null, signal, 'Restarted daemon consumes web run request', 15000);
    assert.equal(resumed.request.attempts, 1);
    const matching = resumed.executions.filter((value) => value.request_id === requestId);
    assert.equal(matching.length, 1); assert.equal(matching[0].pid, secondReady.pid);
    assert(resumed.executions.every((value) => value.pid !== webReady.pid));
    check('web-reenable-and-queued-run-execute-only-in-restarted-daemon', { snapshot: resumed });
    const drained = await second.stop(); assert.equal(drained.code, 0);
    const finalCheckpoint = await web.request('snapshot', {}, signal);
    const third = launch('scheduler'); const thirdReady = await third.waitReady(signal);
    assertRestart(secondReady.pid, thirdReady.pid, finalCheckpoint, thirdReady.snapshot);
    assert.equal(thirdReady.snapshot.status.enabled, true);
    assert(thirdReady.snapshot.status.lastRun && thirdReady.snapshot.status.nextRun);
    await third.request('start', {}, signal);
    check('graceful-exit-and-new-pid-retain-enabled-last-next', { exit: drained, oldPid: secondReady.pid, newPid: thirdReady.pid, snapshot: thirdReady.snapshot });
    report.passed = true; report.complete = true;
  } catch (error) { report.failures.push(redact(error.stack ?? error.message, secrets)); }
  finally {
    clearTimeout(deadline);
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    const cleanupErrors = [];
    for (const child of [...processes].reverse()) {
      try {
        await child.stop();
        if (child.failure) throw child.failure;
        if (child.forcedKill) throw new Error(`Owned process ${child.child.pid} did not drain within 5s.`);
        if (child.exit?.code !== 0 && !(child.requestedSignal === 'SIGKILL' && child.exit?.signal === 'SIGKILL')) throw new Error(`Owned process ${child.child.pid} exited unexpectedly.`);
      } catch (error) { cleanupErrors.push(redact(error.message, secrets)); }
    }
    report.processes = processes.map((child) => ({ pid: child.child.pid, exit: child.exit, closed: child.closed, failure: child.failure?.message }));
    if (verification) {
      try {
        assert.deepEqual(await comparePackageFiles(verification.archiveRoot, verification.packageRoot, verification.files), verification.hashes);
        assert.equal(digest(await readFile(join(options.appDir, 'package.json'))), verification.metadata.appManifestSha256);
        assert.equal(digest(await readFile(join(options.appDir, 'package-lock.json'))), verification.metadata.lockSha256);
        report.sharedInstallationUnchanged = true;
      } catch (error) { cleanupErrors.push(redact(error.message, secrets)); }
    }
    if (directory) { try { await removeOwnedFixture(directory, options.fixtureRoot); report.ownedFixtureRemoved = true; } catch (error) { cleanupErrors.push(redact(error.message, secrets)); } }
    if (cleanupErrors.length) { report.failures.push(...cleanupErrors); report.passed = false; report.complete = false; }
    report.finishedAt = new Date().toISOString(); report.cleanupErrors = cleanupErrors;
    await mkdir(options.reportDir, { recursive: true });
    const safeReport = redact(report, secrets);
    // Artifact filenames can contain "token" or "api-key"; their SHA256 values are evidence, not credentials.
    if (verification) safeReport.installation.fileHashes = verification.hashes;
    await writeFile(join(options.reportDir, 'report.json'), JSON.stringify(safeReport, null, 2), { mode: 0o600 });
    await writeFile(join(options.reportDir, 'process-logs.json'), JSON.stringify(redact(logs, secrets), null, 2), { mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const report = await certify(parseOptions(process.argv.slice(2)));
    console.log(`Installed scheduler processes: ${report.passed ? 'PASS' : 'FAIL'} (${report.checks.length} checks, ${report.skipped} skips).`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
}
