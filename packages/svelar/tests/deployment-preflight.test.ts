import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BlueGreenDeployment, defaultDeploymentManifest, type DeploymentExecutor } from '../src/deployment/BlueGreen.js';

let directory: string;
let config: any;
let calls: string[][];
let executor: DeploymentExecutor;
const foundationError = new Error('Missing deployment lock foundation');
const imageId = `sha256:${'a'.repeat(64)}`;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'svelar-deployment-preflight-'));
  await writeFile(join(directory, 'svelar.deploy.json'), JSON.stringify(defaultDeploymentManifest));
  config = { name: 'proof', services: {
    app: { build: '.', image: 'old:release', ports: [{ target: 3000, published: '32191' }],
      environment: { APP_KEY: 'private-test-key', QUEUE_DRIVER: 'redis' }, networks: { default: {} },
      volumes: [{ type: 'volume', source: 'storage', target: '/app/storage' }] },
    worker: { command: ['npx', 'svelar', 'queue:work'], environment: { ROLE: 'worker' }, networks: { default: {} } },
    scheduler: { command: ['npx', 'svelar', 'schedule:work'], networks: { default: {} } },
  }, networks: { default: { name: 'proof_default' } }, volumes: { storage: { name: 'proof_storage' } } };
  calls = [];
  executor = { async run(args) {
    calls.push([...args]);
    if (args.includes('config')) return JSON.stringify(config);
    if (args.includes('ps')) return '[]';
    if (args[0] === 'image') return JSON.stringify([{ Id: imageId }]);
    if (args.includes('--check')) throw foundationError;
    return '';
  } };
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function deploy() { return new BlueGreenDeployment(directory, executor).deploy({ image: 'example/app:release-123', pull: false, compatibleMigrations: true }); }
function runtimeChanged() { return calls.some(args => args.includes('up') || args.includes('stop') || args.includes('down') || args.includes('create') || args.includes('rm')); }

describe('Deployment fail-closed preflight', () => {
  it('rejects mutable image and unacknowledged migrations before invoking Docker', async () => {
    for (const image of ['example/app', 'example/app:latest', '--unsafe']) {
      await expect(new BlueGreenDeployment(directory, executor).deploy({ image, compatibleMigrations: true })).rejects.toThrow();
    }
    await expect(new BlueGreenDeployment(directory, executor).deploy({ image: 'example/app:release' })).rejects.toThrow('compatible-migrations');
    expect(calls).toEqual([]);
  });
  it('checks the foundation before starting, stopping or modifying existing runtime/infra', async () => {
    await expect(deploy()).rejects.toBe(foundationError);
    expect(calls.some(args => args.includes('deploy:migrate') && args.includes('--check'))).toBe(true);
    expect(calls.filter(args => args.includes('deploy:migrate'))).toHaveLength(1);
    expect(runtimeChanged()).toBe(false);
    expect(calls).toContainEqual(['network', 'inspect', 'proof_default']);
    expect(calls).toContainEqual(['volume', 'inspect', 'proof_storage']);
    await expect(stat(join(directory, '.svelar/deployment/deployment.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves environment, commands and shared volumes while pinning isolated runtime to the inspected image', async () => {
    await expect(deploy()).rejects.toBe(foundationError);
    const plan = JSON.parse(await readFile(join(directory, '.svelar/deployment/blue.compose.json'), 'utf8'));
    expect(plan.name).toBe('proof-blue');
    expect(plan.services.app_blue.image).toBe(imageId);
    expect(plan.services.app_blue.build).toBeUndefined();
    expect(plan.services.app_blue.ports).toBeUndefined();
    expect(plan.services.app_blue.environment).toMatchObject({ APP_KEY: 'private-test-key', QUEUE_DRIVER: 'redis',
      SVELAR_DEPLOY_SLOT: 'blue', SVELAR_DEPLOY_TRAFFIC_FILE: '/run/svelar-deploy/traffic.json', SHUTDOWN_TIMEOUT: '44' });
    expect(plan.services.worker_blue.command).toEqual(config.services.worker.command);
    expect(plan.services.worker_blue.environment.ROLE).toBe('worker');
    expect(plan.services.app_blue.networks).toEqual({ deployment: { aliases: ['proof-blue-app'] } });
    expect(plan.volumes.storage).toEqual({ external: true, name: 'proof_storage' });
    expect(plan.services.app_blue.volumes.at(-1)).toMatchObject({ target: '/run/svelar-deploy', read_only: true });
    expect((await stat(join(directory, '.svelar/deployment'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, '.svelar/deployment/blue.compose.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, '.svelar/deployment/traffic'))).mode & 0o777).toBe(0o755);
  });
  it.each(['fixed-name', 'extra-network', 'background-port'])('rejects unsupported topology: %s', async kind => {
    if (kind === 'fixed-name') config.services.worker.container_name = 'shared-worker';
    if (kind === 'extra-network') config.services.app.networks.admin = {};
    if (kind === 'background-port') config.services.scheduler.ports = [{ target: 3001, published: '32192' }];
    await expect(deploy()).rejects.toThrow('unsupported');
    expect(runtimeChanged()).toBe(false);
  });
  it('leaves existing legacy runtime untouched, including NDJSON Compose status', async () => {
    const original = executor.run;
    executor.run = async args => args.includes('ps') ? '{"Service":"postgres","State":"running"}\n{"Service":"app","State":"running"}' : original(args);
    await expect(deploy()).rejects.toThrow('Legacy runtime');
    expect(runtimeChanged()).toBe(false);
    expect(calls.some(args => args.includes('deploy:migrate'))).toBe(false);
  });
  it.each(['deployment.lock', 'pending.json'])('requires operator reconciliation of retained %s', async file => {
    const path = join(directory, '.svelar/deployment'); await mkdir(path, { recursive: true });
    await writeFile(join(path, file), '{"owner":"retained"}');
    await expect(deploy()).rejects.toThrow(file === 'deployment.lock' ? 'already locked' : 'journal');
    expect(await readFile(join(path, file), 'utf8')).toBe('{"owner":"retained"}');
    expect(runtimeChanged()).toBe(false);
  });
  it('does not migrate or pull an invented previous release on first-deploy rollback', async () => {
    await expect(new BlueGreenDeployment(directory, executor).deploy({ rollback: true })).rejects.toThrow('No previous retained release');
    expect(calls.some(args => args.includes('deploy:migrate') || args[0] === 'pull')).toBe(false);
    expect(runtimeChanged()).toBe(false);
  });
});
