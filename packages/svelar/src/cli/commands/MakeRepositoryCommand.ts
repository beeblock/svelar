/**
 * make:repository — Generate a new repository class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

export class MakeRepositoryCommand extends Command {
  name = 'make:repository';
  description = 'Create a new repository class';
  arguments = ['name'];
  flags = [
    { name: 'model', alias: 'm', description: 'Model name for the repository', type: 'string' as const },
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = this.generatorName(args[0], flags);
    if (!name) {
      this.error('Please provide a repository name.');
      return;
    }

    const repoName = name.endsWith('Repository') ? name : `${name}Repository`;
    const baseName = repoName.replace(/Repository$/, '');
    const moduleName = flags.module || baseName.toLowerCase();
    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    const moduleDir = this.moduleDir(moduleName, 'repositories', 'repository');
    const filePath = this.artifactPath(moduleDir, `${repoName}.ts`);
    const modelName = flags.model || this.inferModelName(repoName);
    this.validateIdentifier(modelName, 'Model name', [repoName, 'Repository']);
    const modelImportPath = this.moduleImportPath(moduleName, 'repository', 'model', modelName);
    mkdirSync(moduleDir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`Repository ${repoName} already exists.`);
      return;
    }

    const content = `import { Repository } from '@beeblock/svelar/repositories';
import { ${modelName} } from '${modelImportPath}';

export class ${repoName} extends Repository<${modelName}> {
  model() {
    return ${modelName};
  }

  // Custom query methods:
  // async findByEmail(email: string): Promise<${modelName} | null> {
  //   return ${modelName}.where('email', email).first();
  // }
  //
  // async findActive(): Promise<${modelName}[]> {
  //   return ${modelName}.where('active', true).orderBy('name').get();
  // }
}
`;

    writeFileSync(filePath, content);
    const relDir = this.moduleRelDir(moduleName, 'repositories', 'repository');
    this.success(`Repository created: ${relDir}/${repoName}.ts`);
  }

  private inferModelName(repoName: string): string {
    return repoName.replace('Repository', '') || 'Model';
  }
}
