import {
  closeSync, constants, fchmodSync, linkSync, lstatSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as TypeScript from 'typescript';
import type * as SvelteCompiler from 'svelte/compiler';

type Ts = typeof TypeScript;
type Token = { start: number; end: number; text: string };
export const SVELTEKIT3_GUIDE_PATH = 'SVELTEKIT3-MIGRATION.md';
const GUIDE_MARKER = '<!-- svelar:sveltekit3-guide:';
const LOCK = '.svelar-sveltekit3-migration.lock';
const VERSIONS: Readonly<Record<string, string>> = {
  '@sveltejs/kit': '^3.4.0', svelte: '^5.59.1', typescript: '^6.0.3',
  vite: '^8.3.4', '@sveltejs/vite-plugin-svelte': '^7.3.1',
  'sveltekit-superforms': '^3.1.0', '@sveltejs/adapter-node': '^6.0.5', formsnap: '^2.1.0',
};
const OPTIONAL_PACKAGES = new Set(['sveltekit-superforms', '@sveltejs/adapter-node', 'formsnap']);
const NODE_RANGE = '^22.17.0 || ^24.0.0 || >=26.0.0';
const RUNED_OVERRIDE = 'runed@>=0.35.1 <0.38.0';
const RUNED_TARGET = '^0.38.0';
const UI_INSTALL_PREFIX = 'npm exec --package shadcn-svelte@latest -- shadcn-svelte add --all --yes && npm install --save-prod ';
const LEGACY_UI_PACKAGES = [
  ['@internationalized/date', '^3.12.4'], ['bits-ui', '^2.19.5'], ['embla-carousel-svelte', '^8.6.0'],
  ['formsnap', '^2.0.1'], ['layerchart', '^2.8.0'], ['mode-watcher', '^1.1.0'], ['paneforge', '^1.0.2'],
  ['svelte-sonner', '^1.2.1'], ['sveltekit-superforms', '^2.31.0'], ['tailwind-variants', '^3.3.1'],
  ['typebox', '^1.3.37'], ['vaul-svelte', '^1.0.0-next.7'], ['zod-v3-to-json-schema', '^4.0.0'],
] as const;
const LEGACY_UI_SCRIPT = UI_INSTALL_PREFIX + LEGACY_UI_PACKAGES.map(([name, range]) => `${name}@${range}`).join(' ');
const UPDATED_UI_SCRIPT = UI_INSTALL_PREFIX + LEGACY_UI_PACKAGES.map(([name, range]) =>
  `${name}@${name === 'formsnap' || name === 'sveltekit-superforms' ? VERSIONS[name] : range}`,
).join(' ') + ' && svelte-kit sync';
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.svelte']);
const EXCLUDED = new Set([
  'node_modules', '.git', '.svelte-kit', '.svelar', 'dist', 'build', 'coverage',
  'migrations', 'data', 'storage', 'uploads', '.output', '.vercel', '.netlify',
]);
const CONFIGS = ['js', 'ts', 'mjs', 'mts', 'cjs', 'cts'];

export interface SvelteKit3MigrationEdit {
  readonly path: string;
  /** Null means the file did not exist at preflight. */
  readonly original: Buffer | null;
  /** Null means removal of a positively recognized legacy config, after backup. */
  readonly updated: Buffer | null;
  readonly mode: number;
  readonly reasons: readonly string[];
}

export interface SvelteKit3MigrationPlan {
  readonly root: string;
  readonly edits: readonly SvelteKit3MigrationEdit[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly manualSteps: readonly string[];
  readonly guidePath: string;
  readonly guide: string;
  /** Applying file edits does not certify an app upgrade. */
  readonly requiresManual: true;
}

interface Snapshot {
  path: string;
  original: Buffer | null;
  mode: number;
  dev?: number;
  ino?: number;
}
interface DirectorySnapshot { path: string; dev: number; ino: number; entries: string[] }
interface Preflight {
  signature: string;
  files: Snapshot[];
  directories: DirectorySnapshot[];
  dev: number;
  ino: number;
}
// A plan is an in-process, reviewed snapshot, not a writable/serializable job specification.
const preflights = new WeakMap<SvelteKit3MigrationPlan, Preflight>();

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function checkedPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  if (!path || path.includes('\\') || absolute === root || !absolute.startsWith(`${root}${sep}`)
    || relative(root, absolute) !== path) throw new Error(`Unsafe migration path: ${path}`);
  let current = absolute;
  while (current !== root) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error(`${path}: symlinks are not supported`);
    if (current !== absolute && stat && !stat.isDirectory()) throw new Error(`${path}: parent is not a directory`);
    current = dirname(current);
  }
  return absolute;
}
function snapshot(root: string, path: string): Snapshot {
  const absolute = checkedPath(root, path);
  const stat = lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat) return { path, original: null, mode: 0o644 };
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(`${path}: expected an app-owned regular file with one link`);
  if (stat.size > 8 * 1024 * 1024) throw new Error(`${path}: file exceeds the 8 MiB migration limit`);
  const original = readFileSync(absolute);
  if (!Buffer.from(original.toString('utf8')).equals(original)) throw new Error(`${path}: invalid UTF-8`);
  return { path, original, mode: stat.mode & 0o777, dev: stat.dev, ino: stat.ino };
}
function checkSnapshot(root: string, expected: Snapshot): void {
  const current = snapshot(root, expected.path);
  if (current.mode !== expected.mode || current.dev !== expected.dev || current.ino !== expected.ino
    || (expected.original === null ? current.original !== null : !current.original?.equals(expected.original))) {
    throw new Error(`${expected.path} changed after planning; rerun --dry-run`);
  }
}
function applyTokens(content: string, tokens: Token[]): string {
  let boundary = content.length;
  for (const token of tokens.sort((a, b) => b.start - a.start || b.end - a.end)) {
    if (token.start < 0 || token.end > boundary || token.start > token.end) throw new Error('Overlapping migration tokens');
    content = content.slice(0, token.start) + token.text + content.slice(token.end);
    boundary = token.start;
  }
  return content;
}
async function compiler<T>(root: string, id: string): Promise<T> {
  try {
    const url = pathToFileURL(createRequire(join(root, 'package.json')).resolve(id)).href;
    const loaded: T & { default?: T } = await import(url);
    return loaded.default ?? loaded;
  } catch (error) { throw new Error(`Cannot load app-local ${id}; install the app's compiler before planning (${message(error)})`); }
}
function parse(ts: Ts, path: string, content: string): TypeScript.SourceFile {
  const extension = extname(path);
  const kind = extension === '.jsx' ? ts.ScriptKind.JSX : extension === '.tsx' ? ts.ScriptKind.TSX
    : ['.js', '.mjs', '.cjs'].includes(extension) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const host = ts.createCompilerHost({ noLib: true, noResolve: true });
  host.getSourceFile = (name) => name === path ? source : undefined;
  const errors = ts.createProgram([path], { noLib: true, noResolve: true }, host).getSyntacticDiagnostics(source);
  if (errors.length) throw new Error(`${path}: ${ts.flattenDiagnosticMessageText(errors[0].messageText, ' ')}`);
  return source;
}
function properties(ts: Ts, node: TypeScript.ObjectLiteralExpression): Map<string, TypeScript.PropertyAssignment> {
  const result = new Map<string, TypeScript.PropertyAssignment>();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) {
      throw new Error('Computed properties, spreads, methods and shorthand configuration require manual migration');
    }
    const key = property.name.text;
    if (result.has(key)) throw new Error(`Duplicate key ${key}`);
    result.set(key, property);
  }
  return result;
}
function jsonSource(ts: Ts, path: string, content: string, comments = false): {
  source: TypeScript.JsonSourceFile; node: TypeScript.ObjectLiteralExpression; value: Record<string, unknown>;
} {
  const value: unknown = comments ? ts.parseConfigFileTextToJson(path, content).config : JSON.parse(content.replace(/^\uFEFF/, ''));
  if (!object(value)) throw new Error(`${path}: expected a JSON object`);
  const source = ts.parseJsonText(path, content);
  const statement = source.statements[0];
  if (!statement || !ts.isExpressionStatement(statement) || !ts.isObjectLiteralExpression(statement.expression)) {
    throw new Error(`${path}: expected a JSON object`);
  }
  const visit = (node: TypeScript.Node): void => {
    if (ts.isObjectLiteralExpression(node)) properties(ts, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (comments) {
    const result = ts.parseConfigFileTextToJson(path, content);
    if (result.error) throw new Error(`${path}: ${ts.flattenDiagnosticMessageText(result.error.messageText, ' ')}`);
  }
  return { source, node: statement.expression, value };
}
function addProperties(source: TypeScript.SourceFile, node: TypeScript.ObjectLiteralExpression, values: Record<string, unknown>, tokens: Token[], remaining = node.properties.length): void {
  const entries = Object.entries(values);
  if (!entries.length) return;
  tokens.push({ start: node.getStart(source) + 1, end: node.getStart(source) + 1,
    text: `\n${entries.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')}${remaining ? ',' : ''}\n` });
}
function version(value: string): number[] | undefined {
  const match = /^[~^]?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : undefined;
}
function older(current: number[], minimum: number[]): boolean {
  const index = current.findIndex((value, i) => value !== minimum[i]);
  return index !== -1 && current[index] < minimum[index];
}

function removeProperties(
  ts: Ts, source: TypeScript.SourceFile, node: TypeScript.ObjectLiteralExpression,
  removed: ReadonlySet<TypeScript.PropertyAssignment>, tokens: Token[],
): void {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source.text);
  const commas = new Set<number>();
  for (let index = 0; index < node.properties.length; index++) {
    const property = node.properties[index];
    if (!ts.isPropertyAssignment(property) || !removed.has(property)) continue;
    tokens.push({ start: property.getStart(source), end: property.end, text: '' });
    if (index < node.properties.length - 1) commas.add(index);
    else {
      let first = index;
      while (first > 0 && removed.has(node.properties[first - 1] as TypeScript.PropertyAssignment)) first--;
      if (first > 0) commas.add(first - 1);
    }
  }
  for (const index of commas) {
    scanner.setTextPos(node.properties[index].end);
    if (scanner.scan() !== ts.SyntaxKind.CommaToken) throw new Error('Cannot safely locate override property separator');
    tokens.push({ start: scanner.getTokenPos(), end: scanner.getTextPos(), text: '' });
  }
}

function needsRunedCompatibility(metadata: Record<string, unknown>): boolean {
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some((section) => {
    const dependencies = metadata[section];
    if (!object(dependencies)) return false;
    if (['bits-ui', '@shadcn-svelte/primitives', 'svelte-toolbelt'].some((name) => Object.hasOwn(dependencies, name))) return true;
    const current = typeof dependencies.runed === 'string' ? version(dependencies.runed) : undefined;
    return !!current && !older(current, [0, 35, 1]) && older(current, [0, 38, 0]);
  });
}

function overrideTokens(ts: Ts, source: TypeScript.SourceFile, node: TypeScript.ObjectLiteralExpression, tokens: Token[], needsRuned: boolean): boolean {
  const constrained = [...Object.keys(VERSIONS), 'cookie', 'runed'];
  let hasOverrides = false;
  for (const [section, property] of properties(ts, node)) {
    if (!['overrides', 'resolutions', 'pnpm'].includes(section)) continue;
    if (section !== 'overrides') {
      if (constrained.some((name) => property.initializer.getText(source).includes(name))) {
        throw new Error(`package.json: ${section} constrains the migration toolchain; align it manually before migrating`);
      }
      continue;
    }
    if (!ts.isObjectLiteralExpression(property.initializer)) throw new Error('package.json: overrides must be an object');
    hasOverrides = true;
    let hasRuned = false;
    const removed = new Set<TypeScript.PropertyAssignment>();
    for (const [name, override] of properties(ts, property.initializer)) {
      if (name === RUNED_OVERRIDE && ts.isStringLiteral(override.initializer) && override.initializer.text === RUNED_TARGET) {
        hasRuned = true;
        continue;
      }
      if (['@sveltejs/kit', '@sveltejs/kit@^2'].includes(name) && ts.isObjectLiteralExpression(override.initializer)) {
        const values = properties(ts, override.initializer);
        const cookie = values.get('cookie')?.initializer;
        if (values.size === 1 && cookie && ts.isStringLiteral(cookie) && cookie.text === '^0.7.2') {
          removed.add(override);
          continue;
        }
      }
      if (constrained.some((target) => override.getText(source).includes(target))) {
        throw new Error(`package.json: custom overrides[${JSON.stringify(name)}] constrains the migration toolchain; align it manually before migrating`);
      }
    }
    removeProperties(ts, source, property.initializer, removed, tokens);
    if (needsRuned && !hasRuned) {
      // Cookie-only objects become empty: the inserted property must not leave a trailing comma.
      addProperties(source, property.initializer, { [RUNED_OVERRIDE]: RUNED_TARGET }, tokens,
        property.initializer.properties.length - removed.size);
    }
  }
  return needsRuned && !hasOverrides;
}

function packageTokens(ts: Ts, content: string): Token[] {
  const { source, node, value } = jsonSource(ts, 'package.json', content);
  const tokens: Token[] = [];
  const root = properties(ts, node);
  const additions: Record<string, unknown> = {};
  if (overrideTokens(ts, source, node, tokens, needsRunedCompatibility(value))) {
    additions.overrides = { [RUNED_OVERRIDE]: RUNED_TARGET };
  }
  const scripts = root.get('scripts')?.initializer;
  if (scripts && ts.isObjectLiteralExpression(scripts)) {
    const ui = properties(ts, scripts).get('ui:install')?.initializer;
    if (ui && ts.isStringLiteral(ui) && ui.text === LEGACY_UI_SCRIPT) {
      tokens.push({ start: ui.getStart(source), end: ui.end, text: JSON.stringify(UPDATED_UI_SCRIPT) });
    }
  }
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  const hasSuperforms = sections.some((section) => object(value[section]) && Object.hasOwn(value[section], 'sveltekit-superforms'));
  const found = new Set<string>();
  for (const section of sections) {
    const property = root.get(section);
    if (!property) continue;
    if (!ts.isObjectLiteralExpression(property.initializer)) throw new Error(`package.json: ${section} must be an object`);
    for (const [name, dependency] of properties(ts, property.initializer)) {
      const target = VERSIONS[name];
      if (!target || (name === 'formsnap' && !hasSuperforms)) continue;
      found.add(name);
      if (!ts.isStringLiteral(dependency.initializer)) throw new Error(`package.json: ${name} needs a registry version string`);
      const current = version(dependency.initializer.text);
      if (!current) throw new Error(`package.json: unsupported version ${name}@${dependency.initializer.text}; select a registry version manually`);
      if (older(current, version(target)!)) tokens.push({ start: dependency.initializer.getStart(source), end: dependency.initializer.end, text: JSON.stringify(target) });
    }
  }
  if (!found.has('@sveltejs/kit')) throw new Error('package.json: no @sveltejs/kit dependency; this is not a recognized SvelteKit app');
  const missing = Object.fromEntries(Object.entries(VERSIONS).filter(([name]) => !found.has(name) && !OPTIONAL_PACKAGES.has(name)));
  const dev = root.get('devDependencies')?.initializer;
  if (Object.keys(missing).length) {
    if (dev && ts.isObjectLiteralExpression(dev)) addProperties(source, dev, missing, tokens);
    else additions.devDependencies = missing;
  }
  const imports = root.get('imports')?.initializer;
  const nativeImports = { '#lib': './src/lib/index.js', '#lib/*': './src/lib/*' };
  if (imports) {
    if (!ts.isObjectLiteralExpression(imports)) throw new Error('package.json: imports must be an object');
    const existing = properties(ts, imports);
    const missingImports: Record<string, unknown> = {};
    for (const [key, target] of Object.entries(nativeImports)) {
      const property = existing.get(key);
      if (!property) missingImports[key] = target;
      else if (!ts.isStringLiteral(property.initializer) || property.initializer.text !== target) {
        throw new Error(`package.json: conflicting imports[${JSON.stringify(key)}]; preserve and reconcile it manually`);
      }
    }
    addProperties(source, imports, missingImports, tokens);
  } else additions.imports = nativeImports;
  const engines = root.get('engines')?.initializer;
  if (!engines) additions.engines = { node: '>=22.17.0' };
  else {
    if (!ts.isObjectLiteralExpression(engines)) throw new Error('package.json: engines must be an object');
    const engine = properties(ts, engines).get('node');
    if (!engine) addProperties(source, engines, { node: '>=22.17.0' }, tokens);
    else {
      if (!ts.isStringLiteral(engine.initializer)) throw new Error('package.json: engines.node must be a version range');
      if (engine.initializer.text === '^22.12.0 || >=24.0.0') {
        tokens.push({ start: engine.initializer.getStart(source), end: engine.initializer.end, text: JSON.stringify(NODE_RANGE) });
      } else if (engine.initializer.text !== NODE_RANGE) {
        const minimum = /^>=(\d+)\.(\d+)(?:\.(\d+))?$/.exec(engine.initializer.text);
        if (!minimum) throw new Error('package.json: customized engines.node range; reconcile the Node >=22.17.0 requirement manually');
        if (older([Number(minimum[1]), Number(minimum[2]), Number(minimum[3] ?? 0)], [22, 17, 0])) {
          tokens.push({ start: engine.initializer.getStart(source), end: engine.initializer.end, text: JSON.stringify('>=22.17.0') });
        }
      }
    }
  }
  addProperties(source, node, additions, tokens);
  return tokens;
}

/** Only the simple historical Svelar scaffold is removed; custom configs remain intact. */
function legacyConfig(ts: Ts, source: TypeScript.SourceFile): { adapter: string } | undefined {
  try {
    let adapter: string | undefined;
    let adapterName: string | undefined;
    let preprocessName: string | undefined;
    let config: TypeScript.ObjectLiteralExpression | undefined;
    let configName: string | undefined;
    let exported: TypeScript.Expression | undefined;
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        if (statement.attributes) return;
        const clause = statement.importClause;
        if (['@sveltejs/adapter-node', '@sveltejs/adapter-auto', '@sveltejs/adapter-static'].includes(statement.moduleSpecifier.text)
          && clause?.name && !clause.namedBindings && !clause.isTypeOnly && !adapter) {
          adapter = statement.moduleSpecifier.text;
          adapterName = clause.name.text;
        } else if (statement.moduleSpecifier.text === '@sveltejs/vite-plugin-svelte' && !clause?.name && !clause?.isTypeOnly
          && clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length === 1) {
          const binding = clause.namedBindings.elements[0];
          if ((binding.propertyName ?? binding.name).text !== 'vitePreprocess' || binding.isTypeOnly || preprocessName) return;
          preprocessName = binding.name.text;
        } else return;
      } else if (ts.isVariableStatement(statement) && !statement.modifiers?.length
        && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 && statement.declarationList.declarations.length === 1) {
        const declaration = statement.declarationList.declarations[0];
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer) || config) return;
        config = declaration.initializer;
        configName = declaration.name.text;
      } else if (ts.isExportAssignment(statement) && !statement.isExportEquals && !exported) exported = statement.expression;
      else return;
    }
    if (!adapter || !adapterName || !preprocessName || !config || !exported
      || !ts.isIdentifier(exported) || exported.text !== configName) return;
    if (new Set([adapterName, preprocessName, configName]).size !== 3) return;
    const noArgCall = (node: TypeScript.Expression | undefined, name: string): boolean =>
      !!node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name && node.arguments.length === 0;
    const top = properties(ts, config);
    if (top.size !== 2 || !noArgCall(top.get('preprocess')?.initializer, preprocessName)) return;
    const kit = top.get('kit')?.initializer;
    if (!kit || !ts.isObjectLiteralExpression(kit)) return;
    const options = properties(ts, kit);
    if ([...options.keys()].some((key) => !['adapter', 'alias'].includes(key)) || !noArgCall(options.get('adapter')?.initializer, adapterName)) return;
    const alias = options.get('alias')?.initializer;
    if (alias) {
      if (!ts.isObjectLiteralExpression(alias)) return;
      const aliases = properties(ts, alias);
      if (aliases.size !== 2) return;
      for (const [name, target] of [['$lib', 'src/lib'], ['$lib/*', 'src/lib/*']]) {
        const value = aliases.get(name)?.initializer;
        if (!value || !ts.isStringLiteral(value) || value.text !== target) return;
      }
    }
    return { adapter };
  } catch { return; }
}
function viteTokens(ts: Ts, source: TypeScript.SourceFile, adapter: string): Token[] | undefined {
  let binding: string | undefined;
  let defineConfig: string | undefined;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
    const imports = statement.importClause?.namedBindings;
    if (!imports || !ts.isNamedImports(imports)) continue;
    for (const item of imports.elements) {
      if (item.isTypeOnly) continue;
      if (statement.moduleSpecifier.text === '@sveltejs/kit/vite' && (item.propertyName ?? item.name).text === 'sveltekit') {
        if (binding) return;
        binding = item.name.text;
      }
      if (statement.moduleSpecifier.text === 'vite' && (item.propertyName ?? item.name).text === 'defineConfig') defineConfig = item.name.text;
    }
  }
  if (!binding || !defineConfig) return;
  const identifiers: TypeScript.Identifier[] = [];
  const walk = (node: TypeScript.Node): void => { if (ts.isIdentifier(node)) identifiers.push(node); ts.forEachChild(node, walk); };
  walk(source);
  // Import plus a single unshadowed call. No other references or user wrappers are accepted.
  const references = identifiers.filter((node) => node.text === binding);
  if (references.length !== 2) return;
  const callee = references.find((node) => ts.isCallExpression(node.parent) && node.parent.expression === node);
  if (!callee || !ts.isCallExpression(callee.parent) || callee.parent.arguments.length) return;
  const call = callee.parent;
  const array = call.parent;
  if (!ts.isArrayLiteralExpression(array) || !ts.isPropertyAssignment(array.parent)
    || array.parent.name.getText(source) !== 'plugins' || !ts.isObjectLiteralExpression(array.parent.parent)) return;
  const config = array.parent.parent;
  try {
    if (properties(ts, config).get('plugins') !== array.parent) return;
  } catch { return; }
  const exported = source.statements.find((node) => ts.isExportAssignment(node) && !node.isExportEquals);
  if (!exported || !ts.isExportAssignment(exported) || !ts.isCallExpression(exported.expression)
    || !ts.isIdentifier(exported.expression.expression) || exported.expression.expression.text !== defineConfig
    || exported.expression.arguments.length !== 1) return;
  if (identifiers.filter((node) => node.text === defineConfig).length !== 2) return;
  const argument = exported.expression.arguments[0];
  if (argument !== config) {
    if (!ts.isArrowFunction(argument)) return;
    if (argument.body !== config && !(ts.isBlock(argument.body)
      && argument.body.statements.filter(ts.isReturnStatement).length === 1
      && argument.body.statements.some((node) => ts.isReturnStatement(node) && node.expression === config))) return;
  }
  const names = new Set(identifiers.map((node) => node.text));
  const unique = (name: string): string => { while (names.has(name)) name += '_'; names.add(name); return name; };
  const adapterName = unique('svelarKit3Adapter');
  const preprocess = unique('svelarKit3Preprocess');
  const offset = source.text.charCodeAt(0) === 0xfeff ? 1 : 0;
  return [
    { start: offset, end: offset, text: `import ${adapterName} from ${JSON.stringify(adapter)};\nimport { vitePreprocess as ${preprocess} } from '@sveltejs/vite-plugin-svelte';\n` },
    { start: call.arguments.pos, end: call.arguments.end,
      text: `{ adapter: ${adapterName}(), preprocess: ${preprocess}(), alias: { '$lib': 'src/lib', '$lib/*': 'src/lib/*' } }` },
  ];
}

