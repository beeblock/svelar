/**
 * make:provider — Generate a new service provider
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeProviderCommand extends Command {
  name = 'make:provider';
  description = 'Create a new service provider class';
  arguments = ['name'];
  flags = [];

  async handle(args: string[]): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a provider name.');
      return;
    }

    const providerName = name.endsWith('ServiceProvider') ? name : `${name}ServiceProvider`;
    const providersDir = join(process.cwd(), 'src', 'lib', 'providers');
    mkdirSync(providersDir, { recursive: true });

    const filePath = join(providersDir, `${providerName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Provider ${providerName} already exists.`);
      return;
    }

    const content = `import { ServiceProvider } from 'svelar/container';
import type { Container } from 'svelar/container';

export class ${providerName} extends ServiceProvider {
  /**
   * Register services in the container.
   * Called before boot().
   */
  register(): void {
    // this.app.singleton('myService', (container) => {
    //   return new MyService();
    // });
  }

  /**
   * Bootstrap services after all providers are registered.
   */
  boot(): void {
    // Initialization logic here
  }
}
`;

    writeFileSync(filePath, content);
    this.success(`Provider created: src/lib/providers/${providerName}.ts`);
  }
}
