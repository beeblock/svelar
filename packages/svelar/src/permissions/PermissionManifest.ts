export type CapabilityScope = 'team' | 'platform';
export type CapabilityName = `screen.${string}.view` | `action.${string}.${string}`;

export interface PermissionScreen {
  resource: string;
  label: string;
  group: string;
  route: string;
  scope: CapabilityScope;
}
export interface PermissionAction {
  screen: string;
  action: string;
  label: string;
  dependencies?: readonly CapabilityName[];
  route?: string;
}
export interface LegacyPermissionAlias {
  name: string;
  capabilities: readonly CapabilityName[];
  label?: string;
}
export interface SystemPermissionProfile {
  name: string;
  label: string;
  scope: CapabilityScope;
  defaults: 'all' | readonly CapabilityName[];
}
export interface PermissionManifestDefinition {
  guard?: string;
  screens: readonly PermissionScreen[];
  actions: readonly PermissionAction[];
  aliases?: readonly LegacyPermissionAlias[];
  systemProfiles?: readonly SystemPermissionProfile[];
}
export interface ManifestCapability {
  name: CapabilityName;
  kind: 'screen' | 'action';
  screen: string;
  action: string;
  dependencies: readonly CapabilityName[];
  label: string;
  group: string;
  route?: string;
  scope: CapabilityScope;
  guard: string;
}
export interface ManifestAlias extends LegacyPermissionAlias {
  label: string;
  scope: CapabilityScope;
  deprecated: true;
}
export interface CapabilityBinding {
  name: string;
  file: string;
  line?: number;
  kind?: 'screen' | 'action';
  scope?: CapabilityScope;
}
export interface CapabilityAuditFinding {
  severity: 'error';
  rule: 'capability-manifest';
  file: string;
  line: number;
  message: string;
}

