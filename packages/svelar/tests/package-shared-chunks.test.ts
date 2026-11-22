import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import tsupConfig from '../tsup.config.js';

describe('shared production infrastructure chunks', () => {
  it('emits the database connection implementation once across server subpaths', async () => {
    expect(tsupConfig.splitting).toBe(true);
    const result = await build({
      entryPoints: {
        database: 'src/database/index.ts', orm: 'src/orm/index.ts',
        logging: 'src/logging/index.ts', queue: 'src/queue/index.ts',
      },
      bundle: true, splitting: true, write: false, metafile: true,
      outdir: '.test-shared-chunks', packages: 'external',
      format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
    });
    const owners = Object.entries(result.metafile!.outputs).filter(([, output]) =>
      Object.entries(output.inputs).some(([input, metadata]) => input.endsWith('database/Connection.ts') && metadata.bytesInOutput > 0));
    expect(owners).toHaveLength(1);
    expect(owners[0][0]).toMatch(/chunk-/);
    for (const entry of ['database', 'orm', 'logging', 'queue']) {
      const output = Object.entries(result.metafile!.outputs).find(([name]) => name.endsWith('/' + entry + '.js'));
      expect(output?.[1].imports.some((dependency) => dependency.kind === 'import-statement' && dependency.path.includes('chunk-'))).toBe(true);
    }
  });
});
