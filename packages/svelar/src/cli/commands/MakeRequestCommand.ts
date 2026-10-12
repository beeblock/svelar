/**
 * make:request — Generate a new FormRequest class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

export class MakeRequestCommand extends Command {
  name = 'make:request';
  description = 'Create a new FormRequest validation class';
  arguments = ['name'];
  flags = [
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const rawName = this.generatorName(args[0], flags);
    if (!rawName) {
      this.error('Please provide a request name.');
      return;
    }

    const name = this.toPascalCase(rawName);
    const requestName = name.endsWith('Request') ? name : `${name}Request`;
    const baseName = requestName.replace(/Request$/, '');
    const moduleName = flags.module || this.toKebabCase(baseName);
    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    const moduleDir = this.moduleDir(moduleName, 'dtos', 'request');
    const filePath = this.artifactPath(moduleDir, `${requestName}.ts`);
    mkdirSync(moduleDir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`Request ${requestName} already exists.`);
      return;
    }

    const content = this.validationProvider() === 'valibot'
      ? `import { FormRequest } from '@beeblock/svelar/forms';
import * as v from 'valibot';

export class ${requestName} extends FormRequest {
  rules() {
    return v.object({
      // Define validation rules
      // name: v.pipe(v.string(), v.minLength(2), v.maxLength(100)),
      // email: v.pipe(v.string(), v.email()),
    });
  }

  messages() {
    return {
      // Custom error messages (optional)
      // 'name.min_length': 'Name must be at least 2 characters',
    };
  }

  authorize(event: any): boolean {
    // Return false to throw 403 Forbidden
    return true;
  }

  passedValidation(data: any) {
    // Transform data after validation (optional)
    return data;
  }
}
`
      : `import { FormRequest } from '@beeblock/svelar/forms';
import { z } from '@beeblock/svelar/validation';

export class ${requestName} extends FormRequest {
  rules() {
    return z.object({
      // Define validation rules
      // name: z.string().min(2).max(100),
      // email: z.string().email(),
    });
  }

  messages() {
    return {
      // Custom error messages (optional)
      // 'name.too_small': 'Name must be at least 2 characters',
    };
  }

  authorize(event: any): boolean {
    // Return false to throw 403 Forbidden
    return true;
  }

  passedValidation(data: any) {
    // Transform data after validation (optional)
    return data;
  }
}
`;

    writeFileSync(filePath, content);
    const relDir = this.moduleRelDir(moduleName, 'dtos', 'request');
    this.success(`Request created: ${relDir}/${requestName}.ts`);
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
