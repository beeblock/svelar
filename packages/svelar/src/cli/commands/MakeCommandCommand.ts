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
    const description = this.describeCommand(commandName);

    const content = `import { Command } from '@beeblock/svelar/cli';

export class ${className} extends Command {
  name = '${commandName}';
  description = '${description}';
  arguments = [];
  flags = [
    { name: 'dry-run', description: 'Show what would run without changing data', type: 'boolean' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    this.info('Running ${commandName}...');

    if (flags['dry-run']) {
      this.info('Dry run enabled. No changes were made.');
      return;
    }

    await this.bootstrap();

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

  private describeCommand(commandName: string): string {
    const label = commandName
      .replace(/^app:/, '')
      .replace(/[-:_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
    return `Run ${label}`;
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
