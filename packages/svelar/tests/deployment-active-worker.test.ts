import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlueGreenDeployment, defaultDeploymentManifest } from '../src/deployment/BlueGreen.js';
import type { QueueMonitoringAdapter } from '../src/queue/Monitoring.js';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const label = 'io.svelar.deployment-active-worker';
async function docker(args: string[], timeout = 60000) {
  return (await run('docker', args, { timeout, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
}
async function until<T>(callback: () => Promise<T>, timeout = 20000): Promise<T> {
  const deadline = Date.now() + timeout;
  do { const value = await callback(); if (value) return value; await sleep(50); } while (Date.now() < deadline);
  throw new Error('Active-worker deployment condition timed out.');
}

// Copy only installed, pure-JS peers and their exact dependency trees. No install,
// platform-native binaries, or substitute broker implementations enter the image.
async function copyPeer(name: string, origin: string, destination: string, ancestors: string[] = []): Promise<void> {
  const require = createRequire(origin);
  let manifest: string;
  try { manifest = require.resolve(`${name}/package.json`); }
  catch {
    let directory = dirname(require.resolve(name));
    for (;;) {
      const candidate = join(directory, 'package.json');
      try { if (JSON.parse(await readFile(candidate, 'utf8')).name === name) { manifest = candidate; break; } } catch {}
      const parent = dirname(directory); if (parent === directory) throw new Error(`Cannot locate installed peer ${name}.`);
      directory = parent;
    }
  }
  if (ancestors.includes(manifest!)) return;
  if (ancestors.length > 20) throw new Error('Installed peer dependency tree exceeded the fixture bound.');
  const info = JSON.parse(await readFile(manifest!, 'utf8'));
  await cp(dirname(manifest!), destination, { recursive: true,
    filter: path => basename(path) !== 'node_modules' && !path.endsWith('.node') });
  for (const dependency of Object.keys(info.dependencies ?? {})) {
    if (dependency in (info.optionalDependencies ?? {})) continue;
    await copyPeer(dependency, manifest!, join(destination, 'node_modules', dependency), [...ancestors, manifest!]);
  }
}

function fixture(): string {
  const source = resolve('src');
  return `
import { createServer } from 'node:http';
import { appendFile, readFile, writeFile, access } from 'node:fs/promises';
import { Queue, Job } from ${JSON.stringify(join(source, 'queue/index.ts'))};
import { QueueWorkCommand } from ${JSON.stringify(join(source, 'cli/commands/QueueWorkCommand.ts'))};
import { Connection } from ${JSON.stringify(join(source, 'database/Connection.ts'))};
import { ApplicationContext } from ${JSON.stringify(join(source, 'support/Context.ts'))};
import { DeploymentRuntime } from ${JSON.stringify(join(source, 'deployment/Runtime.ts'))};
export { Queue };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const storage = '/app/storage';
const events = storage + '/jobs.jsonl';
async function record(event) { await appendFile(events, JSON.stringify({ ...event, at: Date.now(), version: process.env.RELEASE_VERSION }) + '\\n'); }
export class ActiveDeploymentJob extends Job {
  retryDelay = 0;
  constructor(public label = '', public hold = false) { super(); }
  async handle() {
    const context = ApplicationContext.snapshot();
    const identity = { teamId: context.teamId, userId: context.userId, correlationId: context.correlationId, ambient: context.ambient };
    await record({ event: 'started', id: this.id, label: this.label, context: identity });
    if (this.hold) {
      const deadline = Date.now() + 90000;
      for (;;) {
        if (await access(storage + '/' + this.label + '.released').then(() => true, () => false)) break;
        if (Date.now() > deadline) throw new Error('Active-job deployment barrier timed out');
        await sleep(25);
      }
    }
    await this.progress(100, 'Deployment proof completed');
    await record({ event: 'completed', id: this.id, label: this.label, context: identity });
  }
  failed(error) { void record({ event: 'failed', id: this.id, label: this.label, error: error.message }); }
}
export function configure(url = process.env.REDIS_URL, prefix = process.env.QUEUE_PREFIX) {
  Queue.configure({ default: 'proof', connections: { proof: { driver: 'redis', url, prefix,
    producerTimeoutMs: 1000, monitoringCoverage: 'exclusive',
    workerHeartbeat: { intervalMs: 1000, staleAfterMs: 3000, retentionMs: 5000 } } },
    queues: [{ name: 'operations', connection: 'proof' }] });
  Queue.register(ActiveDeploymentJob);
}
if (process.env.DEPLOY_ROLE) {
  configure();
  if (process.env.DEPLOY_ROLE === 'worker') {
    // Configuration only: the public CLI bootstrap sees an already configured
    // application. Successful Redis execution does not acquire a database client.
    Connection.configure({ default: 'fixture', connections: { fixture: { driver: 'sqlite', filename: ':memory:' } } });
    const command = new QueueWorkCommand();
    try {
      await ApplicationContext.runIsolated({ teamId: 'ambient-tenant', userId: 'ambient-actor', ambient: 'must-not-leak' },
        () => command.handle([], { queue: 'operations', connection: 'proof', concurrency: '1',
          'lock-duration': '800', 'stalled-interval': '500', 'grace-period': '20' }));
      process.exitCode = command.exitCode;
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { await Queue.stop(); }
  } else {
    DeploymentRuntime.configure({ checks: { redis: async () => { await Queue.size('operations', 'proof'); return true; } } });
    const server = createServer(async (request, response) => {
      try {
        let data;
        if (request.url === '/api/ready') data = await DeploymentRuntime.readiness();
        else if (request.url === '/api/traffic') data = await DeploymentRuntime.traffic();
        else if (request.url === '/events') data = (await readFile(events, 'utf8').catch(() => '')).trim().split('\\n').filter(Boolean).map(line => JSON.parse(line));
        else if (/^\\/release\\/[a-z-]+$/.test(request.url ?? '')) {
          await writeFile(storage + '/' + request.url.split('/').at(-1) + '.released', 'released'); data = { released: true };
        } else data = { version: process.env.RELEASE_VERSION };
        response.writeHead(data?.ready === false ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ data }));
      } catch (error) { console.error(error); response.writeHead(500); response.end(); }
    });
    server.listen(3000, '0.0.0.0', () => DeploymentRuntime.ready());
    process.once('SIGTERM', () => {
      DeploymentRuntime.beginDrain();
      const timer = setTimeout(() => process.exit(1), 20000); timer.unref();
      server.close(async () => { clearTimeout(timer); await Queue.stop(); }); server.closeIdleConnections();
    });
  }
}
`;
}

describe.skipIf(process.env.SVELAR_TEST_DEPLOY_DOCKER !== '1')('Native start-first deployment with active BullMQ workers', () => {
  const owner = randomUUID();
  const project = `svelar-active-${owner.slice(0, 8)}`;
  const ownLabel = `${label}=${owner}`;
  let directory: string;
  let evidence: string;
  let source: any;
  let adapter: QueueMonitoringAdapter;
  let engine: BlueGreenDeployment;
  let base: string;
  let images: Record<string, string>;
  let load: ReturnType<typeof traffic> | undefined;
  const report: Record<string, any> = { proof: 'source-native, not installed-tarball certification', owner, jobs: [], deployments: [] };

  // Label the generated gateway too, using the public executor with real Docker
  // commands. This overlay changes ownership labels only, never runtime topology.
  async function execute(args: string[], timeout?: number) {
    const action = args.findIndex(value => ['up', 'run', 'create'].includes(value));
    if (args[0] === 'compose' && action !== -1) {
      const prefix = args.slice(0, action);
      const config = JSON.parse(await docker([...prefix, 'config', '--format', 'json']));
      const overlay = join(directory, `labels-${randomUUID()}.json`);
      await writeFile(overlay, JSON.stringify({ services: Object.fromEntries(Object.keys(config.services ?? {}).map(name => [name, { labels: { [label]: owner } }])) }));
      return docker([...prefix, '-f', overlay, ...args.slice(action)], timeout);
    }
    return docker(args, timeout);
  }
  async function address() {
    return `http://${await docker(['compose', '-f', join(directory, '.svelar/deployment/gateway.compose.json'), 'port', 'gateway', '3000'])}`;
  }
  async function body(path: string) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(3000) });
    expect(response.status).toBe(200); return (await response.json()).data;
  }
  async function worker(slot: string) {
    const id = await docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}-${slot}`,
      '--filter', `label=com.docker.compose.service=worker_${slot}`]);
    expect(id).toMatch(/^[a-f0-9]+$/); return id;
  }
  function traffic() {
    let stopping = false;
    const statuses: number[] = []; const errors: string[] = []; const versions = new Set<string>();
    const pending = (async () => { while (!stopping) {
      try {
        const response = await fetch(base, { signal: AbortSignal.timeout(2500) }); statuses.push(response.status);
        versions.add((await response.json()).data.version);
      } catch (error) { errors.push(String(error)); }
      await sleep(20);
    } })();
    return { statuses, errors, versions, async stop() { stopping = true; await pending; } };
  }
  async function dispatch(id: string, hold = false, system = false) {
    const metadata = { accountId: 'proof-account', resourceId: id, correlationId: `trace-${id}` };
    const context = system ? {} : { teamId: 'proof-tenant', userId: 'proof-actor', correlationId: `trace-${id}` };
    await source.Queue.dispatch(new source.ActiveDeploymentJob(id, hold), {
      queue: 'operations', connection: 'proof', jobId: id, maxAttempts: 1, metadata, context });
    return { id, context, metadata };
  }
  async function completed(id: string, version: string) {
    const snapshot = await until(async () => { const job = await adapter.get(id); return job?.status === 'completed' && job; });
    expect(snapshot).toMatchObject({ status: 'completed', attempts: 1, attemptsStarted: 1, stalledCount: 0,
      lock: { state: 'none' }, progress: { value: 100 } });
    const events = (await body('/events')).filter((event: any) => event.id === id);
    expect(events.map((event: any) => event.event)).toEqual(['started', 'completed']);
    expect(events.every((event: any) => event.version === version)).toBe(true);
    const timeline = await adapter.timeline({ source: 'live', id });
    expect(timeline.filter(event => event.event === 'active')).toHaveLength(1);
    expect(timeline.filter(event => event.event === 'completed')).toHaveLength(1);
    report.jobs.push({ snapshot, events, timeline });
  }
  async function promoteHeld(id: string, from: string, version: string, rollback = false) {
    const oldWorker = await worker(from);
    await dispatch(id, true);
    await until(async () => (await adapter.get(id))?.status === 'active');
    const started = await until(async () => (await body('/events')).find((event: any) => event.id === id && event.event === 'started'));
    expect(started.version).toBe(from === 'blue' ? 'one' : 'two');
    const promotion = engine.deploy(rollback ? { rollback: true } : { image: images[version], pull: false, migrate: false });
    // Observe the real CLI's SIGTERM handling, while the old job is still active.
    const observed = promotion.then(value => ({ value }), error => ({ error }));
    let drainError: unknown;
    try {
      await until(async () => (await docker(['logs', oldWorker])).includes('Stopping worker gracefully...'), 45000);
      await sleep(1600); // Two complete native lock durations during graceful drain.
      expect(await adapter.get(id)).toMatchObject({ status: 'active', attemptsStarted: 1, stalledCount: 0, lock: { state: 'observed' } });
      expect((await body('/')).version).toBe(rollback ? 'one' : 'two');
      expect((await adapter.runtime()).workers?.observed?.draining).toBe(1);
    } catch (error) { drainError = error; }
    finally { await body(`/release/${id}`); }
    const result = await observed;
    if ('error' in result) throw result.error;
    if (drainError) throw drainError;
    report.deployments.push(result.value);
    const [old] = JSON.parse(await docker(['inspect', oldWorker]));
    expect(old.State).toMatchObject({ Status: 'exited', ExitCode: 0, OOMKilled: false });
    report[`${from}Drain`] = { state: old.State, logs: await docker(['logs', oldWorker]) };
    await completed(id, from === 'blue' ? 'one' : 'two');
  }

  beforeAll(async () => {
    const manifest = process.env.SVELAR_TEST_QUEUE_CLIENT;
    if (!manifest) throw new Error('Native active-worker proof requires SVELAR_TEST_QUEUE_CLIENT pointing to an installed isolated app package.json.');
    directory = await mkdtemp(join(tmpdir(), 'svelar-active-worker-'));
    evidence = resolve('../..', '../svelar-testing-area/artifacts/deployment-active-worker', `${Date.now()}-${owner}`);
    await mkdir(evidence, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, 'runtime.ts'), fixture());
    const require = createRequire(resolve('package.json'));
    await build({ entryPoints: [join(directory, 'runtime.ts')], outfile: join(directory, 'runtime.mjs'), bundle: true,
      platform: 'node', format: 'esm', packages: 'external', keepNames: true, target: 'node22', logLevel: 'silent',
      banner: { js: "import { createRequire as fixtureRequire } from 'node:module'; const require = fixtureRequire(import.meta.url);" },
      plugins: [{ name: 'private-calendar-engine', setup(builder) {
        builder.onResolve({ filter: /^(cron-parser|luxon)$/ }, args => ({ path: require.resolve(args.path) }));
      } }] });
    for (const peer of ['bullmq', 'ioredis']) await copyPeer(peer, resolve(manifest), join(directory, 'node_modules', peer));
    source = await import(pathToFileURL(join(directory, 'runtime.mjs')).href);
    await writeFile(join(directory, 'Dockerfile'), 'FROM node:24-alpine\nWORKDIR /app\nCOPY runtime.mjs ./\nCOPY node_modules ./node_modules\nARG VERSION\nENV RELEASE_VERSION=$VERSION\nCMD ["node","runtime.mjs"]\n');
    images = {};
    for (const version of ['one', 'two']) {
      images[version] = `${project}:${version}`;
      await docker(['build', '--quiet', '--label', ownLabel, '--tag', images[version], '--build-arg', `VERSION=${version}`, directory], 120000);
    }
    await docker(['image', 'inspect', 'caddy:2.11.7-alpine']).catch(() => docker(['pull', 'caddy:2.11.7-alpine']));
    const network = `${project}_default`; const volume = `${project}_storage`;
    await docker(['network', 'create', '--label', ownLabel, network]);
    await docker(['volume', 'create', '--label', ownLabel, volume]);
    const redis = `${project}-redis`;
    await docker(['run', '-d', '--label', ownLabel, '--name', redis, '--network', network, '--network-alias', 'proof-redis',
      '-p', '127.0.0.1::6379', 'redis:7-alpine']);
    await until(async () => (await docker(['exec', redis, 'redis-cli', 'ping']).catch(() => '')) === 'PONG');
    const mapping = await docker(['port', redis, '6379/tcp']);
    source.configure(`redis://${mapping}/0`, project);
    adapter = source.Queue.adapter('operations', 'proof');
    const service = { image: images.one, labels: { [label]: owner },
      environment: { REDIS_URL: 'redis://proof-redis:6379/0', QUEUE_PREFIX: project },
      volumes: [{ type: 'volume', source: 'app_storage', target: '/app/storage' }] };
    await writeFile(join(directory, 'docker-compose.yml'), JSON.stringify({ name: project, services: {
      app: { ...service, environment: { ...service.environment, DEPLOY_ROLE: 'app' }, ports: [{ target: 3000, published: '0', host_ip: '127.0.0.1' }] },
      worker: { ...service, environment: { ...service.environment, DEPLOY_ROLE: 'worker' } },
    }, networks: { default: { name: network, external: true } }, volumes: { app_storage: { name: volume, external: true } } }));
    await writeFile(join(directory, 'docker-compose.prod.yml'), JSON.stringify({ services: { app: { image: images.one }, worker: { image: images.one } } }));
    await writeFile(join(directory, 'svelar.deploy.json'), JSON.stringify({ ...defaultDeploymentManifest, runtimeServices: ['app', 'worker'], readinessTimeout: 20, drainTimeout: 25 }));
    engine = new BlueGreenDeployment(directory, { run: execute }, message => console.log(`[active-worker] ${message}`));
    console.log(`[active-worker] Persistent evidence: ${evidence}`);
  }, 180000);

  afterAll(async () => {
    await load?.stop();
    const errors: unknown[] = [];
    try {
      const ids = (await docker(['ps', '-aq', '--filter', `label=${ownLabel}`])).split('\n').filter(Boolean);
      for (const id of ids) {
        const [container] = JSON.parse(await docker(['inspect', id]));
        await writeFile(join(evidence, `${container.Name.slice(1)}.log`), await docker(['logs', id]).catch(String), { mode: 0o600 });
      }
      if (adapter) { report.finalRuntime = await adapter.runtime(); report.metrics = await adapter.metrics(); }
      if (base) report.events = await body('/events');
      await writeFile(join(evidence, 'proof.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    } catch (error) { errors.push(error); }
    try { await source?.Queue.stop(); } catch (error) { errors.push(error); }
    for (const [list, remove] of [
      [['ps', '-aq'], ['rm', '-f']], [['network', 'ls', '-q'], ['network', 'rm']],
      [['volume', 'ls', '-q'], ['volume', 'rm']], [['image', 'ls', '-q'], ['image', 'rm']],
    ] as const) {
      try {
        const ids = [...new Set((await docker([...list, '--filter', `label=${ownLabel}`])).split('\n').filter(Boolean))];
        if (ids.length) await docker([...remove, ...ids]);
        expect(await docker([...list, '--filter', `label=${ownLabel}`])).toBe('');
      } catch (error) { errors.push(error); }
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    if (errors.length) throw new AggregateError(errors, 'Active-worker evidence/ownership cleanup failed.');
  }, 90000);

  it('promotes and rolls back under continuous HTTP traffic without duplicating, orphaning or killing active jobs', async () => {
    report.deployments.push(await engine.deploy({ image: images.one, pull: false, migrate: false }));
    base = await address(); load = traffic();
    try {
      await until(async () => (await adapter.runtime()).workers?.observed?.live === 1);
      await promoteHeld('held-promotion', 'blue', 'two');
      await dispatch('next-green'); await completed('next-green', 'two');
      await promoteHeld('held-rollback', 'green', 'one', true);
      await dispatch('next-blue', false, true); await completed('next-blue', 'one');
      expect(await address()).toBe(base);
      const runtime = await adapter.runtime();
      expect(runtime).toMatchObject({ stalled: 0, expiredLocks: 0, lag: 0 });
      expect(runtime.workers?.observed).toMatchObject({ live: 1, draining: 0 });
      expect(await source.Queue.size('operations', 'proof')).toBe(0);
      expect(await adapter.metrics()).toMatchObject({ completed: 4, failed: 0 });
      for (const job of report.jobs) {
        expect(job.snapshot.metadata).toEqual({ accountId: 'proof-account', resourceId: job.snapshot.id, correlationId: `trace-${job.snapshot.id}` });
        for (const event of job.events) expect(event.context).toEqual(job.snapshot.id === 'next-blue' ? {} :
          { teamId: 'proof-tenant', userId: 'proof-actor', correlationId: `trace-${job.snapshot.id}` });
      }
    } finally {
      await load.stop(); report.traffic = { samples: load.statuses.length, statuses: [...new Set(load.statuses)], versions: [...load.versions], errors: load.errors };
    }
    expect(load.statuses.length).toBeGreaterThan(20);
    expect(load.statuses.every(status => status === 200)).toBe(true); expect(load.errors).toEqual([]);
    expect([...load.versions].sort()).toEqual(['one', 'two']);
    report.passed = true;
  }, 180000);
});
