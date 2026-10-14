import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { archiveFiles, assertLockPin, assertRestart, assertSelectedArtifact, bounded, comparePackageFiles, deriveArtifactIdentity, packageName, parseOptions,
  ProcessMailbox, redact, removeOwnedFixture, verifyInstallation } from './scheduler-installed-process-certification.mjs';
import { assertFixtureApi, fixtureEntryTarget, fixturePublicApi, importFixtureApi } from './scheduler-installed-process-fixture.mjs';

const currentCore10Sha256 = '4f72573381beef38f61b9fae9244f6c01a86767ca313455eba2a1d0bb90a28f7';
const baseArgs = ['--app-dir', '/fixture/app', '--tarball', '/fixture/candidate10/core.tgz', '--report-dir', '/fixture/reports'];
const args = [...baseArgs, '--expected-sha256', currentCore10Sha256];
const checkpoint = () => ({ settings: { enabled: false, timezone: 'UTC', missedRun: { policy: 'skip', windowMinutes: 10, maxRuns: 1 } },
  runtime: { last_run_at: 60000, next_run_at: 120000, last_checked_at: 60000 }, status: { lastRun: '1970-01-01T00:01:00.000Z', nextRun: null },
  executions: [{ id: 1, pid: 101, request_id: null }] });

test('requires an installed app, tarball and external durable reports', () => {
  const options = parseOptions(args);
  assert.equal(options.deadlineMs, 240000);
  assert.equal(options.identity, undefined);
  assert.equal(packageName, '@beeblock/svelar');
  assert.equal(options.expectedSha256, currentCore10Sha256);
});

test('reads identity metadata only when the caller explicitly supplies its path', () => {
  assert.equal(parseOptions([...args, '--identity', '/fixture/custom-metadata.json']).identity, '/fixture/custom-metadata.json');
  assert.equal(parseOptions(args).identity, undefined);
});

test('requires an explicit selected SHA and never takes its expected digest from identity', () => {
  assert.throws(() => parseOptions(baseArgs), /Missing --expected-sha256/);
  for (const hash of ['not-a-hash', 'a'.repeat(63), 'g'.repeat(64)]) assert.throws(() => parseOptions([...baseArgs, '--expected-sha256', hash]), /hex digest/);
  assert.equal(parseOptions([...baseArgs, '--expected-sha256', 'A'.repeat(64)]).expectedSha256, 'a'.repeat(64));
});

test('derives selected identity instead of pinning a contributor script to one candidate', () => {
  const bytes = Buffer.from('independently selected fixture artifact');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  const identity = { name: packageName, version: '0.8.1', files: 412, sha256, integrity };
  assert.equal(assertSelectedArtifact(bytes, identity, sha256), integrity);
  assert.equal(assertSelectedArtifact(bytes, undefined, sha256), integrity);
  assert.throws(() => assertSelectedArtifact(bytes, identity, currentCore10Sha256), /explicitly selected/);
  for (const changed of [{ ...identity, sha256: currentCore10Sha256 }, { ...identity, integrity: 'sha512-wrong' },
    { ...identity, name: 'another-package' }, { ...identity, version: '' }, { ...identity, files: 0 }]) {
    assert.throws(() => assertSelectedArtifact(bytes, changed, sha256));
  }
});

