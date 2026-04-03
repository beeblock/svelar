/**
 * prod:up — Start production containers.
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class ProdUpCommand extends DockerComposeCommand {
  name = 'prod:up';
  description = 'Start production containers (docker compose up with prod override)';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    this.composeExec(['up', '-d'], false, flags);
  }
}
