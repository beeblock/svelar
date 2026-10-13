/**
 * make:model — Generate a new Model class
 */

import { Command } from '../Command.js';
import { MakeEntityCommand } from './MakeEntityCommand.js';
import { capabilityFlags } from '../CapabilityScaffold.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeModelCommand extends Command {
  name = 'make:model';
  description = 'Create a new model class';
  arguments = ['name'];
  flags = [
    { name: 'migration', alias: 'm', description: 'Also create a migration', type: 'boolean' as const },
    { name: 'controller', alias: 'c', description: 'Also create a controller', type: 'boolean' as const },
    { name: 'resource', alias: 'r', description: 'Create a resource controller', type: 'boolean' as const },
    { name: 'all', alias: 'a', description: 'Create model, migration, and controller', type: 'boolean' as const },
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
    ...capabilityFlags,
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = this.generatorName(args[0], flags);
    if (!name) {
      this.error('Please provide a model name.');
      return;
    }

    const tableName = this.toSnakeCase(this.pluralize(name));
    const moduleName = flags.module || this.toSnakeCase(this.pluralize(name));
    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    if (flags.controller || flags.resource || flags.all) {
      const command = new MakeEntityCommand();
      await command.handle([name], {
        module: moduleName, crud: Boolean(flags.resource || flags.all),
        'no-migration': !Boolean(flags.migration || flags.all),
        public: flags.public, capability: flags.capability, scope: flags.scope, 'screen-route': flags['screen-route'],
      });
      this.exitCode = command.exitCode;
      return;
    }

    const modelsDir = this.moduleDir(moduleName, 'models', 'model');
    const filePath = this.artifactPath(modelsDir, `${name}.ts`);
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const migrationName = `${timestamp}_create_${tableName}_table`;
    const migrationPath = flags.migration
      ? this.artifactPath(this.containedPath(join(process.cwd(), 'src', 'lib'), 'database', 'migrations'), `${migrationName}.ts`)
      : undefined;
    mkdirSync(modelsDir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`Model ${name} already exists at ${filePath}`);
      return;
    }

    const content = `import { Model } from '@beeblock/svelar/orm';

export class ${name} extends Model {
  static table = '${tableName}';
  static timestamps = true;
  static fillable = []; // Add fillable columns here

  // Declare your typed columns
  declare id: number;
  // declare name: string;
  // declare email: string;

  // Define relationships
  // posts() {
  //   return this.hasMany(Post, 'user_id');
  // }
}
`;

    writeFileSync(filePath, content);
    const relDir = this.moduleRelDir(moduleName, 'models', 'model');
    this.success(`Model created: ${relDir}/${name}.ts`);

    // Create migration if requested
    if (migrationPath) {
      const migrationsDir = this.containedPath(join(process.cwd(), 'src', 'lib'), 'database', 'migrations');
      mkdirSync(migrationsDir, { recursive: true });

      const migrationContent = `import { Migration } from '@beeblock/svelar/database';

export default class Create${name}sTable extends Migration {
  async up() {
    await this.schema.createTable('${tableName}', (table) => {
      table.increments('id');
      // Add your columns here
      // table.string('name');
      // table.string('email').unique();
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('${tableName}');
  }
}
`;

      writeFileSync(migrationPath, migrationContent);
      this.success(`Migration created: src/lib/database/migrations/${migrationName}.ts`);
    }

  }

  private toSnakeCase(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  }

  private pluralize(str: string): string {
    // Simple pluralization — covers common cases
    if (str.endsWith('y')) return str.slice(0, -1) + 'ies';
    if (str.endsWith('s') || str.endsWith('x') || str.endsWith('z') || str.endsWith('ch') || str.endsWith('sh')) {
      return str + 'es';
    }
    return str + 's';
  }
}
