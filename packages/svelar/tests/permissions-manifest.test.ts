import { afterEach, describe, expect, it } from 'vitest';
import { PermissionManifest, auditCapabilityBindings, type PermissionManifestDefinition } from '../src/permissions/PermissionManifest';
import { capabilityClient, type CapabilitySnapshot } from '../src/permissions/client';
import { Permissions } from '../src/permissions';

function definition(): PermissionManifestDefinition {
  return {
    screens: [
      { resource: 'boards', label: 'Boards', group: 'Workspace', route: '/boards', scope: 'team' },
      { resource: 'platform', label: 'Platform', group: 'Platform', route: '/admin', scope: 'platform' },
    ],
    actions: [
      { screen: 'boards', action: 'create', label: 'Create' },
      { screen: 'boards', action: 'publish', label: 'Publish', dependencies: ['action.boards.create'] },
      { screen: 'boards', action: 'delete', label: 'Delete' },
      { screen: 'platform', action: 'manage', label: 'Manage platform' },
    ],
    aliases: [{ name: 'manage-boards', label: 'Legacy board manager', capabilities: ['screen.boards.view', 'action.boards.create'] }],
    systemProfiles: [{ name: 'tenant-admin', label: 'Full product access', scope: 'team', defaults: 'all' }],
  };
}
afterEach(() => Permissions.clearCapabilities());

