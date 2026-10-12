/**
 * prod:deploy — Pull latest images and redeploy production containers.
 */

import { DockerComposeCommand } from './DockerComposeCommand.js';

export class ProdDeployCommand extends DockerComposeCommand {
  name = 'prod:deploy';
  description = 'Pull latest images, run migrations, and redeploy production containers';
  flags = [
    { name: 'service', description: 'Target a specific service', type: 'string' as const },
    { name: 'migrate', description: 'Run migrations before starting the new app image (default: true; use --no-migrate to skip)', type: 'boolean' as const, default: true },
    { name: 'wait', description: 'Wait for healthy containers before returning (default: true; use --no-wait to skip)', type: 'boolean' as const, default: true },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    if (!this.composeExec(['pull'], false, flags)) return;

    const service = flags.service as string | undefined;
    if (flags.migrate !== false && (!service || service === 'app')) {
      if (!this.composeExec(['run', '--rm', '--no-deps', 'app', 'npx', 'svelar', 'migrate', '--force'], false, flags, { appendService: false })) {
        return;
      }
    }

    const upArgs = ['up', '-d', '--remove-orphans'];
    if (flags.wait !== false) upArgs.push('--wait');
    this.composeExec(upArgs, false, flags);
  }
}
