/**
 * ResendPlugin
 *
 * Main plugin class that extends the Svelar Plugin base class.
 * Registers the Resend email driver with the Mail facade.
 */

import type { Container } from 'svelar/plugins';
import { Plugin, type PluginConfig } from 'svelar/plugins';
import type { ResendConfig } from './config/resend.js';
import { ResendMailDriver } from './drivers/ResendMailDriver.js';

export class ResendPlugin extends Plugin {
  name = 'svelar-resend';
  version = '0.1.0';
  description = 'Resend email driver plugin for Svelar';

  /**
   * Register services into the container
   */
  async register(app: Container): Promise<void> {
    // ResendMailDriver registration happens in boot
  }

  /**
   * Bootstrap the plugin after all plugins are registered
   */
  async boot(app: Container): Promise<void> {
    // Get Resend configuration
    const config = app.make('config.resend') as ResendConfig;

    if (!config.apiKey) {
      throw new Error(
        'Resend plugin requires RESEND_API_KEY environment variable',
      );
    }

    // Register Resend driver with Mail facade
    const mailManager = app.make('mail') as any;
    if (mailManager && typeof mailManager.registerDriver === 'function') {
      const driver = new ResendMailDriver(config);
      mailManager.registerDriver('resend', driver);
    }
  }

  /**
   * Get the default configuration for this plugin
   */
  config(): PluginConfig {
    return {
      key: 'resend',
      defaults: {
        apiKey: process.env.RESEND_API_KEY ?? '',
        from: process.env.MAIL_FROM ?? 'hello@example.com',
      },
    };
  }

  /**
   * Get publishable files (config, etc.)
   */
  publishables?(): Record<
    string,
    Array<{ source: string; dest: string; type?: 'config' | 'migration' | 'asset' }>
  > {
    return {
      config: [
        {
          source: './config/resend.ts',
          dest: 'config/plugins/resend.ts',
          type: 'config',
        },
      ],
    };
  }
}

export default ResendPlugin;
