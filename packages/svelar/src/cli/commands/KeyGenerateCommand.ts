/**
 * key:generate — Generate a new APP_KEY and write it to .env
 */

import { Command } from '../Command.js';

export class KeyGenerateCommand extends Command {
  name = 'key:generate';
  description = 'Generate a new APP_KEY and set it in .env';

  flags = [
    { name: 'show', alias: 's', description: 'Only display the key, do not write to .env', type: 'boolean' as const, default: false },
    { name: 'force', alias: 'f', description: 'Overwrite existing APP_KEY', type: 'boolean' as const, default: false },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const { randomBytes } = await import('node:crypto');
    const { join } = await import('node:path');
    const { existsSync, readFileSync, writeFileSync } = await import('node:fs');

    const key = randomBytes(32).toString('hex');

    if (flags.show) {
      this.log(`\n  APP_KEY=${key}\n`);
      return;
    }

    const envPath = join(process.cwd(), '.env');

    if (!existsSync(envPath)) {
      // Create .env with just the key
      const examplePath = join(process.cwd(), '.env.example');
      if (existsSync(examplePath)) {
        let content = readFileSync(examplePath, 'utf-8');
        content = content.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`);
        writeFileSync(envPath, content);
        this.success('Application key set (created .env from .env.example).');
      } else {
        writeFileSync(envPath, `APP_KEY=${key}\n`);
        this.success('Application key set (created .env).');
      }
      return;
    }

    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^APP_KEY=(.*)$/m);

    if (match && match[1] && match[1] !== 'change-me-to-a-random-string' && !flags.force) {
      this.warn('APP_KEY already set. Use --force to overwrite.');
      return;
    }

    if (match) {
      const updated = content.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`);
      writeFileSync(envPath, updated);
    } else {
      writeFileSync(envPath, `APP_KEY=${key}\n${content}`);
    }

    this.success('Application key set.');
  }
}
