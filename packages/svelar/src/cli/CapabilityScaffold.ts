import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type * as TypeScript from 'typescript';
import { Command, type CommandFlag } from './Command.js';
import { architectureSourceUnits, loadArchitectureCompiler, staticString, unwrapExpression } from './ApiFetchMigration.js';
import { PermissionManifest, auditCapabilityBindings, permissionIdentifier, type CapabilityScope, type PermissionManifestDefinition, type CapabilityBinding } from '../permissions/PermissionManifest.js';

type Ts = typeof TypeScript;
export interface CapabilityDecision { public: boolean; resource?: string; permission?: string; scope: CapabilityScope; route: string; }
export interface CapabilityFile { path: string; content: string; }
export interface CapabilityPlan { accessAlias: string; files: readonly CapabilityFile[]; commit(): void; }
export const capabilityFlags: CommandFlag[] = [
  { name: 'capability', description: 'Protected screen resource; derives screen/action capabilities', type: 'string' },
  { name: 'scope', description: 'Capability scope: team or platform', type: 'string' },
  { name: 'screen-route', description: 'Same-origin page path for the protected screen', type: 'string' },
  { name: 'public', description: 'Exempt functional RBAC only; existing authentication and policies remain', type: 'boolean' },
];

class ScaffoldPaths extends Command {
  constructor(private readonly root: string) { super(); }
  name = 'capability:paths'; description = 'Capability scaffold boundaries';
  flags: CommandFlag[] = [{ name: 'module', type: 'string', description: 'Module' }];
  async handle(): Promise<void> {}
  path(path: string): string {
    const target = resolve(this.root, path);
    const within = (base: string, value: string) => { const suffix = relative(base, value); return suffix === '' || suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix); };
    if (!within(this.root, target)) throw new Error('Capability path escapes the project root.');
    const physical = (value: string): string => {
      let ancestor = value;
      for (;;) {
        try { lstatSync(ancestor); }
        catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
          const parent = dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent;
          continue;
        }
        return resolve(realpathSync(ancestor), relative(ancestor, value));
      }
    };
    if (existsSync(this.root) && lstatSync(this.root).isSymbolicLink()) throw new Error('Capability project root must not be a symlink.');
    if (!within(physical(this.root), physical(target))) throw new Error('Capability path escapes the project root through a symlink.');
    return target;
  }
  checkModule(name: string): void { this.generatorName(undefined, { module: name }); }
}
interface ParsedSource {
  source: TypeScript.SourceFile;
  checker: TypeScript.TypeChecker;
  content: string;
  variables: Map<string, TypeScript.Expression>;
  exports: Set<string>;
  imports: Map<string, { module: string; exported: string }>;
}
type StaticValue = null | boolean | number | string | StaticValue[] | { [key: string]: StaticValue };

