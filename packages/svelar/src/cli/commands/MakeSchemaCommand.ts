/**
 * make:schema — Generate a Zod contract schema for a domain entity
 *
 * Creates a .schema.ts file with Zod schemas and inferred types that serve
 * as the single source of truth for validation, resources, DTOs, and frontend types.
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeSchemaCommand extends Command {
  name = 'make:schema';
  description = 'Create a contract schema (Zod schemas + shared types)';
  arguments = ['name'];
  flags = [
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const rawName = args[0];
    if (!rawName) {
      this.error('Please provide a schema name (e.g. User, Post, Invoice).');
      return;
    }

    // Normalize: "User" → "user", "ApiKey" → "api-key"
    const entityName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const fileName = this.toKebab(rawName) + '.schema';
    const moduleName = flags.module || rawName.toLowerCase();

    const moduleDir = this.moduleDir(moduleName, 'schemas');
    mkdirSync(moduleDir, { recursive: true });

    const filePath = join(moduleDir, `${fileName}.ts`);
    if (existsSync(filePath)) {
      const relDir = this.isDDD() ? `src/lib/modules/${moduleName}` : 'src/lib/schemas';
      this.warn(`Schema already exists: ${relDir}/${fileName}.ts`);
      return;
    }

    const content = this.generateSchema(entityName);
    writeFileSync(filePath, content);
    const relDir2 = this.isDDD() ? `src/lib/modules/${moduleName}` : 'src/lib/schemas';
    this.success(`Schema created: ${relDir2}/${fileName}.ts`);
    this.info('');
    this.info('  Use this schema across your entire stack:');
    this.info('');
    this.info(`    Resource:    extends Resource<${entityName}, ${entityName}Data>`);
    this.info(`    FormRequest: uses create${entityName}Schema / update${entityName}Schema`);
    const frontendPath = this.isDDD() ? `$lib/modules/${moduleName}/${fileName}` : `$lib/schemas/${fileName}`;
    this.info(`    Frontend:    import type { ${entityName}Data } from '${frontendPath}'`);
  }

  private generateSchema(name: string): string {
    const lower = name.charAt(0).toLowerCase() + name.slice(1);
    const kebab = this.toKebab(name);
    return `import { z } from 'zod';

// ── ${name} Contract Schema ──────────────────────────────────
//
// Single source of truth for validation, API responses, and frontend types.
// Import the Zod schemas for validation, the types for everything else.
//
// Usage:
//   Resource:     import type { ${name}Data } from './${kebab}.schema.js';
//   FormRequest:  import { create${name}Schema } from './${kebab}.schema.js';
//   Frontend:     import type { ${name}Data, Create${name}Input } from '$lib/modules/.../${kebab}.schema';

// ── Response schema (what the API returns) ──────────────────

export const ${lower}Schema = z.object({
  id: z.number(),
  // name: z.string(),
  // email: z.string().email(),
  // created_at: z.string(),
});

// ── Input schemas (what the API accepts) ────────────────────

export const create${name}Schema = z.object({
  // name: z.string().min(2, 'Name must be at least 2 characters'),
  // email: z.string().email('Please enter a valid email'),
});

export const update${name}Schema = create${name}Schema.partial();

// ── Inferred types — shared between server and frontend ─────

export type ${name}Data = z.infer<typeof ${lower}Schema>;
export type Create${name}Input = z.infer<typeof create${name}Schema>;
export type Update${name}Input = z.infer<typeof update${name}Schema>;
`;
  }

  private toKebab(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .toLowerCase();
  }
}
