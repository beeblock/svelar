import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../src/database/Connection.js';
import { MigrateCommand } from '../src/cli/commands/MigrateCommand.js';

describe('MigrateCommand', () => {
  let originalCwd: string;
  let root: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    root = await mkdtemp(join(tmpdir(), 'svelar-cli-migrate-'));
    process.chdir(root);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    delete (globalThis as any).__svelarSeedRan;
    vi.restoreAllMocks();
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });

  it('runs the default seeder after migrations when --seed is provided', async () => {
    const migrationsDir = join(root, 'src/lib/database/migrations');
    const seedersDir = join(root, 'src/lib/database/seeders');
    await mkdir(migrationsDir, { recursive: true });
    await mkdir(seedersDir, { recursive: true });

    await writeFile(
      join(root, 'svelar.database.json'),
      JSON.stringify({
        default: 'sqlite',
        connections: {
          sqlite: {
            driver: 'sqlite',
            filename: join(root, 'database.sqlite'),
          },
        },
      }),
    );

    await writeFile(
      join(migrationsDir, '20260101000000_create_widgets_table.ts'),
      `export default class CreateWidgetsTable {
  async up() {}
  async down() {}
}
`,
    );

    await writeFile(
      join(seedersDir, 'DatabaseSeeder.ts'),
      `export default class DatabaseSeeder {
  async run() {
    globalThis.__svelarSeedRan = (globalThis.__svelarSeedRan ?? 0) + 1;
  }
}
`,
    );

    await new MigrateCommand().handle([], { seed: true });

    expect((globalThis as any).__svelarSeedRan).toBe(1);
  });
});