/** Bounded literal evaluation. Never imports application code or executes a bootstrap to inspect its manifest. */
class ManifestSource {
  readonly ts: Ts;
  private readonly parsed = new Map<string, ParsedSource>();
  private readonly active = new Set<TypeScript.Node>();
  private nodes = 0;
  constructor(readonly root: string, private readonly overrides = new Map<string, string>(), private readonly sourceLimit = 128) { this.ts = loadArchitectureCompiler<Ts>(root, 'typescript'); }
  read(path: string): ParsedSource {
    path = resolve(path);
    const cached = this.parsed.get(path); if (cached) return cached;
    if (this.parsed.size >= this.sourceLimit) throw new Error('Capability source import limit exceeded.');
    const src = resolve(this.root, 'src');
    const suffix = relative(src, path);
    if (suffix === '..' || suffix.startsWith('..' + sep) || resolve(src, suffix) !== path) throw new Error('Manifest imports must remain inside app src/.');
    for (let ancestor = path; ; ancestor = dirname(ancestor)) {
      if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw new Error('Symlinked capability source is not supported.');
      if (ancestor === src) break;
    }
    if (existsSync(path) && lstatSync(path).size > 1_048_576) throw new Error('Capability source exceeds 1 MiB.');
    const content = this.overrides.get(path) ?? readFileSync(path, 'utf8');
    if (content.length > 1_048_576) throw new Error('Capability source exceeds 1 MiB.');
    const { source, checker } = architectureSourceUnits(this.ts, content, path)[0];
    const variables = new Map<string, TypeScript.Expression>();
    const exports = new Set<string>();
    const imports = new Map<string, { module: string; exported: string }>();
    for (const statement of source.statements) {
      if (this.ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (this.ts.isIdentifier(declaration.name) && declaration.initializer) {
          variables.set(declaration.name.text, declaration.initializer);
          if (this.ts.getModifiers(statement)?.some((modifier) => modifier.kind === this.ts.SyntaxKind.ExportKeyword)) exports.add(declaration.name.text);
        }
      }
      if (this.ts.isImportDeclaration(statement) && this.ts.isStringLiteral(statement.moduleSpecifier)) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && this.ts.isNamedImports(bindings)) for (const binding of bindings.elements) imports.set(binding.name.text, { module: statement.moduleSpecifier.text, exported: binding.propertyName?.text ?? binding.name.text });
        if (bindings && this.ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { module: statement.moduleSpecifier.text, exported: '*' });
      }
    }
    const result = { source, checker, content, variables, exports, imports }; this.parsed.set(path, result); return result;
  }
  target(from: string, module: string): string {
    const base = module.startsWith('$lib/') ? resolve(this.root, 'src/lib', module.slice(5)) : module.startsWith('.') ? resolve(dirname(from), module) : undefined;
    if (!base) throw new Error(`Cannot statically evaluate capability import ${module}.`);
    const candidates = /\.[jt]s$/.test(base) ? [base.replace(/\.[jt]s$/, '.ts'), base] : [`${base}.ts`, `${base}.js`, join(base, 'index.ts')];
    const found = candidates.find((candidate) => this.overrides.has(candidate) || existsSync(candidate));
    if (!found) throw new Error(`Missing capability import ${module}.`);
    return found;
  }
  evaluate(node: TypeScript.Expression, path: string, depth = 0): StaticValue {
    const ts = this.ts; node = unwrapExpression(ts, node);
    if (++this.nodes > 50_000 || depth > 64 || this.active.has(node)) throw new Error('Capability literal graph is cyclic or exceeds its bounded limit.');
    this.active.add(node);
    try {
      const text = staticString(ts, node); if (text !== undefined) return text;
      if (ts.isNumericLiteral(node)) return Number(node.text);
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (node.kind === ts.SyntaxKind.NullKeyword) return null;
      if (ts.isArrayLiteralExpression(node)) {
        const result: StaticValue[] = [];
        for (const element of node.elements) {
          if (ts.isSpreadElement(element)) {
            const value = this.evaluate(element.expression, path, depth + 1);
            if (!Array.isArray(value)) throw new Error('Capability array spread must resolve to a literal array.');
            result.push(...value);
          } else result.push(this.evaluate(element, path, depth + 1));
          if (result.length > 10_000) throw new Error('Capability literal array limit exceeded.');
        }
        return result;
      }
      if (ts.isObjectLiteralExpression(node)) {
        const result: { [key: string]: StaticValue } = {};
        for (const property of node.properties) {
          if (ts.isSpreadAssignment(property)) {
            const value = this.evaluate(property.expression, path, depth + 1);
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Capability object spread must resolve to a literal record.');
            for (const [key, entry] of Object.entries(value)) Object.defineProperty(result, key, { value: entry, enumerable: true, configurable: true, writable: true });
            continue;
          }
          if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) throw new Error('Capability records must not contain getters or methods.');
          const key = ts.isIdentifier(property.name) ? property.name.text : staticString(ts, property.name);
          if (!key || Object.hasOwn(result, key)) throw new Error('Duplicate or dynamic capability record key.');
          Object.defineProperty(result, key, { value: this.evaluate(ts.isPropertyAssignment(property) ? property.initializer : property.name, path, depth + 1), enumerable: true, configurable: true, writable: true });
        }
        return result;
      }
      if (ts.isIdentifier(node)) {
        const file = this.read(path); const local = file.variables.get(node.text);
        if (local) return this.evaluate(local, path, depth + 1);
        const imported = file.imports.get(node.text);
        if (imported && imported.exported !== '*') {
          const target = this.target(path, imported.module); const importedFile = this.read(target);
          const declaration = importedFile.exports.has(imported.exported) && importedFile.variables.get(imported.exported);
          if (declaration) return this.evaluate(declaration, target, depth + 1);
        }
      }
      if (ts.isPropertyAccessExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          const imported = this.read(path).imports.get(node.expression.text);
          if (imported?.exported === '*') {
            const target = this.target(path, imported.module); const importedFile = this.read(target);
            const declaration = importedFile.exports.has(node.name.text) && importedFile.variables.get(node.name.text);
            if (declaration) return this.evaluate(declaration, target, depth + 1);
          }
        }
        const value = this.evaluate(node.expression, path, depth + 1);
        if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, node.name.text)) return value[node.name.text];
      }
      throw new Error('Capability definitions must be explicit literal records/imported fragments; dynamic code is not evaluated.');
    } finally { this.active.delete(node); }
  }
  definitionNode(path: string, fragment = false): TypeScript.ObjectLiteralExpression {
    const file = this.read(path); const ts = this.ts;
    const direct = fragment && file.exports.has('capabilities') && file.variables.get('capabilities');
    if (direct) {
      const value = unwrapExpression(ts, direct);
      if (ts.isObjectLiteralExpression(value)) return value;
    }
    if (!fragment) {
      const variable = file.exports.has('permissionManifest') && file.variables.get('permissionManifest');
      if (!variable) throw new Error('Manifest must export permissionManifest as a framework PermissionManifest.');
      const value = unwrapExpression(ts, variable);
      if (!ts.isNewExpression(value) || !ts.isIdentifier(value.expression) || !value.arguments?.[0]) throw new Error('Manifest must construct an explicit framework PermissionManifest.');
      const binding = file.imports.get(value.expression.text);
      if (!['@beeblock/svelar/permissions', '@beeblock/svelar'].includes(binding?.module ?? '') || binding?.exported !== 'PermissionManifest') throw new Error('Manifest constructor must import the framework PermissionManifest.');
      const input = unwrapExpression(ts, value.arguments[0]);
      if (ts.isObjectLiteralExpression(input)) return input;
      if (ts.isIdentifier(input)) {
        const declaration = file.variables.get(input.text); const object = declaration && unwrapExpression(ts, declaration);
        if (object && ts.isObjectLiteralExpression(object)) return object;
      }
    }
    throw new Error('No editable literal permission definition found; review the manifest manually.');
  }
  manifest(path: string): PermissionManifest {
    const value = this.evaluate(this.definitionNode(path), path);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid permission definition.');
    return new PermissionManifest(value as unknown as PermissionManifestDefinition);
  }
}

