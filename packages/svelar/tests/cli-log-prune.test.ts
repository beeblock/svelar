import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogPruneCommand } from '../src/cli/commands/LogPruneCommand.js';
import { Connection } from '../src/database/Connection.js';
import { CreateSvelarLogsTable } from '../src/database/CoreMigrations.js';
import { LogViewer } from '../src/logging/LogViewer.js';

beforeEach(async () => {
  await Connection.disconnect();
  Connection.configure({ default: 'logs', connections: { logs: { driver: 'sqlite', filename: ':memory:' } } });
  await new CreateSvelarLogsTable().up();
  LogViewer.configure({ driver: 'database', retentionSeconds: 60, pruneBatchSize: 2, pruneMaxBatches: 1 });
  vi.spyOn(LogPruneCommand.prototype as any, 'bootstrap').mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => { vi.restoreAllMocks(); LogViewer.configure({ driver: 'memory' }); await Connection.disconnect(); });

describe('log:prune', () => {
  it('uses configured retention and bounds, reports actual deletions and accepts bounded flag overrides', async () => {
    await LogViewer.addEntries(Array.from({ length: 5 }, (_, i) => ({
      timestamp: new Date(Date.now() - 120_000).toISOString(), level: 'info' as const, message: `expired-${i}`, context: {},
    })));
    await LogViewer.addEntry({ timestamp: new Date().toISOString(), level: 'warn', message: 'recent', context: {} });
    const command = new LogPruneCommand();
    expect(command.name).toBe('log:prune');
    await command.handle([], {});
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Pruned 2 expired log entries'));
    expect(await LogViewer.query()).toHaveLength(4);
    await command.handle([], { 'batch-size': '1', 'max-batches': '2' });
    expect(await LogViewer.query()).toHaveLength(2);
    await command.handle([], {});
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Pruned 1 expired log entries'));
    expect((await LogViewer.query()).map((row) => row.message)).toEqual(['recent']);
  });

  it.each([
    { 'batch-size': '0' }, { 'batch-size': '1.5' }, { 'max-batches': '10001' }, { 'max-batches': '2junk' },
    { 'batch-size': true }, { 'max-batches': '' }, { 'batch-size': '1e3' },
  ])('rejects unsafe flags %j before bootstrapping or pruning', async (flags) => {
    const prune = vi.spyOn(LogViewer, 'prune');
    const command = new LogPruneCommand();
    await expect(command.handle([], flags)).rejects.toThrow('must be an integer between 1 and 10000');
    expect((LogPruneCommand.prototype as any).bootstrap).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
  });

  it('rejects positional arguments before application bootstrap', async () => {
    await expect(new LogPruneCommand().handle(['anything'], {})).rejects.toThrow('does not accept positional');
    expect((LogPruneCommand.prototype as any).bootstrap).not.toHaveBeenCalled();
  });

  it.each(['dry-run', 'retention-seconds', 'force'])('rejects unsupported --%s instead of silently running destructive maintenance', async (flag) => {
    const prune = vi.spyOn(LogViewer, 'prune');
    await expect(new LogPruneCommand().handle([], { [flag]: true })).rejects.toThrow(`Unsupported log:prune flag --${flag}`);
    expect((LogPruneCommand.prototype as any).bootstrap).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
  });

  it.each(['memory', 'disabled', 'unconfigured'])('refuses a %s viewer instead of claiming shared retention', async (mode) => {
    if (mode === 'memory') LogViewer.configure({ driver: 'memory' });
    if (mode === 'disabled') LogViewer.configure({ driver: 'database', enabled: false });
    if (mode === 'unconfigured') vi.spyOn(LogViewer, 'isConfigured').mockReturnValue(false);
    const prune = vi.spyOn(LogViewer, 'prune');
    await expect(new LogPruneCommand().handle([], {})).rejects.toThrow('explicitly configured, enabled database log viewer');
    expect(prune).not.toHaveBeenCalled();
  });

  it('propagates bootstrap and storage failures, with no success output', async () => {
    const bootstrap = vi.mocked((LogPruneCommand.prototype as any).bootstrap);
    bootstrap.mockRejectedValueOnce(new Error('bootstrap failed'));
    const prune = vi.spyOn(LogViewer, 'prune');
    await expect(new LogPruneCommand().handle([], {})).rejects.toThrow('bootstrap failed');
    expect(prune).not.toHaveBeenCalled();
    prune.mockRejectedValueOnce(new Error('delete failed'));
    await expect(new LogPruneCommand().handle([], {})).rejects.toThrow('delete failed');
    expect(console.log).not.toHaveBeenCalled();
  });
});
