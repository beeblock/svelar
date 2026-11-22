#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv, stripVTControlCharacters } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const baselineVersion = '0.8.0';
export const baselineIntegrity = 'sha512-4Ya7/LTqYXWWHSnmFDDV11rllXW1kzp57u+SRTgjpsxdfIZC6B47QXE/ZvIJzd+5pbLvtJFf4O/3H0QjMaK76Q==';
export const ownedPrefix = 'svelar-kit3-upgrade-';
const markerName = 'upgrade-certification.json';
const kind = 'svelar-installed-kit3-upgrade';
const phases = ['scaffold', 'baseline', 'core-kit2', 'migration', 'manual-review', 'kit3'];
const ignored = new Set(['node_modules', '.git', '.svelte-kit', 'build', 'dist', 'coverage', '.vite', 'test-results', 'playwright-report', '.DS_Store']);
const timelinePath = 'docs/SVELAR-KIT3-UPGRADE-TIMELINE.md';
const tools = ['@sveltejs/kit', '@sveltejs/adapter-node', 'sveltekit-superforms', 'svelte', 'vite',
  '@sveltejs/vite-plugin-svelte', 'typescript', 'vitest', 'formsnap'];
export const historicalUiDependencies = { shiki: '^3.20.0', '@shadcn-svelte/primitives': '^0.0.1' };
const runtimeTables = new Set(['sessions', 'scheduler_runtime', 'svelar_logs', 'audit_logs', 'svelar_search_outbox',
  'background_operations', 'svelar_jobs', 'svelar_failed_jobs', 'svelar_queue_events', 'scheduled_task_runs', 'scheduler_locks']);

export function hashBytes(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

export function parseOptions(argv, cwd = process.cwd()) {
  const values = new Map();
  const flags = new Set();
  const options = new Set(['tarball', 'expected-sha256', 'testing-root', 'validation', 'resume', 'stop-after', 'timeout-ms']);
  for (let index = 0; index < argv.length; index++) {
    const match = /^--([a-z][a-z\d-]*)(?:=(.*))?$/.exec(argv[index]);
    if (!match) throw new Error(`Unknown argument: ${argv[index]}`);
    const [, key, inline] = match;
    if (['help', 'approve-reviewed-fixture-patches', 'approve-historical-ui-dependencies', 'approve-fresh-kit3-install'].includes(key)) {
      if (inline !== undefined || flags.has(key)) throw new Error(`Invalid/duplicate --${key}`);
      flags.add(key); continue;
    }
    if (!options.has(key) || values.has(key)) throw new Error(`Unknown/duplicate --${key}`);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    values.set(key, value);
  }
  if (flags.has('help')) return { help: true };
  if (!values.has('tarball') || !/^[a-f\d]{64}$/i.test(values.get('expected-sha256') ?? '')) {
    throw new Error('Require --tarball <existing local archive> and --expected-sha256 <64 hex characters>.');
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(values.get('tarball'))) throw new Error('Require a local archive path, not a URL.');
  const tarball = resolve(cwd, values.get('tarball'));
  if (!tarball.endsWith('.tgz') || /[\x00-\x1f]/.test(tarball)) throw new Error('Require a local .tgz artifact path.');
  const testingRoot = resolve(cwd, values.get('testing-root') ?? join(repository, '../svelar-testing-area'));
  const validation = values.get('validation') ?? 'all';
  if (!['all', 'zod', 'valibot'].includes(validation)) throw new Error('Use --validation all|zod|valibot.');
  const timeoutMs = Number(values.get('timeout-ms') ?? 900000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 3600000) throw new Error('Invalid command timeout (10000..3600000 ms).');
  const stopAfter = values.get('stop-after');
  if (stopAfter && !phases.includes(stopAfter)) throw new Error('Invalid --stop-after phase.');
  const resume = values.has('resume') ? resolve(cwd, values.get('resume')) : undefined;
  if (resume && (dirname(resume) !== testingRoot || !new RegExp('^' + ownedPrefix + '[A-Za-z0-9-]+$').test(resume.split(sep).at(-1)))) {
    throw new Error('Resume must be a direct owned-prefix child of --testing-root.');
  }
  return { tarball, expectedSha256: values.get('expected-sha256').toLowerCase(), testingRoot,
    providers: validation === 'all' ? ['zod', 'valibot'] : [validation], resume, stopAfter, timeoutMs,
    approveReviewedFixturePatches: flags.has('approve-reviewed-fixture-patches'),
    approveHistoricalUiDependencies: flags.has('approve-historical-ui-dependencies'),
    approveFreshKit3Install: flags.has('approve-fresh-kit3-install') };
}

function physicalFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`Expected an unlinked physical file: ${path}`);
  return stat;
}

function contained(root, path) {
  const absolute = resolve(root, path);
  if (!path || absolute === root || !absolute.startsWith(root + sep) || relative(root, absolute) !== path || path.includes('\\')) {
    throw new Error(`Path escapes owned fixture: ${path}`);
  }
  let current = absolute;
  while (current !== root) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error(`Linked fixture path: ${path}`);
    current = dirname(current);
  }
  return absolute;
}

export function snapshotTree(root, { protectedOnly = false, artifact = false } = {}) {
  const files = new Map();
  function walk(path) {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name) && !(artifact && ['dist', 'build'].includes(entry.name))) continue;
      const child = path ? path + '/' + entry.name : entry.name;
      if (!artifact && child === timelinePath) continue;
      const absolute = contained(root, child);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) {
        if (protectedOnly && !(child.startsWith('src/') || child === '.env' || child === 'svelar.validation.json')) continue;
        const stat = physicalFile(absolute);
        files.set(child, { bytes: readFileSync(absolute), mode: stat.mode & 0o777 });
      } else throw new Error(`Fixture inventory includes a linked/special path: ${child}`);
    }
  }
  walk(''); return files;
}

const summaries = (files) => Object.fromEntries([...files].map(([path, file]) => [path, { sha256: hashBytes(file.bytes), mode: file.mode }]));

export function assertTreeEqual(expected, actual, label = 'App source') {
  assert.deepEqual(summaries(actual), summaries(expected), `${label}: unexpected addition/removal/byte or mode change`);
}

export function assertCoreOnlyManifest(before, after) {
  const a = structuredClone(before); const b = structuredClone(after);
  const target = b.dependencies?.['@beeblock/svelar'];
  assert.equal(typeof target, 'string'); assert(target.startsWith('file:'), 'Core must point to the selected local tarball');
  assert.equal(a.dependencies?.['@beeblock/svelar'], baselineVersion);
  delete a.dependencies['@beeblock/svelar']; delete b.dependencies['@beeblock/svelar'];
  assert.deepEqual(b, a, 'Core-only installation changed another manifest dependency/script/configuration');
}

