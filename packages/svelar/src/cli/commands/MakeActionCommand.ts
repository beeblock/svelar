/**
 * make:action — Generate a new action class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeActionCommand extends Command {
  name = 'make:action';
  description = 'Create a new action class';
  arguments = ['name'];
  flags = [];

  async handle(args: string[]): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide an action name.');
      return;
    }

    const actionName = name.endsWith('Action') ? name : `${name}Action`;
    const actionsDir = join(process.cwd(), 'src', 'lib', 'actions');
    mkdirSync(actionsDir, { recursive: true });

    const filePath = join(actionsDir, `${actionName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Action ${actionName} already exists.`);
      return;
    }

    const content = `import { Action } from 'svelar/actions';

interface ${actionName}Input {
  // Define input type
}

interface ${actionName}Output {
  // Define output type
}

export class ${actionName} extends Action<${actionName}Input, ${actionName}Output> {
  async handle(input: ${actionName}Input): Promise<${actionName}Output> {
    // Implement your single-use business logic here
    throw new Error('Not implemented');
  }
}
`;

    writeFileSync(filePath, content);
    this.success(`Action created: src/lib/actions/${actionName}.ts`);
  }
}