export function capabilityManifestPath(root: string): string {
  return join(root, existsSync(join(root, 'src/lib/modules')) ? 'src/lib/shared/permissions/manifest.ts' : 'src/lib/permissions/manifest.ts');
}
export function loadCapabilityManifest(root: string): PermissionManifest | null {
  const path = capabilityManifestPath(root);
  return existsSync(path) ? new ManifestSource(root).manifest(path) : null;
}
function appendArrays(reader: ManifestSource, path: string, additions: Record<string, readonly string[]>, fragment: boolean): string {
  const file = reader.read(path); const object = reader.definitionNode(path, fragment); const edits: { start: number; text: string }[] = [];
  for (const [name, entries] of Object.entries(additions)) {
    const property = object.properties.find((property) => reader.ts.isPropertyAssignment(property) && (reader.ts.isIdentifier(property.name) ? property.name.text : staticString(reader.ts, property.name)) === name);
    if (!entries.length && property) continue;
    if (!property) {
      if (object.properties.length && !object.properties.hasTrailingComma && !edits.some((edit) => edit.start === object.properties[object.properties.length - 1].end)) edits.push({ start: object.properties[object.properties.length - 1].end, text: ',' });
      edits.push({ start: object.end - 1, text: `\n  ${name}: [${entries.join(', ')}],\n` });
      continue;
    }
    if (!reader.ts.isPropertyAssignment(property)) throw new Error(`Manifest requires an explicit ${name} array before it can be extended.`);
    const array = unwrapExpression(reader.ts, property.initializer);
    if (!reader.ts.isArrayLiteralExpression(array)) throw new Error(`Manifest ${name} must be an editable literal array.`);
    if (array.elements.length && !array.elements.hasTrailingComma) edits.push({ start: array.elements[array.elements.length - 1].end, text: ',' });
    edits.push({ start: array.end - 1, text: `\n    ${entries.join(',\n    ')},\n  ` });
  }
  let result = file.content;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.start);
  return result;
}

export class CapabilityScaffold {
  static decision(flags: Record<string, unknown>, defaults: { route: string; scope?: CapabilityScope }, allowPermission = false): CapabilityDecision {
    if (flags.public !== undefined && typeof flags.public !== 'boolean') throw new Error('--public must be boolean.');
    const choices = Number(flags.public === true) + Number(flags.capability !== undefined) + Number(flags.permission !== undefined);
    if (choices !== 1) throw new Error('Choose exactly one explicit --capability=<resource> or --public decision' + (allowPermission ? ' (or --permission=<existing capability>).' : '.'));
    if (flags.permission !== undefined && !allowPermission) throw new Error('--permission is only supported by make:route.');
    const scope = flags.scope ?? defaults.scope ?? 'team';
    if (scope !== 'team' && scope !== 'platform') throw new Error('--scope must be team or platform.');
    const route = flags['screen-route'] ?? defaults.route;
    if (typeof route !== 'string') throw new Error('--screen-route requires a path.');
    if (flags.public === true && (flags.scope !== undefined || flags['screen-route'] !== undefined)) throw new Error('Public RBAC exemption cannot also declare a protected scope or screen route.');
    if (flags.capability !== undefined) permissionIdentifier(flags.capability, '--capability');
    if (flags.permission !== undefined && (typeof flags.permission !== 'string' || !/^(?:screen\.|action\.)/.test(flags.permission))) throw new Error('--permission requires a canonical screen/action name.');
    return { public: flags.public === true, resource: flags.capability as string | undefined, permission: flags.permission as string | undefined, scope, route };
  }

