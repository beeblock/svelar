import { chmodSync, lstatSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type * as TypeScript from 'typescript';
import type * as SvelteCompiler from 'svelte/compiler';

const HTTP = '@beeblock/svelar/http';
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.svelte']);
const EXCLUDED = new Set(['node_modules', '.git', '.svelte-kit', '.svelar', 'build', 'dist', 'coverage', 'tests', '__tests__']);
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
type Ts = typeof TypeScript;

export interface ApiFetchMigrationToken { readonly start: number; readonly end: number; readonly replacement: string }
export interface ApiFetchMigrationEdit {
  readonly path: string;
  readonly original: Buffer;
  readonly updated: Buffer;
  readonly mode: number;
  readonly tokens: readonly ApiFetchMigrationToken[];
}
export interface ApiFetchMigrationPlan {
  readonly root: string;
  readonly edits: readonly ApiFetchMigrationEdit[];
  readonly errors: readonly string[];
  readonly skipped: readonly string[];
}

export interface ArchitectureSourceUnit {
  source: TypeScript.SourceFile;
  checker: TypeScript.TypeChecker;
  offset: number;
  context: 'source' | 'instance' | 'module' | 'event';
  browserHandlers: ReadonlySet<string>;
  componentBindings: ReadonlySet<string>;
}

export function loadArchitectureCompiler<T>(root: string, id: string, allowCoreFallback = true): T {
  try { return createRequire(join(root, 'package.json'))(id) as T; }
  catch (error) {
    if (allowCoreFallback) {
      try { return createRequire(import.meta.url)(id) as T; } catch { /* report the app prerequisite below */ }
    }
    throw new Error(`Cannot load ${id}; install the app's compiler before this command (${errorMessage(error)}).`);
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function staticString(ts: Ts, node: TypeScript.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

export function unwrapExpression(ts: Ts, node: TypeScript.Expression): TypeScript.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node) || ts.isAwaitExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}

export function importedName(ts: Ts, unit: ArchitectureSourceUnit, identifier: TypeScript.Identifier, module: string, name: string): boolean {
  const symbol = unit.checker.getSymbolAtLocation(identifier);
  return !!symbol?.declarations?.some((declaration) => ts.isImportSpecifier(declaration)
    && !declaration.isTypeOnly && !declaration.parent.parent.isTypeOnly
    && (declaration.propertyName ?? declaration.name).text === name
    && ts.isImportDeclaration(declaration.parent.parent.parent)
    && staticString(ts, declaration.parent.parent.parent.moduleSpecifier) === module);
}

function nodes(ts: Ts, source: TypeScript.Node): TypeScript.Node[] {
  const result: TypeScript.Node[] = [];
  const visit = (node: TypeScript.Node): void => { result.push(node); ts.forEachChild(node, visit); };
  visit(source);
  return result;
}

/** Parse script and event-expression spans without printing or reformatting app source. */
export function architectureSourceUnits(ts: Ts, content: string, filename: string, svelte?: typeof SvelteCompiler): ArchitectureSourceUnit[] {
  const units: ArchitectureSourceUnit[] = [];
  const handlers = new Set<string>();
  const bindings = new Set<string>();
  const add = (text: string, offset: number, context: ArchitectureSourceUnit['context']): void => {
    const kind = /\.jsx$/.test(filename) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(filename) ? ts.ScriptKind.JS : /\.tsx$/.test(filename) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const parserFilename = filename.endsWith('.svelte') ? `${filename}.ts` : filename;
    const source = ts.createSourceFile(parserFilename, text, ts.ScriptTarget.Latest, true, kind);
    const host = ts.createCompilerHost({ noLib: true, noResolve: true });
    host.getSourceFile = (name) => name === parserFilename ? source : undefined;
    const program = ts.createProgram([parserFilename], { noLib: true, noResolve: true }, host);
    const diagnostic = program.getSyntacticDiagnostics(source)[0];
    if (diagnostic) throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
    units.push({ source, checker: program.getTypeChecker(), offset, context, browserHandlers: handlers, componentBindings: bindings });
  };
  if (!filename.endsWith('.svelte')) { add(content, 0, 'source'); return units; }
  if (!svelte) throw new Error('Svelte compiler is required to inspect component source.');
  // Svelte strips a BOM before assigning offsets; keep edits indexed into the original bytes.
  const bom = content.startsWith('\uFEFF') ? 1 : 0;
  const parseContent = content.slice(bom);
  const ast = svelte.parse(parseContent, { filename, modern: true });
  for (const [script, context] of [[ast.instance, 'instance'], [ast.module, 'module']] as const) {
    if (!script) continue;
    const span = script.content;
    if (!('start' in span) || !('end' in span) || typeof span.start !== 'number' || typeof span.end !== 'number') throw new Error('Svelte compiler did not provide script spans.');
    add(parseContent.slice(span.start, span.end), span.start + bom, context);
  }
  const events: { start: number; end: number }[] = [];
  const references: { name: string; start: number }[] = [];
  const walk = (value: unknown, element?: Record<string, unknown>): void => {
    if (Array.isArray(value)) { value.forEach((item) => walk(item, element)); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.type === 'RegularElement') element = record;
    if (record.type === 'Component') element = undefined;
    if (element && (record.type === 'OnDirective' || (record.type === 'Attribute' && typeof record.name === 'string' && /^on[a-z]+$/.test(record.name)))) {
      const values = Array.isArray(record.value) ? record.value : [record.value];
      const expressions = record.type === 'OnDirective' ? [record.expression] : values.map((item: unknown) =>
        item && typeof item === 'object' ? (item as Record<string, unknown>).expression : undefined);
      for (const expression of expressions) {
        if (!expression || typeof expression !== 'object') continue;
        const span = expression as Record<string, unknown>;
        if (typeof span.start === 'number' && typeof span.end === 'number') events.push({ start: span.start + bom, end: span.end + bom });
      }
    }
    if (record.type === 'Identifier' && typeof record.name === 'string' && typeof record.start === 'number') references.push({ name: record.name, start: record.start + bom });
    for (const [key, child] of Object.entries(record)) if (!['instance', 'module', 'parent', 'loc', 'metadata'].includes(key)) walk(child, element);
  };
  walk(ast);
  for (const unit of units) {
    for (const node of nodes(ts, unit.source)) {
      if ((ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)
        || ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
        && node.name && ts.isIdentifier(node.name)) bindings.add(node.name.text);
      const declaration = ts.isFunctionDeclaration(node) && node.name ? node
        : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
          && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node : undefined;
      if (!declaration || unit.context !== 'instance' || !declaration.name || !ts.isIdentifier(declaration.name)) continue;
      if (ts.canHaveModifiers(declaration) && ts.getModifiers(declaration)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const name = declaration.name.text;
      const scriptReferences = units.flatMap((item) => nodes(ts, item.source)).filter((item) => ts.isIdentifier(item) && item.text === name);
      const templateReferences = references.filter((item) => item.name === name);
      if (scriptReferences.length === 1 && templateReferences.length > 0 && templateReferences.every((item) => events.some((span) => item.start >= span.start && item.start < span.end))) handlers.add(name);
    }
  }
  for (const event of events) add(`(${content.slice(event.start, event.end)})`, event.start - 1, 'event');
  return units;
}

export function isGlobalFetch(ts: Ts, unit: ArchitectureSourceUnit, call: TypeScript.CallExpression): boolean {
  const expression = call.expression;
  if (ts.isIdentifier(expression) && expression.text === 'fetch') {
    return !unit.checker.getSymbolAtLocation(expression) && !(unit.context === 'event' && unit.componentBindings.has('fetch'));
  }
  return ts.isPropertyAccessExpression(expression) && expression.name.text === 'fetch'
    && ts.isIdentifier(expression.expression) && ['window', 'globalThis'].includes(expression.expression.text)
    && !unit.checker.getSymbolAtLocation(expression.expression)
    && !(unit.context === 'event' && unit.componentBindings.has(expression.expression.text));
}

export function isBrowserCall(ts: Ts, unit: ArchitectureSourceUnit, call: TypeScript.CallExpression): boolean {
  if (unit.context === 'event') return true;
  if (unit.context === 'module' || /(?:\.server\.[cm]?[jt]sx?$|(?:^|\/)server\/|(?:^|\/)hooks\.[cm]?[jt]s$)/.test(unit.source.fileName.replaceAll('\\', '/'))) return false;
  let node: TypeScript.Node = call;
  while (node.parent) {
    const parent = node.parent;
    if (ts.isIfStatement(parent) && parent.thenStatement === node && ts.isIdentifier(parent.expression)
      && importedName(ts, unit, parent.expression, '$app/environment', 'browser')) return true;
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isCallExpression(parent)
      && ts.isIdentifier(parent.expression) && importedName(ts, unit, parent.expression, 'svelte', 'onMount')) return true;
    if (unit.context === 'instance') {
      if (ts.isFunctionDeclaration(node) && node.name && unit.browserHandlers.has(node.name.text)) return true;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && unit.browserHandlers.has(node.name.text)) return true;
    }
    node = parent;
  }
  return false;
}

export function literalProperties(ts: Ts, object: TypeScript.ObjectLiteralExpression): Map<string, TypeScript.PropertyAssignment> | undefined {
  const properties = new Map<string, TypeScript.PropertyAssignment>();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) return undefined;
    const name = ts.isIdentifier(property.name) ? property.name.text : staticString(ts, property.name);
    if (name === undefined || properties.has(name)) return undefined;
    properties.set(name, property);
  }
  return properties;
}

