import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// We can't import the abstract Command directly, so we create a concrete subclass
import { Command, type CommandFlag } from '../src/cli/Command.js';
import { Cli } from '../src/cli/Cli.js';
import { BUILTIN_COMMANDS, builtinCommandNames } from '../src/cli/BuiltinCommands.js';
import { LintArchitectureCommand } from '../src/cli/commands/LintArchitectureCommand.js';

class TestCommand extends Command {
  name = 'test:cmd';
  description = 'A test command';
  arguments = ['arg1'];
  flags: CommandFlag[] = [
    { name: 'verbose', alias: 'v', description: 'Verbose output', type: 'boolean' },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    this.log(`args: ${args.join(', ')}`);
    if (flags.verbose) this.info('Verbose mode');
  }

  // Expose protected methods for testing
  public testIsDDD(): boolean {
    return this.isDDD();
  }

  public testSharedDir(type: string): string {
    return this.sharedDir(type);
  }

  public testModuleDir(moduleName: string, flatType: string): string {
    return this.moduleDir(moduleName, flatType);
  }

  public testLog(msg: string) { this.log(msg); }
  public testInfo(msg: string) { this.info(msg); }
  public testSuccess(msg: string) { this.success(msg); }
  public testWarn(msg: string) { this.warn(msg); }
  public testError(msg: string) { this.error(msg); }
  public testTable(headers: string[], rows: string[][]) { this.table(headers, rows); }
  public testNewLine() { this.newLine(); }
  public testBootstrap() { return this.bootstrap(); }
}

class CaptureCommand extends Command {
  name = 'capture';
  description = 'Capture parsed arguments';
  flags: CommandFlag[] = [
    { name: 'redis', description: 'Include Redis', type: 'boolean', default: true },
    { name: 'soketi', description: 'Include Soketi', type: 'boolean', default: true },
    { name: 'name', description: 'Name', type: 'string' },
  ];
  capturedArgs: string[] = [];
  capturedFlags: Record<string, any> = {};

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    this.capturedArgs = args;
    this.capturedFlags = flags;
  }
}

