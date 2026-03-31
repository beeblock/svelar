/**
 * make:model — Generate a new Model class
 */

import { Command } from '../Command.js';
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
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a model name.');
      return;
    }

    const tableName = this.toSnakeCase(this.pluralize(name));
    const moduleName = flags.module || this.toSnakeCase(this.pluralize(name));
    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    const modelsDir = this.moduleDir(moduleName, 'models');
    mkdirSync(modelsDir, { recursive: true });

    const filePath = join(modelsDir, `${name}.ts`);
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
    const relDir = this.isDDD() ? `src/lib/modules/${moduleName}` : 'src/lib/models';
    this.success(`Model created: ${relDir}/${name}.ts`);

    // Create migration if requested
    if (flags.migration || flags.all) {
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      const migrationName = `${timestamp}_create_${tableName}_table`;
      const migrationsDir = join(process.cwd(), 'src', 'lib', 'database', 'migrations');
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

      writeFileSync(join(migrationsDir, `${migrationName}.ts`), migrationContent);
      this.success(`Migration created: src/lib/database/migrations/${migrationName}.ts`);
    }

    // Create controller if requested
    if (flags.controller || flags.resource || flags.all) {
      const controllerName = `${name}Controller`;
      const controllerDir = this.moduleDir(moduleName, 'controllers');
      mkdirSync(controllerDir, { recursive: true });

      const isResource = flags.resource || flags.all;
      const modelImportPath = this.isDDD() ? `./${name}.js` : `../models/${name}.js`;
      const controllerContent = isResource
        ? this.generateResourceController(name, controllerName, modelImportPath)
        : this.generateBasicController(name, controllerName, modelImportPath);

      writeFileSync(join(controllerDir, `${controllerName}.ts`), controllerContent);
      const ctrlRelDir = this.isDDD() ? `src/lib/modules/${moduleName}` : 'src/lib/controllers';
      this.success(`Controller created: ${ctrlRelDir}/${controllerName}.ts`);
    }
  }

  private generateResourceController(modelName: string, controllerName: string, modelImportPath: string = `./${modelName}.js`): string {
    return `import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { z } from '@beeblock/svelar/validation';
import { ${modelName} } from '${modelImportPath}';

export class ${controllerName} extends Controller {
  /** GET /api/${this.toSnakeCase(this.pluralize(modelName))} */
  async index(event: RequestEvent) {
    const ${this.pluralize(modelName.toLowerCase())} = await ${modelName}.all();
    return this.json(${this.pluralize(modelName.toLowerCase())});
  }

  /** POST /api/${this.toSnakeCase(this.pluralize(modelName))} */
  async store(event: RequestEvent) {
    const data = await this.validate(event, z.object({
      // Define validation rules
    }));
    const ${modelName.toLowerCase()} = await ${modelName}.create(data);
    return this.created(${modelName.toLowerCase()});
  }

  /** GET /api/${this.toSnakeCase(this.pluralize(modelName))}/[id] */
  async show(event: RequestEvent) {
    const ${modelName.toLowerCase()} = await ${modelName}.findOrFail(event.params.id);
    return this.json(${modelName.toLowerCase()});
  }

  /** PUT /api/${this.toSnakeCase(this.pluralize(modelName))}/[id] */
  async update(event: RequestEvent) {
    const ${modelName.toLowerCase()} = await ${modelName}.findOrFail(event.params.id);
    const data = await this.validate(event, z.object({
      // Define validation rules
    }));
    await ${modelName.toLowerCase()}.update(data);
    return this.json(${modelName.toLowerCase()});
  }

  /** DELETE /api/${this.toSnakeCase(this.pluralize(modelName))}/[id] */
  async destroy(event: RequestEvent) {
    const ${modelName.toLowerCase()} = await ${modelName}.findOrFail(event.params.id);
    await ${modelName.toLowerCase()}.delete();
    return this.noContent();
  }
}
`;
  }

  private generateBasicController(modelName: string, controllerName: string, modelImportPath: string = `./${modelName}.js`): string {
    return `import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { ${modelName} } from '${modelImportPath}';

export class ${controllerName} extends Controller {
  async index(event: RequestEvent) {
    const items = await ${modelName}.all();
    return this.json(items);
  }
}
`;
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
