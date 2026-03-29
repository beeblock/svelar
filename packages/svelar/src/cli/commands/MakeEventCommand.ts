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
  flags = [];

  async handle(args: string[], _flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide an event name (e.g. UserRegistered).');
      return;
    }

    const eventsDir = join(process.cwd(), 'src', 'lib', 'events');
    mkdirSync(eventsDir, { recursive: true });

    const filePath = join(eventsDir, `${name}.ts`);
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
    this.success(`Event created: src/lib/events/${name}.ts`);
  }
}
