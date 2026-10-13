import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'search-large-keyset-fixture.ts');
const million = process.env.SVELAR_TEST_SEARCH_MILLION === '1';

async function proof(rows: number, name: string) {
  const directory = await mkdtemp(join(packageRoot, '.test-search-large-keyset-'));
  try {
    const bundle = join(directory, 'fixture.mjs');
    await build({ entryPoints: [fixture], outfile: bundle, bundle: true, platform: 'node', format: 'esm',
      packages: 'external', target: 'node22', keepNames: true, logLevel: 'silent' });
    const options = { directory, rows, seedBatchSize: 1000, batchSize: 500, deleteVisitedPrefix: true };
    const script = `import {runLargeKeysetProof} from ${JSON.stringify(pathToFileURL(bundle).href)};
      console.log(JSON.stringify(await runLargeKeysetProof(${JSON.stringify(options)})));`;
    const { stdout, stderr } = await execute(process.execPath, ['--max-old-space-size=128', '--max-semi-space-size=8', '--expose-gc', '--input-type=module', '--eval', script], {
      cwd: packageRoot, timeout: 180_000, maxBuffer: 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '' },
    }).catch((error: unknown) => {
      const details = error instanceof Error && 'stderr' in error ? String(error.stderr) : String(error);
      throw new Error('Isolated large-keyset fixture failed: ' + details, { cause: error });
    });
    expect(stderr).toBe('');
    const result = JSON.parse(stdout.trim());
    expect(result).toMatchObject({ passed: true, actualMeilisearch: false, seededRows: rows,
      indexed: rows - Math.floor(rows / 11), rowsRemaining: rows - 500, deletedRows: 500,
      customPrimaryKey: 'record_id', contextRestored: true, hiddenFieldWithheld: true,
      source: { rowsRead: rows, maxSeedBatch: 1000, maxPageRows: 500, unboundedReadsRejected: 1, offsetReads: 0 },
      target: { maxInFlight: 1, inFlight: 0 }, memory: { oldSpaceLimitMiB: 128, semiSpaceLimitMiB: 8 } });
    expect(result.source.pages).toBe(Math.floor(rows / 500) + 1);
    expect(result.target.maxBatch).toBeLessThanOrEqual(500);
    expect(result.memory.peakRssBytes).toBeLessThan(320 * 1024 * 1024);
    expect(result.memory.retainedHeapGrowthBytes).toBeLessThan(24 * 1024 * 1024);
    const evidence = process.env.SVELAR_TEST_SEARCH_LARGE_EVIDENCE_DIR;
    if (evidence) { await mkdir(evidence, { recursive: true }); await writeFile(join(evidence, name + '.json'), JSON.stringify(result, null, 2) + '\n'); }
    console.log(JSON.stringify({ name, ...result }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

it('reindexes actual SQLite pages with bounded capture/backpressure and deletes the visited prefix without skipping rows', async () => {
  await proof(5003, 'small-keyset');
}, 30_000);

it.skipIf(!million)('reindexes at least one million actual SQLite records in a 128 MiB old-space child with bounded memory', async () => {
  await proof(1_000_000, 'million-keyset');
}, 200_000);