export function sameOriginPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !/[\\\x00-\x20\x7f]/.test(value);
}

export function fetchMutation(ts: Ts, call: TypeScript.CallExpression): { method?: string; options?: TypeScript.ObjectLiteralExpression; csrf: boolean } {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return { csrf: false };
  const properties = literalProperties(ts, options);
  const methodProperty = properties?.get('method') ?? options.properties.find((property): property is TypeScript.PropertyAssignment =>
    ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) ? property.name.text : staticString(ts, property.name)) === 'method');
  const method = staticString(ts, methodProperty?.initializer)?.toUpperCase();
  const headers = properties?.get('headers')?.initializer;
  const headerNames = headers && ts.isObjectLiteralExpression(headers) ? literalProperties(ts, headers) : undefined;
  const csrf = !!headerNames && [...headerNames.keys()].some((key) => ['x-csrf-token', 'x-xsrf-token'].includes(key.toLowerCase()));
  return { method, options, csrf };
}

function apiFetchTokens(ts: Ts, units: ArchitectureSourceUnit[], content: string, filename: string, errors: string[], skipped: string[]): ApiFetchMigrationToken[] {
  const tokens: ApiFetchMigrationToken[] = [];
  const allNames = new Set(units.flatMap((unit) => nodes(ts, unit.source)).filter(ts.isIdentifier).map((node) => node.text));
  const aliases = new Map<ArchitectureSourceUnit, string>();
  const sourceLocation = (unit: ArchitectureSourceUnit, node: TypeScript.Node) => `${filename}:${content.slice(0, unit.offset + node.getStart(unit.source)).split('\n').length}`;
  const token = (unit: ArchitectureSourceUnit, start: number, end: number, replacement: string): void => { tokens.push({ start: unit.offset + start, end: unit.offset + end, replacement }); };
  const alias = (unit: ArchitectureSourceUnit): string => {
    const importUnit = unit.context === 'event' ? units.find((item) => item.context === 'instance') : unit;
    if (!importUnit) throw new Error('Inline event migration needs an instance script import; add one manually.');
    const existing = aliases.get(importUnit);
    if (existing) return existing;
    for (const statement of importUnit.source.statements) {
      if (!ts.isImportDeclaration(statement) || staticString(ts, statement.moduleSpecifier) !== HTTP || statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const item of bindings.elements) {
        if (item.isTypeOnly || (item.propertyName ?? item.name).text !== 'apiFetch') continue;
        const declarations = units.flatMap((part) => nodes(ts, part.source)).filter((node) =>
          (ts.isParameter(node) || ts.isBindingElement(node) || ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
          && node.name && ts.isIdentifier(node.name) && node.name.text === item.name.text);
        if (!declarations.length) { aliases.set(importUnit, item.name.text); return item.name.text; }
      }
    }
    let name = 'apiFetch';
    for (let suffix = 0; allNames.has(name); suffix++) name = `svelarApiFetch${suffix || ''}`;
    allNames.add(name);
    const source = importUnit.source;
    const position = source.statements[0]?.getStart(source) ?? source.text.length;
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const indentation = source.text.slice(0, position).match(/(?:^|\n)([ \t]*)[^\n]*$/)?.[1] ?? '';
    token(importUnit, position, position, `import { apiFetch${name === 'apiFetch' ? '' : ` as ${name}`} } from '${HTTP}';${eol}${indentation}`);
    aliases.set(importUnit, name);
    return name;
  };
  for (const unit of units) {
    for (const node of nodes(ts, unit.source)) {
      if (!ts.isCallExpression(node) || !isGlobalFetch(ts, unit, node)) continue;
      const location = sourceLocation(unit, node);
      const mutation = fetchMutation(ts, node);
      if (node.arguments.length < 2 && staticString(ts, node.arguments[0]) !== undefined) continue;
      if (mutation.options && !mutation.method && literalProperties(ts, mutation.options) && !literalProperties(ts, mutation.options)?.has('method')) continue;
      if (mutation.method && !MUTATIONS.has(mutation.method)) continue;
      if (!isBrowserCall(ts, unit, node)) { skipped.push(`${location}: server or unproven browser context; fetch preserved`); continue; }
      const url = staticString(ts, node.arguments[0]);
      if (url !== undefined && !sameOriginPath(url)) { skipped.push(`${location}: external or non-root-relative URL; fetch preserved`); continue; }
      const fail = (reason: string): void => { errors.push(`${location}: ${reason}; fetch preserved, review manually`); };
      if (url === undefined || !mutation.method || !mutation.options || node.arguments.length !== 2 || node.questionDotToken) { fail('URL, method and two-argument browser mutation must be statically known'); continue; }
      if (mutation.csrf) { skipped.push(`${location}: explicit CSRF header already present; fetch preserved`); continue; }
      const properties = literalProperties(ts, mutation.options);
      if (!properties) { fail('Spread, computed, duplicate or accessor request options are unsafe'); continue; }
      const allowed = new Set(['method', 'headers', 'body', 'signal', 'credentials', 'mode', 'cache', 'redirect', 'referrer', 'referrerPolicy', 'integrity', 'keepalive', 'priority']);
      if ([...properties.keys()].some((key) => !allowed.has(key))) { fail('Unknown fetch option'); continue; }
      const mode = properties.get('mode');
      const credentials = properties.get('credentials');
      if (mode && !['same-origin', 'cors'].includes(staticString(ts, mode.initializer) ?? '')
        || credentials && !['same-origin', 'include'].includes(staticString(ts, credentials.initializer) ?? '')) { fail('Request mode/credentials cannot safely adopt cookie-based CSRF'); continue; }
      const headers = properties.get('headers')?.initializer;
      const headerProperties = headers && ts.isObjectLiteralExpression(headers) ? literalProperties(ts, headers) : undefined;
      if (headers && !headerProperties) { fail('Headers must be a plain literal without spread/computed keys'); continue; }
      const names = headerProperties ? [...headerProperties.keys()].map((key) => key.toLowerCase()) : [];
      if (new Set(names).size !== names.length) { fail('Case-insensitive duplicate headers'); continue; }
      const body = properties.get('body')?.initializer;
      const nonStringBody = body && (body.kind === ts.SyntaxKind.NullKeyword || ts.isNewExpression(body) && ts.isIdentifier(body.expression)
        && ['FormData', 'URLSearchParams', 'Blob', 'ArrayBuffer', 'Uint8Array'].includes(body.expression.text) && !unit.checker.getSymbolAtLocation(body.expression));
      if (body && !nonStringBody && !names.includes('content-type')) { fail('Possible string body without explicit Content-Type would change transport semantics'); continue; }
      if (units.flatMap((part) => nodes(ts, part.source)).some((item) => ts.isBinaryExpression(item)
        && item.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && item.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && ((ts.isIdentifier(item.left) && item.left.text === 'fetch') || ts.isPropertyAccessExpression(item.left) && item.left.name.text === 'fetch'
          || ts.isElementAccessExpression(item.left) && staticString(ts, item.left.argumentExpression) === 'fetch'))) { fail('Fetch is reassigned in this component/source'); continue; }
      const expression = node.expression;
      const expressionText = unit.source.text.slice(expression.getStart(unit.source), expression.end);
      if (/\/\*|\/\//.test(expressionText)) { fail('Comment inside the callee token cannot be removed safely'); continue; }
      try {
        const name = alias(unit);
        token(unit, expression.getStart(unit.source), expression.end, name);
        // Disable new toasts and retain fetch's default Accept instead of adopting JSON defaults silently.
        token(unit, mutation.options.getStart(unit.source) + 1, mutation.options.getStart(unit.source) + 1,
          headers ? ' showToast: false,' : " showToast: false, headers: { Accept: '*/*' },");
        if (headers && !names.includes('accept')) token(unit, headers.getStart(unit.source) + 1, headers.getStart(unit.source) + 1, " Accept: '*/*',");
      } catch (error) { fail(errorMessage(error)); }
    }
  }
  return tokens;
}

export async function planApiFetchMigration(directory: string): Promise<ApiFetchMigrationPlan> {
  const root = realpathSync(directory);
  const edits: ApiFetchMigrationEdit[] = [];
  const errors: string[] = [];
  const skipped: string[] = [];
  try {
    const ts = loadArchitectureCompiler<Ts>(root, 'typescript', false);
    let svelte: typeof SvelteCompiler | undefined;
    let count = 0;
    let bytes = 0;
    const scan = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (EXCLUDED.has(entry.name)) continue;
        const absolute = join(directory, entry.name);
        const path = relative(root, absolute).split(sep).join('/');
        if (entry.isSymbolicLink()) { errors.push(`${path}: symlink source boundary is unsafe; no writes`); continue; }
        if (entry.isDirectory()) { scan(absolute); continue; }
        if (!entry.isFile() || !EXTENSIONS.has(extname(entry.name)) || /\.(?:test|spec|d)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
        const stat = lstatSync(absolute);
        if (++count > 10000 || (bytes += stat.size) > 64 * 1024 * 1024 || stat.size > 2 * 1024 * 1024) throw new Error('Migration scan limit exceeded (10,000 files / 64 MiB total / 2 MiB per file).');
        if (/\.server\.[cm]?[jt]sx?$/.test(path) || path.includes('/server/')) continue;
        try {
          const original = readFileSync(absolute);
          const content = original.toString('utf8');
          if (!Buffer.from(content).equals(original)) throw new Error('Source must be valid UTF-8.');
          if (path.endsWith('.svelte')) svelte ??= loadArchitectureCompiler<typeof SvelteCompiler>(root, 'svelte/compiler', false);
          const units = architectureSourceUnits(ts, content, path, svelte);
          const tokens = apiFetchTokens(ts, units, content, path, errors, skipped).sort((a, b) => b.start - a.start || b.end - a.end);
          let updated = content;
          let boundary = content.length;
          for (const token of tokens) {
            if (token.start < 0 || token.end > boundary || token.start > token.end) throw new Error('Overlapping or invalid migration tokens.');
            updated = updated.slice(0, token.start) + token.replacement + updated.slice(token.end);
            boundary = token.start;
          }
          if (updated !== content) {
            architectureSourceUnits(ts, updated, path, svelte);
            edits.push({ path, original, updated: Buffer.from(updated), mode: stat.mode & 0o777, tokens });
          }
        } catch (error) { errors.push(`${path}: ${errorMessage(error)}`); }
      }
    };
    const src = join(root, 'src');
    const stat = lstatSync(src, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error('src/ must be an app-owned directory, not a symlink.');
    if (stat?.isDirectory()) scan(src);
  } catch (error) { errors.push(errorMessage(error)); }
  return { root, edits, errors, skipped };
}

function checkedPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${root}${sep}`)) throw new Error(`Unsafe migration path: ${path}`);
  for (let current = absolute; current !== root; current = dirname(current)) {
    if (lstatSync(current).isSymbolicLink()) throw new Error(`${path}: symlink changed after planning`);
  }
  if (!lstatSync(absolute).isFile()) throw new Error(`${path}: expected a regular file`);
  return absolute;
}

function atomicWrite(path: string, content: Buffer, mode: number): void {
  const temporary = `${path}.api-fetch-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally { if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary); }
}

