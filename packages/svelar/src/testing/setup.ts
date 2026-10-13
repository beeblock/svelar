/**
 * Test setup utilities.
 *
 * `useSvelarTest()` wires up beforeEach/afterEach hooks automatically.
 * `refreshDatabase()` drops all tables and re-runs migrations.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Connection, type DatabaseConfig } from '../database/Connection.js';
import { Migrator, type MigrationFile } from '../database/Migration.js';
import { Factory } from './Factory.js';

export interface RefreshDatabaseOptions {
  /** Explicit acknowledgement before destroying a PostgreSQL/MySQL test database. Never use production credentials. */
  allowDestructiveDatabase?: boolean;
  /** Database connection name to use. Default: undefined (uses default) */
  connectionName?: string;
  /** Migration directory. Defaults to svelar.database.json, then src/lib/database/migrations */
  migrationsPath?: string;
  /** Migration repository table. Defaults to svelar.database.json, then migrations */
  migrationsTable?: string;
}

export interface UseSvelarTestOptions {
  /** An explicit isolated test database, including PostgreSQL/MySQL driver profiles. */
  database?: DatabaseConfig;
  allowDestructiveDatabase?: boolean;
  /** When true, calls refreshDatabase() before each test. Default: false */
  refreshDatabase?: boolean;
  /** Database connection name to use. Default: undefined (uses default) */
  connectionName?: string;
  /** Migration directory override */
  migrationsPath?: string;
  /** Migration repository table override */
  migrationsTable?: string;
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
    if (options.database) {
      await Connection.disconnect();
      const name = options.connectionName ?? 'test';
      Connection.configure({ default: name, connections: { [name]: { ...options.database } } });
      return;
    }
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
      await refreshDatabase({
        connectionName: options.connectionName,
        migrationsPath: options.migrationsPath,
        migrationsTable: options.migrationsTable,
        allowDestructiveDatabase: options.allowDestructiveDatabase,
      });
    }
  });
}

/**
 * Drop all tables and re-run all migrations from the configured
 * migrations directory.
 */
export async function refreshDatabase(
  optionsOrConnectionName?: string | RefreshDatabaseOptions,
): Promise<void> {
  const options = typeof optionsOrConnectionName === 'string'
    ? { connectionName: optionsOrConnectionName }
    : optionsOrConnectionName ?? {};
  const migrationConfig = loadMigrationConfig();
  const migrationsTable = options.migrationsTable ?? migrationConfig.table;
  const migrationsPath = options.migrationsPath ?? migrationConfig.path;
  const migrator = new Migrator({
    connectionName: options.connectionName,
    table: migrationsTable,
  });
  const migrationsDir = join(process.cwd(), migrationsPath);

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
      } else throw new Error('No Migration class was exported.');
    } catch (cause) {
      throw new Error(`Could not load test migration ${file}; database reset was not performed.`, { cause });
    }
  }

  if (Connection.getDriver(options.connectionName) !== 'sqlite' && options.allowDestructiveDatabase !== true) {
    throw new Error('PostgreSQL/MySQL test resets require allowDestructiveDatabase: true and an isolated test database.');
  }
  await migrator.fresh(migrations);
}

function loadMigrationConfig(): { table: string; path: string } {
  const defaults = {
    table: 'migrations',
    path: 'src/lib/database/migrations',
  };
  const configPath = join(process.cwd(), 'svelar.database.json');
  if (!existsSync(configPath)) return defaults;

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {
      table: parsed?.migrations?.table ?? defaults.table,
      path: parsed?.migrations?.path ?? defaults.path,
    };
  } catch (cause) {
    throw new Error('Invalid svelar.database.json; database reset was not performed.', { cause });
  }
}