describe('explicit permission manifest', () => {
  it('derives stable names with typed labels, group, route, scope and view dependencies', () => {
    const manifest = new PermissionManifest(definition());
    expect(manifest.require('action.boards.publish')).toEqual({
      name: 'action.boards.publish', kind: 'action', screen: 'boards', action: 'publish', label: 'Publish', group: 'Workspace',
      scope: 'team', guard: 'web', route: undefined, dependencies: ['screen.boards.view', 'action.boards.create'],
    });
    expect(manifest.require('screen.boards.view').route).toBe('/boards');
    expect(manifest.capabilities('team').every((entry) => entry.scope === 'team')).toBe(true);
    expect(manifest.find('undeclared')).toBeNull();
  });

  it('keeps aliases visible and seeds them through the existing generic registry', () => {
    const manifest = new PermissionManifest(definition());
    expect(manifest.aliases('team')).toEqual([{ name: 'manage-boards', label: 'Legacy board manager', scope: 'team', deprecated: true, capabilities: ['screen.boards.view', 'action.boards.create'] }]);
    Permissions.registerManifest(manifest);
    expect(Permissions.findCapability('manage-boards')).toMatchObject({ metadata: { deprecated: true, capabilities: ['screen.boards.view', 'action.boards.create'] } });
    expect(Permissions.findCapability('action.boards.create')).toMatchObject({ label: 'Create', scope: 'team', dependencies: ['screen.boards.view'] });
  });

  it('does not retain mutable caller definitions or allow catalog object mutation', () => {
    const screens = [{ resource: 'boards', label: 'Boards', group: 'App', route: '/boards', scope: 'team' as const }];
    const dependencies: ('screen.boards.view')[] = [];
    const manifest = new PermissionManifest({ screens, actions: [{ screen: 'boards', action: 'create', label: 'Create', dependencies }] });
    screens[0].label = 'Changed'; dependencies.push('screen.boards.view');
    expect(manifest.require('screen.boards.view').label).toBe('Boards');
    expect(Object.isFrozen(manifest.require('action.boards.create'))).toBe(true);
    expect(Object.isFrozen(manifest.require('action.boards.create').dependencies)).toBe(true);
  });

  it('fails fast for actions whose screen or dependency is missing', () => {
    expect(() => new PermissionManifest({ ...definition(), actions: [{ screen: 'missing', action: 'create', label: 'Create' }] })).toThrow('not declared');
    expect(() => new PermissionManifest({ ...definition(), actions: [{ screen: 'boards', action: 'create', label: 'Create', dependencies: ['action.boards.missing'] }] })).toThrow('Unknown capability');
  });

  it('rejects cyclic and cross-scope dependencies', () => {
    expect(() => new PermissionManifest({ ...definition(), actions: [
      { screen: 'boards', action: 'one', label: 'One', dependencies: ['action.boards.two'] },
      { screen: 'boards', action: 'two', label: 'Two', dependencies: ['action.boards.one'] },
    ] })).toThrow('Circular');
    expect(() => new PermissionManifest({ ...definition(), actions: [{ screen: 'boards', action: 'create', label: 'Create', dependencies: ['screen.platform.view'] }] })).toThrow('crosses scopes');
  });

  it('rejects duplicate screens, actions, aliases and profiles', () => {
    const base = definition();
    expect(() => new PermissionManifest({ ...base, screens: [...base.screens, base.screens[0]] })).toThrow('Duplicate');
    expect(() => new PermissionManifest({ ...base, actions: [...base.actions, base.actions[0]] })).toThrow('Duplicate');
    expect(() => new PermissionManifest({ ...base, aliases: [base.aliases![0], base.aliases![0]] })).toThrow('duplicate');
    expect(() => new PermissionManifest({ ...base, systemProfiles: [base.systemProfiles![0], base.systemProfiles![0]] })).toThrow('duplicate');
  });

  it('rejects reserved platform identities and aliases that broaden across scopes', () => {
    for (const name of ['owner', 'SUPERADMIN', 'platform.owner']) {
      expect(() => new PermissionManifest({ ...definition(), aliases: [{ name, capabilities: ['screen.boards.view'] }] })).toThrow('Reserved');
      expect(() => new PermissionManifest({ ...definition(), systemProfiles: [{ name, label: 'Reserved', scope: 'team', defaults: 'all' }] })).toThrow('Reserved');
    }
    expect(() => new PermissionManifest({ ...definition(), aliases: [{ name: 'legacy', capabilities: ['screen.boards.view', 'screen.platform.view'] }] })).toThrow('cross');
    expect(() => new PermissionManifest({ ...definition(), systemProfiles: [{ name: 'tenant-admin', label: 'Admin', scope: 'team', defaults: ['screen.platform.view'] }] })).toThrow('cannot be granted');
  });

  it('provides dependency selection/removal helpers without changing exact selections', () => {
    const manifest = new PermissionManifest(definition());
    expect(manifest.exactNames(['action.boards.publish'], 'team')).toEqual(['action.boards.publish']);
    expect(manifest.expandDependencies(['action.boards.publish'], 'team')).toEqual(['action.boards.create', 'action.boards.publish', 'screen.boards.view']);
    expect(manifest.removeWithDependents(['screen.boards.view', 'action.boards.create', 'action.boards.publish', 'action.boards.delete'], ['action.boards.create'], 'team')).toEqual(['action.boards.delete', 'screen.boards.view']);
    expect(manifest.removeWithDependents(manifest.expandDependencies(['action.boards.publish'], 'team'), ['screen.boards.view'], 'team')).toEqual([]);
  });

  it('validates exact selections, including scope and alias expansion', () => {
    const manifest = new PermissionManifest(definition());
    expect(manifest.exactNames(['manage-boards', 'screen.boards.view'], 'team')).toEqual(['action.boards.create', 'screen.boards.view']);
    expect(() => manifest.exactNames(['missing'], 'team')).toThrow('Unknown');
    expect(() => manifest.exactNames(['screen.platform.view'], 'team')).toThrow('scope');
  });

  it('resolves longest screen routes and does not treat root as permission for every URL', () => {
    const manifest = new PermissionManifest({ ...definition(), screens: [
      ...definition().screens,
      { resource: 'home', label: 'Home', group: 'App', route: '/', scope: 'team' },
      { resource: 'details', label: 'Detail', group: 'App', route: '/boards/[id]', scope: 'team' },
      { resource: 'new', label: 'New', group: 'App', route: '/boards/new', scope: 'team' },
    ] });
    expect(manifest.screenForPath('/')).toMatchObject({ name: 'screen.home.view' });
    expect(manifest.screenForPath('/boards/123')).toMatchObject({ name: 'screen.details.view' });
    expect(manifest.screenForPath('/boards/new')).toMatchObject({ name: 'screen.new.view' });
    expect(manifest.screenForPath('/admin')).toMatchObject({ scope: 'platform' });
    expect(manifest.screenForPath('/undeclared')).toBeNull();
    expect(manifest.screenForPath('/boards-elsewhere')).toBeNull();
  });

  it('rejects route aliases, external paths, traversal and unsupported parameters', () => {
    for (const route of ['https://external.test', '//evil', '/boards/../admin', '/boards?query=1', '/boards/[[id]]', '/boards/*/more']) {
      expect(() => new PermissionManifest({ screens: [{ ...definition().screens[0], route }], actions: [] })).toThrow();
    }
    expect(() => new PermissionManifest({ screens: [
      { ...definition().screens[0], route: '/boards/[id]' },
      { ...definition().screens[0], resource: 'detail', route: '/boards/:other' },
    ], actions: [] })).toThrow('Ambiguous');
  });

  it('fails closed for explicit static action/scope mismatches in the lint hook contract', () => {
    const manifest = new PermissionManifest(definition());
    const findings = auditCapabilityBindings(manifest, [
      { name: 'action.boards.create', file: 'src/routes/boards/+page.server.ts', kind: 'action', scope: 'team' },
      { name: 'action.boards.missing', file: 'src/routes/boards/+page.server.ts', line: 8, kind: 'action' },
      { name: 'screen.platform.view', file: 'src/routes/admin/+page.server.ts', kind: 'action', scope: 'team' },
    ]);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ rule: 'capability-manifest', severity: 'error', line: 8 });
  });

  it('bounds catalog identifiers and dependency depth', () => {
    expect(() => new PermissionManifest({ screens: [{ ...definition().screens[0], resource: 'x'.repeat(250) }], actions: [] })).toThrow('capability name');
    expect(() => new PermissionManifest({ ...definition(), screens: Array(10_001).fill(definition().screens[0]) })).toThrow('oversized');
    const actions = Array.from({ length: 67 }, (_, index) => ({ screen: 'boards', action: `a${index}`, label: 'A', dependencies: index === 66 ? [] : [`action.boards.a${index + 1}` as const] }));
    expect(() => new PermissionManifest({ screens: [definition().screens[0]], actions })).toThrow('depth');
  });
});

