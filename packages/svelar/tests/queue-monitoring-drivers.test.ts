import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const manifest = process.env.SVELAR_TEST_QUEUE_CLIENT;
const cases = [{ driver: 'postgres', port: process.env.SVELAR_TEST_QUEUE_PG_PORT },
  { driver: 'mysql', port: process.env.SVELAR_TEST_QUEUE_MYSQL_PORT }] as const;
const run = promisify(execFile);
describe.skipIf(!manifest || !cases.some(test => test.port))('Native SQL queue migration and atomic replay portability', () => {
  let directory: string;
  let bundle: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'svelar-queue-sql-native-'));
    await symlink(join(dirname(resolve(manifest!)), 'node_modules'), join(directory, 'node_modules'));
    bundle = join(directory, 'fixture.mjs');
    await build({ entryPoints: [resolve('tests/queue-monitoring-fixture.ts')], outfile: bundle, bundle: true,
      platform: 'node', format: 'esm', packages: 'external', keepNames: true, target: 'node22', logLevel: 'silent' });
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
  for (const test of cases) it.skipIf(!test.port)(`${test.driver}: applies focused migrations, isolates indexed metadata and admits one replay winner`, async () => {
    const script = `import {sqlProof} from ${JSON.stringify(pathToFileURL(bundle).href)}; console.log(JSON.stringify(await sqlProof(${JSON.stringify(test.driver)},${Number(test.port)})));`;
    const { stdout } = await run(process.execPath, ['--input-type=module', '--eval', script], { timeout: 30000, env: { ...process.env,
      SVELAR_QUEUE_SERVICE_RECOVERED: '', SVELAR_QUEUE_MONITOR_CHILD: '' } });
    const proof = JSON.parse(stdout.trim());
    expect(proof).toMatchObject({ winners: 1, completed: 1, pending: 0, metrics: { failed: 1, completed: 1 },
      receipt: { connection: 'sql', context: { teamId: 'tenant' }, maxAttempts: 1, retryDelay: 0 }, snapshot: { status: 'completed' } });
    expect(typeof proof.receipt.failedAt).toBe('number'); expect(typeof proof.receipt.replayedAt).toBe('number');
    expect(proof.metrics.completedPerMinute.reduce((a: number, b: number) => a + b, 0)).toBe(1);
    expect(proof.timeline).toEqual(expect.arrayContaining(['failed', 'replayed']));
  }, 40000);
});