const LIMIT = 10_000;
export function isReservedRoleName(name: string): boolean {
  return ['owner', 'superadmin', 'super-admin', 'super_admin', 'platform-owner', 'platform_owner', 'platform.owner'].includes(name.toLowerCase());
}
export function permissionIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length > 255 || !/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/.test(value) || value.trim() !== value) throw new TypeError(`Invalid ${label}.`);
}
function label(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 255 || /[\x00-\x1f\x7f]/.test(value)) throw new TypeError(`Invalid capability ${field}.`);
}
function scope(value: unknown): asserts value is CapabilityScope {
  if (value !== 'team' && value !== 'platform') throw new TypeError('Capability scope must be team or platform.');
}
function list<T>(value: readonly T[], field: string): readonly T[] {
  if (!Array.isArray(value) || value.length > LIMIT) throw new TypeError(`Invalid or oversized ${field}.`);
  return value;
}
function routePattern(route: string): { pattern: RegExp; rank: number; identity: string } {
  if (typeof route !== 'string' || route.length > 1024 || !route.startsWith('/') || route.includes('//') || /[?#\x00-\x20\x7f\\]/.test(route)) throw new TypeError('Capability routes must be bounded same-origin paths.');
  const segments = route.split('/').filter(Boolean);
  let rank = 0;
  const patterns = segments.map((segment, index) => {
    if (segment === '.' || segment === '..') throw new TypeError('Capability route cannot traverse directories.');
    if (segment === '*' || /^\[\.\.\.[A-Za-z][A-Za-z0-9_]*\]$/.test(segment)) {
      if (index !== segments.length - 1) throw new TypeError('Capability catch-all route must be last.');
      return '.*';
    }
    rank += 10;
    if (/^(?::[A-Za-z][A-Za-z0-9_]*|\[[A-Za-z][A-Za-z0-9_]*(?:=[A-Za-z][A-Za-z0-9_]*)?\])$/.test(segment)) return '[^/]+';
    if (/[\[\]:*]/.test(segment)) throw new TypeError('Unsupported capability route parameter.');
    rank += 1;
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  const identity = `/${patterns.join('/')}`;
  return { pattern: identity === '/' ? /^\/$/ : new RegExp(`^${identity}(?:/|$)`), rank, identity };
}

/** Immutable, code-owned catalog. No database access, wildcard permission names or role-name owner bypass. */
export class PermissionManifest {
  readonly guard: string;
  private readonly entries = new Map<string, ManifestCapability>();
  private readonly legacy = new Map<string, ManifestAlias>();
  private readonly profiles = new Map<string, SystemPermissionProfile>();
  private readonly routes: { capability: ManifestCapability; pattern: RegExp; rank: number }[] = [];

  constructor(definition: PermissionManifestDefinition) {
    this.guard = definition.guard ?? 'web';
    permissionIdentifier(this.guard, 'manifest guard');
    const screens = new Map<string, PermissionScreen>();
    const routes = new Set<string>();
    let references = 0;
    for (const screen of list(definition.screens, 'screens')) {
      permissionIdentifier(screen.resource, 'screen resource'); label(screen.label, 'label'); label(screen.group, 'group'); scope(screen.scope);
      if (screens.has(screen.resource)) throw new Error(`Duplicate permission screen ${screen.resource}.`);
      screens.set(screen.resource, screen);
      const route = routePattern(screen.route);
      if (routes.has(route.identity)) throw new Error(`Ambiguous permission route ${screen.route}.`);
      routes.add(route.identity);
      const capability: ManifestCapability = Object.freeze({ name: `screen.${screen.resource}.view`, kind: 'screen', screen: screen.resource,
        action: 'view', dependencies: Object.freeze([]), label: screen.label, group: screen.group, route: screen.route, scope: screen.scope, guard: this.guard });
      permissionIdentifier(capability.name, 'capability name');
      this.entries.set(capability.name, capability);
      this.routes.push({ ...route, capability });
    }
    for (const action of list(definition.actions, 'actions')) {
      permissionIdentifier(action.screen, 'action screen'); permissionIdentifier(action.action, 'action command'); label(action.label, 'label');
      const screen = screens.get(action.screen);
      if (!screen) throw new Error(`Action screen ${action.screen} is not declared.`);
      const name: CapabilityName = `action.${screen.resource}.${action.action}`;
      permissionIdentifier(name, 'capability name');
      if (this.entries.has(name)) throw new Error(`Duplicate capability ${name}.`);
      if (action.route !== undefined) routePattern(action.route);
      const dependencies = [...new Set<CapabilityName>([`screen.${screen.resource}.view`, ...list(action.dependencies ?? [], 'dependencies')])];
      references += dependencies.length;
      if (references > 100_000) throw new RangeError('Permission manifest exceeds its dependency reference limit.');
      this.entries.set(name, Object.freeze({ name, kind: 'action', screen: screen.resource, action: action.action, dependencies: Object.freeze(dependencies),
        label: action.label, group: screen.group, route: action.route, scope: screen.scope, guard: this.guard }));
    }
    if (this.entries.size > LIMIT) throw new RangeError('Permission manifest exceeds its capability limit.');
    this.validateDependencies();
    for (const alias of list(definition.aliases ?? [], 'aliases')) {
      permissionIdentifier(alias.name, 'legacy alias');
      if (isReservedRoleName(alias.name) || this.entries.has(alias.name) || this.legacy.has(alias.name)) throw new Error(`Reserved or duplicate legacy alias ${alias.name}.`);
      const targets = [...new Set(list(alias.capabilities, 'alias capabilities'))];
      if (!targets.length) throw new Error('Legacy alias requires explicit target capabilities.');
      const targetScope = this.require(targets[0]).scope;
      for (const target of targets) if (this.require(target).scope !== targetScope) throw new Error('Legacy alias cannot cross capability scopes.');
      const aliasLabel = alias.label ?? alias.name; label(aliasLabel, 'alias label');
      this.legacy.set(alias.name, Object.freeze({ name: alias.name, capabilities: Object.freeze(targets), label: aliasLabel, scope: targetScope, deprecated: true }));
    }
    if (this.entries.size + this.legacy.size > LIMIT) throw new RangeError('Permission manifest exceeds its catalog limit.');
    for (const profile of list(definition.systemProfiles ?? [], 'system profiles')) {
      permissionIdentifier(profile.name, 'system profile'); label(profile.label, 'profile label'); scope(profile.scope);
      if (isReservedRoleName(profile.name) || this.profiles.has(profile.name)) throw new Error(`Reserved or duplicate system profile ${profile.name}.`);
      const defaults = profile.defaults === 'all' ? 'all' : Object.freeze(this.exactNames(list(profile.defaults, 'profile defaults'), profile.scope));
      this.profiles.set(profile.name, Object.freeze({ ...profile, defaults }));
    }
    this.routes.sort((a, b) => b.rank - a.rank);
    Object.freeze(this);
  }

  private validateDependencies(): void {
    const checked = new Set<string>();
    const path = new Set<string>();
    const visit = (entry: ManifestCapability, depth: number) => {
      if (path.has(entry.name)) throw new Error(`Circular capability dependency ${entry.name}.`);
      if (depth > 64) throw new Error('Capability dependency depth exceeds 64.');
      if (checked.has(entry.name)) return;
      path.add(entry.name);
      for (const name of entry.dependencies) {
        const dependency = this.require(name);
        if (dependency.scope !== entry.scope) throw new Error(`Capability dependency ${name} crosses scopes.`);
        visit(dependency, depth + 1);
      }
      path.delete(entry.name); checked.add(entry.name);
    };
    for (const entry of this.entries.values()) visit(entry, 0);
  }

  find(name: string): ManifestCapability | null { return this.entries.get(name) ?? null; }
  require(name: string): ManifestCapability {
    const capability = this.find(name);
    if (!capability) throw new Error(`Unknown capability ${name}. Declare it in the permission manifest.`);
    return capability;
  }
  capabilities(targetScope?: CapabilityScope): ManifestCapability[] { return [...this.entries.values()].filter((entry) => !targetScope || entry.scope === targetScope).sort((a, b) => a.name.localeCompare(b.name)); }
  aliases(targetScope?: CapabilityScope): ManifestAlias[] { return [...this.legacy.values()].filter((entry) => !targetScope || entry.scope === targetScope).sort((a, b) => a.name.localeCompare(b.name)); }
  systemProfiles(targetScope?: CapabilityScope): SystemPermissionProfile[] { return [...this.profiles.values()].filter((entry) => !targetScope || entry.scope === targetScope); }
  systemProfile(name: string): SystemPermissionProfile {
    const profile = this.profiles.get(name);
    if (!profile) throw new Error(`Unknown system permission profile ${name}.`);
    return profile;
  }
  resolve(name: string): readonly CapabilityName[] | null { return this.entries.has(name) ? [name as CapabilityName] : this.legacy.get(name)?.capabilities ?? null; }
  exactNames(names: readonly string[], targetScope: CapabilityScope): CapabilityName[] {
    const result = new Set<CapabilityName>();
    for (const name of list(names, 'capability selection')) {
      const targets = this.resolve(name);
      if (!targets) throw new Error(`Unknown capability ${name}.`);
      for (const target of targets) {
        if (this.require(target).scope !== targetScope) throw new Error(`Capability ${target} cannot be granted in ${targetScope} scope.`);
        result.add(target);
      }
    }
    return [...result].sort();
  }
  expandDependencies(names: readonly string[], targetScope: CapabilityScope): CapabilityName[] {
    const selected = new Set(this.exactNames(names, targetScope));
    const add = (name: CapabilityName) => { for (const dependency of this.require(name).dependencies) if (!selected.has(dependency)) { selected.add(dependency); add(dependency); } };
    for (const name of [...selected]) add(name);
    return [...selected].sort();
  }
  removeWithDependents(names: readonly string[], removed: readonly string[], targetScope: CapabilityScope): CapabilityName[] {
    const selected = new Set(this.exactNames(names, targetScope));
    for (const name of this.exactNames(removed, targetScope)) selected.delete(name);
    let changed = true;
    while (changed) {
      changed = false;
      for (const name of selected) if (this.require(name).dependencies.some((dependency) => !selected.has(dependency))) { selected.delete(name); changed = true; }
    }
    return [...selected].sort();
  }
  screenForPath(path: string): ManifestCapability | null {
    if (typeof path !== 'string' || !path.startsWith('/') || path.length > 4096 || /[?#\x00-\x20\x7f]/.test(path)) return null;
    return this.routes.find((route) => route.pattern.test(path))?.capability ?? null;
  }
}

/** Supply explicit static bindings from the architecture AST scan, not inferred directory registration. */
export function auditCapabilityBindings(manifest: PermissionManifest, bindings: readonly CapabilityBinding[]): CapabilityAuditFinding[] {
  return list(bindings, 'capability bindings').flatMap((binding) => {
    const capability = manifest.find(binding.name);
    if (capability && (!binding.kind || capability.kind === binding.kind) && (!binding.scope || capability.scope === binding.scope)) return [];
    return [{ severity: 'error' as const, rule: 'capability-manifest' as const, file: binding.file, line: binding.line ?? 1,
      message: `Undeclared or mismatched static capability ${binding.name}.` }];
  });
}