export function restoreHistoricalUiManifest(appDir, original, approved) {
  if (!approved) throw new Error('Historical UI dependency restoration needs explicit --approve-historical-ui-dependencies.');
  const path = contained(appDir, 'package.json'); physicalFile(path);
  const generated = readFileSync(path); const before = JSON.parse(original); const after = JSON.parse(generated);
  const changes = [];
  for (const section of ['dependencies', 'devDependencies']) for (const name of new Set([...Object.keys(before[section] ?? {}), ...Object.keys(after[section] ?? {})])) {
    if (before[section]?.[name] !== after[section]?.[name]) changes.push({ section, name, published: before[section]?.[name] ?? null, generated: after[section]?.[name] ?? null });
  }
  writeFileSync(path, original);
  assert(readFileSync(path).equals(original), 'Historical dependency fixture must restore the exact original manifest bytes');
  return { automaticCodemod: false, publishedUiInstallerCertified: false,
    reason: 'Reviewed historical-app reconstruction: current external shadcn registry selects Superforms 3, incompatible with published core 0.8.0. Generate components without installing and restore the original Kit 2 dependency intent before a normal install.',
    originalSha256: hashBytes(original), generatedSha256: hashBytes(generated), restoredSha256: hashBytes(readFileSync(path)), generatorDependencyChanges: changes };
}

export function addHistoricalUiDependencies(appDir, original, approved) {
  if (!approved) throw new Error('Historical UI additions require explicit fixture approval.');
  const path = contained(appDir, 'package.json'); physicalFile(path);
  assert(readFileSync(path).equals(original), 'Restore exact original manifest before the two reviewed additions');
  const before = JSON.parse(original); const after = structuredClone(before); after.devDependencies ??= {};
  for (const [name, version] of Object.entries(historicalUiDependencies)) {
    assert(!Object.hasOwn(before.dependencies ?? {}, name) && !Object.hasOwn(before.devDependencies ?? {}, name), 'Never replace a preexisting historical UI dependency');
    after.devDependencies[name] = version;
  }
  const unchanged = structuredClone(after);
  for (const name of Object.keys(historicalUiDependencies)) delete unchanged.devDependencies[name];
  if (!Object.hasOwn(before, 'devDependencies')) delete unchanged.devDependencies;
  assert.deepEqual(unchanged, before, 'Historical UI fixture changed more than the two reviewed additions');
  writeJson(path, after);
  return { automaticCodemod: false, additions: historicalUiDependencies, beforeSha256: hashBytes(original),
    afterSha256: hashBytes(readFileSync(path)), originalDependencyRangesUnchanged: true, publishedUiInstallerCertified: false };
}

export function assertKitGraph(graph, major) {
  const expected = major === 2 ? { '@sveltejs/kit': 2, '@sveltejs/adapter-node': 5, 'sveltekit-superforms': 2 }
    : { '@sveltejs/kit': 3, '@sveltejs/adapter-node': 6, 'sveltekit-superforms': 3 };
  for (const [name, version] of Object.entries(expected)) {
    assert.equal(Number(graph[name]?.split('.')[0]), version, `Unexpected installed ${name} graph`);
  }
}

export function validateArchiveEntries(names, details) {
  const seen = new Set(); const entries = names.trimEnd().split('\n');
  for (const entry of entries) {
    const path = entry.replace(/\/$/, '');
    assert(path === 'package' || path.startsWith('package/'), 'Archive must contain only package/');
    assert(!/[\\\x00-\x1f\x7f]/.test(path), 'Invalid archive entry');
    assert(!path.split('/').some((part) => !part || part === '.' || part === '..'), 'Archive traversal');
    assert(!seen.has(path), 'Duplicate archive entry'); seen.add(path);
  }
  const kinds = details.trimEnd().split('\n');
  assert.equal(kinds.length, entries.length);
  assert(kinds.every((entry) => ['-', 'd'].includes(entry[0])), 'Archive links/special files are forbidden');
  assert(seen.has('package/package.json'), 'Missing artifact manifest');
  assert(![...seen].some((entry) => entry.startsWith('package/node_modules')), 'Packaged node_modules is forbidden');
}

// These are reviewed fixture changes, not codemod rules. SHA guards bind them to the real npm 0.8.0 output.
export const reviewedFixturePatches = [
  { path: 'src/routes/dashboard/+layout.svelte', beforeSha256: '103af50bb76629b51194659368027b0c6a4f62491ceb8aceb22758b87c57e9a9',
    reason: 'Manual review: this Svelte-5 template reads the page value only in markup; use Kit 3 state.',
    replacements: [["import { page } from '$app/stores';", "import { page } from '$app/state';"], ['$page.url.pathname', 'page.url.pathname']] },
  { path: 'src/routes/admin/dashboard/+page.svelte', beforeSha256: '22311b9a7142a472571529ce56956cf092bf71c37924737c60ab8eafd3057267',
    reason: 'Manual review: retain focus/scroll with reset:false and create mutable URL copies from the read-only page URL href.',
    replacements: [['{keepFocus: true, noScroll: true}', '{reset: false}'], ['new URL(page.url)', 'new URL(page.url.href)', 3]] },
  { path: 'src/lib/shared/components/patterns/UrlTabs.svelte', beforeSha256: '83683bfe114d51c4d00417473feb1e71bd8ed717c48a4ac870e0fe5526a12603',
    reason: 'Manual review: retain focus/scroll while changing the tab URL; no navigation authorization is removed.',
    replacements: [['{ noScroll: true, keepFocus: true }', '{ reset: false }']] },
  { path: 'vitest.config.ts', beforeSha256: 'e7ea031d06212c5979fc7af4200ca6ea1dc120d52febd6fe19a81053108200c5',
    reason: 'Manual review: use the real Kit plugin and Superforms 3 server transform; never fake $app/server.',
    replacements: [["import { defineConfig } from 'vitest/config';", "import { defineConfig } from 'vitest/config';\nimport { sveltekit } from '@sveltejs/kit/vite';\nimport { vitePreprocess } from '@sveltejs/vite-plugin-svelte';"],
      ['export default defineConfig({', "export default defineConfig({\n  plugins: [sveltekit({ preprocess: vitePreprocess(), alias: { '$lib': 'src/lib', '$lib/*': 'src/lib/*' } })],"],
      ['  test: {', "  test: {\n    server: { deps: { inline: ['sveltekit-superforms'] } },"]] },
  { path: 'src/lib/shared/components/patterns/helpers.ts', beforeSha256: '3edb2cee9349ee818dec2cb9191cf1eaf925e070c30beea92a7f517ebaff86fd',
    reason: 'Manual review: accept structural read-only URL inputs and keep returning independent mutable URL copies, without casts or changed query behavior.',
    replacements: [["import type { ManifestCapability, CapabilityScope, TableQuery, UrlTab } from '$lib/shared/components/patterns/contracts.js';",
      "import type { ManifestCapability, CapabilityScope, TableQuery, UrlTab } from '$lib/shared/components/patterns/contracts.js';\n\nexport type ReadableUrl = { readonly href: string; readonly searchParams: Pick<URLSearchParams, 'get'> };"],
      ['tabValue(url: URL,', 'tabValue(url: ReadableUrl,'], ['tabUrl(url: URL,', 'tabUrl(url: ReadableUrl,'],
      ['tableQuery(url: URL,', 'tableQuery(url: ReadableUrl,'], ['tableUrl(url: URL,', 'tableUrl(url: ReadableUrl,'],
      ['new URL(url)', 'new URL(url.href)', 2]] },
];

