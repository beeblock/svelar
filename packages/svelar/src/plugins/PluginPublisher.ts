/**
 * Svelar Plugin Publisher
 *
 * Handles publishing a plugin's configuration files, migrations,
 * and assets to the user's application.
 */

import { singleton } from '../support/singleton.js';
import type { Plugin } from './index.js';

export interface PublishResult {
  configs: string[]; // paths of published config files
  migrations: string[]; // paths of published migration files
  assets: string[]; // paths of published asset files
}

export interface PublishableFile {
  source: string;
  dest: string;
  type: 'config' | 'migration' | 'asset';
}

class PluginPublisherService {
  /**
   * Publish a plugin's publishable assets
   */
  async publish(
    plugin: Plugin,
    options?: { force?: boolean; only?: 'config' | 'migrations' | 'assets' }
  ): Promise<PublishResult> {
    const { mkdir, copyFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { existsSync } = await import('node:fs');

    const result: PublishResult = {
      configs: [],
      migrations: [],
      assets: [],
    };

    // Get publishables from the plugin
    const publishables = plugin.publishables?.() || {};

    for (const [key, files] of Object.entries(publishables)) {
      for (const file of files) {
        // Skip if not in the specified filter
        if (options?.only && file.type !== options.only) {
          continue;
        }

        const destPath = join(process.cwd(), file.dest);
        const destDir = dirname(destPath);

        // Check if already exists and force flag is not set
        if (existsSync(destPath) && !options?.force) {
          continue;
        }

        try {
          // Create destination directory
          await mkdir(destDir, { recursive: true });

          // Copy the file
          await copyFile(file.source, destPath);

          // Track published file
          if (file.type === 'config') {
            result.configs.push(destPath);
          } else if (file.type === 'migration') {
            result.migrations.push(destPath);
          } else if (file.type === 'asset') {
            result.assets.push(destPath);
          }
        } catch (error) {
          console.warn(`Failed to publish ${file.source} to ${destPath}:`, error);
        }
      }
    }

    return result;
  }

  /**
   * Check what would be published without actually publishing
   */
  async preview(plugin: Plugin): Promise<PublishResult> {
    const result: PublishResult = {
      configs: [],
      migrations: [],
      assets: [],
    };

    const publishables = plugin.publishables?.() || {};

    for (const [key, files] of Object.entries(publishables)) {
      for (const file of files) {
        const path = require('node:path').join(process.cwd(), file.dest);

        if (file.type === 'config') {
          result.configs.push(path);
        } else if (file.type === 'migration') {
          result.migrations.push(path);
        } else if (file.type === 'asset') {
          result.assets.push(path);
        }
      }
    }

    return result;
  }
}

export const PluginPublisher = singleton(
  'svelar.pluginPublisher',
  () => new PluginPublisherService()
);
