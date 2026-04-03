/**
 * DockerComposeCommand — Abstract base for docker compose runtime commands.
 *
 * Provides shared compose file resolution and execution logic for
 * dev:* and prod:* commands.
 */

import { Command } from '../Command.js';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

export abstract class DockerComposeCommand extends Command {
  arguments = [];

  protected composeExec(args: string[], dev: boolean, flags: Record<string, any> = {}): void {
    const cwd = process.cwd();
    const base = join(cwd, 'docker-compose.yml');
    const override = join(cwd, dev ? 'docker-compose.dev.yml' : 'docker-compose.prod.yml');

    if (!existsSync(base)) {
      this.error('docker-compose.yml not found. Run `npx svelar make:docker` first.');
      return;
    }

    if (!existsSync(override)) {
      const name = dev ? 'docker-compose.dev.yml' : 'docker-compose.prod.yml';
      this.error(`${name} not found. Run \`npx svelar make:docker\` first.`);
      return;
    }

    const service = flags.service as string | undefined;

    // Validate service name to prevent command injection
    if (service && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(service)) {
      this.error(`Invalid service name: ${service}`);
      return;
    }

    const parts = [
      'docker', 'compose',
      '-f', 'docker-compose.yml',
      '-f', dev ? 'docker-compose.dev.yml' : 'docker-compose.prod.yml',
      ...args,
    ];

    if (service) {
      parts.push(service);
    }

    const cmd = parts.join(' ');
    this.info(cmd);

    try {
      execSync(cmd, { cwd, stdio: 'inherit' });
    } catch {
      // Exit code is already visible to the user via stdio: 'inherit'
    }
  }
}