export function applyReviewedFixturePatches(appDir, approved, definitions = reviewedFixturePatches) {
  if (!approved) throw new Error('Manual steps remain. Review the persisted fixture patches, then explicitly opt in with --approve-reviewed-fixture-patches.');
  const prepared = definitions.map((patch) => {
    if (!reviewedFixturePatches.some((allowed) => allowed.path === patch.path)) throw new Error(`Unreviewed fixture patch path: ${patch.path}`);
    const absolute = contained(appDir, patch.path); const stat = physicalFile(absolute); const original = readFileSync(absolute);
    assert.equal(hashBytes(original), patch.beforeSha256, `${patch.path}: not the reviewed published-baseline bytes; stop for review`);
    let updated = original.toString('utf8');
    for (const [before, after, count = 1] of patch.replacements) {
      assert(Number.isSafeInteger(count) && count > 0, 'Reviewed token count must be explicit and bounded');
      assert.equal(updated.split(before).length - 1, count, `${patch.path}: reviewed token must occur exactly the approved count`);
      updated = updated.replaceAll(before, after);
    }
    assert(!existsSync(absolute + '.reviewed-fixture.bak'), 'Do not overwrite an existing fixture backup');
    return { ...patch, absolute, original, updated: Buffer.from(updated), mode: stat.mode & 0o777 };
  });
  // Validate every SHA/token before the first write, including the two provider-independent templates.
  for (const patch of prepared) {
    writeFileSync(patch.absolute + '.reviewed-fixture.bak', patch.original, { flag: 'wx', mode: patch.mode });
    writeFileSync(patch.absolute, patch.updated); chmodSync(patch.absolute, patch.mode);
  }
  return prepared.map((patch) => ({ path: patch.path, reason: patch.reason, beforeSha256: patch.beforeSha256,
    afterSha256: hashBytes(patch.updated), backup: patch.path + '.reviewed-fixture.bak', automaticCodemod: false }));
}

function dependencyInventory(root) {
  const result = {};
  const visit = (path) => {
    const absolute = path ? join(root, path) : root; const stat = lstatSync(absolute); const mode = stat.mode & 0o777;
    if (stat.isSymbolicLink()) result[path] = { kind: 'link', mode, target: readlinkSync(absolute) };
    else if (stat.isDirectory()) {
      result[path] = { kind: 'directory', mode };
      for (const name of readdirSync(absolute).sort()) visit(path ? path + '/' + name : name);
    } else if (stat.isFile()) result[path] = { kind: 'file', mode, sha256: hashBytes(readFileSync(absolute)) };
    else throw new Error(`Special entry in physical dependency tree: ${path}`);
  };
  visit(''); return result;
}

export function preserveKit2Dependencies(appDir, backupDirectory, approved) {
  if (!approved) throw new Error('Fresh peer resolution requires explicit --approve-fresh-kit3-install.');
  const owner = dirname(appDir); const backup = contained(owner, relative(owner, backupDirectory));
  assert(!backup.startsWith(appDir + sep) && backup !== appDir, 'Dependency backup must be outside the application');
  assert(!existsSync(backup), 'Never overwrite a dependency rollback backup');
  const modules = contained(appDir, 'node_modules'); const lock = contained(appDir, 'package-lock.json');
  const stat = lstatSync(modules); assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Require the entire physical node_modules directory');
  const lockStat = physicalFile(lock); const lockBytes = readFileSync(lock);
  const inventory = dependencyInventory(modules);
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  const receipt = { automaticCodemod: false, reason: 'Approved reversible fresh Kit 3 peer resolution; no source edits or peer bypasses',
    status: 'prepared', lock: { path: join(backup, 'package-lock.json'), sha256: hashBytes(lockBytes), mode: lockStat.mode & 0o777 },
    nodeModules: { path: join(backup, 'node_modules'), sha256: hashBytes(JSON.stringify(inventory)), entries: Object.keys(inventory).length,
      mode: stat.mode & 0o777, dev: stat.dev, ino: stat.ino } };
  writeJson(join(backup, 'inventory.json'), inventory); writeJson(join(backup, 'receipt.json'), receipt);
  renameSync(lock, receipt.lock.path); renameSync(modules, receipt.nodeModules.path);
  assert(readFileSync(receipt.lock.path).equals(lockBytes));
  assert.equal(lstatSync(receipt.lock.path).mode & 0o777, receipt.lock.mode);
  const moved = lstatSync(receipt.nodeModules.path);
  assert.equal(moved.dev, stat.dev); assert.equal(moved.ino, stat.ino);
  assert.deepEqual(dependencyInventory(receipt.nodeModules.path), inventory, 'Moved dependencies changed bytes, links or permissions');
  receipt.status = 'preserved'; writeJson(join(backup, 'receipt.json'), receipt); return receipt;
}

export function assertAppliedPlan(before, after, plan) {
  assert.equal(plan.errors.length, 0, 'A blocked plan must never be applied');
  const expected = new Map(before); const backups = [];
  for (const edit of plan.edits) {
    const prior = before.get(edit.path);
    if (edit.original === null) assert.equal(prior, undefined);
    else {
      assert(prior?.bytes.equals(edit.original), `Planner did not consume exact original ${edit.path}`);
      assert.equal(prior.mode, edit.mode);
      const prefix = edit.path + '.sveltekit3.bak'; let backup = prefix; let suffix = 0;
      while (before.has(backup)) backup = prefix + '.' + ++suffix;
      expected.set(backup, { bytes: edit.original, mode: edit.mode }); backups.push(backup);
    }
    if (edit.updated === null) expected.delete(edit.path);
    else expected.set(edit.path, { bytes: edit.updated, mode: edit.mode });
  }
  assertTreeEqual(expected, after, 'Installed CLI migration differs from reviewed planner/backups');
  assert(after.has(plan.guidePath), 'Installed CLI must write its human/AI handoff');
  assert.equal(after.get(plan.guidePath).bytes.toString(), plan.guide);
  return backups;
}

export function childEnvironment(appDir) {
  const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'COMSPEC', 'CI',
    'NODE_EXTRA_CA_CERTS', 'PLAYWRIGHT_BROWSERS_PATH', 'npm_config_cache'];
  const envPath = join(appDir, '.env');
  const appEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
  const resourceLimits = process.env.RAYON_NUM_THREADS === undefined ? {} : { RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS };
  return { ...Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])), ...appEnv,
    ...resourceLimits,
    npm_config_registry: 'https://registry.npmjs.org', NO_COLOR: '1', FORCE_COLOR: '0',
    DB_DRIVER: 'sqlite', DB_PATH: join(appDir, 'database.db'), CACHE_DRIVER: 'memory', QUEUE_DRIVER: 'sync' };
}

