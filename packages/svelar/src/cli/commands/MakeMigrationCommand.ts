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
    const normalizedName = this.toSnakeCase(name);
    const fileName = `${timestamp}_${normalizedName}`;
    const className = this.toPascalCase(name);

    // Detect if this is a create or alter migration
    const createTable = flags.create ?? this.detectCreateTableName(normalizedName);
    const alterTable = flags.table ?? this.detectAlterTableName(normalizedName);

    let content: string;

    if (createTable) {
      content = `import { Migration } from '@beeblock/svelar/database';

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
      content = `import { Migration } from '@beeblock/svelar/database';

export default class ${className} extends Migration {
  async up() {
    await this.schema.table('${alterTable}', (table) => {
      // Add new columns here
      // table.string('new_column');
    });
  }

  async down() {
    await this.schema.table('${alterTable}', (table) => {
      table.dropColumn('new_column');
    });
  }
}
`;
    } else {
      content = `import { Migration } from '@beeblock/svelar/database';

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

  private detectCreateTableName(name: string): string | null {
    const match = name.match(/^create_(.+)_table$/);
    return match ? match[1] : null;
  }

  private detectAlterTableName(name: string): string | null {
    const match = name.match(/^(?:add|change|update|remove|drop)_.+_(?:to|from|on)_(.+)$/);
    return match ? match[1] : null;
  }

  private toPascalCase(str: string): string {
    return this.toSnakeCase(str)
      .split('_')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/[-\s]+/g, '_')
      .toLowerCase();
  }
}
