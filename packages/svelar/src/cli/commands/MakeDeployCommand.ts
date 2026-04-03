/**
 * make:deploy — Convenience command that runs make:docker + make:ci + make:infra.
 */

import { Command } from '../Command.js';
import { MakeDockerCommand } from './MakeDockerCommand.js';
import { MakeCiCommand } from './MakeCiCommand.js';
import { MakeInfraCommand } from './MakeInfraCommand.js';

export class MakeDeployCommand extends Command {
  name = 'make:deploy';
  description = 'Scaffold all deployment files (Docker, CI/CD, infrastructure)';
  arguments = [];
  flags = [
    { name: 'db', alias: 'd', description: 'Database driver: postgres, mysql, sqlite (default: postgres)', type: 'string' as const },
    { name: 'image', alias: 'i', description: 'Docker image name (default: package.json name)', type: 'string' as const },
    { name: 'registry', description: 'Docker registry prefix (default: Docker Hub)', type: 'string' as const },
    { name: 'port', description: 'Production port (default: 3000)', type: 'string' as const },
    { name: 'dev-port', description: 'Development port (default: 5173)', type: 'string' as const },
    { name: 'force', alias: 'f', description: 'Overwrite existing files', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    this.info('Scaffolding all deployment files...');
    this.newLine();

    const docker = new MakeDockerCommand();
    await docker.handle(args, flags);

    this.newLine();
    this.log('────────────────────────────────────────');
    this.newLine();

    const ci = new MakeCiCommand();
    await ci.handle(args, flags);

    this.newLine();
    this.log('────────────────────────────────────────');
    this.newLine();

    const infra = new MakeInfraCommand();
    await infra.handle(args, flags);

    this.newLine();
    this.success('All deployment files scaffolded!');
  }
}