class Evidence {
  constructor(root, state) { this.root = root; this.state = state; this.secrets = ['admin123', 'password']; this.index = state.commands?.length ?? 0; }
  redact(text) { for (const secret of this.secrets.filter(Boolean)) text = text.split(secret).join('[redacted]'); return stripVTControlCharacters(text); }
  persist() {
    writeJson(join(this.root, markerName), this.state);
    const lines = ['# Existing-App Kit 3 Certification', '', `Artifact SHA-256: ${this.state.sha256}`, '',
      `Status: ${this.state.status}. No publication or database reset is performed.`, '',
      ...this.state.steps.map((step) => `- ${step.startedAt} ${step.provider}/${step.phase}: ${step.status}${step.error ? ': ' + step.error : ''}`)];
    writeFileSync(join(this.root, 'TIMELINE.md'), lines.join('\n') + '\n', { mode: 0o600 });
    for (const [provider, app] of Object.entries(this.state.apps)) {
      if (!existsSync(app.directory)) continue;
      const path = contained(app.directory, timelinePath); mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `# Owned Kit 3 Upgrade Timeline\n\nArtifact SHA-256: ${this.state.sha256}\n\n` +
        this.state.steps.filter((step) => step.provider === provider).map((step) => `- ${step.startedAt} ${step.phase}: ${step.status}${step.error ? ': ' + step.error : ''}`).join('\n') + '\n');
    }
  }
  async command(label, command, args, { cwd, env = {}, timeoutMs = this.state.timeoutMs } = {}) {
    this.verifyArtifact?.();
    const entry = { label, command, args, cwd, startedAt: new Date().toISOString() };
    this.state.commands.push(entry); this.persist();
    let stdout = ''; let stderr = ''; let timedOut = false; let overflow = false;
    const child = spawn(command, args, { cwd, env: { ...childEnvironment(cwd), ...env }, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end();
    const stop = () => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const capture = (key, chunk) => {
      if (stdout.length + stderr.length + chunk.length > 32 * 1024 * 1024) { overflow = true; stop(); return; }
      if (key === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data', (chunk) => capture('stdout', chunk.toString()));
    child.stderr.on('data', (chunk) => capture('stderr', chunk.toString()));
    let result;
    try { result = await new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })); }); }
    catch (error) { result = { code: null, signal: null, error: error.message }; }
    finally { clearTimeout(timer); }
    entry.finishedAt = new Date().toISOString(); Object.assign(entry, result, { timedOut, overflow });
    entry.log = `logs/${String(++this.index).padStart(3, '0')}-${label.replace(/[^a-z0-9-]/gi, '-')}.log`;
    writeFileSync(join(this.root, entry.log), this.redact(stdout + '\n--- stderr ---\n' + stderr), { mode: 0o600 });
    this.persist(); this.verifyArtifact?.();
    if (result.code !== 0 || timedOut || overflow) throw new Error(`${label} failed (${result.code ?? result.error ?? result.signal}); see ${entry.log}`);
    return { stdout: stripVTControlCharacters(stdout), stderr: stripVTControlCharacters(stderr) };
  }
}

function installedCore(appDir) {
  const root = join(appDir, 'node_modules/@beeblock/svelar');
  assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), 'Core must be physically installed, never linked to repository source');
  const manifest = json(join(root, 'package.json')); assert.equal(manifest.name, '@beeblock/svelar');
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.svelar;
  return { root, manifest, bin: contained(root, bin.replace(/^\.\//, '')) };
}

function graph(appDir) {
  // Several tooling packages intentionally do not export package.json; inspect their installed metadata, not a require subpath.
  return Object.fromEntries(tools.map((name) => {
    const pkg = json(join(appDir, 'node_modules', name, 'package.json'));
    assert.equal(pkg.name, name); return [name, pkg.version];
  }));
}

function verifyInstalledArtifact(appDir, artifactRoot, integrity) {
  const core = installedCore(appDir); const packaged = snapshotTree(artifactRoot, { artifact: true });
  for (const [path, file] of packaged) assert(readFileSync(contained(core.root, path)).equals(file.bytes), `Installed core differs from immutable artifact: ${path}`);
  const lock = json(join(appDir, 'package-lock.json'));
  assert.equal(lock.packages?.['node_modules/@beeblock/svelar']?.integrity, integrity, 'Installed lockfile core archive integrity mismatch');
  return core;
}

function preserveSnapshot(root, provider, phase, files) {
  const target = join(root, 'private', provider, phase); mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const [path, file] of files) {
    const absolute = contained(target, path); mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    writeFileSync(absolute, file.bytes, { flag: 'wx', mode: 0o600 });
  }
  writeJson(join(root, 'receipts', `${provider}-${phase}-files.json`), summaries(files));
}

function resumePreparedBaseline(root, provider, app) {
  assert.deepEqual(app.completed, ['scaffold'], 'Only a prepared, not-yet-certified baseline may use this recovery path');
  const phase = existsSync(join(root, 'receipts', `${provider}-baseline-reviewed-ui-files.json`)) ? 'baseline-reviewed-ui' : 'baseline';
  const metadata = json(join(root, 'receipts', `${provider}-${phase}-files.json`));
  const directory = join(root, 'private', provider, phase);
  const expected = new Map(Object.entries(metadata).map(([path, file]) => {
    const bytes = readFileSync(contained(directory, path)); assert.equal(hashBytes(bytes), file.sha256);
    return [path, { bytes, mode: file.mode }];
  }));
  const withoutSqlite = (files) => new Map([...files].filter(([path]) => path.split('/').at(-1) !== '.DS_Store' && !/^database\.db(?:-wal|-shm|-journal)?$/.test(path)));
  assertTreeEqual(withoutSqlite(expected), withoutSqlite(snapshotTree(app.directory)), 'Failed baseline source/config must still match the exact prepared snapshot');
  assert.equal(installedCore(app.directory).manifest.version, baselineVersion);
  assertKitGraph(graph(app.directory), 2);
  const current = readData(app.directory); assertPreservedData(current, app.baselineData);
  return { preparedSourceVerified: true, allSqliteSchemaAndNonRuntimeRowsVerified: true, noReseed: true,
    runtimeTableChanges: Object.keys(current.tables).filter((name) => runtimeTables.has(name) && JSON.stringify(current.tables[name]) !== JSON.stringify(app.baselineData.tables[name]))
      .map((name) => ({ name, before: app.baselineData.tables[name].count, after: current.tables[name].count, reason: 'Observed normal check/server startup effects, never a migration or fixture data rewrite' })),
    resumedAfter: 'baseline-check-or-browser-failure' };
}

function readData(appDir) {
  const Database = createRequire(join(appDir, 'package.json'))('better-sqlite3');
  const db = new Database(join(appDir, 'database.db'), { readonly: true, fileMustExist: true });
  db.defaultSafeIntegers(true);
  const encode = (value) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { bigint: String(item) } : item);
  try {
    // Low-level, read-only certification inspection; never create/alter tables or run application CRUD here.
    const schema = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const tables = Object.fromEntries(schema.map(({ name, sql }) => {
      const escaped = '"' + name.replaceAll('"', '""') + '"';
      const rows = db.prepare('SELECT * FROM ' + escaped).all().map((row) => hashBytes(encode(row))).sort();
      return [name, { schema: hashBytes(sql), count: rows.length, rows }];
    }));
    assert(tables.users?.count > 0 && tables.posts?.count > 0, 'Published seed data must be populated');
    return { tables, business: { users: tables.users, posts: tables.posts } };
  } finally { db.close(); }
}

