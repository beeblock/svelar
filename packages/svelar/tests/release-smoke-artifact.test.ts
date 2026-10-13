import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = await import(new URL('../../../scripts/release-smoke.mjs', import.meta.url).href);
const dependenciesRoot = fileURLToPath(new URL('../../../node_modules', import.meta.url));
const version = '0.8.0-immutable.3';
let root: string;

const cliSource = `import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactTemplate } from './template.js';
const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'));
if (process.argv[2] === '--version') console.log('Svelar v' + manifest.version);
else if (process.argv[2] === 'new') {
  mkdirSync(process.argv[3], { recursive: true });
  writeFileSync(join(process.argv[3], 'proof.json'), JSON.stringify({ version: manifest.version, source: artifactTemplate, cli: fileURLToPath(import.meta.url) }));
} else { process.exitCode = 7; }
`;

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function archive(manifestChanges: Record<string, unknown> = {}, changes: Record<string, string> = {}) {
  const source = mkdtempSync(join(root, 'archive-source-'));
  const packageRoot = join(source, 'package');
  write(join(packageRoot, 'package.json'), JSON.stringify({ name: '@beeblock/svelar', version, type: 'module',
    bin: { svelar: 'dist/cli/bin.js' }, exports: { './cli': { import: './dist/cli/index.js' } }, ...manifestChanges }, null, 2) + '\n');
  write(join(packageRoot, 'dist/cli/bin.js'), cliSource);
  write(join(packageRoot, 'dist/cli/template.js'), "export const artifactTemplate = 'immutable artifact scaffold, not repository dist';\n");
  write(join(packageRoot, 'dist/cli/index.js'), "export const builtinCommandNames = () => ['new', 'update', 'make:model'];\n");
  for (const [path, content] of Object.entries(changes)) write(join(packageRoot, path), content);
  const tarball = join(root, `${readdirSync(root).length} artifact with spaces.tgz`);
  const packed = spawnSync('tar', ['-czf', tarball, '-C', source, 'package'], { encoding: 'utf8' });
  expect(packed.status, packed.stderr).toBe(0);
  return { tarball, packageRoot, source };
}

beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'release-artifact-test-'))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('Reviewed smoke SDK dependency upgrades', () => {
  const peers = { peerDependencies: { bullmq: '^5.77.4', ioredis: '^5.0.0', meilisearch: '^0.62.0' } };

  it('aligns an incompatible historical SDK to the selected artifact without touching app dependencies', () => {
    const pkg = { dependencies: { bullmq: '^5.0.0', ioredis: '^5.0.0', meilisearch: '^0.44.0', custom: 'file:../custom' } };
    expect(harness.alignSmokeRuntimeDependencies(pkg, peers)).toEqual([{ name: 'meilisearch', from: '^0.44.0', to: '^0.62.0' }]);
    expect(pkg.dependencies).toEqual({ bullmq: '^5.0.0', ioredis: '^5.0.0', meilisearch: '^0.62.0', custom: 'file:../custom' });
  });

  it('preserves compatible ranges and derives missing SDKs from the artifact, not repository defaults', () => {
    const pkg = { dependencies: { meilisearch: '^0.62.2' } };
    expect(harness.alignSmokeRuntimeDependencies(pkg, peers)).toEqual([
      { name: 'bullmq', from: null, to: '^5.77.4' }, { name: 'ioredis', from: null, to: '^5.0.0' },
    ]);
    expect(harness.alignSmokeRuntimeDependencies(pkg, peers)).toEqual([]);
    expect(pkg.dependencies.meilisearch).toBe('^0.62.2');
  });

  it('rejects custom dependency sources and invalid artifact contracts before mutating the manifest', () => {
    const pkg = { dependencies: { meilisearch: 'file:../custom' } };
    expect(() => harness.alignSmokeRuntimeDependencies(pkg, peers)).toThrow('Review the custom meilisearch');
    expect(pkg.dependencies).toEqual({ meilisearch: 'file:../custom' });
    expect(() => harness.alignSmokeRuntimeDependencies(pkg, { peerDependencies: {} })).toThrow('valid bullmq peer range');
  });

  it('retains exact manifest bytes before the reviewed SDK change and never replaces an existing backup', () => {
    const pkg = Buffer.from('{"dependencies":{"meilisearch":"^0.44.0"}}\r\n');
    const path = join(root, 'package.json');
    write(path, pkg.toString('utf8'));
    harness.patchAppPackage(root, join(root, 'candidate.tgz'), 5199, peers);
    expect(readFileSync(`${path}.sdk-upgrade.bak`)).toEqual(pkg);
    expect(JSON.parse(readFileSync(path, 'utf8')).dependencies.meilisearch).toBe('^0.62.0');
    write(path, pkg.toString('utf8'));
    expect(() => harness.patchAppPackage(root, join(root, 'candidate.tgz'), 5199, peers)).toThrow();
    expect(readFileSync(path)).toEqual(pkg);
    expect(readFileSync(`${path}.sdk-upgrade.bak`)).toEqual(pkg);
  });
});