function snapshot(): CapabilitySnapshot {
  return { version: 1, scope: 'team', teamId: 'a', guard: 'web', known: ['screen.boards.view', 'action.boards.create'],
    capabilities: ['screen.boards.view'], aliases: { legacy: ['screen.boards.view', 'action.boards.create'] } };
}
describe('client-safe server snapshots', () => {
  it('can/canAny use only calculated grants and require every alias target', () => {
    const client = capabilityClient(snapshot());
    expect(client.can('screen.boards.view')).toBe(true);
    expect(client.can('action.boards.create')).toBe(false);
    expect(client.can('legacy')).toBe(false);
    expect(client.can('unknown')).toBe(false);
    expect(client.can('owner')).toBe(false);
    expect(client.canAny(['unknown', 'screen.boards.view'])).toBe(true);
    expect(client.canAny([])).toBe(false);
  });
  it('copies snapshots so callers cannot silently change an existing helper', () => {
    const value = snapshot();
    const client = capabilityClient(value);
    (value.capabilities as string[]).push('action.boards.create');
    expect(client.can('action.boards.create')).toBe(false);
  });
  it('rejects malformed, unknown or contradictory snapshot grants', () => {
    for (const value of [null, { ...snapshot(), version: 2 }, { ...snapshot(), capabilities: ['owner'] }, { ...snapshot(), known: ['owner'], capabilities: ['owner'] },
      { ...snapshot(), aliases: { invalid: ['missing'] } }, { ...snapshot(), teamId: null }, { ...snapshot(), scope: 'platform', teamId: 'tenant' }]) {
      expect(() => capabilityClient(value as CapabilitySnapshot)).toThrow();
    }
  });
});