export function assertPreservedData(current, expected) {
  const schema = (data) => Object.fromEntries(Object.entries(data.tables).map(([name, table]) => [name, table.schema]));
  const stable = (data) => Object.fromEntries(Object.entries(data.tables).filter(([name]) => !runtimeTables.has(name)));
  assert.deepEqual(schema(current), schema(expected), 'Existing SQLite schema/history changed');
  assert.deepEqual(stable(current), stable(expected), 'Existing business/security rows changed');
}

function assertBusinessData(appDir, expected) { assertPreservedData(readData(appDir), expected); }

export function successfulBaselineChecks(commands, provider, appDir) {
  const exact = {
    types: { command: process.execPath, args: [join(appDir, 'node_modules/.bin/svelte-check'), '--tsconfig', './tsconfig.json'] },
    tests: { command: 'npm', args: ['run', 'test', '--', '--maxWorkers=1', '--no-file-parallelism'] },
    build: { command: 'npm', args: ['run', 'build'] },
  };
  return Object.fromEntries(Object.entries(exact).flatMap(([name, expected]) => {
    const receipt = commands.findLast((entry) => entry.cwd === appDir && entry.label.startsWith(provider + '-baseline-') &&
      entry.command === expected.command && JSON.stringify(entry.args) === JSON.stringify(expected.args));
    return receipt?.code === 0 && !receipt.timedOut && !receipt.overflow ? [[name, receipt.log]] : [];
  }));
}

function fixtureController() {
  return `// svelar:public - reviewed fixture RBAC exemption; authentication is still required.\nimport { Controller, type RequestEvent } from '@beeblock/svelar/routing';\n\nexport class UpgradeProbeController extends Controller {\n  async index(event: Omit<RequestEvent, 'locals'> & { locals: App.Locals }) {\n    const user = event.locals.user;\n    if (!user) return this.json({ data: null, meta: { message: 'Unauthenticated' } }, 401);\n    const marker = process.env.UPGRADE_CERTIFICATION_MARKER;\n    if (!marker) throw new Error('Owned fixture marker is not configured');\n    return this.json({ data: { marker, userId: String(user.id) }, meta: {} });\n  }\n}\n`;
}

async function freePort() {
  const server = createServer(); await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port; await new Promise((done) => server.close(done)); return port;
}

export async function loadAppChromium(appDir) {
  const local = createRequire(join(appDir, 'package.json'));
  const entry = local.resolve('playwright');
  const installed = json(local.resolve('playwright/package.json'));
  const runner = json(local.resolve('@playwright/test/package.json'));
  const runtimeRequire = createRequire(entry);
  const coreManifest = runtimeRequire.resolve('playwright-core/package.json');
  const core = json(coreManifest);
  assert.equal(installed.version, runner.version, 'App browser library and test runner versions differ');
  assert.equal(core.version, installed.version, 'App browser library and playwright-core versions differ');
  const descriptor = json(join(dirname(coreManifest), 'browsers.json')).browsers.find((browser) => browser.name === 'chromium');
  assert(descriptor?.revision && descriptor.browserVersion, 'App browser registry must pin Chromium revision/version');
  // Load the browser library only. Importing separate apps' test runners triggers Playwright's global singleton guard.
  const loaded = await import(pathToFileURL(entry).href);
  const chromium = loaded.chromium ?? loaded.default?.chromium;
  assert.equal(typeof chromium?.executablePath, 'function', 'App-local browser library did not export Chromium');
  const executablePath = chromium.executablePath(); physicalFile(executablePath);
  assert(executablePath.split(sep).includes('chromium-' + descriptor.revision), 'Chosen browser executable does not match the app Chromium revision');
  return { chromium, runtime: { playwrightVersion: installed.version, coreVersion: core.version,
    chromiumRevision: descriptor.revision, expectedBrowserVersion: descriptor.browserVersion,
    executablePath: realpathSync(executablePath), executableSha256: hashBytes(readFileSync(executablePath)) } };
}

async function browserLogin(appDir, provider, phase, evidence, marker) {
  const { chromium, runtime } = await loadAppChromium(appDir);
  writeJson(join(evidence.root, 'receipts', `${provider}-${phase}-browser-runtime.json`), runtime);
  const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['build'], { cwd: appDir, detached: process.platform !== 'win32',
    env: { ...childEnvironment(appDir), NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), ORIGIN: origin, APP_URL: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let closed = false; let browser;
  const exited = new Promise((done) => { server.once('error', (error) => { output += error.message; closed = true; done(); }); server.once('close', () => { closed = true; done(); }); });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { output = (output + chunk).slice(-4 * 1024 * 1024); });
  const screenshots = [];
  try {
    const deadline = Date.now() + 60000; let ready = false;
    while (Date.now() < deadline && !closed) {
      try { const response = await fetch(origin + '/login', { signal: AbortSignal.timeout(1500) }); if (response.ok) { ready = true; break; } } catch {}
      await new Promise((done) => setTimeout(done, 200));
    }
    assert(ready, 'Owned production server never became ready; inspect its persisted log');
    browser = await chromium.launch({ headless: true, executablePath: runtime.executablePath });
    runtime.actualBrowserVersion = browser.version();
    assert.equal(runtime.actualBrowserVersion, runtime.expectedBrowserVersion, 'Launched physical browser version differs from the app registry');
    writeJson(join(evidence.root, 'receipts', `${provider}-${phase}-browser-runtime.json`), runtime);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await context.newPage();
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('response', (response) => { if (response.url().startsWith(origin) && response.status() >= 500) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    assert.equal((await context.request.get(origin + '/api/upgrade-probe')).status(), 401, 'Custom controller must remain authenticated');
    await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').fill('admin@svelar.dev');
    await page.locator('input[name="password"]').fill('admin123');
    await Promise.all([page.waitForURL('**/dashboard', { timeout: 20000 }), page.getByRole('button', { name: 'Sign In', exact: true }).click()]);
    await page.getByRole('heading', { name: /^Dashboard$/ }).waitFor({ timeout: 20000 });
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: /^Dashboard$/ }).waitFor();
    const meResponse = await context.request.get(origin + '/api/auth/me'); assert.equal(meResponse.status(), 200);
    const me = await meResponse.json(); assert.equal(me.data.email, 'admin@svelar.dev');
    assert(!('password' in me.data), 'Existing API Resource leaked a hidden password');
    const probeResponse = await context.request.get(origin + '/api/upgrade-probe'); assert.equal(probeResponse.status(), 200);
    assert.deepEqual((await probeResponse.json()).data, { marker, userId: String(me.data.id) });
    const csrf = await context.request.post(origin + '/api/auth/logout', { data: {}, headers: { Origin: origin } });
    assert([403, 419].includes(csrf.status()), `Missing-CSRF mutation must remain denied, received ${csrf.status()}`);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Dashboard overflows the viewport');
      const path = `screenshots/${provider}-${phase}-${viewport.width}.png`; await page.screenshot({ path: join(evidence.root, path), fullPage: true }); screenshots.push(path);
    }
    assert.deepEqual(failures, [], 'Browser runtime/500 errors');
    return { production: true, login: true, authenticatedReload: true, existingApi: true, customAuthenticatedApi: true,
      csrfDenied: csrf.status(), screenshots, browserRuntime: runtime };
  } finally {
    try { await browser?.close(); }
    finally {
      const stop = (signal) => { if (!closed && server.pid) { try { process.platform === 'win32' ? server.kill(signal) : process.kill(-server.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } } };
      stop('SIGTERM'); await Promise.race([exited, new Promise((done) => setTimeout(done, 4000))]);
      stop('SIGKILL'); await exited;
      writeFileSync(join(evidence.root, 'logs', `${provider}-${phase}-server.log`), evidence.redact(output), { mode: 0o600 });
    }
  }
}

