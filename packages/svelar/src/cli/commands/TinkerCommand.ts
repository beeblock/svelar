/**
 * tinker — Interactive REPL with models and framework preloaded
 */

import { Command } from '../Command.js';
import { createRequire } from 'node:module';

export class TinkerCommand extends Command {
  name = 'tinker';
  description = 'Start an interactive REPL with Svelar preloaded';
  flags = [];

  async handle(): Promise<void> {
    this.info('Starting Svelar Tinker...');
    this.log('Type .exit to quit. All Svelar modules are available.\n');

    const repl = await import('node:repl');

    const server = repl.start({
      prompt: '\x1b[36msvelar>\x1b[0m ',
      useGlobal: true,
    });

    // Preload Svelar modules into REPL context
    try {
      const svelar = await import('../../index.js');
      for (const [key, value] of Object.entries(svelar)) {
        server.context[key] = value;
      }

      // Convenience aliases
      server.context.DB = svelar.Connection;
      server.context.Schema = svelar.Schema;

      this.log('Available: Model, QueryBuilder, Connection, Schema, Hash, Cache, Event, Log, ...');
      this.log('');
    } catch (error: any) {
      this.warn(`Could not preload all modules: ${error.message}`);
    }

    // Load user's models if available
    try {
      const { readdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { pathToFileURL } = await import('node:url');

      const modelsDir = join(process.cwd(), 'src', 'lib', 'models');
      const modelFiles = readdirSync(modelsDir).filter(
        (f) => f.endsWith('.ts') || f.endsWith('.js')
      );

      for (const file of modelFiles) {
        try {
          const mod = await import(pathToFileURL(join(modelsDir, file)).href);
          for (const [name, exported] of Object.entries(mod)) {
            if (typeof exported === 'function') {
              server.context[name] = exported;
            }
          }
        } catch {
          // Skip files that can't be imported
        }
      }

      if (modelFiles.length > 0) {
        this.log(`Loaded models: ${modelFiles.map((f) => f.replace(/\.(ts|js)$/, '')).join(', ')}`);
      }
    } catch {
      // No models directory
    }

    // Wait for REPL to exit
    await new Promise<void>((resolve) => {
      server.on('exit', resolve);
    });
  }
}
