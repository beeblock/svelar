import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';

describe('TypeScript 6 core/scaffold baseline', () => {
  it('uses the supported JavaScript compiler API rather than TypeScript 7', () => {
    expect(ts.version).toBe('6.0.3');
    expect(typeof ts.createProgram).toBe('function');
    expect(typeof ts.transpileModule).toBe('function');
    const result = ts.transpileModule('export const value: number = 1;', {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.outputText).toContain('export const value = 1;');
  });

  it('keeps explicit Node ambient types, output roots, and resolution in effective core configs', () => {
    for (const name of ['tsconfig.json', 'tsconfig.build.json']) {
      const filename = fileURLToPath(new URL('../' + name, import.meta.url));
      const result = ts.readConfigFile(filename, ts.sys.readFile);
      expect(result.error).toBeUndefined();
      const config = ts.parseJsonConfigFileContent(result.config, ts.sys, fileURLToPath(new URL('../', import.meta.url)));
      expect(config.errors).toEqual([]);
      expect(config.options.types).toEqual(['node']);
      expect(config.options.target).toBe(ts.ScriptTarget.ES2022);
      expect(config.options.rootDir).toBe(fileURLToPath(new URL('../src', import.meta.url)));
      expect(config.options.ignoreDeprecations).toBeUndefined();
    }
  });

  it('generates native TS6 apps without changing validation choice or Node type major', () => {
    for (const validation of ['zod', 'valibot'] as const) {
      const manifest = JSON.parse(NewCommandTemplates.packageJson('probe', '0.8.0', validation));
      expect(manifest.devDependencies.typescript).toBe('^6.0.3');
      expect(manifest.devDependencies['@types/node']).toBe('^22.20.5');
      expect(manifest.dependencies.zod).toBe(validation === 'zod' ? '^4.6.7' : undefined);
    }
    expect(JSON.parse(NewCommandTemplates.tsConfig()).compilerOptions.types).toEqual(['node', 'vite/client']);
    for (const relative of ['../../../package.json', '../package.json']) {
      const manifest = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
      expect(manifest.devDependencies.typescript).toBe('^6.0.3');
    }
  });
});
