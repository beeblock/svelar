import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { addHistoricalUiDependencies, applyReviewedFixturePatches, assertAppliedPlan, assertCoreOnlyManifest, assertKitGraph, assertPreservedData, assertTreeEqual,
  baselineIntegrity, baselineVersion, hashBytes, historicalUiDependencies, loadAppChromium, ownedPrefix, parseOptions, preserveKit2Dependencies, reviewedFixturePatches,
  restoreHistoricalUiManifest, snapshotTree, successfulBaselineChecks, validateArchiveEntries } from './sveltekit3-upgrade-certification.mjs';

const argv = ['--tarball', '/fixture/final.tgz', '--expected-sha256', 'a'.repeat(64)];
const baseline = { name: 'existing-app', scripts: { build: 'vite build' }, dependencies: {
  '@beeblock/svelar': '0.8.0', 'sveltekit-superforms': '^2.31.0', zod: '^4.6.7', valibot: '^1.5.0',
}, devDependencies: { '@sveltejs/kit': '^2.70.3', '@sveltejs/adapter-node': '^5.5.7' } };

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), ownedPrefix));
  try { return run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function put(root, path, text, mode = 0o644) {
  const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text, { mode }); return target;
}

test('requires an explicit immutable local archive and defaults to both real 0.8.0 validation providers', () => {
  const options = parseOptions(argv);
  assert.deepEqual(options.providers, ['zod', 'valibot']); assert.equal(options.expectedSha256, 'a'.repeat(64));
  assert.equal(options.timeoutMs, 900000); assert.equal(options.approveReviewedFixturePatches, false);
  assert.equal(options.approveHistoricalUiDependencies, false);
  assert.equal(baselineVersion, '0.8.0'); assert(baselineIntegrity.startsWith('sha512-'));
  assert(options.testingRoot.endsWith('/svelar-testing-area'));
  const explicit = parseOptions(['--tarball=/fixture/final.tgz', '--expected-sha256=' + 'B'.repeat(64), '--validation=valibot', '--approve-reviewed-fixture-patches']);
  assert.deepEqual(explicit.providers, ['valibot']); assert.equal(explicit.expectedSha256, 'b'.repeat(64));
  assert.equal(explicit.approveReviewedFixturePatches, true);
});

test('historical UI bootstrap restores exact original manifest bytes only after explicit fixture approval', () => fixture((root) => {
  const original = Buffer.from('{\r\n "dependencies": {"sveltekit-superforms":"^2.31.0"}, "custom":true\r\n}\r\n');
  const generated = '{"dependencies":{"sveltekit-superforms":"^3.1.0","shiki":"latest"},"custom":true}';
  put(root, 'package.json', generated);
  assert.throws(() => restoreHistoricalUiManifest(root, original, false), /explicit/);
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), generated);
  const receipt = restoreHistoricalUiManifest(root, original, true);
  assert(readFileSync(join(root, 'package.json')).equals(original));
  assert.equal(receipt.automaticCodemod, false); assert.equal(receipt.publishedUiInstallerCertified, false);
  assert.equal(receipt.restoredSha256, receipt.originalSha256);
  assert.deepEqual(receipt.generatorDependencyChanges.map((change) => change.name), ['sveltekit-superforms', 'shiki']);
  assert.equal(parseOptions([...argv, '--approve-historical-ui-dependencies']).approveHistoricalUiDependencies, true);
}));

test('historical UI fixture adds exactly two approved generator dependencies without changing any original range', () => fixture((root) => {
  const original = Buffer.from(JSON.stringify(baseline, null, 2) + '\n'); put(root, 'package.json', original);
  assert.throws(() => addHistoricalUiDependencies(root, original, false), /explicit/);
  const receipt = addHistoricalUiDependencies(root, original, true); const after = JSON.parse(readFileSync(join(root, 'package.json')));
  assert.deepEqual(receipt.additions, { shiki: '^3.20.0', '@shadcn-svelte/primitives': '^0.0.1' });
  assert.equal(receipt.originalDependencyRangesUnchanged, true); assert.equal(receipt.publishedUiInstallerCertified, false);
  for (const [name, value] of Object.entries(baseline.dependencies)) assert.equal(after.dependencies[name], value);
  for (const [name, value] of Object.entries(baseline.devDependencies)) assert.equal(after.devDependencies[name], value);
  for (const name of Object.keys(historicalUiDependencies)) delete after.devDependencies[name];
  assert.deepEqual(after, baseline);
  assert.throws(() => addHistoricalUiDependencies(root, original, true), /Restore exact/);
}));

