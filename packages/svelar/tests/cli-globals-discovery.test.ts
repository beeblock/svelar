import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { NewCommandTemplates as T } from '../src/cli/commands/NewCommandTemplates.js';

describe('Generated application ambient declarations', () => {
  it('discovers Svelar globals without a same-name bootstrap shadowing them', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'svelar-globals-')));
    try {
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'tsconfig.json'), T.tsConfig());
      writeFileSync(join(root, 'src/app.ts'), 'export const bootstrap = true;');
      writeFileSync(join(root, 'src/app.d.ts'), T.appDts());
      writeFileSync(join(root, 'src/svelar.d.ts'), T.appDts());
      const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
      expect(config.error).toBeUndefined();
      expect(config.config.extends).toBe('$app/tsconfig');
      const unbound = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
      expect(unbound.errors.some((error) => error.code === 6053 && ts.flattenDiagnosticMessageText(error.messageText, '\n').includes('$app/tsconfig'))).toBe(true);

      const kitRoot = dirname(createRequire(import.meta.url).resolve('@sveltejs/kit/package.json'));
      const { validate_config, process_config } = await import(/* @vite-ignore */ pathToFileURL(join(kitRoot, 'src/core/config/index.js')).href);
      const { write_tsconfig } = await import(/* @vite-ignore */ pathToFileURL(join(kitRoot, 'src/core/sync/write_tsconfig/index.js')).href);
      // Resolve the same generated parent config Kit 3 writes during sync, without starting Vite.
      write_tsconfig(process_config(validate_config({ alias: { '$lib': 'src/lib', '$lib/*': 'src/lib/*' } }), root), root);
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
      expect(parsed.errors).toEqual([]);
      expect(parsed.options.isolatedModules).toBe(true);
      expect(parsed.options.verbatimModuleSyntax).toBe(true);
      expect(parsed.options.types).toEqual(['$app/types', 'node', 'vite/client']);
      expect(parsed.options.rootDirs).toEqual([root, join(root, '.svelte-kit/types')]);
      expect(parsed.options.paths?.['$lib/*']?.map((path) => resolve(root, 'node_modules/$app', path))).toEqual([join(root, 'src/lib/*')]);
      expect(parsed.fileNames).toContain(join(root, 'src/app.ts'));
      expect(parsed.fileNames).not.toContain(join(root, 'src/app.d.ts'));
      expect(parsed.fileNames).toContain(join(root, 'src/svelar.d.ts'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
