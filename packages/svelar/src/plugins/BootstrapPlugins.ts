/**
 * Svelar Bootstrap Plugins
 *
 * Auto-discovers and boots enabled plugins at app startup.
 */

import type { Container } from '../container/Container.js';
import type { Plugin } from './index.js';
import { PluginRegistry } from './PluginRegistry.js';

/**
 * Bootstrap plugins from the plugin registry
 * Loads enabled plugins from configuration and boots them
 */
export async function bootstrapPlugins(
  app: Container,
  enabledPlugins?: string[]
): Promise<void> {
  const { join } = await import('node:path');

  const registry = PluginRegistry;

  // If no explicit list provided, discover all plugins and use enabled ones
  if (!enabledPlugins) {
    await registry.discover();
    enabledPlugins = registry.listEnabled().map((p) => p.name);
  }

  const loadedPlugins: Plugin[] = [];
  const failedPlugins: string[] = [];

  // 2. Load each plugin class dynamically
  for (const pluginName of enabledPlugins) {
    try {
      const plugin = await loadPluginClass(pluginName);
      if (plugin) {
        loadedPlugins.push(plugin);
      } else {
        failedPlugins.push(pluginName);
      }
    } catch (error) {
      console.warn(`Failed to load plugin ${pluginName}:`, error);
      failedPlugins.push(pluginName);
    }
  }

  // 3. Register plugins (respecting dependency order)
  const { PluginManager } = await import('./index.js');
  const manager = new PluginManager(app);

  for (const plugin of loadedPlugins) {
    manager.use(plugin);
  }

  // 4. Boot all plugins (in dependency order)
  await manager.boot();

  if (failedPlugins.length > 0) {
    console.warn(
      `Warning: Failed to load plugins: ${failedPlugins.join(', ')}`
    );
  }
}

/**
 * Load a plugin class by name from node_modules
 */
async function loadPluginClass(pluginName: string): Promise<any> {
  const { join } = await import('node:path');
  const { existsSync, readFileSync } = await import('node:fs');

  // Try different entry points
  const nodeModulesPath = join(process.cwd(), 'node_modules');
  const packagePath = join(nodeModulesPath, pluginName);
  const packageJsonPath = join(packagePath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    throw new Error(`Plugin ${pluginName} not found in node_modules`);
  }

  try {
    // Read package.json to find main entry
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const main = pkg.main || 'index.js';
    const fullPath = join(packagePath, main);

    // Try to load the plugin
    const mod = await import(fullPath);
    const PluginClass = mod.default || Object.values(mod)[0];

    if (!PluginClass) {
      throw new Error(`No default export found in ${pluginName}`);
    }

    return new PluginClass();
  } catch (error) {
    throw new Error(
      `Failed to load plugin ${pluginName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
