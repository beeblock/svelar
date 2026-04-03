/**
 * dev:logs — Follow development container logs.
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class DevLogsCommand extends DockerComposeCommand {
  name = 'dev:logs';
  description = 'Follow development container logs';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    this.composeExec(['logs', '-f'], true, flags);
  }
}
