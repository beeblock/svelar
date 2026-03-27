/**
 * PostmarkPlugin
 *
 * Main plugin class that extends the Svelar Plugin base class.
 * Registers the Postmark email driver with the Mail facade.
 */

import type { Container } from 'svelar/plugins';
import { Plugin, type PluginConfig } from 'svelar/plugins';
import type { PostmarkConfig } from './config/postmark.js';
import { PostmarkMailDriver } from './drivers/PostmarkMailDriver.js';

export class PostmarkPlugin extends Plugin {
  name = 'svelar-postmark';
  version = '0.1.0';
  description = 'Postmark email driver plugin for Svelar';

  /**
   * Register services into the container
   */
  async register(app: Container): Promise<void> {
    // PostmarkMailDriver registration happens in boot
  }

  /**
   * Bootstrap the plugin after all plugins are registered
   */
  async boot(app: Container): Promise<void> {
    // Get Postmark configuration
    const config = app.make('config.postmark') as PostmarkConfig;

    if (!config.serverToken) {
      throw new Error(
        'Postmark plugin requires POSTMARK_SERVER_TOKEN environment variable',
      );
    }

    // Register Postmark driver with Mail facade
    const mailManager = app.make('mail') as any;
    if (mailManager && typeof mailManager.registerDriver === 'function') {
      const driver = new PostmarkMailDriver(config);
      mailManager.registerDriver('postmark', driver);
    }
  }

  /**
   * Get the default configuration for this plugin
   */
  config(): PluginConfig {
    return {
      key: 'postmark',
      defaults: {
        serverToken: process.env.POSTMARK_SERVER_TOKEN ?? '',
        from: process.env.MAIL_FROM ?? 'hello@example.com',
        messageStream: 'outbound',
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
          source: './config/postmark.ts',
          dest: 'config/plugins/postmark.ts',
          type: 'config',
        },
      ],
    };
  }
}

export default PostmarkPlugin;
