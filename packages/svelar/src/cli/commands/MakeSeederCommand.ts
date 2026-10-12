/**
 * make:seeder — Generate a new database seeder
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeSeederCommand extends Command {
  name = 'make:seeder';
  description = 'Create a new database seeder class';
  arguments = ['name'];
  flags = [];

  async handle(args: string[], flags: Record<string, unknown> = {}): Promise<void> {
    const name = this.generatorName(args[0], flags);
    if (!name) {
      this.error('Please provide a seeder name.');
      return;
    }

    const seederName = name.endsWith('Seeder') ? name : `${name}Seeder`;
    const seedersDir = this.containedPath(join(process.cwd(), 'src', 'lib'), 'database', 'seeders');
    const filePath = this.artifactPath(seedersDir, `${seederName}.ts`);
    mkdirSync(seedersDir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`Seeder ${seederName} already exists.`);
      return;
    }

    const content = `import { Seeder } from '@beeblock/svelar/database';

export class ${seederName} extends Seeder {
  async run(): Promise<void> {
    // Seed your database here
    // Example:
    // await User.create({ name: 'Admin', email: 'admin@example.com' });
  }
}
`;

    writeFileSync(filePath, content);
    this.success(`Seeder created: src/lib/database/seeders/${seederName}.ts`);
  }
}
