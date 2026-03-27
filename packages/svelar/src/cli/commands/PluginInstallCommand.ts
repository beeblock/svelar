/**
 * plugin:install — Install a plugin from npm
 */

import { Command } from '../Command.js';

export class PluginInstallCommand extends Command {
  name = 'plugin:install';
  description = 'Install a plugin from npm';
  arguments = ['package'];
  flags = [
    {
      name: 'no-publish',
      alias: 'n',
      description: 'Skip auto-publishing plugin assets',
      type: 'boolean' as const,
    },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const packageName = args[0];

    if (!packageName) {
      this.error('Please provide a package name.');
      return;
    }

    try {
      const { PluginInstaller } = await import('../../plugins/PluginInstaller.js');

      const installer = PluginInstaller;

      this.info(`Installing plugin package: ${packageName}`);
      this.newLine();

      const result = await installer.install(packageName, {
        publish: !flags['no-publish'],
      });

      this.newLine();

      if (result.success) {
        this.success(`Plugin installed: ${result.pluginName} (v${result.version})`);

        if (result.published) {
          if (result.published.configs.length > 0) {
            this.info(`${result.published.configs.length} config file(s) published`);
          }
          if (result.published.migrations.length > 0) {
            this.info(`${result.published.migrations.length} migration file(s) published`);
          }
          if (result.published.assets.length > 0) {
            this.info(`${result.published.assets.length} asset file(s) published`);
          }
        }

        this.newLine();
        this.log(
          `You can now use the plugin in your application by registering it in your app bootstrap code.`
        );
      } else {
        this.error(`Failed to install plugin: ${result.error}`);
      }

      this.newLine();
    } catch (error: any) {
      this.error(`Installation error: ${error?.message ?? String(error)}`);
    }
  }
}
