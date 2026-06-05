/**
 * Svelar Plugin Registry
 *
 * Discovers and manages installed plugins by scanning node_modules
 * for packages with the 'svelar-plugin' keyword or 'svelar-' prefix.
 */

import { singleton } from '../support/singleton.js';

export interface PluginMeta {
  name: string;
  version: string;
  description: string;
  packageName: string;
  installed: boolean;
  enabled: boolean;
  hasConfig: boolean;
  hasMigrations: boolean;
}

class PluginRegistryService {
  private plugins = new Map<string, PluginMeta>();
  private enabledPlugins: Set<string> = new Set();

  /**
   * Scan node_modules for svelar plugins
   * Looks for packages with 'svelar-plugin' keyword or starting with 'svelar-'
   */
  async discover(): Promise<PluginMeta[]> {
    const { join } = await import('node:path');
    const { existsSync, readdirSync } = await import('node:fs');
    const { readFile } = await import('node:fs/promises');

    const discovered: PluginMeta[] = [];
    const nodeModulesPath = join(process.cwd(), 'node_modules');

    if (!existsSync(nodeModulesPath)) {
      return discovered;
    }

    const scanDir = async (dir: string, prefix: string = '') => {
      if (!existsSync(dir)) return;

      try {
        const entries = readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('.')) continue;

          // Handle scoped packages (@beeblock/svelar-*)
          if (entry.name.startsWith('@')) {
            const scopeDir = join(dir, entry.name);
            await scanDir(scopeDir, entry.name + '/');
            continue;
          }

          const fullName = prefix + entry.name;

          const packageJsonPath = join(dir, entry.name, 'package.json');
          if (!existsSync(packageJsonPath)) continue;

          try {
            const content = await readFile(packageJsonPath, 'utf-8');
            const pkg = JSON.parse(content);

            // Check for svelar-plugin keyword or svelar-* pattern
            const isSvelarPackage = entry.name.startsWith('svelar-');
            const hasSvelarKeyword = pkg.keywords?.includes('svelar-plugin');
            if (!isSvelarPackage && !hasSvelarKeyword) continue;

            const meta: PluginMeta = {
              name: pkg.name || fullName,
              version: pkg.version || '0.0.0',
              description: pkg.description || '',
              packageName: fullName,
              installed: true,
              enabled: false,
              hasConfig: !!pkg.svelar?.config,
              hasMigrations: !!pkg.svelar?.migrations,
            };

            discovered.push(meta);
            this.plugins.set(meta.name, meta);
          } catch {
            // Skip packages with invalid package.json
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    };

    await scanDir(nodeModulesPath);

    return discovered;
  }

  /**
   * Register a plugin as enabled
   */
  enable(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found in registry.`);
    }
    this.enabledPlugins.add(name);
    plugin.enabled = true;
  }

  /**
   * Disable a plugin
   */
  disable(name: string): void {
    this.enabledPlugins.delete(name);
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enabled = false;
    }
  }

  /**
   * Check if plugin is enabled
   */
  isEnabled(name: string): boolean {
    return this.enabledPlugins.has(name);
  }

  /**
   * Get all registered plugin metadata
   */
  list(): PluginMeta[] {
    return [...this.plugins.values()];
  }

  /**
   * Get enabled plugins
   */
  listEnabled(): PluginMeta[] {
    return [...this.plugins.values()].filter((p) => this.enabledPlugins.has(p.name));
  }

  /**
   * Get a plugin by name
   */
  get(name: string): PluginMeta | undefined {
    return this.plugins.get(name);
  }

  /**
   * Register a plugin in the registry
   */
  register(meta: PluginMeta): void {
    this.plugins.set(meta.name, meta);
  }
}

export const PluginRegistry = singleton(
  'svelar.pluginRegistry',
  () => new PluginRegistryService()
);
