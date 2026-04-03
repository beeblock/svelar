/**
 * make:infra — Generate DigitalOcean droplet setup script and env template.
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeployTemplates } from './DeployTemplates.js';

export class MakeInfraCommand extends Command {
  name = 'make:infra';
  description = 'Scaffold infrastructure files (droplet setup script, env template)';
  arguments = [];
  flags = [
    { name: 'force', alias: 'f', description: 'Overwrite existing files', type: 'boolean' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const cwd = process.cwd();
    const force = flags.force ?? false;
    const appName = this.resolveAppName(cwd);

    const infraDir = join(cwd, 'infra');
    mkdirSync(infraDir, { recursive: true });

    const files: Array<{ path: string; content: string; label: string }> = [
      {
        path: join(infraDir, 'setup-droplet.sh'),
        content: DeployTemplates.setupDropletScript(),
        label: 'infra/setup-droplet.sh',
      },
      {
        path: join(infraDir, 'droplet.env.example'),
        content: DeployTemplates.dropletEnvExample(appName),
        label: 'infra/droplet.env.example',
      },
    ];

    let created = 0;
    let skipped = 0;

    for (const file of files) {
      if (existsSync(file.path) && !force) {
        this.warn(`${file.label} already exists (use --force to overwrite)`);
        skipped++;
        continue;
      }
      writeFileSync(file.path, file.content);
      this.success(`Created ${file.label}`);
      created++;
    }

    this.newLine();
    if (created > 0) {
      this.info(`${created} file(s) created${skipped > 0 ? `, ${skipped} skipped` : ''}`);
    } else {
      this.info('No files created (all exist already)');
    }

    this.newLine();
    this.info('Usage:');
    this.log('  # Run on a fresh Ubuntu droplet as root:');
    this.log('  ssh root@your-droplet \'bash -s\' < infra/setup-droplet.sh');
    this.newLine();
    this.log('  # Then copy the env template:');
    this.log('  scp infra/droplet.env.example deploy@your-droplet:~/app/.env');
  }

  private resolveAppName(cwd: string): string {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') {
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    } catch {
      // No package.json or invalid
    }
    return 'svelar-app';
  }
}
