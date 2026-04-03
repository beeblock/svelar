/**
 * prod:logs — Follow production container logs.
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class ProdLogsCommand extends DockerComposeCommand {
  name = 'prod:logs';
  description = 'Follow production container logs';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    this.composeExec(['logs', '-f'], false, flags);
  }
}
