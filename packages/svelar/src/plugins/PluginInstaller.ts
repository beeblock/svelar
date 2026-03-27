/**
 * Svelar Plugin Installer
 *
 * Handles installing plugins from npm and wiring them up.
 */

import { singleton } from '../support/singleton.js';
import { PluginRegistry, type PluginMeta } from './PluginRegistry.js';
import { PluginPublisher, type PublishResult } from './PluginPublisher.js';

export interface InstallResult {
  success: boolean;
  pluginName: string;
  version: string;
  published: PublishResult | null;
  error?: string;
}

class PluginInstallerService {
  /**
   * Install a plugin package and register it
   */
  async install(
    packageName: string,
    options?: { publish?: boolean }
  ): Promise<InstallResult> {
    const { spawn } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { join } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');

    try {
      // 1. Run npm install <packageName>
      await this.runNpmInstall(packageName);

      // 2. Discover the plugin in node_modules
      const registry = PluginRegistry;
      const discovered = await registry.discover();

      let pluginMeta: PluginMeta | undefined;

      // Find the installed plugin by package name or name
      for (const meta of discovered) {
        if (meta.packageName === packageName || meta.name === packageName) {
          pluginMeta = meta;
          break;
        }
      }

      if (!pluginMeta) {
        return {
          success: false,
          pluginName: packageName,
          version: '0.0.0',
          published: null,
          error: `Plugin not found after installation. Make sure ${packageName} is a valid Svelar plugin.`,
        };
      }

      // 3. Register it in the enabled plugins list
      registry.enable(pluginMeta.name);

      // 4. Optionally publish config/migrations
      let published: PublishResult | null = null;
      if (options?.publish !== false) {
        try {
          const plugin = await this.loadPluginClass(pluginMeta.packageName);
          if (plugin) {
            const publisher = PluginPublisher;
            published = await publisher.publish(new plugin());
          }
        } catch (error) {
          console.warn('Failed to publish plugin assets:', error);
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
        pluginName: packageName,
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
    try {
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
    } catch (error) {
      console.error('Failed to uninstall plugin:', error);
      return false;
    }
  }

  // ── Private ──────────────────────────────────────────────────

  private async runNpmInstall(packageName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('node:child_process');
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
      const { spawn } = require('node:child_process');
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
      const mod = await import(packageName);
      return mod.default || Object.values(mod)[0];
    } catch {
      return null;
    }
  }
}

export const PluginInstaller = singleton(
  'svelar.pluginInstaller',
  () => new PluginInstallerService()
);
