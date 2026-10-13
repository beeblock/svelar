import { chmodSync, existsSync, lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type * as TypeScript from 'typescript';

export type CoreMigrationRule = 'provider-bootstrap' | 'queue-observations' | 'notification-channels'
  | 'admin-user-guards' | 'queue-delete-outcome' | 'queue-retry-outcome' | 'scheduler-run-outcome' | 'scheduler-toggle-await' | 'log-viewer-await'
  | 'csrf-exclusions';

export interface CoreMigrationToken {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  readonly rule: CoreMigrationRule;
}

export interface CoreMigrationFile {
  readonly path: string;
  readonly original: Buffer;
  readonly updated: Buffer;
  readonly mode: number;
  readonly tokens: readonly CoreMigrationToken[];
}

export interface CoreMigrationPlan {
  readonly root: string;
  readonly edits: readonly CoreMigrationFile[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const RULES: Readonly<Record<string, CoreMigrationRule>> = {
  'src/app.ts': 'provider-bootstrap',
  'src/hooks.server.ts': 'csrf-exclusions',
  'src/routes/admin/+page.server.ts': 'admin-user-guards',
  'src/routes/api/admin/queue/[id]/+server.ts': 'queue-delete-outcome',
  'src/routes/api/admin/queue/[id]/retry/+server.ts': 'queue-retry-outcome',
  'src/routes/api/admin/scheduler/[name]/run/+server.ts': 'scheduler-run-outcome',
  'src/routes/api/admin/scheduler/[name]/toggle/+server.ts': 'scheduler-toggle-await',
};

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function checkedPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${root}${sep}`)) throw new Error(`Unsafe migration path: ${path}`);
  let current = absolute;
  while (current !== root) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error(`${path}: symlinks are not supported`);
    current = dirname(current);
  }
  return absolute;
}

/** Pure token planning against a supplied snapshot is also used by the release preservation gate. */
export function planCoreScaffoldMigrationFromSource(
  directory: string, ts: typeof TypeScript, snapshot?: ReadonlyMap<string, Buffer>,
): CoreMigrationPlan {
  const root = realpathSync(directory);
  const errors: string[] = [];
  const edits: CoreMigrationFile[] = [];
  const warnings = [
    'This opt-in migration changes only nine recognized legacy scaffold files when present. Customized legacy patterns require manual review; templates are never copied over source.',
    'Queue health reports Queue.size() on the configured default connection/queue and the length of Queue.failed(). These are bounded observations, not full BullMQ status counts or worker health.',
    'Admin guards and operator outcomes are semantic changes: missing params return 400, unavailable deletes return 404, unavailable retries/skipped task runs return 409, and failed runs return 500. Toggle persistence is awaited.',
    'Legacy scheduler-toggle body.enabled ?? true, error envelopes, default queue selection and other app-owned JSON/schema APIs are not migrated. Review their validation/authorization and exercise admin operations before claiming upgrade compatibility.',
    'Recognized LogViewer calls in async scaffold functions become awaited. Custom synchronous wrappers or shadowed imports require review. Configure the shared database viewer and search sweep explicitly in existing app bootstrap.',
    'Only the recognized two-path legacy CSRF exclusion array in a direct imported createSvelarApp hooks binding is narrowed to the signed incoming-webhook prefix and exact internal broadcast endpoint. Custom callers, spreads, shadowed bindings, and conflicting exact exclusions require manual review; signed-endpoint authentication remains required.',
  ];
  const read = (path: string): Buffer | undefined => {
    const absolute = checkedPath(root, path);
    if (snapshot) return snapshot.get(path);
    if (!existsSync(absolute)) return undefined;
    if (!lstatSync(absolute).isFile()) throw new Error(`${path}: expected a regular file`);
    return readFileSync(absolute);
  };
  const ddd = snapshot ? [...snapshot.keys()].some((path) => path.startsWith('src/lib/modules/'))
    : existsSync(join(root, 'src/lib/modules'));
  const rules = { ...RULES,
    [ddd ? 'src/lib/shared/scheduler/QueueHealthCheck.ts' : 'src/lib/scheduler/QueueHealthCheck.ts']: 'queue-observations',
    [ddd ? 'src/lib/modules/auth/application/notifications/WelcomeNotification.ts' : 'src/lib/notifications/WelcomeNotification.ts']: 'notification-channels',
  } satisfies Record<string, CoreMigrationRule>;

  for (const [path, rule] of Object.entries(rules)) {
    try {
      const original = read(path);
      if (!original) continue;
      const content = original.toString('utf8');
      if (!Buffer.from(content).equals(original)) throw new Error('Source must be valid UTF-8');
      const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const host = ts.createCompilerHost({ noLib: true, noResolve: true });
      host.getSourceFile = (name) => name === path ? source : undefined;
      const diagnostics = ts.createProgram([path], { noLib: true, noResolve: true }, host).getSyntacticDiagnostics(source);
      if (diagnostics.length) throw new Error(ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' '));
      const tokens = coreTokens(ts, source, rule, read, ddd);
      if (!tokens.length) continue;
      let updated = content;
      let boundary = content.length;
      for (const token of [...tokens].sort((a, b) => b.start - a.start || b.end - a.end)) {
        if (token.start < 0 || token.end > boundary || token.start > token.end) throw new Error('Overlapping migration tokens');
        updated = updated.slice(0, token.start) + token.replacement + updated.slice(token.end);
        boundary = token.start;
      }
      edits.push({ path, original, updated: Buffer.from(updated), mode: lstatSync(checkedPath(root, path)).mode & 0o777, tokens });
    } catch (error) { errors.push(`${path}: ${errorMessage(error)}; review this legacy pattern manually (no files written)`); }
  }
  return { root, edits, errors, warnings };
}

function coreTokens(
  ts: typeof TypeScript, source: TypeScript.SourceFile, rule: CoreMigrationRule,
  read: (path: string) => Buffer | undefined, ddd: boolean,
): CoreMigrationToken[] {
  const tokens: CoreMigrationToken[] = [];
  const eol = source.text.includes('\r\n') ? '\r\n' : '\n';
  const fail: (reason: string) => never = (reason) => { throw new Error(reason); };
  const all = (node: TypeScript.Node = source): TypeScript.Node[] => {
    const nodes = [node];
    ts.forEachChild(node, (child) => { nodes.push(...all(child)); });
    return nodes;
  };
  const fingerprint = (node: TypeScript.Node): string => {
    const children: string[] = [];
    ts.forEachChild(node, (child) => { children.push(fingerprint(child)); });
    const value = ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
      ? node.text : '';
    return JSON.stringify([node.kind, value, children]);
  };
  const sample = (code: string): TypeScript.Statement => {
    const parsed = ts.createSourceFile('pattern.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return parsed.statements[0];
  };
  const same = (node: TypeScript.Node | undefined, code: string): boolean => !!node && fingerprint(node) === fingerprint(sample(code));
  const hasIdentifier = (name: string): boolean => all().some((node) => ts.isIdentifier(node) && node.text === name);
  const add = (start: number, end: number, replacement: string, tokenRule: CoreMigrationRule = rule): void => {
    if (start !== end) {
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source.text, undefined, start, end - start);
      for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
        if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
          fail('A comment inside the exact edit range requires manual review; comments will not be discarded');
        }
      }
    }
    tokens.push({ start, end, replacement: replacement.replace(/\n/g, eol), rule: tokenRule });
  };
  const replace = (node: TypeScript.Node, replacement: string): void => add(node.getStart(source), node.end, replacement);
  const imported = (module: string, name: string): string | undefined => {
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== module
        || node.importClause?.isTypeOnly) continue;
      const bindings = node.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const item = bindings.elements.find((item) => !item.isTypeOnly && (item.propertyName ?? item.name).text === name);
      if (item) return item.name.text;
    }
    return undefined;
  };
  const importValue = (module: string, name: string, local: string): string => {
    const existing = imported(module, name);
    if (existing) return existing;
    if (hasIdentifier(local)) return fail(`Import binding ${local} already exists`);
    const last = source.statements.filter(ts.isImportDeclaration).at(-1);
    const position = last?.end ?? (source.text.startsWith('\uFEFF') ? 1 : 0);
    add(position, position, `\nimport { ${name === local ? name : `${name} as ${local}`} } from '${module}';`);
    return local;
  };
  const variable = (name: string): TypeScript.VariableDeclaration | undefined =>
    all().find((node): node is TypeScript.VariableDeclaration => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name);
  const callback = (name: string): TypeScript.ArrowFunction | undefined => {
    const node = variable(name)?.initializer;
    return node && ts.isArrowFunction(node) ? node : undefined;
  };
  const block = (fn: TypeScript.ArrowFunction | undefined): TypeScript.Block | undefined => fn && ts.isBlock(fn.body) ? fn.body : undefined;

  const viewer = imported('@beeblock/svelar/logging/LogViewer', 'LogViewer') ?? imported('@beeblock/svelar/logging', 'LogViewer');
  if (viewer) {
    const methods = new Set(['query', 'page', 'getStats', 'getRecentErrors', 'addEntry', 'clear', 'prune']);
    const calls = all().filter((node): node is TypeScript.CallExpression => ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === viewer && methods.has(node.expression.name.text) && !ts.isAwaitExpression(node.parent));
    if (calls.length) {
      if (all().some((node) => (ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name) && node.name.text === viewer)) {
        fail('Shadowed LogViewer binding needs manual review');
      }
      for (const call of calls) {
        let scope: TypeScript.Node = call.parent;
        while (scope !== source && !ts.isArrowFunction(scope) && !ts.isFunctionDeclaration(scope)
          && !ts.isFunctionExpression(scope) && !ts.isMethodDeclaration(scope)) scope = scope.parent;
        if (scope !== source && !ts.canHaveModifiers(scope)) fail('Synchronous LogViewer wrapper needs manual review');
        const modifiers = ts.canHaveModifiers(scope) ? ts.getModifiers(scope) : undefined;
        if (scope !== source && !modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
          fail('Synchronous LogViewer wrapper needs manual review');
        }
        add(call.getStart(source), call.getStart(source), '(await ', 'log-viewer-await');
        add(call.end, call.end, ')', 'log-viewer-await');
      }
    }
  }

  if (rule === 'csrf-exclusions') {
    const nodes = all();
    const propertyName = (node: TypeScript.PropertyName): string | undefined =>
      ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;
    const exclusionName = (node: TypeScript.PropertyName): string | undefined => propertyName(node)
      ?? (ts.isComputedPropertyName(node) && ts.isStringLiteral(node.expression) ? node.expression.text : undefined);
    const exclusions = nodes.filter((node) => (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
      && ['csrfExcludePaths', 'csrfExcludeExactPaths'].includes(exclusionName(node.name) ?? ''));
    if (!exclusions.length && !nodes.some((node) => (ts.isIdentifier(node) || ts.isStringLiteral(node))
      && ['csrfExcludePaths', 'csrfExcludeExactPaths'].includes(node.text))) return tokens;
    const factory = imported('@beeblock/svelar/hooks', 'createSvelarApp');
    if (!factory) fail('CSRF exclusions are not bound to a direct Svelar hooks import');
    const imports = nodes.filter((node): node is TypeScript.ImportSpecifier => ts.isImportSpecifier(node)
      && !node.isTypeOnly && node.name.text === factory && (node.propertyName ?? node.name).text === 'createSvelarApp');
    const calls = nodes.filter((node): node is TypeScript.CallExpression => ts.isCallExpression(node)
      && ts.isIdentifier(node.expression) && node.expression.text === factory);
    if (imports.length !== 1 || calls.length !== 1) fail('Ambiguous createSvelarApp binding/call requires manual review');
    const call = calls[0];
    if (nodes.some((node) => ts.isIdentifier(node) && node.text === factory
      && node !== imports[0].name && node !== imports[0].propertyName && node !== call.expression)) {
      fail('Shadowed or reused createSvelarApp binding requires manual review');
    }
    const declaration = call.parent;
    if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== call
      || !ts.isObjectBindingPattern(declaration.name) || declaration.name.elements.length !== 2
      || declaration.name.elements.some((element, index) => element.dotDotDotToken || element.propertyName || element.initializer
        || !ts.isIdentifier(element.name) || element.name.text !== ['handle', 'handleError'][index])
      || !ts.isVariableDeclarationList(declaration.parent) || declaration.parent.declarations.length !== 1
      || !(declaration.parent.flags & ts.NodeFlags.Const) || !ts.isVariableStatement(declaration.parent.parent)
      || declaration.parent.parent.parent !== source
      || !declaration.parent.parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      || call.typeArguments?.length || call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) {
      fail('Custom createSvelarApp caller/options require manual review');
    }
    const options = call.arguments[0];
    const properties = new Map<string, TypeScript.ObjectLiteralElementLike>();
    for (const property of options.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        fail('Spread or custom CSRF options require manual review');
      }
      const name = propertyName(property.name);
      if (!name || properties.has(name)) fail('Computed or duplicate CSRF option keys require manual review');
      properties.set(name, property);
    }
    const prefix = properties.get('csrfExcludePaths');
    const exact = properties.get('csrfExcludeExactPaths');
    const strings = (property: TypeScript.ObjectLiteralElementLike | undefined): string[] | undefined => {
      if (!property || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return undefined;
      const values: string[] = [];
      for (const element of property.initializer.elements) {
        if (!ts.isStringLiteral(element)) return undefined;
        values.push(element.text);
      }
      return values;
    };
    const paths = strings(prefix);
    const exactPaths = strings(exact);
    if (paths?.length === 1 && paths[0] === '/api/webhooks/incoming/'
      && exactPaths?.length === 1 && exactPaths[0] === '/api/internal/broadcast') return tokens;
    if (exact) fail('Existing exact CSRF exclusions require manual review');
    if (!prefix || !ts.isPropertyAssignment(prefix) || !ts.isArrayLiteralExpression(prefix.initializer)
      || paths?.length !== 2 || !['/api/webhooks', '/api/webhooks/', '/api/webhooks/incoming/'].includes(paths[0]) || paths[1] !== '/api/internal/') {
      fail('Custom CSRF exclusion paths require manual review');
    }
    if (exclusions.length !== 1 || exclusions[0] !== prefix) fail('Additional CSRF option objects require manual review');
    const quote = prefix.initializer.elements[0].getText(source)[0];
    const start = prefix.getStart(source);
    const linePrefix = source.text.slice(source.text.lastIndexOf('\n', start - 1) + 1, start);
    const indent = /^[\t ]*$/.test(linePrefix) ? linePrefix : '  ';
    replace(prefix.initializer, `[${quote}/api/webhooks/incoming/${quote}]`);
    add(prefix.end, prefix.end, `,\n${indent}csrfExcludeExactPaths: [${quote}/api/internal/broadcast${quote}]`);
  } else if (rule === 'provider-bootstrap') {
    const esp = variable('esp');
    if (!esp?.initializer || !ts.isNewExpression(esp.initializer) || !ts.isIdentifier(esp.initializer.expression)
      || esp.initializer.expression.text !== 'EventServiceProvider') return tokens;
    if (esp.initializer.arguments?.length) return tokens;
    if (!esp.initializer.arguments) fail('Expected explicit empty provider constructor parentheses');
    const providerPath = ddd ? 'src/lib/shared/providers/EventServiceProvider.ts' : 'src/lib/providers/EventServiceProvider.ts';
    const providerModule = ddd ? '$lib/shared/providers/EventServiceProvider.js' : '$lib/providers/EventServiceProvider.js';
    const publishedFlatModule = './lib/providers/EventServiceProvider.js';
    if (imported(providerModule, 'EventServiceProvider') !== 'EventServiceProvider'
      && (ddd || imported(publishedFlatModule, 'EventServiceProvider') !== 'EventServiceProvider')) {
      fail('Provider import differs from the known scaffold');
    }
    const provider = read(providerPath);
    if (!provider) fail('Cannot verify the app provider implementation');
    const parsed = ts.createSourceFile(providerPath, provider.toString('utf8'), ts.ScriptTarget.Latest, true);
    const baseImport = parsed.statements.find((node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === '@beeblock/svelar/events');
    const bindings = baseImport && ts.isImportDeclaration(baseImport) ? baseImport.importClause?.namedBindings : undefined;
    const base = bindings && ts.isNamedImports(bindings)
      ? bindings.elements.find((item) => (item.propertyName ?? item.name).text === 'EventServiceProvider')?.name.text : undefined;
    const providerClass = parsed.statements.find((node): node is TypeScript.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'EventServiceProvider');
    if (!base || !providerClass || providerClass.members.some(ts.isConstructorDeclaration)
      || !providerClass.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
        && clause.types.some((type) => ts.isIdentifier(type.expression) && type.expression.text === base))) {
      fail('Custom provider inheritance/constructor cannot be migrated automatically');
    }
    const boot = source.statements.find((node) => same(node, 'esp.boot();'));
    if (!boot || esp.parent.parent.parent !== source) fail('Expected a top-level provider bootstrap and boot call');
    const container = importValue('@beeblock/svelar/container', 'container', 'svelarCoreContainer');
    add(esp.initializer.end - 1, esp.initializer.end - 1, container);
    add(boot.getStart(source), boot.getStart(source), 'await ');
  } else if (rule === 'queue-observations') {
    const queue = imported('@beeblock/svelar/queue', 'Queue');
    if (!queue) return tokens;
    const legacy = all().filter((node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === queue && node.expression.name.text === 'stats');
    if (!legacy.length) return tokens;
    const stats = variable('stats');
    if (legacy.length !== 1 || !stats?.initializer || !ts.isAwaitExpression(stats.initializer)
      || !same(stats.parent.parent, `const stats = await ${queue}.stats();`)) fail('Customized Queue.stats pattern');
    const declarations = all().filter((node) => same(node, 'const { pending, failed } = stats;'));
    if (declarations.length !== 1 || all().filter((node) => ts.isIdentifier(node) && node.text === 'stats').length !== 3) {
      fail('Queue stats has additional uses or customized destructuring');
    }
    replace(stats.initializer, `{ pending: await ${queue}.size(), failed: (await ${queue}.failed()).length }`);
  } else if (rule === 'notification-channels') {
    const base = imported('@beeblock/svelar/notifications', 'Notification');
    const cls = source.statements.find((node): node is TypeScript.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'WelcomeNotification');
    const method = cls?.members.find((node): node is TypeScript.MethodDeclaration => ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'channels');
    if (!method?.body || !all(method.body).some(ts.isAsExpression)) return tokens;
    if (!base || !cls?.heritageClauses?.some((clause) => clause.types.some((type) => ts.isIdentifier(type.expression) && type.expression.text === base))
      || method.parameters.length || method.body.statements.length !== 1 || !same(method.body.statements[0], "return ['database'] as const;")) {
      fail('Customized readonly notification channels need manual review');
    }
    const returned = method.body.statements[0];
    if (!ts.isReturnStatement(returned) || !returned.expression || !ts.isAsExpression(returned.expression)) fail('Unrecognized channel return');
    add(returned.expression.expression.end, returned.expression.end, '');
  } else if (rule === 'admin-user-guards') {
    const load = block(callback('load'));
    const actions = variable('actions')?.initializer;
    const deletion = actions && ts.isObjectLiteralExpression(actions)
      ? actions.properties.find((node): node is TypeScript.PropertyAssignment => ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'deleteUser') : undefined;
    const deleteBody = deletion && ts.isArrowFunction(deletion.initializer) ? block(deletion.initializer) : undefined;
    const needsLoad = load && same(load.statements[0], 'const user = event.locals.user;')
      && !load.statements.some((node) => ts.isIfStatement(node) && all(node.expression).some((part) => ts.isIdentifier(part) && part.text === 'user'));
    const accesses = deleteBody ? all(deleteBody).filter((node) => ts.isPropertyAccessExpression(node)
      && node.name.text === 'id' && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'user'
      && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === 'locals'
      && ts.isIdentifier(node.expression.expression.expression) && node.expression.expression.expression.text === 'event') : [];
    if (!needsLoad && !accesses.length) return tokens;
    if (!load || !same(load.statements[0], 'const user = event.locals.user;') || !deleteBody) fail('Custom admin callback structure');
    if (needsLoad) {
      const redirect = importValue('@sveltejs/kit', 'redirect', 'svelarCoreRedirect');
      const error = importValue('@sveltejs/kit', 'error', 'svelarCoreError');
      add(load.statements[0].end, load.statements[0].end,
        `\n  if (!user) ${redirect}(303, '/login');\n  if (user.role !== 'admin') ${error}(403, 'Forbidden');`);
    }
    if (accesses.length) {
      if (accesses.length !== 1 || !same(deleteBody.statements[0], 'const denied = await authorize(deleteUserRequest, event);')
        || all(deleteBody).some((node) => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'user')) {
        fail('Customized delete-user authorization/access needs manual review');
      }
      const kitFail = imported('@sveltejs/kit', 'fail');
      if (!kitFail) fail('Cannot resolve the existing SvelteKit fail helper');
      add(deleteBody.statements[0].getStart(source), deleteBody.statements[0].getStart(source),
        `const user = event.locals.user;\n    if (!user) return ${kitFail}(401, { error: 'Authentication required.' });\n    if (user.role !== 'admin') return ${kitFail}(403, { error: 'This action is unauthorized.' });\n    `);
      replace(accesses[0], 'user.id');
    }
  } else {
    const queueRule = rule.startsWith('queue-');
    const module = queueRule ? '@beeblock/svelar/queue/JobMonitor' : '@beeblock/svelar/scheduler/ScheduleMonitor';
    const manager = imported(module, queueRule ? 'JobMonitor' : 'ScheduleMonitor');
    const json = imported('@sveltejs/kit', 'json');
    const handler = block(callback(rule === 'queue-delete-outcome' ? 'DELETE' : 'POST'));
    if (!manager || !json || !handler) return tokens;
    const param = queueRule ? 'id' : 'name';
    if (!same(handler.statements[0], `const { ${param} } = event.params;`)) fail('Customized route parameter binding');
    const relevant = all(handler).filter((node): node is TypeScript.CallExpression => ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === manager);
    const method = rule === 'queue-delete-outcome' ? 'deleteJob' : rule === 'queue-retry-outcome' ? 'retryJob' : 'runTask';
    const old = relevant.find((node) => ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === method
      && ts.isAwaitExpression(node.parent) && ts.isExpressionStatement(node.parent.parent));
    const toggles = relevant.filter((node) => ts.isPropertyAccessExpression(node.expression)
      && ['enableTask', 'disableTask'].includes(node.expression.name.text) && ts.isExpressionStatement(node.parent));
    if (!old && !toggles.length) return tokens;
    if (handler.statements.slice(1).some((node) => ts.isIfStatement(node))) fail('Existing custom route guards require manual review');
    add(handler.statements[0].end, handler.statements[0].end,
      `\n  if (!${param}) return ${json}({ success: false, message: '${queueRule ? 'Job id' : 'Task name'} is required' }, { status: 400 });`);
    if (old) {
      if (old.arguments.length !== 1 || !ts.isIdentifier(old.arguments[0]) || old.arguments[0].text !== param
        || hasIdentifier('svelarCoreResult')) fail('Customized operation arguments/result binding');
      const statement = old.parent.parent;
      const prefix = `const svelarCoreResult = await ${manager}.${method}(${param});\n    `;
      if (queueRule) {
        replace(statement, prefix + `if (!svelarCoreResult) return ${json}({ success: false, message: '${rule === 'queue-delete-outcome' ? 'Job not found' : 'Job cannot be retried'}' }, { status: ${rule === 'queue-delete-outcome' ? 404 : 409} });`);
      } else {
        replace(statement, prefix + `if (svelarCoreResult.skipped) return ${json}({ success: false, skipped: true, message: 'Task skipped' }, { status: 409 });\n    if (!svelarCoreResult.success) return ${json}({ success: false, message: 'Task execution failed' }, { status: 500 });`);
      }
    } else {
      if (toggles.length !== 2 || relevant.length !== 2 || toggles.some((node) => node.arguments.length !== 1
        || !ts.isIdentifier(node.arguments[0]) || node.arguments[0].text !== 'name')) fail('Customized toggle operations');
      for (const node of toggles) add(node.getStart(source), node.getStart(source), 'await ');
    }
  }
  return tokens;
}

export async function planCoreScaffoldMigration(directory: string): Promise<CoreMigrationPlan> {
  const root = realpathSync(directory);
  try {
    const require = createRequire(join(root, 'package.json'));
    const url = pathToFileURL(require.resolve('typescript')).href;
    const loaded: typeof TypeScript & { default?: typeof TypeScript } = await import(url);
    return planCoreScaffoldMigrationFromSource(root, loaded.default ?? loaded);
  } catch (error) {
    return { root, edits: [], warnings: [], errors: [`Cannot plan core migration: ${errorMessage(error)}. Install the app compiler with npm install -D typescript.`] };
  }
}

function atomicWrite(path: string, data: Buffer, mode: number): void {
  const temporary = `${path}.core-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, data, { flag: 'wx', mode });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function applyCoreScaffoldMigration(plan: CoreMigrationPlan, options: { confirmed: boolean }): string[] {
  if (!options.confirmed) throw new Error('Core migration requires explicit confirmation or --force');
  if (plan.errors.length) throw new Error(`Core migration preflight failed; no files written:\n${plan.errors.join('\n')}`);
  if (realpathSync(plan.root) !== plan.root) throw new Error('Project root changed after planning');
  const paths = new Set<string>();
  for (const edit of plan.edits) {
    const absolute = checkedPath(plan.root, edit.path);
    if (paths.has(absolute)) throw new Error(`Duplicate core migration path: ${edit.path}`);
    paths.add(absolute);
    if (!readFileSync(absolute).equals(edit.original)) throw new Error(`${edit.path} changed after planning; rerun --dry-run`);
  }
  const backups: string[] = [];
  const written: CoreMigrationFile[] = [];
  try {
    for (const edit of plan.edits) {
      const absolute = checkedPath(plan.root, edit.path);
      for (let suffix = 0; ; suffix++) {
        const backup = `${absolute}.core.bak${suffix ? `.${suffix}` : ''}`;
        try {
          writeFileSync(backup, edit.original, { flag: 'wx', mode: edit.mode });
          backups.push(relative(plan.root, backup));
          break;
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue;
          throw error;
        }
      }
    }
    for (const edit of plan.edits) {
      const absolute = checkedPath(plan.root, edit.path);
      if (!readFileSync(absolute).equals(edit.original)) throw new Error(`${edit.path} changed during migration`);
      atomicWrite(absolute, edit.updated, edit.mode);
      written.push(edit);
    }
  } catch (error) {
    const recovery: string[] = [];
    for (const edit of written.reverse()) {
      try {
        const absolute = checkedPath(plan.root, edit.path);
        if (!readFileSync(absolute).equals(edit.updated)) throw new Error('Concurrent customization preserved; restore manually from backup');
        atomicWrite(absolute, edit.original, edit.mode);
      } catch (rollback) { recovery.push(`${edit.path}: ${errorMessage(rollback)}`); }
    }
    throw new Error(`Core migration failed: ${errorMessage(error)}. Exact backups retained.${recovery.length ? `\nRollback needs review:\n${recovery.join('\n')}` : ''}`);
  }
  return backups;
}
