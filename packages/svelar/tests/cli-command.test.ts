import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// We can't import the abstract Command directly, so we create a concrete subclass
import { Command, type CommandFlag } from '../src/cli/Command.js';

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
});
