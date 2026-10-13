import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const native = process.env.SVELAR_TEST_INBOX_OPERATIONS_NATIVE === '1';
const evidenceDirectory = process.env.SVELAR_TEST_INBOX_OPERATION_EVIDENCE_DIR;
const scenarios = ['migrations', 'inbox.exclusive', 'inbox.ordering', 'inbox.dead-worker', 'inbox.retry-dlq',
  'inbox.large-binary', 'operation.exclusive', 'operation.dead-worker', 'operation.cancel',
  'operation.boundaries', 'operation.notifier-retry'];
const docker = (args: string[]) => run('docker', args, { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
const fixture = resolve(dirname(fileURLToPath(import.meta.url)), 'inbox-operation-driver-fixture.ts');
const repositoryModules = resolve(dirname(fixture), '../../../node_modules');

describe.skipIf(!native)('Native PostgreSQL/MySQL inbox and operation driver proofs', () => {
  let directory: string;
  let mainBundle: string;
  let workerBundle: string;
  const containers: string[] = [];
  const configurations = new Map<string, any>();

  beforeAll(async () => {
    await docker(['info', '--format', '{{.ServerVersion}}']);
    directory = await mkdtemp(join(tmpdir(), 'svelar-inbox-operation-native-'));
    const modules = join(directory, 'node_modules');
    await mkdir(modules);
    const manifest = process.env.SVELAR_TEST_INBOX_OPERATION_CLIENT ?? process.env.SVELAR_TEST_QUEUE_CLIENT;
    let clientModules: string;
    if (manifest) clientModules = join(dirname(resolve(manifest)), 'node_modules');
    else {
      const client = join(directory, 'clients');
      await mkdir(client);
      await run('npm', ['install', '--prefix', client, '--ignore-scripts', '--no-audit', '--no-fund',
        'postgres@latest', 'mysql2@latest'], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
      clientModules = join(client, 'node_modules');
    }
    for (const name of ['postgres', 'mysql2']) {
      await access(join(clientModules, name));
      await symlink(join(clientModules, name), join(modules, name));
    }
    const externalPackages = new Set<string>();
    mainBundle = join(directory, 'supervisor.mjs');
    workerBundle = join(directory, 'worker.mjs');
    for (const outfile of [mainBundle, workerBundle]) {
      const compiled = await build({ entryPoints: [fixture], outfile, bundle: true, platform: 'node', format: 'esm',
        packages: 'external', target: 'node22', keepNames: true, logLevel: 'silent', metafile: true });
      for (const output of Object.values(compiled.metafile!.outputs)) for (const dependency of output.imports) {
        if (!dependency.external || dependency.path.startsWith('node:')) continue;
        const parts = dependency.path.split('/');
        externalPackages.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
      }
    }
    for (const name of externalPackages) {
      if (name === 'postgres' || name === 'mysql2') continue;
      const target = join(repositoryModules, name);
      try { await access(target); } catch { continue; }
      await mkdir(dirname(join(modules, name)), { recursive: true });
      // Drizzle resolves optional driver peers from its real path, not its symlink.
      if (name === 'drizzle-orm') await cp(target, join(modules, name), { recursive: true });
      else await symlink(target, join(modules, name));
    }
    for (const driver of ['postgres', 'mysql']) {
      const name = 'svelar-inbox-operation-' + driver + '-' + randomUUID();
      const password = randomUUID();
      containers.push(name);
      const image = driver === 'postgres'
        ? process.env.SVELAR_TEST_INBOX_OPERATION_PG_IMAGE ?? 'postgres:17-alpine'
        : process.env.SVELAR_TEST_INBOX_OPERATION_MYSQL_IMAGE ?? 'mysql:8.0';
      const containerPort = driver === 'postgres' ? 5432 : 3306;
      const environment = driver === 'postgres'
        ? ['POSTGRES_USER=svelar_native', 'POSTGRES_PASSWORD=' + password, 'POSTGRES_DB=inbox_operation_proof']
        : ['MYSQL_USER=svelar_native', 'MYSQL_PASSWORD=' + password, 'MYSQL_DATABASE=inbox_operation_proof',
          'MYSQL_ROOT_PASSWORD=' + password];
      await docker(['run', '--detach', '--rm', '--name', name, '--label', 'svelar.fixture=inbox-operation',
        '--publish', '127.0.0.1::' + containerPort,
        '--tmpfs', (driver === 'postgres' ? '/var/lib/postgresql/data' : '/var/lib/mysql') + ':rw',
        ...environment.flatMap((value) => ['--env', value]), image]);
      const { stdout } = await docker(['port', name, containerPort + '/tcp']);
      const port = Number(stdout.trim().split(':').at(-1));
      expect(port).toBeGreaterThan(1024);
      expect(port).not.toBe(containerPort);
      configurations.set(driver, { driver, host: '127.0.0.1', port, database: 'inbox_operation_proof',
        user: 'svelar_native', password, prepare: false });
      const deadline = Date.now() + 90_000;
      let ready = false;
      let lastError: unknown;
      while (Date.now() < deadline) {
        try {
          if (driver === 'postgres') await docker(['exec', name, 'pg_isready', '-h127.0.0.1', '-U', 'svelar_native', '-d', 'inbox_operation_proof']);
          else await docker(['exec', name, 'mysqladmin', 'ping', '-h127.0.0.1', '-uroot', '-p' + password]);
          ready = true;
          break;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!ready) {
        const logs = await docker(['logs', name]);
        throw new Error('Native ' + driver + ' startup/migration failed: ' + String(lastError) + '\n' + logs.stdout + logs.stderr);
      }
      await execute(driver, 'ping');
      await execute(driver, 'migrate');
      if (evidenceDirectory) {
        await mkdir(evidenceDirectory, { recursive: true });
        const inspect = await docker(['inspect', '--format', '{{json .Config.Image}} {{json .Image}} {{json .NetworkSettings.Ports}}', name]);
        await writeFile(join(evidenceDirectory, driver + '-container.txt'), inspect.stdout);
      }
    }
  }, 240_000);

  afterAll(async () => {
    const failures: unknown[] = [];
    for (const name of containers) {
      try {
        const inspect = await docker(['ps', '--all', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}']);
        if (inspect.stdout.trim() === name) await docker(['rm', '--force', name]);
      } catch (error) { failures.push(error); }
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    if (failures.length) throw new AggregateError(failures, 'Native fixture cleanup failed.');
  }, 120_000);

  async function execute(driver: string, scenario: string) {
    const setup = scenario === 'migrate' || scenario === 'ping';
    const exported = setup ? scenario : 'proof';
    const script = 'import {' + exported + '} from ' + JSON.stringify(pathToFileURL(mainBundle).href) + ';' +
      'const result = await ' + exported + '(' + JSON.stringify(configurations.get(driver)) +
      (setup ? '' : ',' + JSON.stringify(scenario) + ',' + JSON.stringify(workerBundle)) +
      '); if (result) console.log(JSON.stringify(result));';
    const result = await run(process.execPath, ['--input-type=module', '--eval', script], {
      timeout: 45_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, SVELAR_INBOX_OPERATION_WORKER: '' },
    });
    if (setup) return;
    const proof = JSON.parse(result.stdout.trim());
    if (evidenceDirectory) {
      await writeFile(join(evidenceDirectory, driver + '-' + scenario + '.json'), JSON.stringify(proof, null, 2));
      if (result.stderr) await writeFile(join(evidenceDirectory, driver + '-' + scenario + '.stderr.log'), result.stderr);
    }
    return proof;
  }

  for (const driver of ['postgres', 'mysql']) describe(driver, () => {
    for (const scenario of scenarios) it(scenario, async () => {
      const result = await execute(driver, scenario);
      expect(result).toMatchObject({ scenario, driver, passed: true });
      expect(Object.keys(result.evidence).length).toBeGreaterThan(0);
    }, 60_000);
  });
});
