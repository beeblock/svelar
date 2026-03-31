/**
 * make:listener — Generate a new event Listener class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeListenerCommand extends Command {
  name = 'make:listener';
  description = 'Create a new event listener class';
  arguments = ['name'];
  flags = [
    { name: 'event', alias: 'e', description: 'The event class this listener handles', type: 'string' as const },
    { name: 'module', description: 'Module name (e.g. auth, billing)', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a listener name (e.g. SendWelcomeEmail).');
      return;
    }

    const moduleName = flags.module || name.replace(/([A-Z])/g, ' $1').trim().split(' ')[0].toLowerCase();
    if (!flags.module && this.isDDD()) {
      this.warn(`No --module specified. Using "${moduleName}" as module. Consider: --module ${moduleName}`);
    }

    const moduleDir = this.moduleDir(moduleName, 'listeners');
    mkdirSync(moduleDir, { recursive: true });

    const filePath = join(moduleDir, `${name}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Listener ${name} already exists at ${filePath}`);
      return;
    }

    const eventName = flags.event || 'any';
    const eventImportPath = flags.event
      ? (this.isDDD() ? `./${flags.event}.js` : `../events/${flags.event}.js`)
      : '';
    const eventImport = flags.event
      ? `import type { ${flags.event} } from '${eventImportPath}';\n\n`
      : '';
    const eventType = flags.event || 'any';

    const content = `import { Listener } from '@beeblock/svelar/events';
${eventImport}export class ${name} extends Listener<${eventType}> {
  async handle(event: ${eventType}): Promise<void> {
    // Handle the event
    // e.g. await Mail.to(event.user.email).send(new WelcomeEmail());
  }

  // Optionally filter which events to handle:
  // shouldHandle(event: ${eventType}): boolean {
  //   return true;
  // }
}
`;

    writeFileSync(filePath, content);
    const relDir = this.isDDD() ? `src/lib/modules/${moduleName}` : 'src/lib/listeners';
    this.success(`Listener created: ${relDir}/${name}.ts`);
    if (flags.event) {
      this.info(`Don't forget to register it in your EventServiceProvider:`);
      this.info(`  [${flags.event}.name]: [${name}]`);
    }
  }
}
