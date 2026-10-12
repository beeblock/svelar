import {
  chmodSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync,
  renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type * as TypeScript from 'typescript';
import type * as SvelteCompiler from 'svelte/compiler';

const ADAPTERS = 'sveltekit-superforms/adapters';
const ADAPTER_NAMES: Readonly<Record<string, string>> = { zod: 'zod4', zodClient: 'zod4Client' };
const VERSIONS: Readonly<Record<string, string>> = {
  zod: '^4.6.7',
  'sveltekit-superforms': '^2.31.0',
  'shadcn-svelte': '^1.7.0',
  'zod-v3-to-json-schema': '^4.0.0',
};
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.svelte']);
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules', '.git', '.svelte-kit', '.svelar', '.output', '.vercel', '.netlify',
  'dist', 'build', 'coverage',
]);

export interface Zod4MigrationEdit {
  readonly path: string;
  readonly original: Buffer;
  readonly updated: Buffer;
  readonly mode: number;
  readonly reasons: readonly string[];
}

export interface Zod4MigrationPlan {
  readonly root: string;
  readonly edits: readonly Zod4MigrationEdit[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly skipped?: string;
}

interface TextEdit { start: number; end: number; text: string }

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function projectModule<T>(root: string, id: string, prerequisite: string): Promise<T> {
  try {
    const require = createRequire(join(root, 'package.json'));
    // A variable URL keeps compiler packages out of the CLI bundle and resolves the app's installed version.
    const url = pathToFileURL(require.resolve(id)).href;
    const loaded: T & { default?: T } = await import(url);
    return loaded.default ?? loaded;
  } catch (error) {
    throw new Error(`Cannot load ${id} from this app. ${prerequisite}. (${message(error)})`);
  }
}

function applyTextEdits(content: string, edits: TextEdit[]): string {
  let updated = content;
  let boundary = content.length;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    if (edit.start < 0 || edit.end > boundary || edit.start > edit.end) {
      throw new Error('Overlapping or invalid migration edits; no files were written');
    }
    updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
    boundary = edit.start;
  }
  return updated;
}

