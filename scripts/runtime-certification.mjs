#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const repository = resolve(dirname(script), '..');
export const ownerLabel = 'io.svelar.runtime-certification';
export const defaultClients = resolve(repository, '../svelar-testing-area/apps/svelar-evolution-candidate-ddd-zod/package.json');
export const defaultReportDirectory = resolve(repository, '../svelar-testing-area/artifacts/runtime-certification');
export const nativeGates = Object.freeze([
  { name: 'redis-coordination', files: ['cache-atomic-redis.test.ts', 'rate-limit-redis-processes.test.ts', 'broadcasting-redis-processes.test.ts'] },
  { name: 'queue-lifecycle', files: ['queue-recovery-redis.test.ts'] },
  { name: 'queue-monitoring', files: ['queue-monitoring-redis.test.ts'] },
  { name: 'queue-sql', files: ['queue-monitoring-drivers.test.ts'] },
  { name: 'postgres-schema', files: ['schema-advanced-postgres.test.ts'] },
  { name: 'inbox-operations', files: ['inbox-operation-drivers.test.ts'] },
  { name: 'shared-log-search', files: ['shared-log-search-process.test.ts'] },
  { name: 'deployment-traffic', files: ['deployment-traffic.test.ts'] },
]);

export function parseOptions(args) {
  const options = { clients: defaultClients, reportDir: defaultReportDirectory, timeout: 360, startupTimeout: 120, help: false, list: false };
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--list') options.list = true;
    else if (arg.startsWith('--clients=')) {
      if (!arg.slice(10)) throw new Error('--clients requires an existing isolated app package.json.');
      options.clients = resolve(arg.slice(10));
    } else if (arg.startsWith('--report-dir=')) {
      if (!arg.slice(13)) throw new Error('--report-dir requires a persistent artifacts directory.');
      options.reportDir = resolve(arg.slice(13));
    } else if (arg.startsWith('--timeout=') || arg.startsWith('--startup-timeout=')) {
      const [name, value] = arg.split('=');
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1 || Number(value) > 1800) throw new Error(`${name} must be integer seconds in 1..1800.`);
      options[name === '--timeout' ? 'timeout' : 'startupTimeout'] = Number(value);
    } else throw new Error(`Unknown runtime certification option: ${arg}`);
  }
  return options;
}

const sensitiveKey = /^(password|passwd|pwd|secret|client_secret|clientSecret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|set-cookie)$/i;

export function redactEvidence(text) {
  const keys = '(?:password|passwd|pwd|secret|client_secret|clientSecret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|set-cookie)';
  return String(text)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(new RegExp(`((?:\\\\?["'])?${keys}(?:\\\\?["'])?\\s*[:=]\\s*)(\\\\?["'])([\\s\\S]*?)\\2`, 'gi'), '$1$2[REDACTED]$2')
    .replace(new RegExp(`(\\b${keys}\\s*[:=]\\s*)(?!["'\\\\])[^\\s,;}]+`, 'gi'), '$1[REDACTED]')
    .replace(/\b([a-z][a-z\d+.-]*:\/\/)[^/\s@]+@/gi, '$1[REDACTED]@')
    .replaceAll('queue-proof', '[REDACTED]');
}

export async function writeEvidence(directory, name, value) {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(name)) throw new Error('Invalid evidence filename.');
  const contents = typeof value === 'string' ? redactEvidence(value) : JSON.stringify(value, (key, item) => {
    if (sensitiveKey.test(key)) return '[REDACTED]';
    return typeof item === 'string' ? redactEvidence(item) : item;
  }, 2) + '\n';
  await writeFile(join(directory, name), contents, { mode: 0o600 });
}

function errorEvidence(error) {
  return { message: error?.message ?? String(error), stack: error?.stack, code: error?.code, syscall: error?.syscall,
    ...(error?.cause ? { cause: errorEvidence(error.cause) } : {}),
    ...(error instanceof AggregateError ? { errors: error.errors.map(errorEvidence) } : {}),
    ...(error?.stdout ? { stdout: error.stdout } : {}), ...(error?.stderr ? { stderr: error.stderr } : {}) };
}

