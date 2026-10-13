import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertOperationalBatch, assertOwnedContainer, assertSafeOperationalJob, bounded, dockerOwnerLabel,
  fixtureSecret, installedImportPath, lockedArtifact, managedProcess, runCommand, stopManagedProcess, validateDeepTarget, waitUntil } from './operational-browser-fixtures.mjs';

test('deep mode rejects external servers, protected ports and non-loopback targets before allocating fixtures', () => {
  const valid = { noServer: false, port: 5826, baseUrl: 'http://127.0.0.1:5826' };
  assert.doesNotThrow(() => validateDeepTarget(valid));
  for (const port of [5330, 5798, 80, 6379.5, 65536, NaN]) assert.throws(() => validateDeepTarget({ ...valid, port }));
  assert.throws(() => validateDeepTarget({ ...valid, noServer: true }), /disposable/);
  assert.throws(() => validateDeepTarget({ ...valid, baseUrl: 'https://example.test' }), /owned loopback/);
});

test('container cleanup requires the exact run-specific ownership label', () => {
  const runId = 'fixture-owner';
  assert.doesNotThrow(() => assertOwnedContainer({ Config: { Labels: { [dockerOwnerLabel]: runId } } }, runId));
  for (const inspect of [null, {}, { Config: { Labels: {} } }, { Config: { Labels: { [dockerOwnerLabel]: 'someone-else' } } }]) {
    assert.throws(() => assertOwnedContainer(inspect, runId), /Refusing/);
  }
  assert.throws(() => assertOwnedContainer({ Config: { Labels: { [dockerOwnerLabel]: '' } } }, ''), /Refusing/);
});

test('installed public imports resolve the ESM export condition rather than a source or require fallback', () => {
  const packagePath = '/fixture/node_modules/@beeblock/svelar/package.json';
  assert.equal(installedImportPath(packagePath, { exports: { './auth': { types: './dist/auth/index.d.ts', import: './dist/auth/index.js' } } }, 'auth'),
    '/fixture/node_modules/@beeblock/svelar/dist/auth/index.js');
  for (const exported of [undefined, { require: './dist/auth/index.js' }, { import: './src/auth/index.ts' }, { import: './dist/../../src/auth.ts' }]) {
    assert.throws(() => installedImportPath(packagePath, { exports: { './auth': exported } }, 'auth'), /public built ESM/);
  }
});

