/**
 * plugin:publish — Publish a plugin's config and migrations
 */

import { Command } from '../Command.js';

export class PluginPublishCommand extends Command {
  name = 'plugin:publish';
  description = 'Publish a plugin\'s config and migration files';
  arguments = ['name'];
  flags = [
    {
      name: 'force',
      alias: 'f',
      description: 'Overwrite existing files',
      type: 'boolean' as const,
    },
    {
      name: 'only',
      alias: 'o',
      description: 'Publish only config|migrations|assets',
      type: 'string' as const,
    },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const pluginName = args[0];

    if (!pluginName) {
      this.error('Please provide a plugin name.');
      return;
    }

    try {
      const { PluginRegistry } = await import('../../plugins/PluginRegistry.js');
      const { PluginPublisher } = await import('../../plugins/PluginPublisher.js');

      const registry = PluginRegistry;
      const publisher = PluginPublisher;

      // Discover plugins
      await registry.discover();

      const plugin = registry.get(pluginName);
      if (!plugin) {
        this.error(`Plugin "${pluginName}" not found.`);
        return;
      }

      // Try to load the plugin class
      const PluginClass = await this.loadPluginClass(plugin.packageName);
      if (!PluginClass) {
        this.error(`Failed to load plugin class for "${pluginName}".`);
        return;
      }

      const pluginInstance = new PluginClass();
      const options = {
        force: flags.force || false,
        only: flags.only as 'config' | 'migrations' | 'assets' | undefined,
      };

      this.info(`Publishing plugin: ${pluginName}`);
      const result = await publisher.publish(pluginInstance, options);

      this.newLine();
      if (result.configs.length > 0) {
        this.success(`${result.configs.length} config file(s) published:`);
        result.configs.forEach((f) => this.log(`  - ${f}`));
      }

      if (result.migrations.length > 0) {
        this.success(`${result.migrations.length} migration file(s) published:`);
        result.migrations.forEach((f) => this.log(`  - ${f}`));
      }

      if (result.assets.length > 0) {
        this.success(`${result.assets.length} asset file(s) published:`);
        result.assets.forEach((f) => this.log(`  - ${f}`));
      }

      if (
        result.configs.length === 0 &&
        result.migrations.length === 0 &&
        result.assets.length === 0
      ) {
        this.warn('No publishable files found for this plugin.');
      }

      this.newLine();
    } catch (error: any) {
      this.error(`Failed to publish plugin: ${error?.message ?? String(error)}`);
    }
  }

  private async loadPluginClass(packageName: string): Promise<any> {
    try {
      const mod = await import(packageName);
      return mod.default || Object.values(mod)[0];
    } catch {
      return null;
    }
  }
}
