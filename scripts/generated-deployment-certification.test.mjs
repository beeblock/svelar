import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acceptancePlan, archiveIdentity, assertAvailability, assertDrain, assertOwned, assertProbe,
  certifyGeneratedDeployment, deploymentCliArguments, generatedDockerProxySource, imageProofSource, installedIdentity, parseOptions, scope } from './generated-deployment-certification.mjs';
import { ownerLabel } from './runtime-certification.mjs';

const sha = 'a'.repeat(64);
const args = ['--tarball=/owned/core.tgz', `--sha256=${sha}`];

test('native execution is opt-in and the plan distinguishes generated HTTP from source-native workers', () => {
  const options = parseOptions(args);
  assert.equal(options.execute, false);
  const plan = acceptancePlan(options);
  assert.equal(plan.mode, 'plan-only');
  assert.equal(plan.artifact.sha256, sha);
  assert.match(scope.installed, /generated adapter-node/);
  assert.match(scope.workers, /separate source-native evidence/);
  assert.ok(plan.checks.some((check) => check.includes('locked compatible')));
  assert.ok(plan.checks.some((check) => check.includes('zero retries')));
});

test('parser refuses implicit core builds, missing provenance and unbounded setup', () => {
  for (const invalid of [[], ['--tarball=/owned/core.tgz'], [...args, '--build'], [...args, '--timeout=0'], [...args, '--timeout=3601'], [...args, '--timeout=NaN']]) {
    assert.throws(() => parseOptions(invalid));
  }
  assert.equal(parseOptions([...args, '--execute']).execute, true);
  assert.equal(parseOptions([...args, '--execute', '--plan']).execute, false);
});

test('calling the runner without explicit execution cannot start even an archive read', async () => {
  await assert.rejects(certifyGeneratedDeployment(parseOptions(args)), /requires explicit --execute/);
});

test('local initial deployment, promotion and retained rollback never request a registry pull', () => {
  const cli = '/owned/app/node_modules/@beeblock/svelar/dist/cli/bin.js';
  for (const operation of [
    ['--image=owned-release:one', '--compatible-migrations'],
    ['--image=owned-release:two', '--compatible-migrations'],
    ['--rollback'],
  ]) {
    assert.deepEqual(deploymentCliArguments(cli, operation), [cli, 'prod:deploy', '--no-pull', ...operation]);
    assert.equal(deploymentCliArguments(cli, operation).includes('--no-migrate'), false);
  }
});

test('archive provenance checks bytes, not the archive name or package version', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'generated-deploy-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'core.tgz');
  const bytes = Buffer.from('light provenance fixture, not a native package proof');
  await writeFile(path, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const actual = await archiveIdentity(path, digest);
  assert.equal(actual.integrity, `sha512-${createHash('sha512').update(bytes).digest('base64')}`);
  await assert.rejects(archiveIdentity(path, sha), /SHA256 mismatch/);
});

