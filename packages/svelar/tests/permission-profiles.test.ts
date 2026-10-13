import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { z } from 'zod/v4';
import { Connection } from '../src/database/Connection';
import {
  CreateTeamsTable, CreateRolesTable, CreatePermissionsTable, CreateRoleHasPermissionsTable,
  CreateModelHasRolesTable, CreateModelHasPermissionsTable, CreateTeamRoleHasPermissionsTable,
  CreateTeamModelHasRolesTable, CreateTeamModelHasPermissionsTable,
} from '../src/database/CoreMigrations';
import { CreateRoleCapabilityProfilesTable } from '../src/database/core/00000000_000040_create_role_capability_profiles_table';
import { CreateTeamRoleCapabilityProfilesTable } from '../src/database/core/00000000_000041_create_team_role_capability_profiles_table';
import { QueryBuilder } from '../src/orm/QueryBuilder';
import { PermissionAssignments, Permissions } from '../src/permissions';
import { PermissionManifest } from '../src/permissions/PermissionManifest';
import { PermissionProfiles } from '../src/permissions/PermissionProfiles';
import { CapabilityAuthorizer, type CapabilityAuthorizationInput } from '../src/permissions/CapabilityAuthorizer';
import { capabilityClient } from '../src/permissions/client';
import { ApplicationContext } from '../src/support/Context';
import { FormRequest, FormAuthorizationError } from '../src/routing/FormRequest';
import { createRequestEvent } from '../src/testing/request';

const A = 'team-a';
const B = 'team-b';
const VIEW = 'screen.boards.view';
const CREATE = 'action.boards.create';
const DELETE = 'action.boards.delete';
const PLATFORM = 'screen.platform.view';

function manifest(next = false): PermissionManifest {
  return new PermissionManifest({
    screens: [
      { resource: 'boards', label: 'Boards', group: 'Work', route: '/boards', scope: 'team' },
      { resource: 'platform', label: 'Platform', group: 'System', route: '/admin', scope: 'platform' },
    ],
    actions: [...['create', 'edit', 'delete', 'publish', 'pause', 'export', ...(next ? ['archive'] : [])].map((action) => ({ screen: 'boards', action, label: action })),
      { screen: 'platform', action: 'manage', label: 'Manage platform' }],
    aliases: [{ name: 'manage-boards', capabilities: [VIEW, CREATE], label: 'Legacy board manager' }],
    systemProfiles: [
      { name: 'tenant-admin', label: 'Full product', scope: 'team', defaults: 'all' },
      { name: 'reader', label: 'Reader', scope: 'team', defaults: [VIEW] },
      { name: 'platform-staff', label: 'Staff', scope: 'platform', defaults: [PLATFORM] },
    ],
  });
}
function input(teamId = A, modelId = 1): CapabilityAuthorizationInput { return { principal: { kind: 'user', modelType: 'User', modelId }, scope: { teamId }, context: {} }; }
async function role(name = 'editor') { return Permissions.createRole({ name }); }
async function assignedRole(name = 'editor', teamId = A, modelId = 1) {
  const value = await role(name);
  await Permissions.forTeam(teamId).assignRole('User', modelId, value.id);
  return value;
}

