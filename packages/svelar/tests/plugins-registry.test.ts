import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginRegistry } from '../src/plugins/PluginRegistry.js';
import { normalizePluginPackageSpec } from '../src/plugins/PluginInstaller.js';

let originalCwd: string;
let root: string;

async function writePackage(packageName: string, packageJson: Record<string, any>): Promise<void> {
  const packageDir = join(root, 'node_modules', ...packageName.split('/'));
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf-8');
}

beforeEach(async () => {
  originalCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'svelar-plugin-registry-'));
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(root, { recursive: true, force: true });
});

describe('PluginRegistry', () => {
  it('discovers svelar-prefixed plugin packages', async () => {
    await writePackage('svelar-prefixed', {
      name: 'svelar-prefixed',
      version: '1.2.3',
      description: 'Prefixed plugin',
    });

    const discovered = await PluginRegistry.discover();

    expect(discovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'svelar-prefixed',
          packageName: 'svelar-prefixed',
          version: '1.2.3',
        }),
      ])
    );
  });

  it('discovers keyword-only plugins that do not use the svelar package prefix', async () => {
    await writePackage('@acme/payments', {
      name: '@acme/payments',
      version: '2.0.0',
      description: 'Payments plugin',
      keywords: ['svelar-plugin'],
      svelar: {
        config: true,
        migrations: true,
      },
    });

    const discovered = await PluginRegistry.discover();

    expect(discovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '@acme/payments',
          packageName: '@acme/payments',
          version: '2.0.0',
          hasConfig: true,
          hasMigrations: true,
        }),
      ])
    );
  });

  it('persists enabled plugins so separate CLI processes report the same status', async () => {
    await writePackage('@beeblock/svelar-datatable', {
      name: '@beeblock/svelar-datatable',
      version: '0.2.0',
      description: 'Datatable plugin',
      keywords: ['svelar-plugin'],
    });

    await PluginRegistry.discover();
    PluginRegistry.enable('@beeblock/svelar-datatable');

    expect(JSON.parse(readFileSync(join(root, 'svelar.plugins.json'), 'utf-8'))).toEqual({
      enabled: ['@beeblock/svelar-datatable'],
    });

    const discovered = await PluginRegistry.discover();

    expect(discovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '@beeblock/svelar-datatable',
          enabled: true,
        }),
      ])
    );
  });
});

describe('PluginInstaller', () => {
  it('normalizes versioned npm package specs before matching discovered plugins', () => {
    expect(normalizePluginPackageSpec('@beeblock/svelar-datatable@0.2.0')).toBe(
      '@beeblock/svelar-datatable'
    );
    expect(normalizePluginPackageSpec('@beeblock/svelar-datatable@latest')).toBe(
      '@beeblock/svelar-datatable'
    );
    expect(normalizePluginPackageSpec('svelar-datatable@0.2.0')).toBe('svelar-datatable');
    expect(normalizePluginPackageSpec('svelar-datatable')).toBe('svelar-datatable');
  });
});
