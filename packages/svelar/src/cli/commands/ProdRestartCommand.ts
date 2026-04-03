/**
 * prod:restart — Restart production containers (down + up).
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class ProdRestartCommand extends DockerComposeCommand {
  name = 'prod:restart';
  description = 'Restart production containers (down + up)';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    this.composeExec(['down'], false, flags);
    this.composeExec(['up', '-d'], false, flags);
  }
}