describe('Release smoke supplied artifact parsing and preflight', () => {
  it('accepts equals and separate arguments with relative paths and spaces', () => {
    expect(harness.parseTarballArgument(['--tarball=artifact with spaces.tgz'], root)).toBe(join(root, 'artifact with spaces.tgz'));
    expect(harness.parseTarballArgument(['--app', 'all', '--tarball', 'artifact with spaces.tgz', '--validation=all'], root)).toBe(join(root, 'artifact with spaces.tgz'));
    expect(harness.parseTarballArgument(['--app=all'], root)).toBeUndefined();
  });

  it.each([
    ['--tarball'], ['--tarball='], ['--tarball', '--app=all'], ['--tarball=a.tgz', '--tarball=b.tgz'],
    ['--tarball', 'a.tgz', '--tarball=b.tgz'],
  ].map((args) => ({ args })))('rejects missing or duplicate artifact arguments $args', ({ args }) => {
    expect(() => harness.parseTarballArgument(args, root)).toThrow();
  });

  it('rejects missing paths, directories and symlinks rather than selecting an unsafe file', () => {
    expect(() => harness.validateTarballPath(join(root, 'missing.tgz'))).toThrow('regular file');
    expect(() => harness.validateTarballPath(root)).toThrow('regular file');
    const file = join(root, 'bytes.tgz');
    write(file, 'not a gzip archive');
    symlinkSync(file, join(root, 'alias.tgz'));
    expect(() => harness.validateTarballPath(join(root, 'alias.tgz'))).toThrow('regular file');
    expect(harness.validateTarballPath(file)).toBe(file);
  });

  it.each([
    ['package/package.json\n../escape\n', '- file\n- file\n'],
    ['package/package.json\n/package/escape\n', '- file\n- file\n'],
    ['package/package.json\npackage/../escape\n', '- file\n- file\n'],
    ['package/package.json\npackage/package.json\n', '- file\n- file\n'],
    ['package/package.json\npackage/link\n', '- file\nl link\n'],
    ['package/package.json\npackage/hardlink\n', '- file\nh link\n'],
    ['package/package.json\npackage/fifo\n', '- file\np fifo\n'],
  ])('rejects traversal, links, special files and duplicate archive entries', (names, details) => {
    expect(() => harness.validateArtifactEntries(names, details)).toThrow();
  });

  it.each([
    { name: 'another-framework' }, { version: '^0.8.0' }, { version: '01.8.0' }, { version: '0.8.0-01' },
    { bin: {} }, { bin: { svelar: '../outside.js' } }, { bin: { svelar: 'missing.js' } }, { exports: {} },
  ])('rejects invalid identity/version/bin/export before any build or application work (%j)', (changes) => {
    const fixture = archive(changes);
    const build = vi.fn();
    const pack = vi.fn();
    const sentinel = join(root, 'existing-app/user-customization.ts');
    write(sentinel, '// preserve exact original\r\n');
    expect(() => harness.prepareSmokeArtifact(fixture.tarball, { build, pack, dependenciesRoot, temporaryRoot: root })).toThrow();
    expect(build).not.toHaveBeenCalled();
    expect(pack).not.toHaveBeenCalled();
    expect(readFileSync(sentinel, 'utf8')).toBe('// preserve exact original\r\n');
    expect(readdirSync(root).filter((name) => name.startsWith('svelar-smoke-artifact-'))).toEqual([]);
  });

  it('rejects malformed archives and cleans the owned extraction', () => {
    const file = join(root, 'malformed.tgz');
    write(file, 'not a tarball');
    expect(() => harness.extractSmokeArtifact(file, { dependenciesRoot, temporaryRoot: root })).toThrow('preflight tar failed');
    expect(readdirSync(root).filter((name) => name.startsWith('svelar-smoke-artifact-'))).toEqual([]);
  });

  it('rejects real archived symlinks before extraction or CLI execution', () => {
    const fixture = archive();
    symlinkSync('/tmp/not-owned', join(fixture.packageRoot, 'unsafe-link'));
    const packed = spawnSync('tar', ['-czf', fixture.tarball, '-C', fixture.source, 'package'], { encoding: 'utf8' });
    expect(packed.status).toBe(0);
    expect(() => harness.extractSmokeArtifact(fixture.tarball, { dependenciesRoot, temporaryRoot: root })).toThrow('not links');
    expect(readdirSync(root).filter((name) => name.startsWith('svelar-smoke-artifact-'))).toEqual([]);
  });
});

