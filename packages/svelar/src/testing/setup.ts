/**
 * Test setup utilities.
 *
 * `useSvelarTest()` wires up beforeEach/afterEach hooks automatically.
 * `refreshDatabase()` drops all tables and re-runs migrations.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Connection } from '../database/Connection.js';
import { Migrator, type MigrationFile } from '../database/Migration.js';
import { Factory } from './Factory.js';

export interface UseSvelarTestOptions {
  /** When true, calls refreshDatabase() before each test. Default: false */
  refreshDatabase?: boolean;
  /** Database connection name to use. Default: undefined (uses default) */
  connectionName?: string;
}

/**
 * Wire up the Svelar test environment in a describe block.
 *
 * Call this at the top of a `describe()` block:
 *
 * ```ts
 * describe('UserService', () => {
 *   useSvelarTest({ refreshDatabase: true });
 *   // ...
 * });
 * ```
 *
 * Automatically:
 * - Configures an in-memory SQLite database
 * - Resets factory sequences between tests
 * - Optionally runs refreshDatabase() before each test
 */
export function useSvelarTest(options: UseSvelarTestOptions = {}): void {
  // We reference Vitest globals (beforeAll, beforeEach, afterEach)
  // which are available when vitest is configured with globals: true.
  const _beforeAll = (globalThis as any).beforeAll;
  const _beforeEach = (globalThis as any).beforeEach;
  const _afterEach = (globalThis as any).afterEach;

  if (!_beforeAll || !_beforeEach) {
    throw new Error(
      'useSvelarTest() requires Vitest globals. Set `globals: true` in vitest.config.ts.',
    );
  }

  _beforeAll(async () => {
    // Configure in-memory SQLite for test isolation
    try {
      Connection.getDriver();
    } catch {
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: {
            driver: 'sqlite',
            filename: ':memory:',
          },
        },
      });
    }
  });

  _beforeEach(async () => {
    Factory.resetSequence();
    if (options.refreshDatabase) {
      await refreshDatabase(options.connectionName);
    }
  });
}

/**
 * Drop all tables and re-run all migrations from the project's
 * `src/lib/database/migrations/` directory.
 */
export async function refreshDatabase(connectionName?: string): Promise<void> {
  const migrator = new Migrator(connectionName);
  const migrationsDir = join(process.cwd(), 'src', 'lib', 'database', 'migrations');

  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
      .sort();
  } catch {
    return; // No migrations directory
  }

  const migrations: MigrationFile[] = [];

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    try {
      const module = await import(pathToFileURL(filePath).href);
      const MigrationClass =
        module.default ??
        Object.values(module).find(
          (v: any) => typeof v === 'function' && v.prototype && typeof v.prototype.up === 'function',
        );

      if (MigrationClass) {
        migrations.push({
          name: file.replace(/\.(ts|js)$/, ''),
          timestamp: file.split('_')[0],
          path: filePath,
          migration: new (MigrationClass as any)(),
        });
      }
    } catch {
      // Skip files that fail to import
    }
  }

  await migrator.fresh(migrations);
}
