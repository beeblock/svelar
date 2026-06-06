/**
 * make:service — Generate a new service class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
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

    const moduleDir = this.moduleDir(moduleName, 'services', 'service');
    mkdirSync(moduleDir, { recursive: true });

    const filePath = join(moduleDir, `${serviceName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Service ${serviceName} already exists.`);
      return;
    }

    const modelName = flags.crud ? this.resolveCrudModel(baseName, moduleName, flags.model) : undefined;
    const modelImportPath = modelName
      ? this.moduleImportPath(moduleName, 'service', 'model', modelName)
      : undefined;
    const content = flags.crud
      ? this.generateCrudService(serviceName, modelName!, modelImportPath!)
      : this.generateBasicService(serviceName);

    writeFileSync(filePath, content);
    const relDir = this.moduleRelDir(moduleName, 'services', 'service');
    this.success(`Service created: ${relDir}/${serviceName}.ts`);
  }

  private resolveCrudModel(serviceBaseName: string, moduleName: string, explicitModel?: string): string {
    if (explicitModel) return explicitModel;

    const modelDir = this.isDDD()
      ? this.moduleDir(moduleName, 'models', 'model')
      : join(process.cwd(), 'src', 'lib', 'models');
    const models = this.findModelsInDir(modelDir);

    if (models.length === 1) {
      return models[0];
    }

    const fallback = serviceBaseName;
    const reason = models.length > 1
      ? `multiple models were found (${models.join(', ')})`
      : 'no model was found';
    this.warn(`No --model specified and ${reason}. Using "${fallback}".`);
    return fallback;
  }

  private findModelsInDir(dir: string): string[] {
    if (!existsSync(dir)) return [];

    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|js)$/.test(entry.name))
      .filter((entry) => !entry.name.endsWith('.d.ts'))
      .filter((entry) => {
        const content = readFileSync(join(dir, entry.name), 'utf-8');
        return /\bextends\s+Model\b/.test(content)
          || /@beeblock\/svelar\/orm/.test(content)
          || /@beeblock\/svelar\/models/.test(content);
      })
      .map((entry) => entry.name.replace(/\.(ts|js)$/, ''));
  }

  private repositoryVariableName(modelName: string): string {
    return modelName.charAt(0).toLowerCase() + modelName.slice(1) + 'Repository';
  }

  private generateCrudService(name: string, modelName: string, modelPath: string): string {
    const importPath = modelPath;
    const repositoryVariable = this.repositoryVariableName(modelName);
    return `import { CrudService, Repository } from '@beeblock/svelar/services';
import { ${modelName} } from '${importPath}';

const ${repositoryVariable} = new class extends Repository<${modelName}> {
  model() {
    return ${modelName};
  }
}();

export class ${name} extends CrudService<${modelName}> {
  protected repository(): Repository<${modelName}> {
    return ${repositoryVariable};
  }

  // Override or add custom methods:
  // async findByEmail(email: string): Promise<${modelName} | null> {
  //   return ${repositoryVariable}.findFirstWhere('email', email);
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
