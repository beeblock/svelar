/**
 * make:middleware — Generate a new middleware
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

export class MakeMiddlewareCommand extends Command {
  name = 'make:middleware';
  description = 'Create a new middleware class';
  arguments = ['name'];
  flags = [];

  async handle(args: string[], flags: Record<string, unknown> = {}): Promise<void> {
    const name = this.generatorName(args[0], flags);
    if (!name) {
      this.error('Please provide a middleware name.');
      return;
    }

    const middlewareName = name.endsWith('Middleware') ? name : `${name}Middleware`;
    const middlewareDir = this.sharedDir('middleware');
    const filePath = this.artifactPath(middlewareDir, `${middlewareName}.ts`);
    mkdirSync(middlewareDir, { recursive: true });
    if (existsSync(filePath)) {
      this.warn(`Middleware ${middlewareName} already exists.`);
      return;
    }

    const content = `import { Middleware, type MiddlewareContext, type NextFunction } from '@beeblock/svelar/middleware';

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
    const relPath = this.isDDD() ? `src/lib/shared/middleware/${middlewareName}.ts` : `src/lib/middleware/${middlewareName}.ts`;
    this.success(`Middleware created: ${relPath}`);
  }
}
