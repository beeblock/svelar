import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertFinished, assertOrigin, assertRecovered, fixtureSources, OwnedProcess, ownerLabel, parseCommandResult, parseOptions,
  removeOwnedFixture, restorePaths, snapshotPaths, timing, workerArguments } from './installed-queue-process-certification.mjs';

const args = ['--app-dir', '/fixture/app', '--tarball', '/fixture/final.tgz', '--expected-sha256', 'a'.repeat(64), '--report-dir', '/fixture/reports'];
const origin = { teamId: 'team-a', tenantId: 'team-a', userId: 'actor-a', actorId: 'actor-a', correlationId: 'correlation-a' };
const marker = (pid = 101) => ({ id: 'same-id', pid, context: { ...origin, jobId: 'same-id' } });
const finished = (starts = 1) => ({ startedCount: starts, finishedCount: 1, finished: { id: 'same-id' } });
const job = (starts = 1) => ({ id: 'same-id', status: 'completed', attemptsStarted: starts, stalledCount: starts - 1 });

test('requires selected immutable SHA and defaults to the physical DDD client without a candidate number', () => {
  const options = parseOptions(args); assert.equal(options.expectedSha256, 'a'.repeat(64)); assert.equal(options.deadlineMs, 240000);
  const defaultClient = parseOptions(args.slice(2)); assert(defaultClient.appDir.endsWith('/apps/svelar-smoke-ddd'));
  assert.equal(options.identity, undefined); assert.equal(options.redisImage, 'redis:7-alpine');
  assert.equal(parseOptions(['--app-dir=/fixture/app', '--tarball=/fixture/other.tgz', '--expected-sha256=' + 'B'.repeat(64), '--report-dir=/fixture/reports']).expectedSha256, 'b'.repeat(64));
});

test('rejects unsafe artifact, report, image and deadline options before launching processes', () => {
  for (const changed of [[], ['--source'], args.filter((value) => value !== '--expected-sha256' && value !== 'a'.repeat(64)),
    [...args, '--expected-sha256', 'old'], [...args, '--deadline-ms', 'Infinity'], [...args, '--deadline-ms', '80000'],
    [...args, '--deadline-ms', '240000.5'], [...args, '--fixture-root', '/fixture/app/temporary'],
    [...args, '--report-dir', '/fixture/app/proof'], [...args, '--fixture-root', '/fixture/reports'],
    [...args, '--redis-image', '--privileged']]) assert.throws(() => parseOptions(changed));
});

test('worker invokes the actual packaged bin and daemon, not a source bundle or max-jobs loop', () => {
  const argv = workerArguments('/physical/core/dist/cli/bin.js', 'owned-queue', 5);
  assert.deepEqual(argv, ['/physical/core/dist/cli/bin.js', 'queue:work', '--queue=owned-queue', '--connection=proof', '--concurrency=5',
    '--lock-duration=1500', '--stalled-interval=1000', '--grace-period=8']);
  assert(!argv.some((value) => value.includes('max-jobs') || value.includes('max-time') || value.includes('/src/')));
  assert.equal(workerArguments('/physical/bin.js', 'owned', 1, true).at(-1), '--once');
  assert(timing.hold > timing.lock * 4);
  for (const concurrency of [0, -1, 1.5, 6]) assert.throws(() => workerArguments('/bin', 'queue', concurrency));
  assert.throws(() => workerArguments('/bin', 'foreign:queue', 1));
});

test('requires one real command result and rejects missing/duplicate/malformed dispatch evidence', () => {
  assert.deepEqual(parseCommandResult('CLI bootstrap\nSVELAR_INSTALLED_QUEUE_RESULT ["job-a"]\n'), ['job-a']);
  for (const text of ['', 'SVELAR_INSTALLED_QUEUE_RESULT nope', 'SVELAR_INSTALLED_QUEUE_RESULT []\nSVELAR_INSTALLED_QUEUE_RESULT []']) {
    assert.throws(() => parseCommandResult(text));
  }
});

test('origin assertion checks exact ID, actual PID and every serialized identity without accepting ambient worker state', () => {
  assertOrigin(marker(), origin, 'same-id', 101);
  for (const key of Object.keys(origin)) { const changed = marker(); changed.context[key] = 'foreign'; assert.throws(() => assertOrigin(changed, origin, 'same-id', 101)); }
  assert.throws(() => assertOrigin(marker(), origin, 'different-id', 101));
  assert.throws(() => assertOrigin(marker(), origin, 'same-id', 202));
  assert.throws(() => assertOrigin(null, origin, 'same-id', 101));
  const system = { id: 'system', pid: 101, context: { jobId: 'system' } }; assertOrigin(system, {}, 'system', 101);
  assert.throws(() => assertOrigin({ ...system, context: { jobId: 'system', actorId: 'unrelated-worker' } }, {}, 'system', 101));
});

test('completion must be exact once with native attempt counts and no hidden stalled retry', () => {
  assertFinished(job(), finished(), 'same-id');
  for (const changed of [{ ...job(), status: 'active' }, { ...job(), attemptsStarted: 2 }, { ...job(), stalledCount: 1 }, { ...job(), id: 'other' }]) {
    assert.throws(() => assertFinished(changed, finished(), 'same-id'));
  }
  for (const changed of [{ ...finished(), finishedCount: 0 }, { ...finished(), finishedCount: 2 }, { ...finished(), startedCount: 2 }]) {
    assert.throws(() => assertFinished(job(), changed, 'same-id'));
  }
});

