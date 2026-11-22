import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';

const semver = createRequire(import.meta.url)('semver') as {
  validRange(value: string): string | null;
  minVersion(value: string): { version: string; major: number; prerelease: unknown[] } | null;
  satisfies(version: string, range: string): boolean;
  subset(sub: string, sup: string): boolean;
  intersects(first: string, second: string): boolean;
};
interface Manifest {
  name: string;
  private: boolean;
  engines: { node: string; npm?: string };
  packageManager?: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides: Record<string, unknown>;
}
const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const core = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
function manifest(validation: 'zod' | 'valibot' = 'zod'): Manifest {
  return JSON.parse(NewCommandTemplates.packageJson('dependency-contract', core.version, validation));
}
function minimum(range: string): string {
  const value = semver.minVersion(range);
  if (!value) throw new Error('Invalid dependency range: ' + range);
  return value.version;
}

// Registry release contracts checked on 2026-11-22; tests stay offline and reproducible.
// https://registry.npmjs.org/<name>/<version>
const releaseContracts = [
  { name: '@sveltejs/kit', version: '3.4.0', peers: { vite: '^8.0.12', svelte: '^5.57.1', typescript: '^6.0.0', '@sveltejs/vite-plugin-svelte': '^7.0.0' }, node: '>=22.17' },
  { name: '@sveltejs/adapter-node', version: '6.0.5', peers: { '@sveltejs/kit': '^3.0.0-next.0' } },
  { name: '@sveltejs/vite-plugin-svelte', version: '7.3.1', peers: { vite: '^8.0.0-beta.7 || ^8.0.0', svelte: '^5.46.4' }, node: '^20.19 || ^22.12 || >=24' },
  { name: 'vite', version: '8.3.4', peers: { '@types/node': '^20.19.0 || >=22.12.0' }, node: '^20.19.0 || >=22.12.0' },
  { name: '@tailwindcss/vite', version: '4.3.3', peers: { vite: '^5.2.0 || ^6 || ^7 || ^8' } },
  { name: 'vitest', version: '5.1.1', peers: { vite: '^6.4.0 || ^7.0.0 || ^8.0.0', '@vitest/coverage-v8': '5.1.1', '@types/node': '^22.0.0 || >=24.0.0' }, node: '^22.12.0 || ^24.0.0 || >=26.0.0' },
  { name: '@vitest/coverage-v8', version: '5.1.1', peers: { vitest: '5.1.1' } },
  { name: 'svelte-check', version: '4.7.6', peers: { svelte: '^4.0.0 || ^5.0.0-next.0', typescript: '^5.0.0 || ^6.0.0' }, node: '>=18.0.0' },
  { name: 'formsnap', version: '2.1.0', peers: { svelte: '^5.0.0', 'sveltekit-superforms': '^2.19.0 || ^3.0.0' }, node: '>=18' },
  { name: 'bits-ui', version: '2.19.5', peers: { svelte: '^5.33.0', '@internationalized/date': '^3.8.1' }, node: '>=20' },
  { name: 'sveltekit-superforms', version: '3.1.0', peers: { '@sveltejs/kit': '^2.12.0 || ^3.0.0', svelte: '^5.56.4', valibot: '^1.2.0', typebox: '^1.0.36' } },
] as const;

