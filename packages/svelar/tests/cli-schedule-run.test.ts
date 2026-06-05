import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduleRunCommand } from '../src/cli/commands/ScheduleRunCommand.js';

describe('ScheduleRunCommand', () => {
  let originalCwd: string;
  let root: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    root = await mkdtemp(join(tmpdir(), 'svelar-cli-schedule-'));
    process.chdir(root);
    vi.spyOn(ScheduleRunCommand.prototype as any, 'bootstrap').mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('requires an explicit scheduler registry', async () => {
    await new ScheduleRunCommand().handle([], { once: true });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('No scheduler registry found')
    );
  });

  it('loads the configured scheduler registry and runs due tasks once', async () => {
    const schedulerDir = join(root, 'src', 'lib', 'scheduler');
    await mkdir(schedulerDir, { recursive: true });
    await writeFile(
      join(schedulerDir, 'index.js'),
      `export function createScheduler() {
  return {
    getTasks() {
      return [{ name: 'daily-report' }];
    },
    async run() {
      return [{ task: 'daily-report', success: true, duration: 12 }];
    }
  };
}
`,
    );

    await new ScheduleRunCommand().handle([], { once: true });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Registered task: daily-report')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('daily-report: completed in 12ms')
    );
  });

  it('rejects registry exports that are not scheduler instances', async () => {
    const schedulerDir = join(root, 'src', 'lib', 'shared', 'scheduler');
    await mkdir(schedulerDir, { recursive: true });
    await writeFile(join(schedulerDir, 'index.js'), 'export const scheduler = {};\n');

    await expect(new ScheduleRunCommand().handle([], { once: true })).rejects.toThrow(
      'Failed to load scheduler registry'
    );
  });
});
