import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const runtime = await import(pathToFileURL(resolve(import.meta.dirname, '../../../scripts/runtime-certification.mjs')).href);
const runId = 'db7cff73-3a5f-4b50-a85b-6af492f514af';
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'svelar-runtime-runner-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function report(cwd: string) {
  return { success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: [{ name: join(cwd, 'tests/native.test.ts'), status: 'passed', assertionResults: [{ status: 'passed' }] }] };
}

describe('Native runtime certification runner', () => {
  it('requires explicit existing client dependencies without installing or selecting a default database', async () => {
    expect(runtime.parseOptions([]).clients).toBe(runtime.defaultClients);
    expect(runtime.parseOptions([]).reportDir).toBe(runtime.defaultReportDirectory);
    expect(runtime.parseOptions(['--clients=./isolated/package.json', '--timeout=45']).clients).toBe(resolve('isolated/package.json'));
    expect(runtime.parseOptions(['--report-dir=./artifacts']).reportDir).toBe(resolve('artifacts'));
    await writeFile(join(directory, 'package.json'), '{}');
    await expect(runtime.validateClients(join(directory, 'package.json'))).rejects.toThrow('Missing installed client postgres');
    await expect(runtime.validateClients(join(directory, 'missing/package.json'))).rejects.toThrow('Cannot read isolated');
  });
  it.each(['--clients=', '--report-dir=', '--timeout=0', '--timeout=NaN', '--startup-timeout=1801', '--db=production', '--skip-native'])('rejects unsafe or unknown invocation %s', flag => {
    expect(() => runtime.parseOptions([flag])).toThrow();
  });
  it('overwrites every native opt-in and endpoint, removing inherited user database and child-role settings', () => {
    const env = runtime.nativeEnvironment({ PATH: '/tools', DB_PASSWORD: 'user-secret', DATABASE_URL: 'postgres://user-database',
      SVELAR_TEST_QUEUE_REDIS_URL: 'redis://user-redis', SVELAR_QUEUE_MONITOR_CHILD: 'worker', SVELAR_TEST_INBOX_OPERATIONS_NATIVE: '0',
      SVELAR_TEST_CACHE_REDIS_DOCKER: '0',
      SVELAR_TEST_TEAMS_NATIVE: '0', SVELAR_TEST_TEAMS_CLIENT: '/wrong-team-client',
      SVELAR_TEST_MYSQL_URL: '0', SVELAR_TEST_MYSQL_URL_MODULES: '/wrong-mysql-modules',
      SVELAR_TEST_SHARED_MEILI: '0', SVELAR_TEST_DEPLOY_DOCKER: '0', SVELAR_TEST_POSTGRES_CLIENT: '/wrong', SVELAR_TEST_SSE_CLIENT: '/wrong' },
    '/isolated/package.json', { redis: 50101, postgres: 50102, mysql: 50103 });
    expect(env.PATH).toBe('/tools'); expect(env.DB_PASSWORD).toBeUndefined(); expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SVELAR_QUEUE_MONITOR_CHILD).toBeUndefined();
    expect(env.SVELAR_TEST_QUEUE_REDIS_URL).toBe('redis://127.0.0.1:50101/0');
    expect(env.SVELAR_TEST_REDIS_URL).toBe(env.SVELAR_TEST_QUEUE_REDIS_URL); expect(env.SVELAR_TEST_SSE_REDIS_URL).toBe(env.SVELAR_TEST_REDIS_URL);
    for (const key of ['SVELAR_TEST_QUEUE_CLIENT', 'SVELAR_TEST_REDIS_CLIENT', 'SVELAR_TEST_SSE_CLIENT', 'SVELAR_TEST_POSTGRES_CLIENT', 'SVELAR_TEST_INBOX_OPERATION_CLIENT', 'SVELAR_TEST_TEAMS_CLIENT']) expect(env[key]).toBe('/isolated/package.json');
    for (const key of ['SVELAR_TEST_INBOX_OPERATIONS_NATIVE', 'SVELAR_TEST_SHARED_MEILI', 'SVELAR_TEST_DEPLOY_DOCKER', 'SVELAR_TEST_CACHE_REDIS_DOCKER', 'SVELAR_TEST_TEAMS_NATIVE', 'SVELAR_TEST_MYSQL_URL']) expect(env[key]).toBe('1');
    expect(env.SVELAR_TEST_MYSQL_URL_MODULES).toBe('/isolated/node_modules');
    expect(env.SVELAR_TEST_SCHEMA_POSTGRES_URL).toContain('/schema_proof'); expect(env.SVELAR_TEST_QUEUE_MYSQL_PORT).toBe('50103');
  });
  it('keeps owned Redis lifecycle and Docker recovery in the existing mandatory source gate', () => {
    expect(runtime.nativeGates).toHaveLength(9);
    expect(runtime.nativeGates.find((gate: { name: string }) => gate.name === 'redis-coordination').files).toEqual([
      'cache-atomic-redis.test.ts', 'cache-redis-lifecycle-native.test.ts', 'rate-limit-redis-processes.test.ts', 'broadcasting-redis-processes.test.ts',
    ]);
    expect(runtime.nativeGates.flatMap((gate: { files: string[] }) => gate.files).filter((file: string) => file === 'cache-redis-lifecycle-native.test.ts')).toHaveLength(1);
  });
  it('wires remaining invitation and MySQL URL native obligations exactly once into the existing SQL gate', () => {
    expect(runtime.nativeGates).toHaveLength(9);
    expect(runtime.nativeGates.find((gate: { name: string }) => gate.name === 'queue-sql').files).toEqual([
      'queue-monitoring-drivers.test.ts', 'team-invitation-drivers.test.ts', 'connection-mysql-url.test.ts',
    ]);
    const files = runtime.nativeGates.flatMap((gate: { files: string[] }) => gate.files);
    for (const file of ['team-invitation-drivers.test.ts', 'connection-mysql-url.test.ts']) expect(files.filter((entry: string) => entry === file)).toHaveLength(1);
  });
  it('accepts only complete positive-count native reports with every requested file passing', () => {
    expect(runtime.verifyReport(report(directory), ['native.test.ts'], directory)).toEqual({ files: 1, passed: 1, skipped: 0 });
    for (const changed of [{ numTotalTests: 0 }, { success: false }, { numPendingTests: 1 }, { numTodoTests: 1 }, { numFailedTestSuites: 1 }, { numPassedTests: 0 }]) {
      expect(() => runtime.verifyReport({ ...report(directory), ...changed }, ['native.test.ts'], directory)).toThrow();
    }
    expect(() => runtime.verifyReport(report(directory), ['missing.test.ts'], directory)).toThrow('inventory');
    const skipped = report(directory); skipped.testResults[0].assertionResults[0].status = 'skipped';
    expect(() => runtime.verifyReport(skipped, ['native.test.ts'], directory)).toThrow('assertions');
  });
  it('redacts quoted, escaped, bare and URI credentials while retaining failure paths and correlation evidence', async () => {
    const input = `password=bare-secret {"password":"json-secret","clientSecret":"client-secret"} \\"password\\":\\"escaped-secret\\" postgres://user:uri-secret@127.0.0.1/db Authorization: Bearer bearer-secret correlationId=trace-123 Error: write EPIPE at /fixture.ts:163`;
    const redacted = runtime.redactEvidence(input);
    for (const secret of ['bare-secret', 'json-secret', 'client-secret', 'escaped-secret', 'uri-secret', 'bearer-secret']) expect(redacted).not.toContain(secret);
    expect(redacted).toContain('trace-123'); expect(redacted).toContain('/fixture.ts:163');
    await runtime.writeEvidence(directory, 'failure.json', { password: 'object-secret', failureMessage: input, correlationId: 'trace-123' });
    const stored = await readFile(join(directory, 'failure.json'), 'utf8');
    expect(stored).not.toContain('object-secret'); expect(stored).not.toContain('json-secret');
    expect(JSON.parse(stored).correlationId).toBe('trace-123');
    await expect(runtime.writeEvidence(directory, '../escape', 'unsafe')).rejects.toThrow('filename');
  });
  it('preserves failed native JSON and redacted output after temporary cleanup without retrying the gate', async () => {
    const temporary = join(directory, 'temporary'); const artifacts = join(directory, 'artifacts');
    await mkdir(temporary); await mkdir(artifacts);
    let calls = 0;
    const failed = { ...report(directory), success: false, numPassedTests: 0, numFailedTests: 1 };
    const failure = Object.assign(new Error('write EPIPE'), { stdout: 'correlationId=trace-123', stderr: 'password=secret-value write EPIPE' });
    await expect(runtime.runNativeGate({ name: 'fixture', files: ['native.test.ts'] }, {
      cwd: directory, temporaryDirectory: temporary, reportDirectory: artifacts, vitest: '/vitest', timeoutMs: 1000,
    }, async (_command: string, args: string[]) => {
      calls++; await writeFile(args.at(-1)!.slice('--outputFile.json='.length), JSON.stringify(failed)); throw failure;
    })).rejects.toBe(failure);
    await rm(temporary, { recursive: true });
    expect(calls).toBe(1);
    expect(JSON.parse(await readFile(join(artifacts, 'fixture.json'), 'utf8')).numFailedTests).toBe(1);
    const log = await readFile(join(artifacts, 'fixture.log'), 'utf8');
    expect(log).toContain('write EPIPE'); expect(log).toContain('trace-123'); expect(log).toContain('--no-file-parallelism');
    expect(log).not.toContain('secret-value');
  });
  it('retains timeout logs when a terminated gate cannot produce a JSON report', async () => {
    const failure = new Error('Command exceeded 1000ms');
    await expect(runtime.runNativeGate({ name: 'timeout', files: ['native.test.ts'] }, {
      cwd: directory, temporaryDirectory: directory, reportDirectory: directory, vitest: '/vitest', timeoutMs: 1000,
    }, async () => { throw failure; })).rejects.toBe(failure);
    expect(await readFile(join(directory, 'timeout.log'), 'utf8')).toContain('exceeded 1000ms');
  });
  it('retains a failed preflight manifest without touching Docker or deleting another run', async () => {
    await writeFile(join(directory, 'previous-run.json'), '{"preserved":true}');
    await expect(runtime.certifyRuntime({ clients: join(directory, 'missing/package.json'), reportDir: directory })).rejects.toThrow('Cannot read isolated');
    const entries = await readdir(directory);
    const run = entries.find((name) => name !== 'previous-run.json')!;
    const manifest = JSON.parse(await readFile(join(directory, run, 'manifest.json'), 'utf8'));
    expect(manifest.status).toBe('failed'); expect(manifest.cleanup).toBe('not-needed');
    expect(manifest.gates.every((gate: { status: string }) => gate.status === 'not-run')).toBe(true);
    expect(await readFile(join(directory, run, 'failure.json'), 'utf8')).toContain('Cannot read isolated');
    expect(await readFile(join(directory, 'previous-run.json'), 'utf8')).toBe('{"preserved":true}');
  });
  it('labels created Docker resources but never adds labels to inspect, delete or exec commands', async () => {
    const config = { binary: '/real/docker', runId, directory };
    const label = `${runtime.ownerLabel}=${runId}`;
    for (const args of [['run', '--name', 'owned', 'image'], ['build', '-t', 'owned', '.']]) {
      expect(await runtime.labelledDockerArgs(args, config)).toEqual([args[0], '--label', label, ...args.slice(1)]);
    }
    expect(await runtime.labelledDockerArgs(['network', 'create', 'owned'], config)).toEqual(['network', 'create', '--label', label, 'owned']);
    expect(await runtime.labelledDockerArgs(['volume', 'create', 'owned'], config)).toEqual(['volume', 'create', '--label', label, 'owned']);
    expect(await runtime.labelledDockerArgs(['exec', 'owned', 'ping'], config)).toEqual(['exec', 'owned', 'ping']);
    await expect(runtime.labelledDockerArgs(['run', 'image'], { ...config, runId: 'foreign' })).rejects.toThrow('ownership');
  });
  it('labels Compose-created resources through a separate overlay without modifying external infrastructure or original files', async () => {
    const original = join(directory, 'original.json'); await writeFile(original, '{"services":{"app":{}}}');
    const calls: string[][] = [];
    const args = ['compose', '-f', original, 'up', '-d'];
    const labelled = await runtime.labelledDockerArgs(args, { binary: '/real/docker', runId, directory }, async (_binary: string, values: string[]) => {
      calls.push(values); return { stdout: JSON.stringify({ services: { app: {}, worker: {} },
        networks: { internal: {}, existing: { external: true } }, volumes: { private: {}, shared: { external: true } } }) };
    });
    expect(calls).toEqual([['compose', '-f', original, 'config', '--format', 'json']]);
    expect(labelled.slice(0, 3)).toEqual(args.slice(0, 3)); expect(labelled.slice(-2)).toEqual(['up', '-d']);
    const overlay = JSON.parse(await readFile(labelled[4], 'utf8'));
    expect(overlay.services.app.labels[runtime.ownerLabel]).toBe(runId); expect(overlay.services.worker.labels[runtime.ownerLabel]).toBe(runId);
    expect(Object.keys(overlay.networks)).toEqual(['internal']); expect(Object.keys(overlay.volumes)).toEqual(['private']);
    expect(await readFile(original, 'utf8')).toBe('{"services":{"app":{}}}');
  });
  it('attempts all ownership-filtered cleanup even after a failure and preserves nonzero failure', async () => {
    const calls: string[][] = [];
    await expect(runtime.cleanupOwned('/real/docker', runId, async (_binary: string, args: string[]) => {
      calls.push(args); if (args[0] === 'rm') throw new Error('Container removal failed');
      return { stdout: args[0] === 'ps' ? 'owned-container\n' : '' };
    })).rejects.toThrow('cleanup failed');
    expect(calls).toContainEqual(['rm', '--force', '--volumes', 'owned-container']);
    expect(calls.filter(args => args.includes('--filter'))).toHaveLength(4);
    expect(calls.filter(args => args.includes('--filter')).every(args => args.at(-1) === `label=${runtime.ownerLabel}=${runId}`)).toBe(true);
    expect(calls.some(args => args.includes('prune'))).toBe(false);
  });
  it('bounds a real hung process, handles nonzero exits and rejects an already-aborted invocation', async () => {
    await expect(runtime.runCommand(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { timeoutMs: 50, graceMs: 25 })).rejects.toThrow('exceeded');
    await expect(runtime.runCommand(process.execPath, ['-e', 'process.exit(7)'])).rejects.toThrow('exited 7');
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await expect(runtime.runCommand(process.execPath, ['-e', 'process.exit(0)'], { signal: controller.signal })).rejects.toThrow('cancelled');
  });
});