test('rejects missing SHA, remote archives, unknown/duplicate switches and unsafe timeouts', () => {
  for (const input of [[], ['--tarball', '/fixture/archive.tgz'], ['--expected-sha256', 'a'.repeat(64)],
    [...argv, '--tarball', '/fixture/other.tgz'], [...argv, '--validation=all,other'], [...argv, '--force'],
    [...argv, '--approve-reviewed-fixture-patches=false'], [...argv, '--timeout-ms=NaN'],
    [...argv, '--timeout-ms=10000.5'], [...argv, '--stop-after=install'],
    ['--tarball=https://example.test/archive.zip', '--expected-sha256=' + 'a'.repeat(64)],
    ['--tarball=https://example.test/archive.tgz', '--expected-sha256=' + 'a'.repeat(64)]]) {
    assert.throws(() => parseOptions(input));
  }
  assert.deepEqual(parseOptions(['--help']), { help: true });
});

test('resume accepts only a direct owned-prefix child and preserves explicit stop boundaries', () => {
  const base = [...argv, '--testing-root=/fixture/testing'];
  const resume = parseOptions([...base, '--resume=/fixture/testing/svelar-kit3-upgrade-abcdef', '--stop-after=migration']);
  assert.equal(resume.stopAfter, 'migration');
  for (const path of ['/fixture/testing', '/fixture/testing/existing-app', '/fixture/testing/nested/svelar-kit3-upgrade-abc', '/other/svelar-kit3-upgrade-abc']) {
    assert.throws(() => parseOptions([...base, '--resume=' + path]));
  }
});

test('core-only installation cannot silently upgrade Kit, Superforms, adapters or any other manifest field', () => {
  const after = structuredClone(baseline); after.dependencies['@beeblock/svelar'] = 'file:../../artifact.tgz';
  assertCoreOnlyManifest(baseline, after);
  for (const mutate of [
    (pkg) => { pkg.devDependencies['@sveltejs/kit'] = '^3.0.0'; },
    (pkg) => { pkg.devDependencies['@sveltejs/adapter-node'] = '^6.0.5'; },
    (pkg) => { pkg.dependencies['sveltekit-superforms'] = '^3.0.0'; },
    (pkg) => { pkg.scripts.build = 'vite build --force'; },
    (pkg) => { pkg.dependencies['@beeblock/svelar'] = '^0.9.0'; },
    (pkg) => { delete pkg.dependencies.valibot; },
  ]) { const changed = structuredClone(after); mutate(changed); assert.throws(() => assertCoreOnlyManifest(baseline, changed)); }
});

test('actual installed tool graphs are checked rather than assuming package.json ranges prove a major', () => {
  const kit2 = { '@sveltejs/kit': '2.70.3', '@sveltejs/adapter-node': '5.5.7', 'sveltekit-superforms': '2.31.0' };
  const kit3 = { '@sveltejs/kit': '3.4.0', '@sveltejs/adapter-node': '6.0.5', 'sveltekit-superforms': '3.1.0' };
  assertKitGraph(kit2, 2); assertKitGraph(kit3, 3);
  assert.throws(() => assertKitGraph(kit2, 3)); assert.throws(() => assertKitGraph(kit3, 2));
  assert.throws(() => assertKitGraph({ ...kit3, 'sveltekit-superforms': undefined }, 3));
});

