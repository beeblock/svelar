/**
 * make:middleware — Generate a new middleware
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeMiddlewareCommand extends Command {
  name = 'make:middleware';
  description = 'Create a new middleware class';
  arguments = ['name'];
  flags = [];

  async handle(args: string[]): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a middleware name.');
      return;
    }

    const middlewareName = name.endsWith('Middleware') ? name : `${name}Middleware`;
    const middlewareDir = join(process.cwd(), 'src', 'lib', 'middleware');
    mkdirSync(middlewareDir, { recursive: true });

    const filePath = join(middlewareDir, `${middlewareName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Middleware ${middlewareName} already exists.`);
      return;
    }

    const content = `import { Middleware, type MiddlewareContext, type NextFunction } from 'svelar/middleware';

export class ${middlewareName} extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    // Before request
    // Example: const token = ctx.event.request.headers.get('authorization');

    const response = await next();

    // After request (optional)
    return response;
  }
}
`;

    writeFileSync(filePath, content);
    this.success(`Middleware created: src/lib/middleware/${middlewareName}.ts`);
  }
}
