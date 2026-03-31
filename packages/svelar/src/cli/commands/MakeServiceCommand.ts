/**
 * make:service — Generate a new service class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeServiceCommand extends Command {
  name = 'make:service';
  description = 'Create a new service class';
  arguments = ['name'];
  flags = [
    { name: 'crud', description: 'Create a CRUD service with model', type: 'boolean' as const },
    { name: 'model', alias: 'm', description: 'Model name for CRUD service', type: 'string' as const },
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a service name.');
      return;
    }

    const serviceName = name.endsWith('Service') ? name : `${name}Service`;
    const baseName = serviceName.replace(/Service$/, '');
    const moduleName = flags.module || baseName.toLowerCase();
    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    const moduleDir = this.moduleDir(moduleName, 'services');
    mkdirSync(moduleDir, { recursive: true });

    const filePath = join(moduleDir, `${serviceName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Service ${serviceName} already exists.`);
      return;
    }

    const modelImportPath = flags.model
      ? (this.isDDD() ? `./${flags.model}.js` : `../models/${flags.model}.js`)
      : undefined;
    const content = flags.crud
      ? this.generateCrudService(serviceName, flags.model, modelImportPath)
      : this.generateBasicService(serviceName);

    writeFileSync(filePath, content);
    const relDir = this.isDDD() ? `src/lib/modules/${moduleName}` : 'src/lib/services';
    this.success(`Service created: ${relDir}/${serviceName}.ts`);
  }

  private generateCrudService(name: string, model?: string, modelPath?: string): string {
    const modelName = model || 'Model';
    const importPath = modelPath || `./${modelName}.js`;
    return `import { CrudService, type ServiceResult } from '@beeblock/svelar/services';
import { ${modelName} } from '${importPath}';

export class ${name} extends CrudService<${modelName}> {
  protected model = ${modelName};

  // Override or add custom methods:
  // async findByEmail(email: string): Promise<ServiceResult<${modelName}>> {
  //   const record = await ${modelName}.where('email', email).first();
  //   if (!record) return this.fail('Not found');
  //   return this.ok(record);
  // }
}
`;
  }

  private generateBasicService(name: string): string {
    return `import { Service, type ServiceResult } from '@beeblock/svelar/services';

export class ${name} extends Service {
  async execute(data: any): Promise<ServiceResult<any>> {
    try {
      // Implement your business logic here
      return this.ok(data);
    } catch (error: any) {
      return this.fail(error.message);
    }
  }
}
`;
  }
}
