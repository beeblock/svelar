import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const coordinator = await import(new URL('../../../scripts/certify-release.mjs', import.meta.url).href);
const smoke = await import(new URL('../../../scripts/release-smoke.mjs', import.meta.url).href);
const { cliExecutionGates } = await import(new URL('../../../scripts/cli-certification.mjs', import.meta.url).href);
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const commands = Object.keys(cliExecutionGates());
const version = '0.8.0-lock.7';
const selectedSha = 'a'.repeat(64);
let root: string;

function write(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function archive(changes: Record<string, unknown> = {}) {
  const source = join(root, 'archive/package');
  write(join(source, 'package.json'), JSON.stringify({ name: '@beeblock/svelar', version, type: 'module',
    bin: { svelar: 'dist/cli/bin.js' }, exports: { './cli': { import: './dist/cli/index.js' } }, ...changes }));
  write(join(source, 'dist/cli/bin.js'), `import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
if(process.argv[2]==='--version')console.log('Svelar v'+manifest.version);else process.exitCode=9;\n`);
  write(join(source, 'dist/cli/index.js'), `export const builtinCommandNames=()=>${JSON.stringify(commands)};\n`);
  const path = join(root, 'immutable artifact.tgz');
  execFileSync('tar', ['-czf', path, '-C', join(root, 'archive'), 'package']);
  return path;
}

function prepareOptions() {
  return { dependenciesRoot: join(repository, 'node_modules'), temporaryRoot: root };
}

function options(args: string[] = []) {
  return coordinator.parseCertificationOptions(['--report-dir', join(root, 'reports'), ...args], root, {});
}

function reports() {
  const parent = join(root, 'reports');
  return existsSync(parent) ? readdirSync(parent).map((name) => JSON.parse(readFileSync(join(parent, name, 'manifest.json'), 'utf8'))) : [];
}

function extractionDirectories() { return readdirSync(root).filter((name) => name.startsWith('svelar-smoke-artifact-')); }

function typeDependencies() {
  const path = join(root, 'isolated-types/node_modules');
  for (const name of ['typescript', 'svelte', 'svelte-check']) write(join(path, name, 'package.json'), '{}');
  write(join(path, 'svelte-check/bin/svelte-check'), '// unit fixture executable');
  return path;
}

function passingOptInReport(args: string[], cwd: string) {
  const output = args.find((arg) => arg.startsWith('--outputFile.json='));
  if (!output) return;
  const files = args.filter((arg) => arg.startsWith('tests/'));
  const count = files[0].includes('search-large') ? 2 : 1;
  const total = count * files.length;
  write(output.slice('--outputFile.json='.length), JSON.stringify({ success: true, numTotalTests: total,
    numPassedTests: total, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: files.map((file) => ({ name: resolve(cwd, file), status: 'passed',
      assertionResults: Array.from({ length: count }, () => ({ status: 'passed' })) })) }));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'svelar-certification-lock-')));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

