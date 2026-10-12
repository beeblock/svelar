/**
 * Svelar CLI Command Base
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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

const RESERVED_IDENTIFIERS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof',
  'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public',
  'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield', 'any', 'unknown', 'never', 'number',
  'string', 'boolean', 'bigint', 'symbol', 'object', 'undefined', 'eval', 'arguments',
]);

export abstract class Command {
  /** Command name (e.g. 'make:model') */
  abstract name: string;

  /** Description shown in help */
  abstract description: string;

  /** Positional arguments description */
  arguments: string[] = [];

  /** Available flags */
  flags: CommandFlag[] = [];

  /** Nonzero when a command reports an error without throwing. */
  exitCode = 0;

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
    this.exitCode = 1;
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

  /** Preflight generator names and references before creating any artifacts. */
  protected generatorName(raw: string | undefined, flags: Record<string, unknown> = {}): string | undefined {
    for (const flag of this.flags) {
      const value = flags[flag.name];
      if (value === undefined) continue;
      if (flag.type === 'boolean') {
        if (typeof value !== 'boolean') throw new Error(`--${flag.name} must be boolean.`);
        continue;
      }
      if (typeof value !== 'string' || !value.trim()) throw new Error(`--${flag.name} requires a nonempty string.`);
      if (flag.name === 'module') this.validateModuleName(value);
      if (['model', 'event', 'input', 'controller'].includes(flag.name)) this.validateIdentifier(value, `--${flag.name}`);
      if (flag.name === 'schema') {
        const basename = value.replace(/\.(ts|js)$/, '').replace(/\.schema$/, '');
        this.validateSlug(basename, '--schema');
      }
      if (['create', 'table'].includes(flag.name) && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new Error(`--${flag.name} must be a table identifier.`);
      }
      if (flag.name === 'command' && !/^[A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z][A-Za-z0-9_-]*)*$/.test(value)) {
        throw new Error('--command must be a command identifier, such as app:sync-users.');
      }
    }
    if (raw === undefined || raw === '') return undefined;
    if (!/^[A-Za-z0-9_$ -]+$/.test(raw) || RESERVED_IDENTIFIERS.has(raw.trim())) {
      throw new Error('Name must normalize to a nonreserved TypeScript identifier.');
    }
    const name = raw.trim().split(/[-_ ]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    this.validateIdentifier(name, 'Name');
    this.validateSlug(name.replace(/\$/g, ''), 'Name');
    const suffixes: Record<string, string> = {
      'make:model': 'Model', 'make:controller': 'Controller', 'make:dto': 'Dto',
      'make:action': 'Action', 'make:request': 'Request', 'make:service': 'Service',
      'make:repository': 'Repository', 'make:resource': 'Resource', 'make:factory': 'Factory',
      'make:observer': 'Observer', 'make:listener': 'Listener', 'make:job': 'Job',
      'make:task': 'ScheduledTask', 'make:middleware': 'Middleware', 'make:provider': 'ServiceProvider',
      'make:seeder': 'Seeder', 'make:command': 'Command', 'make:channel': 'Channel', 'make:plugin': 'Plugin',
      'make:entity': 'Model',
    };
    if (name === suffixes[this.name] || (this.name === 'make:dto' && name === 'DTO')) {
      throw new Error('Name must include an entity prefix, not just the framework artifact type.');
    }
    return name;
  }

  protected validateIdentifier(value: string, label: string, existingBindings: readonly string[] = []): void {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) || RESERVED_IDENTIFIERS.has(value) || existingBindings.includes(value)) {
      throw new Error(`${label} must be a nonreserved TypeScript identifier.`);
    }
  }

  private validateSlug(value: string, label: string): void {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
      throw new Error(`${label} must be a single identifier starting with a letter, without paths or punctuation.`);
    }
  }

  private validateModuleName(value: string): void {
    this.validateSlug(value, '--module');
  }

  /** Keep lexical paths and existing symlink ancestors inside the selected root. */
  protected containedPath(root: string, ...parts: string[]): string {
    const base = resolve(root);
    const target = resolve(base, ...parts);
    const within = (parent: string, child: string) => {
      const suffix = relative(parent, child);
      return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
    };
    if (!within(base, target)) throw new Error(`Generator path escapes its output directory: ${target}`);

    const physicalPath = (path: string): string => {
      let ancestor = path;
      while (true) {
        try {
          lstatSync(ancestor);
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
          const parent = dirname(ancestor);
          if (parent === ancestor) throw error;
          ancestor = parent;
          continue;
        }
        return resolve(realpathSync(ancestor), relative(ancestor, path));
      }
    };
    // An output root that is itself a symlink must not redefine the boundary.
    const project = resolve(process.cwd());
    const physicalProject = realpathSync(project);
    const expectedRoot = resolve(physicalProject, relative(project, base));
    if (!within(project, base) || !within(expectedRoot, physicalPath(target))) {
      throw new Error(`Generator path escapes its output directory through a symlink: ${target}`);
    }
    return target;
  }

  protected artifactPath(directory: string, fileName: string): string {
    if (!/^[A-Za-z0-9_$][A-Za-z0-9_$.-]*$/.test(fileName)) throw new Error('Invalid generator artifact filename.');
    return this.containedPath(directory, fileName);
  }

  protected preflightModuleFiles(moduleName: string, files: Partial<Record<ModuleArtifactKind, string>>): void {
    for (const kind of Object.keys(files) as ModuleArtifactKind[]) {
      const fileName = files[kind];
      if (fileName !== undefined) this.artifactPath(this.moduleDir(moduleName, FLAT_DIRS[kind], kind), fileName);
    }
  }

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
    this.validateSlug(type, 'Directory');
    const root = this.isDDD() ? join(process.cwd(), 'src', 'lib', 'shared') : join(process.cwd(), 'src', 'lib');
    return this.containedPath(root, type);
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
    this.validateModuleName(moduleName);
    this.validateSlug(flatType, 'Directory');
    if (!this.isDDD()) return this.containedPath(join(process.cwd(), 'src', 'lib'), flatType);

    const subdir = kind ? DDD_MODULE_DIRS[kind] : '';
    return this.containedPath(join(process.cwd(), 'src', 'lib', 'modules', moduleName), subdir);
  }

  protected moduleRelDir(moduleName: string, flatType: string, kind?: ModuleArtifactKind): string {
    this.validateModuleName(moduleName);
    this.validateSlug(flatType, 'Directory');
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
    if (moduleName || this.isDDD()) this.validateModuleName(moduleName);
    if (!/^[A-Za-z_$][A-Za-z0-9_$-]*(?:\.schema)?$/.test(fileName)) throw new Error('Invalid generator import filename.');
    if (!this.isDDD()) return `$lib/${FLAT_DIRS[toKind]}/${fileName}.js`;
    return `$lib/modules/${moduleName}/${DDD_MODULE_DIRS[toKind]}/${fileName}.js`;
  }

  protected moduleAliasPath(moduleName: string, flatType: string, fileName: string, kind?: ModuleArtifactKind): string {
    if (moduleName || this.isDDD()) this.validateModuleName(moduleName);
    this.validateSlug(flatType, 'Directory');
    if (!/^[A-Za-z_$][A-Za-z0-9_$-]*(?:\.schema)?(?:\.(?:ts|js))?$/.test(fileName)) throw new Error('Invalid generator import filename.');
    if (!this.isDDD()) return `$lib/${flatType}/${fileName}`;
    const subdir = kind ? `/${DDD_MODULE_DIRS[kind]}` : '';
    return `$lib/modules/${moduleName}${subdir}/${fileName}`;
  }
}
