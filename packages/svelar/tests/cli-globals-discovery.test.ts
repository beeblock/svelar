import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { NewCommandTemplates as T } from '../src/cli/commands/NewCommandTemplates.js';

describe('Generated application ambient declarations', () => {
  it('discovers Svelar globals without a same-name bootstrap shadowing them', () => {
    const root = mkdtempSync(join(tmpdir(), 'svelar-globals-'));
    try {
      mkdirSync(join(root, 'src'));
      mkdirSync(join(root, '.svelte-kit'));
      writeFileSync(join(root, 'tsconfig.json'), T.tsConfig());
      writeFileSync(join(root, '.svelte-kit/tsconfig.json'), JSON.stringify({ include: ['../src/**/*.ts'] }));
      writeFileSync(join(root, 'src/app.ts'), 'export const bootstrap = true;');
      writeFileSync(join(root, 'src/app.d.ts'), T.appDts());
      writeFileSync(join(root, 'src/svelar.d.ts'), T.appDts());
      const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
      expect(config.error).toBeUndefined();
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
      expect(parsed.errors).toEqual([]);
      expect(parsed.fileNames).toContain(join(root, 'src/app.ts'));
      expect(parsed.fileNames).not.toContain(join(root, 'src/app.d.ts'));
      expect(parsed.fileNames).toContain(join(root, 'src/svelar.d.ts'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