export function applyApiFetchMigration(plan: ApiFetchMigrationPlan, options: { confirmed: boolean }): string[] {
  if (!options.confirmed) throw new Error('apiFetch migration requires explicit confirmation or --force.');
  if (plan.errors.length) throw new Error(`apiFetch migration preflight failed; no files written:\n${plan.errors.join('\n')}`);
  if (realpathSync(plan.root) !== plan.root) throw new Error('Project directory changed after planning.');
  const seen = new Set<string>();
  for (const edit of plan.edits) {
    const absolute = checkedPath(plan.root, edit.path);
    if (seen.has(absolute)) throw new Error(`Duplicate migration path: ${edit.path}`);
    seen.add(absolute);
    if (!readFileSync(absolute).equals(edit.original) || (lstatSync(absolute).mode & 0o777) !== edit.mode) throw new Error(`${edit.path} changed after planning; rerun --dry-run.`);
  }
  const backups: string[] = [];
  const written: ApiFetchMigrationEdit[] = [];
  try {
    for (const edit of plan.edits) {
      const absolute = checkedPath(plan.root, edit.path);
      for (let suffix = 0; suffix < 1000; suffix++) {
        const backup = `${absolute}.api-fetch.bak${suffix ? `.${suffix}` : ''}`;
        try {
          writeFileSync(backup, edit.original, { flag: 'wx', mode: edit.mode });
          backups.push(relative(plan.root, backup));
          break;
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'EEXIST' && suffix < 999) continue;
          throw error;
        }
      }
    }
    for (const edit of plan.edits) {
      const absolute = checkedPath(plan.root, edit.path);
      if (!readFileSync(absolute).equals(edit.original) || (lstatSync(absolute).mode & 0o777) !== edit.mode) throw new Error(`${edit.path} changed during migration.`);
      atomicWrite(absolute, edit.updated, edit.mode);
      written.push(edit);
    }
  } catch (error) {
    const failures: string[] = [];
    for (const edit of written.reverse()) {
      try {
        const absolute = checkedPath(plan.root, edit.path);
        if (!readFileSync(absolute).equals(edit.updated) || (lstatSync(absolute).mode & 0o777) !== edit.mode) throw new Error('Concurrent customization preserved; restore from backup manually.');
        atomicWrite(absolute, edit.original, edit.mode);
      } catch (rollback) { failures.push(`${edit.path}: ${errorMessage(rollback)}`); }
    }
    throw new Error(`apiFetch migration failed: ${errorMessage(error)}. Exact backups retained.${failures.length ? `\nRollback needs review:\n${failures.join('\n')}` : ''}`);
  }
  return backups;
}
