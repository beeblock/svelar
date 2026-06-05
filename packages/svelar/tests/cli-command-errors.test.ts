import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NewCommand } from '../src/cli/commands/NewCommand.js';
import { SeedCommand } from '../src/cli/commands/SeedCommand.js';
import { MigrateCommand } from '../src/cli/commands/MigrateCommand.js';
import { QueueRetryCommand } from '../src/cli/commands/QueueRetryCommand.js';
import { Queue } from '../src/queue/index.js';

describe('CLI command errors', () => {
  let originalCwd: string;
  let originalNodeEnv: string | undefined;
  let root: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalNodeEnv = process.env.NODE_ENV;
    root = await mkdtemp(join(tmpdir(), 'svelar-cli-errors-'));
    process.chdir(root);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit should not be called by command handlers');
    }) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('throws instead of exiting when new is missing a project name', async () => {
    await expect(new NewCommand().handle([], {})).rejects.toThrow(
      'Please provide a project name'
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws instead of exiting when the target project directory exists', async () => {
    await mkdir(join(root, 'existing-app'));

    await expect(new NewCommand().handle(['existing-app'], {})).rejects.toThrow(
      'Directory "existing-app" already exists.'
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws instead of exiting when a seeder is missing', async () => {
    vi.spyOn(SeedCommand.prototype as any, 'bootstrap').mockResolvedValue(undefined);

    await expect(new SeedCommand().handle([], {})).rejects.toThrow(
      'Seeder not found'
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws instead of exiting when a seeder file has no runnable class', async () => {
    vi.spyOn(SeedCommand.prototype as any, 'bootstrap').mockResolvedValue(undefined);
    const seedersDir = join(root, 'src', 'lib', 'database', 'seeders');
    await mkdir(seedersDir, { recursive: true });
    await writeFile(join(seedersDir, 'DatabaseSeeder.ts'), 'export const value = 1;\n');

    await expect(new SeedCommand().handle([], {})).rejects.toThrow(
      'Seeding failed: No seeder class found in file.'
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws instead of exiting for destructive migrations in production without force', async () => {
    vi.spyOn(MigrateCommand.prototype as any, 'bootstrap').mockResolvedValue(undefined);
    process.env.NODE_ENV = 'production';

    await expect(new MigrateCommand().handle([], { fresh: true })).rejects.toThrow(
      'cannot be run in production'
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws instead of exiting when queue:retry has no job id', async () => {
    vi.spyOn(QueueRetryCommand.prototype as any, 'bootstrap').mockResolvedValue(undefined);

    await expect(new QueueRetryCommand().handle([], { all: false })).rejects.toThrow(
      'Please provide a failed job ID'
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('surfaces partial queue:retry --all failures', async () => {
    vi.spyOn(QueueRetryCommand.prototype as any, 'bootstrap').mockResolvedValue(undefined);
    const partialFailure = Object.assign(new Error('partial retry failure'), {
      retried: 1,
      failures: [
        {
          id: 'failed-1',
          jobClass: 'MissingJob',
          error: 'Job class "MissingJob" is not registered.',
        },
      ],
    });
    vi.spyOn(Queue, 'retryAll').mockRejectedValue(partialFailure);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(new QueueRetryCommand().handle([], { all: true })).rejects.toThrow(
      'partial retry failure'
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Retried 1 job(s).'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Could not retry failed-1'));
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
