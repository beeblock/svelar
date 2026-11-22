#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, getPriority, homedir, platform, release, setPriority } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const sampleCount = 5;
const cases = ['hydrate-scalars23', 'hydrate-mutable23', 'query-new-builder', 'query-reused-builder', 'query-ten-scopes'];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function options(args) {
  const result = { iterations: 20000, warmup: 5000, timeoutMs: 30000, verifyOnly: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') return { help: true };
    if (argument === '--verify-only') { result.verifyOnly = true; continue; }
    const match = /^--(baseline|candidate|output|iterations|warmup|timeout-ms)(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`Unknown option: ${argument}`);
    const value = match[2] ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${match[1]}.`);
    result[match[1] === 'timeout-ms' ? 'timeoutMs' : match[1]] = value;
  }
  for (const [key, maximum] of [['iterations', 1000000], ['warmup', 1000000], ['timeoutMs', 30000]]) {
    if (!/^\d+$/.test(String(result[key]))) throw new Error(`${key} must be an integer.`);
    result[key] = Number(result[key]);
    if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > maximum) throw new Error(`${key} must be 1..${maximum}.`);
  }
  for (const key of ['baseline', 'candidate', 'output']) {
    if (!result[key]) throw new Error(`--${key} is required. Use --help for usage.`);
    result[key] = resolve(result[key]);
  }
  return result;
}

function exportedFile(manifest, name) {
  const select = (entry) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') for (const condition of ['node', 'import', 'default']) {
      const value = select(entry[condition]);
      if (value) return value;
    }
  };
  const entry = select(manifest.exports?.[name]);
  if (!entry?.startsWith('./')) throw new Error(`Missing public ESM export ${name}.`);
  return entry;
}

function codeFingerprint(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Installed dist must not contain symlinks: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push([relative(root, path), sha256(readFileSync(path))]);
    }
  };
  visit(join(root, 'dist'));
  return { files: files.length, sha256: sha256(JSON.stringify(files)) };
}

function lockProvenance(inputManifest, coreRoot) {
  let directory = dirname(inputManifest);
  while (!existsSync(join(directory, 'package-lock.json'))) {
    if (dirname(directory) === directory) return null;
    directory = dirname(directory);
  }
  const path = join(directory, 'package-lock.json');
  const bytes = readFileSync(path);
  const lock = JSON.parse(bytes);
  const key = relative(directory, coreRoot).split(sep).join('/');
  const entry = lock.packages?.[key];
  const provenance = { path, sha256: sha256(bytes), packageKey: key, resolved: entry?.resolved ?? null,
    integrity: entry?.integrity ?? null, tarball: null };
  let archive;
  if (entry?.resolved?.startsWith('file:')) {
    archive = fileURLToPath(new URL(entry.resolved, pathToFileURL(path)));
  } else if (entry?.integrity) {
    const integrity = entry.integrity.split(/\s+/).find((value) => value.startsWith('sha512-'));
    if (integrity) {
      const hex = Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex');
      archive = join(process.env.npm_config_cache ?? join(homedir(), '.npm'), '_cacache', 'content-v2', 'sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
    }
  }
  if (archive && existsSync(archive)) {
    const content = readFileSync(archive);
    if (entry.integrity && !entry.integrity.split(/\s+/).some((sri) => {
      const [algorithm, digest] = sri.split('-', 2);
      return ['sha256', 'sha384', 'sha512'].includes(algorithm) && createHash(algorithm).update(content).digest('base64') === digest;
    })) throw new Error(`Tarball does not match lock integrity: ${archive}`);
    provenance.tarball = { path: realpathSync(archive), sha256: sha256(content), integrityVerified: !!entry.integrity };
  } else provenance.tarball = { path: null, sha256: null, reason: 'No local tarball/cache content; lock integrity retained without downloading.' };
  return provenance;
}

function installation(path) {
  const input = readJson(path);
  const manifestPath = realpathSync(input.name === '@beeblock/svelar' ? path : createRequire(path).resolve('@beeblock/svelar/package.json'));
  const manifest = readJson(manifestPath);
  assert.equal(manifest.name, '@beeblock/svelar');
  const root = dirname(manifestPath);
  if (!root.split(sep).includes('node_modules')) throw new Error('Use a physical installed package, not a workspace/source symlink.');
  const entries = Object.fromEntries(['./orm', './database'].map((name) => [name, resolve(root, exportedFile(manifest, name))]));
  for (const entry of Object.values(entries)) assert.ok(existsSync(entry), `Missing installed entry: ${entry}`);
  const require = createRequire(manifestPath);
  const dependencies = {};
  for (const name of ['better-sqlite3', 'drizzle-orm', '@sveltejs/kit', 'svelte']) {
    try {
      let dependencyPath;
      try { dependencyPath = require.resolve(`${name}/package.json`); }
      catch {
        let directory = dirname(realpathSync(require.resolve(name)));
        while (true) {
          const candidate = join(directory, 'package.json');
          if (existsSync(candidate) && readJson(candidate).name === name) { dependencyPath = candidate; break; }
          if (dirname(directory) === directory) throw new Error(`Cannot locate installed manifest for ${name}.`);
          directory = dirname(directory);
        }
      }
      dependencies[name] = { version: readJson(dependencyPath).version, manifest: realpathSync(dependencyPath) };
    } catch (error) { dependencies[name] = { unavailable: error.code ?? error.message }; }
  }
  return { inputManifest: path, inputSha256: sha256(readFileSync(path)), manifest: manifestPath,
    manifestSha256: sha256(readFileSync(manifestPath)), name: manifest.name, version: manifest.version, root, entries,
    code: codeFingerprint(root), lock: lockProvenance(path, root), dependencies };
}

function scalarRow() {
  return { id: 7, tenant_id: 3, account_id: 11, name: 'Benchmark record', email: 'benchmark@example.test', status: 'active', enabled: 1,
    category: 'fixture', title: 'A benchmark', description: 'A scalar database row with twenty-three columns.', locale: 'en', timezone: 'UTC',
    score: 12.5, count: 42, balance: '123.45', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z', archived_at: null,
    profile: '{"value":1}', tags: '["first"]', observed_at: '2026-01-03T00:00:00.000Z', binary_value: 'fixture', marker: 0 };
}

function mutableRow() {
  return { ...scalarRow(), profile: { nested: { value: 1 } }, tags: ['first'], observed_at: new Date('2026-01-03T00:00:00.000Z'), binary_value: Buffer.from('fixture') };
}

function checkMutableIsolation(Model) {
  const row = mutableRow();
  const originalTime = row.observed_at.getTime();
  const model = Model.hydrate(row);
  row.profile.nested.value = 99; row.tags.push('input'); row.observed_at.setUTCFullYear(2000); row.binary_value[0] = 0;
  assert.equal(model.getAttribute('profile').nested.value, 1);
  assert.deepEqual(model.getAttribute('tags'), ['first']);
  assert.equal(model.getAttribute('observed_at').getTime(), originalTime);
  assert.equal(model.getAttribute('binary_value').toString(), 'fixture');
  model.getAttribute('profile').nested.value = 2; model.getAttribute('tags').push('model');
  model.getAttribute('observed_at').setUTCFullYear(2001); model.getAttribute('binary_value')[0] = 1;
  assert.equal(model.getOriginal('profile').nested.value, 1);
  assert.deepEqual(model.getOriginal('tags'), ['first']);
  assert.equal(model.getOriginal('observed_at').getTime(), originalTime);
  assert.equal(model.getOriginal('binary_value').toString(), 'fixture');
  const copiedOriginal = model.getOriginal(); copiedOriginal.profile.nested.value = 3;
  const copiedAttributes = model.getAttributes(); copiedAttributes.profile.nested.value = 4;
  assert.equal(model.getOriginal('profile').nested.value, 1);
  assert.equal(model.getAttribute('profile').nested.value, 2);
  assert.ok(model.isDirty('profile'));
  return { inputIsolated: true, originalsIsolated: true, returnedSnapshotsIsolated: true, dirtyTracking: true, kinds: ['object', 'array', 'Date', 'Buffer'] };
}

function operationFor(id, Model, QueryBuilder) {
  class BenchmarkRecord extends Model { static table = 'benchmark_records'; }
  let last;
  if (id.startsWith('hydrate-')) {
    const row = id === 'hydrate-scalars23' ? scalarRow() : mutableRow();
    assert.equal(Object.keys(row).length, 23);
    return { operation: () => { last = BenchmarkRecord.hydrate(row); },
      inspect: () => { assert.deepEqual(last.getAttributes(), row); return { columns: 23, rowSha256: sha256(JSON.stringify(last.getAttributes())) }; } };
  }
  const query = () => new QueryBuilder('benchmark_records').select('id', 'name', 'status')
    .where('tenant_id', 3).where('status', 'active').whereIn('id', [1, 2, 3]).orderBy('id', 'desc').limit(20).offset(10);
  let compile;
  if (id === 'query-new-builder') compile = () => query().toSQL();
  else if (id === 'query-reused-builder') {
    const reused = query(); compile = () => reused.toSQL();
  } else if (id === 'query-ten-scopes') {
    for (let index = 0; index < 10; index++) BenchmarkRecord.addGlobalScope(`scope_${index}`, (builder) => builder.where(`scope_${index}`, index));
    compile = () => BenchmarkRecord.query().select('id').where('id', '>', 1).orderBy('id').limit(20).toSQL();
  } else throw new Error(`Unknown benchmark case: ${id}`);
  return { operation: () => { last = compile(); }, inspect: () => {
    assert.equal(typeof last.sql, 'string');
    assert.deepEqual(last.bindings, id === 'query-ten-scopes' ? [...Array.from({ length: 10 }, (_, index) => index), 1] : [3, 'active', 1, 2, 3]);
    return { sql: last.sql, bindings: last.bindings, sha256: sha256(JSON.stringify(last)) };
  } };
}

async function worker() {
  const config = JSON.parse(readFileSync(0, 'utf8'));
  if (getPriority() < 10) setPriority(0, 10);
  const manifest = readJson(config.installation.manifest);
  assert.equal(sha256(readFileSync(config.installation.manifest)), config.installation.manifestSha256, 'Installed manifest changed.');
  const { Model, QueryBuilder } = await import(pathToFileURL(resolve(config.installation.root, exportedFile(manifest, './orm'))).href);
  const { Connection } = await import(pathToFileURL(resolve(config.installation.root, exportedFile(manifest, './database'))).href);
  Connection.configure({ default: 'benchmark', connections: { benchmark: { driver: 'sqlite', filename: ':memory:' } } });
  try {
    const sqlite = await Connection.raw('SELECT sqlite_version() AS version');
    class IsolationRecord extends Model { static table = 'benchmark_records'; }
    const isolation = checkMutableIsolation(IsolationRecord);
    const { operation, inspect } = operationFor(config.case, Model, QueryBuilder);
    operation(); const expected = inspect();
    const result = { status: 'verified', case: config.case, sample: config.sample, pid: process.pid, nice: getPriority(),
      node: process.version, sqliteVersion: sqlite[0].version, correctness: { mutableIsolation: isolation, output: expected } };
    if (!config.verifyOnly) {
      for (let index = 0; index < config.warmup; index++) operation();
      const cpuStart = process.cpuUsage(); const wallStart = process.hrtime.bigint();
      for (let index = 0; index < config.iterations; index++) operation();
      const wallNs = Number(process.hrtime.bigint() - wallStart); const cpu = process.cpuUsage(cpuStart);
      assert.deepEqual(inspect(), expected, 'Operation output changed during sampling.');
      result.status = 'measured';
      result.measurement = { iterations: config.iterations, warmup: config.warmup, userCpuUs: cpu.user, systemCpuUs: cpu.system,
        totalCpuUs: cpu.user + cpu.system, wallNs, cpuUsPerOperation: (cpu.user + cpu.system) / config.iterations,
        wallUsPerOperation: wallNs / 1000 / config.iterations };
    }
    return result;
  } finally { await Connection.disconnect(); }
}

function statistics(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const median = ordered[Math.floor(ordered.length / 2)];
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  return { median, min: ordered[0], max: ordered.at(-1), medianAbsoluteDeviation: deviations[Math.floor(deviations.length / 2)] };
}

async function main() {
  const config = options(process.argv.slice(2));
  if (config.help) {
    console.log(`Compare two physical installed Svelar packages, without app bootstrap or external services.

Usage: node scripts/benchmark-superapp-performance.mjs --baseline APP/package.json --candidate APP/package.json --output ARTIFACT.json

Also accepts installed @beeblock/svelar/package.json paths.
Options: --iterations=20000 --warmup=5000 --timeout-ms=30000 --verify-only
Five samples per case/version, each in a fresh nice-10 child; cases run serially.
Output must be a new file. Higher candidate/baseline CPU ratios mean more CPU.
No performance thresholds, automatic retries, installs, builds or production database access.`);
    return;
  }
  if (platform() === 'win32') throw new Error('This benchmark requires POSIX nice.');
  const installs = { baseline: installation(config.baseline), candidate: installation(config.candidate) };
  assert.notEqual(installs.baseline.root, installs.candidate.root, 'Baseline and candidate must be independent installations.');
  const report = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(), command: process.argv,
    benchmark: { script, sha256: sha256(readFileSync(script)) },
    environment: { node: process.version, v8: process.versions.v8, platform: platform(), release: release(), arch: arch(),
      cpuModel: cpus()[0]?.model, logicalCpus: cpus().length }, installations: installs,
    methodology: { samples: config.verifyOnly ? 1 : sampleCount, iterations: config.iterations, warmup: config.warmup,
      childTimeoutMs: config.timeoutMs, serial: true, nice: 10, freshChildPerSampleAndCase: true,
      alternatingPairOrder: true, driver: 'sqlite', filename: ':memory:', applicationBootstrap: false, externalServices: false,
      setupImportsAndCorrectnessOutsideTiming: true, forcedGc: false, automaticRetries: 0, performanceThresholds: false,
      scopeCount: 10, reusedBuilder: 'same builder after warmup', newBuilder: 'construct and first toSQL on every iteration',
      limits: ['CPU microbenchmarks, not request latency or database throughput.', 'No optional raw/lean mock-read case.',
        'No CPU affinity or ambient-load control; inspect all five samples and spread.', 'SQLite/native peer versions are reported and may differ between installations.'] },
    results: [], comparisons: [] };
  mkdirSync(dirname(config.output), { recursive: true });
  writeFileSync(config.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const persist = () => writeFileSync(config.output, JSON.stringify(report, null, 2) + '\n');
  try {
    for (const id of cases) {
      for (let sample = 0; sample < (config.verifyOnly ? 1 : sampleCount); sample++) {
        for (const label of sample % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
          const child = spawnSync('nice', ['-n', '10', process.execPath, script, '--worker'], {
            cwd: dirname(installs[label].inputManifest), input: JSON.stringify({ ...config, installation: installs[label], case: id, sample }),
            encoding: 'utf8', timeout: config.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
            env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '', NODE_PATH: '' },
          });
          let result;
          try { result = JSON.parse(child.stdout); }
          catch { result = { status: 'error', error: 'Child emitted no valid structured JSON.', stdout: child.stdout }; }
          report.results.push({ installation: label, ...result, childExitCode: child.status, signal: child.signal,
            spawnError: child.error?.message, stderr: child.stderr });
          persist();
          if (child.error || child.status !== 0 || !['verified', 'measured'].includes(result.status)) throw new Error(`${label} ${id} sample ${sample + 1} failed; see artifact.`);
        }
      }
      const selected = (label) => report.results.filter((result) => result.case === id && result.installation === label);
      const first = selected('baseline')[0].correctness.output;
      for (const result of [...selected('baseline'), ...selected('candidate')]) assert.deepEqual(result.correctness.output, first, `${id}: baseline/candidate output mismatch.`);
      if (!config.verifyOnly) {
        const summary = (label) => ({ cpuUsPerOperation: statistics(selected(label).map((result) => result.measurement.cpuUsPerOperation)),
          wallUsPerOperation: statistics(selected(label).map((result) => result.measurement.wallUsPerOperation)) });
        const baseline = summary('baseline'); const candidate = summary('candidate');
        const cpuRatio = candidate.cpuUsPerOperation.median / baseline.cpuUsPerOperation.median;
        const wallRatio = candidate.wallUsPerOperation.median / baseline.wallUsPerOperation.median;
        report.comparisons.push({ case: id, baseline, candidate, candidateToBaselineCpuRatio: cpuRatio,
          candidateToBaselineWallRatio: wallRatio, cpuMedianChangePercent: (cpuRatio - 1) * 100, wallMedianChangePercent: (wallRatio - 1) * 100 });
      }
      persist();
      console.error(JSON.stringify({ event: 'case-complete', case: id, status: config.verifyOnly ? 'verified' : 'measured' }));
    }
    for (const label of ['baseline', 'candidate']) {
      assert.deepEqual(installation(installs[label].inputManifest), installs[label], `${label} installation changed during benchmark.`);
    }
    assert.equal(sha256(readFileSync(script)), report.benchmark.sha256, 'Benchmark script changed during the run.');
    report.status = config.verifyOnly ? 'verified' : 'complete';
  } catch (error) {
    report.status = 'failed'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1;
  } finally { report.finishedAt = new Date().toISOString(); persist(); }
  console.log(JSON.stringify({ status: report.status, artifact: config.output, children: report.results.length, comparisons: report.comparisons }, null, 2));
}

try {
  if (process.argv[2] === '--worker') {
    try { console.log(JSON.stringify(await worker())); }
    catch (error) { console.log(JSON.stringify({ status: 'error', error: { message: error.message, stack: error.stack } })); process.exitCode = 1; }
  } else await main();
} catch (error) {
  console.error(JSON.stringify({ status: 'error', error: { message: error.message, stack: error.stack } }));
  process.exitCode = 1;
}
