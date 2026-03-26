/**
 * migrate — Run database migrations
 */

import { Command } from '../Command.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class MigrateCommand extends Command {
  name = 'migrate';
  description = 'Run pending database migrations';
  flags = [
    { name: 'rollback', description: 'Rollback the last batch of migrations', type: 'boolean' as const },
    { name: 'reset', description: 'Reset all migrations', type: 'boolean' as const },
    { name: 'refresh', description: 'Reset and re-run all migrations', type: 'boolean' as const },
    { name: 'status', description: 'Show migration status', type: 'boolean' as const },
    { name: 'seed', description: 'Run seeders after migrating', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    // Bootstrap the app (loads Connection.configure, Hash, etc.)
    await this.bootstrap();

    // Dynamically import to avoid loading DB deps at CLI parse time
    const { Migrator } = await import('../../database/Migration.js');
    const migrator = new Migrator();

    const migrationsDir = join(process.cwd(), 'src', 'lib', 'database', 'migrations');
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
      this.info('Refreshing migrations...');
      const result = await migrator.refresh(migrations);
      for (const name of result.reset) {
        this.success(`Rolled back: ${name}`);
      }
      for (const name of result.migrated) {
        this.success(`Migrated: ${name}`);
      }
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
}
