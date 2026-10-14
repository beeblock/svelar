#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSmokeArtifact } from './release-smoke.mjs';
import { bounded, managedProcess, stopManagedProcess, waitUntil } from './operational-browser-fixtures.mjs';
import { cleanupOwned, ownerLabel, runCommand, writeEvidence } from './runtime-certification.mjs';

const script = fileURLToPath(import.meta.url);
const repository = resolve(dirname(script), '..');
const testingRoot = resolve(repository, '../svelar-testing-area');
const appsRoot = join(testingRoot, 'apps');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const scope = Object.freeze({
  installed: 'Official generated adapter-node app, deployment CLI, readiness, HTTP drain, promotion and rollback.',
  workers: 'Generated worker/scheduler process startup only. Long BullMQ job drain remains separate source-native evidence.',
  exclusions: ['TLS', 'multi-host', 'SSE/WebSocket drain', 'different application schema versions', 'generated worker domain-job execution'],
});

export function parseOptions(args) {
  const options = { execute: false, help: false, reportDir: join(testingRoot, 'artifacts/generated-deployment'), timeout: 1500 };
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--execute') options.execute = true;
    else if (arg === '--plan') options.execute = false;
    else if (arg === '--diagnostic-handles') options.diagnosticHandles = true;
    else if (arg.startsWith('--tarball=')) options.tarball = resolve(arg.slice(10));
    else if (arg.startsWith('--sha256=')) options.sha256 = arg.slice(9);
    else if (arg.startsWith('--report-dir=')) options.reportDir = resolve(arg.slice(13));
    else if (arg.startsWith('--timeout=')) options.timeout = Number(arg.slice(10));
    else throw new Error(`Unknown generated deployment option: ${arg}`);
  }
  if (!options.help && (!options.tarball?.endsWith('.tgz') || !/^[a-f0-9]{64}$/.test(options.sha256 ?? ''))) {
    throw new Error('Provide --tarball=<immutable.tgz> and --sha256=<exact archive SHA256>. No core build/pack fallback exists.');
  }
  if (!Number.isSafeInteger(options.timeout) || options.timeout < 60 || options.timeout > 3600) throw new Error('--timeout must be integer seconds in 60..3600.');
  return options;
}

export function acceptancePlan(options) {
  return { mode: options.execute ? 'execute' : 'plan-only', artifact: { path: options.tarball, sha256: options.sha256 }, scope,
    instrumentation: options.diagnosticHandles ? 'Logging-only main-process preload via owned read-only Compose mount; not pristine-app acceptance.' : null,
    app: 'A new uniquely named sibling app; never reuse an active smoke app.',
    generators: ['new --no-install --validation=zod', 'npm run ui:install', 'make:deploy --db=postgres --no-soketi --no-rustfs --no-meilisearch --no-gotenberg'],
    checks: ['archive/installed-lock/image provenance', 'generated production Dockerfile and unmodified application source',
      'ready=200; held database probe ready=503 while health=200', 'locked compatible forward migration execution',
      'start-first blue-to-green promotion with stable gateway port', 'old slot traffic=503 before SIGTERM',
      'real ORM request survives old adapter-node SIGTERM and finishes before exit=0',
      'explicit rollback to retained immutable image', 'positive continuous HTTP sample; zero retries/dropped/non-200 ordinary requests',
      'all owned processes/containers/networks/volumes/images cleaned; evidence retained'],
    prerequisites: ['explicit parent CPU/Docker GO before --execute', 'local Docker daemon', 'Node/npm and registry/image access', 'space for one isolated app and Docker image build'],
  };
}

export function deploymentCliArguments(cliPath, args) {
  return [cliPath, 'prod:deploy', '--no-pull', ...args];
}

export async function archiveIdentity(path, expectedSha256) {
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedSha256) throw new Error('Selected archive SHA256 mismatch.');
  return { path: await realpath(path), sha256, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
}