describe('Command Base Class', () => {
  let cmd: TestCommand;
  let originalCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    cmd = new TestCommand();
    originalCwd = process.cwd();
    tmpDir = join(originalCwd, '.test-cli-tmp-' + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('properties', () => {
    it('should have correct name and description', () => {
      expect(cmd.name).toBe('test:cmd');
      expect(cmd.description).toBe('A test command');
    });

    it('should have arguments and flags', () => {
      expect(cmd.arguments).toEqual(['arg1']);
      expect(cmd.flags).toHaveLength(1);
      expect(cmd.flags[0].name).toBe('verbose');
    });
  });

  describe('isDDD()', () => {
    it('should return false when no modules directory exists', () => {
      expect(cmd.testIsDDD()).toBe(false);
    });

    it('should return true when src/lib/modules/ exists', () => {
      mkdirSync(join(tmpDir, 'src', 'lib', 'modules'), { recursive: true });
      expect(cmd.testIsDDD()).toBe(true);
    });
  });

  describe('sharedDir()', () => {
    it('should return flat path when no modules directory', () => {
      const result = cmd.testSharedDir('jobs');
      expect(result).toBe(join(tmpDir, 'src', 'lib', 'jobs'));
    });

    it('should return DDD shared path when modules directory exists', () => {
      mkdirSync(join(tmpDir, 'src', 'lib', 'modules'), { recursive: true });
      const result = cmd.testSharedDir('jobs');
      expect(result).toBe(join(tmpDir, 'src', 'lib', 'shared', 'jobs'));
    });

    it('should work for different types', () => {
      const types = ['scheduler', 'middleware', 'providers', 'commands', 'plugins'];
      for (const type of types) {
        expect(cmd.testSharedDir(type)).toBe(join(tmpDir, 'src', 'lib', type));
      }
    });
  });

  describe('moduleDir()', () => {
    it('should return flat path when no modules directory', () => {
      const result = cmd.testModuleDir('auth', 'models');
      expect(result).toBe(join(tmpDir, 'src', 'lib', 'models'));
    });

    it('should return DDD module path when modules directory exists', () => {
      mkdirSync(join(tmpDir, 'src', 'lib', 'modules'), { recursive: true });
      const result = cmd.testModuleDir('auth', 'models');
      expect(result).toBe(join(tmpDir, 'src', 'lib', 'modules', 'auth'));
    });
  });

  describe('output helpers', () => {
    it('should call console.log for log/info/success/warn', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      cmd.testLog('hello');
      expect(logSpy).toHaveBeenCalledWith('hello');

      cmd.testInfo('info msg');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('info msg'));

      cmd.testSuccess('done');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('done'));

      cmd.testWarn('warning');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('warning'));

      cmd.testError('err');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('err'));

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should format table output', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      cmd.testTable(['Name', 'Age'], [['Alice', '30'], ['Bob', '25']]);

      expect(logSpy).toHaveBeenCalled();
      const firstCall = logSpy.mock.calls[0][0];
      expect(firstCall).toContain('Name');
      expect(firstCall).toContain('Age');

      logSpy.mockRestore();
    });

    it('should print newline', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      cmd.testNewLine();
      expect(logSpy).toHaveBeenCalledWith();
      logSpy.mockRestore();
    });
  });

  describe('handle()', () => {
    it('should execute the handle method', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await cmd.handle(['test'], { verbose: true });
      expect(logSpy).toHaveBeenCalledWith('args: test');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Verbose mode'));
      logSpy.mockRestore();
    });
  });

  describe('Cli argument parsing', () => {
    it('supports --no-* syntax for boolean flags', async () => {
      const cli = new Cli();
      const command = new CaptureCommand();

      cli.add(command);

      await cli.run(['capture', '--no-redis', '--soketi', '--name', 'demo', 'arg']);

      expect(command.capturedArgs).toEqual(['arg']);
      expect(command.capturedFlags).toMatchObject({
        redis: false,
        soketi: true,
        name: 'demo',
      });
    });
  });

  describe('built-in command registry', () => {
    it('registers every built-in command with a unique name', () => {
      const names = builtinCommandNames();
      const unique = new Set(names);

      expect(unique.size).toBe(names.length);
      expect(names).toContain('new');
      expect(names).toContain('update');
      expect(names).toContain('search:setup');
      expect(names).toContain('queue:work');
      expect(names).toContain('prod:deploy');
      expect(names).toContain('lint:architecture');
    });

    it('prints help for every built-in command without executing side effects', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cli = new Cli('test');

      for (const CommandClass of BUILTIN_COMMANDS) {
        cli.register(CommandClass);
      }

      for (const commandName of builtinCommandNames()) {
        await cli.run([commandName, '--help']);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
        expect(errorSpy).not.toHaveBeenCalled();
        logSpy.mockClear();
      }

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('bootstrap()', () => {
    it('imports src/app before falling back to database config', async () => {
      mkdirSync(join(tmpDir, 'src'), { recursive: true });
      writeFileSync(
        join(tmpDir, 'src', 'app.ts'),
        `globalThis.__svelarTestAppBooted = true;\n`,
      );

      try {
        await cmd.testBootstrap();
        expect((globalThis as any).__svelarTestAppBooted).toBe(true);
      } finally {
        delete (globalThis as any).__svelarTestAppBooted;
      }
    });
  });

  describe('lint:architecture', () => {
    it('passes a thin generated-style controller route', async () => {
      mkdirSync(join(tmpDir, 'src', 'routes', 'api', 'posts'), { recursive: true });
      mkdirSync(join(tmpDir, 'src', 'lib', 'modules', 'posts', 'interface', 'http', 'controllers'), { recursive: true });
      writeFileSync(
        join(tmpDir, 'src', 'routes', 'api', 'posts', '+server.ts'),
        `import { resource } from '@beeblock/svelar/routing';\nimport { PostController } from '$lib/modules/posts/interface/http/controllers/PostController.js';\nconst { GET, POST } = resource(PostController);\nexport { GET, POST };\n`,
      );

      const command = new LintArchitectureCommand();
      expect(command.scanProject(join(tmpDir, 'src'))).toEqual([]);
    });

    it('detects fat routes, runtime DDL, and mutating browser fetch without apiFetch', async () => {
      mkdirSync(join(tmpDir, 'src', 'routes', 'api', 'posts'), { recursive: true });
      mkdirSync(join(tmpDir, 'src', 'lib'), { recursive: true });
      writeFileSync(
        join(tmpDir, 'src', 'routes', 'api', 'posts', '+server.ts'),
        `import { QueryBuilder } from '@beeblock/svelar/orm';\nexport async function POST() {\n  await new QueryBuilder('posts').insert({ title: 'Bad' });\n  return new Response('ok');\n}\n`,
      );
      writeFileSync(
        join(tmpDir, 'src', 'lib', 'bad-runtime.ts'),
        `export async function boot(schema: any) {\n  await schema.createTable('bad', () => {});\n}\n`,
      );
      writeFileSync(
        join(tmpDir, 'src', 'lib', 'BadForm.svelte'),
        `<script lang="ts">\n  async function save() {\n    await fetch('/api/posts', { method: 'POST', body: '{}' });\n  }\n</script>\n`,
      );

      const command = new LintArchitectureCommand();
      const findings = command.scanProject(join(tmpDir, 'src'));
      expect(findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining([
        'thin-routes',
        'controller-flow',
        'no-runtime-ddl',
        'csrf-api-fetch',
      ]));
    });
  });
});
