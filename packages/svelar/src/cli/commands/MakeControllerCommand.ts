/**
 * make:controller — Generate a new controller
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeControllerCommand extends Command {
  name = 'make:controller';
  description = 'Create a new controller class';
  arguments = ['name'];
  flags = [
    { name: 'resource', alias: 'r', description: 'Create a resource controller with CRUD methods', type: 'boolean' as const },
    { name: 'model', alias: 'm', description: 'Model name for resource controller', type: 'string' as const },
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a controller name.');
      return;
    }

    const controllerName = name.endsWith('Controller') ? name : `${name}Controller`;
    const baseName = controllerName.replace(/Controller$/, '');
    const moduleName = flags.module || baseName.toLowerCase();
    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    const moduleDir = this.moduleDir(moduleName, 'controllers', 'controller');
    mkdirSync(moduleDir, { recursive: true });

    const filePath = join(moduleDir, `${controllerName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Controller ${controllerName} already exists.`);
      return;
    }

    const modelImportPath = flags.model
      ? this.moduleImportPath(moduleName, 'controller', 'model', flags.model)
      : undefined;
    const content = flags.resource
      ? this.generateResourceController(controllerName, flags.model, modelImportPath)
      : this.generateBasicController(controllerName);

    writeFileSync(filePath, content);
    const relDir = this.moduleRelDir(moduleName, 'controllers', 'controller');
    this.success(`Controller created: ${relDir}/${controllerName}.ts`);
  }

  private generateResourceController(name: string, model?: string, modelPath?: string): string {
    const modelImport = model && modelPath
      ? `import { ${model} } from '${modelPath}';\n`
      : '';

    return `import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { z } from '@beeblock/svelar/validation';
${modelImport}
export class ${name} extends Controller {
  async index(event: RequestEvent) {
    // List all resources
    return this.json([]);
  }

  async store(event: RequestEvent) {
    const data = await this.validate(event, z.object({
      // Define validation rules
    }));
    // Create resource
    return this.created(data);
  }

  async show(event: RequestEvent) {
    const { id } = event.params;
    // Find and return resource
    return this.json({ id });
  }

  async update(event: RequestEvent) {
    const { id } = event.params;
    const data = await this.validate(event, z.object({
      // Define validation rules
    }));
    // Update resource
    return this.json({ id, ...data });
  }

  async destroy(event: RequestEvent) {
    const { id } = event.params;
    // Delete resource
    return this.noContent();
  }
}
`;
  }

  private generateBasicController(name: string): string {
    return `import { Controller, type RequestEvent } from '@beeblock/svelar/routing';

export class ${name} extends Controller {
  async index(event: RequestEvent) {
    return this.json({ message: 'Hello from ${name}' });
  }
}
`;
  }
}
