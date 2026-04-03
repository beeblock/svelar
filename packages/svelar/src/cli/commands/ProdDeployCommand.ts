/**
 * prod:deploy — Pull latest images and redeploy production containers.
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class ProdDeployCommand extends DockerComposeCommand {
  name = 'prod:deploy';
  description = 'Pull latest images and redeploy production containers';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    this.composeExec(['pull'], false, flags);
    this.composeExec(['up', '-d'], false, flags);
  }
}
