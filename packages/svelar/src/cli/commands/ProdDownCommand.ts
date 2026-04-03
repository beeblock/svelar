/**
 * prod:down — Stop production containers.
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class ProdDownCommand extends DockerComposeCommand {
  name = 'prod:down';
  description = 'Stop production containers';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    this.composeExec(['down'], false, flags);
  }
}