test('preserves every schema and business/security row while explicitly allowing normal operational rows', () => {
  const before = { tables: { users: { schema: 'users-schema', count: 2, rows: ['u1', 'u2'] },
    roles: { schema: 'roles-schema', count: 1, rows: ['admin'] }, migrations: { schema: 'history', count: 2, rows: ['a', 'b'] },
    scheduler_runtime: { schema: 'runtime-schema', count: 0, rows: [] } } };
  const runtime = structuredClone(before); runtime.tables.scheduler_runtime.count = 1; runtime.tables.scheduler_runtime.rows.push('heartbeat');
  assertPreservedData(runtime, before);
  for (const name of ['users', 'roles', 'migrations']) {
    const changed = structuredClone(runtime); changed.tables[name].rows[0] = 'modified';
    assert.throws(() => assertPreservedData(changed, before));
  }
  const schema = structuredClone(runtime); schema.tables.scheduler_runtime.schema = 'different';
  assert.throws(() => assertPreservedData(schema, before));
});

test('only reuses exact successful baseline command receipts, never failed/latest or other-app checks', () => {
  const appDir = '/fixture/app';
  const commands = [{ label: 'zod-baseline-svelte-check', cwd: appDir, command: process.execPath,
    args: [join(appDir, 'node_modules/.bin/svelte-check'), '--tsconfig', './tsconfig.json'], code: 0, log: 'types.log' },
  { label: 'zod-baseline-npm-run', cwd: appDir, command: 'npm', args: ['run', 'build'], code: 0, log: 'build.log' }];
  assert.deepEqual(successfulBaselineChecks(commands, 'zod', appDir), { types: 'types.log', build: 'build.log' });
  assert.deepEqual(successfulBaselineChecks(commands, 'valibot', appDir), {});
  assert.deepEqual(successfulBaselineChecks(commands, 'zod', '/other'), {});
  commands.push({ ...commands[1], code: 1, log: 'failed-build.log' });
  assert.deepEqual(successfulBaselineChecks(commands, 'zod', appDir), { types: 'types.log' });
});

test('tarball validation rejects traversal, duplicates, symlinks and node_modules overrides before extraction', () => {
  validateArchiveEntries('package/\npackage/package.json\n', 'drwxr-xr-x directory\n-rw-r--r-- manifest\n');
  for (const [names, details] of [
    ['package/../outside\npackage/package.json\n', '- file\n- manifest\n'],
    ['other/package.json\n', '- file\n'],
    ['package/package.json\npackage/package.json\n', '- file\n- file\n'],
    ['package/package.json\n', 'l link\n'],
    ['package/package.json\npackage/node_modules/override\n', '- file\n- file\n'],
    ['package/package.json\n', ''],
  ]) assert.throws(() => validateArchiveEntries(names, details));
});

test('source inventory preserves exact .env bytes, validation choice, custom source and permissions', () => fixture((root) => {
  put(root, '.env', 'APP_KEY=private\r\n', 0o600); put(root, 'svelar.validation.json', '{"validation":"valibot"}\r\n');
  put(root, 'src/custom.ts', '// custom\r\n'); put(root, 'package.json', '{}');
  put(root, 'node_modules/ignored.js', 'dependency'); put(root, '.svelte-kit/generated.ts', 'transient');
  put(root, '.DS_Store', 'mutable Finder metadata'); put(root, 'src/.DS_Store', 'mutable Finder metadata');
  const original = snapshotTree(root, { protectedOnly: true });
  assert.deepEqual([...original.keys()].sort(), ['.env', 'src/custom.ts', 'svelar.validation.json']);
  assertTreeEqual(original, snapshotTree(root, { protectedOnly: true }));
  assert.equal(snapshotTree(root).has('.DS_Store'), false);
  assert.equal(snapshotTree(root).has('src/.DS_Store'), false);
  put(root, 'src/custom.ts', '// changed\r\n');
  assert.throws(() => assertTreeEqual(original, snapshotTree(root, { protectedOnly: true })));
  put(root, 'src/custom.ts', '// custom\r\n'); chmodSync(join(root, '.env'), 0o644);
  assert.throws(() => assertTreeEqual(original, snapshotTree(root, { protectedOnly: true })));
}));

test('artifact inventory includes compiled dist and build bytes unlike transient app outputs', () => fixture((root) => {
  put(root, 'package.json', '{}'); put(root, 'dist/cli/bin.js', '// immutable bin'); put(root, 'build/server.js', '// immutable server');
  assert.equal(snapshotTree(root).has('dist/cli/bin.js'), false);
  assert.equal(snapshotTree(root, { artifact: true }).get('dist/cli/bin.js').bytes.toString(), '// immutable bin');
  assert.equal(snapshotTree(root, { artifact: true }).has('build/server.js'), true);
}));

