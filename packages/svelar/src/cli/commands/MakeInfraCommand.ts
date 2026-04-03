/**
 * make:infra — Generate DigitalOcean droplet setup script and env template.
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync, chmodSync, appendFileSync } from 'node:fs';
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
        content: DeployTemplates.setupDropletScript(appName),
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
      // Make .sh files executable
      if (file.path.endsWith('.sh')) {
        chmodSync(file.path, 0o755);
      }
      this.success(`Created ${file.label}`);
      created++;
    }

    // ── Add infra/ secrets to .gitignore ──
    this.addToGitignore(cwd);

    this.newLine();
    if (created > 0) {
      this.info(`${created} file(s) created${skipped > 0 ? `, ${skipped} skipped` : ''}`);
    } else {
      this.info('No files created (all exist already)');
    }

    this.newLine();
    this.info('Next steps:');
    this.log('  1. Copy and fill in your config:');
    this.log('     cp infra/droplet.env.example infra/droplet.env');
    this.newLine();
    this.log('  2. Run the setup:');
    this.log('     npx svelar infra:setup');
    this.log('     (or: bash infra/setup-droplet.sh)');
  }

  private addToGitignore(cwd: string): void {
    const gitignorePath = join(cwd, '.gitignore');
    const entriesToAdd = [
      'infra/droplet.env',
    ];

    let content = '';
    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, 'utf-8');
    }

    const missing = entriesToAdd.filter((entry) => !content.includes(entry));
    if (missing.length === 0) return;

    const block = '\n# Infrastructure (contains server IPs and SSH key paths)\n' + missing.join('\n') + '\n';
    appendFileSync(gitignorePath, block);
    this.success('Updated .gitignore (infra/droplet.env)');
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
