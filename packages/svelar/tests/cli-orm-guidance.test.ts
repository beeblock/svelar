import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lexer, type Token, type Tokens } from 'marked';
import { describe, expect, it } from 'vitest';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function contracts(markdown: string): string[] {
  const tokens = lexer(markdown);
  const heading = tokens.findIndex((token) => token.type === 'heading'
    && token.depth === 3 && token.text === 'Find-Or-Create Contracts');
  expect(heading).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((token, index) => index > heading
    && token.type === 'heading' && token.depth <= 3);
  const body = tokens.slice(heading + 1, end === -1 ? undefined : end);
  const lists = body.filter((token: Token): token is Tokens.List => token.type === 'list');
  expect(lists).toHaveLength(1);
  expect(lists[0].items.length).toBeGreaterThan(0);
  return lists[0].items.map((item) => item.text);
}

const canonical = contracts(readFileSync(resolve(root, '.codex/skills/svelar-specialist/SKILL.md'), 'utf8'));

describe('ORM helper guidance distribution', () => {
  it.each([
    '.claude/skills/svelar-specialist/SKILL.md',
    '.claude/skills/svelar-specialist/references/orm-database.md',
  ])('keeps maintained %s aligned with the Codex contract', (path) => {
    expect(contracts(readFileSync(resolve(root, path), 'utf8'))).toEqual(canonical);
  });

  it.each([
    ['Codex SKILL.md', () => NewCommandTemplates.codexSvelarSkill()],
    ['Claude SKILL.md', () => NewCommandTemplates.claudeSvelarSkill()],
    ['AGENTS.md', () => NewCommandTemplates.agentsMd()],
    ['CLAUDE.md', () => NewCommandTemplates.claudeMd()],
  ] as const)('emits the full maintained ORM contract in generated %s', (_name, generate) => {
    // Compare parsed Markdown list items, not source-template escape sequences.
    expect(contracts(generate())).toEqual(canonical);
  });
});
