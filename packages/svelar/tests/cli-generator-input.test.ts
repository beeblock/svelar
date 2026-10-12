import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_COMMANDS } from '../src/cli/BuiltinCommands.js';
import { MakeEntityCommand } from '../src/cli/commands/MakeEntityCommand.js';
import { MakeModelCommand } from '../src/cli/commands/MakeModelCommand.js';
import { MakeActionCommand } from '../src/cli/commands/MakeActionCommand.js';
import { MakeResourceCommand } from '../src/cli/commands/MakeResourceCommand.js';
import { MakeDtoCommand } from '../src/cli/commands/MakeDtoCommand.js';

const generatorNames = [
  'entity', 'model', 'schema', 'controller', 'dto', 'action', 'request', 'service',
  'repository', 'resource', 'factory', 'observer', 'event', 'listener', 'job',
  'task', 'middleware', 'provider', 'seeder', 'migration', 'command', 'channel', 'plugin',
].map((name) => `make:${name}`);
const generators = BUILTIN_COMMANDS.map((Constructor) => new Constructor())
  .filter((command) => generatorNames.includes(command.name));
const invalidNames = ['123Thing', '123-thing', '---', '!!!', 'class', 'default', 'await', 'string', 'Name"Injected', "Name'Injected", 'Name\nInjected', 'Name\tInjected', '../Escape', '/tmp/Escape', 'C:\\Escape'];
const invalidModules = ['../../escape', '../../../../escape', '/tmp/escape', 'C:\\escape', 'billing/orders', 'billing\\orders', '.', '..', '123billing', '---', '', 'billing"', "billing'", 'billing\n', ' billing'];
const originalCwd = process.cwd();
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let sandbox: string;
let project: string;

function snapshot(directory: string): string[] {
  return readdirSync(directory, { recursive: true }).map(String).sort();
}

function setup(ddd: boolean): void {
  mkdirSync(project, { recursive: true });
  process.chdir(project);
  if (ddd) mkdirSync(join(project, 'src/lib/modules'), { recursive: true });
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'svelar-generator-input-'));
  project = join(sandbox, 'app');
  setup(false);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  rmSync(sandbox, { recursive: true, force: true });
});