export async function runNativeGate(gate, { cwd, env, signal, timeoutMs, temporaryDirectory, reportDirectory, vitest }, execute = runCommand) {
  const report = join(temporaryDirectory, `${gate.name}.json`);
  const args = [vitest, 'run', ...gate.files.map(file => `tests/${file}`), '--no-file-parallelism', '--maxWorkers=1',
    '--reporter=default', '--reporter=json', `--outputFile.json=${report}`];
  let output = {}; let failure; let result;
  try {
    output = await execute(process.execPath, args, { cwd, env, signal, timeoutMs, stream: true });
    result = { gate: gate.name, ...verifyReport(JSON.parse(await readFile(report, 'utf8')), gate.files, cwd) };
  } catch (error) { failure = error; output = error; }
  const evidenceErrors = [];
  try {
    await writeEvidence(reportDirectory, `${gate.name}.log`, `Command: ${process.execPath} ${args.join(' ')}\n\nSTDOUT\n${output.stdout ?? ''}\nSTDERR\n${output.stderr ?? ''}\n${failure ? `FAILURE\n${failure.stack ?? failure.message}\n` : ''}`);
  } catch (error) { evidenceErrors.push(error); }
  try {
    const raw = await readFile(report, 'utf8');
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    await writeEvidence(reportDirectory, `${gate.name}.json`, parsed);
  } catch (error) {
    if (error.code !== 'ENOENT') evidenceErrors.push(error);
    else if (!failure) evidenceErrors.push(new Error('Native gate did not write its JSON report.'));
  }
  if (evidenceErrors.length) throw new AggregateError(failure ? [failure, ...evidenceErrors] : evidenceErrors, 'Native gate evidence could not be preserved.');
  if (failure) throw failure;
  return result;
}

export function nativeEnvironment(base, clients, services) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (/^SVELAR_(TEST_|QUEUE_|SHARED_|RATE_|SSE_|INBOX_|SECURITY_)/.test(key) ||
      /^(DB_|REDIS_|QUEUE_|MEILISEARCH_|DATABASE_URL$)/.test(key)) delete env[key];
  }
  const redis = `redis://127.0.0.1:${services.redis}/0`;
  return { ...env, CI: '1', FORCE_COLOR: '0',
    SVELAR_TEST_QUEUE_CLIENT: clients, SVELAR_TEST_QUEUE_REDIS_URL: redis,
    SVELAR_TEST_QUEUE_PG_PORT: String(services.postgres), SVELAR_TEST_QUEUE_MYSQL_PORT: String(services.mysql),
    SVELAR_TEST_REDIS_CLIENT: clients, SVELAR_TEST_REDIS_URL: redis,
    SVELAR_TEST_SSE_CLIENT: clients, SVELAR_TEST_SSE_REDIS_URL: redis,
    SVELAR_TEST_POSTGRES_CLIENT: clients,
    SVELAR_TEST_SCHEMA_POSTGRES_URL: `postgres://svelar_queue:queue-proof@127.0.0.1:${services.postgres}/schema_proof`,
    SVELAR_TEST_INBOX_OPERATIONS_NATIVE: '1', SVELAR_TEST_INBOX_OPERATION_CLIENT: clients,
    SVELAR_TEST_SHARED_MEILI: '1', SVELAR_TEST_DEPLOY_DOCKER: '1',
  };
}

