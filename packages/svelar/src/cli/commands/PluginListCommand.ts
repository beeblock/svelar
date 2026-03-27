/**
 * plugin:list — List all discovered and enabled plugins
 */

import { Command } from '../Command.js';

export class PluginListCommand extends Command {
  name = 'plugin:list';
  description = 'List all discovered and enabled plugins';
  arguments: string[] = [];
  flags = [];

  async handle(_args: string[], _flags: Record<string, any>): Promise<void> {
    try {
      const { PluginRegistry } = await import('../../plugins/PluginRegistry.js');

      const registry = PluginRegistry;
      await registry.discover();

      const plugins = registry.list();

      if (plugins.length === 0) {
        this.info('No plugins discovered.');
        return;
      }

      const headers = ['Name', 'Version', 'Description', 'Status', 'Config', 'Migrations'];
      const rows = plugins.map((p) => [
        p.name,
        p.version,
        p.description || '-',
        p.enabled ? '✓ Enabled' : '  Disabled',
        p.hasConfig ? '✓' : '-',
        p.hasMigrations ? '✓' : '-',
      ]);

      this.newLine();
      this.table(headers, rows);
      this.newLine();
      this.info(`Total: ${plugins.length} plugin(s)`);
    } catch (error: any) {
      this.error(`Failed to list plugins: ${error?.message ?? String(error)}`);
    }
  }
}
