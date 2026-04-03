/**
 * make:ci — Generate GitHub Actions CI/CD workflow.
 *
 * All values come from GitHub Secrets — nothing is hardcoded in the
 * generated workflow file.
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DeployTemplates } from './DeployTemplates.js';

export class MakeCiCommand extends Command {
  name = 'make:ci';
  description = 'Scaffold GitHub Actions CI/CD workflow for Docker deploy';
  arguments = [];
  flags = [
    { name: 'force', alias: 'f', description: 'Overwrite existing files', type: 'boolean' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const cwd = process.cwd();
    const force = flags.force ?? false;

    const workflowDir = join(cwd, '.github', 'workflows');
    mkdirSync(workflowDir, { recursive: true });

    const workflowPath = join(workflowDir, 'deploy.yml');
    if (existsSync(workflowPath) && !force) {
      this.warn('.github/workflows/deploy.yml already exists (use --force to overwrite)');
      return;
    }

    writeFileSync(workflowPath, DeployTemplates.githubActionsWorkflow());
    this.success('Created .github/workflows/deploy.yml');

    this.newLine();
    this.info('Workflow steps: build image → push to Docker Hub → SCP compose files → SSH deploy');
    this.newLine();
    this.info('Required GitHub Secrets:');
    this.log('  DOCKER_USERNAME   — Docker Hub username');
    this.log('  DOCKER_TOKEN      — Docker Hub access token');
    this.log('  DOCKER_IMAGE_NAME — Docker image name (e.g. myapp)');
    this.log('  DROPLET_HOST      — Droplet IP or hostname');
    this.log('  DROPLET_USER      — SSH user on the droplet (e.g. deploy)');
    this.log('  DROPLET_SSH_KEY   — Private SSH key for the deploy user');
    this.log('  DROPLET_PROJECT   — Project directory name on the droplet');
    this.log('  ENV_PROD          — Complete production .env file contents');
  }
}
