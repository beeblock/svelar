/**
 * infra:setup — Provision a droplet by running infra/setup-droplet.sh.
 *
 * Supports two modes:
 *   1. Config file: reads from infra/droplet.env (default)
 *   2. CLI flags: --ip, --key, --user, --deploy-user, --project
 *
 * The setup script SSHs into the droplet, creates a deploy user,
 * installs Docker if needed, copies compose files, and configures UFW.
 *
 * .env is NOT copied — it's managed by CI/CD via the ENV_PROD secret.
 */

import { Command } from '../Command.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export class InfraSetupCommand extends Command {
  name = 'infra:setup';
  description = 'Provision a droplet via SSH and copy deployment files';
  arguments = [];
  flags = [
    { name: 'config', alias: 'c', description: 'Path to config file (default: infra/droplet.env)', type: 'string' as const },
    { name: 'ip', description: 'Droplet IP or hostname', type: 'string' as const },
    { name: 'key', alias: 'k', description: 'Path to SSH private key', type: 'string' as const },
    { name: 'user', alias: 'u', description: 'SSH user for initial setup (default: root)', type: 'string' as const },
    { name: 'deploy-user', description: 'Deploy user to create (default: deploy)', type: 'string' as const },
    { name: 'project', alias: 'p', description: 'Project name / remote directory name', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const cwd = process.cwd();
    const setupScript = join(cwd, 'infra', 'setup-droplet.sh');

    // ── Validate setup script exists ──
    if (!existsSync(setupScript)) {
      this.error('infra/setup-droplet.sh not found. Run `npx svelar make:infra` first.');
      return;
    }

    // ── Determine config source: flags or config file ──
    const hasFlags = flags.ip || flags.key;
    const configPath = (flags.config as string) ?? join(cwd, 'infra', 'droplet.env');

    if (hasFlags) {
      // ── Flag mode: validate required flags ──
      const missing: string[] = [];
      if (!flags.ip) missing.push('--ip');
      if (!flags.key) missing.push('--key');

      if (missing.length > 0) {
        this.error(`Missing required flags: ${missing.join(', ')}`);
        this.newLine();
        this.info('Usage with flags:');
        this.log('  npx svelar infra:setup --ip=123.45.67.89 --key=~/.ssh/id_ed25519');
        this.newLine();
        this.info('Or create a config file:');
        this.log('  cp infra/droplet.env.example infra/droplet.env');
        this.log('  npx svelar infra:setup');
        return;
      }

      // Build a temporary env for the script
      const appName = this.resolveAppName(cwd);
      const envVars = [
        `DROPLET_IP=${flags.ip}`,
        `SSH_KEY_PATH=${flags.key}`,
        `DEPLOY_USER=${flags['deploy-user'] ?? 'deploy'}`,
        `PROJECT_NAME=${flags.project ?? appName}`,
      ].join(' ');

      this.info('Running infra/setup-droplet.sh with flags...');
      this.newLine();

      try {
        execSync(
          `${envVars} bash "${setupScript}"`,
          { stdio: 'inherit', cwd, shell: 'bash' },
        );
      } catch {
        this.newLine();
        this.error('Setup failed. Check the output above for details.');
      }
    } else {
      // ── Config file mode ──
      if (!existsSync(configPath)) {
        this.error(`Config file not found: ${configPath}`);
        this.newLine();
        this.info('Option 1 — Create a config file:');
        this.log('  cp infra/droplet.env.example infra/droplet.env');
        this.log('  # Fill in DROPLET_IP, DEPLOY_USER, PROJECT_NAME, SSH_KEY_PATH');
        this.log('  npx svelar infra:setup');
        this.newLine();
        this.info('Option 2 — Pass values as flags:');
        this.log('  npx svelar infra:setup --ip=123.45.67.89 --key=~/.ssh/id_ed25519');
        this.newLine();
        this.info('Required variables:');
        this.log('  DROPLET_IP      — Server IP address');
        this.log('  SSH_KEY_PATH    — Path to SSH private key (.pub must exist alongside)');
        this.log('  DEPLOY_USER     — Non-root user to create (default: deploy)');
        this.log('  PROJECT_NAME    — Remote directory name (default: package.json name)');
        return;
      }

      // Validate the config file has required vars
      const content = readFileSync(configPath, 'utf-8');
      const vars = this.parseEnvFile(content);
      const required = ['DROPLET_IP', 'SSH_KEY_PATH'];
      const missing: string[] = [];

      for (const key of required) {
        if (!vars[key]) missing.push(key);
      }

      if (missing.length > 0) {
        this.error(`Missing required variables in ${configPath}:`);
        for (const key of missing) {
          this.log(`  ${key} is empty or not set`);
        }
        this.newLine();
        this.info('Edit the config file and fill in the required values.');
        return;
      }

      this.info('Running infra/setup-droplet.sh...');
      this.newLine();

      try {
        execSync(
          `bash "${setupScript}" --config "${configPath}"`,
          { stdio: 'inherit', cwd },
        );
      } catch {
        this.newLine();
        this.error('Setup failed. Check the output above for details.');
      }
    }
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

  private parseEnvFile(content: string): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
    return vars;
  }
}
