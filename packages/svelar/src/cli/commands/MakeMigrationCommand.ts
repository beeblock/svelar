/**
 * make:migration — Generate a new migration file
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeMigrationCommand extends Command {
  name = 'make:migration';
  description = 'Create a new migration file';
  arguments = ['name'];
  flags = [
    { name: 'create', description: 'Table to create', type: 'string' as const },
    { name: 'table', description: 'Table to modify', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a migration name (e.g. create_users_table).');
      return;
    }

    const migrationsDir = join(process.cwd(), 'src', 'lib', 'database', 'migrations');
    mkdirSync(migrationsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const fileName = `${timestamp}_${name}`;
    const className = this.toPascalCase(name);

    // Detect if this is a create or alter migration
    const createTable = flags.create ?? this.detectTableName(name, 'create');
    const alterTable = flags.table ?? this.detectTableName(name, 'add');

    let content: string;

    if (createTable) {
      content = `import { Migration } from 'svelar/database';

export default class ${className} extends Migration {
  async up() {
    await this.schema.createTable('${createTable}', (table) => {
      table.increments('id');
      // Add your columns here
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('${createTable}');
  }
}
`;
    } else if (alterTable) {
      content = `import { Migration } from 'svelar/database';

export default class ${className} extends Migration {
  async up() {
    await this.schema.addColumn('${alterTable}', (table) => {
      // Add new columns here
      // table.string('new_column');
    });
  }

  async down() {
    await this.schema.dropColumn('${alterTable}', 'new_column');
  }
}
`;
    } else {
      content = `import { Migration } from 'svelar/database';

export default class ${className} extends Migration {
  async up() {
    // Write your migration here
  }

  async down() {
    // Reverse the migration
  }
}
`;
    }

    writeFileSync(join(migrationsDir, `${fileName}.ts`), content);
    this.success(`Migration created: src/lib/database/migrations/${fileName}.ts`);
  }

  private detectTableName(name: string, prefix: string): string | null {
    const match = name.match(new RegExp(`${prefix}_(.+?)_table`));
    return match ? match[1] : null;
  }

  private toPascalCase(str: string): string {
    return str
      .split('_')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');
  }
}