test('inventories fail closed on linked application source instead of following another project', () => fixture((root) => {
  put(root, 'target.ts', '// outside intended src'); mkdirSync(join(root, 'src')); symlinkSync(join(root, 'target.ts'), join(root, 'src/linked.ts'));
  assert.throws(() => snapshotTree(root), /Linked|linked/);
}));

test('applied CLI output must match every independently planned byte, removal and exact-mode backup', () => fixture((root) => {
  put(root, 'package.json', '{"kit":2}\r\n', 0o640); put(root, 'svelte.config.js', '// legacy\r\n');
  put(root, '.env', 'private', 0o600); put(root, 'package-lock.json', '{"oldLock":true}');
  const before = snapshotTree(root); const guide = '# Incomplete manual review\n';
  const plan = { errors: [], guidePath: 'SVELTEKIT3-MIGRATION.md', guide, edits: [
    { path: 'package.json', original: before.get('package.json').bytes, updated: Buffer.from('{"kit":3}\r\n'), mode: 0o640 },
    { path: 'svelte.config.js', original: before.get('svelte.config.js').bytes, updated: null, mode: 0o644 },
    { path: 'SVELTEKIT3-MIGRATION.md', original: null, updated: Buffer.from(guide), mode: 0o644 },
  ] };
  const after = new Map(before);
  for (const edit of plan.edits) {
    if (edit.original !== null) after.set(edit.path + '.sveltekit3.bak', { bytes: edit.original, mode: edit.mode });
    if (edit.updated === null) after.delete(edit.path); else after.set(edit.path, { bytes: edit.updated, mode: edit.mode });
  }
  assert.deepEqual(assertAppliedPlan(before, after, plan), ['package.json.sveltekit3.bak', 'svelte.config.js.sveltekit3.bak']);
  for (const path of ['.env', 'package-lock.json', 'package.json.sveltekit3.bak']) {
    const changed = new Map(after); changed.set(path, { ...changed.get(path), bytes: Buffer.from('unexpected') });
    assert.throws(() => assertAppliedPlan(before, changed, plan));
  }
  const extra = new Map(after); extra.set('src/overwritten.ts', { bytes: Buffer.from('template'), mode: 0o644 });
  assert.throws(() => assertAppliedPlan(before, extra, plan));
}));

test('manual fixture patches require explicit approval, original SHA and exactly one reviewed token', () => fixture((root) => {
  const path = 'src/routes/dashboard/+layout.svelte'; const original = '<script>old()</script>\r\n'; put(root, path, original);
  const definition = { path, beforeSha256: hashBytes(original), reason: 'explicit test fixture', replacements: [['old()', 'reviewed()']] };
  assert.throws(() => applyReviewedFixturePatches(root, false, [definition]), /explicitly/);
  assert.throws(() => applyReviewedFixturePatches(root, true, [{ ...definition, beforeSha256: 'a'.repeat(64) }]), /not the reviewed/);
  assert.throws(() => applyReviewedFixturePatches(root, true, [{ ...definition, replacements: [['missing()', 'new()']] }]), /approved count/);
  assert.equal(existsSync(join(root, path + '.reviewed-fixture.bak')), false);
  const receipt = applyReviewedFixturePatches(root, true, [definition]);
  assert.equal(receipt[0].automaticCodemod, false); assert.equal(readFileSync(join(root, path), 'utf8'), '<script>reviewed()</script>\r\n');
  assert.equal(readFileSync(join(root, path + '.reviewed-fixture.bak'), 'utf8'), original);
}));

test('all manual patch inputs are validated before any write and arbitrary/data paths cannot be patched', () => fixture((root) => {
  const first = reviewedFixturePatches[0].path; const second = reviewedFixturePatches[1].path;
  put(root, first, 'one'); put(root, second, 'two');
  const inputs = [{ path: first, beforeSha256: hashBytes('one'), replacements: [['one', 'new']] },
    { path: second, beforeSha256: hashBytes('different'), replacements: [['two', 'new']] }];
  assert.throws(() => applyReviewedFixturePatches(root, true, inputs));
  assert.equal(readFileSync(join(root, first), 'utf8'), 'one'); assert(!existsSync(join(root, first + '.reviewed-fixture.bak')));
  for (const path of ['.env', 'database.db', 'src/lib/database/migrations/old.ts', '../other']) {
    assert.throws(() => applyReviewedFixturePatches(root, true, [{ path }]));
  }
}));