test('derives metadata from the verified archive and rejects conflicting explicit metadata', () => {
  const bytes = Buffer.from('archive metadata fixture');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  const manifest = { name: packageName, version: '0.8.1' };
  const files = ['dist/index.js', 'package.json'];
  const expected = { ...manifest, files: 2, sha256, integrity };
  assert.deepEqual(deriveArtifactIdentity(bytes, manifest, files, sha256), expected);
  assert.deepEqual(deriveArtifactIdentity(bytes, manifest, files, sha256, expected), expected);
  assert.throws(() => deriveArtifactIdentity(bytes, manifest, files, sha256, { ...expected, version: '0.8.2' }), /version differs/);
  assert.throws(() => deriveArtifactIdentity(bytes, manifest, files, sha256, { ...expected, files: 365 }), /file count differs/);
  for (const changed of [{ ...manifest, name: 'another-package' }, { ...manifest, version: '' }, { name: packageName }]) {
    assert.throws(() => deriveArtifactIdentity(bytes, changed, files, sha256));
  }
  assert.throws(() => deriveArtifactIdentity(bytes, manifest, [], sha256), /package manifest/);
  assert.throws(() => deriveArtifactIdentity(bytes, manifest, ['dist/index.js'], sha256), /package manifest/);
  assert.throws(() => deriveArtifactIdentity(bytes, manifest, files, currentCore10Sha256), /explicitly selected/);
  assert.throws(() => deriveArtifactIdentity(bytes, manifest, files, sha256, null), /metadata object/);
});

