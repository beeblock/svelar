import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Plugin } from '../src/plugins/index.js';
import { PluginPublisher } from '../src/plugins/PluginPublisher.js';

let originalCwd: string;
let root: string;

class PublishablePlugin extends Plugin {
  name = 'publishable-plugin';
  version = '1.0.0';

  constructor(private sourcePath: string) {
    super();
  }

  publishables() {
    return {
      config: [
        {
          source: this.sourcePath,
          dest: 'config/publishable-plugin.ts',
          type: 'config' as const,
        },
      ],
    };
  }
}

beforeEach(async () => {
  originalCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'svelar-plugin-publisher-'));
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(root, { recursive: true, force: true });
});

describe('PluginPublisher', () => {
  it('publishes plugin files and returns published paths', async () => {
    const sourceDir = join(root, 'plugin');
    await mkdir(sourceDir, { recursive: true });
    const sourcePath = join(sourceDir, 'config.ts');
    await writeFile(sourcePath, 'export default {};', 'utf-8');

    const result = await PluginPublisher.publish(new PublishablePlugin(sourcePath));

    expect(await realpath(result.configs[0])).toBe(await realpath(join(root, 'config/publishable-plugin.ts')));
    expect(result.migrations).toEqual([]);
    expect(result.assets).toEqual([]);
  });

  it('throws when a publishable source file cannot be copied', async () => {
    const missingSource = join(root, 'plugin/missing-config.ts');

    await expect(PluginPublisher.publish(new PublishablePlugin(missingSource))).rejects.toThrow();
  });
});
