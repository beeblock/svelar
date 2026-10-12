/**
 * make:action — Generate a new action class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

export class MakeActionCommand extends Command {
  name = 'make:action';
  description = 'Create a new action class';
  arguments = ['name'];
  flags = [
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
    { name: 'dto', description: 'Also create a DTO for this action', type: 'boolean' as const },
    { name: 'request', description: 'Also create a FormRequest for this action', type: 'boolean' as const },
    { name: 'schema', description: 'Also create/update a contract schema stub for this action', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const rawName = this.generatorName(args[0], flags);
    if (!rawName) {
      this.error('Please provide an action name.');
      return;
    }

    const name = this.toPascalCase(rawName);
    const actionName = name.endsWith('Action') ? name : `${name}Action`;
    const baseName = actionName.replace(/Action$/, '');
    const moduleName = flags.module || this.toKebabCase(baseName);
    this.preflightModuleFiles(moduleName, {
      action: `${actionName}.ts`,
      ...(flags.dto ? { dto: `${baseName}Dto.ts` } : {}),
      ...(flags.request ? { request: `${baseName}Request.ts` } : {}),
      ...(flags.schema ? { schema: `${this.toKebabCase(baseName)}.schema.ts` } : {}),
    });
    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    const moduleDir = this.moduleDir(moduleName, 'actions', 'action');
    const filePath = this.artifactPath(moduleDir, `${actionName}.ts`);
    mkdirSync(moduleDir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`Action ${actionName} already exists.`);
      return;
    }

    const content = `import { Action } from '@beeblock/svelar/actions';

interface ${actionName}Input {
  // Define input type
}

interface ${actionName}Output {
  // Define output type
}

export class ${actionName} extends Action<${actionName}Input, ${actionName}Output> {
  async execute(input: ${actionName}Input): Promise<${actionName}Output> {
    // Implement your single-use business logic here.
    return {} as ${actionName}Output;
  }
}
`;

    writeFileSync(filePath, content);
    const relDir = this.moduleRelDir(moduleName, 'actions', 'action');
    this.success(`Action created: ${relDir}/${actionName}.ts`);

    if (flags.dto) {
      this.createDto(moduleName, baseName);
    }

    if (flags.request) {
      this.createRequest(moduleName, baseName);
    }

    if (flags.schema) {
      this.createSchema(moduleName, baseName);
    }
  }

  private createDto(moduleName: string, baseName: string): void {
    const dtoName = `${baseName}Dto`;
    const dir = this.moduleDir(moduleName, 'dtos', 'dto');
    const filePath = this.artifactPath(dir, `${dtoName}.ts`);
    mkdirSync(dir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`DTO ${dtoName} already exists.`);
      return;
    }
    writeFileSync(filePath, `export class ${dtoName} {
  constructor(
    // public readonly name: string,
  ) {}

  static from(input: any): ${dtoName} {
    return new ${dtoName}(
      // input.name,
    );
  }
}
`);
    this.success(`DTO created: ${this.moduleRelDir(moduleName, 'dtos', 'dto')}/${dtoName}.ts`);
  }

  private createRequest(moduleName: string, baseName: string): void {
    const requestName = `${baseName}Request`;
    const dtoName = `${baseName}Dto`;
    const schemaName = `${this.toCamelCase(baseName)}Schema`;
    const schemaFile = `${this.toKebabCase(baseName)}.schema`;
    const dir = this.moduleDir(moduleName, 'dtos', 'request');
    const filePath = this.artifactPath(dir, `${requestName}.ts`);
    mkdirSync(dir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`Request ${requestName} already exists.`);
      return;
    }
    const dtoImport = this.moduleImportPath(moduleName, 'request', 'dto', dtoName);
    const schemaImport = this.moduleImportPath(moduleName, 'request', 'schema', schemaFile);
    writeFileSync(filePath, `import { FormRequest } from '@beeblock/svelar/forms';
import { ${dtoName} } from '${dtoImport}';
import { ${schemaName} } from '${schemaImport}';

export class ${requestName} extends FormRequest {
  rules() {
    return ${schemaName};
  }

  authorize(event: any): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: any): ${dtoName} {
    return ${dtoName}.from(data);
  }
}
`);
    this.success(`Request created: ${this.moduleRelDir(moduleName, 'dtos', 'request')}/${requestName}.ts`);
  }

  private createSchema(moduleName: string, baseName: string): void {
    const schemaName = `${this.toCamelCase(baseName)}Schema`;
    const dir = this.moduleDir(moduleName, 'schemas', 'schema');
    const fileName = `${this.toKebabCase(baseName)}.schema`;
    const filePath = this.artifactPath(dir, `${fileName}.ts`);
    mkdirSync(dir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`Schema ${fileName}.ts already exists.`);
      return;
    }
    if (this.validationProvider() === 'valibot') {
      writeFileSync(filePath, `import * as v from 'valibot';

export const ${schemaName} = v.object({
  // name: v.pipe(v.string(), v.minLength(2), v.maxLength(100)),
});

export type ${baseName}Input = v.InferOutput<typeof ${schemaName}>;
`);
    } else {
      writeFileSync(filePath, `import { z } from '@beeblock/svelar/validation';

export const ${schemaName} = z.object({
  // name: z.string().min(2).max(100),
});

export type ${baseName}Input = z.infer<typeof ${schemaName}>;
`);
    }
    this.success(`Schema created: ${this.moduleRelDir(moduleName, 'schemas', 'schema')}/${fileName}.ts`);
  }

  private toCamelCase(str: string): string {
    const pascal = this.toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
  }

  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  private toPascalCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }
}
