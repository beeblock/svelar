/**
 * migrate — Run database migrations
 */

import { Command } from '../Command.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class MigrateCommand extends Command {
  name = 'migrate';
  description = 'Run pending database migrations';
  flags = [
    { name: 'rollback', description: 'Rollback the last batch of migrations', type: 'boolean' as const },
    { name: 'reset', description: 'Reset all migrations', type: 'boolean' as const },
    { name: 'refresh', description: 'Reset and re-run all migrations', type: 'boolean' as const },
    { name: 'fresh', description: 'Drop all tables and re-run all migrations', type: 'boolean' as const },
    { name: 'status', description: 'Show migration status', type: 'boolean' as const },
    { name: 'seed', description: 'Run seeders after migrating', type: 'boolean' as const },
    { name: 'force', description: 'Force destructive operations in production', type: 'boolean' as const },
  ];

  /** Destructive flags that require --force in production */
  private destructiveFlags = ['reset', 'refresh', 'fresh'];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    // Bootstrap the app (loads Connection.configure, Hash, etc.)
    await this.bootstrap();

    // Check production safety for destructive operations
    const activeDestructive = this.destructiveFlags.find((f) => flags[f]);
    if (activeDestructive && this.isProduction() && !flags.force) {
      this.error(
        `The --${activeDestructive} flag is destructive and cannot be run in production.`
      );
      this.error(
        `Use --force to run this command in production: npx svelar migrate --${activeDestructive} --force`
      );
      process.exit(1);
    }

    // Dynamically import to avoid loading DB deps at CLI parse time
    const migrationConfig = this.loadMigrationConfig();
    const { Migrator } = await import('../../database/Migration.js');
    const migrator = new Migrator({ table: migrationConfig.table });

    const migrationsDir = join(process.cwd(), migrationConfig.path);
    const migrations = await this.loadMigrations(migrationsDir);

    if (flags.status) {
      const status = await migrator.status(migrations);
      this.table(
        ['Migration', 'Status', 'Batch'],
        status.map((s) => [
          s.name,
          s.ran ? '\x1b[32mRan\x1b[0m' : '\x1b[33mPending\x1b[0m',
          s.batch?.toString() ?? '-',
        ])
      );
      return;
    }

    if (flags.rollback) {
      this.info('Rolling back last batch...');
      const rolledBack = await migrator.rollback(migrations);
      if (rolledBack.length === 0) {
        this.info('Nothing to rollback.');
      } else {
        for (const name of rolledBack) {
          this.success(`Rolled back: ${name}`);
        }
      }
      return;
    }

    if (flags.reset) {
      this.warnDestructive('reset');
      this.info('Resetting all migrations...');
      const reset = await migrator.reset(migrations);
      if (reset.length === 0) {
        this.info('Nothing to reset.');
      } else {
        for (const name of reset) {
          this.success(`Rolled back: ${name}`);
        }
      }
      return;
    }

    if (flags.refresh) {
      this.warnDestructive('refresh');
      this.info('Refreshing migrations...');
      const result = await migrator.refresh(migrations);
      for (const name of result.reset) {
        this.success(`Rolled back: ${name}`);
      }
      for (const name of result.migrated) {
        this.success(`Migrated: ${name}`);
      }
      await this.runSeedersIfRequested(flags);
      return;
    }

    if (flags.fresh) {
      this.warnDestructive('fresh');
      this.info('Dropping all tables...');
      const result = await migrator.fresh(migrations);
      if (result.dropped.length > 0) {
        for (const name of result.dropped) {
          this.success(`Dropped table: ${name}`);
        }
      }
      this.newLine();
      this.info('Re-running all migrations...');
      for (const name of result.migrated) {
        this.success(`Migrated: ${name}`);
      }
      await this.runSeedersIfRequested(flags);
      return;
    }

    // Default: run pending migrations
    this.info('Running migrations...');
    const migrated = await migrator.run(migrations);

    if (migrated.length === 0) {
      this.info('Nothing to migrate.');
    } else {
      for (const name of migrated) {
        this.success(`Migrated: ${name}`);
      }
    }

    await this.runSeedersIfRequested(flags);
  }

  /**
   * Check if the current environment is production.
   * Checks NODE_ENV and APP_ENV (Laravel convention).
   */
  private isProduction(): boolean {
    const env = process.env.NODE_ENV || process.env.APP_ENV || 'development';
    return env === 'production';
  }

  /**
   * Print a warning when running a destructive command (even outside production).
   */
  private warnDestructive(flag: string): void {
    if (this.isProduction()) {
      this.warn(`Running --${flag} in PRODUCTION with --force.`);
    }
  }

  private loadMigrationConfig(): { table: string; path: string } {
    const defaults = {
      table: 'migrations',
      path: 'src/lib/database/migrations',
    };
    const configPath = join(process.cwd(), 'svelar.database.json');

    if (!existsSync(configPath)) return defaults;

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      return {
        table: config.migrations?.table ?? defaults.table,
        path: config.migrations?.path ?? defaults.path,
      };
    } catch {
      return defaults;
    }
  }

  private async loadMigrations(dir: string): Promise<any[]> {
    let files: string[];
    try {
      files = readdirSync(dir)
        .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
        .sort();
    } catch (err: any) {
      this.warn(`Migrations directory not found: ${dir}`);
      return [];
    }

    const migrations: any[] = [];

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const module = await import(pathToFileURL(filePath).href);
        const MigrationClass = module.default ?? Object.values(module).find(
          (v: any) => typeof v === 'function' && v.prototype && typeof v.prototype.up === 'function'
        );

        if (MigrationClass) {
          migrations.push({
            name: file.replace(/\.(ts|js)$/, ''),
            timestamp: file.split('_')[0],
            path: filePath,
            migration: new (MigrationClass as any)(),
          });
        } else {
          this.warn(`No migration class found in: ${file}`);
        }
      } catch (err: any) {
        let msg: string;
        try {
          msg = err instanceof Error ? err.message : String(err);
        } catch {
          msg = JSON.stringify(err) ?? 'Unknown error (non-stringifiable object)';
        }
        this.error(`Failed to load migration ${file}: ${msg}`);
      }
    }

    return migrations;
  }

  private async runSeedersIfRequested(flags: Record<string, any>): Promise<void> {
    if (!flags.seed) return;

    const { SeedCommand } = await import('./SeedCommand.js');
    await new SeedCommand().handle([], {});
  }
}