describe('Generator input preflight', () => {
  it('covers exactly the 23 scoped generators', () => {
    expect(generators.map((command) => command.name).sort()).toEqual([...generatorNames].sort());
  });

  describe.each([false, true])('direct handlers (DDD=%s)', (ddd) => {
    it.each(generators.map((command) => [command.name, command] as const))('%s rejects invalid names without creating anything', async (_name, command) => {
      setup(ddd);
      const before = snapshot(sandbox);
      for (const name of invalidNames) {
        await expect(command.handle([name], {}), name).rejects.toThrow(/identifier|Name/);
        expect(snapshot(sandbox), name).toEqual(before);
      }
    });

    it.each(generators.filter((command) => command.flags.some((flag) => flag.name === 'module'))
      .map((command) => [command.name, command] as const))('%s rejects unsafe --module even when the flat layout ignores it', async (_name, command) => {
      setup(ddd);
      const before = snapshot(sandbox);
      for (const module of invalidModules) {
        await expect(command.handle(['Invoice'], { module }), module).rejects.toThrow(/module|nonempty/);
        expect(snapshot(sandbox), module).toEqual(before);
      }
    });

    it('rejects referenced names and malformed string/boolean flags before any write', async () => {
      setup(ddd);
      const before = snapshot(sandbox);
      for (const command of generators) {
        for (const flag of command.flags) {
          if (['model', 'event', 'input', 'controller'].includes(flag.name) && flag.type === 'string') {
            for (const value of ['123Thing', 'class', '../Thing', 'Thing"', 'Thing\n']) {
              await expect(command.handle(['Invoice'], { [flag.name]: value })).rejects.toThrow(/identifier/);
              expect(snapshot(sandbox)).toEqual(before);
            }
          }
          if (flag.name === 'schema' && flag.type === 'string') {
            for (const value of ['123-invoice', '.schema.ts', '../invoice', 'invoice"', 'invoice\n']) {
              await expect(command.handle(['Invoice'], { schema: value, input: 'InvoiceInput' })).rejects.toThrow(/identifier/);
              expect(snapshot(sandbox)).toEqual(before);
            }
          }
          if (flag.type === 'string') {
            await expect(command.handle(['Invoice'], { [flag.name]: true })).rejects.toThrow(/string/);
          } else {
            await expect(command.handle(['Invoice'], { [flag.name]: 'false' })).rejects.toThrow(/boolean/);
          }
          expect(snapshot(sandbox)).toEqual(before);
        }
      }
      for (const value of ["users'); throw new Error('x", '../users', '123users']) {
        const migration = generators.find((command) => command.name === 'make:migration')!;
        await expect(migration.handle(['CreateUsersTable'], { create: value })).rejects.toThrow(/table identifier/);
        expect(snapshot(sandbox)).toEqual(before);
      }
      await expect(new MakeDtoCommand().handle(['Invoice'], { schema: 'invoice' })).rejects.toThrow(/requires an --input/);
      expect(snapshot(sandbox)).toEqual(before);
      const collisions: Array<[string, string, Record<string, unknown>]> = [
        ['make:entity', 'Model', {}], ['make:observer', 'ModelObserver', {}],
        ['make:repository', 'Invoice', { model: 'Repository' }],
        ['make:resource', 'Invoice', { model: 'InvoiceResource' }],
        ['make:factory', 'Invoice', { model: 'Factory' }],
        ['make:service', 'Invoice', { model: 'InvoiceService', crud: true }],
        ['make:observer', 'Invoice', { model: 'Invoice' }],
        ['make:listener', 'Notify', { event: 'Listener' }],
        ['make:dto', 'Invoice', { input: 'InvoiceDto', schema: 'invoice' }],
      ];
      for (const [commandName, name, flags] of collisions) {
        const command = generators.find((generator) => generator.name === commandName)!;
        await expect(command.handle([name], flags)).rejects.toThrow(/identifier|Name/);
        expect(snapshot(sandbox)).toEqual(before);
      }
    });

    it('normalizes kebab names to valid identifiers across all generators', async () => {
      setup(ddd);
      for (const command of generators) {
        const flags: Record<string, unknown> = command.flags.some((flag) => flag.name === 'module') ? { module: 'billing' } : {};
        if (command.name === 'make:observer') flags.model = 'Invoice';
        await command.handle(['api-key'], flags);
      }
      const files = snapshot(project).filter((file) => file.endsWith('.ts'));
      expect(files.length).toBeGreaterThanOrEqual(23);
      for (const file of files) {
        const content = readFileSync(join(project, file), 'utf8');
        const result = ts.transpileModule(content, {
          fileName: file, reportDiagnostics: true,
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        });
        expect(result.diagnostics?.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), file).toEqual([]);
      }
      const model = files.find((file) => file.endsWith('/models/ApiKey.ts'))!;
      expect(readFileSync(join(project, model), 'utf8')).toContain('export class ApiKey extends Model');
      const schemas = files.filter((file) => file.endsWith('/api-key.schema.ts'));
      expect(schemas.length).toBeGreaterThan(0);
    });

    it('rejects a companion-directory symlink before creating the first entity or action file', async () => {
      setup(ddd);
      const outside = join(sandbox, 'outside');
      mkdirSync(outside);
      const schema = ddd ? join(project, 'src/lib/modules/billing/contracts/schemas') : join(project, 'src/lib/schemas');
      mkdirSync(dirname(schema), { recursive: true });
      symlinkSync(outside, schema, 'dir');
      const before = snapshot(sandbox);
      await expect(new MakeEntityCommand().handle(['Invoice'], { module: 'billing' })).rejects.toThrow(/symlink/);
      await expect(new MakeActionCommand().handle(['CreateInvoice'], { module: 'billing', schema: true })).rejects.toThrow(/symlink/);
      expect(snapshot(sandbox)).toEqual(before);
      expect(readdirSync(outside)).toEqual([]);
    });

    it('rejects migration and collection-file symlinks before the primary file is written', async () => {
      setup(ddd);
      const outside = join(sandbox, 'outside');
      mkdirSync(outside);
      const migrations = join(project, 'src/lib/database/migrations');
      mkdirSync(dirname(migrations), { recursive: true });
      symlinkSync(outside, migrations, 'dir');
      const before = snapshot(sandbox);
      await expect(new MakeModelCommand().handle(['Invoice'], { migration: true })).rejects.toThrow(/symlink/);
      expect(snapshot(sandbox)).toEqual(before);

      const resources = ddd ? join(project, 'src/lib/modules/billing/interface/http/resources') : join(project, 'src/lib/resources');
      mkdirSync(resources, { recursive: true });
      const outsideFile = join(outside, 'outside.ts');
      writeFileSync(outsideFile, 'untouched');
      symlinkSync(outsideFile, join(resources, 'InvoiceCollectionResource.ts'));
      const beforeCollection = snapshot(sandbox);
      await expect(new MakeResourceCommand().handle(['Invoice'], { module: 'billing', collection: true })).rejects.toThrow(/symlink/);
      expect(snapshot(sandbox)).toEqual(beforeCollection);
      expect(readFileSync(outsideFile, 'utf8')).toBe('untouched');
    });
  });

  it('keeps missing-name handling', async () => {
    const command = new MakeModelCommand();
    await command.handle([], {});
    expect(command.exitCode).toBe(1);
    expect(snapshot(project)).toEqual([]);
  });

  it('uses the same migration filename for entity preflight and write across a second boundary', async () => {
    const clock = vi.spyOn(Date.prototype, 'toISOString')
      .mockReturnValueOnce('2030-01-01T00:00:01.000Z')
      .mockReturnValue('2030-01-01T00:00:02.000Z');
    await new MakeEntityCommand().handle(['Invoice'], {});
    expect(clock).toHaveBeenCalledTimes(1);
    expect(readdirSync(join(project, 'src/lib/database/migrations'))).toEqual(['20300101000001_create_invoices_table.ts']);
  });
});

