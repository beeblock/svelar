/**
 * make:command — Generate a new custom CLI command
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeCommandCommand extends Command {
  name = 'make:command';
  description = 'Create a new custom CLI command';
  arguments = ['name'];
  flags = [
    { name: 'command', description: 'The terminal command name (e.g. "app:sync")', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a command class name. Example: npx svelar make:command SyncUsers');
      return;
    }

    const className = name.endsWith('Command') ? name : `${name}Command`;
    const commandsDir = this.sharedDir('commands');
    mkdirSync(commandsDir, { recursive: true });

    const filePath = join(commandsDir, `${className}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Command ${className} already exists.`);
      return;
    }

    // Derive a command name from the class name if not provided
    // SyncUsersCommand → app:sync-users
    const commandName = flags.command ?? this.deriveCommandName(className);

    const content = `import { Command } from '@beeblock/svelar/cli';

export class ${className} extends Command {
  name = '${commandName}';
  description = 'TODO: Describe your command';
  arguments = ['name'];  // Positional args your command accepts
  flags = [
    // { name: 'force', alias: 'f', description: 'Force the operation', type: 'boolean' as const },
    // { name: 'limit', description: 'Limit results', type: 'string' as const, default: '10' },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];

    this.info('Running ${commandName}...');

    // Your command logic here
    // Use this.bootstrap() if you need database access
    // await this.bootstrap();

    this.success('Done!');
  }
}
`;

    writeFileSync(filePath, content);
    const relPath = this.isDDD() ? `src/lib/shared/commands/${className}.ts` : `src/lib/commands/${className}.ts`;
    this.success(`Command created: ${relPath}`);
    this.info(`Command name: ${commandName}`);
    this.newLine();
    this.info('Your command will be auto-discovered. Run it with:');
    this.log(`  npx svelar ${commandName}`);
  }

  private deriveCommandName(className: string): string {
    // Remove "Command" suffix
    const base = className.replace(/Command$/, '');
    // PascalCase → kebab-case
    const kebab = base
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .toLowerCase();
    return `app:${kebab}`;
  }
}