export async function certify(options) {
  physicalFile(options.tarball); const bytes = readFileSync(options.tarball);
  assert.equal(hashBytes(bytes), options.expectedSha256, 'Artifact SHA does not match the explicitly selected immutable tarball');
  mkdirSync(options.testingRoot, { recursive: true });
  assert(!lstatSync(options.testingRoot).isSymbolicLink(), 'Testing root must not be linked');
  const testingRoot = realpathSync(options.testingRoot);
  if (options.resume) assert(!lstatSync(options.resume).isSymbolicLink(), 'Resume root must not be linked');
  const root = options.resume ? realpathSync(options.resume) : mkdtempSync(join(testingRoot, ownedPrefix));
  assert.equal(dirname(root), testingRoot); assert(root.split(sep).at(-1).startsWith(ownedPrefix));
  const state = options.resume ? json(join(root, markerName)) : { kind, sha256: options.expectedSha256, artifact: options.tarball,
    baselineVersion, baselineIntegrity, providers: options.providers, node: process.version, timeoutMs: options.timeoutMs,
    status: 'incomplete', createdAt: new Date().toISOString(), steps: [], commands: [], apps: {} };
  assert.equal(state.kind, kind); assert.equal(state.sha256, options.expectedSha256); assert.deepEqual(state.providers, options.providers);
  chmodSync(root, 0o700);
  const evidence = new Evidence(root, state);
  for (const directory of ['private', 'logs', 'receipts', 'screenshots']) mkdirSync(join(root, directory), { recursive: true, mode: 0o700 });
  const immutablePath = join(root, 'artifact.tgz');
  if (!existsSync(immutablePath)) writeFileSync(immutablePath, bytes, { mode: 0o400, flag: 'wx' });
  evidence.verifyArtifact = () => {
    physicalFile(options.tarball); physicalFile(immutablePath);
    assert.equal(hashBytes(readFileSync(options.tarball)), state.sha256, 'Selected tarball changed during certification');
    assert.equal(hashBytes(readFileSync(immutablePath)), state.sha256, 'Owned immutable archive snapshot changed');
  };
  evidence.persist();
  try {
    if (!existsSync(join(root, 'package'))) {
      const names = await evidence.command('archive-names', 'tar', ['-tzf', immutablePath], { cwd: root });
      const details = await evidence.command('archive-details', 'tar', ['-tvzf', immutablePath], { cwd: root });
      validateArchiveEntries(names.stdout, details.stdout);
      await evidence.command('archive-extraction', 'tar', ['-xzf', immutablePath, '-C', root], { cwd: root });
    }
    const artifactRoot = join(root, 'package'); const manifest = json(join(artifactRoot, 'package.json'));
    assert.equal(manifest.name, '@beeblock/svelar'); state.artifactVersion = manifest.version;
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    for (const provider of options.providers) {
      const appDir = join(root, provider); const app = state.apps[provider] ??= { directory: appDir, completed: [] };
      if (options.resume && app.checkpoint) {
        if (state.status === 'failed' && app.baselineData && options.approveHistoricalUiDependencies && state.steps.filter((step) => step.provider === provider).at(-1)?.phase === 'baseline') {
          app.reviewedBaselineResume = resumePreparedBaseline(root, provider, app);
        } else assert.deepEqual(summaries(snapshotTree(appDir)), app.checkpoint, 'Resume inventory differs from the last completed phase; review before continuing');
      }
      if (app.marker) evidence.secrets.push(...[...readFileSync(join(appDir, '.env'), 'utf8').matchAll(/^(?:APP_KEY|INTERNAL_SECRET)=(.+)$/gm)].map((match) => match[1]));
      for (const phase of phases) {
        if (options.stopAfter && phases.indexOf(phase) > phases.indexOf(options.stopAfter)) break;
        if (app.completed.includes(phase)) continue;
        const step = { provider, phase, startedAt: new Date().toISOString(), status: 'running' };
        state.steps.push(step); state.status = 'running'; evidence.persist();
        try {
          const cli = (args) => evidence.command(`${provider}-${phase}-${args[0]}`, process.execPath, [installedCore(appDir).bin, ...args], { cwd: appDir });
          const npm = (args) => evidence.command(`${provider}-${phase}-npm-${args[0]}`, 'npm', args, { cwd: appDir });
          const localBin = (name, args) => evidence.command(`${provider}-${phase}-${name}`, process.execPath, [join(appDir, 'node_modules/.bin', name), ...args], { cwd: appDir });
          if (phase === 'scaffold') {
            assert(!existsSync(appDir), 'Never replace an existing app');
            const version = await evidence.command('published-cli-version', 'npx', ['--yes', `--package=@beeblock/svelar@${baselineVersion}`, 'svelar', '--version'], { cwd: root });
            assert.equal(version.stdout.trim(), 'Svelar v' + baselineVersion);
            await evidence.command(`${provider}-published-cli-new`, 'npx', ['--yes', `--package=@beeblock/svelar@${baselineVersion}`, 'svelar', 'new', provider, '--no-install', `--validation=${provider}`], { cwd: root });
            assert(!existsSync(join(appDir, 'node_modules')) && !existsSync(join(appDir, '.git')), 'Official --no-install must not install or initialize git');
            preserveSnapshot(root, provider, 'published-source', snapshotTree(appDir));
          } else if (phase === 'baseline') {
            const packagePath = join(appDir, 'package.json'); const pkg = json(packagePath);
            if (!app.reviewedBaselineResume) {
            pkg.dependencies['@beeblock/svelar'] = baselineVersion; writeJson(packagePath, pkg);
            app.marker = randomUUID(); const key = randomBytes(32).toString('hex'); const internal = randomBytes(32).toString('hex');
            evidence.secrets.push(key, internal);
            const envPath = join(appDir, '.env'); const env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(join(appDir, '.env.example'), 'utf8');
            appendFileSync(envPath, (existsSync(envPath) ? '' : env) + `\n# Explicit owned certification fixture settings\nAPP_KEY=${key}\nINTERNAL_SECRET=${internal}\nDB_DRIVER=sqlite\nDB_PATH=database.db\nCACHE_DRIVER=memory\nQUEUE_DRIVER=sync\nUPGRADE_CERTIFICATION_MARKER=${app.marker}\n`, { mode: 0o600 });
            chmodSync(envPath, 0o600);
            await npm(['install', '--no-audit', '--fund=false']);
            assert.equal(installedCore(appDir).manifest.version, baselineVersion);
            assert.equal(json(join(appDir, 'package-lock.json')).packages['node_modules/@beeblock/svelar'].integrity, baselineIntegrity);
            if (options.approveHistoricalUiDependencies) {
              const original = readFileSync(packagePath);
              const help = await evidence.command(`${provider}-historical-ui-help`, 'npx', ['--yes', '--package=shadcn-svelte@1.8.1', 'shadcn-svelte', 'add', '--help'], { cwd: appDir });
              assert(help.stdout.includes('--no-deps-install'), 'Pinned shadcn CLI must document its no-install mode');
              await evidence.command(`${provider}-historical-ui-components`, 'npx', ['--yes', '--package=shadcn-svelte@1.8.1', 'shadcn-svelte', 'add', '--all', '--yes', '--no-deps-install'], { cwd: appDir });
              app.historicalUiFixture = restoreHistoricalUiManifest(appDir, original, true);
              app.historicalUiFixture.reviewedAdditions = addHistoricalUiDependencies(appDir, original, true);
              writeJson(join(root, 'receipts', provider + '-historical-ui-fixture.json'), app.historicalUiFixture);
              assert([...snapshotTree(appDir).keys()].filter((path) => path.startsWith('src/lib/components/ui/')).length > 50, 'Real shadcn component sources must exist');
              await npm(['install', '--no-audit', '--fund=false']);
            } else await npm(['run', 'ui:install']);
            await cli(['make:controller', 'UpgradeProbe', '--module=upgrade-proof', '--public']);
            await cli(['make:route', 'upgrade-probe', '--api', '--module=upgrade-proof', '--controller=UpgradeProbeController', '--public']);
            const controller = 'src/lib/modules/upgrade-proof/interface/http/controllers/UpgradeProbeController.ts';
            assert(existsSync(contained(appDir, controller)), 'Published CLI did not generate the expected layered controller');
            writeFileSync(contained(appDir, controller), fixtureController());
            for (const path of ['src/app.ts', 'src/hooks.server.ts', 'src/routes/+layout.svelte']) appendFileSync(contained(appDir, path), path.endsWith('.svelte') ? '\n<!-- Owned pre-upgrade customization; preserve exactly. -->\n' : '\n// Owned pre-upgrade customization; preserve exactly.\n');
            await localBin('svelte-kit', ['sync']); await cli(['migrate']); await cli(['seed:run']);
            app.baselineManifest = json(packagePath); app.baselineData = readData(appDir); app.baselineGraph = graph(appDir); assertKitGraph(app.baselineGraph, 2);
            preserveSnapshot(root, provider, 'baseline', snapshotTree(appDir));
            } else {
              const original = readFileSync(packagePath);
              if (!app.historicalUiFixture.reviewedAdditions) {
                app.historicalUiFixture.reviewedAdditions = addHistoricalUiDependencies(appDir, original, true);
                writeJson(join(root, 'receipts', provider + '-historical-ui-fixture.json'), app.historicalUiFixture);
                const data = readData(appDir); await npm(['install', '--no-audit', '--fund=false']);
                assert.deepEqual(readData(appDir), data, 'Reviewed UI dependency install changed the existing seeded dataset');
                preserveSnapshot(root, provider, 'baseline-reviewed-ui', snapshotTree(appDir));
              } else {
                assert.equal(hashBytes(original), app.historicalUiFixture.reviewedAdditions.afterSha256);
                assert.deepEqual(app.historicalUiFixture.reviewedAdditions.additions, historicalUiDependencies);
              }
              app.baselineManifest = json(packagePath); app.baselineGraph = graph(appDir); assertKitGraph(app.baselineGraph, 2);
            }
            const checked = app.reviewedBaselineResume ? successfulBaselineChecks(state.commands, provider, appDir) : {};
            if (!checked.types) await localBin('svelte-check', ['--tsconfig', './tsconfig.json']);
            if (!checked.tests) await npm(['run', 'test', '--', '--maxWorkers=1', '--no-file-parallelism']);
            if (!checked.build) await npm(['run', 'build']);
            app.baselineCheckReceipts = successfulBaselineChecks(state.commands, provider, appDir);
            app.baselineBrowser = await browserLogin(appDir, provider, phase, evidence, app.marker);
            assertBusinessData(appDir, app.baselineData);
          } else if (phase === 'core-kit2') {
            const before = snapshotTree(appDir, { protectedOnly: true }); const data = readData(appDir);
            const manifestBefore = json(join(appDir, 'package.json'));
            await npm(['install', '--save-exact', '--no-audit', '--fund=false', immutablePath]);
            assertCoreOnlyManifest(manifestBefore, json(join(appDir, 'package.json')));
            verifyInstalledArtifact(appDir, artifactRoot, integrity); assertTreeEqual(before, snapshotTree(appDir, { protectedOnly: true }));
            assert.deepEqual(readData(appDir), data, 'Core-only installation changed existing SQLite schema/rows');
            app.coreKit2Graph = graph(appDir); assertKitGraph(app.coreKit2Graph, 2);
            await localBin('svelte-kit', ['sync']); await npm(['run', 'build']);
            app.coreKit2Browser = await browserLogin(appDir, provider, phase, evidence, app.marker); assertBusinessData(appDir, app.baselineData);
          } else if (phase === 'migration') {
            verifyInstalledArtifact(appDir, artifactRoot, integrity);
            const core = installedCore(appDir); const publicCli = core.manifest.exports['./cli'].import;
            const { planSvelteKit3Migration } = await import(pathToFileURL(contained(core.root, publicCli.replace(/^\.\//, ''))).href);
            assert.equal(typeof planSvelteKit3Migration, 'function', 'Artifact must export its real read-only planner');
            const before = snapshotTree(appDir); const data = readData(appDir); const plan = await planSvelteKit3Migration(appDir);
            assertTreeEqual(before, snapshotTree(appDir), 'Public planner must be read-only');
            writeJson(join(root, 'receipts', provider + '-migration-plan.json'), { errors: plan.errors, warnings: plan.warnings, manualSteps: plan.manualSteps,
              edits: plan.edits.map((edit) => ({ path: edit.path, before: edit.original === null ? null : hashBytes(edit.original), after: edit.updated === null ? null : hashBytes(edit.updated), mode: edit.mode, reasons: edit.reasons })) });
            await cli(['update', '--migrate-sveltekit3', '--dry-run']); assertTreeEqual(before, snapshotTree(appDir), 'CLI preview must be read-only');
            await cli(['update', '--migrate-sveltekit3', '--list']); assertTreeEqual(before, snapshotTree(appDir), 'CLI list must be read-only');
            assert.deepEqual(plan.errors, [], 'Installed planner reported blockers; inspect the persisted plan/handoff');
            await cli(['update', '--migrate-sveltekit3', '--force']);
            const after = snapshotTree(appDir); app.migrationBackups = assertAppliedPlan(before, after, plan);
            assert.deepEqual(readData(appDir), data, 'Config/source migration changed SQLite data');
            for (const path of ['.env', 'svelar.validation.json', 'src/app.ts', 'package-lock.json']) assert(before.get(path).bytes.equals(after.get(path).bytes), `Migration changed protected ${path}`);
            app.manualSteps = plan.manualSteps; app.guidePath = plan.guidePath;
            preserveSnapshot(root, provider, 'migration', after);
          } else if (phase === 'manual-review') {
            writeJson(join(root, 'receipts', provider + '-reviewed-fixture-patches.json'), reviewedFixturePatches);
            const before = snapshotTree(appDir); const data = readData(appDir);
            app.reviewedFixturePatches = applyReviewedFixturePatches(appDir, options.approveReviewedFixturePatches);
            const expected = new Map(before);
            for (const patch of app.reviewedFixturePatches) {
              expected.set(patch.path, { bytes: readFileSync(contained(appDir, patch.path)), mode: before.get(patch.path).mode });
              expected.set(patch.backup, before.get(patch.path));
            }
            assertTreeEqual(expected, snapshotTree(appDir), 'Reviewed fixture patch exceeded its explicit paths');
            assert.deepEqual(readData(appDir), data, 'Manual fixture source review changed SQLite data');
            app.manualReview = { automaticCodemod: false, remainingReview: app.manualSteps,
              scope: 'Only the five SHA-pinned published fixture files are resolved. Other app-specific checklist items remain review obligations; passing checks does not generalize to other apps.' };
          } else if (phase === 'kit3') {
            const before = snapshotTree(appDir, { protectedOnly: true }); const data = readData(appDir);
            if (options.approveFreshKit3Install) {
              app.kit2DependencyBackup = preserveKit2Dependencies(appDir, join(root, 'private', provider, 'kit2-dependencies'), true);
              writeJson(join(root, 'receipts', provider + '-kit2-dependency-backup.json'), app.kit2DependencyBackup);
              evidence.persist();
            }
            await npm(['install', '--no-audit', '--fund=false']);
            verifyInstalledArtifact(appDir, artifactRoot, integrity); assertTreeEqual(before, snapshotTree(appDir, { protectedOnly: true }));
            assert.deepEqual(readData(appDir), data, 'Kit 3 graph installation changed SQLite data');
            app.kit3Graph = graph(appDir); assertKitGraph(app.kit3Graph, 3);
            await localBin('svelte-kit', ['sync']); await localBin('svelte-check', ['--tsconfig', './tsconfig.json']);
            await npm(['run', 'test', '--', '--maxWorkers=1', '--no-file-parallelism']);
            await npm(['run', 'build']);
            app.kit3Browser = await browserLogin(appDir, provider, phase, evidence, app.marker); assertBusinessData(appDir, app.baselineData);
            assertTreeEqual(before, snapshotTree(appDir, { protectedOnly: true }), 'Checks/build/browser modified reviewed application source');
          }
          step.status = 'passed'; step.finishedAt = new Date().toISOString(); app.completed.push(phase);
          app.checkpoint = summaries(snapshotTree(appDir));
          mkdirSync(join(appDir, 'docs'), { recursive: true });
          writeFileSync(join(appDir, timelinePath), `# Owned Kit 3 Upgrade Timeline\n\nArtifact SHA-256: ${state.sha256}\n\n` + state.steps.filter((entry) => entry.provider === provider).map((entry) => `- ${entry.startedAt} ${entry.phase}: ${entry.status}`).join('\n') + '\n');
          evidence.persist();
        } catch (error) { step.status = 'failed'; step.finishedAt = new Date().toISOString(); step.error = evidence.redact(error.message); throw error; }
        if (options.stopAfter === phase) break;
      }
    }
    state.status = options.providers.every((provider) => phases.every((phase) => state.apps[provider].completed.includes(phase))) ? 'passed' : 'incomplete';
    state.finishedAt = new Date().toISOString(); evidence.persist();
    console.log(`Kit 3 upgrade certification ${state.status}; evidence: ${root}`); return { root, state };
  } catch (error) {
    state.status = 'failed'; state.error = evidence.redact(error.message); state.finishedAt = new Date().toISOString(); evidence.persist();
    throw new Error(`${state.error}\nPersistent upgrade evidence: ${root}`, { cause: error });
  }
}

const help = `Usage: node scripts/sveltekit3-upgrade-certification.mjs --tarball <local.tgz> --expected-sha256 <sha> [options]
  --validation all|zod|valibot       Default: both real published 0.8.0 DDD apps.
  --testing-root <directory>         Default: sibling svelar-testing-area. Creates only new ${ownedPrefix}* roots.
  --approve-reviewed-fixture-patches Explicitly approve the five SHA-pinned MANUAL fixture files (never called automatic codemod).
  --approve-historical-ui-dependencies Reconstruct existing Kit 2 UI: real pinned shadcn generation, exact manifest restoration, ONLY reviewed shiki/primitives additions, normal install. The old latest-registry installer is NOT certified.
  --approve-fresh-kit3-install       Preserve the exact Kit 2 lock and entire physical dependency tree in private backups, then run a normal fresh install without force/legacy peers.
  --stop-after <phase>               scaffold|baseline|core-kit2|migration|manual-review|kit3. Incomplete is never certified.
  --resume <owned-run-directory>     Continue verified checkpoints with the same artifact; never recreate an app.
  --timeout-ms <milliseconds>        Per command, default 900000. No Docker/build/pack of framework, git, publication or DB resets.
Normal app npm installs, generated UI installation, SQLite migration/seed, checks/tests/build and real production browser login run only when this script is explicitly executed.
Receipts, exact private source snapshots, planner/backups, command logs and timelines persist on failure. No existing app or selected tarball is modified/deleted.
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const options = parseOptions(process.argv.slice(2)); if (options.help) console.log(help); else await certify(options); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
