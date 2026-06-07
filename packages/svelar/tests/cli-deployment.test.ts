import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

import { execSync } from 'node:child_process';
import { DevLogsCommand } from '../src/cli/commands/DevLogsCommand';
import { DevRestartCommand } from '../src/cli/commands/DevRestartCommand';
import { DevUpCommand } from '../src/cli/commands/DevUpCommand';
import { KeyGenerateCommand } from '../src/cli/commands/KeyGenerateCommand';
import { MakeCiCommand } from '../src/cli/commands/MakeCiCommand';
import { MakeDeployCommand } from '../src/cli/commands/MakeDeployCommand';
import { MakeDockerCommand } from '../src/cli/commands/MakeDockerCommand';
import { MakeInfraCommand } from '../src/cli/commands/MakeInfraCommand';
import { MakeSeederCommand } from '../src/cli/commands/MakeSeederCommand';
import { MakeTestCommand } from '../src/cli/commands/MakeTestCommand';
import { ProdDeployCommand } from '../src/cli/commands/ProdDeployCommand';

let originalCwd: string;
let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function prepareComposeFiles(): void {
  writeFileSync(join(tmpDir, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(tmpDir, 'docker-compose.dev.yml'), 'services: {}\n');
  writeFileSync(join(tmpDir, 'docker-compose.prod.yml'), 'services: {}\n');
}

describe('CLI deployment and utility commands', () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = join(originalCwd, `.test-cli-deploy-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    process.chdir(tmpDir);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(execSync).mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('generates GitHub Actions deployment workflow and respects overwrite safeguards', async () => {
    const command = new MakeCiCommand();

    await command.handle([], {});

    const workflowPath = join(tmpDir, '.github', 'workflows', 'deploy.yml');
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('DOCKER_USERNAME');
    expect(workflow).toContain('DROPLET_SSH_KEY');
    expect(workflow).toContain('ENV_PROD');

    writeFileSync(workflowPath, 'custom workflow');
    await command.handle([], {});
    expect(readFileSync(workflowPath, 'utf8')).toBe('custom workflow');

    await command.handle([], { force: true });
    expect(readFileSync(workflowPath, 'utf8')).toContain('DOCKER_USERNAME');
  });

  it('generates infrastructure files, executable setup script, and gitignore secret entry', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: '@scope/my-app' }));

    await new MakeInfraCommand().handle([], {});

    const scriptPath = join(tmpDir, 'infra', 'setup-droplet.sh');
    const envPath = join(tmpDir, 'infra', 'droplet.env.example');
    const gitignorePath = join(tmpDir, '.gitignore');

    expect(readFileSync(scriptPath, 'utf8')).toContain('PROJECT_NAME');
    expect(readFileSync(envPath, 'utf8')).toContain('my-app');
    expect(statSync(scriptPath).mode & 0o111).toBeGreaterThan(0);
    expect(readFileSync(gitignorePath, 'utf8')).toContain('infra/droplet.env');

    writeFileSync(envPath, 'custom env');
    await new MakeInfraCommand().handle([], {});
    expect(readFileSync(envPath, 'utf8')).toBe('custom env');
  });

  it('generates all deployment files through make:deploy', async () => {
    await new MakeDeployCommand().handle([], {
      force: true,
      nodeVersion: '24',
      packageManager: 'npm',
      database: 'postgres',
      redis: true,
      soketi: false,
      caddy: true,
      pgbouncer: true,
      rustfs: true,
    });

    expect(existsSync(join(tmpDir, 'Dockerfile'))).toBe(true);
    expect(existsSync(join(tmpDir, 'docker-compose.yml'))).toBe(true);
    expect(existsSync(join(tmpDir, '.github', 'workflows', 'deploy.yml'))).toBe(true);
    expect(existsSync(join(tmpDir, 'infra', 'setup-droplet.sh'))).toBe(true);
  });

  it('generates production-hardened Docker runtime templates', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: '@scope/my-app' }));

    await new MakeDockerCommand().handle([], {
      force: true,
      meilisearch: true,
    });

    const dockerfile = readFileSync(join(tmpDir, 'Dockerfile'), 'utf8');
    const compose = readFileSync(join(tmpDir, 'docker-compose.yml'), 'utf8');
    const composeDev = readFileSync(join(tmpDir, 'docker-compose.dev.yml'), 'utf8');
    const devRuntime = readFileSync(join(tmpDir, 'scripts', 'svelar-dev-runtime.mjs'), 'utf8');

    expect(existsSync(join(tmpDir, '.svelar-local', '.gitkeep'))).toBe(true);
    expect(dockerfile).toContain('COPY .svelar-local ./.svelar-local');
    expect(dockerfile).toContain('COPY --chown=sveltekit:sveltekit --from=builder /app/src ./src');
    expect(dockerfile).toContain('COPY --chown=sveltekit:sveltekit --from=builder /app/svelar.database.json ./');
    expect(dockerfile).not.toContain('ecosystem.config.cjs');
    expect(dockerfile).toContain('CMD ["node", "build/index.js"]');
    expect(dockerfile).toContain('http://127.0.0.1:3000/api/health');

    expect(compose).toContain('      target: production');
    expect(compose).toContain('  worker:');
    expect(compose).toContain('command: ["npx", "svelar", "queue:work", "--max-time=3600", "--queue=default"]');
    expect(compose).toContain('  scheduler:');
    expect(compose).toContain('command: ["npx", "svelar", "schedule:run"]');
    expect(compose).toContain('memory: ${WORKER_MEMORY_LIMIT:-512M}');
    expect(compose).toContain('memory: ${SCHEDULER_MEMORY_LIMIT:-256M}');
    expect(compose).not.toContain('pm2');
    expect(compose).toContain('- ORIGIN=${APP_URL:-http://localhost:3000}');
    expect(compose).toContain('- INTERNAL_APP_URL=http://app:3000');
    expect(compose).toContain('AUTH_TYPE: scram-sha-256');
    expect(compose).toContain('PGPASSWORD=${DB_PASSWORD:-secret} pg_isready -h 127.0.0.1 -p 6432 -U ${DB_USER:-svelar} -d ${DB_NAME:-svelar}');
    expect(compose).toContain('redis-server --requirepass ${REDIS_PASSWORD:-svelarsecret} --save "" --appendonly no --stop-writes-on-bgsave-error no');
    expect(compose).toContain('- "${SOKETI_PORT:-5334}:6001"');
    expect(compose).toContain("node -e \\\"require('http').get('http://127.0.0.1:6001'");
    expect(compose).toContain('image: rustfs/rustfs:latest');
    expect(compose).not.toContain('minio/minio');
    expect(compose).toContain('- "${MEILI_PORT:-5333}:7700"');
    expect(compose).toContain('http://127.0.0.1:7700/health');

    expect(composeDev).toContain('- "${PGBOUNCER_HOST_PORT:-56432}:6432"');
    expect(composeDev).toContain('- "${REDIS_HOST_PORT:-56379}:6379"');
    expect(composeDev).toContain('- "${GOTENBERG_HOST_PORT:-53000}:3000"');
    expect(composeDev).toContain('- "${RUSTFS_API_PORT:-5335}:9000"');
    expect(devRuntime).toContain("spawn('npx', ['svelar'");
    expect(devRuntime).toContain('PGBOUNCER_HOST_PORT');
  });

  it('builds docker compose commands for dev and prod runtime commands without shelling unsafe service names', async () => {
    prepareComposeFiles();

    await new DevUpCommand().handle([], { service: 'web' });
    await new DevLogsCommand().handle([], { service: 'postgres_1' });
    await new DevRestartCommand().handle([], {});
    await new ProdDeployCommand().handle([], { service: 'worker-1' });

    expect(vi.mocked(execSync).mock.calls.map((call) => call[0])).toEqual([
      'docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build web',
      'docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f postgres_1',
      'docker compose -f docker-compose.yml -f docker-compose.dev.yml down',
      'docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build',
      'docker compose -f docker-compose.yml -f docker-compose.prod.yml pull worker-1',
      'docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d worker-1',
    ]);

    await new DevUpCommand().handle([], { service: 'web; rm -rf /' });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid service name'));
    expect(vi.mocked(execSync).mock.calls).toHaveLength(6);
  });

  it('reports missing docker compose files before executing runtime commands', async () => {
    await new DevUpCommand().handle([], {});

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('docker-compose.yml not found'));
    expect(vi.mocked(execSync)).not.toHaveBeenCalled();

    writeFileSync(join(tmpDir, 'docker-compose.yml'), 'services: {}\n');
    await new ProdDeployCommand().handle([], {});

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('docker-compose.prod.yml not found'));
    expect(vi.mocked(execSync)).not.toHaveBeenCalled();
  });

  it('generates APP_KEY values for show, create, example-copy, skip, and force flows', async () => {
    const command = new KeyGenerateCommand();

    await command.handle([], { show: true });
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/APP_KEY=[a-f0-9]{64}/));
    expect(existsSync(join(tmpDir, '.env'))).toBe(false);

    writeFileSync(join(tmpDir, '.env.example'), 'APP_KEY=change-me-to-a-random-string\nAPP_NAME=Demo\n');
    await command.handle([], {});
    let env = readFileSync(join(tmpDir, '.env'), 'utf8');
    expect(env).toMatch(/^APP_KEY=[a-f0-9]{64}$/m);
    expect(env).toContain('APP_NAME=Demo');

    writeFileSync(join(tmpDir, '.env'), 'APP_KEY=existing\n');
    await command.handle([], {});
    expect(readFileSync(join(tmpDir, '.env'), 'utf8')).toBe('APP_KEY=existing\n');

    await command.handle([], { force: true });
    env = readFileSync(join(tmpDir, '.env'), 'utf8');
    expect(env).toMatch(/^APP_KEY=[a-f0-9]{64}$/m);
    expect(env).not.toContain('existing');
  });

  it('generates seeders and test files for unit, feature, and e2e workflows', async () => {
    await new MakeSeederCommand().handle(['User'], {});
    const seederPath = join(tmpDir, 'src', 'lib', 'database', 'seeders', 'UserSeeder.ts');
    expect(readFileSync(seederPath, 'utf8')).toContain('export class UserSeeder extends Seeder');

    const testCommand = new MakeTestCommand();
    await testCommand.handle(['UserService'], {});
    await testCommand.handle(['AuthFlow'], { feature: true });
    await testCommand.handle(['Dashboard'], { e2e: true });

    expect(readFileSync(join(tmpDir, 'tests', 'unit', 'UserService.test.ts'), 'utf8')).toContain("describe('UserService'");
    expect(readFileSync(join(tmpDir, 'tests', 'feature', 'AuthFlow.test.ts'), 'utf8')).toContain('useSvelarTest');
    expect(readFileSync(join(tmpDir, 'tests', 'e2e', 'Dashboard.spec.ts'), 'utf8')).toContain("@playwright/test");

    chmodSync(seederPath, 0o644);
    await new MakeSeederCommand().handle(['User'], {});
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('UserSeeder already exists'));
  });
});
