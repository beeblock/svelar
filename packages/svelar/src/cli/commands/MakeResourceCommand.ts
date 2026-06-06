/**
 * make:resource — Generate a new API Resource (response transformer)
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeResourceCommand extends Command {
  name = 'make:resource';
  description = 'Create a new API resource (response transformer)';
  arguments = ['name'];
  flags = [
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
    { name: 'model', alias: 'm', description: 'Model name to transform', type: 'string' as const },
    { name: 'collection', alias: 'c', description: 'Also generate a collection resource', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a resource name.');
      return;
    }

    const resourceName = name.endsWith('Resource') ? name : `${name}Resource`;
    const moduleName = flags.module || this.deriveModuleName(resourceName);

    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified, using "${moduleName}". Use --module=<name> to target a specific module.`);
    }

    const moduleDir = this.moduleDir(moduleName, 'resources', 'resource');
    mkdirSync(moduleDir, { recursive: true });

    const filePath = join(moduleDir, `${resourceName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Resource ${resourceName} already exists.`);
      return;
    }

    const modelName = flags.model || this.inferModelName(resourceName);
    const modelImportPath = this.moduleImportPath(moduleName, 'resource', 'model', modelName);
    const content = this.generateResource(resourceName, modelName, modelImportPath);

    writeFileSync(filePath, content);
    const relDir = this.moduleRelDir(moduleName, 'resources', 'resource');
    this.success(`Resource created: ${relDir}/${resourceName}.ts`);

    // Optionally create a collection resource
    if (flags.collection) {
      const collectionName = resourceName.replace('Resource', 'CollectionResource');
      const collectionPath = join(moduleDir, `${collectionName}.ts`);

      if (!existsSync(collectionPath)) {
        const collModelPath = this.moduleImportPath(moduleName, 'resource', 'model', modelName);
        const collectionContent = this.generateCollectionResource(collectionName, resourceName, modelName, collModelPath);
        writeFileSync(collectionPath, collectionContent);
        const collRelDir = this.moduleRelDir(moduleName, 'resources', 'resource');
        this.success(`Collection resource created: ${collRelDir}/${collectionName}.ts`);
      }
    }
  }

  private generateResource(resourceName: string, modelName: string, modelPath: string = `./${modelName}.js`): string {
    const shapeName = `${modelName}Data`;
    return `import { Resource } from '@beeblock/svelar/routing';
import type { ${modelName} } from '${modelPath}';

// ── API Contract ────────────────────────────────────────────
// Define the shape once — import this type on the frontend.
//
//   import type { ${shapeName} } from '$lib/modules/.../interface/http/resources/${resourceName}';
//

export interface ${shapeName} {
  id: number;
  // Add your fields here
  // name: string;
  // email: string;
  // created_at: string;
}

// ── Resource ────────────────────────────────────────────────

export class ${resourceName} extends Resource<${modelName}, ${shapeName}> {
  toJSON(): ${shapeName} {
    return {
      id: this.data.id,
      // Map model fields to the API contract
      // name: this.data.name,
      // email: this.data.email,
      // created_at: this.data.created_at,
    };
  }

  // Override toWith() to include top-level data in every response
  // (roles, permissions, related context). Can be async.
  //
  // async toWith() {
  //   return {
  //     roles: await this.data.getRoleNames(),
  //     permissions: await this.data.getAllPermissions(),
  //   };
  // }

  // Override toAdditional() to include metadata under "meta"
  //
  // toAdditional() {
  //   return { comments_count: this.data.comments_count ?? 0 };
  // }
}
`;
  }

  private generateCollectionResource(collectionName: string, resourceName: string, modelName: string, modelPath: string = `./${modelName}.js`): string {
    return `import { Resource } from '@beeblock/svelar/routing';
import { ${resourceName} } from './${resourceName}.js';
import type { ${modelName} } from '${modelPath}';

/**
 * ${collectionName}
 *
 * Wraps a collection of ${modelName} with additional metadata.
 * Use this when you need custom collection-level data (pagination, aggregates, etc.)
 */
export class ${collectionName} {
  constructor(
    private items: ${modelName}[],
    private meta: Record<string, any> = {}
  ) {}

  static make(items: ${modelName}[], meta?: Record<string, any>) {
    return new ${collectionName}(items, meta ?? {});
  }

  toResponse(): Response {
    return ${resourceName}.collection(this.items)
      .additional(this.meta)
      .toResponse();
  }

  toObject() {
    return ${resourceName}.collection(this.items)
      .additional(this.meta)
      .toObject();
  }
}
`;
  }

  private deriveModuleName(resourceName: string): string {
    const base = resourceName.replace(/Resource$/, '').replace(/Collection$/, '');
    return base.toLowerCase();
  }

  private inferModelName(resourceName: string): string {
    return resourceName.replace(/Resource$/, '') || 'Model';
  }
}
