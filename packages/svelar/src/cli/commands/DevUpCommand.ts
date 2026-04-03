/**
 * dev:up — Start development containers with hot-reload.
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class DevUpCommand extends DockerComposeCommand {
  name = 'dev:up';
  description = 'Start development containers (docker compose up with dev override)';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    this.composeExec(['up', '-d', '--build'], true, flags);
  }
}