  static prepare(moduleName: string, label: string, decision: CapabilityDecision, actions: readonly string[], projectRoot: string = process.cwd()): CapabilityPlan {
    const root = resolve(projectRoot); const paths = new ScaffoldPaths(root); paths.checkModule(moduleName);
    const ddd = existsSync(join(root, 'src/lib/modules'));
    const shared = ddd ? 'src/lib/shared/permissions' : 'src/lib/permissions';
    const accessAlias = ddd ? '$lib/shared/permissions/access.server.js' : '$lib/permissions/access.server.js';
    if (decision.public) return { accessAlias, files: [], commit() {} };
    const centralPath = paths.path(`${shared}/manifest.ts`);
    const files: CapabilityFile[] = [];
    const versions = new Map<string, string | null>();
    const capture = (path: string) => { const value = existsSync(path) ? readFileSync(path, 'utf8') : null; versions.set(path, value); return value; };
    const overrides = new Map<string, string>();
    let central = capture(centralPath);
    if (decision.permission) {
      if (!central) throw new Error('--permission requires an existing explicit permission manifest.');
      const manifest = new ManifestSource(root).manifest(centralPath);
      if (manifest.require(decision.permission).scope !== decision.scope) throw new Error('--permission scope does not match its manifest declaration.');
    } else {
      const resource = decision.resource!;
      const fragmentRel = ddd ? `src/lib/modules/${moduleName}/contracts/capabilities.ts` : `${shared}/capabilities/${moduleName}.ts`;
      const fragmentPath = paths.path(fragmentRel); const fragmentAlias = '$lib/' + fragmentRel.slice('src/lib/'.length).replace(/\.ts$/, '.js');
      const existing = capture(fragmentPath);
      const base = existing ?? `import type { PermissionManifestDefinition } from '@beeblock/svelar/permissions';\n\nexport const capabilities = {\n  screens: [],\n  actions: [],\n  aliases: [],\n  systemProfiles: [],\n} satisfies PermissionManifestDefinition;\n`;
      overrides.set(fragmentPath, base);
      const reader = new ManifestSource(root, overrides); const value = reader.evaluate(reader.definitionNode(fragmentPath, true), fragmentPath);
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.screens) || !Array.isArray(value.actions)) throw new Error('Invalid module capability fragment.');
      const screen = { resource, label, group: moduleName, route: decision.route, scope: decision.scope };
      const previous = value.screens.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.resource === resource);
      if (previous && (typeof previous !== 'object' || Array.isArray(previous) || previous.scope !== decision.scope || previous.route !== decision.route)) throw new Error('Existing screen scope/route conflicts with this capability decision.');
      const existingActions = value.actions;
      const newActions = [...new Set(actions)].filter((action) => !existingActions.some((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.screen === resource && entry.action === action));
      const fragment = appendArrays(reader, fragmentPath, { screens: previous ? [] : [JSON.stringify(screen)],
        actions: newActions.map((action) => JSON.stringify({ screen: resource, action, label: action })),
        ...(value.aliases === undefined ? { aliases: [] } : {}), ...(value.systemProfiles === undefined ? { systemProfiles: [] } : {}) }, true);
      overrides.set(fragmentPath, fragment); files.push({ path: fragmentRel, content: fragment });
      const alias = 'module' + moduleName.split(/[-_]/).map((part) => part[0].toUpperCase() + part.slice(1)).join('') + 'Capabilities';
      central ??= `import { PermissionManifest, type PermissionManifestDefinition } from '@beeblock/svelar/permissions';\n\nexport const permissionDefinition = {\n  screens: [],\n  actions: [],\n  aliases: [],\n  systemProfiles: [\n    { name: 'tenant-admin', label: 'Full product access', scope: 'team', defaults: 'all' },\n    { name: 'platform-operator', label: 'Platform operations', scope: 'platform', defaults: 'all' },\n  ],\n} satisfies PermissionManifestDefinition;\n\nexport const permissionManifest = new PermissionManifest(permissionDefinition);\n`;
      overrides.set(centralPath, central);
      const centralReader = new ManifestSource(root, overrides); const centralFile = centralReader.read(centralPath);
      const imported = [...centralFile.imports.entries()].find(([, entry]) => entry.exported === 'capabilities' && entry.module.replace(/\.js$/, '') === fragmentAlias.replace(/\.js$/, ''));
      const binding = imported?.[0] ?? alias;
      if (!imported && (centralFile.variables.has(alias) || centralFile.imports.has(alias))) throw new Error('Capability module import would collide with an existing binding.');
      const object = centralReader.definitionNode(centralPath);
      const additions: Record<string, string[]> = {};
      for (const key of ['screens', 'actions', 'aliases', 'systemProfiles']) {
        const property = object.properties.find((node) => centralReader.ts.isPropertyAssignment(node) && (centralReader.ts.isIdentifier(node.name) ? node.name.text : staticString(centralReader.ts, node.name)) === key);
        const array = property && centralReader.ts.isPropertyAssignment(property) ? unwrapExpression(centralReader.ts, property.initializer) : undefined;
        const already = array && centralReader.ts.isArrayLiteralExpression(array) && array.elements.some((element) => centralReader.ts.isSpreadElement(element) && centralReader.ts.isPropertyAccessExpression(element.expression)
          && centralReader.ts.isIdentifier(element.expression.expression) && element.expression.expression.text === binding && element.expression.name.text === key);
        additions[key] = already ? [] : [`...${binding}.${key}`];
      }
      central = appendArrays(centralReader, centralPath, additions, false);
      if (!imported) {
        const imports = centralFile.source.statements.filter(centralReader.ts.isImportDeclaration);
        const last = imports[imports.length - 1]; const newline = last ? central.indexOf('\n', last.end) : -1;
        const offset = last ? newline < 0 ? last.end : newline + 1 : centralFile.source.statements[0]?.getStart(centralFile.source) ?? 0;
        central = central.slice(0, offset) + `import { capabilities as ${alias} } from '${fragmentAlias}';\n` + central.slice(offset);
      }
      overrides.set(centralPath, central);
      new ManifestSource(root, overrides).manifest(centralPath);
      files.push({ path: `${shared}/manifest.ts`, content: central });
    }
    for (const file of CapabilityScaffold.supportFiles(ddd)) {
      const path = paths.path(file.path); const existing = capture(path);
      if (existing === null) files.push(file);
      else if (file.path.endsWith('/access.server.ts')) {
        const reader = new ManifestSource(root); const parsed = reader.read(path);
        const declaration = parsed.variables.get('capabilityAccess'); const expression = declaration && unwrapExpression(reader.ts, declaration);
        const binding = expression && reader.ts.isNewExpression(expression) && reader.ts.isIdentifier(expression.expression) ? parsed.imports.get(expression.expression.text) : undefined;
        const argument = expression && reader.ts.isNewExpression(expression) && expression.arguments?.[0];
        const manifestBinding = argument && reader.ts.isIdentifier(argument) ? parsed.imports.get(argument.text) : undefined;
        const resolver = parsed.source.statements.some((statement) => reader.ts.isFunctionDeclaration(statement) && statement.name?.text === 'resolveCapabilityInput' && reader.ts.getModifiers(statement)?.some((modifier) => modifier.kind === reader.ts.SyntaxKind.ExportKeyword)) || parsed.exports.has('resolveCapabilityInput');
        if (!parsed.exports.has('capabilityAccess') || !['@beeblock/svelar/permissions', '@beeblock/svelar'].includes(binding?.module ?? '') || binding?.exported !== 'CapabilityAuthorizer'
          || manifestBinding?.exported !== 'permissionManifest' || resolve(reader.target(path, manifestBinding.module)) !== centralPath || !resolver) throw new Error('Existing capabilityAccess must export an explicit framework authorizer using the central manifest and an exported trusted resolver; review it before generating guards.');
      }
    }
    return { accessAlias, files, commit() {
      for (const [path, expected] of versions) {
        paths.path(relative(root, path));
        const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
        if (current !== expected) throw new Error('Capability scaffold source changed after preflight.');
      }
      for (const file of files) { const path = paths.path(file.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, file.content); }
    } };
  }

  static supportFiles(ddd: boolean, options: { platformOwner?: { module: string; exported: string } } = {}): CapabilityFile[] {
    const shared = ddd ? 'shared/permissions' : 'permissions';
    const owner = options.platformOwner;
    if (owner && (!/^\$lib\/[A-Za-z0-9_./-]+$/.test(owner.module) || owner.module.split('/').includes('..') ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(owner.exported))) throw new TypeError('Invalid platform identity verification import.');
    return [
      { path: `src/lib/${shared}/access.server.ts`, content: `import { CapabilityAuthorizer, type CapabilityAuthorizationInput } from '@beeblock/svelar/permissions';
import { ApplicationContext } from '@beeblock/svelar/support';
import type { RequestEvent } from '@beeblock/svelar/routing';
import { permissionManifest } from './manifest.js';
${owner ? `import { ${owner.exported} as verifyPlatformOwner } from ${JSON.stringify(owner.module)};\n` : ''}

export const capabilityAccess = new CapabilityAuthorizer(permissionManifest${owner ? ', { platformOwner: verifyPlatformOwner }' : ''});

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' ? value as Record<string, unknown> : null; }
function identity(value: unknown): value is string | number { return typeof value === 'string' ? !!value.trim() : typeof value === 'number' && Number.isSafeInteger(value); }

// Read only authentication middleware's locals and its isolated context, never request fields or headers.
export function resolveCapabilityInput(event: RequestEvent): CapabilityAuthorizationInput | null {
  const context = ApplicationContext.snapshot();
  const credential = record(event.locals.apiKey);
  if (credential?.actorType === 'service_account') {
    if (!identity(credential.actorId) || !identity(credential.teamId) || !Array.isArray(credential.permissions) || !credential.permissions.every((name: unknown) => typeof name === 'string')) return null;
    return { principal: { kind: 'service_account', actorId: credential.actorId, teamId: credential.teamId, capabilities: credential.permissions }, scope: { teamId: credential.teamId }, context };
  }
  if (credential && (!Array.isArray(credential.permissions) || !credential.permissions.every((name: unknown) => typeof name === 'string') || (credential.actorType !== undefined && credential.actorType !== 'user'))) return null;
  const user = record(event.locals.user);
  if (!user) return null;
  const value: unknown = typeof user.getAttribute === 'function' ? user.getAttribute('id') : user.id;
  const modelId = typeof value === 'string' && /^[1-9]\\d*$/.test(value) ? Number(value) : value;
  if (typeof modelId !== 'number' || !Number.isSafeInteger(modelId) || modelId < 1) return null;
  const teamId = context.teamId ?? context.tenantId;
  // Match the permission discriminator used by your authenticated user model when customizing auth.
  if (credential?.teamId != null && (!identity(teamId) || String(credential.teamId) !== String(teamId))) return null;
  return { principal: { kind: 'user', modelType: 'User', modelId,
    ...(credential && Array.isArray(credential.permissions) ? { credentialCapabilities: credential.permissions } : {}),
    ...(credential && identity(credential.actorId) ? { actorId: credential.actorId } : {}),
  }, scope: identity(teamId) ? { teamId } : { platform: true }, context };
}
` },
      { path: 'src/lib/database/seeders/CapabilitySeeder.ts', content: `import { Seeder } from '@beeblock/svelar/database';
import { Permissions, PermissionProfiles } from '@beeblock/svelar/permissions';
import { ApplicationContext } from '@beeblock/svelar/support';
import { permissionManifest } from '$lib/${shared}/manifest.js';

export class CapabilitySeeder extends Seeder {
  async run(): Promise<void> {
    Permissions.registerManifest(permissionManifest);
    await Permissions.syncCapabilities({ guard: permissionManifest.guard });
    const teamId = ApplicationContext.get<string | number>('teamId');
    const scopes = [new PermissionProfiles(permissionManifest).forPlatform(), ...(teamId == null ? [] : [new PermissionProfiles(permissionManifest).forTeam(teamId)])];
    for (const scope of scopes) for (const template of permissionManifest.systemProfiles(scope.scope)) {
      const role = await Permissions.findRole(template.name, permissionManifest.guard) ?? await Permissions.createRole({ name: template.name, guard: permissionManifest.guard, description: template.label });
      if (!await scope.get(role.id)) await scope.setSystem(role.id, template.name);
    }
    // Assignment of any role to a user is a separate, explicitly authorized provisioning decision.
  }
}
` },
    ];
  }
}

