import { describe, expect, it } from 'vitest';
import { compile, parse, type AST } from 'svelte/compiler';
import { NewCommandTemplates as T, type ValidationProvider } from '../src/cli/commands/NewCommandTemplates.js';

type Element = AST.RegularElement | AST.Component;

function elements(value: unknown): Element[] {
  const found: Element[] = [];
  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if ('type' in node && (node.type === 'RegularElement' || node.type === 'Component')) {
      found.push(node as Element);
    }
    Object.values(node).forEach(visit);
  }
  visit(value);
  return found;
}

function attribute(node: Element, name: string): string {
  const value = node.attributes.find((item) => item.type === 'Attribute' && item.name === name);
  if (value?.type !== 'Attribute' || !Array.isArray(value.value)) return '';
  return value.value.filter((part) => part.type === 'Text').map((part) => part.data).join('');
}

function hasClasses(node: Element, ...classes: string[]): boolean {
  const tokens = attribute(node, 'class').split(/\s+/);
  return classes.every((name) => tokens.includes(name));
}

function markup(): Element[] {
  return elements(parse(T.adminPageSvelte(), { modern: true }).fragment);
}

describe('Default admin scaffold responsive bounds', () => {
  describe.each<ValidationProvider>(['zod', 'valibot'])('compiler contract (%s)', (provider) => {
    it.each(['client', 'server'] as const)('compiles the unchanged admin flows for %s', (generate) => {
      const result = compile(T.applyValidationProvider(T.adminPageSvelte(), provider), { generate, filename: 'admin-page.svelte' });
      expect(result.js.code.length).toBeGreaterThan(1000);
      expect(result.js.code).toContain('task.name');
      expect(result.js.code).toContain('runTask');
      expect(result.js.code).toContain('toggleTask');
    });
  });

  it('bounds the page and stacks its heading and refresh control on narrow screens without clipping', () => {
    const nodes = markup();
    const root = nodes.find((node) => hasClasses(node, 'space-y-8'))!;
    expect(hasClasses(root, 'min-w-0', 'max-w-full', '[overflow-wrap:anywhere]')).toBe(true);
    expect(hasClasses(root, 'overflow-hidden')).toBe(false);
    expect(nodes.some((node) => hasClasses(node, 'flex-col', 'sm:flex-row', 'sm:justify-between', 'items-start'))).toBe(true);
  });

  it('stacks scheduler details and wraps actions while retaining full dynamic task names', () => {
    const row = markup().find((node) => hasClasses(node, 'p-4', 'hover:bg-muted/50'))!;
    expect(hasClasses(row, 'min-w-0', 'flex-col', 'gap-4', 'sm:flex-row')).toBe(true);
    const children = elements(row.fragment);
    expect(children.some((node) => hasClasses(node, 'min-w-0', 'flex-1'))).toBe(true);
    expect(children.some((node) => hasClasses(node, 'min-w-0', 'flex-wrap', 'sm:justify-end'))).toBe(true);
    const name = children.find((node) => node.name === 'p' && hasClasses(node, 'font-medium', 'text-foreground'))!;
    expect(T.adminPageSvelte().slice(name.start, name.end)).toContain('{task.name}');
    expect(hasClasses(name, 'truncate', 'line-clamp-1')).toBe(false);
  });

  it('keeps wide users and permissions tables in their own bounded, keyboard-focusable scroll regions', () => {
    const nodes = markup();
    for (const [label, minimum] of [['User management table', 'min-w-[760px]'], ['Permissions table', 'min-w-[640px]']]) {
      const region = nodes.find((node) => attribute(node, 'aria-label') === label)!;
      expect(attribute(region, 'role')).toBe('region');
      expect(attribute(region, 'tabindex')).toBe('0');
      expect(hasClasses(region, 'min-w-0', 'w-full', 'max-w-full', 'overflow-x-auto')).toBe(true);
      const table = elements(region.fragment).find((node) => node.name === 'table')!;
      expect(hasClasses(table, 'w-full', minimum)).toBe(true);
    }
    expect(nodes.filter((node) => node.name === 'table')).toHaveLength(2);
  });

  it('wraps log filters, role/permission controls and create fields instead of imposing mobile minimum widths', () => {
    const nodes = markup();
    const filters = nodes.find((node) => node.name === 'div' && hasClasses(node, 'gap-2', 'mb-4'))!;
    expect(hasClasses(filters, 'flex-wrap')).toBe(true);
    const fields = nodes.filter((node) => hasClasses(node, 'basis-full'));
    expect(fields).toHaveLength(6);
    expect(fields.every((node) => hasClasses(node, 'min-w-0', 'flex-1'))).toBe(true);
    expect(nodes.some((node) => hasClasses(node, 'min-w-[200px]') || hasClasses(node, 'min-w-[140px]'))).toBe(false);
    expect(nodes.some((node) => node.name === 'button' && hasClasses(node, 'max-w-full', 'whitespace-normal', '[overflow-wrap:anywhere]'))).toBe(true);
    const log = nodes.find((node) => hasClasses(node, 'p-3', 'bg-muted/50', 'text-sm'))!;
    expect(hasClasses(log, 'min-w-0', 'flex-col', 'sm:flex-row')).toBe(true);
  });
});