describe('Generated app dependency compatibility', () => {
  it.each(releaseContracts)('satisfies the selected $name release contracts at declared minimum versions', (release) => {
    const app = manifest();
    const dependencies = { ...app.dependencies, ...app.devDependencies };
    expect(dependencies[release.name]).toBeDefined();
    expect(minimum(dependencies[release.name])).toBe(release.version);
    for (const [name, range] of Object.entries(release.peers)) {
      expect(semver.satisfies(minimum(dependencies[name]), range), release.name + ' requires ' + name + '@' + range).toBe(true);
    }
    if ('node' in release) expect(semver.subset(app.engines.node, release.node)).toBe(true);
  });

  it('requires the Kit 3 Node 22.17+ floor and excludes unsupported Node 23 and 25 lines', () => {
    const engine = manifest().engines.node;
    expect(engine).toBe('^22.17.0 || ^24.0.0 || >=26.0.0');
    for (const version of ['22.17.0', '22.20.0', '24.0.0', '24.12.0', '26.0.0']) expect(semver.satisfies(version, engine)).toBe(true);
    for (const version of ['18.20.0', '20.19.0', '22.12.0', '22.16.0', '23.0.0', '25.0.0']) expect(semver.satisfies(version, engine)).toBe(false);
    expect(semver.minVersion(manifest().devDependencies.vite)?.major).toBe(8);
  });

  it('pins workspace-safe npm only for source contributors, not generated or installed apps', () => {
    expect(root.packageManager).toBe('npm@11.21.3');
    expect(root.engines.npm).toBe('^11.21.3');
    for (const version of ['11.21.3', '11.22.0']) expect(semver.satisfies(version, root.engines.npm)).toBe(true);
    for (const version of ['11.6.2', '11.21.2', '12.0.0']) expect(semver.satisfies(version, root.engines.npm)).toBe(false);
    expect(core.engines.npm).toBeUndefined();
    expect(core.packageManager).toBeUndefined();
    for (const provider of ['zod', 'valibot'] as const) {
      const app = manifest(provider);
      expect(app.engines.npm).toBeUndefined();
      expect(app.packageManager).toBeUndefined();
    }
  });

  it('retains core-tested framework, ORM, schema and test-runner minimums', () => {
    const app = manifest();
    const dependencies = { ...app.dependencies, ...app.devDependencies };
    for (const name of ['@sveltejs/kit', 'svelte', 'typescript', 'better-sqlite3']) {
      expect(semver.satisfies(minimum(dependencies[name]), root.devDependencies[name])).toBe(true);
    }
    for (const name of ['zod', 'drizzle-orm']) expect(semver.satisfies(minimum(dependencies[name]), core.dependencies[name])).toBe(true);
    for (const name of ['valibot', 'vitest', 'sveltekit-superforms', '@vitest/coverage-v8']) {
      expect(semver.satisfies(minimum(dependencies[name]), core.devDependencies[name])).toBe(true);
    }
    expect(app.devDependencies.svelte).toBe('^5.59.1');
    expect(app.dependencies['better-sqlite3']).toBe('^13.2.0');
    expect(app.devDependencies.tailwindcss).toBe(app.devDependencies['@tailwindcss/vite']);
  });

  it.each(['zod', 'valibot'] as const)('meets installed core peer contracts for the %s provider', (validation) => {
    const app = manifest(validation);
    const dependencies = { ...app.dependencies, ...app.devDependencies };
    for (const [name, range] of Object.entries(core.peerDependencies) as [string, string][]) {
      if (dependencies[name]) expect(semver.satisfies(minimum(dependencies[name]), range), name).toBe(true);
    }
    expect(semver.satisfies(minimum(app.dependencies.valibot), '^1.5.0')).toBe(true);
    expect(Boolean(app.dependencies.zod)).toBe(validation === 'zod');
  });

  it('does not float into incompatible latest-tag major lines', () => {
    const app = manifest();
    const dependencies = { ...app.dependencies, ...app.devDependencies };
    for (const [name, incompatible] of [['@sveltejs/kit', '>=4'], ['@sveltejs/adapter-node', '>=7'], ['bullmq', '>=6'], ['ioredis', '>=6'], ['sveltekit-superforms', '>=4'], ['formsnap', '>=3'], ['vitest', '>=6'], ['@vitest/coverage-v8', '>=6'], ['svelte', '>=6'], ['better-sqlite3', '>=14'], ['typescript', '>=7']]) {
      expect(semver.intersects(dependencies[name], incompatible), name).toBe(false);
    }
    for (const [name, range] of Object.entries(dependencies)) {
      expect(semver.validRange(range), name).not.toBeNull();
      if (name !== 'vaul-svelte') expect(semver.minVersion(range)?.prerelease, name).toEqual([]);
    }
    expect(semver.minVersion(app.dependencies.layerchart)?.major).toBe(2);
  });

  it('keeps all shadcn components and post-install dependency versions aligned with the manifest', () => {
    const app = manifest();
    const [generator, install, sync, ...unexpected] = app.scripts['ui:install'].split(' && ');
    expect(generator).toBe('npm exec --package shadcn-svelte@latest -- shadcn-svelte add --all --yes');
    expect(install).toMatch(/^npm install --save-prod /);
    expect(sync).toBe('svelte-kit sync');
    expect(unexpected).toEqual([]);
    const specs = install.slice('npm install --save-prod '.length).split(' ');
    expect(specs.length).toBeGreaterThanOrEqual(13);
    const names = new Set<string>();
    for (const spec of specs) {
      const split = spec.lastIndexOf('@');
      const name = spec.slice(0, split);
      expect(names.has(name)).toBe(false);
      names.add(name);
      expect(app.dependencies[name], name).toBe(spec.slice(split + 1));
    }
    for (const name of ['bits-ui', 'layerchart', 'formsnap', 'sveltekit-superforms', 'vaul-svelte']) expect(names.has(name)).toBe(true);
  });

  it('keeps coverage runner and adapter versions matched and existing audit overrides intact', () => {
    const app = manifest();
    expect(app.scripts['test:coverage']).toContain('--coverage');
    expect(app.devDependencies['@vitest/coverage-v8']).toBe(app.devDependencies.vitest);
    expect(app.overrides['@sveltejs/kit']).toBeUndefined();
    expect(root.overrides['@sveltejs/kit']).toEqual({ 'cookie@^0.6.0': '^0.7.2' });
    expect(root.overrides['@sveltejs/kit@^2']).toBeUndefined();
    expect(app.overrides.exceljs).toEqual({ uuid: '^11.1.1' });
    expect(app.overrides['runed@>=0.35.1 <0.38.0']).toBe('^0.38.0');
    expect(app.overrides.runed).toBeUndefined();
    for (const version of ['0.35.1', '0.36.0', '0.37.1']) expect(semver.satisfies(version, '>=0.35.1 <0.38.0')).toBe(true);
    for (const version of ['0.25.0', '0.34.0', '0.38.0']) expect(semver.satisfies(version, '>=0.35.1 <0.38.0')).toBe(false);
    expect(app.overrides['esbuild@>=0.27.3 <0.28.1']).toBe('^0.28.2');
  });

  it('uses the Vite 8 Rolldown output contract rather than deprecated transform/bundler options', () => {
    const file = ts.createSourceFile('vite.config.ts', NewCommandTemplates.viteConfig(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const properties: ts.PropertyAssignment[] = [];
    const visit = (node: ts.Node) => { if (ts.isPropertyAssignment(node)) properties.push(node); ts.forEachChild(node, visit); };
    visit(file);
    const bundler = properties.find((property) => property.name.getText(file) === 'rolldownOptions');
    expect(bundler).toBeDefined();
    expect(properties.some((property) => ['rollupOptions', 'esbuild'].includes(property.name.getText(file)))).toBe(false);
    const output = bundler && ts.isObjectLiteralExpression(bundler.initializer)
      ? bundler.initializer.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(file) === 'output') : undefined;
    expect(output && ts.isPropertyAssignment(output) && ts.isObjectLiteralExpression(output.initializer)
      && output.initializer.properties.some((property) => ts.isPropertyAssignment(property) && property.name.getText(file) === 'keepNames' && property.initializer.kind === ts.SyntaxKind.TrueKeyword)).toBe(true);
  });

  it('processes style-only animation exports while retaining optional Node driver externals', () => {
    const file = ts.createSourceFile('vite.config.ts', NewCommandTemplates.viteConfig(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const properties: ts.PropertyAssignment[] = [];
    const visit = (node: ts.Node) => { if (ts.isPropertyAssignment(node)) properties.push(node); ts.forEachChild(node, visit); };
    visit(file);
    const ssr = properties.find((property) => property.name.getText(file) === 'ssr');
    expect(ssr && ts.isObjectLiteralExpression(ssr.initializer)).toBe(true);
    const options = ssr && ts.isObjectLiteralExpression(ssr.initializer) ? ssr.initializer.properties : [];
    const strings = (name: string) => {
      const property = options.find((node) => ts.isPropertyAssignment(node) && node.name.getText(file) === name);
      expect(property && ts.isPropertyAssignment(property) && ts.isArrayLiteralExpression(property.initializer)).toBe(true);
      return property && ts.isPropertyAssignment(property) && ts.isArrayLiteralExpression(property.initializer)
        ? property.initializer.elements.filter(ts.isStringLiteral).map((node) => node.text) : [];
    };
    expect(strings('noExternal')).toContain('tw-animate-css');
    expect(strings('external')).toEqual(expect.arrayContaining(['bcrypt', 'argon2', 'bullmq', 'ioredis']));
    expect(strings('external')).not.toContain('tw-animate-css');
  });

  it('re-exports the complete generated-shadcn type utility contract from the public Bits UI entry', () => {
    const file = ts.createSourceFile('utils.ts', NewCommandTemplates.utilsCn(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const exports = file.statements.filter(ts.isExportDeclaration);
    const types = exports.find((statement) => statement.isTypeOnly && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === 'bits-ui');
    expect(types?.exportClause && ts.isNamedExports(types.exportClause) ? types.exportClause.elements.map((element) => element.name.text).sort() : []).toEqual(
      ['WithoutChild', 'WithoutChildren', 'WithoutChildrenOrChild', 'WithElementRef'].sort(),
    );
  });
});

describe('Generated Vite and shadcn installed dependency contracts (opt-in fixture)', () => {
  it.skipIf(!process.env.SVELAR_PACKAGE_DEPENDENCY_APP)('type-checks and loads current templates with installed target dependencies on native Node', async () => {
    const app = resolve(process.env.SVELAR_PACKAGE_DEPENDENCY_APP!);
    const node = process.env.SVELAR_PACKAGE_NODE ?? process.execPath;
    const directory = await mkdtemp(join(tmpdir(), 'svelar-installed-template-contract-'));
    const exec = promisify(execFile);
    const options = { cwd: directory, timeout: 30000, maxBuffer: 8 * 1024 * 1024 };
    try {
      const installedKit = JSON.parse(await readFile(join(app, 'node_modules/@sveltejs/kit/package.json'), 'utf8'));
      expect(semver.satisfies(installedKit.version, '^2.0.0 || ^3.0.0')).toBe(true);
      await symlink(join(app, 'node_modules'), join(directory, 'node_modules'), 'dir');
      await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
      await writeFile(join(directory, 'vite.config.ts'), NewCommandTemplates.viteConfig());
      if (semver.satisfies(installedKit.version, '^2.0.0')) {
        await writeFile(join(directory, 'svelte.config.js'), NewCommandTemplates.svelteConfig());
      }
      await writeFile(join(directory, 'utils.ts'), NewCommandTemplates.utilsCn());
      await writeFile(join(directory, 'utils.mjs'), ts.transpileModule(NewCommandTemplates.utilsCn(), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
      await writeFile(join(directory, 'contract.ts'), `import config from './vite.config.js';
        import type { UserConfigExport } from 'vite';
        import { cn, type WithoutChild, type WithoutChildren, type WithoutChildrenOrChild, type WithElementRef } from './utils.js';
        type Props = { label: string; child?: string; children?: string };
        type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
        type Assert<T extends true> = T;
        type ChildKeys = Assert<Equal<keyof WithoutChild<Props>, 'label' | 'children'>>;
        type ChildrenKeys = Assert<Equal<keyof WithoutChildren<Props>, 'label' | 'child'>>;
        type NeitherKeys = Assert<Equal<keyof WithoutChildrenOrChild<Props>, 'label'>>;
        type Ref = Assert<Equal<WithElementRef<{ label: string }, HTMLButtonElement>['ref'], HTMLButtonElement | null | undefined>>;
        const valid: UserConfigExport = config;
        const classes: string = cn('p-2', { 'p-4': true });
        void [valid, classes];
      `);
      const tsc = join(app, 'node_modules/typescript/bin/tsc');
      const flags = ['--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext'];
      await exec(node, [tsc, ...flags, join(directory, 'contract.ts')], options).catch((error: unknown) => {
        throw new Error(error instanceof Error && 'stdout' in error ? String(error.stdout) : String(error), { cause: error });
      });
      await writeFile(join(directory, 'invalid.ts'), `import type { WithoutChild, WithElementRef } from './utils.js';
        const withChild: WithoutChild<{ label: string; child?: string }> = { label: 'invalid', child: 'removed' };
        const wrongElement: WithElementRef<{ label: string }, HTMLButtonElement> = { label: 'invalid', ref: document.createElement('div') };
        void [withChild, wrongElement];
      `);
      const diagnostics = await exec(node, [tsc, ...flags, join(directory, 'invalid.ts')], options).then(
        () => { throw new Error('Generated utility types accepted forbidden children or an incompatible element ref.'); },
        (error: unknown) => {
          if (!(error instanceof Error) || !('stdout' in error)) throw error;
          return String(error.stdout);
        },
      );
      expect(diagnostics).toContain('TS2353');
      expect(diagnostics).toContain('TS2740');
      const result = await exec(node, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { createRequire } from 'node:module';
        import { readFileSync } from 'node:fs';
        import { loadConfigFromFile } from 'vite';
        import { cn } from './utils.mjs';
        const require = createRequire(process.cwd() + '/package.json');
        const vite = require('vite/package.json');
        const bits = JSON.parse(readFileSync('node_modules/bits-ui/package.json', 'utf8'));
        assert.equal(Number(vite.version.split('.')[0]), 8);
        assert.equal(Number(bits.version.split('.')[0]), 2);
        const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, process.cwd() + '/vite.config.ts');
        assert.ok(loaded);
        assert.equal(loaded.config.build.rolldownOptions.output.keepNames, true);
        assert.equal(loaded.config.build.rollupOptions, undefined);
        assert.equal(loaded.config.esbuild, undefined);
        assert.equal(cn('p-2', { 'p-4': true }), 'p-4');
        const warnings = [];
        const onwarn = loaded.config.build.rolldownOptions.onwarn;
        onwarn({ code: 'CIRCULAR_DEPENDENCY', message: 'fixture', ids: ['/node_modules/typebox/index.js'] }, value => warnings.push(value));
        assert.equal(warnings.length, 0);
        onwarn({ code: 'CIRCULAR_DEPENDENCY', message: 'application cycle', id: '/src/lib/app.ts' }, value => warnings.push(value));
        assert.equal(warnings.length, 1);
        console.log(JSON.stringify({ node: process.version, vite: vite.version, bits: bits.version }));
      `], options);
      const metadata = JSON.parse(result.stdout.trim());
      expect(semver.satisfies(metadata.node, manifest().engines.node)).toBe(true);
      expect(semver.satisfies(metadata.vite, manifest().devDependencies.vite)).toBe(true);
      expect(semver.satisfies(metadata.bits, manifest().dependencies['bits-ui'])).toBe(true);
      expect(metadata.node).toBe((await exec(node, ['-p', 'process.version'], options)).stdout.trim());
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('Generated app strict installation (opt-in registry integration)', () => {
  it.skipIf(!process.env.SVELAR_PACKAGE_INSTALL_SMOKE)('resolves peers, installs from its lockfile and audits an isolated CLI-generated app', async () => {
    const tarball = process.env.SVELAR_PACKAGE_TARBALL;
    if (!tarball) throw new Error('Set SVELAR_PACKAGE_TARBALL to an existing packed artifact; this test never builds or packs core.');
    const directory = await mkdtemp(join(tmpdir(), 'svelar-dependency-install-'));
    const artifact = resolve(tarball);
    const node = process.env.SVELAR_PACKAGE_NODE ?? process.execPath;
    try {
      const exec = promisify(execFile);
      await exec('tar', ['-xzf', artifact, '-C', directory]);
      await symlink(new URL('../../../node_modules', import.meta.url), join(directory, 'node_modules'), 'dir');
      // The existing CLI artifact generates the app; only its dependency manifest is replaced.
      await exec(node, [join(directory, 'package/dist/cli/bin.js'), 'new', 'dependency-smoke', '--no-install', '--validation=zod'], { cwd: directory, maxBuffer: 8 * 1024 * 1024 });
      const app = join(directory, 'dependency-smoke');
      const pkg = manifest();
      pkg.name = 'dependency-smoke';
      pkg.dependencies['@beeblock/svelar'] = 'file:' + artifact;
      await writeFile(join(app, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
      const options = { cwd: app, timeout: 180000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PATH: dirname(node) + ':' + process.env.PATH, CI: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } };
      await exec('npm', ['install', '--package-lock-only', '--strict-peer-deps', '--engine-strict', '--ignore-scripts', '--no-audit', '--no-fund'], options);
      await exec('npm', ['ci', '--strict-peer-deps', '--engine-strict', '--no-audit', '--no-fund'], options);
      await exec('npm', ['ls', '--all', '--json'], options);
      const { stdout } = await exec('npm', ['audit', '--audit-level=high', '--json'], options);
      const audit = JSON.parse(stdout);
      expect(audit.metadata.vulnerabilities.high).toBe(0);
      expect(audit.metadata.vulnerabilities.critical).toBe(0);
      const { stdout: runtime } = await exec(node, ['--input-type=module', '-e', `
        import { createRequire } from 'node:module';
        import assert from 'node:assert/strict';
        const requireApp = createRequire(process.cwd() + '/package.json');
        const { Meilisearch } = requireApp('meilisearch');
        const client = new Meilisearch({ host: 'http://127.0.0.1:1' });
        const index = client.index('contract');
        for (const method of ['search', 'addDocuments', 'deleteDocument', 'updateSettings', 'getDocuments']) assert.equal(typeof index[method], 'function');
        assert.equal(typeof client.tasks.waitForTask, 'function');
        const Sqlite = requireApp('better-sqlite3');
        const database = new Sqlite(':memory:');
        try { assert.deepEqual(database.prepare('SELECT 1 AS value').get(), { value: 1 }); }
        finally { database.close(); }
        console.log(process.version);
      `], options);
      const lock = JSON.parse(await readFile(join(app, 'package-lock.json'), 'utf8'));
      for (const name of ['vite', '@sveltejs/vite-plugin-svelte', '@sveltejs/kit', 'valibot', 'layerchart']) {
        expect(semver.satisfies(lock.packages['node_modules/' + name].version, { ...pkg.dependencies, ...pkg.devDependencies }[name]), name).toBe(true);
      }
      console.info('Strict scaffold install/audit passed:', JSON.stringify({ node: runtime.trim(), artifact, vulnerabilities: audit.metadata.vulnerabilities }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 420000);
});