function readUtf8(path: string): { original: Buffer; content: string; mode: number } {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular file, not a symlink');
  const original = readFileSync(path);
  const content = original.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(original)) throw new Error('File is not valid UTF-8; convert it manually first');
  return { original, content, mode: stat.mode & 0o777 };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function json(content: string): unknown {
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

function sourceEdits(
  ts: typeof TypeScript, content: string, filename: string, offset: number,
  errors: string[], warnings: Set<string>,
): TextEdit[] {
  const kind = filename.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(filename) ? ts.ScriptKind.JS
    : filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true, kind);
  const host = ts.createCompilerHost({ noLib: true, noResolve: true });
  host.getSourceFile = (name) => name === filename ? source : undefined;
  const program = ts.createProgram([filename], { noLib: true, noResolve: true }, host);
  const diagnostics = program.getSyntacticDiagnostics(source);
  if (diagnostics.length) {
    for (const diagnostic of diagnostics) {
      errors.push(`${filename}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}; fix syntax before migrating`);
    }
    return [];
  }
  const edits: TextEdit[] = [];
  const literal = (node: TypeScript.Node | undefined): string | undefined =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const fail = (node: TypeScript.Node, reason: string) => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    errors.push(`${filename}:${position.line + 1}: ${reason}; use named static adapter imports before migrating`);
  };
  const visit = (node: TypeScript.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const module = literal(node.moduleSpecifier);
      if (module === 'zod/v3' || module?.startsWith('zod/v3/')) {
        fail(node, 'Explicit Zod 3 schema import needs manual semantic migration');
      }
      if (module === ADAPTERS) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        if (clause?.name || (bindings && ts.isNamespaceImport(bindings))) {
          fail(node, 'Default/namespace Superforms adapter import is unsafe to rewrite');
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const specifier of bindings.elements) {
            const imported = specifier.propertyName ?? specifier.name;
            const replacement = ADAPTER_NAMES[imported.text];
            if (!replacement) continue;
            let text = specifier.propertyName ? replacement : `${replacement} as ${specifier.name.text}`;
            if (ts.isStringLiteral(imported)) {
              const quote = content[imported.getStart(source)];
              text = `${quote}${replacement}${quote}`;
            }
            edits.push({ start: offset + imported.getStart(source), end: offset + imported.end, text });
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && literal(node.moduleSpecifier) === ADAPTERS) {
      const clause = node.exportClause;
      if (!clause || !ts.isNamedExports(clause)
        || clause.elements.some((item) => ADAPTER_NAMES[(item.propertyName ?? item.name).text])) {
        fail(node, 'Superforms adapter re-export needs manual review');
      }
    } else if (ts.isCallExpression(node)) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const require = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (dynamic || require) {
        const target = literal(node.arguments[0]);
        if (target === ADAPTERS || target === undefined) {
          fail(node, target === ADAPTERS
            ? 'Dynamic/CommonJS Superforms adapter import is unsafe to rewrite'
            : 'Nonliteral module loading cannot be safely checked for legacy adapters; resolve it manually');
        }
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && literal(node.moduleReference.expression) === ADAPTERS) {
      fail(node, 'CommonJS Superforms adapter import is unsafe to rewrite');
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && literal(node.argument.literal) === ADAPTERS) {
      fail(node, 'Dynamic Superforms adapter type import needs manual review');
    }
    if (ts.isImportDeclaration(node) && literal(node.moduleSpecifier) === 'zod-to-json-schema') {
      warnings.add(`${filename}: zod-to-json-schema may require Zod 3 schemas; review conversion APIs manually (not rewritten)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edits;
}

function packageEdits(ts: typeof TypeScript, content: string, errors: string[], warnings: Set<string>): TextEdit[] {
  const parsed = json(content);
  if (!object(parsed)) throw new Error('package.json must be a JSON object');
  const source = ts.parseJsonText('package.json', content);
  const statement = source.statements[0];
  if (!statement || !ts.isExpressionStatement(statement) || !ts.isObjectLiteralExpression(statement.expression)) {
    throw new Error('Cannot parse package.json dependency tokens');
  }
  const edits: TextEdit[] = [];
  let hasZod = false;
  const visitDuplicates = (node: TypeScript.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue;
        if (names.has(property.name.text)) errors.push(`package.json: duplicate key ${property.name.text}; resolve it before migrating`);
        names.add(property.name.text);
      }
    }
    ts.forEachChild(node, visitDuplicates);
  };
  visitDuplicates(source);
  for (const property of statement.expression.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue;
    const section = property.name.text;
    if (['overrides', 'resolutions', 'pnpm'].includes(section)) {
      const configuration = parsed[section];
      if (JSON.stringify(configuration).includes('zod')) {
        errors.push(`package.json: ${section} contains a Zod override; align it manually before migrating`);
      }
    }
    if (!['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].includes(section)) continue;
    if (!ts.isObjectLiteralExpression(property.initializer)) {
      errors.push(`package.json: ${section} must be a dependency object`);
      continue;
    }
    for (const dependency of property.initializer.properties) {
      if (!ts.isPropertyAssignment(dependency) || !ts.isStringLiteral(dependency.name)) continue;
      const name = dependency.name.text;
      const target = VERSIONS[name];
      if (!target) continue;
      if (name === 'zod') hasZod = true;
      if (!ts.isStringLiteral(dependency.initializer)) {
        errors.push(`package.json: ${section}.${name} must be a registry version string`);
        continue;
      }
      const current = dependency.initializer.text;
      const match = /^[~^]?(\d+)\.(\d+)\.(\d+)$/.exec(current);
      if (!match) {
        errors.push(`package.json: ${section}.${name} uses unsupported version ${current}; select a registry version manually`);
        continue;
      }
      const minimum = target.slice(1).split('.').map(Number);
      const installed = match.slice(1).map(Number);
      const comparison = installed.findIndex((value, index) => value !== minimum[index]);
      if (comparison === -1 || installed[comparison] > minimum[comparison]) continue;
      edits.push({ start: dependency.initializer.getStart(source), end: dependency.initializer.end, text: JSON.stringify(target) });
    }
  }
  if (!hasZod) errors.push('package.json: root Zod dependency is missing; add zod@^4.6.7 before migrating');
  if (object(parsed.scripts) && Object.values(parsed.scripts).some((value) =>
    typeof value === 'string' && /(?:shadcn-svelte@|zod@|sveltekit-superforms@)/.test(value))) {
    warnings.add('package.json: review pinned UI/install scripts manually; customized scripts are preserved');
  }
  return edits;
}

export async function planZod4Migration(directory: string): Promise<Zod4MigrationPlan> {
  const root = realpathSync(directory);
  const errors: string[] = [];
  const warnings = new Set<string>([
    'Only adapter imports and selected dependency versions are migrated. Review Zod 4 semantic changes manually: error APIs, defaults, coercion, refinements, records and custom schema types.',
    'Use a Zod 4-compatible Svelar release, then run npm install, npm run check and your application tests. Lockfiles are not edited.',
  ]);
  const edits: Zod4MigrationEdit[] = [];
  const plan = (): Zod4MigrationPlan => ({ root, edits, errors, warnings: [...warnings] });
  try {
    const configPath = join(root, 'svelar.validation.json');
    if (existsSync(configPath)) {
      const config = json(readUtf8(configPath).content);
      if (!object(config) || !['zod', 'valibot'].includes(String(config.validation))) {
        throw new Error('svelar.validation.json: expected validation "zod" or "valibot"');
      }
      if (config.validation === 'valibot') return { ...plan(), skipped: 'Valibot project: no Zod migration or dependency changes applied' };
    }
    const ts = await projectModule<typeof TypeScript>(root, 'typescript', 'Install the compiler first: npm install -D typescript');
    let svelte: typeof SvelteCompiler | undefined;
    let scanned = 0;
    let bytes = 0;
    const add = (path: string, textEdits: (content: string) => TextEdit[], reasons: string[]): void => {
      try {
        const input = readUtf8(join(root, path));
        const updated = Buffer.from(applyTextEdits(input.content, textEdits(input.content)), 'utf8');
        if (!updated.equals(input.original)) edits.push({ path, original: input.original, mode: input.mode, updated, reasons });
      } catch (error) { errors.push(`${path}: ${message(error)}`); }
    };
    add('package.json', (content) => packageEdits(ts, content, errors, warnings), ['Align selected Zod/Superforms and optional shadcn dependencies']);
    const scan = async (directory: string): Promise<void> => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        const absolute = join(directory, entry.name);
        const path = relative(root, absolute);
        if (entry.isSymbolicLink()) {
          errors.push(`${path}: symlink encountered; exclude or replace it with an app-owned regular file before migrating`);
          continue;
        }
        if (entry.isDirectory()) { await scan(absolute); continue; }
        if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
        scanned++;
        bytes += lstatSync(absolute).size;
        if (scanned > 10000 || bytes > 64 * 1024 * 1024) throw new Error('Source scan limit exceeded (10,000 files / 64 MiB); narrow the project before migrating');
        try {
          const input = readUtf8(absolute);
          const ranges: TextEdit[] = [];
          if (extname(entry.name) === '.svelte') {
            svelte ??= await projectModule<typeof SvelteCompiler>(root, 'svelte/compiler', 'Install Svelte first: npm install -D svelte');
            const ast = svelte.parse(input.content, { filename: absolute, modern: true });
            for (const script of [ast.instance, ast.module]) {
              if (!script) continue;
              const content = script.content;
              if (!('start' in content) || !('end' in content)
                || typeof content.start !== 'number' || typeof content.end !== 'number') {
                throw new Error('Svelte compiler did not provide script spans');
              }
              const { start, end } = content;
              ranges.push(...sourceEdits(ts, input.content.slice(start, end), path, start, errors, warnings));
            }
          } else ranges.push(...sourceEdits(ts, input.content, path, 0, errors, warnings));
          const updated = Buffer.from(applyTextEdits(input.content, ranges), 'utf8');
          if (!updated.equals(input.original)) edits.push({ path, original: input.original, mode: input.mode, updated, reasons: ['Migrate named Superforms adapters, preserving local aliases'] });
        } catch (error) { errors.push(`${path}: ${message(error)}`); }
      }
    };
    await scan(root);
  } catch (error) { errors.push(message(error)); }
  return plan();
}

function checkedPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  if (absolute === root || !absolute.startsWith(`${root}${sep}`)) throw new Error(`Unsafe migration path: ${path}`);
  let current = absolute;
  while (current !== root) {
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlink changed after planning: ${path}`);
    current = dirname(current);
  }
  return absolute;
}