test('immutable artifact provenance requires the installed lockfile integrity and optional exact SHA', async () => {
  const root = await mkdtemp(join(tmpdir(), 'operational-artifact-test-'));
  try {
    const data = Buffer.from('unit-test-only tarball bytes');
    await writeFile(join(root, 'core.tgz'), data);
    const integrity = 'sha512-' + createHash('sha512').update(data).digest('base64');
    const sha256 = createHash('sha256').update(data).digest('hex');
    const lock = { packages: { 'node_modules/@beeblock/svelar': { resolved: 'file:core.tgz', integrity } } };
    assert.equal((await lockedArtifact(root, lock, sha256)).sha256, sha256);
    await assert.rejects(lockedArtifact(root, lock, 'another-artifact'), /immutable tarball/);
    await assert.rejects(lockedArtifact(root, { packages: { 'node_modules/@beeblock/svelar': { resolved: 'file:../source', link: true } } }), /linked\/source/);
    await writeFile(join(root, 'core.tgz'), 'changed bytes');
    await assert.rejects(lockedArtifact(root, lock), /lockfile/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('state waits poll only until readiness and bound missing or hung probes', async () => {
  let probes = 0;
  assert.equal(await waitUntil(() => ++probes >= 3 ? 'ready' : false, { timeoutMs: 100, intervalMs: 1 }), 'ready');
  assert.equal(probes, 3);
  let lateProbes = 0;
  await assert.rejects(waitUntil(() => { lateProbes++; return false; }, { timeoutMs: 15, intervalMs: 1 }), /timed out/);
  const after = lateProbes;
  await new Promise((done) => setTimeout(done, 10));
  assert.equal(lateProbes, after);
  await assert.rejects(waitUntil(() => new Promise(() => {}), { timeoutMs: 10 }), /timed out/);
  await assert.rejects(waitUntil(() => { throw new Error('actual infrastructure failure'); }), /actual infrastructure failure/);
});

test('bounded operations do not retry a failure or leave a timeout after success', async () => {
  const failure = new Error('actual operation failed');
  let calls = 0;
  await assert.rejects(bounded(() => { calls++; throw failure; }, 20, 'operation'), (error) => error === failure);
  assert.equal(calls, 1);
  assert.equal(await bounded(() => 'completed', 20, 'operation'), 'completed');
});

test('real subprocess startup errors are observed and close is awaited', async () => {
  await assert.rejects(runCommand('/no-such-operational-browser-executable', []), /ENOENT/);
  await assert.rejects(runCommand(process.execPath, ['--eval', 'process.exitCode = 7']), /failed \(7\)/);
  assert.equal(await runCommand(process.execPath, ['--eval', 'console.log("finite CLI complete")']), 'finite CLI complete');
});

test('real owned subprocess graceful shutdown waits for its close event', async () => {
  const owned = managedProcess(process.execPath, ['--eval', 'console.log("ready");setInterval(()=>{},1000)']);
  try {
    await once(owned.child.stdout, 'data');
    assert.equal(owned.settled, false);
    const result = await stopManagedProcess(owned, { timeoutMs: 1000 });
    assert.equal(owned.settled, true);
    assert.equal(result.signal, 'SIGTERM');
    assert.deepEqual(await stopManagedProcess(owned), result);
  } finally { if (!owned.settled) await stopManagedProcess(owned); }
});

test('hung shutdown is killed, awaited, and reported instead of silently passing', async () => {
  const owned = managedProcess(process.execPath, ['--eval', 'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)']);
  await once(owned.child.stdout, 'data');
  await assert.rejects(stopManagedProcess(owned, { timeoutMs: 20, killTimeoutMs: 1000 }), /shutdown timed out/);
  assert.equal(owned.settled, true);
  assert.equal((await owned.closed).signal, 'SIGKILL');
});

test('partial batches require exact accepted and retained-busy references', () => {
  const body = { data: { partial: true, data: { results: [
    { id: 'safe', source: 'live', outcome: 'accepted' }, { id: 'busy', source: 'live', outcome: 'busy' },
  ], failures: [] } } };
  assert.doesNotThrow(() => assertOperationalBatch(body, 'safe', 'busy'));
  const deadLetters = structuredClone(body);
  for (const result of deadLetters.data.data.results) result.source = 'dead-letter';
  assert.doesNotThrow(() => assertOperationalBatch(deadLetters, 'safe', 'busy', 'dead-letter'));
  assert.throws(() => assertOperationalBatch(deadLetters, 'safe', 'busy', 'live'));
  assert.throws(() => assertOperationalBatch({ data: { ...body.data, partial: false } }, 'safe', 'busy'));
  assert.throws(() => assertOperationalBatch(body, 'another-connection-id', 'busy'));
  for (const outcome of ['missing', 'protected', 'not-failed', 'accepted']) {
    const changed = structuredClone(body); changed.data.data.results[1].outcome = outcome;
    assert.throws(() => assertOperationalBatch(changed, 'safe', 'busy'));
  }
});

test('failed-job evidence requires actual scoped, redacted and bounded retained traces', () => {
  const safe = { status: 'failed', connection: 'redis', queue: 'default',
    error: 'Operational fixture mail failure password=[redacted]', stacktrace: ['Error: Operational fixture mail failure token=[redacted]\n at SendWelcomeEmail.handle'],
    payload: { token: '[redacted]' }, metadata: { token: '[redacted]' } };
  assert.doesNotThrow(() => assertSafeOperationalJob(safe));
  for (const patch of [{ connection: 'database' }, { queue: 'another-queue' }, { status: 'waiting' }, { stacktrace: [] },
    { stacktrace: ['x'.repeat(32001)] }, { stacktrace: Array(6).fill('safe') }, { payload: { token: fixtureSecret } }]) {
    assert.throws(() => assertSafeOperationalJob({ ...safe, ...patch }));
  }
});

test('runner deep mode is opt-in and retains real HTTP/CLI/ORM and JSON evidence boundaries', async () => {
  const runner = await readFile(new URL('./browser-smoke.mjs', import.meta.url), 'utf8');
  const fixtures = await readFile(new URL('./operational-browser-fixtures.mjs', import.meta.url), 'utf8');
  assert.match(runner, /const operationalDeep = has\('--operational-deep'\)/);
  assert.match(runner, /else await runBrowserSmoke\(\)/);
  assert.match(runner, /await operationalFixture\.close\(smokeFailure\)/);
  assert.match(runner, /route\.continue\(\)/);
  assert.doesNotMatch(runner, /route\.fulfill\(/);
  assert.match(fixtures, /readonly: true, fileMustExist: true/);
  assert.match(fixtures, /await handle\.backup\(isolatedDatabase\)/);
  assert.match(fixtures, /class FixtureWorker extends QueueWorkCommand/);
  assert.match(fixtures, /new PermissionProfiles\(manifest\)\.forPlatform\(\)\.setCustom/);
  assert.match(fixtures, /'evidence\.json'/);
  assert.doesNotMatch(fixtures, /alias:\s*\{|packages\/svelar\/src|npm.*install|\.raw\(/);
  assert.doesNotMatch(fixtures, /writeFile\([^\n]*(?:hooks\.server|app\.ts|page\.svelte)/);
});