test('recovery requires native stalled evidence, replacement PID, same ID and preserved origin', () => {
  assertRecovered(marker(101), marker(202), job(2), finished(2), origin);
  assert.throws(() => assertRecovered(marker(101), marker(101), job(2), finished(2), origin));
  assert.throws(() => assertRecovered(marker(101), marker(202), { ...job(2), stalledCount: 0 }, finished(2), origin));
  assert.throws(() => assertRecovered(marker(101), { ...marker(202), id: 'new-id' }, job(2), finished(2), origin));
  assert.throws(() => assertRecovered(marker(101), { ...marker(202), context: { ...origin, jobId: 'same-id', actorId: 'other' } }, job(2), finished(2), origin));
});

test('fixture imports only installed public paths and CLI-generated job/command identities in both layouts', () => {
  for (const shared of ['shared/', '']) {
    const sources = fixtureSources(shared); const text = Object.values(sources).join('\n');
    assert(text.includes(`$lib/${shared}jobs/InstalledQueueProbeJob`));
    assert(sources.command.includes("name = 'app:installed-queue-probe'"));
    assert(sources.command.includes('Queue.dispatchBulk')); assert(sources.command.includes('new Migrator().run(svelarCoreMigrations())'));
    assert(sources.app.includes('Queue.register(InstalledQueueProbeJob)'));
    assert(sources.job.includes('ApplicationContext.get(key)')); assert(sources.job.includes('Cache.incrementWithTtl'));
    assert(sources.job.includes('await Log.info')); assert(sources.observer.includes("'@beeblock/svelar/logging/LogViewer'"));
    assert(sources.observer.includes('adapter.get(item.id)')); assert(sources.observer.includes("process.send({ type: 'ready'"));
    assert(!/from ['"][^'"]*\/src\//.test(text)); assert(!text.includes('bullmq')); assert(!text.includes('getQueue('));
    assert(!text.includes('new QueueWorkCommand')); assert(!text.includes('Queue.work('));
    assert(!text.includes('CREATE TABLE')); assert(!text.includes('Connection.raw('));
  }
  assert.throws(() => fixtureSources('../other/'));
});

test('snapshot restores exact bytes and removes only newly generated touched files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'installed-queue-snapshot-'));
  try {
    await mkdir(join(directory, 'src')); await writeFile(join(directory, 'src/app.ts'), 'original\r\n');
    await writeFile(join(directory, 'untouched.txt'), 'not part of fixture changes');
    const before = await snapshotPaths(directory, ['src/app.ts', 'src/Job.ts']);
    await writeFile(join(directory, 'src/app.ts'), 'fixture'); await writeFile(join(directory, 'src/Job.ts'), 'generated fixture');
    await restorePaths(directory, before);
    assert.equal(await readFile(join(directory, 'src/app.ts'), 'utf8'), 'original\r\n');
    await assert.rejects(readFile(join(directory, 'src/Job.ts')), /ENOENT/);
    assert.equal(await readFile(join(directory, 'untouched.txt'), 'utf8'), 'not part of fixture changes');
    await assert.rejects(snapshotPaths(directory, ['../outside']), /escapes/);
    await symlink(join(directory, 'untouched.txt'), join(directory, 'linked'));
    await assert.rejects(snapshotPaths(directory, ['linked']), /physical/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cleanup refuses app/sibling/linked directories and removes only its direct owned fixture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'installed-queue-cleanup-')); const owned = await mkdtemp(join(root, 'svelar-queue-installed-'));
  try {
    await mkdir(join(root, 'user-app')); await symlink(join(root, 'user-app'), join(root, 'svelar-queue-installed-link'));
    await assert.rejects(removeOwnedFixture(join(root, 'user-app'), root), /unowned/);
    await assert.rejects(removeOwnedFixture(root, root), /outside/);
    await assert.rejects(removeOwnedFixture(join(root, 'svelar-queue-installed-link'), root), /linked/);
    await removeOwnedFixture(owned, root); await assert.rejects(readFile(join(owned, 'anything')), /ENOENT/);
    assert.equal(ownerLabel, 'io.svelar.installed-queue-certification');
  } finally { await rm(root, { recursive: true, force: true }); }
});

class FakeChild extends EventEmitter {
  pid = 101; stdout = new EventEmitter(); stderr = new EventEmitter(); kills = [];
  kill(signal) { this.kills.push(signal); queueMicrotask(() => this.emit('close', signal === 'SIGKILL' ? null : 0, signal === 'SIGKILL' ? signal : null)); return true; }
}

test('owned process records real exit/signal and redacted output, without retrying or substituting a daemon', async () => {
  const child = new FakeChild(); const logs = []; const handle = new OwnedProcess(child, logs, ['/physical/bin', 'queue:work'], ['fixture-password']);
  child.stdout.emit('data', Buffer.from('fixture-password worker running\n')); handle.sendSignal('SIGTERM');
  assert.equal((await handle.wait()).code, 0); assert.deepEqual(child.kills, ['SIGTERM']);
  assert(!JSON.stringify(logs).includes('fixture-password')); await handle.cleanup();
  assert.throws(() => handle.sendSignal('SIGTERM'), /exited/);
});

test('owned process preserves intentional SIGKILL but rejects unexpected nonzero exits', async () => {
  const child = new FakeChild(); const killed = new OwnedProcess(child, [], [], []); killed.sendSignal('SIGKILL');
  assert.equal((await killed.wait()).signal, 'SIGKILL'); await killed.cleanup();
  const failedChild = new FakeChild(); const failed = new OwnedProcess(failedChild, [], [], []); failedChild.emit('close', 1, null);
  await assert.rejects(failed.cleanup(), /successfully/);
});
