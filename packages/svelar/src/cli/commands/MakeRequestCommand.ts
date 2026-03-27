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
  flags = [];

  async handle(args: string[]): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a request name.');
      return;
    }

    const requestName = name.endsWith('Request') ? name : `${name}Request`;
    const dtosDir = join(process.cwd(), 'src', 'lib', 'dtos');
    mkdirSync(dtosDir, { recursive: true });

    const filePath = join(dtosDir, `${requestName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Request ${requestName} already exists.`);
      return;
    }

    const content = `import { FormRequest } from 'svelar/routing';
import { z } from 'svelar/validation';

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
    this.success(`Request created: src/lib/dtos/${requestName}.ts`);
  }
}