describe('Central certification options and gate inventory', () => {
  it('accepts both tarball forms, relative paths and spaces without implicit build flags', () => {
    expect(options(['--tarball=immutable artifact.tgz']).tarball).toBe(join(root, 'immutable artifact.tgz'));
    expect(options(['--tarball', 'immutable artifact.tgz']).tarball).toBe(join(root, 'immutable artifact.tgz'));
    expect(options()).toMatchObject({ tarball: undefined, fast: false, inventory: false, million: false, typeDeps: undefined });
    expect(options(['--list']).inventory).toBe(true);
    expect(options(['-h']).help).toBe(true);
  });

  it('honors explicit million/type opt-ins and their existing environment contracts', () => {
    expect(options(['--million', '--type-deps=deps2/node_modules'])).toMatchObject({ million: true, typeDeps: join(root, 'deps2/node_modules') });
    expect(options(['--type-deps', 'deps2/node_modules']).typeDeps).toBe(join(root, 'deps2/node_modules'));
    expect(coordinator.parseCertificationOptions([], root, { SVELAR_TEST_SEARCH_MILLION: '1', SVELAR_DASHBOARD_TYPE_DEPS: './deps2/node_modules' }))
      .toMatchObject({ million: true, typeDeps: join(root, 'deps2/node_modules') });
    expect(coordinator.parseCertificationOptions([], root, { SVELAR_TEST_SEARCH_MILLION: '0' }).million).toBe(false);
  });

  it.each([
    ['--tarball'], ['--tarball='], ['--tarball', '--fast'], ['--tarball=a', '--tarball=b'],
    ['--type-deps'], ['--type-deps='], ['--type-deps=a', '--type-deps', 'b'],
    ['--report-dir='], ['--skip-native'], ['--skip-tests'], ['--skip-build'], ['--unknown'],
  ])('rejects missing, repeated or unsafe gate options: %j', (...args) => {
    expect(() => coordinator.parseCertificationOptions(args, root, {})).toThrow();
  });

  it('fails closed on absent, stale and duplicated CLI execution coverage', () => {
    expect(() => coordinator.verifyCommandInventory(commands)).not.toThrow();
    expect(() => coordinator.verifyCommandInventory([...commands, 'unknown-command'])).toThrow('no execution');
    expect(() => coordinator.verifyCommandInventory(commands.slice(1))).toThrow('stale');
    expect(() => coordinator.verifyCommandInventory([...commands, commands[0]])).toThrow('duplicate');
  });

  it('locks every smoke phase and runs installed browser clients before any same-name fixture overwrite', () => {
    const path = '/immutable artifact.tgz';
    const plan = coordinator.certificationPlan(options(['--million', '--type-deps=/deps2/node_modules']), { tarballPath: path, sha256: selectedSha }, '/evidence', '/fresh-apps');
    const smokeGates = plan.filter((gate: { args?: string[] }) => gate.args?.[0].endsWith('release-smoke.mjs'));
    expect(smokeGates.map((gate: { id: string }) => gate.id)).toEqual(['fresh-new-cli-four', 'historical-upgrade-four', 'redis', 'pdf', 'search', 'pgbouncer', 's3', 'database-drivers']);
    for (const gate of smokeGates) expect(gate.args).toContain(`--tarball=${path}`);
    expect(plan.slice(3, 11).map((gate: { id: string }) => gate.id)).toEqual(['fresh-new-cli-four', 'operational-browser-fixtures', 'auth-ui-zod', 'auth-ui-valibot', 'ui-patterns', 'invitation-ui-zod', 'invitation-ui-valibot', 'populated-operations']);
    expect(plan[3].args).toEqual(expect.arrayContaining(['--app=all', '--validation=all', '--cli-execution', '--browser', '--prod']));
    expect(plan[4]).toMatchObject({ scope: 'source', command: process.execPath, args: ['--test', join(repository, 'scripts/operational-browser-fixtures.test.mjs')] });
    expect(plan[5].client).toBe('/fresh-apps/svelar-smoke-ddd');
    expect(plan[6].client).toBe('/fresh-apps/svelar-smoke-ddd-valibot');
    expect(plan[7].args).toContain('--clients=/fresh-apps/svelar-smoke-ddd/package.json');
    expect(plan[8].args).toEqual([join(repository, 'scripts/invitation-ui-certification.mjs'), '--installed-app=/fresh-apps/svelar-smoke-ddd', `--tarball=${path}`, '--report-dir=/evidence/invitation-ui-zod']);
    expect(plan[9].args).toEqual([join(repository, 'scripts/invitation-ui-certification.mjs'), '--installed-app=/fresh-apps/svelar-smoke-ddd-valibot', `--tarball=${path}`, '--report-dir=/evidence/invitation-ui-valibot']);
    expect(plan[10].args).toEqual([join(repository, 'scripts/browser-smoke.mjs'), '--app-dir=/fresh-apps/svelar-smoke-ddd', '--server-script=smoke:serve:prod', '--operational-deep', `--expected-core-sha256=${selectedSha}`, '--port=5826', '--evidence-dir=/evidence/populated-operations']);
    const native = plan.find((gate: { id: string }) => gate.id === 'native-source-runtime');
    expect(native.scope).toBe('source');
    expect(native.args).toContain('--clients=/fresh-apps/svelar-smoke-ddd/package.json');
    expect(plan.find((gate: { id: string }) => gate.id === 'million-search').env.SVELAR_TEST_SEARCH_MILLION).toBe('1');
    expect(plan.find((gate: { id: string }) => gate.id === 'operator-types')).toMatchObject({
      scope: 'source', client: '/fresh-apps/svelar-smoke-ddd',
      files: ['dashboard-operational-types.test.ts', 'release-native-coverage-harness.test.ts'],
      env: { SVELAR_DASHBOARD_TYPE_DEPS: '/deps2/node_modules', SVELAR_RELEASE_COVERAGE_TYPE_CLIENT: '/fresh-apps/svelar-smoke-ddd' },
    });
    expect(plan.find((gate: { id: string }) => gate.id === 'historical-upgrade-four').args).toContain('--upgrade-from=0.7.9');
    expect(plan.every((gate: { args?: string[] }) => !gate.args?.includes('release:dry-run'))).toBe(true);
  });

  it('fast mode explicitly omits browsers but retains native/source and all installed checks', () => {
    const plan = coordinator.certificationPlan(options(['--fast']), { tarballPath: '/immutable.tgz', sha256: selectedSha }, '/evidence');
    expect(plan.some((gate: { id: string }) => gate.id === 'native-source-runtime')).toBe(true);
    expect(plan.some((gate: { id: string }) => gate.id.startsWith('auth-ui') || gate.id === 'ui-patterns')).toBe(false);
    expect(plan.some((gate: { id: string }) => gate.id.startsWith('invitation-ui') || gate.id === 'populated-operations')).toBe(false);
    expect(plan.find((gate: { id: string }) => gate.id === 'operational-browser-fixtures').scope).toBe('source');
    expect(plan.filter((gate: { args?: string[] }) => gate.args?.includes('--tarball=/immutable.tgz'))).toHaveLength(8);
    expect(plan.some((gate: { args?: string[] }) => gate.args?.includes('--browser') || gate.args?.includes('--prod'))).toBe(false);
  });

  it('rejects unpinned deep acceptance instead of passing an undefined or invalid SHA flag', () => {
    for (const sha256 of [undefined, '', 'not-a-sha', 'a'.repeat(63)]) {
      expect(() => coordinator.certificationPlan(options(), { tarballPath: '/immutable.tgz', sha256 }, '/evidence')).toThrow('selected artifact SHA256');
    }
  });
});

