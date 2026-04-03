/**
 * dev:down — Stop development containers.
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class DevDownCommand extends DockerComposeCommand {
  name = 'dev:down';
  description = 'Stop development containers';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    this.composeExec(['down'], true, flags);
  }
}
