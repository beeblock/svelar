/**
 * seed:run — Run database seeders
 */

import { Command } from '../Command.js';
import { join } from 'node:path';
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
      throw new Error(`Seeder not found: ${seederFile}`);
    }

    this.info('Running seeders...');

    try {
      const module = await this.importUserModule(filePath);
      const SeederClass = [module.DatabaseSeeder, module.default, ...Object.values(module)].find(
        (v: any) => typeof v === 'function' && v.prototype && typeof v.prototype.run === 'function'
      );

      if (!SeederClass || typeof SeederClass !== 'function') {
        throw new Error('No seeder class found in file.');
      }

      const seeder = new (SeederClass as any)();
      await seeder.run();
      this.success('Database seeded successfully.');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Seeding failed: ${msg}`);
    }
  }
}
