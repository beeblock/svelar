import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SearchSetupCommand } from '../src/cli/commands/SearchSetupCommand.js';

declare global {
  // eslint-disable-next-line no-var
  var __svelarSearchSetupCalls: any[] | undefined;
}

describe('SearchSetupCommand', () => {
  let originalCwd: string;
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = join(originalCwd, `.test-search-setup-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    process.chdir(tmpDir);
    globalThis.__svelarSearchSetupCalls = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
    globalThis.__svelarSearchSetupCalls = undefined;
    vi.restoreAllMocks();
  });

  it('warns when no searchable models are discovered', async () => {
    const cmd = new SearchSetupCommand();

    await cmd.handle([], {});

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No Searchable models found'));
  });

  it('applies conventional static search index settings', async () => {
    const modelsDir = join(tmpDir, 'src', 'lib', 'models');
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(
      join(modelsDir, 'Post.js'),
      `export class Post {
        static searchIndexSettings = {
          searchableAttributes: ['title', 'content'],
          filterableAttributes: ['status'],
        };
        static async configureSearchIndex(settings) {
          globalThis.__svelarSearchSetupCalls.push(['configure', settings]);
        }
        static async makeAllSearchable() {
          globalThis.__svelarSearchSetupCalls.push(['makeAll']);
          return { indexed: 0 };
        }
      }`
    );

    const cmd = new SearchSetupCommand();
    await cmd.handle([], {});

    expect(globalThis.__svelarSearchSetupCalls).toEqual([
      [
        'configure',
        {
          searchableAttributes: ['title', 'content'],
          filterableAttributes: ['status'],
        },
      ],
    ]);
  });

  it('supports fresh reindexing discovered DDD models', async () => {
    const modelsDir = join(tmpDir, 'src', 'lib', 'modules', 'posts');
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(
      join(modelsDir, 'Post.js'),
      `export default class Post {
        static async searchSettings() {
          return { sortableAttributes: ['created_at'] };
        }
        static async configureSearchIndex(settings) {
          globalThis.__svelarSearchSetupCalls.push(['configure', settings]);
        }
        static async removeAllFromSearch() {
          globalThis.__svelarSearchSetupCalls.push(['removeAll']);
        }
        static async makeAllSearchable(batchSize) {
          globalThis.__svelarSearchSetupCalls.push(['makeAll', batchSize]);
          return { indexed: 3 };
        }
      }`
    );

    const cmd = new SearchSetupCommand();
    await cmd.handle([], { fresh: true, 'batch-size': '250' });

    expect(globalThis.__svelarSearchSetupCalls).toEqual([
      ['configure', { sortableAttributes: ['created_at'] }],
      ['removeAll'],
      ['makeAll', 250],
    ]);
  });
});
