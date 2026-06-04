/**
 * Svelar CLI Command Base
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CommandFlag {
  name: string;
  alias?: string;
  description: string;
  type: 'boolean' | 'string';
  default?: any;
}

export abstract class Command {
  /** Command name (e.g. 'make:model') */
  abstract name: string;

  /** Description shown in help */
  abstract description: string;

  /** Positional arguments description */
  arguments: string[] = [];

  /** Available flags */
  flags: CommandFlag[] = [];

  /** Execute the command */
  abstract handle(args: string[], flags: Record<string, any>): Promise<void>;

  /**
   * Bootstrap database configuration for CLI commands.
   *
   * Reads a `svelar.database.json` file if present, or uses env vars
   * and sensible defaults (SQLite with `database.db`).
   */
  protected async bootstrap(): Promise<void> {
    const { join } = await import('node:path');
    const { existsSync, readFileSync } = await import('node:fs');
    const { Connection, normalizeDatabaseDriver } = await import('../database/Connection.js');
    const cwd = process.cwd();

    // Already configured (e.g. if running in-process)
    try {
      Connection.getDriver();
      return;
    } catch {
      // Not configured yet — continue
    }

    // Laravel-like behavior: boot the application first so CLI commands share
    // the same service configuration as the web process.
    const appCandidates = [
      join(cwd, 'src', 'app.ts'),
      join(cwd, 'src', 'app.js'),
    ];
    const appPath = appCandidates.find((path) => existsSync(path));
    if (appPath) {
      try {
        await import(pathToFileURL(appPath).href);
        try {
          Connection.getDriver();
          this.info(`Application bootstrapped from src/app.${appPath.endsWith('.ts') ? 'ts' : 'js'}`);
          return;
        } catch {
          // App loaded but did not configure the database; fall back below.
        }
      } catch (err: any) {
        throw new Error(`Failed to bootstrap application from ${appPath}: ${String(err?.message ?? err)}`);
      }
    }

    // Try reading a JSON config file (simple, no TS compilation needed)
    const configPath = join(cwd, 'svelar.database.json');
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw);
        Connection.configure(config);
        this.info(`Database configured from svelar.database.json`);
        return;
      } catch (err: any) {
        this.warn(`Failed to parse svelar.database.json: ${String(err?.message ?? err)}`);
      }
    }

    // Default: SQLite
    const driver = normalizeDatabaseDriver(process.env.DB_DRIVER ?? 'sqlite');
    const dbPath = process.env.DB_PATH ?? 'database.db';

    Connection.configure({
      default: driver as any,
      connections: {
        [driver]: {
          driver: driver as any,
          filename: dbPath,
          host: process.env.DB_HOST,
          port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
          database: process.env.DB_NAME,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
        },
      },
    });
    this.info(`Using ${driver} database${driver === 'sqlite' ? `: ${dbPath}` : ''}`);
  }

  // ── Output Helpers ──

  protected log(message: string): void {
    console.log(message);
  }

  protected info(message: string): void {
    console.log(`\x1b[34mINFO\x1b[0m  ${message}`);
  }

  protected success(message: string): void {
    console.log(`\x1b[32m✓\x1b[0m ${message}`);
  }

  protected warn(message: string): void {
    console.log(`\x1b[33mWARN\x1b[0m  ${message}`);
  }

  protected error(message: string): void {
    console.error(`\x1b[31mERROR\x1b[0m ${message}`);
  }

  protected table(headers: string[], rows: string[][]): void {
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
    );

    const separator = widths.map((w) => '─'.repeat(w + 2)).join('┼');
    const formatRow = (row: string[]) =>
      row.map((cell, i) => ` ${(cell ?? '').padEnd(widths[i])} `).join('│');

    console.log(formatRow(headers));
    console.log(separator);
    for (const row of rows) {
      console.log(formatRow(row));
    }
  }

  protected newLine(): void {
    console.log();
  }

  // ── Project Structure Helpers ──

  /**
   * Detect whether the project uses DDD (src/lib/modules/) or flat structure.
   */
  protected isDDD(): boolean {
    return existsSync(join(process.cwd(), 'src', 'lib', 'modules'));
  }

  /**
   * Resolve a "shared" directory path (jobs, scheduler, middleware, etc.)
   * DDD: src/lib/shared/{type}/  |  Flat: src/lib/{type}/
   */
  protected sharedDir(type: string): string {
    return this.isDDD()
      ? join(process.cwd(), 'src', 'lib', 'shared', type)
      : join(process.cwd(), 'src', 'lib', type);
  }

  /**
   * Resolve a module directory path (models, controllers, services, etc.)
   * DDD: src/lib/modules/{module}/  |  Flat: src/lib/{type}/
   */
  protected moduleDir(moduleName: string, flatType: string): string {
    return this.isDDD()
      ? join(process.cwd(), 'src', 'lib', 'modules', moduleName)
      : join(process.cwd(), 'src', 'lib', flatType);
  }
}