function cssSsrTokens(ts: Ts, source: TypeScript.SourceFile): Token[] {
  let defineConfig: string | undefined;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== 'vite' || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      if (item.isTypeOnly || (item.propertyName ?? item.name).text !== 'defineConfig') continue;
      if (defineConfig) throw new Error('ambiguous defineConfig imports');
      defineConfig = item.name.text;
    }
  }
  const fail = (): never => { throw new Error('expected an unshadowed defineConfig with one static returned config object'); };
  if (!defineConfig) return fail();
  let references = 0;
  const count = (node: TypeScript.Node): void => {
    if (ts.isIdentifier(node) && node.text === defineConfig) references++;
    ts.forEachChild(node, count);
  };
  count(source);
  const exported = source.statements.filter(ts.isExportAssignment);
  if (references !== 2 || exported.length !== 1 || exported[0].isExportEquals) return fail();
  const call = exported[0].expression;
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)
    || call.expression.text !== defineConfig || call.arguments.length !== 1) return fail();
  let config: TypeScript.Node = call.arguments[0];
  if (ts.isArrowFunction(config)) {
    if (ts.isBlock(config.body)) {
      const returns: TypeScript.ReturnStatement[] = [];
      const visit = (node: TypeScript.Node): void => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node)) returns.push(node);
        ts.forEachChild(node, visit);
      };
      visit(config.body);
      if (returns.length !== 1 || !returns[0].expression || returns[0].parent !== config.body) return fail();
      config = returns[0].expression;
    } else config = config.body;
  }
  if (!ts.isObjectLiteralExpression(config)) return fail();
  const tokens: Token[] = [];
  const ssr = properties(ts, config).get('ssr')?.initializer;
  if (!ssr) {
    addProperties(source, config, { ssr: { noExternal: ['tw-animate-css'] } }, tokens);
    return tokens;
  }
  if (!ts.isObjectLiteralExpression(ssr)) throw new Error('ssr is customized, not a static object');
  const noExternal = properties(ts, ssr).get('noExternal')?.initializer;
  if (!noExternal) {
    addProperties(source, ssr, { noExternal: ['tw-animate-css'] }, tokens);
    return tokens;
  }
  if (noExternal.kind === ts.SyntaxKind.TrueKeyword) return [];
  if (!ts.isArrayLiteralExpression(noExternal)
    || !noExternal.elements.every((item) => ts.isStringLiteral(item) || ts.isNoSubstitutionTemplateLiteral(item))) {
    throw new Error('ssr.noExternal is customized, not true or a static string array');
  }
  if (noExternal.elements.some((item) => (ts.isStringLiteral(item) || ts.isNoSubstitutionTemplateLiteral(item)) && item.text === 'tw-animate-css')) return [];
  const last = noExternal.elements.at(-1);
  const position = last ? last.end : noExternal.getStart(source) + 1;
  return [{ start: position, end: position, text: `${last ? ', ' : ''}${JSON.stringify('tw-animate-css')}` }];
}

