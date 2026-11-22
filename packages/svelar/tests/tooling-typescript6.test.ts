import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';

const require = createRequire(import.meta.url);
const semver = require('semver') as {
  satisfies(version: string, range: string): boolean;
  subset(sub: string, sup: string): boolean;
};

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
    expect(JSON.parse(NewCommandTemplates.tsConfig()).compilerOptions.types).toEqual(['$app/types', 'node', 'vite/client']);
    for (const relative of ['../../../package.json', '../package.json']) {
      const manifest = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
      expect(manifest.devDependencies.typescript).toBe('^6.0.3');
    }
    const core = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(core.devDependencies['@types/node']).toBe('^22.20.5');
    expect(core.devDependencies.tsup).toBe('^9.0.0');
    expect(core.engines.node).toBe('>=22.12.0');
    expect(core.peerDependencies['@sveltejs/kit']).toBe('^2.0.0 || ^3.0.0');
    expect(core.peerDependencies['sveltekit-superforms']).toBe('^2.31.0 || ^3.1.0');
  });

  it('keeps Dependabot compiler major upgrades opt-in and groups compatible Svelte tooling', () => {
    const policy = readFileSync(new URL('../../../.github/dependabot.yml', import.meta.url), 'utf8');
    // No YAML parser is installed; match the two reviewed policy blocks without inventing a parser.
    expect(policy).toContain(`    ignore:
      - dependency-name: "@types/node"
        update-types: ["version-update:semver-major"]
      - dependency-name: "typescript"
        update-types: ["version-update:semver-major"]`);
    expect(policy).toContain(`      sveltekit-tooling:
        patterns:
          - "@sveltejs/*"
          - "svelte"
          - "vite"
          - "vitest"
          - "@vitest/coverage-v8"
          - "sveltekit-superforms"
          - "formsnap"`);
  });

  it('limits source-build engines to the installed tsup release support without raising core runtime engines', () => {
    const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    const core = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const tsup = require('tsup/package.json') as { version: string; engines: { node: string } };
    expect(semver.satisfies(tsup.version, core.devDependencies.tsup)).toBe(true);
    expect(root.engines.node).toBe('^22.18.0 || ^24.11.0 || >=26.0.0');
    expect(semver.subset(root.engines.node, tsup.engines.node)).toBe(true);
    for (const version of ['22.18.0', '22.20.0', '24.11.0', '24.12.0', '26.0.0']) {
      expect(semver.satisfies(version, root.engines.node), version).toBe(true);
    }
    for (const version of ['22.17.0', '23.0.0', '24.0.0', '24.10.99', '25.0.0']) {
      expect(semver.satisfies(version, root.engines.node), version).toBe(false);
    }
    expect(core.engines.node).toBe('>=22.12.0');
  });
});
