/**
 * prod:deploy — Promote an explicit immutable release through the stable gateway.
 */

import { Command } from '../Command.js';
import { BlueGreenDeployment } from '../../deployment/BlueGreen.js';

export class ProdDeployCommand extends Command {
  name = 'prod:deploy';
  description = 'Deploy an immutable release start-first with readiness, drain and retained rollback';
  flags = [
    { name: 'image', description: 'Release image tag or digest (latest is rejected)', type: 'string' as const },
    { name: 'rollback', description: 'Promote the previous retained release without undoing database migrations', type: 'boolean' as const },
    { name: 'pull', description: 'Pull the release image; use --no-pull for a locally built immutable image', type: 'boolean' as const, default: true },
    { name: 'migrate', description: 'Run migrations before starting the new app image (default: true; use --no-migrate to skip)', type: 'boolean' as const, default: true },
    { name: 'compatible-migrations', description: 'Confirm forward migrations remain compatible with both releases', type: 'boolean' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    if (flags.service || flags.wait === false) throw new Error('Blue/green deployment is a complete release and cannot bypass readiness. Use explicit prod:restart for disruptive maintenance.');
    await new BlueGreenDeployment(process.cwd(), undefined, message => this.info(message)).deploy({ image: flags.image,
      rollback: flags.rollback, pull: flags.pull, migrate: flags.migrate, compatibleMigrations: flags['compatible-migrations'] });
  }
}
