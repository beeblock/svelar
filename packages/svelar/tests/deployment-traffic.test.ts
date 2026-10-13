import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BlueGreenDeployment, defaultDeploymentManifest } from '../src/deployment/BlueGreen.js';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function docker(args: string[]) { return (await run('docker', args, { timeout: 60000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim(); }
async function until<T>(callback: () => Promise<T>, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout;
  do { const result = await callback(); if (result) return result; await sleep(25); } while (Date.now() < deadline);
  throw new Error('Deployment traffic condition timed out.');
}

describe.skipIf(process.env.SVELAR_TEST_DEPLOY_DOCKER !== '1')('Native Docker/Caddy start-first traffic and rollback', () => {
  let directory: string; let cwd: string; let project: string; let network: string; let volume: string;
  let images: Record<string, string>;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'svelar-deployment-traffic-'));
    await build({ entryPoints: [resolve('tests/deployment-traffic-fixture.ts')], outfile: join(directory, 'server.mjs'), bundle: true,
      platform: 'node', format: 'esm', target: 'node22', keepNames: true, logLevel: 'silent' });
    await writeFile(join(directory, 'Dockerfile'), `FROM node:24-alpine\nWORKDIR /app\nCOPY server.mjs ./\nARG VERSION\nARG NOT_READY=0\nARG BAD_GATEWAY=0\nENV RELEASE_VERSION=$VERSION NOT_READY=$NOT_READY BAD_GATEWAY=$BAD_GATEWAY\nCMD ["node","server.mjs"]\n`);
    const imagePrefix = `svelar-deploy-proof-${crypto.randomUUID().slice(0, 8)}`; images = {};
    for (const version of ['one', 'two', 'not-ready', 'bad-gateway']) {
      images[version] = `${imagePrefix}:${version}`;
      await docker(['build', '--quiet', '--tag', images[version], '--build-arg', `VERSION=${version}`,
        '--build-arg', `NOT_READY=${version === 'not-ready' ? 1 : 0}`, '--build-arg', `BAD_GATEWAY=${version === 'bad-gateway' ? 1 : 0}`, directory]);
    }
    await docker(['image', 'inspect', 'caddy:2.11.7-alpine']).catch(() => docker(['pull', 'caddy:2.11.7-alpine']));
  }, 120000);
  beforeEach(async () => {
    project = `svelar-deploy-${crypto.randomUUID().slice(0, 12)}`; cwd = join(directory, project); await mkdir(cwd);
    network = `${project}_default`; volume = `${project}_storage`;
    await docker(['network', 'create', network]); await docker(['volume', 'create', volume]);
    await writeFile(join(cwd, 'docker-compose.yml'), JSON.stringify({ name: project, services: { app: {
      image: images.one, ports: [{ target: 3000, published: '0', host_ip: '127.0.0.1' }],
      environment: { START_DELAY: '200' }, volumes: [{ type: 'volume', source: 'app_storage', target: '/app/storage' }],
    } }, networks: { default: { name: network, external: true } }, volumes: { app_storage: { name: volume, external: true } } }));
    await writeFile(join(cwd, 'docker-compose.prod.yml'), JSON.stringify({ services: { app: { image: images.one } } }));
    await writeFile(join(cwd, 'svelar.deploy.json'), JSON.stringify({ ...defaultDeploymentManifest, runtimeServices: ['app'], readinessTimeout: 8, drainTimeout: 15 }));
  }, 30000);
  afterEach(async () => {
    for (const name of [project, `${project}-blue`, `${project}-green`, `${project}-gateway`]) {
      const ids = (await docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${name}`])).split('\n').filter(Boolean);
      if (ids.length) await docker(['rm', '-f', ...ids]);
    }
    await docker(['network', 'rm', network]); await docker(['volume', 'rm', volume]);
  }, 30000);
  afterAll(async () => { if (images) await docker(['image', 'rm', ...Object.values(images)]); if (directory) await rm(directory, { recursive: true, force: true }); });
  function engine() { return new BlueGreenDeployment(cwd); }
  async function deploy(version: string) { return engine().deploy({ image: images[version], pull: false, migrate: false }); }
  async function address() {
    const mapping = await docker(['compose', '-f', join(cwd, '.svelar/deployment/gateway.compose.json'), 'port', 'gateway', '3000']);
    return `http://${mapping}`;
  }
  async function body(url: string, timeout = 3000) { const response = await fetch(url, { signal: AbortSignal.timeout(timeout) }); expect(response.status).toBe(200); return response.json(); }
  function traffic(url: string) {
    let stopping = false; const statuses: number[] = []; const errors: unknown[] = [];
    const pending = (async () => { while (!stopping) {
      try { const response = await fetch(url, { signal: AbortSignal.timeout(2500) }); statuses.push(response.status); await response.arrayBuffer(); }
      catch (error) { errors.push(error); } await sleep(20);
    } })();
    return { statuses, errors, async stop() { stopping = true; await pending; } };
  }

  it('promotes a genuinely different image start-first under traffic, drains an old in-flight request and rolls back on the same public port', async () => {
    const first = await deploy('one'); const url = await address(); const load = traffic(url);
    try {
      const oldIds = await docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}-blue`]);
      const slow = body(`${url}/slow`, 60000); await until(async () => (await body(`${url}/inflight`)).inflight === 1);
      const promotion = deploy('two');
      await until(async () => (await docker(['logs', oldIds])).includes('"event":"draining","inflight":1'), 45000);
      await body(`${url}/release-slow`); expect((await slow).version).toBe('one');
      const second = await promotion; expect(second.releases.green?.imageId).not.toBe(first.releases.blue?.imageId);
      expect((await body(url)).version).toBe('two');
      const [old] = JSON.parse(await docker(['inspect', oldIds])); expect(old.State).toMatchObject({ Status: 'exited', ExitCode: 0 });
      const rolledBack = await engine().deploy({ rollback: true }); expect(rolledBack.active).toBe('blue');
      expect((await body(url)).version).toBe('one'); expect(await address()).toBe(url);
    } finally { await load.stop(); }
    expect(load.statuses.length).toBeGreaterThan(20); expect(load.statuses.every(status => status === 200)).toBe(true); expect(load.errors).toEqual([]);
  }, 120000);

  it('leaves the current image, gateway and traffic intact when the candidate never becomes ready', async () => {
    await deploy('one'); const url = await address(); const load = traffic(url);
    try { await expect(deploy('not-ready')).rejects.toThrow(); expect((await body(url)).version).toBe('one'); }
    finally { await load.stop(); }
    expect(load.errors).toEqual([]); expect(load.statuses.every(status => status === 200)).toBe(true);
    expect(JSON.parse(await readFile(join(cwd, '.svelar/deployment/state.json'), 'utf8')).active).toBe('blue');
  }, 90000);

  it('automatically restores the old route after a real post-switch gateway smoke failure while ordinary traffic continues', async () => {
    await deploy('one'); const url = await address(); const load = traffic(url);
    try { await expect(deploy('bad-gateway')).rejects.toThrow(); expect((await body(url)).version).toBe('one'); }
    finally { await load.stop(); }
    expect(load.errors).toEqual([]); expect(load.statuses.every(status => status === 200)).toBe(true);
    expect(JSON.parse(await readFile(join(cwd, '.svelar/deployment/state.json'), 'utf8')).active).toBe('blue');
  }, 90000);

  it('refuses legacy runtime adoption without stopping any existing container or rebinding its public port', async () => {
    await docker(['compose', '-f', join(cwd, 'docker-compose.yml'), 'up', '-d', '--no-build', 'app']);
    const before = await docker(['compose', '-f', join(cwd, 'docker-compose.yml'), 'ps', '-q', 'app']);
    await expect(deploy('two')).rejects.toThrow('Legacy runtime containers are still active');
    const [after] = JSON.parse(await docker(['inspect', before])); expect(after.State.Running).toBe(true);
    expect(await docker(['compose', '-f', join(cwd, 'docker-compose.yml'), 'ps', '-q', 'app'])).toBe(before);
    await expect(readFile(join(cwd, '.svelar/deployment/state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20000);
});
