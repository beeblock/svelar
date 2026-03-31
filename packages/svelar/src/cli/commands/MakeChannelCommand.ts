/**
 * make:channel — Generate a new broadcast channel authorization file
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeChannelCommand extends Command {
  name = 'make:channel';
  description = 'Create a new broadcast channel authorization';
  arguments = ['name'];
  flags = [
    { name: 'presence', alias: 'p', description: 'Create a presence channel', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a channel name. Example: npx svelar make:channel OrderChannel');
      return;
    }

    const className = name.endsWith('Channel') ? name : `${name}Channel`;
    const channelsDir = this.sharedDir('channels');
    mkdirSync(channelsDir, { recursive: true });

    const filePath = join(channelsDir, `${className}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Channel ${className} already exists.`);
      return;
    }

    // Derive a channel pattern from the class name
    // OrderChannel → 'private-orders.{orderId}'
    const baseName = className.replace(/Channel$/, '');
    const kebab = baseName
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase();
    const paramName = baseName.charAt(0).toLowerCase() + baseName.slice(1) + 'Id';

    const isPresence = flags.presence;
    const prefix = isPresence ? 'presence' : 'private';
    const channelPattern = `${prefix}-${kebab}.{${paramName}}`;

    const content = isPresence
      ? this.presenceTemplate(className, channelPattern, paramName)
      : this.privateTemplate(className, channelPattern, paramName);

    writeFileSync(filePath, content);
    const relDir = this.isDDD() ? 'src/lib/shared/channels' : 'src/lib/channels';
    this.success(`Channel created: ${relDir}/${className}.ts`);
    this.info(`Channel pattern: ${channelPattern}`);
    this.newLine();
    this.info('Register it in src/app.ts or a service provider:');
    this.log(`  import { register${className} } from './${relDir.replace('src/', '')}/${className}.js';`);
    this.log(`  register${className}();`);
  }

  private privateTemplate(className: string, pattern: string, paramName: string): string {
    const modelName = className.replace(/Channel$/, '');
    return `import { Broadcast } from '@beeblock/svelar/broadcasting';

/**
 * ${className}
 *
 * Authorization for the '${pattern}' private channel.
 * Return true to allow access, false to deny.
 */
export function register${className}(): void {
  Broadcast.channel('${pattern}', async (user, { ${paramName} }) => {
    // TODO: Check if the user is authorized to access this channel
    // Example:
    // const ${modelName.toLowerCase()} = await ${modelName}.findOrFail(${paramName});
    // return ${modelName.toLowerCase()}.user_id === user.id;

    return !!user;
  });
}
`;
  }

  private presenceTemplate(className: string, pattern: string, paramName: string): string {
    const modelName = className.replace(/Channel$/, '');
    return `import { Broadcast } from '@beeblock/svelar/broadcasting';

/**
 * ${className}
 *
 * Authorization for the '${pattern}' presence channel.
 * Return false to deny, or an object with user info to share with other members.
 */
export function register${className}(): void {
  Broadcast.channel('${pattern}', async (user, { ${paramName} }) => {
    // TODO: Check if the user is authorized to join this channel
    // Example:
    // const ${modelName.toLowerCase()} = await ${modelName}.findOrFail(${paramName});
    // if (!${modelName.toLowerCase()}.hasMember(user.id)) return false;

    if (!user) return false;

    // Return user info visible to other presence members
    return {
      id: user.id,
      name: user.name,
      // avatar: user.avatar,
    };
  });
}
`;
  }
}
