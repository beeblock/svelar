import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const manifest = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const toolingRequire = createRequire(join(process.env.SVELAR_SECURITY_TOOLING_ROOT ?? join(root, 'packages/svelar-vscode'), 'package.json'));
function packageInfo(require: ReturnType<typeof createRequire>, name: string) {
  let directory = dirname(require.resolve(name));
  while (true) {
    const path = join(directory, 'package.json');
    if (existsSync(path)) {
      const data = manifest(path);
      if (data.name === name) return { path, manifest: data };
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Missing manifest for ${name}.`);
    directory = parent;
  }
}
const vsceInfo = packageInfo(toolingRequire, '@vscode/vsce');
const vsceRequire = createRequire(vsceInfo.path);
const semver = vsceRequire('semver');
afterEach(() => { vi.restoreAllMocks(); });

describe('Security dependency graph', () => {
  it('owns QA tools at the root so scoped npm overrides survive workspace resolution', () => {
    const pkg = manifest(join(root, 'package.json'));
    expect(pkg.devDependencies).toMatchObject({ '@vscode/vsce': '^4.1.1', exceljs: '^4.4.0', vite: '^8.3.4', typescript: '^6.0.3' });
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.overrides['@vscode/vsce']).toEqual({ minimatch: '^11.0.1' });
    expect(pkg.overrides.exceljs).toEqual({ uuid: '^11.1.1' });
    expect(pkg.overrides.minimatch).toBeUndefined();
    expect(manifest(join(root, 'packages/svelar/package.json')).description).toBe('Laravel-inspired framework on top of SvelteKit');
  });

  it('declares the tested build-tool Node range without odd-major or early-24 gaps', () => {
    const pkg = manifest(join(root, 'package.json'));
    expect(pkg.engines.node).toBe('^22.18.0 || ^24.11.0 || >=26.0.0');
    for (const version of ['22.18.0', '24.11.0', '26.0.0']) expect(semver.satisfies(version, pkg.engines.node)).toBe(true);
    for (const version of ['22.17.0', '23.11.0', '24.10.0', '25.0.0']) expect(semver.satisfies(version, pkg.engines.node)).toBe(false);
    const core = manifest(join(root, 'packages/svelar/package.json'));
    expect(core.devDependencies['@types/node']).toBe('^22.20.5');
    expect(core.devDependencies.typescript).toBe('^6.0.3');
    expect(core.engines.node).toBe('>=22.12.0');
  });

  it('locks only patched advisory branches and matches the new root declarations', () => {
    const pkg = manifest(join(root, 'package.json'));
    const lock = manifest(join(root, 'package-lock.json'));
    expect(lock.packages[''].devDependencies).toEqual(pkg.devDependencies);
    expect(lock.packages[''].engines).toEqual(pkg.engines);
    const ranges: Record<string, string> = {
      vite: '>=8.3.4 <9', joi: '>=17.13.9 <18 || >=18.3.1 <19',
      '@azure/identity': '>=4.14.1 <5', '@azure/msal-node': '>=7.1.0 <8', qs: '>=6.16.1 <7',
      minimatch: '<7 || >=11.0.1',
    };
    for (const [name, range] of Object.entries(ranges)) {
      const entries = Object.entries(lock.packages).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
      expect(entries.length, name).toBeGreaterThan(0);
      for (const [path, data] of entries) expect(semver.satisfies((data as any).version, range), path).toBe(true);
    }
  });

  it('uses patched Joi 18 in every installed declaring workspace without forcing Superforms off its safe Joi 17 branch', () => {
    const pkg = manifest(join(root, 'package.json'));
    for (const workspace of pkg.workspaces) {
      const path = join(root, workspace, 'package.json');
      // Optional plugin checkouts are absent from the tracked core-only CI snapshot.
      if (!existsSync(path)) continue;
      const data = manifest(path);
      if (!data.devDependencies?.joi) continue;
      expect(data.devDependencies.joi, workspace).toBe('^18.3.1');
      const require = createRequire(path);
      const Joi = require('joi');
      expect(semver.satisfies(Joi.version, '>=18.3.1 <19'), workspace).toBe(true);
      const schema = Joi.string().email({ multiple: true, separator: ';', tlds: { allow: false } });
      expect(schema.validate('alice@example.test; bob@example.test').error, workspace).toBeUndefined();
      expect(schema.validate('alice@example.test; invalid').error, workspace).toBeDefined();
    }
    const forms = createRequire(join(root, 'packages/svelar/package.json'));
    const formsRequire = createRequire(packageInfo(forms, 'sveltekit-superforms').path);
    expect(semver.satisfies(formsRequire('joi').version, '>=17.13.9 <18')).toBe(true);
  });
});

describe('CommonJS tooling compatibility', () => {
  it('runs real VSCE file selection with patched minimatch, including ignores and explicit re-inclusion', async () => {
    const minimatch = vsceRequire('minimatch');
    expect(semver.satisfies(packageInfo(vsceRequire, 'minimatch').manifest.version, '>=11.0.1 <12')).toBe(true);
    expect(minimatch.minimatch('dist/extension.js', '**/*.js', { dot: true })).toBe(true);
    const vsce = toolingRequire('@vscode/vsce');
    const directory = await mkdtemp(join(tmpdir(), 'svelar-vsce-filter-'));
    try {
      const files: Record<string, string> = {
        'package.json': JSON.stringify({ name: 'security-fixture', version: '1.0.0', publisher: 'fixture',
          displayName: 'Security Fixture', description: 'Fixture', engines: { vscode: '^1.85.0' }, main: './dist/extension.js', activationEvents: ['onStartupFinished'] }),
        'README.md': '# Fixture\n',
        '.vscodeignore': 'src/**\ndist/**\n!dist/extension.js\n.private/**\n*.secret\n',
        'dist/extension.js': 'exports.activate = () => {};\n', 'dist/extension.js.map': '{}',
        'src/extension.ts': 'export {};\n', '.private/credentials.txt': 'fixture only', 'credentials.secret': 'fixture only',
      };
      for (const [name, contents] of Object.entries(files)) {
        const path = join(directory, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, contents);
      }
      const found = await vsce.listFiles({ cwd: directory, packageManager: vsce.PackageManager.None });
      expect(found.map((path: string) => path.replaceAll('\\', '/')).sort()).toEqual(['README.md', 'dist/extension.js', 'package.json']);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('loads ExcelJS UUID via CommonJS and round-trips workbook conditional formatting with the existing scoped override', async () => {
    const excelInfo = packageInfo(toolingRequire, 'exceljs');
    const excelRequire = createRequire(excelInfo.path);
    expect(semver.satisfies(packageInfo(excelRequire, 'uuid').manifest.version, '>=11.1.1 <12')).toBe(true);
    const uuid = excelRequire('uuid');
    expect(uuid.validate(uuid.v4())).toBe(true);
    expect(() => uuid.v6({}, new Uint8Array(8), 4)).toThrow(RangeError);
    const ExcelJS = toolingRequire('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');
    sheet.addRows([['Total'], [10], [20]]);
    sheet.addConditionalFormatting({ ref: 'A2:A3', rules: [{ type: 'dataBar', gradient: false,
      cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF00CC00' } }] });
    const buffer = await workbook.xlsx.writeBuffer();
    expect(sheet.conditionalFormattings[0].rules[0].x14Id).toMatch(/^\{[0-9A-F-]{36}\}$/);
    const imported = new ExcelJS.Workbook();
    await imported.xlsx.load(buffer);
    expect(imported.getWorksheet('Report').getCell('A3').value).toBe(20);
  });

  it('uses upstream-patched Azure/MSAL and strips untrusted authorization-code response parameters', async () => {
    const identityInfo = packageInfo(vsceRequire, '@azure/identity');
    expect(semver.satisfies(identityInfo.manifest.version, '>=4.14.1 <5')).toBe(true);
    const identityRequire = createRequire(identityInfo.path);
    expect(semver.satisfies(packageInfo(identityRequire, '@azure/msal-node').manifest.version, '>=7.1.0 <8')).toBe(true);
    const { ConfidentialClientApplication } = identityRequire('@azure/msal-node');
    const base = Object.getPrototypeOf(ConfidentialClientApplication.prototype);
    const exchange = vi.spyOn(base, 'acquireTokenByCode').mockResolvedValue({ accessToken: 'fixture' });
    const client = new ConfidentialClientApplication({ auth: { clientId: 'fixture', clientSecret: 'fixture' } });
    const request = { code: 'trusted-code', nonce: 'trusted-nonce', redirectUri: 'https://application.invalid/callback' };
    await client.acquireTokenByCode(request, { code: 'untrusted-code', nonce: 'untrusted-nonce', state: 'expected-state',
      cloud_instance_host_name: 'attacker.invalid', token_endpoint: 'https://attacker.invalid/token' });
    expect(exchange).toHaveBeenCalledWith(request, { code: 'trusted-code', nonce: 'trusted-nonce', state: 'expected-state' });
  });

  it('keeps typed-rest-client query serialization on patched qs and accepts hostile comma-array elements without crashing', () => {
    const restRequire = createRequire(packageInfo(vsceRequire, 'typed-rest-client').path);
    expect(semver.satisfies(packageInfo(restRequire, 'qs').manifest.version, '>=6.16.1 <7')).toBe(true);
    const qs = restRequire('qs');
    expect(qs.stringify({ a: ['one', 'two'] }, { arrayFormat: 'comma' })).toBe('a=one%2Ctwo');
    for (const encodeValuesOnly of [true, false]) {
      expect(() => qs.stringify({ a: [{ toString: 'not callable' }] }, { arrayFormat: 'comma', encodeValuesOnly })).not.toThrow();
    }
  });
});
