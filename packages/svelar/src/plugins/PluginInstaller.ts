/**
 * Svelar Plugin Installer
 *
 * Handles installing plugins from npm and wiring them up.
 */

import { singleton } from '../support/singleton.js';
import { PluginRegistry, type PluginMeta } from './PluginRegistry.js';
import { PluginPublisher, type PublishResult } from './PluginPublisher.js';
import { spawn } from 'node:child_process';

export interface InstallResult {
  success: boolean;
  pluginName: string;
  version: string;
  published: PublishResult | null;
  error?: string;
}

export function normalizePluginPackageSpec(packageSpec: string): string {
  const trimmed = packageSpec.trim();

  if (!trimmed) return trimmed;

  if (trimmed.startsWith('@')) {
    const scopedPackageMatch = trimmed.match(/^(@[^/]+\/[^@/]+)(?:@.+)?$/);
    return scopedPackageMatch?.[1] ?? trimmed;
  }

  return trimmed.replace(/@[^@/]+$/, '');
}

class PluginInstallerService {
  /**
   * Install a plugin package and register it
   */
  async install(
    packageName: string,
    options?: { publish?: boolean }
  ): Promise<InstallResult> {
    const pluginPackageName = normalizePluginPackageSpec(packageName);

    try {
      // 1. Run npm install <packageName>
      await this.runNpmInstall(packageName);

      // 2. Discover the plugin in node_modules
      const registry = PluginRegistry;
      const discovered = await registry.discover();

      let pluginMeta: PluginMeta | undefined;

      // Find the installed plugin by package name or name
      for (const meta of discovered) {
        if (meta.packageName === pluginPackageName || meta.name === pluginPackageName) {
          pluginMeta = meta;
          break;
        }
      }

      if (!pluginMeta) {
        return {
          success: false,
          pluginName: pluginPackageName,
          version: '0.0.0',
          published: null,
          error: `Plugin not found after installation. Make sure ${pluginPackageName} is a valid Svelar plugin.`,
        };
      }

      // 3. Register it in the enabled plugins list
      registry.enable(pluginMeta.name);

      // 4. Optionally publish config/migrations
      let published: PublishResult | null = null;
      if (options?.publish !== false) {
        const plugin = await this.loadPluginClass(pluginMeta.packageName);
        if (plugin) {
          const publisher = PluginPublisher;
          published = await publisher.publish(new plugin());
        }
      }

      return {
        success: true,
        pluginName: pluginMeta.name,
        version: pluginMeta.version,
        published,
      };
    } catch (error: any) {
      return {
        success: false,
        pluginName: pluginPackageName,
        version: '0.0.0',
        published: null,
        error: error?.message ?? String(error),
      };
    }
  }

  /**
   * Uninstall a plugin
   */
  async uninstall(pluginName: string): Promise<boolean> {
    // Get package name from registry
    const registry = PluginRegistry;
    const plugin = registry.get(pluginName);

    if (!plugin) {
      return false;
    }

    // Remove from enabled list
    registry.disable(pluginName);

    // Run npm uninstall
    await this.runNpmUninstall(plugin.packageName);

    return true;
  }

  // ── Private ──────────────────────────────────────────────────

  private async runNpmInstall(packageName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('npm', ['install', packageName], {
        cwd: process.cwd(),
        stdio: 'inherit',
      });

      child.on('close', (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm install exited with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  private async runNpmUninstall(packageName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('npm', ['uninstall', packageName], {
        cwd: process.cwd(),
        stdio: 'inherit',
      });

      child.on('close', (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm uninstall exited with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  private async loadPluginClass(packageName: string): Promise<any> {
    try {
      const mod = await import(`${packageName}/plugin`);
      return mod.default || Object.values(mod)[0];
    } catch (error) {
      throw new Error(
        `Plugin package "${packageName}" must export a server plugin entry at "${packageName}/plugin".`
      );
    }
  }
}

export const PluginInstaller = singleton(
  'svelar.pluginInstaller',
  () => new PluginInstallerService()
);
