/**
 * prod:restart — Recreate production runtime containers without tearing down dependencies.
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class ProdRestartCommand extends DockerComposeCommand {
  name = 'prod:restart';
  description = 'Recreate production runtime containers and wait for health checks';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
    { name: 'wait', description: 'Wait for healthy containers before returning (default: true; use --no-wait to skip)', type: 'boolean' as const, default: true },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const args = ['up', '-d', '--force-recreate', '--remove-orphans'];
    if (flags.wait !== false) args.push('--wait');

    this.composeExec(args, false, flags, {
      defaultServices: ['app', 'worker', 'scheduler'],
    });
  }
}