test('reviewed baseline patch scope names real files and never simulates $app/server or weakens auth', () => {
  assert.equal(reviewedFixturePatches.length, 5);
  for (const patch of reviewedFixturePatches) assert.match(patch.beforeSha256, /^[a-f\d]{64}$/);
  const text = JSON.stringify(reviewedFixturePatches);
  assert(text.includes('$app/state')); assert(text.includes('reset: false'));
  assert(text.includes('sveltekit({ preprocess: vitePreprocess()'));
  assert(text.includes('sveltekit-superforms'));
  assert(!text.includes('checkOrigin: false')); assert(!text.includes('server-only-shim'));
  assert(!text.includes('export const getRequestEvent'));
  assert(text.includes('ReadableUrl')); assert(text.includes('new URL(page.url.href)'));
  assert(!text.includes(' as URL')); assert(!text.includes(' as any'));
});

test('fresh dependency resolution preserves the complete original lock/tree, symlinks and permissions before install', () => fixture((root) => {
  const app = join(root, 'app'); const backup = join(root, 'private', 'kit2');
  put(app, 'package-lock.json', '{"lockfileVersion":3}\r\n', 0o640);
  const executable = put(app, 'node_modules/tool/bin.js', 'original executable\r\n', 0o755);
  put(app, 'node_modules/tool/node_modules/nested/index.js', 'nested dependency', 0o640);
  mkdirSync(join(app, 'node_modules/.bin')); symlinkSync('../tool/bin.js', join(app, 'node_modules/.bin/tool'));
  const linkMode = lstatSync(join(app, 'node_modules/.bin/tool')).mode & 0o777;
  put(app, 'src/custom.ts', '// untouched');
  assert.throws(() => preserveKit2Dependencies(app, backup, false), /explicit/);
  const before = readFileSync(join(app, 'package-lock.json')); const receipt = preserveKit2Dependencies(app, backup, true);
  assert.equal(receipt.status, 'preserved'); assert.equal(receipt.automaticCodemod, false);
  assert.equal(receipt.lock.sha256, hashBytes(before)); assert.equal(receipt.lock.mode, 0o640);
  assert(readFileSync(receipt.lock.path).equals(before));
  assert.equal(readFileSync(join(backup, 'node_modules/tool/bin.js'), 'utf8'), 'original executable\r\n');
  const inventory = JSON.parse(readFileSync(join(backup, 'inventory.json')));
  assert.equal(inventory['tool/bin.js'].mode, 0o755);
  assert.equal(inventory['tool/node_modules/nested/index.js'].mode, 0o640);
  assert.deepEqual(inventory['.bin/tool'], { kind: 'link', mode: linkMode, target: '../tool/bin.js' });
  assert(!existsSync(executable)); assert(!existsSync(join(app, 'package-lock.json')));
  assert.equal(readFileSync(join(app, 'src/custom.ts'), 'utf8'), '// untouched');
  assert.equal(parseOptions([...argv, '--approve-fresh-kit3-install']).approveFreshKit3Install, true);
}));

test('fresh dependency backups reject existing backups and linked module roots without touching originals', () => fixture((root) => {
  const app = join(root, 'app'); const backup = join(root, 'private', 'kit2');
  put(app, 'package-lock.json', '{}'); put(app, 'node_modules/core.js', 'core'); mkdirSync(backup, { recursive: true });
  assert.throws(() => preserveKit2Dependencies(app, backup, true), /overwrite/);
  assert(existsSync(join(app, 'node_modules/core.js'))); assert(existsSync(join(app, 'package-lock.json')));
  const linked = join(root, 'linked-app'); put(linked, 'package-lock.json', '{}'); symlinkSync(join(app, 'node_modules'), join(linked, 'node_modules'));
  assert.throws(() => preserveKit2Dependencies(linked, join(root, 'private', 'linked'), true), /Linked|physical/);
  assert(existsSync(join(linked, 'package-lock.json')));
}));

