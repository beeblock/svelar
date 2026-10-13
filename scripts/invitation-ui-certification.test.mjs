import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import { promisify } from 'node:util';
import { assertBranding, installedPreflight, ownedFixtureDirectory, parseInstalledOptions, productionManifest, recipientMembership, verifyArtifact } from './invitation-ui-certification.mjs';

const script = fileURLToPath(new URL('./invitation-ui-certification.mjs', import.meta.url));
let artifact;
let archiveDirectory;
const run = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const subpaths = ['cli', 'database', 'orm', 'auth', 'session', 'hashing', 'teams', 'testing'];

async function temporary(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'svelar-invitation-preflight-unit-'));
  try { await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function write(directory, path, content) {
  await mkdir(dirname(join(directory, path)), { recursive: true });
  await writeFile(join(directory, path), content);
}
async function negativeApp(directory, { manifest = true, factory = true, packageJson = false, routes = [], badExport = false } = {}) {
  await write(directory, 'package.json', JSON.stringify({ type: 'module' }));
  await write(directory, 'build/index.js', '// Negative preflight fixture, never executed.\n');
  if (manifest) await write(directory, 'build/server/manifest.js', 'export const manifest = ' + JSON.stringify({ appDir: '_app', _: { routes: routes.map((id) => ({ id })) } }) + ';\n');
  if (factory) await write(directory, 'src/lib/factories/UserFactory.ts', '// Negative preflight marker, never loaded.\n');
  if (packageJson) {
    const exports = { './package.json': './package.json' };
    for (const name of subpaths) {
      exports['./' + name] = { import: './dist/' + name + '.js' };
      await write(directory, 'node_modules/@beeblock/svelar/dist/' + name + '.js', name === 'teams' ? 'export const Teams = {};\n' : 'export const negativeFixture = true;\n');
    }
    if (badExport) exports['./cli'].import = './src/cli.ts';
    await write(directory, 'node_modules/@beeblock/svelar/package.json', JSON.stringify({ name: '@beeblock/svelar', type: 'module', exports }));
  }
}
before(async () => {
  archiveDirectory = await mkdtemp(join(tmpdir(), 'svelar-invitation-byte-unit-'));
  artifact = join(archiveDirectory, 'fixture.tgz');
  const exports = {};
  for (const name of subpaths) {
    exports['./' + name] = { import: './dist/' + name + '.js' };
    await write(archiveDirectory, 'package/dist/' + name + '.js', 'export const fixture = ' + JSON.stringify(name) + ';\n');
  }
  await write(archiveDirectory, 'package/package.json', JSON.stringify({ name: 'private-invitation-byte-fixture', type: 'module', exports }));
  await run('tar', ['-czf', artifact, '-C', archiveDirectory, 'package']);
});
after(async () => { if (archiveDirectory) await rm(archiveDirectory, { recursive: true, force: true }); });

async function archiveInstallation() {
  const read = async (path) => (await run('tar', ['-xOf', artifact, path], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })).stdout;
  const manifest = await read('package/package.json');
  const parsed = JSON.parse(manifest);
  const entries = {};
  for (const name of subpaths) {
    const entry = parsed.exports['./' + name].import;
    entries[name] = { entry, sha256: hash(await read('package/' + entry.slice(2))) };
  }
  return { manifestSha256: hash(manifest), entries };
}

