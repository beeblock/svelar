import { execFile } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { hostname } from 'node:os';

const execute = promisify(execFile);
type Slot = 'blue' | 'green';
interface Release { image: string; imageId: string; }
interface State { version: 1; active: Slot | null; releases: Partial<Record<Slot, Release>>; }
export interface DeploymentManifest {
  version: 1;
  strategy: 'blue-green';
  gatewayImage: string;
  readinessPath: string;
  trafficPath: string;
  smokePath: string;
  readinessTimeout: number;
  drainTimeout: number;
  network: string;
  runtimeServices: string[];
}
export interface BlueGreenOptions { image?: string; pull?: boolean; migrate?: boolean; compatibleMigrations?: boolean; rollback?: boolean; }
export interface DeploymentExecutor { run(args: string[], timeout?: number): Promise<string>; }
export class DeploymentDrainError extends Error {
  readonly committed = true;
  constructor(readonly active: Slot, cause: unknown) { super('The new release is active, but the previous runtime did not finish draining. Reconcile the retained deployment journal before retrying.', { cause }); }
}
export const defaultDeploymentManifest: Readonly<DeploymentManifest> = Object.freeze({ version: 1, strategy: 'blue-green',
  gatewayImage: 'caddy:2.11.7-alpine', readinessPath: '/api/ready', trafficPath: '/api/traffic', smokePath: '/api/health', readinessTimeout: 60,
  drainTimeout: 45, network: 'default', runtimeServices: ['app', 'worker', 'scheduler'] });

