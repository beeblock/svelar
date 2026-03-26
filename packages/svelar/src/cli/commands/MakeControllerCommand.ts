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
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a controller name.');
      return;
    }

    const controllerName = name.endsWith('Controller') ? name : `${name}Controller`;
    const controllersDir = join(process.cwd(), 'src', 'lib', 'controllers');
    mkdirSync(controllersDir, { recursive: true });

    const filePath = join(controllersDir, `${controllerName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Controller ${controllerName} already exists.`);
      return;
    }

    const content = flags.resource
      ? this.generateResourceController(controllerName, flags.model)
      : this.generateBasicController(controllerName);

    writeFileSync(filePath, content);
    this.success(`Controller created: src/lib/controllers/${controllerName}.ts`);
  }

  private generateResourceController(name: string, model?: string): string {
    const modelImport = model
      ? `import { ${model} } from '../models/${model}.js';\n`
      : '';

    return `import { Controller, type RequestEvent } from 'svelar/routing';
import { z } from 'svelar/validation';
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
    return `import { Controller, type RequestEvent } from 'svelar/routing';

export class ${name} extends Controller {
  async index(event: RequestEvent) {
    return this.json({ message: 'Hello from ${name}' });
  }
}
`;
  }
}
