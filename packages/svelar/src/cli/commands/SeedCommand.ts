/**
 * seed:run — Run database seeders
 */

import { Command } from '../Command.js';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

export class SeedCommand extends Command {
  name = 'seed:run';
  description = 'Run database seeders';
  flags = [
    { name: 'class', description: 'Specific seeder class to run', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const seedersDir = join(process.cwd(), 'src', 'lib', 'database', 'seeders');
    const seederFile = flags.class
      ? join(seedersDir, `${flags.class}.ts`)
      : join(seedersDir, 'DatabaseSeeder.ts');

    // Try .ts first, then .js
    let filePath = seederFile;
    if (!existsSync(filePath)) {
      filePath = filePath.replace(/\.ts$/, '.js');
    }

    if (!existsSync(filePath)) {
      this.error(`Seeder not found: ${seederFile}`);
      process.exit(1);
    }

    this.info('Running seeders...');

    try {
      const module = await import(pathToFileURL(filePath).href);
      const SeederClass = module.default ?? module.DatabaseSeeder ?? Object.values(module).find(
        (v: any) => typeof v === 'function' && v.prototype && typeof v.prototype.run === 'function'
      );

      if (!SeederClass || typeof SeederClass !== 'function') {
        this.error('No seeder class found in file.');
        process.exit(1);
      }

      const seeder = new (SeederClass as any)();
      await seeder.run();
      this.success('Database seeded successfully.');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(`Seeding failed: ${msg}`);
      if (err?.stack) console.error(err.stack);
      process.exit(1);
    }
  }
}
