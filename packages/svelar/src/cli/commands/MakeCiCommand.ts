/**
 * make:ci — Generate GitHub Actions CI/CD workflow.
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeployTemplates } from './DeployTemplates.js';

export class MakeCiCommand extends Command {
  name = 'make:ci';
  description = 'Scaffold GitHub Actions CI/CD workflow for Docker deploy';
  arguments = [];
  flags = [
    { name: 'image', alias: 'i', description: 'Docker image name (default: package.json name)', type: 'string' as const },
    { name: 'registry', description: 'Docker registry prefix (default: Docker Hub)', type: 'string' as const },
    { name: 'force', alias: 'f', description: 'Overwrite existing files', type: 'boolean' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const cwd = process.cwd();
    const force = flags.force ?? false;
    const appName = this.resolveAppName(cwd);
    const image = (flags.image as string) ?? appName;
    const registry = flags.registry as string | undefined;
    const fullImage = registry ? `${registry}/${image}` : image;

    const workflowDir = join(cwd, '.github', 'workflows');
    mkdirSync(workflowDir, { recursive: true });

    const workflowPath = join(workflowDir, 'deploy.yml');
    if (existsSync(workflowPath) && !force) {
      this.warn('.github/workflows/deploy.yml already exists (use --force to overwrite)');
      return;
    }

    writeFileSync(workflowPath, DeployTemplates.githubActionsWorkflow(fullImage));
    this.success('Created .github/workflows/deploy.yml');

    this.newLine();
    this.info('Required GitHub Secrets:');
    this.log('  DOCKER_USERNAME  — Docker Hub username');
    this.log('  DOCKER_TOKEN     — Docker Hub access token');
    this.log('  DROPLET_HOST     — Droplet IP or hostname');
    this.log('  DROPLET_USER     — SSH user on the droplet (e.g. deploy)');
    this.log('  DROPLET_SSH_KEY  — Private SSH key for the deploy user');
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