beforeEach(async () => {
  ApplicationContext.clear(); Permissions.clearCapabilities();
  await Connection.disconnect();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
  for (const Migration of [CreateTeamsTable, CreateRolesTable, CreatePermissionsTable, CreateRoleHasPermissionsTable,
    CreateModelHasRolesTable, CreateModelHasPermissionsTable, CreateTeamRoleHasPermissionsTable, CreateTeamModelHasRolesTable,
    CreateTeamModelHasPermissionsTable, CreateRoleCapabilityProfilesTable, CreateTeamRoleCapabilityProfilesTable]) await new Migration().up();
  for (const id of [A, B]) await new QueryBuilder('teams').insert({ id, name: id, slug: id, owner_id: '1', personal_team: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
});
afterEach(async () => { vi.restoreAllMocks(); ApplicationContext.clear(); Permissions.clearCapabilities(); await Connection.disconnect(); });

describe('persisted system and exact permission profiles', () => {
  it('intersects user-bound credentials with roles instead of granting the whole owner profile', async () => {
    const catalog = manifest(); const profiles = new PermissionProfiles(catalog); const access = new CapabilityAuthorizer(catalog, { profiles });
    const editor = await assignedRole(); await profiles.forTeam(A).setSystem(editor.id, 'tenant-admin');
    const authenticated = input();
    const principal = { kind: 'user' as const, modelType: 'User', modelId: 1, credentialCapabilities: [VIEW] };
    expect(await access.can(VIEW, { ...authenticated, principal })).toBe(true);
    expect(await access.can(CREATE, { ...authenticated, principal })).toBe(false);
    expect((await access.snapshot({ ...authenticated, principal })).capabilities).toEqual([VIEW]);
    expect(await access.can(CREATE, { ...authenticated, principal: { ...principal, credentialCapabilities: [CREATE] } })).toBe(false);
    expect(await access.can(CREATE, { ...authenticated, principal: { ...principal, credentialCapabilities: [VIEW, CREATE] } })).toBe(true);
    expect(await access.can(VIEW, { ...authenticated, principal: { ...principal, credentialCapabilities: [] } })).toBe(false);
    expect(await access.can(VIEW, { ...authenticated, principal: { ...principal, credentialCapabilities: ['unknown'] } })).toBe(false);
    const owner = new CapabilityAuthorizer(catalog, { platformOwner: () => true });
    expect(await owner.can(PLATFORM, { principal, scope: { platform: true }, context: {} })).toBe(false);
    expect(await owner.can(PLATFORM, { principal: { ...principal, credentialCapabilities: [PLATFORM] }, scope: { platform: true }, context: {} })).toBe(true);
  });

  it('keeps the same role different in two teams and never imports global grants', async () => {
    const catalog = manifest(); const profiles = new PermissionProfiles(catalog); const access = new CapabilityAuthorizer(catalog, { profiles });
    const editor = await assignedRole();
    await Permissions.forTeam(B).assignRole('User', 1, editor.id);
    await Permissions.assignRole('User', 1, editor.id);
    await profiles.forTeam(A).setSystem(editor.id, 'tenant-admin', { exclusions: [DELETE] });
    await profiles.forTeam(B).setCustom(editor.id, [VIEW]);
    await profiles.forPlatform().setCustom(editor.id, [PLATFORM]);
    expect(await access.can(CREATE, input(A))).toBe(true);
    expect(await access.can(DELETE, input(A))).toBe(false);
    expect(await access.can(CREATE, input(B))).toBe(false);
    expect(await access.can(PLATFORM, input(A))).toBe(false);
    expect(await access.can(VIEW, { ...input(), scope: { platform: true } })).toBe(false);
    expect(await access.can(PLATFORM, { ...input(), scope: { platform: true } })).toBe(true);
    expect(await profiles.forTeam(B).get(editor.id)).toMatchObject({ kind: 'custom', capabilities: [VIEW] });
  });

  it('system defaults follow new code capabilities while custom profiles remain exact', async () => {
    const first = manifest(); const profiles = new PermissionProfiles(first);
    const system = await assignedRole('system'); const custom = await assignedRole('custom', A, 2);
    await profiles.forTeam(A).setSystem(system.id, 'tenant-admin', { exclusions: [DELETE] });
    await profiles.forTeam(A).setCustom(custom.id, [VIEW, CREATE]);
    const next = new CapabilityAuthorizer(manifest(true));
    expect(await next.can('action.boards.archive', input(A, 1))).toBe(true);
    expect(await next.can(DELETE, input(A, 1))).toBe(false);
    expect(await next.can('action.boards.archive', input(A, 2))).toBe(false);
    expect(await next.can(CREATE, input(A, 2))).toBe(true);
  });

  it('applies defaults minus exclusions plus inclusions without snapshotting defaults into storage', async () => {
    const catalog = manifest(); const profiles = new PermissionProfiles(catalog); const editor = await assignedRole();
    const stored = await profiles.forTeam(A).setSystem(editor.id, 'reader', { exclusions: [], inclusions: [CREATE] });
    expect(stored.capabilities).toEqual([]);
    expect(stored.inclusions).toEqual([CREATE]);
    expect(await new CapabilityAuthorizer(catalog).can(CREATE, input())).toBe(true);
    await profiles.forTeam(A).setSystem(editor.id, 'tenant-admin', { exclusions: [VIEW] });
    const access = new CapabilityAuthorizer(catalog);
    expect(await access.can(CREATE, input())).toBe(false);
    expect(await access.can(DELETE, input())).toBe(false);
  });

  it('unions per-user/team roles before checking dependencies and includes scoped direct grants', async () => {
    const catalog = manifest(); const profiles = new PermissionProfiles(catalog); const access = new CapabilityAuthorizer(catalog);
    const reader = await assignedRole('reader'); const creator = await assignedRole('creator');
    await profiles.forTeam(A).setCustom(reader.id, [VIEW]);
    await profiles.forTeam(A).setCustom(creator.id, [CREATE]);
    expect(await access.can(CREATE, input())).toBe(true);
    expect(await access.can(CREATE, input(B))).toBe(false);
    const permission = await Permissions.createPermission({ name: DELETE });
    await Permissions.forTeam(A).giveModelPermission('User', 1, permission.id);
    expect(await access.can(DELETE, input())).toBe(true);
    await Permissions.forTeam(A).removeRole('User', 1, reader.id);
    expect(await access.can(CREATE, input())).toBe(false);
    expect(await access.can(DELETE, input())).toBe(false);
  });

  it('custom exact profiles replace legacy role grants rather than silently retaining broad permissions', async () => {
    const catalog = manifest(); const editor = await assignedRole();
    const old = await Permissions.createPermission({ name: 'manage-boards' });
    await Permissions.forTeam(A).giveRolePermission(editor.id, old.id);
    const access = new CapabilityAuthorizer(catalog); expect(await access.can(CREATE, input())).toBe(true);
    const profiles = new PermissionProfiles(catalog).forTeam(A);
    await profiles.setCustom(editor.id, []);
    expect(await access.can(VIEW, input())).toBe(false);
    expect(await access.can(CREATE, input())).toBe(false);
    await profiles.remove(editor.id);
    expect(await access.can(CREATE, input())).toBe(true);
  });

  it('saved team bindings remain immutable and concurrent checks never read ambient team selection', async () => {
    const catalog = manifest(); const a = new PermissionProfiles(catalog).forTeam(A); const b = a.forTeam(B);
    const editor = await assignedRole(); await Permissions.forTeam(B).assignRole('User', 1, editor.id);
    await a.setCustom(editor.id, [VIEW, CREATE]); await b.setCustom(editor.id, [VIEW]);
    expect(Reflect.set(a, 'teamId', B)).toBe(false);
    await Promise.all([A, B].map((teamId) => ApplicationContext.runIsolated({ teamId: teamId === A ? B : A }, async () => {
      const names = await (teamId === A ? a : b).effective({ modelType: 'User', modelId: 1 });
      expect(names.includes(CREATE)).toBe(teamId === A);
    })));
  });

  it('validates all selections, guard, reserved role and profile scope before changing stored settings', async () => {
    const catalog = manifest(); const profiles = new PermissionProfiles(catalog).forTeam(A); const editor = await assignedRole();
    await profiles.setCustom(editor.id, [VIEW]);
    await expect(profiles.setCustom(editor.id, [PLATFORM])).rejects.toThrow('scope');
    await expect(profiles.setCustom(editor.id, ['unknown'])).rejects.toThrow('Unknown');
    await expect(profiles.setSystem(editor.id, 'missing')).rejects.toThrow('Unknown');
    await expect(profiles.setSystem(editor.id, 'platform-staff')).rejects.toThrow('scope');
    await expect(profiles.setSystem(editor.id, 'tenant-admin', { exclusions: [VIEW], inclusions: [VIEW] })).rejects.toThrow('overlap');
    const apiRole = await Permissions.createRole({ name: 'api-role', guard: 'api' });
    await expect(profiles.setCustom(apiRole.id, [VIEW])).rejects.toThrow('guard');
    expect(await profiles.get(editor.id)).toMatchObject({ capabilities: [VIEW] });
  });

  it('does not turn tenant full-product roles into owner, superadmin or console grants', async () => {
    const catalog = manifest(); const editor = await assignedRole();
    await new PermissionProfiles(catalog).forTeam(A).setSystem(editor.id, 'tenant-admin');
    const owner = await role('owner'); const superadmin = await role('superadmin');
    await expect(Permissions.forTeam(A).assignRole('User', 1, owner.id)).rejects.toThrow('Platform');
    await expect(Permissions.forTeam(A).assignRole('User', 1, superadmin.id)).rejects.toThrow('Platform');
    const permission = await Permissions.createPermission({ name: PLATFORM });
    await expect(Permissions.forTeam(A).giveRolePermission(owner.id, permission.id)).rejects.toThrow('Platform');
    await expect(new PermissionProfiles(catalog).forTeam(A).setCustom(owner.id, [VIEW])).rejects.toThrow('Reserved');
    const ownerHook = vi.fn(() => true); const access = new CapabilityAuthorizer(catalog, { platformOwner: ownerHook });
    expect(await access.can('owner', input())).toBe(false);
    expect(await access.can(PLATFORM, input())).toBe(false);
    expect(ownerHook).not.toHaveBeenCalled();
    expect(await access.can(PLATFORM, { ...input(), scope: { platform: true } })).toBe(true);
    expect(await access.can('unknown', { ...input(), scope: { platform: true } })).toBe(false);
    expect(ownerHook).toHaveBeenCalledOnce();
  });

  it('deletes roles and all legacy/profile bindings transactionally, including both teams', async () => {
    const catalog = manifest(); const profiles = new PermissionProfiles(catalog); const editor = await assignedRole();
    await Permissions.forTeam(B).assignRole('User', 1, editor.id); await Permissions.assignRole('User', 1, editor.id);
    await profiles.forTeam(A).setCustom(editor.id, [VIEW]); await profiles.forTeam(B).setCustom(editor.id, [VIEW]); await profiles.forPlatform().setCustom(editor.id, [PLATFORM]);
    const raw = Connection.raw.bind(Connection);
    const failure = vi.spyOn(Connection, 'raw').mockImplementation(async (sql, ...args) => {
      if (/^DELETE FROM ["`]?roles["`]?\s/.test(sql)) throw new Error('role delete failed');
      return raw(sql, ...args);
    });
    await expect(Permissions.deleteRole('editor')).rejects.toThrow('role delete failed'); failure.mockRestore();
    expect(await Permissions.getModelRoles('User', 1)).toHaveLength(1);
    expect(await profiles.forTeam(A).get(editor.id)).not.toBeNull();
    await Permissions.deleteRole('editor');
    expect(await Permissions.getModelRoles('User', 1)).toEqual([]);
    expect(await Permissions.forTeam(A).getModelRoles('User', 1)).toEqual([]);
    expect(await Permissions.forTeam(B).getModelRoles('User', 1)).toEqual([]);
    for (const scope of [profiles.forTeam(A), profiles.forTeam(B), profiles.forPlatform()]) expect(await scope.get(editor.id)).toBeNull();
  });

  it('cascades team profile deletion without deleting another team profile', async () => {
    const profiles = new PermissionProfiles(manifest()); const editor = await role();
    await profiles.forTeam(A).setCustom(editor.id, [VIEW]); await profiles.forTeam(B).setCustom(editor.id, [VIEW]);
    await new QueryBuilder('teams').where('id', A).delete();
    expect(await profiles.forTeam(A).get(editor.id)).toBeNull(); expect(await profiles.forTeam(B).get(editor.id)).not.toBeNull();
  });

  it('corrupt stored profiles fail explicitly rather than producing manufactured healthy grants', async () => {
    const catalog = manifest(); const editor = await assignedRole();
    await new PermissionProfiles(catalog).forTeam(A).setCustom(editor.id, [VIEW]);
    await new QueryBuilder('team_role_capability_profiles').where('team_id', A).where('role_id', editor.id).update({ capabilities: '{invalid' });
    await expect(new CapabilityAuthorizer(catalog).can(VIEW, input())).rejects.toThrow();
  });

  it('public editor previews recompute system defaults and expose stale legacy selections', async () => {
    const catalog = manifest(); const editor = await assignedRole();
    await new PermissionProfiles(catalog).forTeam(A).setSystem(editor.id, 'tenant-admin', { exclusions: [DELETE] });
    const next = new PermissionProfiles(manifest(true)).forTeam(A);
    const preview = await next.preview(editor.id);
    expect(preview.selected).toContain('action.boards.archive'); expect(preview.selected).not.toContain(DELETE);
    await new QueryBuilder('team_role_capability_profiles').where('team_id', A).where('role_id', editor.id).update({ kind: 'custom', capabilities: JSON.stringify([VIEW, 'action.boards.removed']) });
    expect(await next.preview(editor.id)).toMatchObject({ selected: [VIEW], staleCapabilities: ['action.boards.removed'] });
    expect(await new CapabilityAuthorizer(catalog).can('action.boards.removed', input())).toBe(false);
  });

  it('tenant role deletion removes grants atomically only in that team, not the shared role or other scopes', async () => {
    const catalog = manifest(); const profiles = new PermissionProfiles(catalog); const editor = await assignedRole();
    const permission = await Permissions.createPermission({ name: VIEW });
    for (const scope of [Permissions.forTeam(A), Permissions.forTeam(B), Permissions.global()]) {
      await scope.assignRole('User', 1, editor.id); await scope.giveRolePermission(editor.id, permission.id);
    }
    await profiles.forTeam(A).setCustom(editor.id, [VIEW]); await profiles.forTeam(B).setCustom(editor.id, [VIEW]);
    const raw = Connection.raw.bind(Connection);
    const failure = vi.spyOn(Connection, 'raw').mockImplementation(async (sql, ...args) => {
      if (sql.startsWith('DELETE') && sql.includes('team_role_capability_profiles')) throw new Error('profile delete failed');
      return raw(sql, ...args);
    });
    await expect(profiles.forTeam(A).deleteRole(editor.id)).rejects.toThrow('profile delete failed'); failure.mockRestore();
    expect(await Permissions.forTeam(A).modelHasPermission('User', 1, VIEW)).toBe(true);
    await profiles.forTeam(A).deleteRole(editor.id);
    expect(await Permissions.forTeam(A).getModelRoles('User', 1)).toEqual([]);
    expect(await Permissions.forTeam(A).getRolePermissions(editor.id)).toEqual([]);
    expect(await profiles.forTeam(A).get(editor.id)).toBeNull();
    expect(await Permissions.findRole('editor')).not.toBeNull();
    expect(await Permissions.forTeam(B).modelHasPermission('User', 1, VIEW)).toBe(true);
    expect(await Permissions.modelHasPermission('User', 1, VIEW)).toBe(true);
    expect(await profiles.forTeam(B).get(editor.id)).not.toBeNull();
  });

  it('role observation queries are bounded and overflow fails rather than truncating grants', async () => {
    const profiles = new PermissionProfiles(manifest()).forTeam(A);
    const get = vi.spyOn(QueryBuilder.prototype, 'get').mockImplementation(async function(this: QueryBuilder) {
      const query = this.toSQL();
      expect(query.sql).toMatch(/LIMIT(?:\s+101|\s+\?)/);
      if (query.sql.includes('LIMIT ?')) expect(query.bindings).toContain(101);
      return Array.from({ length: 101 }, (_, index) => ({ id: index + 1, name: `role-${index}`, guard: 'web' }));
    });
    await expect(profiles.effective({ modelType: 'User', modelId: 1 })).rejects.toThrow('100 assigned roles');
    expect(get).toHaveBeenCalledOnce();
  });

  it('direct grant queries request only the finite cap and report overflow', async () => {
    const original = QueryBuilder.prototype.get;
    vi.spyOn(QueryBuilder.prototype, 'get').mockImplementation(async function(this: QueryBuilder) {
      const query = this.toSQL();
      if (query.sql.includes('team_model_has_permissions')) {
        expect(query.sql).toMatch(/LIMIT(?:\s+10001|\s+\?)/);
        if (query.sql.includes('LIMIT ?')) expect(query.bindings).toContain(10001);
        return Array(10_001).fill({ name: VIEW });
      }
      return original.call(this);
    });
    await expect(new PermissionProfiles(manifest()).forTeam(A).effective({ modelType: 'User', modelId: 1 })).rejects.toThrow('Direct permission grants exceed');
  });
});

describe('visible scoped legacy alias migration', () => {
  it('migrates only the selected team and retains the visible shared legacy catalog for other scopes', async () => {
    const catalog = manifest(); const editor = await assignedRole(); const legacy = await Permissions.createPermission({ name: 'manage-boards' });
    for (const teamId of [A, B]) {
      await Permissions.forTeam(teamId).giveRolePermission(editor.id, legacy.id);
      await Permissions.forTeam(teamId).giveModelPermission('User', 1, legacy.id);
    }
    const migrated = await new PermissionProfiles(catalog).forTeam(A).migrateLegacyAliases();
    expect(migrated).toEqual({ aliases: 1, roleLinks: 2, modelLinks: 2 });
    expect((await Permissions.forTeam(A).getRolePermissions(editor.id)).map((value) => value.name)).toEqual([CREATE, VIEW]);
    expect((await Permissions.forTeam(B).getRolePermissions(editor.id)).map((value) => value.name)).toEqual(['manage-boards']);
    expect(await Permissions.findPermission('manage-boards')).not.toBeNull();
    expect(catalog.aliases('team')).toHaveLength(1);
    expect(await new PermissionProfiles(catalog).forTeam(A).migrateLegacyAliases()).toEqual({ aliases: 0, roleLinks: 0, modelLinks: 0 });
  });
  it('rolls back canonical inserts and pivot changes when migration fails', async () => {
    const catalog = manifest(); const editor = await assignedRole(); const legacy = await Permissions.createPermission({ name: 'manage-boards' });
    await Permissions.forTeam(A).giveRolePermission(editor.id, legacy.id); await Permissions.forTeam(A).giveModelPermission('User', 1, legacy.id);
    const grant = vi.spyOn(PermissionAssignments.prototype, 'giveModelPermission').mockRejectedValueOnce(new Error('migration failure'));
    await expect(new PermissionProfiles(catalog).forTeam(A).migrateLegacyAliases()).rejects.toThrow('migration failure'); grant.mockRestore();
    expect((await Permissions.forTeam(A).getRolePermissions(editor.id)).map((value) => value.name)).toEqual(['manage-boards']);
    expect(await Permissions.findPermission(VIEW)).toBeNull();
    expect(await Permissions.forTeam(A).modelHasPermission('User', 1, 'manage-boards')).toBe(true);
  });

  it('bounds aggregate alias migration fanout before inserting canonical permissions', async () => {
    const legacy = await Permissions.createPermission({ name: 'manage-boards' });
    const original = QueryBuilder.prototype.get;
    vi.spyOn(QueryBuilder.prototype, 'get').mockImplementation(async function(this: QueryBuilder) {
      const query = this.toSQL();
      if (query.sql.includes('team_role_has_permissions')) {
        expect(query.sql).toMatch(/LIMIT(?:\s+10001|\s+\?)/);
        return Array.from({ length: 5000 }, (_, index) => ({ role_id: index + 1 }));
      }
      return original.call(this);
    });
    await expect(new PermissionProfiles(manifest()).forTeam(A).migrateLegacyAliases()).rejects.toThrow('aggregate work limit');
    expect(await Permissions.findPermission(VIEW)).toBeNull(); expect(await Permissions.findPermission('manage-boards')).toMatchObject({ id: legacy.id });
  });
});

describe('capability guards before validation and domain work', () => {
  class WriteRequest extends FormRequest { rules() { return z.object({ title: z.string() }); } }
  it('direct endpoint and named page-action calls return/throw 403 before parsing the request', async () => {
    const catalog = manifest(); const access = new CapabilityAuthorizer(catalog); const editor = await assignedRole();
    await new PermissionProfiles(catalog).forTeam(A).setCustom(editor.id, [VIEW]);
    const event = createRequestEvent({ method: 'POST', body: { title: 'New' } });
    const parse = vi.spyOn(event.request, 'json'); const rules = vi.spyOn(WriteRequest.prototype, 'rules'); const domain = vi.fn();
    const handler = async (request: typeof event) => { const data = await WriteRequest.validate(request); domain(data); return { ok: true }; };
    const endpoint = access.guardEndpoint(CREATE, handler, () => input());
    expect(await endpoint(event)).toMatchObject({ status: 403 });
    const actions = access.guardPageActions({ create: { capability: CREATE, handler } }, () => input());
    const denied = await actions.create(event).catch((error: unknown) => error);
    expect(isHttpError(denied, 403)).toBe(true);
    expect(parse).not.toHaveBeenCalled(); expect(rules).not.toHaveBeenCalled(); expect(domain).not.toHaveBeenCalled();
  });
  it('missing view dependencies deny a direct HTTP action even when its action bit is granted', async () => {
    const catalog = manifest(); const editor = await assignedRole(); await new PermissionProfiles(catalog).forTeam(A).setCustom(editor.id, [CREATE]);
    const handler = vi.fn(async () => new Response('done'));
    expect((await new CapabilityAuthorizer(catalog).guardEndpoint(CREATE, handler, () => input())({})).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
  it('valid guards run FormRequest in the selected origin context and do not bypass resource authorization', async () => {
    const catalog = manifest(); const editor = await assignedRole(); await new PermissionProfiles(catalog).forTeam(A).setCustom(editor.id, [VIEW, CREATE]);
    const access = new CapabilityAuthorizer(catalog); const seen: unknown[] = [];
    const handler = async (event: ReturnType<typeof createRequestEvent>) => { seen.push(ApplicationContext.snapshot()); const data = await WriteRequest.validate(event); return { data }; };
    const event = createRequestEvent({ method: 'POST', body: { title: 'New' } });
    expect(await access.guardPageAction(CREATE, handler, () => input())(event)).toEqual({ data: { title: 'New' } });
    expect(seen[0]).toMatchObject({ teamId: A, tenantId: A, actorId: 1, actorType: 'user', userId: 1 });
    expect(ApplicationContext.get('teamId')).toBeUndefined();
    const resourcePolicy = vi.spyOn(WriteRequest.prototype, 'authorize').mockReturnValue(false);
    await expect(access.guardPageAction(CREATE, handler, () => input())(createRequestEvent({ method: 'POST', body: { title: 'Another' } }))).rejects.toBeInstanceOf(FormAuthorizationError);
    expect(resourcePolicy).toHaveBeenCalledOnce();
  });
  it('unknown static guards fail at setup; missing or mismatched principal/scope fails closed', async () => {
    const access = new CapabilityAuthorizer(manifest()); const handler = vi.fn(async () => new Response('done'));
    expect(() => access.guardPageAction('action.boards.missing', handler, () => input())).toThrow('Unknown');
    expect(() => access.guardPageAction(VIEW, handler, () => input())).toThrow('action capability');
    expect((await access.guardEndpoint(VIEW, handler, () => null)({})).status).toBe(401);
    expect(await access.can(VIEW, { ...input(), context: { teamId: B } })).toBe(false);
    expect(await access.can(VIEW, { ...input(), scope: { teamId: A, platform: true } } as CapabilityAuthorizationInput)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
  it('URL layout guards reject unregistered paths and platform routes for tenant profiles', async () => {
    const catalog = manifest(); const editor = await assignedRole(); await new PermissionProfiles(catalog).forTeam(A).setSystem(editor.id, 'tenant-admin');
    const access = new CapabilityAuthorizer(catalog); const handler = vi.fn(async () => ({ ok: true }));
    const load = access.guardLayout(handler, () => input());
    expect(await load({ url: new URL('http://localhost/boards/42') })).toEqual({ ok: true });
    for (const path of ['/admin', '/undeclared']) expect(isHttpError(await load({ url: new URL(`http://localhost${path}`) }).catch((error: unknown) => error), 403)).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });
  it('server snapshots align client presentation with real guards but never trust a forged snapshot', async () => {
    const catalog = manifest(); const editor = await assignedRole(); await new PermissionProfiles(catalog).forTeam(A).setCustom(editor.id, [VIEW]);
    const access = new CapabilityAuthorizer(catalog); const value = await access.snapshot(input());
    const client = capabilityClient(value); expect(client.can(VIEW)).toBe(true); expect(client.can(CREATE)).toBe(false);
    expect(value.known).not.toContain(PLATFORM); expect(value.aliases['manage-boards']).toEqual([VIEW, CREATE]);
    (value.capabilities as string[]).push(CREATE);
    expect(await access.can(CREATE, input())).toBe(false);
    expect(await access.can(VIEW, { ...input(), principal: { kind: 'user', modelType: 'User', modelId: 0 } })).toBe(false);
  });
});

describe('service actors and context', () => {
  function service(capabilities: readonly string[] = [VIEW, CREATE]): CapabilityAuthorizationInput {
    return { principal: { kind: 'service_account', actorId: 'erp', teamId: A, capabilities }, scope: { teamId: A }, context: { teamId: A, tenantId: A, actorId: 'erp', actorType: 'service_account' } };
  }
  it('verified scoped credentials allow concrete capabilities and establish service actor context without user inheritance', async () => {
    const access = new CapabilityAuthorizer(manifest()); const auth = service();
    expect(await access.can(CREATE, auth)).toBe(true); expect(await access.can(DELETE, auth)).toBe(false);
    const endpoint = access.guardEndpoint(CREATE, async () => new Response(JSON.stringify(ApplicationContext.snapshot())), () => ({ ...auth, context: { ...auth.context, userId: 99 } }));
    const response = await endpoint({});
    expect(await response.json()).toEqual({ teamId: A, tenantId: A, actorId: 'erp', actorType: 'service_account' });
  });
  it('fails closed for absent, foreign or mismatched service actor/tenant contexts', async () => {
    const access = new CapabilityAuthorizer(manifest());
    for (const context of [{}, { teamId: B, actorId: 'erp' }, { teamId: A, actorId: 'other' }, { teamId: A, tenantId: B, actorId: 'erp' }, { teamId: A, actorId: 'erp', actorType: 'user' }]) expect(await access.can(CREATE, { ...service(), context })).toBe(false);
    expect(await access.can(CREATE, { ...service(), scope: { teamId: B } })).toBe(false);
    expect(await access.can(CREATE, { ...service(), principal: { kind: 'user', modelType: 'User', modelId: 1 }, context: { actorType: 'service_account' } })).toBe(false);
  });
  it('wildcard service grants never become owner/global access and unknown names deny the credential', async () => {
    const owner = vi.fn(() => true); const access = new CapabilityAuthorizer(manifest(), { platformOwner: owner });
    expect(await access.can(DELETE, service(['*']))).toBe(true);
    expect(await access.can(PLATFORM, service(['*']))).toBe(false);
    expect(await access.can(PLATFORM, { ...service(['*']), scope: { platform: true }, context: {} })).toBe(false);
    expect(await access.can(CREATE, service([VIEW, CREATE, 'unknown']))).toBe(false);
    expect(await access.can(CREATE, service([VIEW, CREATE, PLATFORM]))).toBe(false);
    expect(owner).not.toHaveBeenCalled();
  });
  it('credentials intersect an optional role subject rather than expanding its roles', async () => {
    const catalog = manifest(); const editor = await assignedRole(); await new PermissionProfiles(catalog).forTeam(A).setCustom(editor.id, [VIEW, CREATE]);
    const access = new CapabilityAuthorizer(catalog); const principal = { kind: 'service_account' as const, actorId: 'erp', teamId: A, capabilities: [VIEW, CREATE, DELETE], subject: { modelType: 'User', modelId: 1 } };
    const auth = { ...service(), principal };
    expect(await access.can(CREATE, auth)).toBe(true); expect(await access.can(DELETE, auth)).toBe(false);
    expect(await access.can(CREATE, { ...auth, principal: { ...principal, capabilities: [VIEW] } })).toBe(false);
  });
});