test('valid installed options keep explicit database/artifact/evidence paths', () => {
  const options = parseInstalledOptions(['--installed-app=/tmp/owned-app', '--database=owned.db', '--tarball=' + artifact, '--report-dir=/tmp/owned-evidence']);
  assert.equal(options.appDir, '/tmp/owned-app');
  assert.equal(options.database, 'owned.db');
  assert.equal(options.tarball, artifact);
  assert.equal(options.reportDir, '/tmp/owned-evidence');
});
test('default evidence directory is outside the input app', () => {
  const options = parseInstalledOptions(['--installed-app=/tmp/owned-app']);
  assert(!options.reportDir.startsWith(options.appDir + '/'));
});
test('missing/malformed installed option fails closed', () => {
  assert.throws(() => parseInstalledOptions([]), /is required/);
  assert.throws(() => parseInstalledOptions(['--installed-app']), /Unknown/);
});
test('source-mode flags cannot leak into installed mode', () => {
  for (const flag of ['--clients=x', '--valibot', '--unexpected=x']) assert.throws(() => parseInstalledOptions(['--installed-app=/tmp/owned-app', flag]), /Unknown/);
});
test('duplicate options are rejected', () => {
  assert.throws(() => parseInstalledOptions(['--installed-app=/tmp/owned-app', '--installed-app=/tmp/other-app']), /Repeated/);
});
test('evidence cannot overwrite the original app', () => {
  for (const path of ['/tmp/owned-app', '/tmp/owned-app/evidence']) assert.throws(() => parseInstalledOptions(['--installed-app=/tmp/owned-app', '--report-dir=' + path]), /outside/);
});
test('missing adapter-node build is rejected', () => temporary(async (directory) => {
  await assert.rejects(installedPreflight(directory), /Missing adapter-node/);
}));
test('missing server manifest is rejected before imports', () => temporary(async (directory) => {
  await negativeApp(directory, { manifest: false });
  await assert.rejects(installedPreflight(directory), /Missing production server manifest/);
}));
test('hashed adapter manifest import and renamed export resolve without loading the server', () => temporary(async (directory) => {
  await write(directory, 'build/index.js', "import './server/chunks/manifest.js-negative-test.js';\nthrow new Error('Server entry must not execute during preflight');\n");
  await write(directory, 'build/server/chunks/manifest.js-negative-test.js', "const manifest = { appDir: '_app', _: { routes: [{ id: '/invitations/[token]' }] } }; export { manifest as m };\n");
  const result = await productionManifest(directory);
  assert.equal(result.manifest._.routes[0].id, '/invitations/[token]');
  assert.equal(result.entry.path, 'build/server/chunks/manifest.js-negative-test.js');
}));
test('ambiguous adapter manifests fail closed', () => temporary(async (directory) => {
  await write(directory, 'build/index.js', "import './server/manifest-one.js';\nimport './server/manifest-two.js';\n");
  await assert.rejects(productionManifest(directory), /ambiguous/);
}));
test('missing generated UserFactory is rejected', () => temporary(async (directory) => {
  await negativeApp(directory, { factory: false });
  await assert.rejects(installedPreflight(directory), /Missing actual generated UserFactory/);
}));
test('missing installed package is rejected', () => temporary(async (directory) => {
  await negativeApp(directory);
  await assert.rejects(installedPreflight(directory), { code: 'MODULE_NOT_FOUND' });
}));
test('non-dist public entry is rejected without source loading', () => temporary(async (directory) => {
  await negativeApp(directory, { packageJson: true, badExport: true });
  await assert.rejects(installedPreflight(directory), /Missing installed public dist export: cli/);
}));
test('absent compiled invitation routes are rejected', () => temporary(async (directory) => {
  await negativeApp(directory, { packageJson: true });
  await assert.rejects(installedPreflight(directory), /missing invitation route/);
}));
test('missing installed Teams API is rejected', () => temporary(async (directory) => {
  await negativeApp(directory, { packageJson: true, routes: ['/invitations/[token]', '/api/invitations/[token]', '/api/invitations/[token]/accept', '/api/invitations/[token]/decline'] });
  await assert.rejects(installedPreflight(directory), /Installed Teams is missing lookupInvitation/);
}));
test('private fixture child refuses an unowned cwd before imports or writes', () => temporary(async (directory) => {
  const child = spawn(process.execPath, [script, '--fixture-op=create'], { cwd: directory, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => stderr += chunk);
  const ended = new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
  child.stdin.end('{}');
  assert.equal(await ended, 1);
  assert.match(stderr, /Fixture writes require the owned isolated app/);
}));
test('owned app layout accepts canonical temporary paths including macOS /private indirection', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'svelar-auth-ui-invitation-unit-'));
  try {
    const app = join(parent, 'app'); await mkdir(app);
    assert.equal(await ownedFixtureDirectory(app), await realpath(app));
    assert.equal(await ownedFixtureDirectory(await realpath(app)), await realpath(app));
  } finally { await rm(parent, { recursive: true, force: true }); }
});
test('brand text renders honestly when optional images are not configured', () => {
  assert.doesNotThrow(() => assertBranding({ brand: { name: 'Svelar' } }, { frameCount: 1, heading: 'Svelar', images: [] }));
});
test('a configured missing or broken logo remains a real assertion failure', () => {
  const presentation = { brand: { name: 'Svelar', logoUrl: '/favicon.svg' } };
  assert.throws(() => assertBranding(presentation, { frameCount: 1, heading: 'Svelar', images: [] }), /did not render/);
  assert.throws(() => assertBranding(presentation, { frameCount: 1, heading: 'Svelar', images: [{ src: '/favicon.svg', complete: true, naturalWidth: 0 }] }), /did not render/);
});
test('configured title and loaded logo/image are both checked', () => {
  assert.doesNotThrow(() => assertBranding({ brand: { name: 'Svelar', title: 'Custom title', logoUrl: '/favicon.svg', imageUrl: '/institution.png' } }, {
    frameCount: 1, heading: 'Custom title', images: [{ src: '/favicon.svg', complete: true, naturalWidth: 16 }, { src: '/institution.png', complete: true, naturalWidth: 800 }],
  }));
});
for (const [name, key, stored] of [['numeric SQLite TEXT affinity', 1, '1.0'], ['UUID identity', '018f4c5d-48a0-7000-8000-000000000001', '018f4c5d-48a0-7000-8000-000000000001']]) {
  test('typed membership lookup preserves ' + name, async () => {
    const predicates = [];
    class Query { constructor(table) { assert.equal(table, 'team_members'); } where(...args) { predicates.push(args); return this; } async first() { return { user_id: stored, role: 'viewer' }; } }
    const Teams = { isMember: async (team, id) => { assert.equal(team, 'owned-team'); assert.equal(id, key); return true; } };
    assert.deepEqual(await recipientMembership(Query, Teams, 'owned-team', key), [{ userId: stored, role: 'viewer' }]);
    assert.deepEqual(predicates, [['team_id', 'owned-team'], ['user_id', key]]);
  });
}
test('typed membership lookup fails on real API/persistence disagreement', async () => {
  class Query { where() { return this; } async first() { return null; } }
  await assert.rejects(recipientMembership(Query, { isMember: async () => true }, 'owned-team', 1), /disagree/);
});
test('installed CLI failure emits independent JSON and never falls back to source mode', () => temporary(async (directory) => {
  const app = join(directory, 'app'); const report = join(directory, 'evidence'); await mkdir(app);
  await assert.rejects(run(process.execPath, [script, '--installed-app=' + app, '--report-dir=' + report]), { code: 1 });
  const result = JSON.parse(await readFile(join(report, 'installed-summary.json'), 'utf8'));
  assert.equal(result.mode, 'installed-production');
  assert.equal(result.complete, false);
  assert.equal(result.passed, 0); assert.equal(result.failed, 1); assert.equal(result.skipped, 0); assert.equal(result.notRun, 13);
  assert.deepEqual(result.cleanupErrors, []);
}));
test('artifact verifier matches test archive and eight entry fingerprints', async () => {
  const result = await verifyArtifact(artifact, await archiveInstallation());
  assert.equal(result.sha256, hash(await readFile(artifact)));
  assert.equal(result.sha1, createHash('sha1').update(await readFile(artifact)).digest('hex'));
  assert.equal(result.listedFiles, 9);
  assert.deepEqual(result.verifiedPublicEntries, subpaths);
});
test('artifact verifier rejects mismatched installed manifest', async () => {
  await assert.rejects(verifyArtifact(artifact, { manifestSha256: 'wrong', entries: {} }), /manifest differs/);
});
test('artifact verifier rejects mismatched installed runtime entry', async () => {
  const installation = await archiveInstallation(); installation.entries.teams.sha256 = 'wrong';
  await assert.rejects(verifyArtifact(artifact, installation), /Installed teams differs/);
});
