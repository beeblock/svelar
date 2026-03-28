/**
 * make:request — Generate a new FormRequest (DTO) class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeRequestCommand extends Command {
  name = 'make:request';
  description = 'Create a new FormRequest validation class';
  arguments = ['name'];
  flags = [
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a request name.');
      return;
    }

    const requestName = name.endsWith('Request') ? name : `${name}Request`;
    const baseName = requestName.replace(/Request$/, '');
    const moduleName = flags.module || baseName.toLowerCase();
    if (!flags.module) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    const moduleDir = join(process.cwd(), 'src', 'lib', 'modules', moduleName);
    mkdirSync(moduleDir, { recursive: true });

    const filePath = join(moduleDir, `${requestName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Request ${requestName} already exists.`);
      return;
    }

    const content = `import { FormRequest } from '@beeblock/svelar/routing';
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
    this.success(`Request created: src/lib/modules/${moduleName}/${requestName}.ts`);
  }
}
