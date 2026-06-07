/**
 * Svelar CLI Command Base
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CommandFlag {
  name: string;
  alias?: string;
  description: string;
  type: 'boolean' | 'string';
  default?: any;
}

export type ValidationProvider = 'zod' | 'valibot';

export type ModuleArtifactKind =
  | 'action'
  | 'controller'
  | 'dto'
  | 'event'
  | 'listener'
  | 'model'
  | 'notification'
  | 'observer'
  | 'policy'
  | 'repository'
  | 'request'
  | 'resource'
  | 'schema'
  | 'service';

const DDD_MODULE_DIRS: Record<ModuleArtifactKind, string> = {
  action: 'application/actions',
  controller: 'interface/http/controllers',
  dto: 'application/dto',
  event: 'domain/events',
  listener: 'application/listeners',
  model: 'domain/models',
  notification: 'application/notifications',
  observer: 'domain/observers',
  policy: 'domain/policies',
  repository: 'infrastructure/repositories',
  request: 'interface/http/requests',
  resource: 'interface/http/resources',
  schema: 'contracts/schemas',
  service: 'application/services',
};

const FLAT_DIRS: Record<ModuleArtifactKind, string> = {
  action: 'actions',
  controller: 'controllers',
  dto: 'dtos',
  event: 'events',
  listener: 'listeners',
  model: 'models',
  notification: 'notifications',
  observer: 'observers',
  policy: 'policies',
  repository: 'repositories',
  request: 'dtos',
  resource: 'resources',
  schema: 'schemas',
  service: 'services',
};

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
        await this.importUserModule(appPath);
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

  protected async importUserModule(modulePath: string): Promise<any> {
    if (modulePath.endsWith('.ts')) {
      const { createJiti } = await import('jiti');
      const libPath = join(process.cwd(), 'src', 'lib');
      const jiti = createJiti(pathToFileURL(join(process.cwd(), 'svelar-cli.mjs')).href, {
        alias: {
          '$lib': libPath,
          '$lib/*': `${libPath}/*`,
        },
        tsconfigPaths: true,
      });
      return jiti.import(modulePath);
    }

    return import(pathToFileURL(modulePath).href);
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

  protected validationProvider(): ValidationProvider {
    const configPath = join(process.cwd(), 'svelar.validation.json');
    if (!existsSync(configPath)) return 'zod';

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      return config.validation === 'valibot' ? 'valibot' : 'zod';
    } catch {
      return 'zod';
    }
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
   * Resolve a module directory path.
   *
   * DDD apps use layered bounded-context folders:
   * src/lib/modules/{module}/{domain|application|infrastructure|interface|contracts}/...
   *
   * Flat apps keep the Laravel-style src/lib/{type}/ folders.
   */
  protected moduleDir(moduleName: string, flatType: string, kind?: ModuleArtifactKind): string {
    if (!this.isDDD()) return join(process.cwd(), 'src', 'lib', flatType);

    const subdir = kind ? DDD_MODULE_DIRS[kind] : '';
    return join(process.cwd(), 'src', 'lib', 'modules', moduleName, subdir);
  }

  protected moduleRelDir(moduleName: string, flatType: string, kind?: ModuleArtifactKind): string {
    if (!this.isDDD()) return `src/lib/${flatType}`;

    const subdir = kind ? DDD_MODULE_DIRS[kind] : '';
    return ['src/lib/modules', moduleName, subdir].filter(Boolean).join('/');
  }

  protected moduleImportPath(
    moduleName: string,
    fromKind: ModuleArtifactKind,
    toKind: ModuleArtifactKind,
    fileName: string,
  ): string {
    void fromKind;
    if (!this.isDDD()) return `$lib/${FLAT_DIRS[toKind]}/${fileName}.js`;
    return `$lib/modules/${moduleName}/${DDD_MODULE_DIRS[toKind]}/${fileName}.js`;
  }

  protected moduleAliasPath(moduleName: string, flatType: string, fileName: string, kind?: ModuleArtifactKind): string {
    if (!this.isDDD()) return `$lib/${flatType}/${fileName}`;
    const subdir = kind ? `/${DDD_MODULE_DIRS[kind]}` : '';
    return `$lib/modules/${moduleName}${subdir}/${fileName}`;
  }
}