export function verifyReport(report, files, cwd) {
  if (!report || report.success !== true || !Number.isSafeInteger(report.numTotalTests) || report.numTotalTests < 1 ||
    report.numPassedTests !== report.numTotalTests || report.numFailedTests !== 0 || report.numPendingTests !== 0 ||
    report.numTodoTests !== 0 || report.numFailedTestSuites !== 0 || report.numPendingTestSuites !== 0) {
    throw new Error('Native gate must pass with positive test counts and zero failures, skips, pending or todo tests.');
  }
  if (!Array.isArray(report.testResults)) throw new Error('Native gate has no file results.');
  const expected = files.map(file => resolve(cwd, 'tests', file)).sort();
  const actual = report.testResults.map(file => resolve(file.name)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Native gate file inventory is missing, duplicated or unexpected.');
  const assertions = report.testResults.flatMap(file => {
    if (file.status !== 'passed' || !Array.isArray(file.assertionResults) || !file.assertionResults.length) throw new Error('Native gate contains an empty or failed test file.');
    return file.assertionResults;
  });
  if (assertions.length !== report.numTotalTests || assertions.some(test => test.status !== 'passed')) throw new Error('Native gate contains skipped, cancelled or uncounted assertions.');
  return { files: expected.length, passed: assertions.length, skipped: 0 };
}

export async function runCommand(command, args, { cwd = repository, env = process.env, timeoutMs = 30000,
  graceMs = 3000, signal, stream = false, maxBytes = 16 * 1024 * 1024, detached = process.platform !== 'win32' } = {}) {
  if (signal?.aborted) throw signal.reason ?? new Error('Runtime certification interrupted.');
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached });
    let stdout = ''; let stderr = ''; let bytes = 0; let failure; let forceTimer;
    function kill(kind) {
      try {
        if (detached && process.platform !== 'win32') process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch (error) { if (error.code !== 'ESRCH') failure ??= error; }
    }
    function stop(error) {
      if (failure) return;
      failure = error; kill('SIGTERM'); forceTimer = setTimeout(() => kill('SIGKILL'), graceMs);
    }
    const timer = setTimeout(() => stop(new Error(`Command exceeded ${timeoutMs}ms: ${command}`)), timeoutMs);
    const abort = () => stop(signal.reason ?? new Error('Runtime certification interrupted.'));
    signal?.addEventListener('abort', abort, { once: true });
    function output(data, channel) {
      bytes += data.length;
      if (bytes > maxBytes) { stop(new Error(`Command output exceeded ${maxBytes} bytes.`)); return; }
      if (channel === 'stdout') stdout += data; else stderr += data;
    }
    child.stdout.on('data', data => output(data, 'stdout')); child.stderr.on('data', data => output(data, 'stderr'));
    child.once('error', error => { failure ??= error; });
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort);
      // Buffer before redacting so credentials split across child output chunks cannot leak.
      if (stream) { process.stdout.write(redactEvidence(stdout)); process.stderr.write(redactEvidence(stderr)); }
      if (failure || code !== 0) {
        const error = failure ?? new Error(`Command exited ${code ?? exitSignal}: ${command}`);
        error.stdout = stdout; error.stderr = stderr; error.outputWasStreamed = stream; reject(error);
      } else resolveResult({ stdout, stderr });
    });
  });
}

