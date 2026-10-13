import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import { transformSync } from 'esbuild';
import { MakeUiCommand } from '../src/cli/commands/MakeUiCommand.js';
import { UiPatternTemplates, uiPatternNames } from '../src/cli/commands/UiPatternTemplates.js';
import { PermissionManifest } from '../src/permissions/PermissionManifest.js';

function helpers() {
  const module: { exports: Record<string, (...args: any[]) => any> } = { exports: {} };
  const output = transformSync(UiPatternTemplates.helpers('$lib/components/patterns'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  new Function('module', output)(module);
  return module.exports;
}

describe('Optional operational UI templates', () => {
  it.each(uiPatternNames)('compiles %s for client/server without accessibility warnings', (pattern) => {
    const file = UiPatternTemplates.files([pattern], true).find((file) => file.path.endsWith('.svelte'))!;
    for (const generate of ['client', 'server'] as const) {
      const result = compile(file.content, { filename: file.path, generate });
      expect(result.warnings.filter((warning) => warning.code.startsWith('a11y') || warning.code === 'state_referenced_locally')).toEqual([]);
    }
    expect(file.content).not.toContain('fetch(');
    expect(file.content).not.toContain('toast(');
    expect(file.content).not.toContain('@beeblock/svelar/ui');
    expect(file.content).toContain('$lib/components/ui/');
  });

  it('keeps DDD/flat aliases and partial selections self-contained', () => {
    for (const ddd of [true, false]) {
      const files = UiPatternTemplates.files(['select'], ddd);
      expect(files).toHaveLength(3);
      expect(files.map((file) => file.path.split('/').pop())).toEqual(['contracts.ts', 'helpers.ts', 'SearchableSelect.svelte']);
      expect(files[2].content).toContain(ddd ? '$lib/shared/components/patterns/contracts.js' : '$lib/components/patterns/contracts.js');
      expect(files.some((file) => file.path.includes('/routes/'))).toBe(false);
    }
  });

  it('preserves URL state, handles disabled tabs, and bounds server table query data', () => {
    const h = helpers();
    const url = new URL('https://app.test/records?team=one&tab=disabled&page=-1&perPage=500&sort=unknown&direction=invalid#detail');
    const tabs = [{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }, { value: 'disabled', label: 'Disabled', disabled: true }];
    expect(h.tabValue(url, tabs)).toBe('first');
    expect(h.tabUrl(url, 'second').searchParams.get('team')).toBe('one');
    expect(h.tabUrl(url, 'second').hash).toBe('#detail');
    expect(h.tableQuery(url, ['name'])).toMatchObject({ page: 1, perPage: 25, sort: '', direction: 'asc' });
    const next = h.tableUrl(url, { page: 2, perPage: 25, sort: 'name', direction: 'desc', search: '' });
    expect(next.searchParams.get('team')).toBe('one');
    expect(next.hash).toBe('#detail');
    expect(url.searchParams.get('page')).toBe('-1');
    expect(() => h.tabValue(url, [{ value: 'one', label: 'One', disabled: true }])).toThrow();
  });

  it.each(['https://foreign.test', '//foreign.test', '/%2Fforeign.test', '/%5Cforeign.test', '/%0Aforeign.test', '/bad%'])('rejects unsafe operation return links (%s)', (value) => {
    expect(helpers().operationHref(value)).toBeNull();
  });

  it('uses real operation progress without inventing completion or retry controls', () => {
    const h = helpers();
    expect(h.operationHref('/reports?id=2#ready')).toBe('/reports?id=2#ready');
    expect(h.operationHref('/reports/New%20Report')).toBe('/reports/New%20Report');
    expect(h.operationProgress(5, 10)).toBe(50);
    expect(h.operationProgress(50, 10)).toBe(100);
    expect(h.operationProgress(-1, 10)).toBe(0);
    expect(h.operationProgress(0, null)).toBeNull();
    expect(h.operationProgress(NaN, 10)).toBeNull();
    const template = UiPatternTemplates.operationTray('$lib/components/patterns');
    expect(template).toContain("onretry && operation.state === 'failed'");
    expect(template).toContain('cancelRequested');
    expect(template).toContain('pending.includes(operation.id)');
  });

  it('uses the central manifest dependency catalog and never includes platform grants in team choices', () => {
    const manifest = new PermissionManifest({
      screens: [{ resource: 'users', label: 'Users', group: 'Security', route: '/users', scope: 'team' },
        { resource: 'audit', label: 'Audit', group: 'Security', route: '/audit', scope: 'team' },
        { resource: 'platform', label: 'Platform', group: 'Platform', route: '/admin', scope: 'platform' }],
      actions: [{ screen: 'users', action: 'edit', label: 'Edit' }, { screen: 'users', action: 'export', label: 'Export', dependencies: ['screen.audit.view'] }],
    });
    const h = helpers();
    const catalog = h.scopedCatalog(manifest.capabilities(), 'team');
    expect(catalog.some((item: { scope: string }) => item.scope === 'platform')).toBe(false);
    const selected = h.toggleCapabilities(catalog, [], ['action.users.export'], true);
    expect(selected).toEqual(manifest.expandDependencies(['action.users.export'], 'team').sort());
    expect(h.toggleCapabilities(catalog, selected, ['screen.audit.view'], false)).toEqual(['screen.users.view']);
    expect(() => h.toggleCapabilities(catalog, [], ['screen.platform.view'], true)).toThrow('scope');
    expect(h.toggleCapabilities(catalog, ['old.orphan'], ['action.users.edit'], true)).toContain('old.orphan');
  });

  it('preserves system profile override semantics and explicit stale values', () => {
    const manifest = new PermissionManifest({ screens: [{ resource: 'users', label: 'Users', group: 'Users', route: '/users', scope: 'team' }],
      actions: [{ screen: 'users', action: 'edit', label: 'Edit' }] });
    const h = helpers();
    const defaults = ['screen.users.view', 'action.users.edit'];
    expect(h.profileSelection(defaults, ['action.users.edit'], [])).toEqual(['screen.users.view']);
    expect(h.profileOverrides(manifest.capabilities('team'), ['screen.users.view'], defaults, { inclusions: ['old.inclusion'], exclusions: ['old.exclusion'] })).toEqual({
      inclusions: ['old.inclusion'], exclusions: ['action.users.edit', 'old.exclusion'],
    });
    const template = UiPatternTemplates.capabilityEditor('$lib/components/patterns');
    expect(template).toContain('Unavailable capabilities');
    expect(template).toContain('Legacy permissions');
    expect(template).toContain("scope = 'team'");
  });
});

describe.sequential('make:ui generator boundaries', () => {
  let cwd: string; let root: string;
  beforeEach(async () => {
    cwd = process.cwd(); root = await mkdtemp(join(tmpdir(), 'svelar-ui-patterns-')); process.chdir(root);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => { process.chdir(cwd); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
  async function installComponents() {
    for (const name of UiPatternTemplates.shadcnComponents(uiPatternNames)) {
      const path = join(root, 'src/lib/components/ui', name); await mkdir(path, { recursive: true }); await writeFile(join(path, 'index.ts'), 'export {};\n');
    }
  }

  it('requires real generated shadcn dependencies before writing anything', async () => {
    await expect(new MakeUiCommand().handle(['select'], {})).rejects.toThrow('npm run ui:install');
    await expect(readFile(join(root, 'src/lib/components/patterns/contracts.ts'), 'utf8')).rejects.toThrow();
  });

  it.each(['../outside', 'unknown', 'select,../../outside'])('rejects unknown/traversing selections (%s)', async (name) => {
    await expect(new MakeUiCommand().handle([name], {})).rejects.toThrow('Unknown UI pattern');
  });

  it('generates partial flat patterns and preserves edited components until explicitly forced', async () => {
    await installComponents();
    const command = new MakeUiCommand(); await command.handle(['select'], {});
    const path = join(root, 'src/lib/components/patterns/SearchableSelect.svelte');
    await writeFile(path, '<p>App-owned selection</p>\n');
    await command.handle(['select'], {});
    expect(await readFile(path, 'utf8')).toBe('<p>App-owned selection</p>\n');
    await command.handle(['select'], { force: true });
    expect(await readFile(path, 'utf8')).toContain('Popover.Root');
    await command.handle(['dialog'], {});
    expect(await readFile(join(root, 'src/lib/components/patterns/ResponsiveDialog.svelte'), 'utf8')).toContain('Dialog.Root');
  });

  it('generates DDD patterns without putting them inside the shadcn ownership directory', async () => {
    await installComponents(); await mkdir(join(root, 'src/lib/modules'), { recursive: true });
    await new MakeUiCommand().handle(['all'], {});
    expect(await readFile(join(root, 'src/lib/shared/components/patterns/CapabilityEditor.svelte'), 'utf8')).toContain('scopedCatalog');
  });

  it('fails before writes if shared contracts were customized', async () => {
    await installComponents(); const command = new MakeUiCommand(); await command.handle(['select'], {});
    await writeFile(join(root, 'src/lib/components/patterns/contracts.ts'), 'export interface AppContract {}\n');
    await expect(command.handle(['dialog'], {})).rejects.toThrow('Shared pattern contracts differ');
    await expect(readFile(join(root, 'src/lib/components/patterns/ResponsiveDialog.svelte'), 'utf8')).rejects.toThrow();
  });

  it('rejects output symlink escapes before touching external directories', async () => {
    await installComponents(); const outside = await mkdtemp(join(tmpdir(), 'svelar-ui-outside-'));
    try {
      await symlink(outside, join(root, 'src/lib/components/patterns'));
      await expect(new MakeUiCommand().handle(['select'], { force: true })).rejects.toThrow('symlink');
      await expect(readFile(join(outside, 'contracts.ts'), 'utf8')).rejects.toThrow();
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});
