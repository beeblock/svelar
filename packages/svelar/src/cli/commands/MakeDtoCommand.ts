/**
 * make:dto — Generate a DTO class for a validated application payload.
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from '../Command.js';

export class MakeDtoCommand extends Command {
  name = 'make:dto';
  description = 'Create a DTO class';
  arguments = ['name'];
  flags = [
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
    { name: 'input', description: 'Input type name imported from a schema file', type: 'string' as const },
    { name: 'schema', description: 'Schema file basename for the input type import', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const rawName = args[0];
    if (!rawName) {
      this.error('Please provide a DTO name.');
      return;
    }

    const dtoName = this.normalizeDtoName(rawName);
    const baseName = dtoName.replace(/Dto$/, '').replace(/DTO$/, '');
    const moduleName = flags.module || this.toKebabCase(baseName);
    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    const dir = this.moduleDir(moduleName, 'dtos', 'dto');
    mkdirSync(dir, { recursive: true });

    const filePath = join(dir, `${dtoName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`DTO ${dtoName} already exists.`);
      return;
    }

    const inputType = typeof flags.input === 'string' && flags.input.trim() ? flags.input.trim() : 'Record<string, unknown>';
    const schemaFile = typeof flags.schema === 'string' && flags.schema.trim()
      ? flags.schema.trim().replace(/\.ts$/, '').replace(/\.js$/, '').replace(/\.schema$/, '')
      : '';
    const importLine = schemaFile
      ? `import type { ${inputType} } from '${this.moduleImportPath(moduleName, 'dto', 'schema', `${this.toKebabCase(schemaFile)}.schema`)}';\n\n`
      : '';

    const content = `${importLine}export class ${dtoName} {
  constructor(
    // public readonly name: string,
  ) {}

  static from(input: ${inputType}): ${dtoName} {
    void input;

    return new ${dtoName}(
      // input.name,
    );
  }
}
`;

    writeFileSync(filePath, content);
    this.success(`DTO created: ${this.moduleRelDir(moduleName, 'dtos', 'dto')}/${dtoName}.ts`);
  }

  private normalizeDtoName(name: string): string {
    const pascal = this.toPascalCase(name);
    return pascal.endsWith('Dto') || pascal.endsWith('DTO') ? pascal : `${pascal}Dto`;
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

  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }
}