async function consumer(t) {
  const app = await mkdtemp(join(tmpdir(), 'generated-deploy-consumer-unit-'));
  t.after(() => rm(app, { recursive: true, force: true }));
  const core = join(app, 'node_modules/@beeblock/svelar');
  await mkdir(join(core, 'dist/cli'), { recursive: true });
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'light-contract-fixture', private: true }));
  await writeFile(join(core, 'package.json'), JSON.stringify({ name: '@beeblock/svelar', version: '0.8.0', bin: { svelar: './dist/cli/bin.js' }, exports: { './package.json': './package.json' } }));
  await writeFile(join(core, 'dist/cli/bin.js'), '// Contract fixture only. Never invoked.\n');
  await writeFile(join(app, 'core.tgz'), 'contract fixture archive bytes');
  const bytes = Buffer.from('contract fixture archive bytes');
  const artifact = { sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
  const entry = { version: '0.8.0', resolved: 'file:core.tgz', integrity: artifact.integrity };
  async function lock(value = entry) { await writeFile(join(app, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@beeblock/svelar': value } })); }
  await lock();
  return { app, core, artifact, entry, lock };
}

test('installed proof requires a physical public CLI and selected-archive SHA512 lock', async (t) => {
  const fixture = await consumer(t);
  const proof = await installedIdentity(fixture.app, fixture.artifact);
  assert.equal(proof.version, '0.8.0');
  assert.equal(proof.packagePath, await realpath(join(fixture.core, 'package.json')));
  assert.equal(proof.integrity, fixture.artifact.integrity);
  await fixture.lock({ ...fixture.entry, integrity: 'sha512-another-same-version-archive' });
  await assert.rejects(installedIdentity(fixture.app, fixture.artifact), /selected archive integrity/);
});

test('a reused installed version with changed archive bytes is rejected even with a matching lock field', async (t) => {
  const fixture = await consumer(t);
  await writeFile(join(fixture.app, 'core.tgz'), 'different archive, same package version');
  await assert.rejects(installedIdentity(fixture.app, fixture.artifact), /SHA256 mismatch/);
});

test('workspace/source links cannot stand in for installed core', async (t) => {
  const fixture = await consumer(t);
  const linked = join(fixture.app, 'workspace-core');
  await mkdir(linked);
  await writeFile(join(linked, 'package.json'), JSON.stringify({ name: '@beeblock/svelar', exports: { './package.json': './package.json' } }));
  await rm(fixture.core, { recursive: true });
  await symlink(linked, fixture.core, 'dir');
  await assert.rejects(installedIdentity(fixture.app, fixture.artifact), /linked\/source-aliased/);
});

test('readiness requires real status and boolean envelope; liveness alone is insufficient', () => {
  assertProbe({ status: 200, body: { data: { ready: true } } }, { status: 200, ready: true });
  assertProbe({ status: 503, body: { data: { ready: false, slot: 'blue' } } }, { status: 503, ready: false, slot: 'blue' });
  for (const probe of [{ status: 200 }, { status: 200, body: { data: { ready: 'true' } } }, { status: 503, body: { data: { ready: true } } }]) {
    assert.throws(() => assertProbe(probe, { status: 200, ready: true }));
  }
});

const samples = () => ['promotion', 'promotion', 'rollback', 'rollback'].map((phase) => ({ phase, status: 200 }));

test('availability requires positive samples during BOTH promotion and rollback', () => {
  assert.equal(assertAvailability(samples()).requests, 4);
  assert.throws(() => assertAvailability([]), /Missing/);
  assert.throws(() => assertAvailability(samples().filter((sample) => sample.phase === 'promotion')), /rollback/);
  const windows = ['promotion', 'rollback'].map((phase) => ({ phase, startedAt: 10, finishedAt: 20 }));
  assert.throws(() => assertAvailability(samples().map((sample) => ({ ...sample, startedAt: 21, finishedAt: 22 })), windows), /Missing/);
  assert.equal(assertAvailability(samples().map((sample) => ({ ...sample, startedAt: 12, finishedAt: 15 })), windows).requests, 4);
  assert.throws(() => assertAvailability(samples(), []), /command window/);
});

test('a failed or dropped ordinary request cannot be hidden by a later successful sample', () => {
  for (const failed of [{ phase: 'promotion', status: 503 }, { phase: 'rollback', status: null, error: 'socket closed' }]) {
    assert.throws(() => assertAvailability([...samples(), failed]));
  }
  assert.equal(assertAvailability(samples()).retried, 0);
});

test('HTTP drain requires real SIGTERM, live held request, successful response and clean exit', () => {
  const valid = { signal: '15', runningBeforeRelease: true, status: 200, exitCode: 0, oomKilled: false, elapsedMs: 2500 };
  assertDrain(valid);
  assertDrain({ ...valid, signal: 'SIGTERM' });
  for (const failure of [{ signal: '9' }, { runningBeforeRelease: false }, { status: 500 }, { exitCode: 137 }, { oomKilled: true }, { elapsedMs: 2 }, { elapsedMs: NaN }]) {
    assert.throws(() => assertDrain({ ...valid, ...failure }), /SIGTERM/);
  }
});

test('container observations refuse other runs and unlabeled shared services', () => {
  const runId = 'exact-owned-run';
  assertOwned({ Config: { Labels: { [ownerLabel]: runId } } }, runId);
  assert.throws(() => assertOwned({ Config: { Labels: { [ownerLabel]: 'another-run' } } }, runId));
  assert.throws(() => assertOwned({ Config: { Labels: {} } }, runId));
});

test('owned Docker proxy and image public-entry probe compile without running native code', () => {
  for (const source of [imageProofSource, generatedDockerProxySource({ directory: '/owned/tools', binary: '/usr/bin/docker', runId: 'ebcd8ab9-5d97-4589-a15d-44652b66c33d' })]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8', timeout: 1000 });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('label proxy preserves machine-readable credential values; evidence redaction is not transport redaction', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'generated-deploy-proxy-unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, 'fake-docker');
  await writeFile(binary, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ environment: { DB_PASSWORD: "unit-fixture-not-a-real-secret" } }));\n', { mode: 0o755 });
  const proxy = join(directory, 'proxy.cjs');
  await writeFile(proxy, generatedDockerProxySource({ directory, binary, runId: 'ebcd8ab9-5d97-4589-a15d-44652b66c33d' }));
  const result = spawnSync(process.execPath, [proxy, 'inspect'], { encoding: 'utf8', timeout: 2000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).environment.DB_PASSWORD, 'unit-fixture-not-a-real-secret');
});
