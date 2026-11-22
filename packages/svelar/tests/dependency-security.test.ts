import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';

const require = createRequire(import.meta.url);
const consumerRequire = process.env.SVELAR_SECURITY_CONSUMER
  ? createRequire(join(process.env.SVELAR_SECURITY_CONSUMER, 'package.json'))
  : require;

describe('Dependency Security Compatibility', () => {
  it.each(['zod', 'valibot'] as const)('keeps narrow security overrides in %s scaffolds', (provider) => {
    const manifest = JSON.parse(NewCommandTemplates.packageJson('security-test', '0.8.0', provider));
    expect(manifest.overrides).toEqual({
      exceljs: { uuid: '^11.1.1' },
      'esbuild@>=0.27.3 <0.28.1': '^0.28.2',
    });
    expect(manifest.devDependencies['@sveltejs/kit']).toBe('^3.4.0');
    const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(root.overrides['@sveltejs/kit']).toEqual({ 'cookie@^0.6.0': '^0.7.2' });
    expect(root.overrides['@sveltejs/kit@^2']).toBeUndefined();
  });

  it('qualifies legacy cookies in every available workspace without overriding Kit 3 cookies', () => {
    const rootUrl = new URL('../../../', import.meta.url);
    const root = JSON.parse(readFileSync(new URL('package.json', rootUrl), 'utf8'));
    for (const workspace of root.workspaces) {
      const path = new URL(`${workspace}/package.json`, rootUrl);
      // Local plugin checkouts are optional in the tracked core-only CI snapshot.
      if (!existsSync(path)) continue;
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      if (workspace === 'packages/svelar') {
        expect(manifest.overrides).toBeUndefined();
        continue;
      }
      expect(manifest.overrides['@sveltejs/kit'], workspace).toEqual({ 'cookie@^0.6.0': '^0.7.2' });
      expect(manifest.overrides['@sveltejs/kit@^2'], workspace).toBeUndefined();
      expect(manifest.overrides.cookie, workspace).toBeUndefined();
    }
    expect(root.overrides.cookie).toBeUndefined();
  });

  it('serializes, parses, and deletes session cookies through the real Kit cookie API', async () => {
    let hooks: { deregister(): void } | undefined;
    try {
      vi.stubGlobal('__SVELTEKIT_DEV__', false);
      vi.stubGlobal('__SVELTEKIT_PATHS_BASE__', '');
      vi.stubGlobal('__SVELTEKIT_PATHS_ASSETS__', '');
      vi.stubGlobal('__SVELTEKIT_APP_DIR__', '_app');
      vi.stubGlobal('__SVELTEKIT_PATHS_RELATIVE__', false);
      const kitRoot = dirname(consumerRequire.resolve('@sveltejs/kit/package.json'));
      const moduleUrl = pathToFileURL(join(kitRoot, 'src/runtime/server/cookie.js')).href;
      const kit = JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8'));
      // Kit 3 compile bindings only; cookie parsing and serialization remain real implementations.
      hooks = kit.version.startsWith('3.') ? (await import('node:module')).registerHooks({
        resolve(specifier, context, nextResolve) {
          return specifier === '<sveltekit:generated>/server.js'
            ? { url: 'data:text/javascript,export async function get_hooks() { return {}; }', shortCircuit: true }
            : nextResolve(specifier, context);
        },
      }) : undefined;
      const { get_cookies } = await import(/* @vite-ignore */ moduleUrl);
      const url = new URL('https://app.example.test/account');
      const runtime = get_cookies(new Request(url), url);
      runtime.set_trailing_slash('ignore');
      const value = 'session-id.signature+/=';
      const options = { path: '/', maxAge: 7200, secure: true, httpOnly: true, sameSite: 'lax' };
      runtime.cookies.set('svelar_session', value, options);
      const header = runtime.cookies.serialize('svelar_session', value, options);
      expect(header).toContain('Max-Age=7200');
      expect(header).toContain('Path=/');
      expect(header).toContain('HttpOnly; Secure; SameSite=Lax');
      const next = get_cookies(new Request(url, { headers: { cookie: header.split(';')[0] } }), url);
      next.set_trailing_slash('ignore');
      expect(next.cookies.get('svelar_session')).toBe(value);
      next.cookies.delete('svelar_session', { path: '/' });
      expect(next.cookies.get('svelar_session')).toBeUndefined();
    } finally {
      try { hooks?.deregister(); }
      finally { vi.unstubAllGlobals(); }
    }
  });

  it('rejects cookie attribute injection through the installed Kit cookie serializer', async () => {
    const kitRequire = createRequire(consumerRequire.resolve('@sveltejs/kit/package.json'));
    const cookie = await import(/* @vite-ignore */ pathToFileURL(kitRequire.resolve('cookie')).href);
    const kit = JSON.parse(readFileSync(consumerRequire.resolve('@sveltejs/kit/package.json'), 'utf8'));
    const kitMajor = Number(kit.version.split('.')[0]);
    expect([2, 3]).toContain(kitMajor);
    const serializer = kitMajor === 3 ? cookie.stringifySetCookie : cookie.serialize;
    expect(typeof serializer).toBe('function');
    const serialize = (name: string, value: string, options: Record<string, unknown> = {}) => kitMajor === 3
      ? serializer({ name, value, ...options }) : serializer(name, value, options);
    for (const separator of [';', '\r', '\n']) {
      expect(() => serialize(`name${separator} injected=value`, 'value')).toThrow(TypeError);
      expect(() => serialize('name', 'value', { path: `/${separator} injected=value` })).toThrow(TypeError);
      expect(() => serialize('name', 'value', { domain: `example.test${separator} injected=value` })).toThrow(TypeError);
    }
  });

  it('loads ExcelJS UUID through CommonJS and writes extended conditional formatting', async () => {
    const excelRequire = createRequire(consumerRequire.resolve('exceljs/package.json'));
    const { v4, validate } = excelRequire('uuid');
    expect(validate(v4())).toBe(true);
    const ExcelJS = consumerRequire('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');
    sheet.addRows([['Total'], [10], [20]]);
    sheet.addConditionalFormatting({
      ref: 'A2:A3',
      rules: [{ type: 'dataBar', gradient: false, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF00CC00' } }],
    });
    const buffer = await workbook.xlsx.writeBuffer();
    expect(sheet.conditionalFormattings[0].rules[0].x14Id).toMatch(/^\{[0-9A-F-]{36}\}$/);
    const imported = new ExcelJS.Workbook();
    await imported.xlsx.load(buffer);
    expect(imported.getWorksheet('Report').getCell('A3').value).toBe(20);
  });

  it('rejects undersized UUID output buffers with the installed override', () => {
    const excelRequire = createRequire(consumerRequire.resolve('exceljs/package.json'));
    const { v3, v5, v6 } = excelRequire('uuid');
    const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    expect(() => v3('report', namespace, new Uint8Array(8), 4)).toThrow(RangeError);
    expect(() => v5('report', namespace, new Uint8Array(8), 4)).toThrow(RangeError);
    expect(() => v6({}, new Uint8Array(8), 4)).toThrow(RangeError);
  });

  it('round-trips normal and streaming workbooks through the public Excel API', async () => {
    const packagePath = consumerRequire.resolve('@beeblock/svelar/package.json');
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
    const { Excel } = process.env.SVELAR_SECURITY_CONSUMER
      ? await import(/* @vite-ignore */ pathToFileURL(join(dirname(packagePath), manifest.exports['./excel'].import)).href)
      : await import('../src/excel/index.js');
    const sheets = [{ name: 'Report', columns: [{ header: 'Total', key: 'total' }], rows: [{ total: 10 }, { total: 20 }] }];
    const expected = [{ Total: 10 }, { Total: 20 }];
    const exported = await Excel.export({ sheets });
    expect(await Excel.import(exported)).toEqual(expected);
    const streamed = await Excel.stream({
      sheets: [{ ...sheets[0], rows: async function* () { yield* sheets[0].rows; } }],
    });
    const directory = await mkdtemp(join(tmpdir(), 'svelar-security-excel-'));
    try {
      const file = join(directory, 'report.xlsx');
      await writeFile(file, streamed);
      const rows: Record<string, number>[] = [];
      await Excel.importStream(file, { onRow: (row: Record<string, number>) => { rows.push(row); } });
      expect(rows).toEqual(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
