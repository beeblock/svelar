import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import tsupConfig from '../tsup.config.js';

describe('Production bundle class identities', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(resolve('.test-bundle-names-'));
    await build({
      entryPoints: {
        pdf: resolve('src/pdf/index.ts'),
        pdfJob: resolve('src/pdf/GeneratePdfJob.ts'),
        queue: resolve('src/queue/index.ts'),
      },
      outdir: root, outExtension: { '.js': '.mjs' }, bundle: true,
      splitting: false, minify: true, keepNames: tsupConfig.keepNames,
      packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
    });
  });

  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it('keeps the same PDF job registry key across independently minified subpaths', async () => {
    const pdf = await import(pathToFileURL(join(root, 'pdf.mjs')).href);
    const pdfJob = await import(pathToFileURL(join(root, 'pdfJob.mjs')).href);
    const queue = await import(pathToFileURL(join(root, 'queue.mjs')).href);
    expect(pdf.GeneratePdfJob.name).toBe('GeneratePdfJob');
    expect(pdfJob.GeneratePdfJob.name).toBe('GeneratePdfJob');
    queue.Queue.register(pdfJob.GeneratePdfJob);
    expect(queue.Queue.registeredJobs()).toContain(pdf.GeneratePdfJob.name);
  });
});