describe('Immutable artifact CLI selection', () => {
  it('never builds/packs supplied archives and generates from the exact extracted CLI/version/templates', () => {
    const fixture = archive();
    const originalArchive = readFileSync(fixture.tarball);
    const originalManifest = readFileSync(join(fixture.packageRoot, 'package.json'));
    const build = vi.fn();
    const pack = vi.fn();
    const selected = harness.prepareSmokeArtifact(fixture.tarball, { build, pack, dependenciesRoot, temporaryRoot: root });
    try {
      expect(build).not.toHaveBeenCalled();
      expect(pack).not.toHaveBeenCalled();
      expect(selected.supplied).toBe(true);
      expect(selected.tarballPath).toBe(fixture.tarball);
      expect(selected.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(selected.manifest.version).toBe(version);
      expect(selected.commandNames).toEqual(['new', 'update', 'make:model']);
      expect(readFileSync(join(selected.packageRoot, 'package.json'))).toEqual(originalManifest);
      expect(readlinkSync(join(selected.packageRoot, 'node_modules'))).toBe(dependenciesRoot);
      const output = join(root, 'generated-app');
      const generated = spawnSync(process.execPath, [selected.cliPath, 'new', output], { cwd: root, encoding: 'utf8' });
      expect(generated.status, generated.stderr).toBe(0);
      expect(JSON.parse(readFileSync(join(output, 'proof.json'), 'utf8'))).toEqual({ version, source: 'immutable artifact scaffold, not repository dist', cli: selected.cliPath });
      expect(readFileSync(fixture.tarball)).toEqual(originalArchive);
    } finally { selected.cleanup(); }
    expect(existsSync(selected.extractionRoot)).toBe(false);
    expect(existsSync(dependenciesRoot)).toBe(true);
  });

  it('preserves default build-then-pack behavior when no tarball is supplied', () => {
    const order: string[] = [];
    const selected = harness.prepareSmokeArtifact(undefined, {
      build: () => order.push('build'), pack: () => { order.push('pack'); return '/fixture/packed.tgz'; },
    });
    expect(order).toEqual(['build', 'pack']);
    expect(selected).toMatchObject({ supplied: false, tarballPath: '/fixture/packed.tgz' });
    expect(selected.cliPath).toMatch(/packages\/svelar\/dist\/cli\/bin\.js$/);
    expect(() => selected.cleanup()).not.toThrow();
  });

  it('refuses changed tarball bytes after preflight and before later application gates', () => {
    const fixture = archive();
    const selected = harness.prepareSmokeArtifact(fixture.tarball, { dependenciesRoot, temporaryRoot: root });
    try {
      expect(() => harness.verifySmokeArtifact(selected)).not.toThrow();
      writeFileSync(fixture.tarball, 'changed artifact');
      expect(() => harness.verifySmokeArtifact(selected)).toThrow('refusing mixed-artifact');
      expect(() => harness.verifySmokeArtifact({ supplied: false })).not.toThrow();
    } finally { selected.cleanup(); }
  });

  it('preserves valid SemVer build metadata without replacing the artifact version', () => {
    const declared = '0.8.0+candidate.3';
    const fixture = archive({ version: declared });
    const selected = harness.extractSmokeArtifact(fixture.tarball, { dependenciesRoot, temporaryRoot: root });
    try {
      expect(selected.manifest.version).toBe(declared);
      expect(JSON.parse(readFileSync(join(selected.packageRoot, 'package.json'), 'utf8')).version).toBe(declared);
    } finally { selected.cleanup(); }
  });

  it('rejects a CLI whose runtime version differs without rewriting package metadata', () => {
    const fixture = archive({}, { 'dist/cli/bin.js': "console.log('Svelar v0.0.0');\n" });
    const original = readFileSync(join(fixture.packageRoot, 'package.json'));
    expect(() => harness.extractSmokeArtifact(fixture.tarball, { dependenciesRoot, temporaryRoot: root })).toThrow('does not match');
    expect(readFileSync(join(fixture.packageRoot, 'package.json'))).toEqual(original);
    expect(readdirSync(root).filter((name) => name.startsWith('svelar-smoke-artifact-'))).toEqual([]);
  });

  it('rejects shadow dependency folders and failed or duplicated artifact registries', () => {
    for (const changes of [
      { 'node_modules/override.js': '// not allowed\n' },
      { 'dist/cli/index.js': "export const builtinCommandNames = ['new', 'new', 'update'];\n" },
      { 'dist/cli/index.js': "throw new Error('broken artifact CLI module');\n" },
    ]) {
      const fixture = archive({}, changes);
      expect(() => harness.extractSmokeArtifact(fixture.tarball, { dependenciesRoot, temporaryRoot: root })).toThrow();
      expect(readdirSync(root).filter((name) => name.startsWith('svelar-smoke-artifact-'))).toEqual([]);
    }
  });
});