export async function validateClients(path) {
  if (!path.endsWith('package.json')) throw new Error('--clients must name an existing isolated app package.json.');
  let manifest;
  try { manifest = JSON.parse(await readFile(path, 'utf8')); }
  catch (cause) { throw new Error(`Cannot read isolated client manifest: ${path}`, { cause }); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Client package.json must contain an object.');
  const require = createRequire(path);
  for (const peer of ['postgres', 'mysql2/promise', 'ioredis', 'bullmq', 'drizzle-orm']) {
    try { require.resolve(peer); }
    catch (cause) { throw new Error(`Missing installed client ${peer} beside ${path}; install this isolated app first. The runner never installs or uses a default database.`, { cause }); }
  }
  const postgres = require('postgres'); const mysql = require('mysql2/promise'); const Redis = require('ioredis');
  const bull = require('bullmq'); const bullVersion = require('bullmq/package.json').version;
  const [major, minor, patch] = bullVersion.split('.').map(Number);
  if (typeof postgres !== 'function' || typeof mysql.createConnection !== 'function' || typeof Redis !== 'function' ||
    typeof bull.Queue !== 'function' || major !== 5 || minor < 77 || minor === 77 && patch < 4) throw new Error('Native clients require postgres/mysql2/ioredis and BullMQ >=5.77.4 <6.');
  const rootRequire = createRequire(join(repository, 'package.json'));
  try {
    await vitestExecutable();
    if (typeof rootRequire('meilisearch').Meilisearch !== 'function') throw new Error('Unsupported Meilisearch constructor');
  } catch (cause) { throw new Error('Install repository test dependencies, including native Meilisearch SDK >=0.62, before runtime certification.', { cause }); }
  return { postgres, mysql, Redis, bullVersion };
}

async function vitestExecutable() {
  const file = createRequire(join(repository, 'package.json')).resolve('vitest/package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.vitest;
  if (typeof bin !== 'string') throw new Error('Installed Vitest has no CLI binary manifest entry.');
  const executable = resolve(dirname(file), bin); await access(executable, constants.R_OK); return executable;
}

async function executable(name) {
  for (const part of (process.env.PATH ?? '').split(delimiter)) {
    const path = resolve(part, name);
    try { await access(path, constants.X_OK); return path; } catch {}
  }
  throw new Error(`Required executable is unavailable: ${name}`);
}

export async function labelledDockerArgs(args, config, execute = runCommand) {
  if (!/^[0-9a-f-]{36}$/.test(config.runId)) throw new Error('Invalid runtime resource ownership ID.');
  const label = `${ownerLabel}=${config.runId}`;
  if (['run', 'create', 'build'].includes(args[0])) return [args[0], '--label', label, ...args.slice(1)];
  if (['network', 'volume', 'container', 'image'].includes(args[0]) && ['create', 'run', 'build'].includes(args[1])) return [args[0], args[1], '--label', label, ...args.slice(2)];
  if (args[0] !== 'compose') return args;
  const action = args.findIndex(value => ['up', 'run', 'create'].includes(value));
  if (action === -1) return args;
  const base = args.slice(0, action);
  const normalized = JSON.parse((await execute(config.binary, [...base, 'config', '--format', 'json'], { timeoutMs: 30000, detached: false })).stdout);
  const overlay = { services: Object.fromEntries(Object.keys(normalized.services ?? {}).map(name => [name, { labels: { [ownerLabel]: config.runId } }])) };
  for (const kind of ['networks', 'volumes']) {
    overlay[kind] = Object.fromEntries(Object.entries(normalized[kind] ?? {}).filter(([, value]) => !value.external)
      .map(([name]) => [name, { labels: { [ownerLabel]: config.runId } }]));
  }
  const file = join(config.directory, `${randomUUID()}.compose.json`);
  await writeFile(file, JSON.stringify(overlay), { mode: 0o600 });
  return [...base, '-f', file, ...args.slice(action)];
}

export async function dockerProxyMain(args, config) {
  const labelled = await labelledDockerArgs(args, config);
  const result = await runCommand(config.binary, labelled, { timeoutMs: 180000, stream: true, detached: false });
  return result;
}

export async function cleanupOwned(binary, runId, execute = runCommand) {
  const label = `label=${ownerLabel}=${runId}`;
  const failures = [];
  for (const [list, remove] of [
    [['ps', '--all', '--quiet'], ['rm', '--force', '--volumes']],
    [['network', 'ls', '--quiet'], ['network', 'rm']],
    [['volume', 'ls', '--quiet'], ['volume', 'rm']],
    [['image', 'ls', '--quiet'], ['image', 'rm']],
  ]) {
    try {
      const { stdout } = await execute(binary, [...list, '--filter', label], { timeoutMs: 30000 });
      const resources = [...new Set(stdout.trim().split('\n').filter(Boolean))];
      if (resources.length) await execute(binary, [...remove, ...resources], { timeoutMs: 30000 });
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Runtime certification resource cleanup failed.');
}

async function createProxy(directory, binary, runId) {
  const bin = join(directory, 'bin'); await mkdir(bin);
  const config = { directory, binary, runId };
  await writeFile(join(bin, 'docker'), `#!/usr/bin/env node\n(async () => { const { dockerProxyMain } = await import(${JSON.stringify(import.meta.url)}); await dockerProxyMain(process.argv.slice(2), ${JSON.stringify(config)}); })().catch(error => { console.error(error.message); process.exitCode = 1; });\n`, { mode: 0o755 });
  return { config, path: bin };
}

async function localDocker(binary, signal) {
  const endpoint = process.env.DOCKER_HOST || JSON.parse((await runCommand(binary, ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], { signal })).stdout);
  const url = new URL(endpoint);
  if (url.protocol !== 'unix:' && !(['tcp:', 'http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Runtime proofs require a local Docker daemon with loopback-published ports.');
  await runCommand(binary, ['info', '--format', '{{.ServerVersion}}'], { signal });
}

async function startService(role, image, port, variables, command, state, env, signal) {
  const name = `svelar-runtime-${state.runId}-${role}`;
  const args = ['run', '--detach', '--rm', '--name', name, '--publish', `127.0.0.1::${port}`,
    '--tmpfs', `${role === 'postgres' ? '/var/lib/postgresql/data' : role === 'mysql' ? '/var/lib/mysql' : '/data'}:rw`,
    ...variables.flatMap(value => ['--env', value]), image, ...command];
  const labelled = await labelledDockerArgs(args, state);
  await runCommand(state.binary, labelled, { env, signal, timeoutMs: 180000 });
  const { stdout } = await runCommand(state.binary, ['port', name, `${port}/tcp`], { env, signal });
  const mapping = stdout.trim();
  if (!/^127\.0\.0\.1:\d+$/.test(mapping)) throw new Error(`Unexpected ${role} port binding: ${mapping}`);
  const published = Number(mapping.split(':')[1]);
  if (!Number.isSafeInteger(published) || published <= 1024 || published === port) throw new Error('Runtime fixture ports must be random nondefault loopback ports.');
  console.log(`Started owned ${role} on 127.0.0.1:${published}`);
  return published;
}

async function waitForServices(ports, clients, seconds, signal) {
  const deadline = Date.now() + seconds * 1000;
  for (const role of ['redis', 'postgres', 'mysql']) {
    let last;
    for (;;) {
      signal?.throwIfAborted();
      try {
        if (role === 'redis') {
          const redis = new clients.Redis(`redis://127.0.0.1:${ports.redis}`, { connectTimeout: 1500, commandTimeout: 1500, maxRetriesPerRequest: 0, retryStrategy: () => null });
          redis.on('error', () => {});
          try { if (await redis.ping() !== 'PONG') throw new Error('Redis ping failed'); } finally { redis.disconnect(); }
        } else if (role === 'postgres') {
          const sql = clients.postgres({ host: '127.0.0.1', port: ports.postgres, username: 'svelar_queue', password: 'queue-proof',
            database: 'queue_proof', prepare: false, max: 1, connect_timeout: 2 });
          try { await sql.unsafe('SELECT 1'); await sql.unsafe('CREATE DATABASE schema_proof'); }
          finally { await sql.end({ timeout: 1 }); }
        } else {
          const connection = await clients.mysql.createConnection({ host: '127.0.0.1', port: ports.mysql, user: 'root', password: 'queue-proof', database: 'queue_proof', connectTimeout: 1500 });
          try { await connection.query({ sql: 'SELECT 1', timeout: 1500 }); } finally { connection.destroy(); }
        }
        break;
      } catch (error) {
        last = error;
        if (Date.now() >= deadline) throw new Error(`${role} did not become ready within ${seconds}s.`, { cause: last });
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }
}

export async function certifyRuntime(options, { signal } = {}) {
  const runId = randomUUID();
  const reportDirectory = join(options.reportDir ?? defaultReportDirectory, `${new Date().toISOString().replaceAll(':', '-')}-${runId}`);
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  const manifest = { version: 1, kind: 'native-source-runtime', runId, node: process.version, clients: options.clients,
    startedAt: new Date().toISOString(), status: 'running', cleanup: 'pending', ports: {},
    gates: nativeGates.map(gate => ({ name: gate.name, files: gate.files, status: 'not-run' })) };
  await writeEvidence(reportDirectory, 'manifest.json', manifest);
  console.log(`Runtime evidence: ${reportDirectory}`);
  let binary; let directory; let owned = false; let failure; let summary;
  const events = [`${manifest.startedAt} started ${runId}`];
  try {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || major === 22 && minor < 12 || process.platform === 'win32') throw new Error('Native certification requires Node >=22.12 on a POSIX Docker host.');
    const clients = await validateClients(options.clients);
    binary = await executable('docker'); await localDocker(binary, signal);
    directory = await mkdtemp(join(tmpdir(), 'svelar-runtime-certification-')); owned = true;
    const state = { directory, binary, runId };
    const proxy = await createProxy(directory, binary, runId);
    const environment = { ...process.env, PATH: [proxy.path, dirname(process.execPath), process.env.PATH ?? ''].join(delimiter) };
    const ports = {};
    ports.redis = await startService('redis', 'redis:7-alpine', 6379, [], ['redis-server', '--save', '', '--appendonly', 'no'], state, environment, signal);
    ports.postgres = await startService('postgres', 'postgres:17-alpine', 5432,
      ['POSTGRES_USER=svelar_queue', 'POSTGRES_PASSWORD=queue-proof', 'POSTGRES_DB=queue_proof'], [], state, environment, signal);
    ports.mysql = await startService('mysql', 'mysql:8.0', 3306,
      ['MYSQL_ROOT_PASSWORD=queue-proof', 'MYSQL_ROOT_HOST=%', 'MYSQL_DATABASE=queue_proof'], [], state, environment, signal);
    manifest.ports = ports;
    await writeEvidence(reportDirectory, 'manifest.json', manifest);
    await waitForServices(ports, clients, options.startupTimeout, signal);
    const env = nativeEnvironment(environment, options.clients, ports);
    const cwd = join(repository, 'packages/svelar');
    const vitest = await vitestExecutable();
    const results = [];
    for (const [index, gate] of nativeGates.entries()) {
      signal?.throwIfAborted();
      console.log(`\nNative source gate: ${gate.name}`);
      manifest.gates[index].status = 'running';
      events.push(`${new Date().toISOString()} gate ${gate.name} started`);
      await writeEvidence(reportDirectory, 'manifest.json', manifest);
      try {
        const result = await runNativeGate(gate, { cwd, env, signal, timeoutMs: options.timeout * 1000,
          temporaryDirectory: directory, reportDirectory, vitest });
        results.push(result);
        Object.assign(manifest.gates[index], result, { status: 'passed' });
        events.push(`${new Date().toISOString()} gate ${gate.name} passed ${result.passed}`);
      } catch (error) {
        manifest.gates[index].status = 'failed';
        events.push(`${new Date().toISOString()} gate ${gate.name} failed`);
        throw error;
      }
      await writeEvidence(reportDirectory, 'manifest.json', manifest);
    }
    summary = { kind: 'native-source-runtime', clients: options.clients, passed: results.reduce((total, gate) => total + gate.passed, 0),
      skipped: 0, gates: results, reportDirectory };
  } catch (error) { failure = error; }
  finally {
    const errors = [];
    if (owned) {
      try { await cleanupOwned(binary, runId); } catch (error) { errors.push(error); }
    }
    if (directory) {
      try { await rm(directory, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    }
    manifest.cleanup = errors.length ? 'failed' : owned ? 'succeeded' : 'not-needed';
    if (errors.length) failure = new AggregateError(failure ? [failure, ...errors] : errors, 'Runtime certification failed to clean up its owned resources.');
    manifest.status = failure ? 'failed' : 'passed';
    manifest.finishedAt = new Date().toISOString();
    events.push(`${manifest.finishedAt} ${manifest.status}; cleanup ${manifest.cleanup}`);
    try {
      await writeEvidence(reportDirectory, failure ? 'failure.json' : 'summary.json', failure ? errorEvidence(failure) : summary);
      await writeEvidence(reportDirectory, 'runner.log', events.join('\n') + '\n');
      await writeEvidence(reportDirectory, 'manifest.json', manifest);
    } catch (error) {
      failure = new AggregateError(failure ? [failure, error] : [error], 'Runtime evidence could not be finalized.');
    }
  }
  if (failure) { failure.reportDirectory = reportDirectory; throw failure; }
  return summary;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/runtime-certification.mjs [--clients=/isolated/app/package.json] [--report-dir=/sibling/artifacts] [--timeout=360] [--startup-timeout=120] [--list]\nRuns all native source gates with existing installed clients, owned Docker services and zero-skip JSON checks. Never installs dependencies or builds/packs core; fixtures may bundle source and build disposable Docker images. Reports survive resource cleanup.\nDefault clients: ${defaultClients}\nDefault reports: ${defaultReportDirectory}`);
    return;
  }
  if (options.list) { for (const gate of nativeGates) console.log(`${gate.name}: ${gate.files.join(', ')}`); return; }
  const controller = new AbortController();
  const interrupted = signal => controller.abort(new Error(`Runtime certification interrupted by ${signal}.`));
  const stop = () => interrupted('SIGTERM'); const interrupt = () => interrupted('SIGINT');
  process.once('SIGTERM', stop); process.once('SIGINT', interrupt);
  try {
    const summary = await certifyRuntime(options, { signal: controller.signal });
    console.log(`\nNative source runtime certification passed: ${summary.passed} tests, zero skips. Packed artifact/browser gates remain separate.`);
    console.log(JSON.stringify(summary));
  }
  finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', interrupt); }
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  main().catch(error => {
    console.error(redactEvidence(error.message));
    if (error.reportDirectory) console.error(`Preserved runtime evidence: ${error.reportDirectory}`);
    if (!error.outputWasStreamed) {
      if (error.stdout) process.stderr.write(redactEvidence(error.stdout));
      if (error.stderr) process.stderr.write(redactEvidence(error.stderr));
    }
    if (error instanceof AggregateError) for (const cause of error.errors) console.error(redactEvidence(cause?.message ?? String(cause)));
    process.exitCode = 1;
  });
}