describe('One-artifact orchestration and cleanup', () => {
  it('preflights real supplied bytes without building/packing and uses their real manifest version throughout', async () => {
    const path = archive(); const before = readFileSync(path);
    const build = vi.fn(); const pack = vi.fn(); const execute = vi.fn(async (_command: string, _args: string[]) => ({ stdout: '', stderr: '' }));
    const verifyClient = vi.fn();
    const result = await coordinator.certifyRelease(options(['--tarball', path]), {
      prepare: (tarball: string) => smoke.prepareSmokeArtifact(tarball, { ...prepareOptions(), build, pack }), execute, verifyClient, log: () => {},
    });
    expect(build).not.toHaveBeenCalled(); expect(pack).not.toHaveBeenCalled();
    expect(result.status).toBe('passed'); expect(result.artifact.version).toBe(version);
    expect(result.artifact.sha256).toBe(createHash('sha256').update(before).digest('hex'));
    expect(result.sourceRuntime).toEqual({ enabled: true, immutableArtifactProof: false });
    expect(result.gates.every((gate: { status: string }) => gate.status === 'passed')).toBe(true);
    expect(result.cleanup).toBe('completed'); expect(verifyClient).toHaveBeenCalledTimes(7);
    expect(readFileSync(path)).toEqual(before); expect(extractionDirectories()).toEqual([]);
    const invocations = execute.mock.calls;
    const publish = invocations.find(([, args]) => args[0] === 'publish');
    expect(publish?.[1]).toEqual(['publish', path, '--dry-run', '--ignore-scripts', '--tag=svelar-certification', '--json']);
    expect(invocations.filter(([, args]) => args[0].endsWith('release-smoke.mjs'))).toHaveLength(8);
    expect(invocations.filter(([, args]) => args[0].endsWith('release-smoke.mjs')).every(([, args]) => args.includes(`--tarball=${path}`))).toBe(true);
    expect(reports()[0].artifact).toEqual(result.artifact);
  });

  it('default orchestration builds/packs exactly once then validates and selects the artifact CLI', async () => {
    const path = archive(); const build = vi.fn(); const pack = vi.fn(() => path); const prepare = vi.fn((tarball?: string) =>
      smoke.prepareSmokeArtifact(tarball, { ...prepareOptions(), build, pack }));
    const result = await coordinator.certifyRelease(options(['--fast']), { prepare, execute: async () => ({}), verifyClient: () => {}, log: () => {} });
    expect(build).toHaveBeenCalledTimes(1); expect(pack).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls).toEqual([[undefined], [path]]);
    expect(result.artifact).toMatchObject({ version, path });
    expect(result.mode).toBe('fast-without-browser'); expect(extractionDirectories()).toEqual([]);
  });

  it('help/source inventory never builds or packs; artifact inventory validates its CLI and cleans extraction', async () => {
    const prepare = vi.fn(); const execute = vi.fn(); const readNames = vi.fn(async () => commands);
    await coordinator.certifyRelease(options(['--help']), { prepare, execute, readNames, log: () => {} });
    await coordinator.certifyRelease(options(['--inventory']), { prepare, execute, readNames, log: () => {} });
    expect(prepare).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled(); expect(readNames).toHaveBeenCalledTimes(1);
    const path = archive();
    await coordinator.certifyRelease(options(['--inventory', '--tarball', path]), {
      prepare: (tarball: string) => smoke.prepareSmokeArtifact(tarball, prepareOptions()), execute, log: () => {},
    });
    expect(execute).not.toHaveBeenCalled(); expect(extractionDirectories()).toEqual([]); expect(reports()).toEqual([]);
  });

  it.each(['missing', 'directory', 'wrong-package'])('rejects %s artifacts before any command or app mutation', async (kind) => {
    const path = kind === 'missing' ? join(root, 'missing.tgz') : kind === 'directory' ? root : archive({ name: 'wrong-framework' });
    const execute = vi.fn(); const marker = join(root, 'user-customization.ts'); write(marker, '// exact original\r\n');
    await expect(coordinator.certifyRelease(options(['--tarball', path]), {
      prepare: (tarball: string) => smoke.prepareSmokeArtifact(tarball, prepareOptions()), execute, log: () => {},
    })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled(); expect(readFileSync(marker, 'utf8')).toBe('// exact original\r\n');
    expect(extractionDirectories()).toEqual([]); expect(reports()).toEqual([]);
  });

  it.each(['fresh-new-cli-four', 'operational-browser-fixtures', 'auth-ui-zod', 'invitation-ui-zod', 'invitation-ui-valibot', 'populated-operations', 'native-source-runtime', 'historical-upgrade-four', 'database-drivers'])('stops on %s failure, preserves evidence and never proceeds/retries', async (id) => {
    const path = archive(); const settings = options(['--tarball', path]);
    const ids = coordinator.certificationPlan(settings, { tarballPath: path, sha256: selectedSha }, '/report').map((gate: { id: string }) => gate.id);
    const failedIndex = ids.indexOf(id); let calls = 0;
    const error = new Error('password=fixture-secret gate failed');
    await expect(coordinator.certifyRelease(settings, {
      prepare: (tarball: string) => smoke.prepareSmokeArtifact(tarball, prepareOptions()), verifyClient: () => {}, log: () => {},
      execute: async () => { if (calls++ === failedIndex) throw error; return {}; },
    })).rejects.toBe(error);
    expect(calls).toBe(failedIndex + 1); expect(extractionDirectories()).toEqual([]);
    const evidence = reports()[0]; expect(evidence.status).toBe('failed'); expect(evidence.cleanup).toBe('completed');
    expect(evidence.gates[failedIndex].status).toBe('failed'); expect(evidence.gates.slice(failedIndex + 1).every((gate: { status: string }) => gate.status === 'not-run')).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain('fixture-secret');
    const commandLog = readFileSync(evidence.gates[failedIndex].logPath, 'utf8');
    expect(commandLog).toContain('FAILURE'); expect(commandLog).toContain('gate failed');
    expect(commandLog).not.toContain('fixture-secret');
  });

  it('persists completed stdout/stderr per gate with secrets redacted and child streaming disabled', async () => {
    const path = archive(); const log = vi.fn();
    const stdout = 'correlationId=trace-log-123 ' + 'Authorization: Bearer split-' + 'credential {"password":"fixture-password"}';
    const stderr = 'warning from /fixture.ts:17 api_key=fixture-key';
    const execute = vi.fn(async (_command: string, _args: string[], _settings: { stream: boolean }) => ({ stdout, stderr }));
    const result = await coordinator.certifyRelease(options(['--tarball', path]), {
      prepare: (tarball: string) => smoke.prepareSmokeArtifact(tarball, prepareOptions()), execute, verifyClient: () => {}, log,
    });
    for (const gate of result.gates) {
      expect(gate.logPath).toMatch(new RegExp(`/${gate.id}/command\\.log$`));
      const output = readFileSync(gate.logPath, 'utf8');
      expect(output).toContain('STDOUT'); expect(output).toContain('STDERR');
      expect(output).toContain('trace-log-123'); expect(output).toContain('/fixture.ts:17');
      for (const secret of ['split-credential', 'fixture-password', 'fixture-key']) expect(output).not.toContain(secret);
      expect(gate.durationMs).toBeGreaterThanOrEqual(0); expect(gate.finishedAt).toBeTruthy();
    }
    expect(execute.mock.calls.every(([, , settings]) => settings.stream === false)).toBe(true);
    for (const secret of ['split-credential', 'fixture-password', 'fixture-key']) expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it('retains failed deadline evidence and output before cleanup without continuing another phase', async () => {
    const path = archive(); let recordedBeforeCleanup = false;
    const error = Object.assign(new Error('Command exceeded 10800000ms password=deadline-secret'), {
      code: 'ETIMEDOUT', signal: 'SIGTERM', stdout: 'correlationId=timeout-123 Authorization: Bearer timeout-token', stderr: 'write ETIMEDOUT at /fixture.ts:31 api_key=timeout-key',
    });
    const execute = vi.fn(async () => { throw error; });
    await expect(coordinator.certifyRelease(options(['--tarball', path]), {
      prepare: (tarball: string) => {
        const artifact = smoke.prepareSmokeArtifact(tarball, prepareOptions()); const cleanup = artifact.cleanup;
        artifact.cleanup = () => { const failed = reports()[0].gates[0]; recordedBeforeCleanup = existsSync(failed.logPath); cleanup(); };
        return artifact;
      }, execute, log: () => {},
    })).rejects.toBe(error);
    expect(recordedBeforeCleanup).toBe(true); expect(execute).toHaveBeenCalledTimes(1);
    const evidence = reports()[0]; const failed = evidence.gates[0]; const output = readFileSync(failed.logPath, 'utf8');
    expect(failed.status).toBe('failed'); expect(failed.deadlineMs).toBe(10800000); expect(failed.durationMs).toBeGreaterThanOrEqual(0);
    for (const value of ['ETIMEDOUT', 'SIGTERM', '10800000', 'timeout-123', '/fixture.ts:31']) expect(output).toContain(value);
    for (const secret of ['deadline-secret', 'timeout-token', 'timeout-key']) expect(output).not.toContain(secret);
    expect(evidence.gates.slice(1).every((gate: { status: string }) => gate.status === 'not-run')).toBe(true);
    expect(extractionDirectories()).toEqual([]);
  });

  it('detects artifact mutation during a gate before any later gate can consume changed bytes', async () => {
    const path = archive(); let calls = 0;
    await expect(coordinator.certifyRelease(options(['--tarball', path]), {
      prepare: (tarball: string) => smoke.prepareSmokeArtifact(tarball, prepareOptions()), log: () => {},
      execute: async () => { calls++; writeFileSync(path, 'changed archive bytes'); return {}; },
    })).rejects.toThrow('bytes changed');
    expect(calls).toBe(1); expect(reports()[0].gates[0].status).toBe('failed'); expect(extractionDirectories()).toEqual([]);
  });

  it('fails rather than claiming browser proof when a fresh installed client has wrong provenance', async () => {
    const path = archive(); const verifyClient = vi.fn(() => { throw new Error('Client integrity mismatch'); }); const execute = vi.fn(async () => ({}));
    await expect(coordinator.certifyRelease(options(['--tarball', path]), {
      prepare: (tarball: string) => smoke.prepareSmokeArtifact(tarball, prepareOptions()), verifyClient, execute, log: () => {},
    })).rejects.toThrow('integrity mismatch');
    expect(execute).toHaveBeenCalledTimes(5); expect(reports()[0].gates[5].status).toBe('failed'); expect(extractionDirectories()).toEqual([]);
  });

  it('runs opted-in million/type tests with positive zero-skip JSON reports and isolated explicit settings', async () => {
    const path = archive(); const deps = typeDependencies();
    const execute = vi.fn(async (_command: string, args: string[], settings: { cwd: string; env: Record<string, string | undefined> }) => { passingOptInReport(args, settings.cwd); return { stdout: '', stderr: '' }; });
    const result = await coordinator.certifyRelease(options(['--tarball', path, '--million', '--type-deps', deps]), {
      prepare: (tarball: string) => smoke.prepareSmokeArtifact(tarball, prepareOptions()), execute, verifyClient: () => {}, log: () => {},
      environment: { SVELAR_TEST_SEARCH_MILLION: '1', SVELAR_DASHBOARD_TYPE_DEPS: '/incorrect-deps', SVELAR_RELEASE_COVERAGE_TYPE_CLIENT: '/incorrect-client' },
    });
    expect(result.gates.find((gate: { id: string }) => gate.id === 'million-search').result).toMatchObject({ passed: 2, skipped: 0 });
    expect(result.gates.find((gate: { id: string }) => gate.id === 'operator-types').result).toMatchObject({ files: 2, passed: 2, skipped: 0 });
    expect(execute.mock.calls[0][2].env.SVELAR_TEST_SEARCH_MILLION).toBeUndefined();
    expect(execute.mock.calls[0][2].env.SVELAR_DASHBOARD_TYPE_DEPS).toBeUndefined();
    expect(execute.mock.calls[0][2].env.SVELAR_RELEASE_COVERAGE_TYPE_CLIENT).toBeUndefined();
    const typeInvocation = execute.mock.calls.find((call) => call[1].includes('tests/release-native-coverage-harness.test.ts'))!;
    expect(typeInvocation[2].env.SVELAR_RELEASE_COVERAGE_TYPE_CLIENT).toBe(join(repository, '../svelar-testing-area/apps/svelar-smoke-ddd'));
    expect(result.optional).toEqual({ million: true, typeDeps: deps }); expect(extractionDirectories()).toEqual([]);
    for (const id of ['million-search', 'operator-types']) {
      const gate = result.gates.find((entry: { id: string }) => entry.id === id);
      expect(existsSync(gate.logPath)).toBe(true);
      const directory = dirname(gate.logPath);
      expect(existsSync(join(directory, `${id}.log`))).toBe(true);
      expect(JSON.parse(readFileSync(join(directory, `${id}.json`), 'utf8')).success).toBe(true);
    }
  });

  it('rejects missing opt-in type dependencies before build/pack or any gate', async () => {
    const prepare = vi.fn(); const execute = vi.fn();
    await expect(coordinator.certifyRelease(options(['--type-deps=/missing-node-modules']), { prepare, execute })).rejects.toThrow('existing installed');
    expect(prepare).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    const incomplete = join(root, 'incomplete'); mkdirSync(incomplete);
    expect(() => coordinator.validateTypeDependencies(incomplete)).toThrow('Missing typescript');
  });

  it('rejects skipped opt-in assertions even when the child exits successfully', async () => {
    const path = archive();
    await expect(coordinator.certifyRelease(options(['--tarball', path, '--million']), {
      prepare: (tarball: string) => smoke.prepareSmokeArtifact(tarball, prepareOptions()), verifyClient: () => {}, log: () => {},
      execute: async (_command: string, args: string[], settings: { cwd: string }) => {
        passingOptInReport(args, settings.cwd);
        const output = args.find((arg) => arg.startsWith('--outputFile.json='));
        if (output) { const file = output.slice('--outputFile.json='.length); const report = JSON.parse(readFileSync(file, 'utf8')); report.numPendingTests = 1; writeFileSync(file, JSON.stringify(report)); }
        return { stdout: '', stderr: '' };
      },
    })).rejects.toThrow('zero failures, skips');
    expect(reports()[0].gates.find((gate: { id: string }) => gate.id === 'million-search').status).toBe('failed'); expect(extractionDirectories()).toEqual([]);
  });
});

describe('Installed browser/native client provenance', () => {
  it('requires the exact file dependency, installed identity and lockfile integrity, never a linked core', () => {
    const path = archive(); const app = join(root, 'app');
    const installed = join(app, 'node_modules/@beeblock/svelar');
    const artifact = { tarballPath: path, manifest: { name: '@beeblock/svelar', version } };
    write(join(app, 'package.json'), JSON.stringify({ dependencies: { '@beeblock/svelar': `file:${relative(app, path)}` } }));
    write(join(installed, 'package.json'), JSON.stringify(artifact.manifest));
    const lockfile = join(app, 'package-lock.json');
    const integrity = `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
    write(lockfile, JSON.stringify({ packages: { 'node_modules/@beeblock/svelar': { integrity } } }));
    expect(() => coordinator.verifyInstalledArtifactClient(app, artifact)).not.toThrow();
    write(lockfile, JSON.stringify({ packages: { 'node_modules/@beeblock/svelar': { integrity: 'different' } } }));
    expect(() => coordinator.verifyInstalledArtifactClient(app, artifact)).toThrow('integrity');
    write(join(installed, 'package.json'), JSON.stringify({ ...artifact.manifest, version: '0.7.9' }));
    expect(() => coordinator.verifyInstalledArtifactClient(app, artifact)).toThrow('identity/version');
    rmSync(installed, { recursive: true });
    symlinkSync(join(root, 'archive/package'), installed, 'dir');
    expect(() => coordinator.verifyInstalledArtifactClient(app, artifact)).toThrow('linked repository');
    write(join(app, 'package.json'), JSON.stringify({ dependencies: { '@beeblock/svelar': '^0.8.0' } }));
    expect(() => coordinator.verifyInstalledArtifactClient(app, artifact)).toThrow('selected archive');
  });
});
