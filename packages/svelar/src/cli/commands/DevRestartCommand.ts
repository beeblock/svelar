/**
 * dev:restart — Restart development containers (down + up).
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class DevRestartCommand extends DockerComposeCommand {
  name = 'dev:restart';
  description = 'Restart development containers (down + up)';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    this.composeExec(['down'], true, flags);
    this.composeExec(['up', '-d', '--build'], true, flags);
  }
}