interface CapabilitySourceFinding { severity: 'error'; rule: string; file: string; line: number; message: string; }
interface SourceReference { node: TypeScript.Node; path: string; framework?: string; }

export function auditProjectCapabilities(project: { root: string; files: readonly string[] }): CapabilitySourceFinding[] {
  const manifest = loadCapabilityManifest(project.root);
  if (!manifest) return [];
  if (project.files.length > 10_000) throw new Error('Capability audit source limit exceeded.');
  const reader = new ManifestSource(project.root, new Map(), 10_000);
  const ts = reader.ts; const bindings: CapabilityBinding[] = []; const findings: CapabilitySourceFinding[] = [];
  const central = resolve(capabilityManifestPath(project.root));
  const exported = (node: TypeScript.Node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const add = (node: TypeScript.Node, path: string, message: string): void => {
    const source = reader.read(path).source;
    findings.push({ severity: 'error', rule: 'capability-binding', file: relative(project.root, path).split(sep).join('/'), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message });
  };
  const importReference = (from: string, module: string, name: string): SourceReference | undefined => {
    if (['@beeblock/svelar/permissions', '@beeblock/svelar/routing', '@beeblock/svelar'].includes(module)) return { path: from, node: reader.read(from).source, framework: name };
    if (!module.startsWith('.') && !module.startsWith('$lib/')) return undefined;
    const path = reader.target(from, module); const file = reader.read(path);
    if (file.exports.has(name)) return { path, node: file.variables.get(name)! };
    const declaration = file.source.statements.find((statement) => (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) && statement.name?.text === name && exported(statement));
    return declaration ? { path, node: declaration } : undefined;
  };
  // Resolve actual lexical declarations, not identifier text: shadowed/fake authorizers cannot prove a guard.
  const reference = (input: TypeScript.Node, path: string, depth = 0): SourceReference | undefined => {
    if (depth > 32) return undefined;
    const node = ts.isExpression(input) ? unwrapExpression(ts, input) : input;
    const file = reader.read(path);
    if (ts.isIdentifier(node)) {
      for (const declaration of file.checker.getSymbolAtLocation(node)?.declarations ?? []) {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer && ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const)) return reference(declaration.initializer, path, depth + 1);
        if (ts.isClassDeclaration(declaration) || ts.isFunctionDeclaration(declaration)) return { node: declaration, path };
        if (ts.isImportSpecifier(declaration) && !declaration.isTypeOnly && !declaration.parent.parent.isTypeOnly) {
          const statement = declaration.parent.parent.parent;
          if (!ts.isImportDeclaration(statement)) continue;
          const module = staticString(ts, statement.moduleSpecifier);
          if (!module) continue;
          const imported = importReference(path, module, (declaration.propertyName ?? declaration.name).text);
          return imported?.framework ? imported : imported && reference(imported.node, imported.path, depth + 1);
        }
      }
      return undefined;
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      for (const declaration of file.checker.getSymbolAtLocation(node.expression)?.declarations ?? []) if (ts.isNamespaceImport(declaration) && !declaration.parent.isTypeOnly) {
        const statement = declaration.parent.parent;
        if (!ts.isImportDeclaration(statement)) continue;
        const module = staticString(ts, statement.moduleSpecifier);
        if (!module) continue;
        const imported = importReference(path, module, node.name.text);
        return imported?.framework ? imported : imported && reference(imported.node, imported.path, depth + 1);
      }
      return undefined;
    }
    return { node, path };
  };
  const isAuthorizer = (expression: TypeScript.Expression, path: string): boolean => {
    const value = reference(expression, path);
    if (!value || !ts.isNewExpression(value.node) || !value.node.arguments?.[0] || reference(value.node.expression, value.path)?.framework !== 'CapabilityAuthorizer') return false;
    const definition = reference(value.node.arguments[0], value.path);
    return !!definition && definition.path === central && ts.isNewExpression(definition.node) && reference(definition.node.expression, definition.path)?.framework === 'PermissionManifest';
  };
  const guardCall = (expression: TypeScript.Expression, path: string, method: string): TypeScript.CallExpression | undefined => {
    const value = reference(expression, path);
    return value && ts.isCallExpression(value.node) && ts.isPropertyAccessExpression(value.node.expression) && value.node.expression.name.text === method && isAuthorizer(value.node.expression.expression, value.path) ? value.node : undefined;
  };
  const firstAuthorize = (body: TypeScript.ConciseBody | undefined, path: string): boolean => {
    if (!body || !ts.isBlock(body)) return false;
    const first = body.statements[0];
    return !!first && ts.isExpressionStatement(first) && ts.isAwaitExpression(first.expression) && !!guardCall(first.expression.expression, path, 'authorize');
  };
  const protectedHandler = (expression: TypeScript.Expression, path: string, method: 'guardEndpoint' | 'guardPageAction'): boolean => {
    if (guardCall(expression, path, method)) return true;
    const value = reference(expression, path);
    if (!value) return false;
    if (ts.isArrowFunction(value.node) || ts.isFunctionExpression(value.node) || ts.isFunctionDeclaration(value.node)) return firstAuthorize(value.node.body, value.path);
    if (!ts.isCallExpression(value.node) || !ts.isPropertyAccessExpression(value.node.expression) || value.node.expression.name.text !== 'handle') return false;
    const handler = staticString(ts, value.node.arguments[0]); const instance = reference(value.node.expression.expression, value.path);
    if (!handler || !instance || !ts.isNewExpression(instance.node)) return false;
    const controller = reference(instance.node.expression, instance.path);
    if (!controller || !ts.isClassDeclaration(controller.node)) return false;
    const frameworkController = controller.node.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.some((base) => reference(base.expression, controller.path)?.framework === 'Controller'));
    if (!frameworkController) return false;
    const member = controller.node.members.find((member) => ts.isMethodDeclaration(member) && (ts.isIdentifier(member.name) ? member.name.text : staticString(ts, member.name)) === handler);
    return !!member && ts.isMethodDeclaration(member) && firstAuthorize(member.body, controller.path);
  };
  const propertyName = (property: TypeScript.PropertyName): string | undefined => ts.isIdentifier(property) ? property.text : staticString(ts, property);
  let work = 0;
  for (const file of project.files) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const path = resolve(project.root, file); const parsed = reader.read(path); const source = parsed.source;
    const route = /\/(?:\+server|\+page\.server|\+layout\.server)\.[jt]s$/.test(path.split(sep).join('/'));
    const publicDecision = ts.getLeadingCommentRanges(parsed.content, 0)?.some((range) => /^\/\/\s*svelar:public(?:\s|$)/.test(parsed.content.slice(range.pos, range.end)));
    const visit = (node: TypeScript.Node): void => {
      if (++work > 1_000_000) throw new Error('Capability audit AST work limit exceeded.');
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && isAuthorizer(node.expression.expression, path)) {
        const method = node.expression.name.text;
        if (['authorize', 'guardEndpoint', 'guardPageAction'].includes(method)) {
          const name = staticString(ts, node.arguments[0]);
          if (name === undefined) add(node, path, 'Capability guards require a static canonical name for audit.');
          else bindings.push({ name, file: relative(project.root, path).split(sep).join('/'), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, ...(method === 'guardPageAction' ? { kind: 'action' as const } : {}) });
        }
        if (method === 'guardPageActions') {
          const input = node.arguments[0] && unwrapExpression(ts, node.arguments[0]);
          if (!input || !ts.isObjectLiteralExpression(input)) add(node, path, 'Named page actions require explicit literal capability bindings.');
          else for (const property of input.properties) {
            if (!ts.isPropertyAssignment(property)) { add(property, path, 'Dynamic page action bindings cannot be audited.'); continue; }
            const action = unwrapExpression(ts, property.initializer);
            const capability = ts.isObjectLiteralExpression(action) && action.properties.find((entry) => ts.isPropertyAssignment(entry) && propertyName(entry.name) === 'capability');
            const name = capability && ts.isPropertyAssignment(capability) ? staticString(ts, capability.initializer) : undefined;
            if (name === undefined) add(property, path, 'Named page actions require a static canonical action capability.');
            else bindings.push({ name, kind: 'action', file: relative(project.root, path).split(sep).join('/'), line: source.getLineAndCharacterOfPosition(property.getStart(source)).line + 1 });
          }
        }
      }
      if (route && !publicDecision && ts.isVariableStatement(node) && exported(node)) for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const name = declaration.name.text;
        if (/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name) && !protectedHandler(declaration.initializer, path, 'guardEndpoint')) add(declaration, path, `${name} needs an explicit framework capability guard or a leading // svelar:public decision.`);
        if (name === 'actions' && !guardCall(declaration.initializer, path, 'guardPageActions')) {
          const actions = unwrapExpression(ts, declaration.initializer);
          if (!ts.isObjectLiteralExpression(actions)) add(declaration, path, 'Page actions require explicit capability bindings.');
          else for (const action of actions.properties) if (!ts.isPropertyAssignment(action) || !protectedHandler(action.initializer, path, 'guardPageAction')) add(action, path, 'Page action needs an explicit framework guard or a leading // svelar:public decision.');
        }
        if (name === 'load') {
          const pagePath = '/' + relative(join(project.root, 'src/routes'), dirname(path)).split(sep).filter((segment) => !segment.startsWith('(')).join('/');
          if (manifest.screenForPath(pagePath) && !guardCall(declaration.initializer, path, 'guardLayout') && !protectedHandler(declaration.initializer, path, 'guardEndpoint')) add(declaration, path, 'Declared screen load requires its capability guard.');
        }
      }
      if (route && !publicDecision && ts.isFunctionDeclaration(node) && exported(node) && node.name && /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(node.name.text) && !firstAuthorize(node.body, path)) add(node, path, 'Exported endpoint needs an explicit first awaited capability guard or a public decision.');
      if (route && !publicDecision && ts.isExportDeclaration(node)) add(node, path, 'Re-exported route handlers require reviewed local capability bindings.');
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...findings, ...auditCapabilityBindings(manifest, bindings)];
}
