/**
 * make:event — Generate a new Event class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeEventCommand extends Command {
  name = 'make:event';
  description = 'Create a new event class';
  arguments = ['name'];
  flags = [
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide an event name (e.g. UserRegistered).');
      return;
    }

    const moduleName = flags.module || name.replace(/([A-Z])/g, ' $1').trim().split(' ')[0].toLowerCase();
    if (!flags.module) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    const moduleDir = join(process.cwd(), 'src', 'lib', 'modules', moduleName);
    mkdirSync(moduleDir, { recursive: true });

    const filePath = join(moduleDir, `${name}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Event ${name} already exists at ${filePath}`);
      return;
    }

    const content = `/**
 * ${name} Event
 *
 * Dispatched when ... (describe when this event fires).
 *
 * Register listeners in your EventServiceProvider:
 *   protected listen = {
 *     [${name}.name]: [MyListener],
 *   };
 */

export class ${name} {
  constructor(
    // Add your event data here, e.g.:
    // public readonly user: User,
    // public readonly metadata?: Record<string, any>,
  ) {}
}
`;

    writeFileSync(filePath, content);
    this.success(`Event created: src/lib/modules/${moduleName}/${name}.ts`);
  }
}
