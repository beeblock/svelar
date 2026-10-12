import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateCommand } from '../src/cli/commands/UpdateCommand.js';
import { NewCommandTemplates as T } from '../src/cli/commands/NewCommandTemplates.js';
import { transformScaffoldFile } from '../src/cli/commands/NewCommand.js';

describe('Scaffold updates', () => {
  let cwd: string;
  let root: string;
  beforeEach(() => {
    cwd = process.cwd();
    root = mkdtempSync(join(tmpdir(), 'svelar-update-'));
    process.chdir(root);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync('package.json', JSON.stringify({ name: 'custom-app' }));
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it.each(['ddd', 'flat'])('uses the same %s paths and imports as new apps', (structure) => {
    const ddd = structure === 'ddd';
    const files = (new UpdateCommand() as any).getFileManifest(ddd, 'custom-app');
    const paths = files.map((file: any) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
    const schemaPath = ddd ? 'src/lib/modules/auth/contracts/schemas/schemas.ts' : 'src/lib/schemas/auth.ts';
    const modelPath = ddd ? 'src/lib/modules/auth/domain/models/User.ts' : 'src/lib/models/User.ts';
    const controllerPath = ddd ? 'src/lib/modules/auth/interface/http/controllers/AuthController.ts' : 'src/lib/controllers/AuthController.ts';
    expect(paths).toContain(schemaPath);
    expect(paths).toContain(modelPath);
    expect(paths).toContain(controllerPath);
    expect(paths).not.toContain('src/lib/modules/auth/User.ts');
    expect(paths).not.toContain('src/lib/schemas.ts');
    const controller = files.find((file: any) => file.path === controllerPath).content();
    expect(controller).toContain(ddd ? '$lib/modules/auth/application/services/AuthService' : '$lib/services/AuthService');
    expect(files.find((file: any) => file.path === modelPath).ownership).toBe('user');
  });

  it('preserves custom source and migrations while backing up framework config', async () => {
    mkdirSync('src/lib/modules/auth/domain/models', { recursive: true });
    writeFileSync('src/lib/modules/auth/domain/models/User.ts', '// custom user\n');
    mkdirSync('src/lib/database/migrations', { recursive: true });
    writeFileSync('src/lib/database/migrations/00000001_create_users_table.ts', '// custom schema\n');
    writeFileSync('svelar.validation.json', '{"validation":"valibot"}\n');
    writeFileSync('.env.example', '# custom env example\n');
    writeFileSync('.env', 'APP_KEY=keep-my-secret\n');

    await new UpdateCommand().handle([], { force: true, 'dry-run': true, category: 'config' });
    expect(readFileSync('.env.example', 'utf8')).toBe('# custom env example\n');
    expect(existsSync('.env.example.bak')).toBe(false);
    await new UpdateCommand().handle([], { force: true, category: 'config' });
    expect(readFileSync('.env.example.bak', 'utf8')).toBe('# custom env example\n');
    expect(readFileSync('svelar.validation.json', 'utf8')).toContain('valibot');
    expect(readFileSync('.env', 'utf8')).toBe('APP_KEY=keep-my-secret\n');
    await new UpdateCommand().handle([], { force: true, category: 'migration' });
    expect(readFileSync('src/lib/database/migrations/00000001_create_users_table.ts', 'utf8')).toBe('// custom schema\n');
    expect(readFileSync('src/lib/modules/auth/domain/models/User.ts', 'utf8')).toBe('// custom user\n');
    expect(existsSync('src/lib/modules/auth/User.ts')).toBe(false);
    expect(existsSync('src/lib/database/migrations/00000000_000033_create_team_model_has_permissions_table.ts')).toBe(true);
  });

  it('generates Valibot templates for reviewed user-file updates', () => {
    writeFileSync('svelar.validation.json', '{"validation":"valibot"}\n');
    const files = (new UpdateCommand() as any).getFileManifest(true, 'custom-app');
    const schema = files.find((file: any) => file.path === 'src/lib/modules/auth/contracts/schemas/schemas.ts');
    expect(schema.content()).toContain("from '@beeblock/svelar/validation/valibot'");
    expect(schema.content()).not.toContain("from 'zod'");
  });

  it.each([
    { validation: 'zod', flat: false }, { validation: 'valibot', flat: false },
    { validation: 'zod', flat: true }, { validation: 'valibot', flat: true },
  ] as const)('adds missing manifest types without rewriting user files ($validation, flat=$flat)', async ({ validation, flat }) => {
    const schemas = flat ? 'src/lib/schemas' : 'src/lib/modules/auth/contracts/schemas';
    mkdirSync(schemas, { recursive: true });
    writeFileSync('src/app.ts', '// customized app\r\n');
    writeFileSync('src/app.d.ts', '// existing customized ambient types\r\n');
    writeFileSync(`${schemas}/schemas.ts`, '// customized shared schema\r\n');
    writeFileSync('svelar.validation.json', JSON.stringify({ validation }) + '\n');
    writeFileSync('.env', 'APP_KEY=original-secret\r\n');
    writeFileSync('.env.example', '# existing framework config\r\n');
    const originals = new Map(['src/app.ts', 'src/app.d.ts', `${schemas}/schemas.ts`,
      'svelar.validation.json', '.env', '.env.example', 'package.json'].map((path) => [path, readFileSync(path)]));

    await new UpdateCommand().handle([], { 'add-missing-user-files': true, force: true, category: 'config' });
    expect(readFileSync('src/svelar.d.ts', 'utf8')).toBe(
      transformScaffoldFile('src/svelar.d.ts', T.applyValidationProvider(T.appDts(), validation), flat).content,
    );
    for (const [path, content] of originals) expect(readFileSync(path)).toEqual(content);
    expect(existsSync('.env.example.bak')).toBe(false);
    expect(existsSync('src/lib/database/migrations')).toBe(false);
    writeFileSync('src/svelar.d.ts', '// user customized newly added types\n');
    await new UpdateCommand().handle([], { 'add-missing-user-files': true, force: true, category: 'config' });
    expect(readFileSync('src/svelar.d.ts', 'utf8')).toBe('// user customized newly added types\n');
    expect(existsSync('src/svelar.d.ts.bak')).toBe(false);
  });

  it.each(['dry-run', 'list'])('lists missing-only additions with --%s without writes', async (flag) => {
    await new UpdateCommand().handle([], { 'add-missing-user-files': true, [flag]: true, force: true, category: 'config' });
    expect(existsSync('src')).toBe(false);
    expect(existsSync('.env.example')).toBe(false);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('src/svelar.d.ts');
  });

  it('requires explicit force for missing-only additions and never falls through to normal updates', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const command = new UpdateCommand();
    await command.handle([], { 'add-missing-user-files': true, category: 'config' });
    expect(command.exitCode).toBe(1);
    expect(existsSync('src')).toBe(false);
    expect(existsSync('.env.example')).toBe(false);
  });

  it.each(['include-user-files', 'migrate-zod4'])('rejects combining missing-only mode with --%s', async (flag) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const command = new UpdateCommand();
    await command.handle([], { 'add-missing-user-files': true, [flag]: true, force: true });
    expect(command.exitCode).toBe(1);
    expect(existsSync('src')).toBe(false);
  });

  it('preflights symlink parents before adding any missing files', async () => {
    mkdirSync('external');
    symlinkSync(join(root, 'external'), 'src');
    await expect(new UpdateCommand().handle([], { 'add-missing-user-files': true, force: true, category: 'config' }))
      .rejects.toThrow('parent is not an app-owned directory');
    expect(existsSync('AGENTS.md')).toBe(false);
    expect(existsSync('external/svelar.d.ts')).toBe(false);
  });

  it('fails promptly when an update would prompt without a terminal', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    try {
      await expect(new UpdateCommand().handle([], {})).rejects.toThrow('require a terminal');
    } finally {
      if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor);
      else delete (process.stdin as any).isTTY;
    }
  });
});
