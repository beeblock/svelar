import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Container } from '../src/container/Container.js';
import { bootstrapPlugins } from '../src/plugins/BootstrapPlugins.js';

let originalCwd: string;
let tmpDir: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = join(originalCwd, `.test-plugins-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

function writePluginPackage(name: string, packageJson: Record<string, any>, pluginSource?: string) {
  const packageDir = join(tmpDir, 'node_modules', name);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);

  if (pluginSource) {
    writeFileSync(join(packageDir, 'plugin.js'), pluginSource);
  }

  expect(existsSync(packageDir)).toBe(true);
}

describe('bootstrapPlugins', () => {
  it('loads plugins from the required ./plugin export', async () => {
    writePluginPackage(
      'svelar-example',
      {
        name: 'svelar-example',
        version: '1.0.0',
        type: 'module',
        exports: {
          './plugin': {
            default: './plugin.js',
          },
        },
      },
      `export default class ExamplePlugin {
        name = 'svelar-example';
        version = '1.0.0';
        config() { return null; }
        listeners() { return []; }
        async register(app) {
          app.instance('plugin.loaded', true);
        }
        async boot() {}
      }`
    );

    const app = new Container();
    await bootstrapPlugins(app, ['svelar-example']);

    await expect(app.make('plugin.loaded')).resolves.toBe(true);
  });

  it('rejects plugin packages without an explicit ./plugin export', async () => {
    writePluginPackage(
      'svelar-main-only',
      {
        name: 'svelar-main-only',
        version: '1.0.0',
        type: 'module',
        main: './plugin.js',
      },
      `export default class MainOnlyPlugin {
        name = 'svelar-main-only';
        version = '1.0.0';
      }`
    );

    const app = new Container();

    await expect(bootstrapPlugins(app, ['svelar-main-only'])).rejects.toThrow(
      'must define exports["./plugin"].default'
    );
    await expect(app.make('plugin.loaded')).rejects.toThrow('No binding found');
  });
});
