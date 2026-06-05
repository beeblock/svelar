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
  const registry = PluginRegistry;

  // If no explicit list provided, discover all plugins and use enabled ones
  if (!enabledPlugins) {
    await registry.discover();
    enabledPlugins = registry.listEnabled().map((p) => p.name);
  }

  const loadedPlugins: Plugin[] = [];

  // 2. Load each plugin class dynamically
  for (const pluginName of enabledPlugins) {
    const plugin = await loadPluginClass(pluginName);
    loadedPlugins.push(plugin);
  }

  // 3. Register plugins (respecting dependency order)
  const { PluginManager } = await import('./index.js');
  const manager = new PluginManager(app);

  for (const plugin of loadedPlugins) {
    manager.use(plugin);
  }

  // 4. Boot all plugins (in dependency order)
  await manager.boot();
}

/**
 * Load a plugin class by name from node_modules
 */
async function loadPluginClass(pluginName: string): Promise<any> {
  const { join } = await import('node:path');
  const { existsSync, readFileSync } = await import('node:fs');

  const nodeModulesPath = join(process.cwd(), 'node_modules');
  const packagePath = join(nodeModulesPath, pluginName);
  const packageJsonPath = join(packagePath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    throw new Error(`Plugin ${pluginName} not found in node_modules`);
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    const pluginEntry = pkg.exports?.['./plugin']?.default;
    if (!pluginEntry) {
      throw new Error(`Plugin ${pluginName} must define exports["./plugin"].default in package.json`);
    }

    const mod = await import(join(packagePath, pluginEntry));
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
