/**
 * make:observer — Generate a new Model Observer class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeObserverCommand extends Command {
  name = 'make:observer';
  description = 'Create a new model observer class';
  arguments = ['name'];
  flags = [
    { name: 'model', alias: 'm', description: 'The model class to observe', type: 'string' as const },
    { name: 'module', description: 'Module name (e.g. users, posts)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide an observer name (e.g. UserObserver).');
      return;
    }

    const modelName = flags.model || name.replace(/Observer$/, '');
    const moduleName = flags.module || this.toSnakeCase(this.pluralize(modelName));

    const observersDir = join(process.cwd(), 'src', 'lib', 'modules', moduleName);
    mkdirSync(observersDir, { recursive: true });

    const filePath = join(observersDir, `${name}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Observer ${name} already exists at ${filePath}`);
      return;
    }

    const content = `import { ModelObserver } from '@beeblock/svelar/orm';
import type { ${modelName} } from './${modelName}.js';

export class ${name} extends ModelObserver {
  // Fires before a new ${modelName} is inserted
  // async creating(${modelName.toLowerCase()}: ${modelName}) {
  // }

  // Fires after a new ${modelName} is inserted
  // async created(${modelName.toLowerCase()}: ${modelName}) {
  //   await sendWelcomeEmail(${modelName.toLowerCase()});
  // }

  // Fires before an existing ${modelName} is updated
  // async updating(${modelName.toLowerCase()}: ${modelName}) {
  // }

  // Fires after an existing ${modelName} is updated
  // async updated(${modelName.toLowerCase()}: ${modelName}) {
  // }

  // Fires before any save (create or update)
  // async saving(${modelName.toLowerCase()}: ${modelName}) {
  // }

  // Fires after any save (create or update)
  // async saved(${modelName.toLowerCase()}: ${modelName}) {
  // }

  // Fires before deletion
  // async deleting(${modelName.toLowerCase()}: ${modelName}) {
  //   await ${modelName.toLowerCase()}.posts().query().delete();
  // }

  // Fires after deletion
  // async deleted(${modelName.toLowerCase()}: ${modelName}) {
  // }
}
`;

    writeFileSync(filePath, content);
    this.success(`Observer created: src/lib/modules/${moduleName}/${name}.ts`);
    this.info(`Register it in your app: ${modelName}.observe(new ${name}());`);
  }

  private toSnakeCase(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  }

  private pluralize(str: string): string {
    if (str.endsWith('y')) return str.slice(0, -1) + 'ies';
    if (str.endsWith('s') || str.endsWith('x') || str.endsWith('z') || str.endsWith('ch') || str.endsWith('sh')) {
      return str + 'es';
    }
    return str + 's';
  }
}