function atomicWrite(path: string, content: Buffer, mode: number): void {
  const temporary = `${path}.zod4-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function applyZod4Migration(plan: Zod4MigrationPlan, options: { confirmed: boolean }): string[] {
  if (!options.confirmed) throw new Error('Zod 4 migration requires --force or explicit interactive confirmation');
  if (plan.errors.length) throw new Error(`Migration preflight failed; no files written:\n${plan.errors.join('\n')}`);
  if (plan.skipped) return [];
  if (realpathSync(plan.root) !== plan.root) throw new Error('Project directory changed after planning');
  const seen = new Set<string>();
  for (const edit of plan.edits) {
    const path = checkedPath(plan.root, edit.path);
    if (seen.has(path)) throw new Error(`Duplicate migration path: ${edit.path}`);
    seen.add(path);
    if (!readFileSync(path).equals(edit.original)) throw new Error(`${edit.path} changed after planning; rerun --dry-run`);
  }
  const backups: string[] = [];
  const written: Zod4MigrationEdit[] = [];
  try {
    // Complete all exact-original backups before changing any app file.
    for (const edit of plan.edits) {
      const path = checkedPath(plan.root, edit.path);
      let suffix = 0;
      let backup: string;
      while (true) {
        backup = `${path}.zod4.bak${suffix ? `.${suffix}` : ''}`;
        try {
          writeFileSync(backup, edit.original, { flag: 'wx', mode: edit.mode });
          break;
        } catch (error) {
          if (object(error) && error.code === 'EEXIST') { suffix++; continue; }
          throw error;
        }
      }
      backups.push(relative(plan.root, backup));
    }
    for (const edit of plan.edits) {
      const path = checkedPath(plan.root, edit.path);
      if (!readFileSync(path).equals(edit.original)) throw new Error(`${edit.path} changed during migration; aborting`);
      atomicWrite(path, edit.updated, edit.mode);
      written.push(edit);
    }
  } catch (error) {
    const failures: string[] = [];
    for (const edit of written.reverse()) {
      try {
        const path = checkedPath(plan.root, edit.path);
        if (!readFileSync(path).equals(edit.updated)) throw new Error('File changed concurrently; restore from backup manually');
        atomicWrite(path, edit.original, edit.mode);
      } catch (rollback) { failures.push(`${edit.path}: ${message(rollback)}`); }
    }
    throw new Error(`Migration failed: ${message(error)}. Exact-original backups retained.${failures.length ? `\nRollback needs review:\n${failures.join('\n')}` : ''}`);
  }
  return backups;
}
