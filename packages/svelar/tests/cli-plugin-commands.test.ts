import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginInstallCommand } from '../src/cli/commands/PluginInstallCommand.js';
import { PluginListCommand } from '../src/cli/commands/PluginListCommand.js';
import { PluginPublishCommand } from '../src/cli/commands/PluginPublishCommand.js';
import { PluginInstaller } from '../src/plugins/PluginInstaller.js';
import { PluginRegistry } from '../src/plugins/PluginRegistry.js';
import { PluginPublisher } from '../src/plugins/PluginPublisher.js';

describe('Plugin CLI contracts', () => {
  let exitCode: typeof process.exitCode;
  beforeEach(() => {
    exitCode = process.exitCode;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { process.exitCode = exitCode; vi.restoreAllMocks(); });

  it('installs through the public installer with publishing disabled when requested', async () => {
    const install = vi.spyOn(PluginInstaller, 'install').mockResolvedValue({
      success: true, pluginName: 'test-plugin', version: '1.0.0', published: null,
    });
    const command = new PluginInstallCommand();
    await command.handle(['@example/test-plugin@1.0.0'], { 'no-publish': true });
    expect(install).toHaveBeenCalledWith('@example/test-plugin@1.0.0', { publish: false });
    expect(command.exitCode).toBe(0);
  });

  it('reports installer failures as a failed command', async () => {
    vi.spyOn(PluginInstaller, 'install').mockResolvedValue({
      success: false, pluginName: 'test-plugin', version: '0.0.0', published: null, error: 'Installation failed',
    });
    const command = new PluginInstallCommand();
    await command.handle(['@example/test-plugin'], {});
    expect(command.exitCode).toBe(1);
  });

  it('discovers plugins before listing their metadata', async () => {
    const discover = vi.spyOn(PluginRegistry, 'discover').mockResolvedValue([]);
    vi.spyOn(PluginRegistry, 'list').mockReturnValue([]);
    await new PluginListCommand().handle([], {});
    expect(discover).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No plugins discovered'));
  });

  it('publishes selected asset categories through the publisher and reports unknown plugins', async () => {
    vi.spyOn(PluginRegistry, 'discover').mockResolvedValue([]);
    const get = vi.spyOn(PluginRegistry, 'get').mockReturnValue({ name: 'test-plugin', packageName: '@example/test-plugin' } as any);
    class TestPlugin {}
    const command = new PluginPublishCommand();
    vi.spyOn(command as any, 'loadPluginClass').mockResolvedValue(TestPlugin);
    const publish = vi.spyOn(PluginPublisher, 'publish').mockResolvedValue({ configs: ['config/test.ts'], migrations: [], assets: [] });
    await command.handle(['test-plugin'], { only: 'config', force: false });
    expect(publish).toHaveBeenCalledWith(expect.any(TestPlugin), { only: 'config', force: false });

    get.mockReturnValue(undefined);
    const missing = new PluginPublishCommand();
    await missing.handle(['missing-plugin'], {});
    expect(missing.exitCode).toBe(1);
  });
});
