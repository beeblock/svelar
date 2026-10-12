/**
 * make:controller — Generate a new controller
 */

import { Command } from '../Command.js';
import { MakeEntityCommand } from './MakeEntityCommand.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

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
    const name = this.generatorName(args[0], flags);
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

    if (flags.resource) {
      const command = new MakeEntityCommand();
      await command.handle([flags.model ?? baseName], {
        module: moduleName, crud: true, 'no-migration': true, controller: controllerName,
      });
      this.exitCode = command.exitCode;
      return;
    }

    const moduleDir = this.moduleDir(moduleName, 'controllers', 'controller');
    const filePath = this.artifactPath(moduleDir, `${controllerName}.ts`);
    mkdirSync(moduleDir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`Controller ${controllerName} already exists.`);
      return;
    }

    const content = this.generateBasicController(controllerName);

    writeFileSync(filePath, content);
    const relDir = this.moduleRelDir(moduleName, 'controllers', 'controller');
    this.success(`Controller created: ${relDir}/${controllerName}.ts`);
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
