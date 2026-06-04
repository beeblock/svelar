/**
 * make:deploy — Convenience command that runs make:docker + make:ci + make:infra.
 */

import { Command } from '../Command.js';
import { MakeDockerCommand } from './MakeDockerCommand.js';
import { MakeCiCommand } from './MakeCiCommand.js';
import { MakeInfraCommand } from './MakeInfraCommand.js';

const dockerFlags = new MakeDockerCommand().flags;

export class MakeDeployCommand extends Command {
  name = 'make:deploy';
  description = 'Scaffold all deployment files (Docker, CI/CD, infrastructure)';
  arguments = [];
  flags = dockerFlags;

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
