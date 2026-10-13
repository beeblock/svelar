import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import type * as TypeScript from 'typescript';
import type * as SvelteCompiler from 'svelte/compiler';
import { Command } from '../Command.js';
import { auditProjectCapabilities } from '../CapabilityScaffold.js';
import {
  architectureSourceUnits, fetchMutation, importedName, isBrowserCall, isGlobalFetch,
  loadArchitectureCompiler, sameOriginPath, staticString, unwrapExpression, type ArchitectureSourceUnit,
} from '../ApiFetchMigration.js';

export interface ArchitectureFinding {
  severity: 'error' | 'warning';
  rule: string;
  file: string;
  line: number;
  message: string;
}

export interface ArchitectureLintOptions {
  /** Capability manifests can contribute findings without executing the app bootstrap. */
  auditCapabilities?: (project: { root: string; files: readonly string[] }) => readonly ArchitectureFinding[];
}

type Ts = typeof TypeScript;
type Role = 'model' | 'repository' | 'query' | 'connection' | 'schema' | 'request' | 'dto' | 'action' | 'controller' | 'job';
interface AppClass { name: string; role?: Role; node: TypeScript.ClassDeclaration; unit: ArchitectureSourceUnit }
interface SourceInfo {
  path: string; absolute: string; content: string; units: ArchitectureSourceUnit[];
  imports: Set<string>; roles: Set<Role>; classes: AppClass[];
}

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.svelte']);
const ROUTES = new Set(['+server.ts', '+server.js', '+page.server.ts', '+page.server.js']);
const SKIP = new Set(['node_modules', '.git', '.svelte-kit', 'build', 'dist', 'coverage', 'tests', '__tests__']);
const WRITE = new Set(['insert', 'insertGetId', 'update', 'delete', 'create', 'save', 'destroy', 'upsert', 'firstOrCreate', 'updateOrCreate', 'restore', 'truncate']);
const PERSISTENCE = new Set([...WRITE, 'query', 'where', 'find', 'findOrFail', 'get', 'first', 'all', 'count', 'paginate', 'raw', 'execute']);
const DDL = new Set(['createTable', 'createTableIfNotExists', 'dropTable', 'dropTableIfExists', 'renameTable', 'alterTable', 'addColumn', 'dropColumn', 'renameColumn', 'createIndex', 'dropIndex']);
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WRITE_NAMES = /^(?:create|store|update|delete|destroy|save|register|remove|revoke|invite|attach|detach|assign|grant|reset|send|toggle|enable|disable|cancel|restore|submit|post|patch)(?:[A-Z_]|$)/;
const FRAMEWORK_ROLES: Readonly<Record<string, Role>> = {
  Model: 'model', Repository: 'repository', QueryBuilder: 'query', Connection: 'connection',
  Schema: 'schema', SchemaBuilder: 'schema', FormRequest: 'request', DTO: 'dto', Action: 'action', Controller: 'controller', Job: 'job',
};

