import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseConfig } from '../src/database/Connection.js';

const run = promisify(execFile);
const native = process.env.SVELAR_TEST_TEAMS_NATIVE === '1';
const fixture = resolve(dirname(fileURLToPath(import.meta.url)), 'team-invitation-driver-fixture.ts');
const docker = (args: string[]) => run('docker', args, { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
const evidence = process.env.SVELAR_TEST_TEAMS_EVIDENCE_DIR;

describe('Invitation independently bundled Node ESM driver proofs', () => {
  let directory: string, supervisor: string, worker: string;
  const containers: string[] = [];
  const configs = new Map<string, DatabaseConfig>();
  async function execute(driver: string, scenario: string) {
    const operation = scenario === 'migrate' || scenario === 'ping' ? scenario : 'proof';
    const script = 'import {' + operation + '} from ' + JSON.stringify(pathToFileURL(supervisor).href) + '; const result = await ' + operation + '(' + JSON.stringify(configs.get(driver))
      + (operation === 'proof' ? ',' + JSON.stringify(scenario) + ',' + JSON.stringify(worker) + ',' + JSON.stringify(directory) : '') + '); if(result) console.log(JSON.stringify(result));';
    const result = await run(process.execPath, ['--input-type=module', '--eval', script], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    if (operation !== 'proof') return;
    const proof = JSON.parse(result.stdout.trim());
    if (evidence) { await mkdir(evidence, { recursive: true }); await writeFile(join(evidence, driver + '-' + scenario + '.json'), JSON.stringify(proof, null, 2)); }
    return proof;
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'svelar-team-invitation-native-'));
    const modules = join(directory, 'node_modules'); await mkdir(modules);
    const repositoryModules = resolve(dirname(fixture), '../../../node_modules');
    const manifest = process.env.SVELAR_TEST_TEAMS_CLIENT ?? process.env.SVELAR_TEST_QUEUE_CLIENT;
    const clientModules = manifest ? join(dirname(resolve(manifest)), 'node_modules') : repositoryModules;
    const required = native ? ['postgres', 'mysql2'] : [];
    for (const name of required) { await access(join(clientModules, name)); await symlink(join(clientModules, name), join(modules, name)); }
    supervisor = join(directory, 'supervisor.mjs'); worker = join(directory, 'worker.mjs');
    const packages = new Set<string>();
    for (const outfile of [supervisor, worker]) {
      const result = await build({ entryPoints: [fixture], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', logLevel: 'silent', metafile: true });
      for (const output of Object.values(result.metafile!.outputs)) for (const dependency of output.imports) if (dependency.external && !dependency.path.startsWith('node:')) {
        const parts = dependency.path.split('/'); packages.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
      }
    }
    for (const name of packages) {
      if (required.includes(name)) continue;
      const target = join(repositoryModules, name); try { await access(target); } catch { continue; }
      await mkdir(dirname(join(modules, name)), { recursive: true });
      if (name === 'drizzle-orm') await cp(target, join(modules, name), { recursive: true });
      else await symlink(target, join(modules, name));
    }
    configs.set('sqlite', { driver: 'sqlite', filename: join(directory, 'proof.sqlite') });
    if (native) for (const driver of ['postgres', 'mysql'] as const) {
      await docker(['info', '--format', '{{.ServerVersion}}']);
      const name = 'svelar-team-invitation-' + driver + '-' + randomUUID(), password = randomUUID(); containers.push(name);
      const image = driver === 'postgres' ? 'postgres:17-alpine' : 'mysql:8.0'; const port = driver === 'postgres' ? 5432 : 3306;
      const env = driver === 'postgres' ? ['POSTGRES_USER=proof', 'POSTGRES_PASSWORD=' + password, 'POSTGRES_DB=invitation_proof']
        : ['MYSQL_USER=proof', 'MYSQL_PASSWORD=' + password, 'MYSQL_DATABASE=invitation_proof', 'MYSQL_ROOT_PASSWORD=' + password];
      await docker(['run', '--detach', '--rm', '--name', name, '--label', 'svelar.fixture=team-invitation', '--publish', '127.0.0.1::' + port,
        '--tmpfs', (driver === 'postgres' ? '/var/lib/postgresql/data' : '/var/lib/mysql') + ':rw', ...env.flatMap((entry) => ['--env', entry]), image]);
      const published = await docker(['port', name, port + '/tcp']); const actualPort = Number(published.stdout.trim().split(':').at(-1));
      expect(actualPort).toBeGreaterThan(1024); expect(actualPort).not.toBe(port);
      configs.set(driver, { driver, host: '127.0.0.1', port: actualPort, database: 'invitation_proof', user: 'proof', password, prepare: false });
      const deadline = Date.now() + 90_000; let ready = false;
      while (Date.now() < deadline) { try { await execute(driver, 'ping'); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } }
      if (!ready) throw new Error('Native invitation driver did not start: ' + driver);
      if (evidence) { await mkdir(evidence, { recursive: true }); const inspection = await docker(['inspect', '--format', '{{json .Config.Image}} {{json .Image}} {{json .NetworkSettings.Ports}}', name]); await writeFile(join(evidence, driver + '-container.txt'), inspection.stdout); }
    }
    for (const driver of configs.keys()) await execute(driver, 'migrate');
  }, 240_000);
  afterAll(async () => {
    const errors: unknown[] = [];
    for (const container of containers) try { await docker(['rm', '--force', container]); } catch (error) { errors.push(error); }
    if (directory) await rm(directory, { recursive: true, force: true });
    if (errors.length) throw new AggregateError(errors, 'Invitation fixture resource cleanup failed');
  }, 120_000);
  for (const driver of ['sqlite', 'postgres', 'mysql']) describe.skipIf(driver !== 'sqlite' && !native)(driver, () => {
    for (const scenario of ['lookup', 'exclusive', 'accept-decline', 'rollback', 'guards', 'current-state']) it(scenario, async () => {
      expect(await execute(driver, scenario)).toMatchObject({ driver, scenario, passed: true });
    }, 75_000);
  });
});