const docker: DeploymentExecutor = { async run(args, timeout = 120000) {
  const { stdout } = await execute('docker', args, { timeout, maxBuffer: 2 * 1024 * 1024, env: process.env }); return stdout;
} };
function imageReference(image: unknown): asserts image is string {
  if (typeof image !== 'string' || !/^[a-z0-9][a-zA-Z0-9._/:@-]*$/.test(image) || image.length > 512) throw new TypeError('Invalid Docker image reference.');
}
function releaseReference(image: unknown): asserts image is string {
  imageReference(image);
  const last = image.split('/').at(-1)!;
  if (!last.includes(':') || last.endsWith(':latest')) throw new Error('Deployments require an explicit release tag or digest, never latest.');
}
function manifest(input: any): DeploymentManifest {
  if (!input || input.version !== 1 || input.strategy !== 'blue-green') throw new Error('Unsupported deployment manifest; regenerate make:docker after reviewing existing files.');
  imageReference(input.gatewayImage);
  for (const field of ['readinessPath', 'trafficPath', 'smokePath']) if (typeof input[field] !== 'string' || !/^\/(?!\/)[^\\\s?#]*$/.test(input[field])) throw new Error(`Invalid deployment ${field}.`);
  for (const field of ['readinessTimeout', 'drainTimeout']) if (!Number.isSafeInteger(input[field]) || input[field] < (field === 'drainTimeout' ? 2 : 1) || input[field] > 600) throw new Error(`Invalid bounded deployment ${field}.`);
  if (!Array.isArray(input.runtimeServices) || !input.runtimeServices.includes('app') || new Set(input.runtimeServices).size !== input.runtimeServices.length ||
    input.runtimeServices.some((name: unknown) => typeof name !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(name))) throw new Error('Invalid deployment runtimeServices.');
  if (typeof input.network !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input.network)) throw new Error('Invalid deployment network.');
  return input;
}

/** Single Docker-host blue/green orchestration. Infra is inspected, never recreated. */
export class BlueGreenDeployment {
  private directory: string;
  private config: any;
  private settings!: DeploymentManifest;
  private project = '';
  constructor(private cwd = process.cwd(), private executor: DeploymentExecutor = docker, private log: (message: string) => void = () => {}) {
    this.cwd = resolve(cwd); this.directory = join(this.cwd, '.svelar', 'deployment');
  }
  private async json(path: string): Promise<any> { return JSON.parse(await readFile(path, 'utf8')); }
  private async write(path: string, value: unknown, mode = 0o600): Promise<void> {
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode }); await rename(temporary, path);
  }
  private file(slot: Slot): string { return join(this.directory, `${slot}.compose.json`); }
  private async compose(file: string, args: string[], timeout?: number): Promise<string> { return this.executor.run(['compose', '-f', file, ...args], timeout); }
  private async gateway(args: string[]): Promise<string> { return this.compose(join(this.directory, 'gateway.compose.json'), args); }
  private alias(slot: Slot): string { return `${this.project}-${slot}-app`; }
  private service(slot: Slot, name = 'app'): string { return `${name}_${slot}`; }
  private route(): any {
    return { admin: { listen: '127.0.0.1:2019' }, apps: { http: { servers: { svelar: { listen: [':3000'], routes: [{ handle: [{
      '@id': 'svelar_proxy', handler: 'reverse_proxy', upstreams: ['blue', 'green'].map(slot => ({ dial: `${this.alias(slot as Slot)}:3000` })),
      health_checks: { active: { uri: this.settings.trafficPath, interval: 1000000000, timeout: 2000000000, expect_status: 200 } },
    }] }] } } } } };
  }
  private async eligible(slots: Slot[]): Promise<void> {
    await this.write(join(this.directory, 'traffic', 'traffic.json'), { slots }, 0o644);
  }
  private async switch(slot: Slot, previous: Slot | null): Promise<void> {
    await this.eligible(previous ? [previous, slot] : [slot]);
    const script = `const r=await fetch(${JSON.stringify(`http://${this.project}-gateway:3000${this.settings.trafficPath}`)},{signal:AbortSignal.timeout(2000),redirect:'error'});if(r.status!==200||(await r.json())?.data?.slot!==${JSON.stringify(slot)})process.exit(1);`;
    const deadline = Date.now() + this.settings.readinessTimeout * 1000;
    do {
      try { await this.compose(this.file(slot), ['exec', '-T', this.service(slot), 'node', '--input-type=module', '-e', script], 5000); break; }
      catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
    } while (true);
    await this.eligible([slot]);
    // Two-second probe timeout + one-second interval before stopping the old backend.
    await new Promise(resolve => setTimeout(resolve, 3500));
  }
  private async probe(slot: Slot, path: string, readiness = false, gateway = false): Promise<void> {
    const script = `const response=await fetch(${JSON.stringify(`http://${gateway ? `${this.project}-gateway` : '127.0.0.1'}:3000${path}`)},{signal:AbortSignal.timeout(2000),redirect:'error'});if(response.status!==200)process.exit(1);${readiness ? 'if((await response.json())?.data?.ready!==true)process.exit(1);' : ''}`;
    await this.compose(this.file(slot), ['exec', '-T', this.service(slot), 'node', '--input-type=module', '-e', script], 5000);
  }
  private async ready(slot: Slot): Promise<void> {
    const deadline = Date.now() + this.settings.readinessTimeout * 1000;
    let last: unknown;
    do {
      try { await this.probe(slot, this.settings.readinessPath, true); return; }
      catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 250)); }
    } while (Date.now() < deadline);
    throw new Error('Candidate readiness did not succeed before the deployment deadline.', { cause: last });
  }
  private async trafficIdentity(slot: Slot): Promise<void> {
    const script = `const r=await fetch(${JSON.stringify(`http://127.0.0.1:3000${this.settings.trafficPath}`)},{signal:AbortSignal.timeout(2000),redirect:'error'});if(![200,503].includes(r.status)||(await r.json())?.data?.slot!==${JSON.stringify(slot)})process.exit(1);`;
    await this.compose(this.file(slot), ['exec', '-T', this.service(slot), 'node', '--input-type=module', '-e', script], 5000);
  }
  private async gatewaySmoke(slot: Slot, starting = false): Promise<void> {
    const deadline = Date.now() + (starting ? this.settings.readinessTimeout * 1000 : 0);
    do {
      try { await this.probe(slot, this.settings.smokePath, false, true); return; }
      catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
    } while (true);
  }
  private async stop(slot: Slot): Promise<void> {
    await this.compose(this.file(slot), ['stop', '--timeout', String(this.settings.drainTimeout)], (this.settings.drainTimeout + 15) * 1000);
  }
  private async prepare(): Promise<void> {
    this.settings = manifest(await this.json(join(this.cwd, 'svelar.deploy.json')));
    const base = ['compose', '--project-directory', this.cwd, '-f', join(this.cwd, 'docker-compose.yml'), '-f', join(this.cwd, 'docker-compose.prod.yml')];
    this.config = JSON.parse(await this.executor.run([...base, 'config', '--format', 'json']));
    this.project = this.config.name;
    if (typeof this.project !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,60}$/.test(this.project)) throw new Error('Invalid Compose project name.');
    if (!this.config.services?.app) throw new Error('A configured app service is required.');
    const network = this.config.networks?.[this.settings.network]?.name;
    if (typeof network !== 'string') throw new Error('The deployment network must have an explicit resolved Compose name.');
    await this.executor.run(['network', 'inspect', network]);
    for (const name of this.settings.runtimeServices) {
      const service = this.config.services[name];
      if (!service || service.container_name) throw new Error(`Runtime service ${name} is missing or has an unsupported fixed container_name.`);
      if (`${this.project}-green-${name}`.length > 63) throw new Error('The runtime DNS alias exceeds 63 characters; use a shorter Compose project/service name.');
      if (Object.keys(service.networks ?? {}).some(key => key !== this.settings.network)) throw new Error(`Runtime service ${name} has unsupported additional networks; isolation must not be silently discarded.`);
      if (name !== 'app' && service.ports?.length) throw new Error(`Runtime service ${name} has unsupported published background ports.`);
      for (const volume of service.volumes ?? []) if (volume.type === 'volume') {
        const resolved = this.config.volumes?.[volume.source]?.name;
        if (!resolved) throw new Error(`Shared volume ${volume.source} must resolve to an existing named volume.`);
        await this.executor.run(['volume', 'inspect', resolved]);
      }
    }
    const raw = (await this.executor.run([...base, 'ps', '--format', 'json'])).trim();
    let containers: any[] = [];
    if (raw) {
      try { const parsed = JSON.parse(raw); containers = Array.isArray(parsed) ? parsed : [parsed]; }
      catch { containers = raw.split('\n').map(line => JSON.parse(line)); }
    }
    if (containers.some((container: any) => this.settings.runtimeServices.includes(container.Service) && container.State === 'running')) {
      throw new Error('Legacy runtime containers are still active. Adopt the gateway in an explicitly planned first cutover; this command will not stop or rebind them.');
    }
  }
  private runtime(slot: Slot, release: Release): any {
    const services: Record<string, any> = {};
    const volumes: Record<string, any> = {};
    const network = this.config.networks[this.settings.network].name;
    for (const name of this.settings.runtimeServices) {
      const service = structuredClone(this.config.services[name]);
      delete service.build; delete service.ports; delete service.depends_on; delete service.profiles;
      service.image = release.imageId;
      service.networks = { deployment: { aliases: [name === 'app' ? this.alias(slot) : `${this.project}-${slot}-${name}`] } };
      service.environment = { ...service.environment, SHUTDOWN_TIMEOUT: String(this.settings.drainTimeout - 1),
        INTERNAL_APP_URL: `http://${this.project}-gateway:3000`, SVELAR_DEPLOY_SLOT: slot,
        SVELAR_DEPLOY_TRAFFIC_FILE: '/run/svelar-deploy/traffic.json' };
      service.volumes ??= [];
      service.volumes.push({ type: 'bind', source: join(this.directory, 'traffic'), target: '/run/svelar-deploy', read_only: true });
      service.stop_grace_period = `${this.settings.drainTimeout}s`;
      if (name === 'app') service.healthcheck = { test: ['CMD', 'node', '--input-type=module', '-e',
        `const r=await fetch(${JSON.stringify(`http://127.0.0.1:3000${this.settings.readinessPath}`)},{signal:AbortSignal.timeout(2000),redirect:'error'});if(r.status!==200||(await r.json())?.data?.ready!==true)process.exit(1);`],
        interval: '2s', timeout: '3s', start_period: '5s', retries: 3 };
      else if (!service.healthcheck || service.healthcheck.disable) this.log(`Background service ${name} has running-only startup coverage; configure a real healthcheck for readiness.`);
      for (const volume of service.volumes ?? []) if (volume.type === 'volume') volumes[volume.source] = { external: true, name: this.config.volumes[volume.source].name };
      services[this.service(slot, name)] = service;
    }
    return { name: `${this.project}-${slot}`, services, networks: { deployment: { external: true, name: network } }, volumes,
      ...(this.config.secrets ? { secrets: this.config.secrets } : {}), ...(this.config.configs ? { configs: this.config.configs } : {}) };
  }
  private async gatewayPlan(): Promise<void> {
    const ports = this.config.services.app.ports;
    if (!Array.isArray(ports) || ports.length !== 1 || Number(ports[0].target) !== 3000) throw new Error('Blue/green gateway requires exactly one configured app HTTP port targeting 3000.');
    await this.write(join(this.directory, 'route.json'), this.route());
    await this.write(join(this.directory, 'gateway.compose.json'), { name: `${this.project}-gateway`, services: { gateway: {
      image: this.settings.gatewayImage, restart: 'unless-stopped', ports,
      command: ['caddy', 'run', '--config', '/etc/svelar/route.json'],
      networks: { deployment: { aliases: [`${this.project}-gateway`] } },
      volumes: [{ type: 'bind', source: this.directory, target: '/etc/svelar', read_only: true }],
      stop_grace_period: `${this.settings.drainTimeout}s`,
    } }, networks: { deployment: { external: true, name: this.config.networks[this.settings.network].name } } });
  }
  async deploy(options: BlueGreenOptions): Promise<State> {
    if (!options.rollback) releaseReference(options.image);
    if (options.migrate !== false && !options.rollback && !options.compatibleMigrations) throw new Error('Confirm expand/contract compatibility with --compatible-migrations, or explicitly use --no-migrate.');
    await this.prepare();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await mkdir(join(this.directory, 'traffic'), { recursive: true, mode: 0o755 });
    const mutex = await open(join(this.directory, 'deployment.lock'), 'wx', 0o600).catch(() => { throw new Error('A deployment is already locked. Verify the previous process has stopped before recovering its lock file.'); });
    let state: State;
    const statePath = join(this.directory, 'state.json'); const journal = join(this.directory, 'pending.json');
    try {
      await mutex.writeFile(JSON.stringify({ owner: crypto.randomUUID(), pid: process.pid, host: hostname(), project: this.project, startedAt: Date.now() }));
      try { await readFile(journal); throw new Error('An unfinished deployment journal requires operator reconciliation before another deployment.'); }
      catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
      try { state = await this.json(statePath); }
      catch (error: any) { if (error?.code !== 'ENOENT') throw error; state = { version: 1, active: null, releases: {} }; }
      if (state.version !== 1 || ![null, 'blue', 'green'].includes(state.active)) throw new Error('Invalid deployment state.');
      const previous = state.active; const slot: Slot = previous === 'blue' ? 'green' : 'blue';
      if (previous) {
        const upstreams = JSON.parse(await this.gateway(['exec', '-T', 'gateway', 'wget', '-qO-', 'http://127.0.0.1:2019/id/svelar_proxy/upstreams']));
        const traffic = await this.json(join(this.directory, 'traffic', 'traffic.json'));
        if (upstreams.length !== 2 || !upstreams.some((upstream: any) => upstream.dial === `${this.alias(previous)}:3000`) ||
          traffic.slots?.length !== 1 || traffic.slots[0] !== previous) throw new Error('Gateway eligibility and the saved release disagree; operator reconciliation is required.');
      }
      let release = state.releases[slot];
      if (options.rollback) { if (!previous || !release) throw new Error('No previous retained release is available for rollback.'); }
      else {
        if (options.pull !== false) await this.executor.run(['pull', options.image!], 300000);
        const [inspected] = JSON.parse(await this.executor.run(['image', 'inspect', options.image!]));
        if (!/^sha256:[0-9a-f]{64}$/.test(inspected?.Id)) throw new Error('The release image did not resolve to an immutable local image ID.');
        release = { image: options.image!, imageId: inspected.Id };
        await this.write(this.file(slot), this.runtime(slot, release));
        if (options.migrate !== false) {
          await this.compose(this.file(slot), ['run', '--rm', '--no-deps', this.service(slot), 'npx', 'svelar', 'deploy:migrate', '--check']);
          await this.compose(this.file(slot), ['run', '--rm', '--no-deps', this.service(slot), 'npx', 'svelar', 'deploy:migrate']);
        }
      }
      await this.write(journal, { previous, candidate: slot, release });
      let switched = false; let committed = false;
      try {
        await this.compose(this.file(slot), ['up', '-d', '--no-build', '--wait', '--wait-timeout', String(this.settings.readinessTimeout)], (this.settings.readinessTimeout + 15) * 1000);
        await this.ready(slot); await this.probe(slot, this.settings.smokePath); await this.trafficIdentity(slot);
        if (!previous) {
          await this.eligible([slot]); await this.gatewayPlan(); await this.gateway(['up', '-d', '--no-build']);
        }
        switched = true; await this.switch(slot, previous);
        await this.gatewaySmoke(slot, !previous);
        const next: State = { version: 1, active: slot, releases: { ...state.releases, [slot]: release! } };
        await this.write(statePath, next);
        committed = true;
        if (previous) await this.stop(previous);
        await unlink(journal); this.log(`Release ${release!.image} is active in ${slot}.`); return next;
      } catch (error) {
        if (committed) throw new DeploymentDrainError(slot, error);
        if (switched && previous) {
          try { await this.switch(previous, slot); await this.gatewaySmoke(previous); await this.write(statePath, state); }
          catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Deployment failed and automatic route restoration failed; both runtimes are retained for operator recovery.'); }
        }
        try { await this.stop(slot); if (!previous && switched) await this.gateway(['stop']); await unlink(journal); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Deployment failed and cleanup requires operator reconciliation.'); }
        throw error;
      }
    } finally { await mutex.close(); await unlink(join(this.directory, 'deployment.lock')); }
  }
}