function guide(manualSteps: readonly string[]): string {
  const body = `# SvelteKit 3 Existing-App Migration\n\nStatus: file migration only. Upgrade is NOT complete or certified.\n\n## Scope And Preservation\n\nOnly recognized scaffold config, selected dependency/JSON tokens and static $app/environment module specifiers are changed. Custom code, .env files, data, migrations, validation provider, app bootstrap and lockfiles are preserved. $lib imports remain supported by explicit plugin aliases; no mass rename is performed. Existing Kit 2 apps may stay on Kit 2 with a compatible Svelar release.\n\n## Human And AI Checklist\n\n1. Review a private working copy and independent backups. Do not publish, install, invoke migrators or run destructive database commands without the app owner's approval. Never paste .env contents into a report.\n2. Use Node >=22.17.0 everywhere (local, CI, containers and workers) and the approved migration targets: Kit ${VERSIONS['@sveltejs/kit']}, TypeScript ${VERSIONS.typescript}, Svelte ${VERSIONS.svelte}, Vite ${VERSIONS.vite}, @sveltejs/vite-plugin-svelte ${VERSIONS['@sveltejs/vite-plugin-svelte']} and Superforms ${VERSIONS['sveltekit-superforms']} when installed. These targets are stricter than official minimums; minimum compatibility alone is not a security recommendation. Review adapter and other plugin peer compatibility. Svelar's package version is not changed by this migration.\n3. Preview with npx svelar update --migrate-sveltekit3 --dry-run. Approve only the displayed plan using --migrate-sveltekit3 --force or interactive confirmation. --force never authorizes replacing unknown configs or bypassing safety checks. --list is also read-only.\n4. For unsupported/custom configuration and remaining source changes, review the official guide and explicitly run npx sv migrate sveltekit-3 in the working copy. Svelar NEVER executes this command. Prefer upgrading to the latest Kit 2 first for deprecation warnings. Resolve every migrator task and review its diff; do not assume it covers custom code.\n5. Move remaining svelte.config settings into the sveltekit({...}) Vite plugin without losing adapter options, preprocessors, aliases, CSP, paths, environment or security settings. Remove the legacy config only after verifying that move and retaining its backup. Keep CSRF, auth, policies and validation enabled; csrf.checkOrigin becomes reviewed csrf.trustedOrigins, not a disabled check.\n6. Keep explicit alias: { '$lib': 'src/lib', '$lib/*': 'src/lib/*' } for existing imports. Optional native imports use package.json imports: { '#lib': './src/lib/index.js', '#lib/*': './src/lib/*' }. A deliberate $lib -> #lib migration needs real file extensions (.ts/.js/.svelte) and directory-index resolution. Preserve custom library roots and imports maps; never rename by regex.\n7. Review $app/environment -> $app/env, removed $app/stores -> $app/state (including $page reads/reactivity), $service-worker -> $app/env/$app/manifest, deprecated $env modules, $app/forms cross-page enhancement, $app/navigation goto options/shallow hooks/refreshAll/preloadData errors, and $app/paths asset/resolve changes.\n8. Review relocated hook types in @sveltejs/kit/hooks, environment types in @sveltejs/kit/env, parameter types in @sveltejs/kit/params and remote types in $app/server; also App.Error status, error/redirect semantics, cookies, and custom Node servers. Superforms 3 must use the existing Zod/Valibot provider and shared schema/FormRequest/DTO contracts. Do not silently convert validation providers or Zod majors.\n9. Extend $app/tsconfig with explicit include/exclude arrays. Preserve custom compiler options. Service workers require a separate project extending $app/tsconfig/service-worker and exclusion from the root project. Review aliases in tests, scripts, other configs and historical migrations, which are not rewritten.\n10. After approval, install with the app's existing package manager and review the new lockfile. Run its type checks, focused tests, production adapter build and browser login, forms, authorization/CSRF, navigation and background-runtime checks. Record actual outcomes; manual items and failed checks mean NOT complete.\n\n## Remaining Manual Review\n\n${manualSteps.map((step) => `- [ ] ${step}`).join('\n')}\n\n## Recovery\n\nEvery changed/removed existing file has an exact-byte adjacent .sveltekit3.bak backup (numbered if an older regular backup exists), with original permissions. No backup is overwritten. Added files have no prior version. On failure, unchanged migration outputs are rolled back; concurrently modified files are left for manual recovery. Stop other writers, inspect the reported backup paths and restore only reviewed files. Never overwrite newer app work. This command is idempotent on unchanged inputs and does not install packages or execute app config.\n\n## References\n\n- [Official SvelteKit 3 migration](https://svelte.dev/docs/kit/migrating-to-sveltekit-3)\n- [Superforms 3 release](https://github.com/ciscoheat/sveltekit-superforms/releases/tag/v3.0.0)\n`;
  const baseline = '\n## Published 0.8 Baseline Notes\n\nThe recognized ^22.12.0 || >=24.0.0 engine range becomes ^22.17.0 || ^24.0.0 || >=26.0.0. Existing adapter-node is aligned to >=6.0.5; formsnap is aligned to >=2.1.0 when Superforms is installed. Only an exact npm Kit override containing cookie: ^0.7.2 alone is removed; unrelated overrides remain byte-preserved and custom toolchain constraints block writes. Explicit static compilerOptions.types lists retain their entries and gain $app/types once. Only the exact published 0.8 ui:install script is migrated: its formsnap/Superforms pins are aligned to the approved targets and a final svelte-kit sync restores generated node_modules/$app files after nested npm installation. Customized scripts remain untouched and require manual review of pins and final sync before use. These file changes do not update the Svelar package version, execute scripts, install dependencies or complete application API migration.\n';
  const approved = `\n## Approved Migration Targets\n\nThese approved/tested lower bounds are deliberately stricter than the official minimum requirements:\n\n${Object.entries(VERSIONS).map(([name, target]) => `- ${name}: ${target}`).join('\n')}\n\nOlder same-major versions are raised to these targets; the Vite target excludes older 8.0.x versions rather than assuming all Vite 8 releases are safe. This is not a blanket security guarantee. Lockfiles are preserved until the owner approves installation; then resolve a lockfile consistent with these ranges, inspect the installed versions and review current security advisories before release. Optional integration packages are not added when absent.\n`;
  const kit2 = '\n## Staying On Kit 2\n\nA compatible Svelar core update does not require a SvelteKit major upgrade. To add newly shipped core schema migrations, review npx svelar update --category=migration --dry-run, then explicitly approve npx svelar update --category=migration --force. This focused Kit 2 path adds only missing framework-owned migrations; it preserves all existing migration history, user migrations, application source, configuration and package/lockfile versions. It does not execute database migrations. Review and run the app\'s normal migration workflow separately. Do not combine this exception with --include-user-files or --add-missing-user-files; routes, pages and missing config additions remain blocked for writes until an explicitly reviewed major migration. Ordinary --list/--dry-run diagnostics remain available.\n';
  const content = body + baseline + approved + kit2;
  return `${GUIDE_MARKER}${createHash('sha256').update(content).digest('hex')} -->\n${content}`;
}
function generatedGuide(content: string): boolean {
  const end = content.indexOf('\n');
  if (end < 0 || !content.startsWith(GUIDE_MARKER)) return false;
  const body = content.slice(end + 1);
  return content.slice(0, end) === `${GUIDE_MARKER}${createHash('sha256').update(body).digest('hex')} -->`;
}
function signature(plan: SvelteKit3MigrationPlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

export async function planSvelteKit3Migration(directory: string): Promise<SvelteKit3MigrationPlan> {
  if (lstatSync(resolve(directory)).isSymbolicLink()) throw new Error('Project root must not be a symlink');
  const root = realpathSync(directory);
  const rootStat = lstatSync(root);
  const files = new Map<string, Snapshot>();
  const directories: DirectorySnapshot[] = [];
  const edits: SvelteKit3MigrationEdit[] = [];
  const errors: string[] = [];
  const manual = new Set<string>([
    'Review source/API semantics and Superforms 3 compatibility using the checklist above; no test/build success is implied.',
    'Review custom configs, scripts, deployment Node versions, service workers and historical migrations manually.',
    'Review custom Superforms 3 SPA handlers using validateForm({ update: true }): deferred first-error focus may run after validation resolves and steal focus during fast corrections. Existing handlers are not codemodded. Use the public per-call focusOnError: false option where needed, await rendered inline errors and input unlock, then focus the first invalid field predictably. Test fast corrections and keyboard navigation; keep shared schemas, validation and inline errors enabled rather than disabling validation to avoid focus changes.',
    'npm only: after approving the package.json major-version edits, an old adapter-node 5 / Superforms 2 lockfile and installed dependency tree may cause ERESOLVE. With explicit owner approval, stop app processes and preserve the exact old package-lock.json plus the whole app-owned node_modules tree by renaming both into a private backup directory outside the app; then run normal npm install to resolve a fresh graph. Retain those backups for reviewed rollback. NEVER use --force or --legacy-peer-deps, delete user data, or move/delete shared package stores or borrowed dependency trees. Other package managers require their own reviewed procedure. The CLI never installs packages or performs this recovery automatically.',
    'Review existing URL/query helpers after migration: Kit 3 page.url is read-only. Helpers that only read may use a structural ReadableUrl type with readonly href: string and readonly searchParams exposing get(name: string): string | null. Clone mutable URLs with new URL(page.url.href), not new URL(page.url), before changing query parameters. Preserve custom helper behavior and review callers manually; custom URL source is not codemodded.',
    "Vitest: preserve and manually update the old Kit 2 vitest.config. Import sveltekit from @sveltejs/kit/vite and vitePreprocess from @sveltejs/vite-plugin-svelte; configure plugins with sveltekit({ preprocess: vitePreprocess(), alias: { '$lib': 'src/lib', '$lib/*': 'src/lib/*' } }). Include 'sveltekit-superforms' in test.server.deps.inline while retaining existing inline dependencies and test settings, so Superforms 3 resolves the real $app/server side-effect marker through the Kit plugin. Do not alias or mock $app/server with an empty shim. Run the real app tests only after owner approval; this configuration change is not automated or certified.",
  ]);
  const warnings = [
    'Opt-in SvelteKit 3 migration only; no template refresh, install, official migrator, database changes or compatibility certification.',
    'Explicit $lib plugin aliases preserve existing app imports. Native #lib imports are optional and require file extensions.',
    'Unrecognized configs remain intact. Complete the generated guide and official migrator review before claiming an upgrade.',
    'Dependencies use approved/tested target ranges, not just the official minimums. Older same-major versions may change; review the resolved lockfile and current security advisories after approved installation.',
  ];
  const read = (path: string): Snapshot => {
    if (!files.has(path)) files.set(path, snapshot(root, path));
    return files.get(path)!;
  };
  const edit = (path: string, updated: Buffer | null, reasons: string[]): void => {
    const input = read(path);
    if (input.original === null ? updated === null : updated !== null && input.original.equals(updated)) return;
    edits.push({ path, original: input.original, updated, mode: input.mode, reasons });
  };
  try {
    const ts = await compiler<Ts>(root, 'typescript');
    const pkg = read('package.json');
    if (!pkg.original) throw new Error('package.json is required');
    const metadata = jsonSource(ts, 'package.json', pkg.original.toString('utf8')).value;
    if (needsRunedCompatibility(metadata)) {
      manual.add(`Reviewed UI compatibility constraint: npm overrides[${JSON.stringify(RUNED_OVERRIDE)}] = ${JSON.stringify(RUNED_TARGET)} targets only the reviewed Runed range, not 0.25 or a global Runed replacement. Verify the resolved UI peer graph and review any runed/kit imports before release; customized override/resolution policies block this migration.`);
    }
    if (object(metadata.scripts)) {
      const ui = metadata.scripts['ui:install'];
      if (ui !== undefined && ui !== LEGACY_UI_SCRIPT && ui !== UPDATED_UI_SCRIPT) {
        manual.add(`package.json: customized ui:install is preserved, not automatically replaced. Before running it, align formsnap/Superforms pins to ${VERSIONS.formsnap} / ${VERSIONS['sveltekit-superforms']} and append a final svelte-kit sync after dependency installations so generated node_modules/$app files are restored. This is an unresolved manual blocker.`);
      }
      if (Object.entries(metadata.scripts).some(([name, script]) => typeof script === 'string'
        && !(name === 'ui:install' && script === LEGACY_UI_SCRIPT)
        && (script.includes('formsnap@^2.0.1') || script.includes('sveltekit-superforms@^2.31.0')))) {
        manual.add(`package.json: preserved custom install scripts still pin formsnap@^2.0.1 / sveltekit-superforms@^2.31.0. Align those script pins to formsnap@${VERSIONS.formsnap} / sveltekit-superforms@${VERSIONS['sveltekit-superforms']} and run svelte-kit sync after installation so they cannot undo the migration.`);
      }
    }
    const validation = read('svelar.validation.json');
    if (validation.original) {
      const config = jsonSource(ts, 'svelar.validation.json', validation.original.toString('utf8')).value;
      if (!['zod', 'valibot'].includes(String(config.validation))) throw new Error('svelar.validation.json: expected validation zod or valibot');
    }
    edit('package.json', Buffer.from(applyTokens(pkg.original.toString('utf8'), packageTokens(ts, pkg.original.toString('utf8')))), ['Align approved/tested Kit 3 dependency targets, native imports and exact legacy UI script pins/final sync; preserve validation/provider/app metadata']);
    const legacy = CONFIGS.map((extension) => read(`svelte.config.${extension}`)).filter((file) => file.original !== null);
    const vite = CONFIGS.map((extension) => read(`vite.config.${extension}`)).filter((file) => file.original !== null);
    const needsCss = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
      .some((section) => object(metadata[section]) && Object.hasOwn(metadata[section], 'tw-animate-css'));
    const source = vite.length === 1 && (legacy.length === 1 || needsCss)
      ? parse(ts, vite[0].path, vite[0].original!.toString('utf8')) : undefined;
    const viteChanges: Token[] = [];
    const viteReasons: string[] = [];
    let removeLegacy: string | undefined;
    if (legacy.length === 1 && vite.length === 1) {
      const config = legacyConfig(ts, parse(ts, legacy[0].path, legacy[0].original!.toString('utf8')));
      const tokens = config && source && viteTokens(ts, source, config.adapter);
      if (tokens) {
        viteChanges.push(...tokens);
        viteReasons.push('Move recognized legacy adapter/preprocess into plugin options, retaining explicit $lib aliases');
        removeLegacy = legacy[0].path;
      } else manual.add('Unsupported/custom svelte.config or Vite config: both are preserved. Review and run npx sv migrate sveltekit-3; move options manually, keeping explicit $lib aliases.');
    } else if (legacy.length || vite.length !== 1) {
      manual.add('Missing/ambiguous Vite or legacy Svelte configuration: configs are preserved. Select the real config and use npx sv migrate sveltekit-3 with manual review.');
    }
    if (needsCss) {
      manual.add('tw-animate-css is declared: verify the normal production adapter build with this style-only dependency in ssr.noExternal (or noExternal: true), preserving other SSR settings. Do not patch CSS/application source or use a runtime module shim to hide SSR export-condition failures.');
      try {
        if (!source) throw new Error('no unique supported Vite config');
        const tokens = cssSsrTokens(ts, source);
        viteChanges.push(...tokens);
        if (tokens.length) viteReasons.push('Add declared tw-animate-css to recognized SSR noExternal without replacing existing settings');
      } catch (error) {
        manual.add(`tw-animate-css SSR manual blocker: ${message(error)}. Custom noExternal/SSR source is preserved; review adding tw-animate-css before the production adapter build.`);
      }
    }
    if (source && viteChanges.length) edit(vite[0].path, Buffer.from(applyTokens(source.text, viteChanges)), viteReasons);
    if (removeLegacy) edit(removeLegacy, null, ['Remove only positively recognized legacy scaffold config after exact backup']);
    const config = read('tsconfig.json');
    if (config.original) {
      try {
        const { source, node } = jsonSource(ts, 'tsconfig.json', config.original.toString('utf8'), true);
        const props = properties(ts, node);
        const extend = props.get('extends')?.initializer;
        const tokens: Token[] = [];
        if (extend && ts.isStringLiteral(extend) && ['./.svelte-kit/tsconfig.json', '$app/tsconfig'].includes(extend.text)) {
          if (extend.text !== '$app/tsconfig') tokens.push({ start: extend.getStart(source), end: extend.end, text: JSON.stringify('$app/tsconfig') });
          const additions: Record<string, unknown> = {};
          if (!props.has('include')) additions.include = ['src', 'test', 'tests', '*'];
          if (!props.has('exclude')) additions.exclude = ['src/service-worker'];
          addProperties(source, node, additions, tokens);
          const options = props.get('compilerOptions')?.initializer;
          if (options && ts.isObjectLiteralExpression(options)) {
            const types = properties(ts, options).get('types')?.initializer;
            if (types) {
              if (ts.isArrayLiteralExpression(types) && types.elements.every(ts.isStringLiteral)) {
                if (!types.elements.some((item) => ts.isStringLiteral(item) && item.text === '$app/types')) {
                  tokens.push({ start: types.getStart(source) + 1, end: types.getStart(source) + 1,
                    text: `${JSON.stringify('$app/types')}${types.elements.length ? ', ' : ''}` });
                }
              } else manual.add('tsconfig.json: compilerOptions.types is not a static string list; preserve custom values and add $app/types manually.');
            }
          } else if (options) manual.add('tsconfig.json: custom compilerOptions is preserved; ensure explicit types include $app/types.');
          edit('tsconfig.json', Buffer.from(applyTokens(source.text, tokens)), ['Extend Kit 3 tsconfig and add $app/types to explicit static type lists; retain custom compiler options and include/exclude lists']);
        } else manual.add('Custom tsconfig extends: preserved. Extend $app/tsconfig and review include/exclude and service-worker project configuration manually.');
      } catch (error) { manual.add(`tsconfig.json is preserved: ${message(error)}; migrate its configuration manually.`); }
    } else manual.add('No tsconfig.json: configure TypeScript 6 and $app/tsconfig manually.');
    let svelte: typeof SvelteCompiler | undefined;
    let scanned = 0;
    let bytes = 0;
    const sourceTokens = (content: string, path: string, offset = 0): Token[] => {
      const source = parse(ts, path, content);
      const tokens: Token[] = [];
      const module = (node: TypeScript.Expression | undefined): void => {
        if (!node || (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node))) return;
        if (node.text === '$app/environment') tokens.push({ start: offset + node.getStart(source), end: offset + node.end, text: JSON.stringify('$app/env') });
        if (['$app/stores', '$service-worker', '$app/navigation', '$app/forms', '$app/paths', '@sveltejs/kit', '@sveltejs/kit/hooks'].includes(node.text)) {
          manual.add(`${path}: review ${node.text} APIs/types against the official migrator; semantic source/markup changes are not automated.`);
        }
      };
      const visit = (node: TypeScript.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) module(node.moduleSpecifier);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          // require can be app-owned/shadowed; leave it and computed dynamic imports to the official tool.
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1
            && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) module(node.arguments[0]);
          else manual.add(`${path}: computed/CommonJS module loading is preserved and needs manual review.`);
        }
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) module(node.argument.literal);
        ts.forEachChild(node, visit);
      };
      visit(source);
      return tokens;
    };
    const scan = async (path: string): Promise<void> => {
      const absolute = checkedPath(root, path);
      const stat = lstatSync(absolute, { throwIfNoEntry: false });
      if (!stat) { read(path); return; }
      if (!stat.isDirectory()) throw new Error(`${path}: expected a directory`);
      const entries = readdirSync(absolute).sort();
      directories.push({ path, dev: stat.dev, ino: stat.ino, entries });
      for (const name of entries) {
        if (EXCLUDED.has(name)) continue;
        const child = join(path, name);
        const file = lstatSync(checkedPath(root, child));
        if (file.isDirectory()) { await scan(child); continue; }
        if (!EXTENSIONS.has(extname(name))) continue;
        if (++scanned > 10000 || (bytes += file.size) > 64 * 1024 * 1024) throw new Error('Source scan limit exceeded (10,000 files / 64 MiB)');
        const input = read(child);
        const content = input.original!.toString('utf8');
        const tokens: Token[] = [];
        if (extname(name) === '.svelte') {
          svelte ??= await compiler<typeof SvelteCompiler>(root, 'svelte/compiler');
          const ast = svelte.parse(content, { filename: child, modern: true });
          for (const script of [ast.instance, ast.module]) {
            if (!script) continue;
            const span = script.content;
            if (!('start' in span) || !('end' in span) || typeof span.start !== 'number' || typeof span.end !== 'number') {
              throw new Error(`${child}: compiler did not provide script spans`);
            }
            const { start, end } = span;
            tokens.push(...sourceTokens(content.slice(start, end), child, start));
          }
        } else tokens.push(...sourceTokens(content, child));
        edit(child, Buffer.from(applyTokens(content, tokens)), ['Rename static $app/environment module specifiers only; retain all $lib/custom code']);
      }
    };
    for (const path of ['src', 'test', 'tests', 'scripts']) await scan(path);
  } catch (error) { errors.push(message(error)); }
  const manualSteps = [...manual].sort();
  const markdown = guide(manualSteps);
  try {
    const existing = read(SVELTEKIT3_GUIDE_PATH);
    if (existing.original && !existing.original.equals(Buffer.from(markdown)) && !generatedGuide(existing.original.toString('utf8'))) {
      throw new Error(`${SVELTEKIT3_GUIDE_PATH}: app-owned/modified guide conflicts; preserve it under another name before generating a new guide`);
    }
    edit(SVELTEKIT3_GUIDE_PATH, Buffer.from(markdown), ['Generate actionable human/AI manual-review and recovery checklist (not a completion claim)']);
  } catch (error) { errors.push(message(error)); }
  const plan: SvelteKit3MigrationPlan = { root, edits, errors, warnings, manualSteps, guidePath: SVELTEKIT3_GUIDE_PATH, guide: markdown, requiresManual: true };
  preflights.set(plan, { signature: signature(plan), files: [...files.values()], directories, dev: rootStat.dev, ino: rootStat.ino });
  return plan;
}