export async function installedIdentity(app, artifact) {
  const require = createRequire(join(app, 'package.json'));
  const packagePath = await realpath(require.resolve('@beeblock/svelar/package.json'));
  if (dirname(packagePath) !== join(await realpath(app), 'node_modules/@beeblock/svelar')) throw new Error('Refusing linked/source-aliased installed core.');
  const lock = JSON.parse(await readFile(join(app, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.['node_modules/@beeblock/svelar'];
  if (entry?.link || entry?.integrity !== artifact.integrity || !entry?.resolved?.startsWith('file:')) throw new Error('Installed core lock does not pin the selected archive integrity.');
  await archiveIdentity(resolve(app, entry.resolved.slice(5)), artifact.sha256);
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.svelar;
  if (typeof bin !== 'string' || !bin.startsWith('dist/') && !bin.startsWith('./dist/')) throw new Error('Installed core CLI is not a packaged dist entry.');
  const cliPath = resolve(dirname(packagePath), bin);
  await access(cliPath, constants.R_OK);
  return { version: manifest.version, packagePath, cliPath, integrity: entry.integrity };
}

export function assertProbe(probe, { status, ready, slot } = {}) {
  if (probe.status !== status || ready !== undefined && probe.body?.data?.ready !== ready
    || slot !== undefined && probe.body?.data?.slot !== slot) throw new Error(`Unexpected deployment probe: ${JSON.stringify(probe)}`);
}

export function assertAvailability(samples, windows) {
  for (const phase of ['promotion', 'rollback']) {
    const window = windows?.find((value) => value.phase === phase);
    if (windows && (!window || !Number.isFinite(window.startedAt) || !Number.isFinite(window.finishedAt) || window.finishedAt <= window.startedAt)) {
      throw new Error(`Missing actual ${phase} command window.`);
    }
    const observed = samples.filter((sample) => sample.phase === phase && (!window || sample.startedAt >= window.startedAt && sample.finishedAt <= window.finishedAt));
    if (observed.length < 2 || observed.some((sample) => sample.status !== 200 || sample.error)) throw new Error(`Missing or failed ordinary HTTP samples during ${phase}.`);
  }
  if (samples.some((sample) => sample.status !== 200 || sample.error)) throw new Error('An ordinary gateway request failed; no retry can erase it.');
  return { requests: samples.length, non200: 0, dropped: 0, retried: 0, intervalMs: 3000 };
}

export function assertDrain(drain) {
  const { signal, runningBeforeRelease, status, exitCode, oomKilled, elapsedMs } = drain;
  if (!['15', 'SIGTERM'].includes(String(signal)) || runningBeforeRelease !== true || status !== 200 || exitCode !== 0 || oomKilled
    || !Number.isFinite(elapsedMs) || elapsedMs < 1000) {
    throw new Error(`Adapter-node must receive real SIGTERM, retain the held request, complete it, then exit zero without OOM. Received drain: ${JSON.stringify(drain)}`);
  }
}

export function assertOwned(inspect, runId) {
  if (!runId || inspect?.Config?.Labels?.[ownerLabel] !== runId) throw new Error('Resource is not owned by this exact generated deployment run.');
}

export async function generatedRoleObservation(role, id, imageId, value, captureFailure) {
  const state = value.State ?? {};
  const health = state.Health?.Status ?? null;
  const observation = { role, id, imageId: value.Image, command: value.Config?.Cmd,
    running: state.Running, status: state.Status, restarting: state.Restarting, restartCount: value.RestartCount,
    health, pid: state.Pid, exitCode: state.ExitCode, oomKilled: state.OOMKilled };
  if (value.Image === imageId && state.Running === true && state.Status === 'running' && state.Restarting === false
    && value.RestartCount === 0 && state.Pid > 0 && state.OOMKilled === false && state.Dead === false
    && (role === 'app' ? health === 'healthy' : health === null || health === 'healthy')) return observation;
  const receipt = await captureFailure?.(observation);
  throw new Error(`Generated ${role} process is unhealthy: ${JSON.stringify(observation)}${receipt ? `; logs: ${receipt}` : ''}`);
}

async function executable(name) {
  for (const part of (process.env.PATH ?? '').split(delimiter)) {
    const path = resolve(part, name);
    try { await access(path, constants.X_OK); return path; } catch {}
  }
  throw new Error(`Required executable is unavailable: ${name}`);
}

async function port() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const value = server.address().port;
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  if ([5330, 5798, 3000, 5432, 6379].includes(value)) throw new Error('OS selected a reserved/default port; refusing fixture startup.');
  return value;
}

async function fingerprints(app) {
  const files = {};
  async function walk(directory) {
    for (const entry of await readdir(join(app, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files[path] = createHash('sha256').update(await readFile(join(app, path))).digest('hex');
      else throw new Error(`Unexpected generated source symlink: ${path}`);
    }
  }
  await walk('src');
  for (const path of ['Dockerfile', 'docker-compose.yml', 'docker-compose.prod.yml', 'svelte.config.js', 'package.json', 'package-lock.json']) {
    files[path] = createHash('sha256').update(await readFile(join(app, path))).digest('hex');
  }
  return files;
}

export function generatedDockerProxySource(config) {
  // Compose stdout is machine input to the installed deployer; redact only persisted evidence.
  return `#!/usr/bin/env node
(async () => {
  const { labelledDockerArgs, runCommand } = await import(${JSON.stringify(new URL('./runtime-certification.mjs', import.meta.url).href)});
  const config = ${JSON.stringify(config)};
  let args = await labelledDockerArgs(process.argv.slice(2), config);
  const action = args.findIndex(value => ['up', 'run', 'create'].includes(value));
  if (config.diagnosticPath && args[0] === 'compose' && action > 0) {
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const normalized = JSON.parse((await runCommand(config.binary, [...args.slice(0, action), 'config', '--format', 'json'], { cwd: process.cwd(), timeoutMs: 30000, detached: false })).stdout);
    const services = Object.fromEntries(Object.keys(normalized.services).filter(name => /^app(?:_(?:blue|green))?$/.test(name)).map(name => [name, {
      environment: { NODE_OPTIONS: '--import=file:///svelar-probe/shutdown.mjs' },
      volumes: [{ type: 'bind', source: config.diagnosticPath, target: '/svelar-probe/shutdown.mjs', read_only: true }],
    }]));
    const overlay = join(config.directory, crypto.randomUUID() + '.diagnostic.compose.json');
    await writeFile(overlay, JSON.stringify({ services }), { mode: 0o600 });
    args = [...args.slice(0, action), '-f', overlay, ...args.slice(action)];
  }
  const result = await runCommand(config.binary, args, { cwd: process.cwd(), timeoutMs: 180000, detached: false });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
})().catch(error => { process.stdout.write(error.stdout ?? ''); process.stderr.write(error.stderr ?? ''); console.error(error.message); process.exitCode = 1; });
`;
}

export const shutdownProbeSource = `
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const prefix = '[SvelarShutdownProbe] ';
const socket = value => ({ type: value?.constructor?.name, destroyed: value?.destroyed,
  refed: value?._handle?.hasRef?.(), localAddress: value?.localAddress, localPort: value?.localPort,
  remoteAddress: value?.remoteAddress, remotePort: value?.remotePort });
async function observe(stage) {
  try {
    const handles = process._getActiveHandles();
    const path = createRequire('/app/package.json').resolve('@beeblock/svelar/package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    const entry = manifest.exports['./cache'];
    const { Cache } = await import(pathToFileURL(resolve(dirname(path), typeof entry === 'string' ? entry : entry.import)).href);
    const store = Cache.store();
    const client = store.redis;
    process.stdout.write(prefix + JSON.stringify({ stage, pid: process.pid, at: new Date().toISOString(),
      resources: process.getActiveResourcesInfo(), handles: handles.map(socket),
      cache: { type: store.constructor.name, owned: store.owned, status: client?.status,
        streamMatchesActiveHandle: !!client?.stream && handles.includes(client.stream), stream: client?.stream ? socket(client.stream) : null } }) + '\\n');
  } catch (error) { process.stdout.write(prefix + JSON.stringify({ stage, error: error.message }) + '\\n'); }
}
function snapshots(stage) {
  void observe(stage);
  for (const delay of [1000, 5000, 10000, 20000]) setTimeout(() => { void observe(stage + '+' + delay + 'ms'); }, delay).unref();
}
process.once('SIGTERM', () => snapshots('SIGTERM'));
process.once('sveltekit:shutdown', () => snapshots('sveltekit:shutdown'));
`;

export const imageProofSource = `
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const require = createRequire('/app/package.json');
const path = realpathSync(require.resolve('@beeblock/svelar/package.json'));
if (path !== '/app/node_modules/@beeblock/svelar/package.json') throw new Error('Image core is linked or source-aliased');
const lock = JSON.parse(readFileSync('/app/node_modules/.package-lock.json', 'utf8'));
const manifest = JSON.parse(readFileSync(path, 'utf8'));
const entry = lock.packages?.['node_modules/@beeblock/svelar'];
if (entry?.link || entry?.integrity !== process.env.EXPECTED_INTEGRITY) throw new Error('Image core integrity mismatch');
for (const name of ['deployment', 'hooks', 'cli']) {
  const exported = manifest.exports['./' + name];
  const target = typeof exported === 'string' ? exported : exported.import;
  const physical = realpathSync(resolve(dirname(path), target));
  if (!physical.startsWith('/app/node_modules/@beeblock/svelar/dist/')) throw new Error('Image public entry escaped packed dist');
}
console.log(JSON.stringify({ node: process.version, version: manifest.version, packagePath: path, integrity: entry.integrity }));
`;

export async function certifyGeneratedDeployment(options) {
  if (!options.execute) throw new Error('Native deployment setup requires explicit --execute after parent GO.');
  const artifact = await archiveIdentity(options.tarball, options.sha256);
  const runId = randomUUID();
  const project = `sv-deploy-${runId.replaceAll('-', '').slice(0, 12)}`;
  let app;
  const evidenceDir = join(options.reportDir, runId);
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  const evidence = { runId, project, app: null, artifact, scope, node: process.version, status: 'running', checks: [], timeline: [], commands: [], samples: [], transitions: [], cleanup: [] };
  if (options.diagnosticHandles) evidence.instrumentation = { loggingOnly: true, pristineAppAcceptance: false,
    method: 'Owned read-only Compose mount + NODE_OPTIONS ESM preload; observes private Cache ownership/socket identity without mutation.' };
  evidence.runner = { path: script, sha256: createHash('sha256').update(await readFile(script)).digest('hex') };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Generated deployment overall deadline exceeded.')), options.timeout * 1000);
  const interrupt = () => controller.abort(new Error('Generated deployment interrupted.'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let extraction; let fixtureRoot; let proxyDirectory; let dockerBinary; let sourceHashes; let failure; let loading; let loadStopped = false; let phase = 'initial';
  const peers = [];
  const locks = new Set();
  const pending = new Set();
  const secrets = [];
  let saving = Promise.resolve();
  const safe = (value) => typeof value === 'string'
    ? secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value)
    : JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string' ? safe(item) : item));
  const track = (work) => { pending.add(work); work.finally(() => pending.delete(work)).catch(() => {}); return work; };
  const record = (stage, details = {}) => evidence.timeline.push({ at: new Date().toISOString(), stage, ...details });
  const check = (name, details = {}) => { evidence.checks.push({ name, ...details }); record(name, details); };
  function persist() { const snapshot = safe(evidence); saving = saving.then(() => writeEvidence(evidenceDir, 'report.json', snapshot)); return saving; }
  let env;
  function command(binary, args, settings = {}) { return track((async () => {
    const item = { at: new Date().toISOString(), binary, args, status: 'running' };
    evidence.commands.push(item);
    const name = `command-${String(evidence.commands.length).padStart(3, '0')}.log`;
    try {
      const output = await runCommand(binary, args, { cwd: app, env, signal: controller.signal, ...settings });
      item.status = 'passed'; await writeEvidence(evidenceDir, name, safe(output.stdout + '\n' + output.stderr)); return output.stdout.trim();
    } catch (error) {
      item.status = 'failed'; item.error = error.message;
      await writeEvidence(evidenceDir, name, safe(`${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.stack ?? error.message}`));
      throw error;
    } finally { item.finishedAt = new Date().toISOString(); await persist(); }
  })()); }
  async function docker(args, settings) { return command('docker', args, settings); }
  async function inspect(id) {
    const value = JSON.parse(await docker(['inspect', id]))[0]; assertOwned(value, runId); return value;
  }
  async function container(compose, service) {
    const id = await docker(['compose', '--project-directory', app, '-f', compose, 'ps', '--all', '--quiet', service]);
    if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error(`Expected exactly one owned ${service} container.`);
    await inspect(id); return id;
  }
  async function probe(id, path) {
    const source = `try { const r=await fetch(${JSON.stringify(`http://127.0.0.1:3000${path}`)},{redirect:'error',signal:AbortSignal.timeout(5000)}); const text=await r.text(); let body; try{body=JSON.parse(text);}catch{body=null;} console.log(JSON.stringify({status:r.status,body})); } catch(e) { console.log(JSON.stringify({status:null,error:e.cause?.code??e.name})); }`;
    return JSON.parse(await docker(['exec', id, 'node', '--input-type=module', '-e', source]));
  }
  let postgres;
  async function sql(text, signal = controller.signal) {
    return docker(['exec', postgres, 'psql', '-U', 'svelar', '-d', 'svelar', '-At', '-v', 'ON_ERROR_STOP=1', '-c', text], { signal });
  }
  // These are infrastructure-only locks in the disposable database, not app CRUD or runtime DDL.
  async function holdTable(table) {
    if (!['users', 'posts'].includes(table)) throw new Error('Unknown generated fixture table.');
    const name = `${project}-${table}`;
    const peer = managedProcess('docker', ['exec', '-e', `PGAPPNAME=${name}`, postgres, 'psql', '-U', 'svelar', '-d', 'svelar', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
      `BEGIN; LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(120); COMMIT;`], { cwd: app, env });
    peers.push(peer);
    const pid = Number(await waitUntil(async () => {
      if (peer.settled) throw new Error(`Database barrier exited early: ${peer.output}`);
      const result = await sql(`SELECT pid FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='PgSleep'`);
      return result || false;
    }, { timeoutMs: 10000, label: `Owned ${table} barrier` }));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid owned PostgreSQL barrier PID.');
    locks.add(pid); record('database-barrier-held', { table, pid });
    return { pid, async release(signal = controller.signal) {
      await sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=${pid} AND application_name='${name}'`, signal);
      locks.delete(pid);
      const exit = await bounded(() => peer.closed, 5000, 'Database barrier release');
      if (![0, 1, 2].includes(exit.code) || exit.signal) throw new Error('Owned database barrier did not settle after intentional termination.');
      record('database-barrier-released', { table, pid, exitCode: exit.code });
    } };
  }
  const slotFile = (slot) => join(app, `.svelar/deployment/${slot}.compose.json`);
  const deploy = (args) => command(process.execPath, deploymentCliArguments(evidence.installed.cliPath, args), { timeoutMs: 150000 });
  async function state() { return JSON.parse(await readFile(join(app, '.svelar/deployment/state.json'), 'utf8')); }
  async function roles(slot, imageId) {
    const observations = [];
    for (const role of ['app', 'worker', 'scheduler']) {
      const id = await container(slotFile(slot), `${role}_${slot}`);
      const value = await inspect(id);
      observations.push(await generatedRoleObservation(role, id, imageId, value, async (observation) => {
        const logs = await runCommand(dockerBinary, ['logs', '--tail', '200', id], { timeoutMs: 10000 }).catch((error) => error);
        const name = `role-failure-${slot}-${role}-${id}.log`;
        await writeEvidence(evidenceDir, name, safe(`${logs.stdout ?? ''}\n${logs.stderr ?? ''}`));
        record('generated-role-process-failure', { ...observation, log: name });
        return join(evidenceDir, name);
      }));
    }
    check(`${slot}-generated-role-processes`, { observations, domainJobReadinessAsserted: false });
  }
  async function promote(label, args, oldSlot, targetSlot) {
    phase = label;
    const oldId = await container(slotFile(oldSlot), `app_${oldSlot}`);
    const barrier = await holdTable('posts');
    const admittedAt = Date.now();
    const held = track(fetch(`${evidence.baseUrl}/api/posts`, { redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]) })
      .then(async (response) => ({ status: response.status, body: await response.json(), elapsedMs: Date.now() - admittedAt })));
    held.catch(() => {});
    const blockedPid = Number(await waitUntil(async () => {
      const value = await sql(`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${barrier.pid}=ANY(pg_blocking_pids(pid)) AND query ILIKE '%posts%'`);
      return value || false;
    }, { timeoutMs: 10000, label: 'Generated controller ORM request admitted before promotion' }));
    if (!Number.isSafeInteger(blockedPid)) throw new Error('Expected exactly one real blocked Post ORM read.');
    record('generated-http-request-admitted', { slot: oldSlot, oldId, blockedPid });
    const transition = { phase: label, startedAt: Date.now() };
    evidence.transitions.push(transition);
    const started = Math.floor(transition.startedAt / 1000);
    const promotion = deploy(args); promotion.catch(() => {});
    let promotionSettled = false; promotion.finally(() => { promotionSettled = true; }).catch(() => {});
    await waitUntil(async () => {
      if (promotionSettled) throw new Error('Deployment finished before the held request could be observed during drain.');
      let eligible;
      try { eligible = JSON.parse(await readFile(join(app, '.svelar/deployment/traffic/traffic.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      if (JSON.stringify(eligible.slots) !== JSON.stringify([targetSlot])) return false;
      const traffic = await probe(oldId, '/api/traffic');
      if (traffic.status !== 503) return false;
      assertProbe(traffic, { status: 503, ready: false, slot: oldSlot });
      check(`${label}-old-traffic-ineligible`, { slot: oldSlot, status: traffic.status }); return true;
    }, { timeoutMs: 65000, label: 'Old slot excluded before bounded SIGTERM drain' });
    const signal = await waitUntil(async () => {
      const until = (Date.now() / 1000).toFixed(3);
      const raw = await docker(['events', '--since', String(started), '--until', until, '--filter', `container=${oldId}`, '--filter', 'event=kill', '--format', '{{json .}}']);
      const event = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((value) => ['15', 'SIGTERM'].includes(String(value.Actor?.Attributes?.signal)));
      return event || false;
    }, { timeoutMs: 15000, label: 'Actual old adapter-node SIGTERM' });
    const during = await inspect(oldId);
    const readiness = await probe(oldId, '/api/ready');
    if (readiness.status !== 503 && !(readiness.status === null && ['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(readiness.error))) {
      throw new Error(`Old listener still accepted readiness after SIGTERM: ${JSON.stringify(readiness)}`);
    }
    record('old-readiness-after-sigterm', { slot: oldSlot, ...readiness, interpretation: readiness.status === 503 ? 'HTTP not-ready' : 'adapter-node stopped accepting connections; not an HTTP 503 assertion' });
    // A bounded hold after observed SIGTERM proves that cleanup did not close the request's DB prematurely.
    await sleep(1100);
    if (!(await inspect(oldId)).State.Running) throw new Error('Old adapter-node exited before the admitted request was released.');
    await barrier.release();
    const response = await held;
    record('held-http-response', { phase: label, oldId, ...response });
    await persist();
    if (!Array.isArray(response.body?.data)) throw new Error('Held real Post request did not return its resource collection.');
    await promotion;
    transition.finishedAt = Date.now();
    const after = await inspect(oldId);
    const drain = { signal: signal.Actor.Attributes.signal, runningBeforeRelease: during.State.Running,
      status: response.status, exitCode: after.State.ExitCode, oomKilled: after.State.OOMKilled, elapsedMs: response.elapsedMs };
    record('generated-http-drain-observed', { phase: label, oldId, ...drain, finalContainerState: after.State });
    await persist();
    assertDrain(drain);
    const committed = await state();
    if (committed.active !== targetSlot) throw new Error('Committed deployment did not select the target slot.');
    const next = await container(slotFile(targetSlot), `app_${targetSlot}`);
    assertProbe(await probe(next, '/api/ready'), { status: 200, ready: true });
    await roles(targetSlot, committed.releases[targetSlot].imageId);
    check(`${label}-generated-http-drain`, { ...drain, from: oldSlot, to: targetSlot, state: committed });
  }
  try {
    dockerBinary = await executable('docker');
    const endpoint = process.env.DOCKER_HOST || JSON.parse(await command(dockerBinary, ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], { cwd: repository }));
    const url = new URL(endpoint);
    if (url.protocol !== 'unix:' && !(['tcp:', 'http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Generated deployment proof requires a local Docker daemon.');
    await command(dockerBinary, ['info', '--format', '{{.ServerVersion}}'], { cwd: repository });
    await mkdir(appsRoot, { recursive: true });
    fixtureRoot = await mkdtemp(join(appsRoot, '.generated-deploy-'));
    app = join(fixtureRoot, project); evidence.app = app;
    proxyDirectory = join(fixtureRoot, 'tools'); await mkdir(proxyDirectory);
    const proxy = join(proxyDirectory, 'bin'); await mkdir(proxy);
    const diagnosticPath = options.diagnosticHandles ? join(proxyDirectory, 'shutdown-probe.mjs') : undefined;
    if (diagnosticPath) await writeFile(diagnosticPath, shutdownProbeSource, { mode: 0o644 });
    await writeFile(join(proxy, 'docker'), generatedDockerProxySource({ directory: proxyDirectory, binary: dockerBinary, runId, diagnosticPath }), { mode: 0o755 });
    // No shared app/service environment is inherited by this fresh fixture.
    env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DB_|DATABASE_URL$|REDIS_|CACHE_|QUEUE_|AUTH_|APP_|ORIGIN$|INTERNAL_APP_URL$|MEILI|BROADCAST_|PUSHER_|MAIL_|SMTP_|S3_|SVELAR_|COMPOSE_|NODE_PATH$|NODE_OPTIONS$)/.test(key)));
    env = { ...env, PATH: [proxy, dirname(process.execPath), env.PATH ?? ''].join(delimiter), CI: '1', FORCE_COLOR: '0' };
    extraction = extractSmokeArtifact(artifact.path, { temporaryRoot: proxyDirectory });
    await command(process.execPath, [extraction.cliPath, 'new', project, '--no-install', '--validation=zod'], { cwd: fixtureRoot });
    const archiveDir = join(app, '.svelar-local'); await mkdir(archiveDir);
    await copyFile(artifact.path, join(archiveDir, 'core.tgz'));
    await command('npm', ['install', '--save-exact', './.svelar-local/core.tgz', '--no-audit', '--fund=false'], { timeoutMs: 300000 });
    evidence.installed = await installedIdentity(app, artifact);
    await command('npm', ['run', 'ui:install'], { timeoutMs: 180000 });
    await command(process.execPath, [evidence.installed.cliPath, 'make:deploy', '--db=postgres', '--no-soketi', '--no-rustfs', '--no-meilisearch', '--no-gotenberg'], { timeoutMs: 60000 });
    evidence.installed = await installedIdentity(app, artifact);
    sourceHashes = await fingerprints(app); evidence.sourceHashes = sourceHashes;
    const publicPort = await port(); evidence.baseUrl = `http://127.0.0.1:${publicPort}`;
    const password = randomBytes(24).toString('hex');
    const variables = { APP_KEY: randomBytes(32).toString('hex'), APP_NAME: project, APP_URL: evidence.baseUrl,
      APP_PORT: `127.0.0.1:${publicPort}`, DB_DRIVER: 'postgres', DB_HOST: 'pgbouncer', DB_PORT: '6432', DB_NAME: 'svelar', DB_USER: 'svelar', DB_PASSWORD: password,
      DB_PREPARE: 'false', REDIS_HOST: 'redis', REDIS_PORT: '127.0.0.1:0', REDIS_PASSWORD: password,
      CACHE_DRIVER: 'redis', QUEUE_DRIVER: 'redis', MAIL_DRIVER: 'null', AUTH_OTP_ENABLED: 'false', AUTH_EMAIL_VERIFICATION_REQUIRED: 'false' };
    secrets.push(password, variables.APP_KEY);
    await writeFile(join(app, '.env'), Object.entries(variables).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
    const compose = ['compose', '--project-directory', app, '-f', join(app, 'docker-compose.yml'), '-f', join(app, 'docker-compose.prod.yml')];
    const configuration = JSON.parse(await docker([...compose, 'config', '--format', 'json']));
    if (configuration.name !== project) throw new Error('Generated Compose project identity is not the owned sibling app.');
    if (!configuration.services?.postgres || !configuration.services?.redis || !configuration.services?.pgbouncer) throw new Error('Official deployment generator omitted required isolated infrastructure.');
    if (configuration.services.app.ports?.length !== 1 || configuration.services.app.ports[0].host_ip !== '127.0.0.1' || Number(configuration.services.app.ports[0].published) !== publicPort) throw new Error('Generated gateway must bind only its random loopback port.');
    for (const service of ['postgres', 'pgbouncer', 'redis']) {
      if ((configuration.services[service].ports ?? []).some((binding) => binding.host_ip !== '127.0.0.1' || Number(binding.published) !== 0)) throw new Error('Infrastructure may only publish random loopback ports.');
    }
    for (const definition of Object.values(configuration.volumes ?? {})) await docker(['volume', 'create', definition.name]);
    await docker([...compose, 'up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'pgbouncer', 'redis'], { timeoutMs: 150000 });
    postgres = await container(join(app, 'docker-compose.yml'), 'postgres');
    const imageOne = `svelar-generated-deployment-${runId}:one`;
    const imageTwo = `svelar-generated-deployment-${runId}:two`;
    evidence.images = [];
    for (const [image, release] of [[imageOne, 'one'], [imageTwo, 'two']]) {
      await command(dockerBinary, ['build', '--label', `${ownerLabel}=${runId}`, '--label', `io.svelar.generated-release=${release}`, '--target', 'production', '-t', image, '.'], { timeoutMs: 600000 });
      const id = JSON.parse(await docker(['image', 'inspect', image]))[0].Id;
      const proof = JSON.parse(await docker(['run', '--rm', '--entrypoint', 'node', '-e', `EXPECTED_INTEGRITY=${artifact.integrity}`, image, '--input-type=module', '-e', imageProofSource]));
      if (proof.version !== evidence.installed.version) throw new Error('Production image core version differs from installed generator.');
      evidence.images.push({ image, id, ...proof });
    }
    if (evidence.images[0].id === evidence.images[1].id) throw new Error('Promotion must use two distinct immutable release image IDs.');
    const deployManifest = JSON.parse(await readFile(join(app, 'svelar.deploy.json'), 'utf8'));
    deployManifest.readinessTimeout = 60; deployManifest.drainTimeout = 30;
    await writeFile(join(app, 'svelar.deploy.json'), JSON.stringify(deployManifest, null, 2) + '\n');
    const bootstrap = join(proxyDirectory, 'bootstrap.compose.json');
    await writeFile(bootstrap, JSON.stringify({ services: { app: { image: imageOne } } }));
    await docker([...compose, '-f', bootstrap, 'run', '--rm', '--no-deps', '-T', 'app', 'npx', 'svelar', 'migrate'], { timeoutMs: 120000 });
    check('generated-production-provenance', { installed: evidence.installed, images: evidence.images });
    await deploy([`--image=${imageOne}`, '--compatible-migrations']);
    const initial = await state();
    if (initial.active !== 'blue' || initial.releases.blue.imageId !== evidence.images[0].id) throw new Error('First adoption did not deploy the first immutable image into blue.');
    const first = await container(slotFile('blue'), 'app_blue');
    assertProbe(await probe(first, '/api/ready'), { status: 200, ready: true });
    await roles('blue', evidence.images[0].id);
    const databaseBarrier = await holdTable('users');
    try {
      assertProbe(await probe(first, '/api/health'), { status: 200 });
      // The regular ready cache expires naturally; no cache reset or application patch is used.
      const notReady = await waitUntil(async () => {
        const value = await probe(first, '/api/ready'); return value.status === 503 ? value : false;
      }, { timeoutMs: 8000, label: 'Real dependency readiness failure distinct from liveness' });
      assertProbe(notReady, { status: 503, ready: false });
      check('readiness-beyond-liveness', { health: 200, ready: 503, controlledDependency: 'owned users-table PostgreSQL lock' });
    } finally { await databaseBarrier.release(); }
    await waitUntil(async () => (await probe(first, '/api/ready')).status === 200, { timeoutMs: 10000, label: 'Generated ready recovery' });
    await waitUntil(async () => {
      const response = await fetch(`${evidence.baseUrl}/api/traffic`, { redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
      if (response.status !== 200) { await response.arrayBuffer(); return false; }
      const body = await response.json(); return body.data?.slot === 'blue';
    }, { timeoutMs: 10000, intervalMs: 500, label: 'Gateway health re-admission after controlled readiness failure' });
    loading = (async () => {
      while (!loadStopped) {
        const sample = { at: new Date().toISOString(), startedAt: Date.now(), phase, path: '/api/health' };
        try { const response = await fetch(`${evidence.baseUrl}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(5000) }); sample.status = response.status; await response.arrayBuffer(); }
        catch (error) { sample.status = null; sample.error = error.message; }
        sample.finishedAt = Date.now(); evidence.samples.push(sample);
        await sleep(3000);
      }
    })();
    await promote('promotion', [`--image=${imageTwo}`, '--compatible-migrations'], 'blue', 'green');
    await promote('rollback', ['--rollback'], 'green', 'blue');
    const final = await state();
    if (final.releases.blue.imageId !== evidence.images[0].id || final.releases.green.imageId !== evidence.images[1].id) throw new Error('Rollback lost retained immutable image identity.');
    const gateway = await container(join(app, '.svelar/deployment/gateway.compose.json'), 'gateway');
    const binding = (await inspect(gateway)).NetworkSettings.Ports['3000/tcp'];
    if (binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || Number(binding[0].HostPort) !== publicPort) throw new Error('Promotion/rollback changed the public gateway port.');
    if (await sql("SELECT count(*) FROM svelar_deployment_locks WHERE name='migrations' AND owner IS NULL") !== '1') throw new Error('Compatible forward migrations did not leave released persistent migration ownership.');
    check('locked-forward-migrations-and-retained-rollback', { final, publicPort });
    loadStopped = true; await loading; loading = null;
    check('continuous-generated-http-availability', assertAvailability(evidence.samples, evidence.transitions));
    if (JSON.stringify(await fingerprints(app)) !== JSON.stringify(sourceHashes)) throw new Error('Generated application source or deployment templates changed during execution.');
    await archiveIdentity(artifact.path, artifact.sha256);
  } catch (error) { failure = error; evidence.failure = { message: error.message, stack: error.stack }; controller.abort(error); }
  finally {
    loadStopped = true;
    clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    const cleanupErrors = [];
    if (loading) await loading.catch((error) => cleanupErrors.push(error));
    await Promise.allSettled([...pending]);
    for (const pid of locks) {
      try { await sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=${pid} AND application_name LIKE '${project}-%'`, null); } catch (error) { cleanupErrors.push(error); }
    }
    for (const peer of peers) if (!peer.settled) {
      try { await stopManagedProcess(peer); } catch (error) { cleanupErrors.push(error); }
    }
    if (dockerBinary) {
      try {
        const owned = await runCommand(dockerBinary, ['ps', '--all', '--quiet', '--filter', `label=${ownerLabel}=${runId}`]);
        for (const id of owned.stdout.trim().split('\n').filter(Boolean)) {
          const logs = await runCommand(dockerBinary, ['logs', '--tail', '1000', id]).catch((error) => error);
          await writeEvidence(evidenceDir, `container-${id}.log`, safe(`${logs.stdout ?? ''}\n${logs.stderr ?? ''}`));
        }
        await cleanupOwned(dockerBinary, runId);
        evidence.cleanup.push({ resource: 'Docker resources', ownerLabel, owner: runId, outcome: 'removed' });
      } catch (error) { cleanupErrors.push(error); }
    }
    if (sourceHashes) {
      try { if (JSON.stringify(await fingerprints(app)) !== JSON.stringify(sourceHashes)) throw new Error('Generated source changed before cleanup.'); }
      catch (error) { cleanupErrors.push(error); }
    }
    try { extraction?.cleanup(); } catch (error) { cleanupErrors.push(error); }
    for (const path of [fixtureRoot].filter(Boolean)) {
      try { await rm(path, { recursive: true, force: true }); evidence.cleanup.push({ resource: path, outcome: 'removed' }); }
      catch (error) { cleanupErrors.push(error); }
    }
    evidence.cleanupErrors = cleanupErrors.map((error) => error.message);
    evidence.status = failure || cleanupErrors.length ? 'failed' : 'passed'; record('cleanup-complete'); await persist();
    if (cleanupErrors.length) failure = new AggregateError(failure ? [failure, ...cleanupErrors] : cleanupErrors, 'Generated deployment failed or its owned cleanup did not finish.');
  }
  console.log(`Generated adapter-node deployment: ${evidence.status}; ${join(evidenceDir, 'report.json')}`);
  if (failure) throw failure;
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node scripts/generated-deployment-certification.mjs --tarball=<existing.tgz> --sha256=<exact SHA256> [--report-dir=<persistent directory>] [--timeout=1500] [--execute]\nDefault: read-only plan. --execute installs/builds one owned generated app and starts owned Docker services; requires parent GO. Never builds or packs core.');
    else if (!options.execute) { await archiveIdentity(options.tarball, options.sha256); console.log(JSON.stringify(acceptancePlan(options), null, 2)); }
    else await certifyGeneratedDeployment(options);
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
