/**
 * make:plugin — Generate a new plugin class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakePluginCommand extends Command {
  name = 'make:plugin';
  description = 'Create a new plugin class';
  arguments = ['name'];
  flags = [];

  async handle(args: string[]): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a plugin name.');
      return;
    }

    const pluginName = name.endsWith('Plugin') ? name : `${name}Plugin`;
    const pluginsDir = join(process.cwd(), 'src', 'lib', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });

    const filePath = join(pluginsDir, `${pluginName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Plugin ${pluginName} already exists.`);
      return;
    }

    const kebabName = pluginName
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '');

    const content = `import { Plugin } from 'svelar/plugins';
import type { Container } from 'svelar/container';

export class ${pluginName} extends Plugin {
  readonly name = '${kebabName}';
  readonly version = '1.0.0';
  description = '${pluginName} for Svelar';

  async register(app: Container): Promise<void> {
    // Register services, configuration, etc.
    // app.singleton('myService', () => new MyService());
  }

  async boot(app: Container): Promise<void> {
    // Resolve dependencies and initialize
    // const service = app.resolve('myService');
  }

  async shutdown(): Promise<void> {
    // Clean up resources
  }
}
`;

    writeFileSync(filePath, content);
    this.success(`Plugin created: src/lib/plugins/${pluginName}.ts`);
  }
}