function exclusiveWrite(path: string, content: Buffer, mode: number): void {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
  try { writeFileSync(fd, content); fchmodSync(fd, mode); } finally { closeSync(fd); }
}
function atomicWrite(root: string, path: string, content: Buffer, mode: number, create: boolean, check: () => void): void {
  const absolute = checkedPath(root, path);
  const temporary = `${absolute}.sveltekit3-${randomUUID()}.tmp`;
  try {
    exclusiveWrite(temporary, content, mode);
    checkedPath(root, path);
    check();
    if (create) { linkSync(temporary, absolute); unlinkSync(temporary); }
    else renameSync(temporary, absolute);
  } finally {
    // Do not follow a directory swapped to a symlink during a failed write.
    checkedPath(root, path);
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
}

export function applySvelteKit3Migration(plan: SvelteKit3MigrationPlan, options: { confirmed: boolean }): string[] {
  if (!options.confirmed) throw new Error('SvelteKit 3 migration requires --force or explicit interactive confirmation');
  const preflight = preflights.get(plan);
  if (!preflight || signature(plan) !== preflight.signature) throw new Error('Untrusted or modified migration plan; rerun --dry-run');
  if (plan.errors.length) throw new Error(`Migration preflight failed; no files written:\n${plan.errors.join('\n')}`);
  const rootStat = lstatSync(plan.root);
  if (rootStat.isSymbolicLink() || realpathSync(plan.root) !== plan.root || rootStat.dev !== preflight.dev || rootStat.ino !== preflight.ino) {
    throw new Error('Project directory changed after planning');
  }
  for (const file of preflight.files) checkSnapshot(plan.root, file);
  for (const directory of preflight.directories) {
    const absolute = checkedPath(plan.root, directory.path);
    const stat = lstatSync(absolute);
    if (!stat.isDirectory() || stat.dev !== directory.dev || stat.ino !== directory.ino
      || JSON.stringify(readdirSync(absolute).sort()) !== JSON.stringify(directory.entries)) {
      throw new Error(`${directory.path}: source inventory changed after planning; rerun --dry-run`);
    }
  }
  if (!plan.edits.length) return [];
  const backups = plan.edits.filter((edit) => edit.original !== null).map((edit) => {
    let suffix = 0;
    let path: string;
    while (true) {
      path = `${edit.path}.sveltekit3.bak${suffix ? `.${suffix}` : ''}`;
      const absolute = checkedPath(plan.root, path);
      const stat = lstatSync(absolute, { throwIfNoEntry: false });
      if (!stat) return { path, edit };
      if (!stat.isFile() || stat.nlink !== 1) throw new Error(`${path}: backup conflicts with a non-regular file`);
      suffix++;
      if (suffix > 1000) throw new Error(`${edit.path}: too many existing backups`);
    }
  });
  const lockPath = checkedPath(plan.root, LOCK);
  exclusiveWrite(lockPath, Buffer.from('Svelar SvelteKit 3 migration in progress. Review before removing a stale lock.\n'), 0o600);
  const lockStat = lstatSync(lockPath);
  const completed: { edit: SvelteKit3MigrationEdit; snapshot: Snapshot }[] = [];
  const retained: string[] = [];
  try {
    for (const file of preflight.files) checkSnapshot(plan.root, file);
    // All original bytes are backed up before any modification or removal.
    for (const backup of backups) {
      exclusiveWrite(checkedPath(plan.root, backup.path), backup.edit.original!, backup.edit.mode);
      retained.push(backup.path);
    }
    // Remove a known legacy config last, only after its replacement and sources were written.
    for (const edit of [...plan.edits].sort((a, b) => Number(a.updated === null) - Number(b.updated === null))) {
      const original = preflight.files.find((file) => file.path === edit.path)!;
      const check = () => checkSnapshot(plan.root, original);
      if (edit.updated === null) { check(); unlinkSync(checkedPath(plan.root, edit.path)); }
      else atomicWrite(plan.root, edit.path, edit.updated, edit.mode, edit.original === null, check);
      completed.push({ edit, snapshot: snapshot(plan.root, edit.path) });
    }
  } catch (error) {
    const failures: string[] = [];
    for (const { edit, snapshot: current } of completed.reverse()) {
      try {
        const check = () => checkSnapshot(plan.root, current);
        if (edit.original === null) { check(); unlinkSync(checkedPath(plan.root, edit.path)); }
        else atomicWrite(plan.root, edit.path, edit.original, edit.mode, edit.updated === null, check);
      } catch (rollback) { failures.push(`${edit.path}: ${message(rollback)}`); }
    }
    throw new Error(`Migration failed: ${message(error)}. Exact-original backups retained: ${retained.join(', ') || 'none'}.${failures.length ? `\nRollback needs manual review:\n${failures.join('\n')}` : ''}`);
  } finally {
    const current = lstatSync(checkedPath(plan.root, LOCK), { throwIfNoEntry: false });
    if (current?.dev === lockStat.dev && current.ino === lockStat.ino) unlinkSync(lockPath);
  }
  return retained;
}
