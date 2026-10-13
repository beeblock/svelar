/**
 * make:controller — Generate a new controller
 */

import { Command } from '../Command.js';
import { MakeEntityCommand } from './MakeEntityCommand.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { CapabilityScaffold, capabilityFlags, type CapabilityDecision } from '../CapabilityScaffold.js';

export class MakeControllerCommand extends Command {
  name = 'make:controller';
  description = 'Create a new controller class';
  arguments = ['name'];
  flags = [
    { name: 'resource', alias: 'r', description: 'Create a resource controller with CRUD methods', type: 'boolean' as const },
    { name: 'model', alias: 'm', description: 'Model name for resource controller', type: 'string' as const },
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
    ...capabilityFlags,
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
        capability: flags.capability, public: flags.public, scope: flags.scope, 'screen-route': flags['screen-route'],
      });
      this.exitCode = command.exitCode;
      return;
    }

    const moduleDir = this.moduleDir(moduleName, 'controllers', 'controller');
    const filePath = this.artifactPath(moduleDir, `${controllerName}.ts`);
    const decision = CapabilityScaffold.decision(flags, { route: `/${moduleName}` });
    const plan = CapabilityScaffold.prepare(moduleName, baseName, decision, []);
    const content = this.generateBasicController(controllerName, decision, plan.accessAlias);
    if (existsSync(filePath)) {
      if (!decision.public && readFileSync(filePath, 'utf8') !== content) throw new Error('Existing controller differs from the protected scaffold. Review its guards before regenerating.');
      this.warn(`Controller ${controllerName} already exists.`);
      plan.commit();
      return;
    }
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(filePath, content);
    plan.commit();
    const relDir = this.moduleRelDir(moduleName, 'controllers', 'controller');
    this.success(`Controller created: ${relDir}/${controllerName}.ts`);
  }
  private generateBasicController(name: string, decision: CapabilityDecision, accessAlias: string): string {
    return `${decision.public ? '// svelar:public - functional RBAC exemption only; authentication and resource policies remain.\n' : ''}import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
${decision.public ? '' : `import { capabilityAccess, resolveCapabilityInput } from '${accessAlias}';\n`}

export class ${name} extends Controller {
  async index(event: RequestEvent) {
${decision.public ? '' : `    await capabilityAccess.authorize('screen.${decision.resource}.view', resolveCapabilityInput(event));\n`}
    return this.json({ message: 'Hello from ${name}' });
  }
}
`;
  }
}