describe('Installed CLI bin generator regressions', () => {
  it('runs the actual bin entry from an isolated installed package with bounded child processes', async () => {
    // Compile only this fixture's CLI entry; never touch the workspace dist or run npm.
    const install = join(sandbox, 'install');
    const installedPackage = join(install, 'node_modules/@beeblock/svelar');
    const cliDir = join(installedPackage, 'dist/cli');
    mkdirSync(cliDir, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    writeFileSync(join(installedPackage, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, type: 'module', bin: manifest.bin }));
    // External runtime dependencies resolve through the repository's existing installation.
    const dependencies = resolve(packageRoot, '../../node_modules');
    for (const dependency of readdirSync(dependencies)) {
      if (dependency === '.bin' || dependency === '@beeblock') continue;
      symlinkSync(join(dependencies, dependency), join(install, 'node_modules', dependency), 'dir');
    }
    const bin = join(cliDir, 'bin.js');
    await build({ entryPoints: [join(packageRoot, 'src/cli/bin.ts')], outfile: bin, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
    copyFileSync(join(packageRoot, 'src/cli/ts-resolve-hook.mjs'), join(cliDir, 'ts-resolve-hook.mjs'));
    chmodSync(bin, 0o755);
    const installedBin = join(install, 'node_modules/.bin/svelar');
    mkdirSync(dirname(installedBin), { recursive: true });
    symlinkSync('../@beeblock/svelar/dist/cli/bin.js', installedBin);

    for (const ddd of [false, true]) {
      project = join(sandbox, ddd ? 'installed-ddd' : 'installed-flat');
      setup(ddd);
      const invalidCases = [
        ['make:entity', '---'], ['make:entity', '123Thing'], ['make:model', 'class'],
        ['make:schema', '123-invoice'], ['make:entity', 'Invoice', '--module=../../../../escape'],
        ['make:controller', 'Invoice', '--resource', '--model=123Thing'],
        ['make:listener', 'Notify', '--event=Event"Injected'],
        ['make:dto', 'Invoice', '--schema=../invoice', '--input=InvoiceInput'],
      ];
      for (const args of invalidCases) {
        const before = snapshot(project);
        const result = spawnSync(process.execPath, [installedBin, ...args], { cwd: project, encoding: 'utf8', timeout: 10_000 });
        expect(result.error, args.join(' ')).toBeUndefined();
        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toMatch(/identifier|module/);
        expect(snapshot(project)).toEqual(before);
        expect(existsSync(join(sandbox, 'escape'))).toBe(false);
      }
      const result = spawnSync(process.execPath, [installedBin, 'make:model', 'api-key', '--migration'], { cwd: project, encoding: 'utf8', timeout: 10_000 });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const model = ddd ? 'src/lib/modules/api_keies/domain/models/ApiKey.ts' : 'src/lib/models/ApiKey.ts';
      expect(readFileSync(join(project, model), 'utf8')).toContain('export class ApiKey extends Model');
      expect(readdirSync(join(project, 'src/lib/database/migrations'))).toEqual([expect.stringMatching(/_create_api_keies_table\.ts$/)]);
    }
    const result = spawnSync(process.execPath, [installedBin, 'new', '../sibling-app', '--no-install', '--validation=zod'], { cwd: project, encoding: 'utf8', timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(sandbox, 'sibling-app/package.json'))).toBe(true);
  }, 60_000);
});