test('verifies a physical installed archive without adjacent identity and checks explicit metadata when provided', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scheduler-identity-unit-'));
  try {
    const appDir = join(root, 'app'); const archive = join(root, 'archive'); const packageRoot = join(archive, 'package');
    const installed = join(appDir, 'node_modules/@beeblock/svelar');
    await mkdir(packageRoot, { recursive: true }); await mkdir(installed, { recursive: true });
    const manifest = { name: packageName, version: '0.8.1', exports: { './package.json': './package.json' } };
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifest));
    await writeFile(join(packageRoot, 'index.js'), 'export const fixture = true;');
    await cp(packageRoot, installed, { recursive: true });
    const tarball = join(root, 'core.tgz');
    await promisify(execFile)('tar', ['-czf', tarball, '-C', archive, 'package'], { timeout: 10000 });
    const bytes = await readFile(tarball);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    await writeFile(join(appDir, 'package.json'), JSON.stringify({ name: 'scheduler-unit-consumer', private: true }));
    const pin = { version: manifest.version, integrity, resolved: 'file:' + relative(appDir, tarball) };
    await writeFile(join(appDir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@beeblock/svelar': pin } }));
    const options = parseOptions(['--app-dir', appDir, '--tarball', tarball, '--expected-sha256', sha256,
      '--fixture-root', join(root, 'fixtures'), '--report-dir', join(root, 'reports')]);
    const verify = async (name, selected = options) => {
      const scratch = join(root, name); await mkdir(scratch);
      return verifyInstallation(selected, scratch);
    };
    const derived = await verify('without-identity');
    assert.equal(derived.metadata.name, packageName); assert.equal(derived.metadata.version, '0.8.1');
    assert.equal(derived.metadata.verifiedFiles, 2); assert.equal(derived.metadata.integrity, integrity);
    assert.equal(derived.metadata.sha256, sha256); assert.equal(derived.metadata.identitySource, 'sha-verified-archive');
    assert.equal(derived.metadata.identityMetadata, null); assert.equal(derived.metadata.sourceCommit, undefined);
    assert.deepEqual(Object.keys(derived.hashes).sort(), ['index.js', 'package.json']);
    const identity = join(root, 'identity.json');
    await writeFile(identity, '{"staleAdjacentMetadata":true}');
    assert.deepEqual((await verify('ignored-adjacent-identity')).hashes, derived.hashes);
    await assert.rejects(verify('rejected-explicit-identity', { ...options, identity }), /Identity differs/);
    const metadata = { name: packageName, version: manifest.version, files: 2, sha256, integrity, sourceCommit: 'fixture-commit' };
    await writeFile(identity, JSON.stringify(metadata));
    const explicit = await verify('explicit-identity', { ...options, identity });
    assert.equal(explicit.metadata.identityMetadata, identity); assert.equal(explicit.metadata.sourceCommit, 'fixture-commit');
    assert.deepEqual(explicit.hashes, derived.hashes);
    await writeFile(identity, JSON.stringify({ ...metadata, files: 3 }));
    await assert.rejects(verify('conflicting-explicit-count', { ...options, identity }), /file count differs/);
    await assert.rejects(verify('missing-explicit-identity', { ...options, identity: join(root, 'missing.json') }), /ENOENT/);
    await assert.rejects(verify('incorrect-caller-sha', { ...options, expectedSha256: '0'.repeat(64) }), /explicitly selected/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const values of [[], ['--source'], [...args, '--deadline-ms', '10'], [...args, '--deadline-ms', 'Infinity'],
  [...args, '--deadline-ms', '180000.5'], [...args, '--fixture-root', '/fixture/app/temporary'],
  [...args, '--report-dir', '/fixture/app/reports'], [...args, '--fixture-root', '/fixture/reports']]) {
  test('rejects unsafe, source-labelled or incomplete options: ' + values.join(' '), () => { assert.throws(() => parseOptions(values)); });
}

test('parses safe archive files without treating directories as proof', () => {
  assert.deepEqual(archiveFiles('package/\npackage/dist/\npackage/package.json\npackage/dist/index.js\n'), ['dist/index.js', 'package.json']);
});

for (const listing of ['elsewhere/file', 'package/../escape', 'package/./file', 'package/a\\b', 'package/file\npackage/file', 'package/a//b']) {
  test('rejects unsafe archive listing ' + JSON.stringify(listing), () => { assert.throws(() => archiveFiles(listing)); });
}

test('requires the physical tarball integrity in the app lock, not merely version equality', () => {
  const identity = { version: '0.8.0', integrity: 'sha512-fixture' };
  const pin = { version: '0.8.0', integrity: identity.integrity, resolved: 'file:../candidate10/core.tgz' };
  assert.equal(assertLockPin({ packages: { 'node_modules/@beeblock/svelar': pin } }, identity), pin);
  for (const changed of [{ ...pin, integrity: 'sha512-old' }, { ...pin, link: true }, { ...pin, version: '0.7.9' },
    { ...pin, resolved: 'https://registry.example/core.tgz' }]) {
    assert.throws(() => assertLockPin({ packages: { 'node_modules/@beeblock/svelar': changed } }, identity));
  }
  const selected = { ...identity, version: '0.8.1' };
  const nextPin = { ...pin, version: selected.version };
  assert.equal(assertLockPin({ packages: { 'node_modules/@beeblock/svelar': nextPin } }, selected), nextPin);
});

test('compares every installed byte and fails on missing, altered, extra or linked files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scheduler-artifact-unit-'));
  const expected = join(root, 'expected'); const installed = join(root, 'installed');
  try {
    await mkdir(expected); await mkdir(installed);
    await writeFile(join(expected, 'package.json'), '{"version":"0.8.0"}');
    await writeFile(join(installed, 'package.json'), '{"version":"0.8.0"}');
    const hashes = await comparePackageFiles(expected, installed, ['package.json']);
    assert.match(hashes['package.json'], /^[a-f0-9]{64}$/);
    await writeFile(join(installed, 'package.json'), '{"version":"0.8.0","tampered":true}');
    await assert.rejects(comparePackageFiles(expected, installed, ['package.json']), /mismatch/);
    await rm(join(installed, 'package.json'));
    await assert.rejects(comparePackageFiles(expected, installed, ['package.json']), /file set/);
    await writeFile(join(installed, 'package.json'), await readFile(join(expected, 'package.json')));
    await writeFile(join(installed, 'extra.js'), 'export const extra = true;');
    await assert.rejects(comparePackageFiles(expected, installed, ['package.json']), /file set/);
    await rm(join(installed, 'extra.js'));
    await symlink(join(expected, 'package.json'), join(installed, 'linked.json'));
    await assert.rejects(comparePackageFiles(expected, installed, ['package.json']), /symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('accepts only a new actual PID with identical durable settings and last/next state', () => {
  const before = checkpoint(); assert.doesNotThrow(() => assertRestart(101, 202, before, structuredClone(before)));
  assert.throws(() => assertRestart(101, 101, before, before), /different actual process PID/);
  assert.throws(() => assertRestart(0, 202, before, before));
  for (const modify of [
    (value) => { value.settings.enabled = true; }, (value) => { value.settings.timezone = 'Asia/Tokyo'; },
    (value) => { value.runtime.last_run_at = 0; }, (value) => { value.runtime.next_run_at = null; },
    (value) => { value.runtime.last_checked_at = 0; }, (value) => { value.status.lastRun = null; },
    (value) => { value.executions.push({ id: 2, pid: 202 }); },
  ]) {
    const after = structuredClone(before); modify(after); assert.throws(() => assertRestart(101, 202, before, after));
  }
  const missing = checkpoint(); missing.runtime.next_run_at = null;
  assert.throws(() => assertRestart(101, 202, missing, missing), /actual last\/next/);
});

test('redacts credentials but preserves PID, status, timestamps and execution evidence without mutation', () => {
  const source = { password: 'private-password', _csrf: 'private-csrf', Cookie: 'private-cookie', authorization: 'Bearer private-token',
    nested: [{ secret: 'private-secret', status: 401, pid: 123, next_run_at: 456 }], text: 'password=private-password Bearer abc owned-email' };
  const result = redact(source, ['owned-email']);
  assert.equal(source.password, 'private-password');
  assert.equal(result.password, '[redacted]'); assert.equal(result._csrf, '[redacted]'); assert.equal(result.Cookie, '[redacted]');
  assert.deepEqual(result.nested[0], { secret: '[redacted]', status: 401, pid: 123, next_run_at: 456 });
  assert(!JSON.stringify(result).includes('private-')); assert(!result.text.includes('owned-email'));
});

test('cleanup removes only its own direct fixture child and refuses sibling app deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scheduler-cleanup-unit-'));
  const owned = await mkdtemp(join(root, 'svelar-scheduler-installed-')); const app = join(root, 'user-app');
  try {
    await mkdir(app);
    await assert.rejects(removeOwnedFixture(app, root), /unowned/);
    await assert.rejects(removeOwnedFixture(root, root), /outside/);
    await removeOwnedFixture(owned, root);
    await assert.rejects(readFile(join(owned, 'anything')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

class FakeChild extends EventEmitter {
  pid = 123; connected = true; stdout = new EventEmitter(); stderr = new EventEmitter();
  send(message, callback) { this.message = message; this.sendCallback = callback; }
  kill() { this.connected = false; this.emit('close', 0, null); return true; }
}

test('rejects pending RPC on actual child close and never sends through disconnected IPC', async () => {
  const child = new FakeChild(); const mailbox = new ProcessMailbox(child, []);
  const pending = mailbox.request('snapshot');
  child.connected = false; child.emit('close', null, 'SIGKILL');
  await assert.rejects(pending, /closed/);
  await assert.rejects(mailbox.request('snapshot'), /exited/);
  assert.deepEqual(await mailbox.exited, { pid: 123, code: null, signal: 'SIGKILL' });
});

test('reports a real send failure instead of suppressing EPIPE', async () => {
  const child = new FakeChild(); const mailbox = new ProcessMailbox(child, []);
  const pending = mailbox.request('snapshot');
  child.sendCallback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  await assert.rejects(pending, /EPIPE/); child.kill();
});

test('resolves one matching RPC and preserves redacted child logs', async () => {
  const child = new FakeChild(); const logs = []; const mailbox = new ProcessMailbox(child, logs, ['private-email']);
  const pending = mailbox.request('snapshot');
  child.stdout.emit('data', Buffer.from('private-email password=hidden'));
  child.emit('message', { id: child.message.id, data: { enabled: false, pid: 123 } });
  assert.deepEqual(await pending, { enabled: false, pid: 123 });
  assert(!logs[0].includes('private-email')); assert(!logs[0].includes('hidden')); child.kill();
});

test('honors explicit deadlines and cancellation without retrying the native operation', async () => {
  await assert.rejects(bounded(new Promise(() => {}), 10, undefined, 'probe'), /time bound/);
  const controller = new AbortController();
  const pending = bounded(new Promise(() => {}), 1000, controller.signal, 'probe');
  controller.abort(new Error('caller cancelled'));
  await assert.rejects(pending, /caller cancelled/);
});

test('process fixture and runner are guarded contributor scripts outside the published package', async () => {
  const fixture = await readFile(new URL('./scheduler-installed-process-fixture.mjs', import.meta.url), 'utf8');
  assert(fixture.includes('resolve(process.argv[1]) === scriptPath'));
  assert(fixture.includes('manifest.exports'));
  assert(fixture.includes('DashboardController'));
  assert(fixture.includes('new OriginMiddleware()'));
  assert(fixture.includes('new CsrfMiddleware()'));
  assert(fixture.includes('LoginRequest.validate(event)'));
  assert(!fixture.includes('../packages/svelar/src'));
  const manifest = JSON.parse(await readFile(new URL('../packages/svelar/package.json', import.meta.url), 'utf8'));
  assert(!manifest.files.some((path) => path === 'scripts' || path.startsWith('../')));
});

test('fixture API paths have explicit public ESM and type declarations', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/svelar/package.json', import.meta.url), 'utf8'));
  for (const subpath of Object.keys(fixturePublicApi)) assert.match(fixtureEntryTarget(manifest, subpath), /^\.\/dist\/.*\.js$/);
  assert.equal(fixtureEntryTarget(manifest, 'scheduler/ScheduleMonitor'), './dist/scheduler/ScheduleMonitor.js');
  for (const entry of [{ import: './src/scheduler.js', types: './dist/scheduler.d.ts' },
    { import: './dist/../private.js', types: './dist/scheduler.d.ts' }, { import: './dist/scheduler.js' }]) {
    assert.throws(() => fixtureEntryTarget({ exports: { './scheduler': entry } }, 'scheduler'), /public installed/);
  }
});

test('actual public ESM loading checks the required runtime API rather than accepting a named export alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scheduler-public-api-unit-'));
  try {
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    const manifest = { exports: { './scheduler/ScheduleMonitor': { import: './dist/monitor.js', types: './dist/monitor.d.ts' } } };
    await writeFile(join(root, 'dist/monitor.js'), 'export const ScheduleMonitor = { configure() {} };');
    const entries = {}; const namespace = await importFixtureApi(root, manifest, 'scheduler/ScheduleMonitor', entries);
    assert.equal(typeof namespace.ScheduleMonitor.configure, 'function');
    assert.match(entries['scheduler/ScheduleMonitor'], /^[a-f0-9]{64}$/);
    assert.throws(() => assertFixtureApi('scheduler/ScheduleMonitor', { ScheduleMonitor: {} }), /ScheduleMonitor.configure/);
    assert.throws(() => assertFixtureApi('scheduler/ScheduleMonitor', {}), /Missing installed public API/);
    assert.throws(() => assertFixtureApi('scheduler', namespace), /scheduler:Scheduler/);
    assert.throws(() => assertFixtureApi('unknown', {}), /Unknown fixture API/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('child startup failure preserves the actual fixture stack and redacts secrets', async () => {
  const child = new FakeChild(); const mailbox = new ProcessMailbox(child, [], ['fixture-private-secret']);
  child.emit('message', { type: 'fatal', error: 'Missing API', stack: 'Error: Missing API\n at fixture.mjs:42 fixture-private-secret' });
  await assert.rejects(mailbox.ready, (error) => {
    assert.match(error.stack, /fixture.mjs:42/); assert(!error.stack.includes('fixture-private-secret')); return true;
  });
  child.kill();
});