function walk(ts: Ts, root: TypeScript.Node): TypeScript.Node[] {
  const result: TypeScript.Node[] = [];
  const visit = (node: TypeScript.Node): void => { result.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return result;
}

function pathRole(path: string): Role | undefined {
  if (/\/(?:domain\/)?models\//.test(path)) return 'model';
  if (/\/(?:infrastructure\/)?repositories\//.test(path)) return 'repository';
  if (/\/(?:interface\/http\/)?requests\//.test(path)) return 'request';
  if (/\/(?:application\/)?(?:dto|dtos)\//.test(path)) return /Requests?\.[jt]s$/.test(path) ? 'request' : 'dto';
  if (/\/(?:application\/)?actions\//.test(path)) return 'action';
  if (/\/(?:interface\/http\/)?controllers\//.test(path)) return 'controller';
  if (/\/(?:contracts\/)?schemas\//.test(path) || /(?:\.schema|\/schemas)\.[jt]s$/.test(path)) return 'schema';
  if (/Dtos?\.[jt]s$/.test(path) || /DTO\.[jt]s$/.test(path)) return 'dto';
  return undefined;
}

function insideImport(ts: Ts, node: TypeScript.Node): boolean {
  for (let current: TypeScript.Node | undefined = node; current; current = current.parent) if (ts.isImportDeclaration(current)) return true;
  return false;
}

export class LintArchitectureCommand extends Command {
  name = 'lint:architecture';
  description = 'Detect Svelar architecture convention violations';
  flags = [
    { name: 'json', description: 'Output findings as JSON', type: 'boolean' as const },
    { name: 'warnings', description: 'Include warnings in the failure exit code', type: 'boolean' as const, default: false },
  ];

  async handle(_args: string[], flags: Record<string, unknown>): Promise<void> {
    const srcDir = join(process.cwd(), 'src');
    if (!existsSync(srcDir)) { this.warn('No src/ directory found.'); return; }
    const findings = this.scanProject(srcDir);
    const errors = findings.filter((finding) => finding.severity === 'error').length;
    const warnings = findings.length - errors;
    if (flags.json) this.log(JSON.stringify({ errors, warnings, findings }, null, 2));
    else if (!findings.length) this.success('No architecture violations found.');
    else this.table(['Severity', 'Rule', 'Location', 'Message'], findings.map((finding) => [finding.severity, finding.rule, `${finding.file}:${finding.line}`, finding.message]));
    if (errors || flags.warnings && warnings) throw new Error('Architecture lint failed.');
  }

  scanProject(srcDir: string, options: ArchitectureLintOptions = {}): ArchitectureFinding[] {
    const root = dirname(resolve(srcDir));
    const findings: ArchitectureFinding[] = [];
    const sources = new Map<string, SourceInfo>();
    const relativePath = (file: string) => relative(root, file).split(sep).join('/');
    const add = (info: SourceInfo, unit: ArchitectureSourceUnit, node: TypeScript.Node, severity: ArchitectureFinding['severity'], rule: string, message: string): void => {
      const line = info.content.slice(0, unit.offset + node.getStart(unit.source)).split('\n').length;
      if (!findings.some((finding) => finding.file === info.path && finding.line === line && finding.rule === rule)) findings.push({ file: info.path, line, severity, rule, message });
    };
    try {
      const ts = loadArchitectureCompiler<Ts>(root, 'typescript');
      let svelte: typeof SvelteCompiler | undefined;
      let count = 0;
      let bytes = 0;
      const scan = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (SKIP.has(entry.name)) continue;
          const absolute = join(dir, entry.name);
          const path = relativePath(absolute);
          if (entry.isSymbolicLink()) { findings.push({ severity: 'error', rule: 'source-boundary', file: path, line: 1, message: 'Symlinked source is not audited; use app-owned regular source files.' }); continue; }
          if (entry.isDirectory()) { scan(absolute); continue; }
          if (!entry.isFile() || !EXTENSIONS.has(extname(entry.name)) || /\.(?:test|spec|d)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
          const size = lstatSync(absolute).size;
          if (++count > 10000 || (bytes += size) > 64 * 1024 * 1024 || size > 2 * 1024 * 1024) throw new Error('Architecture scan limit exceeded (10,000 files / 64 MiB / 2 MiB per file).');
          try {
            const content = readFileSync(absolute, 'utf8');
            if (path.endsWith('.svelte')) svelte ??= loadArchitectureCompiler<typeof SvelteCompiler>(root, 'svelte/compiler');
            const units = architectureSourceUnits(ts, content, path, svelte);
            const role = pathRole(path);
            sources.set(absolute, { absolute, path, content, units, imports: new Set(), roles: new Set(role ? [role] : []), classes: [] });
          } catch (error) { findings.push({ severity: 'error', rule: 'source-syntax', file: path, line: 1, message: error instanceof Error ? error.message : String(error) }); }
        }
      };
      if (lstatSync(srcDir).isSymbolicLink()) throw new Error('src/ must not be a symlink.');
      scan(srcDir);

      const resolveImport = (info: SourceInfo, module: string): SourceInfo | undefined => {
        const target = module.startsWith('$lib/') ? join(root, 'src/lib', module.slice(5))
          : module.startsWith('.') ? resolve(dirname(info.absolute), module) : undefined;
        if (!target) return undefined;
        for (const candidate of [target, target.replace(/\.[cm]?js$/, '.ts'), `${target}.ts`, `${target}.js`, join(target, 'index.ts'), join(target, 'index.js')]) {
          const source = sources.get(candidate);
          if (source) return source;
        }
        return undefined;
      };
      const imported = (info: SourceInfo, unit: ArchitectureSourceUnit, node: TypeScript.Identifier): { module: string; name: string; target?: SourceInfo } | undefined => {
        const symbol = unit.checker.getSymbolAtLocation(node);
        for (const declaration of symbol?.declarations ?? []) {
          let name: string;
          let statement: TypeScript.Node;
          if (ts.isImportSpecifier(declaration)) { name = (declaration.propertyName ?? declaration.name).text; statement = declaration.parent.parent.parent; }
          else if (ts.isImportClause(declaration)) { name = 'default'; statement = declaration.parent; }
          else if (ts.isNamespaceImport(declaration)) { name = '*'; statement = declaration.parent.parent; }
          else continue;
          if (!ts.isImportDeclaration(statement)) continue;
          const module = staticString(ts, statement.moduleSpecifier);
          if (module) return { module, name, target: resolveImport(info, module) };
        }
        return undefined;
      };
      const exportedClass = (info: SourceInfo, name: string, depth = 0): { owner: SourceInfo; cls: AppClass } | undefined => {
        if (depth > 8) return undefined;
        const cls = info.classes.find((item) => item.name === name || name === 'default'
          && ts.getModifiers(item.node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
        if (cls) return { owner: info, cls };
        for (const unit of info.units) for (const node of unit.source.statements) {
          if (ts.isExportAssignment(node) && name === 'default' && ts.isIdentifier(node.expression)) return exportedClass(info, node.expression.text, depth + 1);
          if (!ts.isExportDeclaration(node)) continue;
          const target = resolveImport(info, staticString(ts, node.moduleSpecifier) ?? '') ?? (!node.moduleSpecifier ? info : undefined);
          if (!target) continue;
          const clause = node.exportClause;
          if (clause && ts.isNamedExports(clause)) {
            const item = clause.elements.find((item) => item.name.text === name);
            if (item) return exportedClass(target, (item.propertyName ?? item.name).text, depth + 1);
          } else if (!clause && target !== info) {
            const found = exportedClass(target, name, depth + 1);
            if (found) return found;
          }
        }
        return undefined;
      };
      const roleOf = (info: SourceInfo, unit: ArchitectureSourceUnit, expression: TypeScript.Expression, depth = 0): Role | undefined => {
        if (depth > 12) return undefined;
        expression = unwrapExpression(ts, expression);
        if (ts.isNewExpression(expression)) return roleOf(info, unit, expression.expression, depth + 1);
        if (ts.isCallExpression(expression)) return roleOf(info, unit, expression.expression, depth + 1);
        if (ts.isPropertyAccessExpression(expression)) {
          const object = expression.expression;
          if (object.kind === ts.SyntaxKind.ThisKeyword) {
            let owner: TypeScript.Node | undefined = expression.parent;
            while (owner && !ts.isClassDeclaration(owner)) owner = owner.parent;
            if (owner && ts.isClassDeclaration(owner)) {
              const property = owner.members.find((member): member is TypeScript.PropertyDeclaration => ts.isPropertyDeclaration(member)
                && ts.isIdentifier(member.name) && member.name.text === expression.name.text);
              if (property?.initializer) return roleOf(info, unit, property.initializer, depth + 1);
              const parameter = owner.members.filter(ts.isConstructorDeclaration).flatMap((ctor) => [...ctor.parameters])
                .find((param) => ts.isIdentifier(param.name) && param.name.text === expression.name.text);
              const type = property?.type ?? parameter?.type;
              if (type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) return roleOf(info, unit, type.typeName, depth + 1);
            }
          }
          if (ts.isIdentifier(object)) {
            const binding = imported(info, unit, object);
            if (binding?.name === '*' && binding.module.startsWith('@beeblock/svelar')) return FRAMEWORK_ROLES[expression.name.text];
          }
          return roleOf(info, unit, object, depth + 1);
        }
        if (!ts.isIdentifier(expression)) return undefined;
        const binding = imported(info, unit, expression);
        if (binding?.module === '@beeblock/svelar' || binding?.module.startsWith('@beeblock/svelar/')) return FRAMEWORK_ROLES[binding.name];
        if (binding?.target) {
          const declaration = exportedClass(binding.target, binding.name);
          return declaration ? declaration.cls.role : pathRole(binding.target.path);
        }
        const symbol = unit.checker.getSymbolAtLocation(expression);
        for (const declaration of symbol?.declarations ?? []) {
          if (ts.isClassDeclaration(declaration)) return info.classes.find((item) => item.node === declaration)?.role;
          if (ts.isVariableDeclaration(declaration) && declaration.initializer) return roleOf(info, unit, declaration.initializer, depth + 1);
          if ((ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) && declaration.type && ts.isTypeReferenceNode(declaration.type)
            && ts.isIdentifier(declaration.type.typeName)) return roleOf(info, unit, declaration.type.typeName, depth + 1);
        }
        return undefined;
      };
      for (const info of sources.values()) {
        for (const unit of info.units) {
          for (const node of walk(ts, unit.source)) {
            if (ts.isImportDeclaration(node)) {
              const target = resolveImport(info, staticString(ts, node.moduleSpecifier) ?? '');
              if (target) info.imports.add(target.absolute);
            }
            if (ts.isExportDeclaration(node)) {
              const target = resolveImport(info, staticString(ts, node.moduleSpecifier) ?? '');
              if (target) info.imports.add(target.absolute);
            }
            if (!ts.isClassDeclaration(node) || !node.name) continue;
            const declaredRole = /(?:Dto|DTO)$/.test(node.name.text) ? 'dto' : pathRole(info.path);
            const role = declaredRole === 'request' || declaredRole === 'model' ? undefined : declaredRole;
            info.classes.push({ name: node.name.text, node, unit, role });
            if (role) info.roles.add(role);
          }
        }
      }
      // Resolve inherited roles after all app-owned declarations have been indexed.
      for (let pass = 0; pass < 4; pass++) {
        for (const info of sources.values()) for (const cls of info.classes) {
          const base = cls.node.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
          const role = base ? roleOf(info, cls.unit, base) : cls.role;
          if (role) { cls.role = role; info.roles.add(role); }
        }
      }
      const usedRoles = (info: SourceInfo, unit: ArchitectureSourceUnit, node: TypeScript.Node): Set<Role> => {
        const roles = new Set<Role>();
        for (const item of walk(ts, node)) if (ts.isIdentifier(item) && !insideImport(ts, item)) {
          const role = roleOf(info, unit, item);
          if (role) roles.add(role);
        }
        return roles;
      };
      let graphTruncated = false;
      const dependencies = (initial: Iterable<string>): Set<string> => {
        const seen = new Set<string>();
        const queue = [...initial];
        while (queue.length && seen.size < 256) {
          const path = queue.shift()!;
          if (seen.has(path)) continue;
          seen.add(path);
          queue.push(...sources.get(path)?.imports ?? []);
        }
        if (queue.length) graphTruncated = true;
        return seen;
      };
      const flowRoles = (info: SourceInfo, unit: ArchitectureSourceUnit, node: TypeScript.Node): Set<Role> => {
        const roles = new Set<Role>();
        const queue = [{ info, unit, node }];
        const seen = new Set<TypeScript.Node>();
        while (queue.length && seen.size < 256) {
          const current = queue.shift()!;
          if (seen.has(current.node)) continue;
          seen.add(current.node);
          for (const role of usedRoles(current.info, current.unit, current.node)) roles.add(role);
          for (const item of walk(ts, current.node)) {
            if (!ts.isIdentifier(item) || insideImport(ts, item)) continue;
            const binding = imported(current.info, current.unit, item);
            if (!binding?.target) continue;
            const declared = exportedClass(binding.target, binding.name);
            if (declared) {
              if (declared.cls.role) roles.add(declared.cls.role);
              queue.push({ info: declared.owner, unit: declared.cls.unit, node: declared.cls.node });
            } else {
              const role = pathRole(binding.target.path);
              if (role) roles.add(role);
              for (const part of binding.target.units) queue.push({ info: binding.target, unit: part, node: part.source });
            }
          }
        }
        if (queue.length) graphTruncated = true;
        return roles;
      };
      const bootstrapPaths = dependencies([...sources.keys()].filter((path) => /^src\/(?:app|hooks\.server)\.[jt]s$/.test(relativePath(path))));
      const registered = new Set<string>();
      let dynamicRegistration = false;
      const jobIdentity = (info: SourceInfo, unit: ArchitectureSourceUnit, value: TypeScript.Expression): string | undefined => {
        value = unwrapExpression(ts, value);
        if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) {
          const binding = imported(info, unit, value.expression);
          const found = binding?.name === '*' && binding.target ? exportedClass(binding.target, value.name.text) : undefined;
          return found?.cls.role === 'job' ? `${found.owner.path}#${found.cls.name}` : undefined;
        }
        if (!ts.isIdentifier(value)) return undefined;
        const binding = imported(info, unit, value);
        const found = exportedClass(binding?.target ?? info, binding?.name ?? value.text);
        return found?.cls.role === 'job' ? `${found.owner.path}#${found.cls.name}` : undefined;
      };
      const registerArray = (info: SourceInfo, unit: ArchitectureSourceUnit, value: TypeScript.Expression, depth = 0): void => {
        value = unwrapExpression(ts, value);
        if (depth > 8) { dynamicRegistration = true; return; }
        if (ts.isIdentifier(value)) {
          const declaration = unit.checker.getSymbolAtLocation(value)?.declarations?.find(ts.isVariableDeclaration);
          if (declaration?.initializer) { registerArray(info, unit, declaration.initializer, depth + 1); return; }
        }
        if (!ts.isArrayLiteralExpression(value)) { dynamicRegistration = true; return; }
        for (const item of value.elements) {
          if (ts.isSpreadElement(item)) { registerArray(info, unit, item.expression, depth + 1); continue; }
          const identity = jobIdentity(info, unit, item);
          if (identity) registered.add(identity);
        }
      };
      for (const info of sources.values()) for (const unit of info.units) {
        const allowedPersistence = /\/(?:models|repositories|migrations|seeders|factories)\//.test(info.path);
        const migration = /\/migrations\//.test(info.path);
        const route = ROUTES.has(info.path.split('/').at(-1)!);
        const publicNames = new Map<string, string>();
        for (const statement of unit.source.statements) {
          if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
          for (const item of statement.exportClause.elements) publicNames.set((item.propertyName ?? item.name).text, item.name.text);
        }
        for (const node of walk(ts, unit.source)) {
          let enclosing: TypeScript.Node | undefined = node.parent;
          while (enclosing && !ts.isClassDeclaration(enclosing)) enclosing = enclosing.parent;
          const ownerRole = enclosing && ts.isClassDeclaration(enclosing) ? info.classes.find((cls) => cls.node === enclosing)?.role : undefined;
          const persistenceAllowed = allowedPersistence || ownerRole === 'model' || ownerRole === 'repository';
          if (ts.isNewExpression(node) && roleOf(info, unit, node.expression) === 'query' && !persistenceAllowed) {
            add(info, unit, node, 'warning', 'repository-persistence', 'QueryBuilder construction belongs in repository/model or migration infrastructure.');
            if (route) add(info, unit, node, 'error', 'thin-routes', 'Route files must delegate persistence to controllers/actions/repositories.');
          }
          if (!ts.isCallExpression(node)) continue;
          if (ts.isPropertyAccessExpression(node.expression)) {
            const method = node.expression.name.text;
            const receiver = roleOf(info, unit, node.expression.expression);
            const persistence = receiver && ['model', 'query', 'connection'].includes(receiver) && PERSISTENCE.has(method);
            if (persistence && !persistenceAllowed) {
              add(info, unit, node, 'warning', method === 'raw' ? 'no-runtime-raw-sql' : 'repository-persistence', 'Persistence belongs in repositories/models; isolate justified low-level SQL in infrastructure.');
              if (route) add(info, unit, node, 'error', 'thin-routes', 'Route files must delegate persistence instead of doing database work directly.');
            }
            const sqlPrefix = (value: TypeScript.Expression | undefined, depth = 0): string | undefined => {
              if (!value || depth > 8) return undefined;
              value = unwrapExpression(ts, value);
              if (ts.isTemplateExpression(value)) return value.head.text;
              if (ts.isIdentifier(value)) {
                const declaration = unit.checker.getSymbolAtLocation(value)?.declarations?.find(ts.isVariableDeclaration);
                return declaration?.initializer ? sqlPrefix(declaration.initializer, depth + 1) : undefined;
              }
              return staticString(ts, value);
            };
            const sql = sqlPrefix(node.arguments[0]);
            const genericDdl = DDL.has(method) && (!['createIndex', 'dropIndex'].includes(method) || receiver === 'schema');
            if (!migration && (genericDdl || receiver === 'schema' && ['create', 'table', 'drop', 'dropIfExists', 'rename', 'alter'].includes(method)
              || receiver && ['connection', 'query'].includes(receiver) && ['raw', 'execute', 'query'].includes(method) && sql && /^\s*(?:CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql))) {
              add(info, unit, node, 'error', 'no-runtime-ddl', 'Schema changes must live in migrations, never runtime boot, requests, services or jobs.');
            }
            const object = node.expression.expression;
            const queue = ts.isIdentifier(object) && (importedName(ts, unit, object, '@beeblock/svelar/queue', 'Queue') || importedName(ts, unit, object, '@beeblock/svelar', 'Queue'))
              || ts.isPropertyAccessExpression(object) && object.name.text === 'Queue' && ts.isIdentifier(object.expression)
                && ['@beeblock/svelar/queue', '@beeblock/svelar'].includes(imported(info, unit, object.expression)?.module ?? '')
                && imported(info, unit, object.expression)?.name === '*';
            if (queue && bootstrapPaths.has(info.absolute) && ['register', 'registerAll'].includes(method) && node.arguments[0]) {
              let scope: TypeScript.Node = node;
              while (scope.parent && !ts.isFunctionLike(scope)) scope = scope.parent;
              if (ts.isFunctionLike(scope)) { dynamicRegistration = true; continue; }
              if (method === 'registerAll') registerArray(info, unit, node.arguments[0]);
              else { const identity = jobIdentity(info, unit, node.arguments[0]); if (identity) registered.add(identity); }
            }
          }
          if (isGlobalFetch(ts, unit, node)) {
            const mutation = fetchMutation(ts, node);
            const url = staticString(ts, node.arguments[0]);
            const possibleBrowser = isBrowserCall(ts, unit, node) || unit.context === 'instance';
            if (possibleBrowser && mutation.method && MUTATIONS.has(mutation.method) && !mutation.csrf && (url === undefined || sameOriginPath(url))) {
              add(info, unit, node, 'warning', 'csrf-api-fetch', 'Same-origin browser mutations need apiFetch or an explicit CSRF header; server/external fetch is not rewritten.');
            }
          }
        }
        for (const node of walk(ts, unit.source)) {
          const variable = ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) ? node : undefined;
          const exportedFunction = ts.isFunctionDeclaration(node) && node.name && (publicNames.has(node.name.text)
            || ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) ? node : undefined;
          const name = variable && ts.isIdentifier(variable.name) ? variable.name.text : exportedFunction?.name?.text;
          const publicName = name ? publicNames.get(name) ?? name : undefined;
          const routeHandler = route && publicName && ['GET', 'HEAD', 'OPTIONS', ...MUTATIONS].includes(publicName) && (exportedFunction || name && publicNames.has(name) || variable && ts.isVariableStatement(variable.parent.parent)
            && ts.getModifiers(variable.parent.parent)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
          const mutationRoute = routeHandler && publicName && MUTATIONS.has(publicName);
          const cls = ts.isClassDeclaration(node) ? info.classes.find((item) => item.node === node) : undefined;
          const pageAction = route && /\+page\.server\.[jt]s$/.test(info.path) && ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)
            && ts.isVariableDeclaration(node.parent.parent) && ts.isIdentifier(node.parent.parent.name) && node.parent.parent.name.text === 'actions';
          const methodName = ts.isMethodDeclaration(node) ? ts.isIdentifier(node.name) ? node.name.text : staticString(ts, node.name) ?? '' : '';
          const controllerMethod = ts.isMethodDeclaration(node) && info.roles.has('controller') && WRITE_NAMES.test(methodName);
          const writeAction = cls?.role === 'action' && (WRITE_NAMES.test(cls.name.charAt(0).toLowerCase() + cls.name.slice(1))
            || walk(ts, cls.node).some((item) => ts.isCallExpression(item) && ts.isPropertyAccessExpression(item.expression)
              && WRITE.has(item.expression.name.text) && ['model', 'query', 'connection', 'repository'].includes(roleOf(info, unit, item.expression.expression) ?? '')));
          if (!routeHandler && !controllerMethod && !writeAction && !pageAction) continue;
          const statementCount = walk(ts, node).filter((item) => ts.isStatement(item) && !ts.isBlock(item)).length;
          if (route && statementCount > 25) add(info, unit, node, 'warning', 'thin-routes', 'Large inline route handler should move business logic into application layers.');
          if (routeHandler && !mutationRoute) continue;
          const roles = flowRoles(info, unit, node);
          if (mutationRoute && !roles.has('controller')) add(info, unit, node, 'warning', 'controller-flow', 'Mutating route should delegate through a controller with Request, DTO and action layers.');
          if (mutationRoute && roles.has('controller')) continue;
          if (writeAction) for (const caller of sources.values()) if (caller.imports.has(info.absolute) && caller.roles.has('controller')) {
            for (const part of caller.units) for (const method of walk(ts, part.source).filter(ts.isMethodDeclaration)) {
              const referencesAction = walk(ts, method).some((item) => {
                if (!ts.isIdentifier(item)) return false;
                const binding = imported(caller, part, item);
                return binding?.target && exportedClass(binding.target, binding.name)?.cls.node === node;
              });
              if (referencesAction) for (const role of flowRoles(caller, part, method)) roles.add(role);
            }
          }
          const missing = (['request', 'dto', 'action', 'schema'] as const).filter((role) => !roles.has(role) && !(role === 'action' && writeAction));
          if (missing.length) add(info, unit, node, 'warning', 'write-flow', `No linked ${missing.map((role) => role === 'request' ? 'FormRequest' : role === 'dto' ? 'DTO' : role === 'schema' ? 'shared schema' : 'action').join(', ')} observed for this write workflow; unrelated project artifacts do not satisfy it.`);
        }
      }
      for (const info of sources.values()) for (const cls of info.classes) {
        if (cls.role !== 'job' || ts.getModifiers(cls.node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword)) continue;
        if (!registered.has(`${info.path}#${cls.name}`)) add(info, cls.unit, cls.node, 'warning', dynamicRegistration || graphTruncated ? 'job-registration-unknown' : 'unregistered-job',
          dynamicRegistration || graphTruncated ? 'Dynamic or bounded bootstrap analysis cannot prove this app job is registered; verify explicit Queue.register/registerAll coverage.'
            : 'App-owned job has no Queue.register/registerAll entry reachable from app/bootstrap imports; job directories are not auto-registered.');
      }
      if (graphTruncated) findings.push({ severity: 'warning', rule: 'analysis-limit', file: 'src', line: 1, message: 'A workflow/bootstrap graph exceeded 256 nodes; unverified relationships require manual review.' });
      const capabilityProject = { root, files: [...sources.values()].map((info) => info.path) };
      findings.push(...auditProjectCapabilities(capabilityProject));
      if (options.auditCapabilities) findings.push(...options.auditCapabilities(capabilityProject));
    } catch (error) { findings.push({ severity: 'error', rule: 'architecture-scan', file: 'src', line: 1, message: error instanceof Error ? error.message : String(error) }); }
    return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  }
}
