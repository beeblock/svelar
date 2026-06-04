/**
 * make:factory — Generate a model factory for tests
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export class MakeFactoryCommand extends Command {
  name = 'make:factory';
  description = 'Create a new model factory for testing';
  arguments = ['name'];
  flags = [
    { name: 'model', alias: 'm', description: 'The model class name', type: 'string' as const },
    { name: 'module', description: 'DDD module name containing the model', type: 'string' as const },
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
    const modelImport = this.resolveModelImport(modelName, flags.module);

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

  private resolveModelImport(modelName: string, moduleName?: string): string {
    if (this.isDDD()) {
      const mod = moduleName ?? this.findModelModule(modelName) ?? this.defaultModelModule(modelName);
      return `$lib/modules/${mod}/${modelName}`;
    }
    return `$lib/models/${modelName}`;
  }

  private findModelModule(modelName: string): string | null {
    const modulesDir = join(process.cwd(), 'src', 'lib', 'modules');
    if (!existsSync(modulesDir)) return null;

    const matches = readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((moduleName) =>
        existsSync(join(modulesDir, moduleName, `${modelName}.ts`)) ||
        existsSync(join(modulesDir, moduleName, `${modelName}.js`))
      );

    if (matches.length === 1) {
      return matches[0];
    }

    if (matches.length > 1) {
      this.warn(`Model ${modelName} exists in multiple modules. Use --module to choose one.`);
      return matches[0];
    }

    return null;
  }

  private defaultModelModule(modelName: string): string {
    const moduleMap: Record<string, string> = {
      User: 'auth',
      Post: 'posts',
    };

    return moduleMap[modelName] ?? modelName.toLowerCase();
  }
}
