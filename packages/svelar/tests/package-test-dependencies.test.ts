import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const core = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../../../package-lock.json', import.meta.url), 'utf8'));

describe('Core guidance test dependency ownership', () => {
  it('declares the Markdown lexer directly in core devDependencies instead of relying on ignored workspaces', () => {
    const path = new URL('./cli-orm-guidance.test.ts', import.meta.url);
    const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports = source.statements.filter(ts.isImportDeclaration)
      .filter(node => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'marked');
    expect(imports).toHaveLength(1);
    expect(core.devDependencies.marked).toBe('^18.1.1');
    expect(core.dependencies.marked).toBeUndefined();
    expect(core.peerDependencies.marked).toBeUndefined();
  });

  it('locks the core-owned lexer and its supported release line for normal npm ci', () => {
    expect(lock.packages['packages/svelar'].devDependencies.marked).toBe(core.devDependencies.marked);
    expect(lock.packages['node_modules/marked'].version).toMatch(/^18\.\d+\.\d+$/);
    expect(lock.packages['node_modules/marked'].dev).toBe(true);
  });
});