test('reviewed URL replacements require exact counts and retain source annotations around every copied URL', () => fixture((root) => {
  const path = 'src/routes/admin/dashboard/+page.svelte';
  const original = '// custom before\nnew URL(page.url); new URL(page.url); new URL(page.url);\n// custom after\n';
  put(root, path, original);
  const patch = { path, beforeSha256: hashBytes(original), replacements: [['new URL(page.url)', 'new URL(page.url.href)', 3]] };
  assert.throws(() => applyReviewedFixturePatches(root, true, [{ ...patch, replacements: [['new URL(page.url)', 'bad', 2]] }]), /approved count/);
  applyReviewedFixturePatches(root, true, [patch]);
  const actual = readFileSync(join(root, path), 'utf8');
  assert.equal(actual, original.replaceAll('new URL(page.url)', 'new URL(page.url.href)'));
  assert.equal(readFileSync(join(root, path + '.reviewed-fixture.bak'), 'utf8'), original);
}));

function browserPackages(root, { coreVersion = '1.65.1', revision = '1255', linked = false } = {}) {
  put(root, 'package.json', '{"type":"module"}');
  const executable = put(root, `browsers/chromium-${revision}/chrome`, 'physical-browser-fixture', 0o755);
  if (linked) symlinkSync(executable, join(root, `browsers/chromium-${revision}/linked-chrome`));
  put(root, 'node_modules/playwright/package.json', JSON.stringify({ name: 'playwright', version: '1.65.1', main: 'index.cjs',
    exports: { '.': './index.cjs', './package.json': './package.json' }, dependencies: { 'playwright-core': '1.65.1' } }));
  put(root, 'node_modules/playwright/index.cjs', `module.exports = { chromium: { executablePath: () => ${JSON.stringify(linked ? executable.replace(/chrome$/, 'linked-chrome') : executable)} } };`);
  put(root, 'node_modules/playwright-core/package.json', JSON.stringify({ name: 'playwright-core', version: coreVersion, exports: { './package.json': './package.json' } }));
  put(root, 'node_modules/playwright-core/browsers.json', JSON.stringify({ browsers: [{ name: 'chromium', revision: '1255', browserVersion: '159.0.8154.6' }] }));
  put(root, 'node_modules/@playwright/test/package.json', JSON.stringify({ name: '@playwright/test', version: '1.65.1',
    main: 'index.cjs', exports: { '.': './index.cjs', './package.json': './package.json' } }));
  put(root, 'node_modules/@playwright/test/index.cjs', "throw new Error('The app test runner must never be imported by browser certification');");
  return executable;
}

test('loads two independent app-local browser libraries without importing either test-runner singleton', async () => {
  const root = mkdtempSync(join(tmpdir(), ownedPrefix));
  try {
    const first = join(root, 'first'); const second = join(root, 'second');
    const firstPath = browserPackages(first); const secondPath = browserPackages(second);
    const a = await loadAppChromium(first); const b = await loadAppChromium(second);
    assert.equal(a.runtime.executablePath, realpathSync(firstPath)); assert.equal(b.runtime.executablePath, realpathSync(secondPath));
    assert.notEqual(a.chromium, b.chromium);
    assert.equal(a.runtime.playwrightVersion, '1.65.1'); assert.equal(a.runtime.chromiumRevision, '1255');
    assert.equal(a.runtime.expectedBrowserVersion, '159.0.8154.6');
    assert.equal(a.runtime.executableSha256, hashBytes('physical-browser-fixture'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('browser loader rejects mismatched SDKs, wrong Chromium revisions and linked physical executables', async () => {
  const root = mkdtempSync(join(tmpdir(), ownedPrefix));
  try {
    const version = join(root, 'version'); browserPackages(version, { coreVersion: '1.64.0' });
    await assert.rejects(loadAppChromium(version), /versions differ/);
    const revision = join(root, 'revision'); browserPackages(revision, { revision: '1111' });
    await assert.rejects(loadAppChromium(revision), /Chromium revision/);
    const link = join(root, 'linked'); browserPackages(link, { linked: true });
    await assert.rejects(loadAppChromium(link), /physical file/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
