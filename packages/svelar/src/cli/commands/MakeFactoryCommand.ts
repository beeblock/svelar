/**
 * make:factory — Generate a model factory for tests
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeFactoryCommand extends Command {
  name = 'make:factory';
  description = 'Create a new model factory for testing';
  arguments = ['name'];
  flags = [
    { name: 'model', alias: 'm', description: 'The model class name', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a factory name.');
      return;
    }

    const factoryName = name.endsWith('Factory') ? name : `${name}Factory`;
    const modelName = flags.model || name.replace(/Factory$/, '');

    const factoriesDir = join(process.cwd(), 'src', 'lib', 'factories');
    mkdirSync(factoriesDir, { recursive: true });

    const filePath = join(factoriesDir, `${factoryName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Factory ${factoryName} already exists.`);
      return;
    }

    // Resolve the model import path based on project structure
    const modelImport = this.resolveModelImport(modelName);

    const content = `import { Factory } from '@beeblock/svelar/testing';
import { ${modelName} } from '${modelImport}';

export class ${factoryName} extends Factory<${modelName}> {
  model() {
    return ${modelName};
  }

  definition() {
    return {
      name: \`${modelName} \${this.sequence}\`,
      email: \`${modelName.toLowerCase()}\${this.sequence}@test.com\`,
    };
  }
}

// Singleton instance for convenience
export default new ${factoryName}();
`;

    writeFileSync(filePath, content);
    this.success(`Factory created: src/lib/factories/${factoryName}.ts`);
  }

  private resolveModelImport(modelName: string): string {
    if (this.isDDD()) {
      // Try to find the module — default to lowercase model name
      const moduleName = modelName.toLowerCase();
      // Common modules: auth has User, posts has Post, etc.
      const moduleMap: Record<string, string> = {
        User: 'auth',
        Post: 'posts',
      };
      const mod = moduleMap[modelName] || moduleName;
      return `$lib/modules/${mod}/${modelName}`;
    }
    return `$lib/models/${modelName}`;
  }
}
