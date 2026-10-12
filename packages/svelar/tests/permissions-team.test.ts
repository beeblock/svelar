import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { Model } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import {
  HasRoles, PermissionAssignments, Permissions,
  RequirePermissionMiddleware, RequireRoleMiddleware,
} from '../src/permissions/index.js';
import { ApplicationContext } from '../src/support/Context.js';
import { Teams } from '../src/teams/index.js';

class User extends HasRoles(Model) {
  static table = 'users';
  static timestamps = false;
}

describe.sequential('Team-scoped permissions', () => {
  let teamA: string | number;
  let teamB: string | number;
  let a: PermissionAssignments;
  let b: PermissionAssignments;

  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    await new Migrator().fresh(svelarCoreMigrations());
    Teams.configure({ driver: 'database', maxTeamsPerUser: undefined });
    teamA = (await Teams.create({ name: 'Alpha', ownerId: 1 })).id;
    teamB = (await Teams.create({ name: 'Beta', ownerId: 1 })).id;
    a = Permissions.forTeam(teamA);
    b = Permissions.forTeam(teamB);
    ApplicationContext.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    ApplicationContext.clear();
    Teams.configure({ driver: 'memory' });
    await Connection.disconnect();
  });

  it('isolates concurrent two-team role and direct checks from global admin grants', async () => {
    const editor = await Permissions.createRole({ name: 'editor' });
    const viewer = await Permissions.createRole({ name: 'viewer' });
    const admin = await Permissions.createRole({ name: 'admin' });
    const write = await Permissions.createPermission({ name: 'boards.write' });
    const read = await Permissions.createPermission({ name: 'boards.read' });
    const exportData = await Permissions.createPermission({ name: 'boards.export' });
    const manage = await Permissions.createPermission({ name: 'admin.manage' });
    await a.giveRolePermission(editor.id, write.id);
    await b.giveRolePermission(viewer.id, read.id);
    await a.assignRole('User', 1, editor.id);
    await b.assignRole('User', 1, viewer.id);
    await a.giveModelPermission('User', 1, exportData.id);
    await Permissions.giveRolePermission(admin.id, manage.id);
    await Permissions.assignRole('User', 1, admin.id);

    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const checks = [teamA, teamB].map((teamId) => Teams.runWithTeam(teamId, async () => {
      const scope = Permissions.forTeam(Teams.getCurrentTeam()!);
      await barrier;
      ApplicationContext.set('teamId', teamId === teamA ? teamB : teamA);
      for (let i = 0; i < 12; i++) {
        expect(await scope.modelHasRole('User', 1, 'editor')).toBe(teamId === teamA);
        expect(await scope.modelHasRole('User', 1, 'viewer')).toBe(teamId === teamB);
        expect(await scope.modelHasPermission('User', 1, 'boards.write')).toBe(teamId === teamA);
        expect(await scope.modelHasPermission('User', 1, 'boards.read')).toBe(teamId === teamB);
        expect(await scope.modelHasPermission('User', 1, 'boards.export')).toBe(teamId === teamA);
        expect(await scope.modelHasPermission('User', 1, 'admin.manage')).toBe(false);
        expect(await Permissions.global().modelHasPermission('User', 1, 'admin.manage')).toBe(true);
        expect(await new User({ id: 1 }).can('boards.write')).toBe(false);
      }
    }));
    release();
    await Promise.all(checks);
    expect(await a.getModelAllPermissions('User', 1)).toEqual([exportData, write]);
    expect(await b.getModelAllPermissions('User', 1)).toEqual([read]);
    expect(await new User({ id: 1 }).getRoleNames()).toEqual(['admin']);
    expect(await Permissions.global().getModelAllPermissions('User', 1)).toEqual([manage]);
  });

  it('scopes role-permission links even when both teams and global use the same role', async () => {
    const editor = await Permissions.createRole({ name: 'editor' });
    const write = await Permissions.createPermission({ name: 'write' });
    const read = await Permissions.createPermission({ name: 'read' });
    const global = await Permissions.createPermission({ name: 'admin' });
    await a.giveRolePermission(editor.id, write.id);
    await b.giveRolePermission(editor.id, read.id);
    await Permissions.giveRolePermission(editor.id, global.id);
    for (const scope of [a, b, Permissions.global()]) await scope.assignRole('User', 1, editor.id);

    expect(await a.getRolePermissions(editor.id)).toEqual([write]);
    expect(await b.getRolePermissions(editor.id)).toEqual([read]);
    expect(await Permissions.getRolePermissions(editor.id)).toEqual([global]);
    expect(await a.roleHasPermission(editor.id, 'read')).toBe(false);
    expect(await b.roleHasPermission(editor.id, 'write')).toBe(false);
    expect(await a.modelHasPermission('User', 1, 'admin')).toBe(false);
    expect(await Permissions.modelHasPermission('User', 1, 'write')).toBe(false);
    await a.syncRolePermissions(editor.id, ['read', 'read']);
    expect(await a.getModelAllPermissions('User', 1)).toEqual([read]);
    expect(await Permissions.getRolePermissions(editor.id)).toEqual([global]);
  });

  it('syncs only the selected scope, guard, model type, and model ID', async () => {
    const webRole = await Permissions.createRole({ name: 'editor' });
    const apiRole = await Permissions.createRole({ name: 'editor', guard: 'api' });
    const webPermission = await Permissions.createPermission({ name: 'write' });
    const apiPermission = await Permissions.createPermission({ name: 'write', guard: 'api' });
    for (const scope of [a, b, Permissions.global()]) {
      await scope.syncRoles('User', 1, ['editor']);
      await scope.syncRoles('User', 1, ['editor'], 'api');
      await scope.syncPermissions('User', 1, ['write']);
      await scope.syncPermissions('User', 1, ['write'], 'api');
    }
    await a.assignRole('ServiceAccount', 1, webRole.id);
    await a.assignRole('User', 2, webRole.id);
    await a.giveModelPermission('ServiceAccount', 1, webPermission.id);
    await a.giveModelPermission('User', 2, webPermission.id);

    await a.syncRoles('User', 1, []);
    await a.syncPermissions('User', 1, []);
    expect(await a.getModelRoles('User', 1)).toEqual([apiRole]);
    expect(await a.getModelDirectPermissions('User', 1)).toEqual([apiPermission]);
    for (const scope of [b, Permissions.global()]) {
      expect(await scope.getModelRoles('User', 1)).toHaveLength(2);
      expect(await scope.getModelDirectPermissions('User', 1)).toHaveLength(2);
    }
    expect(await a.modelHasRole('ServiceAccount', 1, 'editor')).toBe(true);
    expect(await a.modelHasPermission('ServiceAccount', 1, 'write')).toBe(true);
    expect(await a.modelHasRole('User', 2, 'editor')).toBe(true);
    expect(await a.modelHasPermission('User', 2, 'write')).toBe(true);
    await a.syncRoles('User', 1, ['editor', 'editor']);
    await a.syncPermissions('User', 1, ['write', 'write']);
    expect(await a.getModelRoles('User', 1)).toHaveLength(2);
    expect(await a.getModelDirectPermissions('User', 1)).toHaveLength(2);
    await Permissions.syncRoles('User', 1, []);
    await Permissions.syncPermissions('User', 1, []);
    expect(await Permissions.getModelRoles('User', 1)).toEqual([apiRole]);
    expect(await Permissions.getModelDirectPermissions('User', 1)).toEqual([apiPermission]);
  });

  it('rejects unknown sync names and rolls back failures after deletion', async () => {
    const role = await Permissions.createRole({ name: 'editor' });
    const permission = await Permissions.createPermission({ name: 'write' });
    await a.assignRole('User', 1, role.id);
    await a.giveModelPermission('User', 1, permission.id);
    await a.giveRolePermission(role.id, permission.id);
    await expect(a.syncRoles('User', 1, ['missing'])).rejects.toThrow('does not exist');
    await expect(a.syncPermissions('User', 1, ['missing'])).rejects.toThrow('does not exist');
    await expect(a.syncRolePermissions(role.id, ['missing'])).rejects.toThrow('does not exist');

    const assign = vi.spyOn(PermissionAssignments.prototype, 'assignRole').mockRejectedValueOnce(new Error('insert failed'));
    await expect(a.syncRoles('User', 1, ['editor'])).rejects.toThrow('insert failed');
    assign.mockRestore();
    const grant = vi.spyOn(PermissionAssignments.prototype, 'giveModelPermission').mockRejectedValueOnce(new Error('insert failed'));
    await expect(a.syncPermissions('User', 1, ['write'])).rejects.toThrow('insert failed');
    grant.mockRestore();
    const roleGrant = vi.spyOn(PermissionAssignments.prototype, 'giveRolePermission').mockRejectedValueOnce(new Error('insert failed'));
    await expect(a.syncRolePermissions(role.id, ['write'])).rejects.toThrow('insert failed');
    roleGrant.mockRestore();
    expect(await a.getModelRoles('User', 1)).toEqual([role]);
    expect(await a.getModelDirectPermissions('User', 1)).toEqual([permission]);
    expect(await a.getRolePermissions(role.id)).toEqual([permission]);
  });

  it('revokes scoped grants without affecting the other team or global permissions', async () => {
    const role = await Permissions.createRole({ name: 'editor' });
    const permission = await Permissions.createPermission({ name: 'write' });
    for (const scope of [a, b, Permissions.global()]) {
      await scope.assignRole('User', 1, role.id);
      await scope.giveRolePermission(role.id, permission.id);
      await scope.giveModelPermission('User', 1, permission.id);
    }
    await a.revokeModelPermission('User', 1, permission.id);
    expect(await a.modelHasPermission('User', 1, 'write')).toBe(true);
    await a.revokeRolePermission(role.id, permission.id);
    expect(await a.modelHasPermission('User', 1, 'write')).toBe(false);
    await a.removeRole('User', 1, role.id);
    expect(await a.modelHasRole('User', 1, 'editor')).toBe(false);
    for (const scope of [b, Permissions.global()]) {
      expect(await scope.modelHasPermission('User', 1, 'write')).toBe(true);
      expect(await scope.modelHasRole('User', 1, 'editor')).toBe(true);
    }
  });

  it('removes all model grants atomically within one scope', async () => {
    const role = await Permissions.createRole({ name: 'editor' });
    const permission = await Permissions.createPermission({ name: 'write' });
    for (const scope of [a, b, Permissions.global()]) {
      await scope.assignRole('User', 1, role.id);
      await scope.giveModelPermission('User', 1, permission.id);
    }
    const raw = Connection.raw.bind(Connection);
    const failure = vi.spyOn(Connection, 'raw').mockImplementation(async (sql, ...args) => {
      if (sql.startsWith('DELETE') && sql.includes('team_model_has_permissions')) throw new Error('delete failed');
      return raw(sql, ...args);
    });
    await expect(a.removeModelAssignments('User', 1)).rejects.toThrow('delete failed');
    failure.mockRestore();
    expect(await a.getModelRoles('User', 1)).toEqual([role]);
    expect(await a.getModelDirectPermissions('User', 1)).toEqual([permission]);
    await a.removeModelAssignments('User', 1);
    expect(await a.getModelRoles('User', 1)).toEqual([]);
    expect(await a.getModelDirectPermissions('User', 1)).toEqual([]);
    for (const scope of [b, Permissions.global()]) {
      expect(await scope.getModelRoles('User', 1)).toEqual([role]);
      expect(await scope.getModelDirectPermissions('User', 1)).toEqual([permission]);
    }
  });

  it('resolves middleware scopes per request and fails closed without a valid team', async () => {
    const role = await Permissions.createRole({ name: 'editor' });
    const permission = await Permissions.createPermission({ name: 'write' });
    await a.assignRole('User', 1, role.id);
    await a.giveRolePermission(role.id, permission.id);
    await Permissions.assignRole('User', 1, role.id);
    await Permissions.giveRolePermission(role.id, permission.id);
    const scoped = { scope: async (ctx: any) => ctx.event.locals.authorizedTeamId === undefined
      ? null : { teamId: ctx.event.locals.authorizedTeamId } };
    const permissionMiddleware = new RequirePermissionMiddleware('write', scoped);
    const roleMiddleware = new RequireRoleMiddleware('editor', scoped);
    const ctx = (teamId?: string | number, user: User | null = new User({ id: 1 })) => ({
      event: { locals: { user, authorizedTeamId: teamId } }, params: {}, locals: {},
    });
    for (const middleware of [permissionMiddleware, roleMiddleware]) {
      const results = await Promise.all([teamA, teamB, undefined, ''].map((teamId) =>
        middleware.handle(ctx(teamId), async () => new Response('allowed'))));
      expect(results.map((response) => response?.status)).toEqual([200, 403, 403, 403]);
      expect((await middleware.handle(ctx(teamA, null), async () => new Response('allowed')))?.status).toBe(401);
    }
    for (const middleware of [new RequirePermissionMiddleware('write'), new RequireRoleMiddleware('editor', { scope: { global: true } })]) {
      expect((await Teams.runWithTeam(teamB, () => middleware.handle(ctx(teamB), async () => new Response('allowed'))))?.status).toBe(200);
    }
    const apiPermission = await Permissions.createPermission({ name: 'write', guard: 'api' });
    await b.giveModelPermission('User', 1, apiPermission.id);
    const api = new RequirePermissionMiddleware('write', { ...scoped, guard: 'api' });
    expect((await api.handle(ctx(teamB), async () => new Response('allowed')))?.status).toBe(200);
    expect((await permissionMiddleware.handle(ctx(teamB), async () => new Response('allowed')))?.status).toBe(403);
  });

  it('rejects invalid scopes and mismatched guards without modifying grants', async () => {
    for (const invalid of [null, undefined, '', '  ', NaN, Infinity, {}, true, 'x'.repeat(256)]) {
      expect(() => Permissions.forTeam(invalid as any)).toThrow('team ID');
    }
    expect(Object.isFrozen(a)).toBe(true);
    expect('deleteRole' in a).toBe(false);
    const role = await Permissions.createRole({ name: 'editor' });
    const apiPermission = await Permissions.createPermission({ name: 'write', guard: 'api' });
    for (const scope of [a, Permissions.global()]) {
      await expect(scope.giveRolePermission(role.id, apiPermission.id)).rejects.toThrow('guards must match');
      expect(await scope.getRolePermissions(role.id)).toEqual([]);
    }
    await expect(a.syncRolePermissions(role.id, ['write'], 'api')).rejects.toThrow('guards must match');
    await expect(a.assignRole('User', 1, 999)).rejects.toThrow();
    await expect(a.giveModelPermission('User', 1, 999)).rejects.toThrow();
    await expect(Permissions.forTeam('missing').assignRole('User', 1, role.id)).rejects.toThrow();
  });

  it('cascades team and catalogue deletion while retaining unrelated grants', async () => {
    const role = await Permissions.createRole({ name: 'editor' });
    const permission = await Permissions.createPermission({ name: 'write' });
    for (const scope of [a, b, Permissions.global()]) {
      await scope.assignRole('User', 1, role.id);
      await scope.giveRolePermission(role.id, permission.id);
      await scope.giveModelPermission('User', 1, permission.id);
    }
    await Teams.delete(teamA);
    expect(await a.getModelRoles('User', 1)).toEqual([]);
    expect(await a.getModelDirectPermissions('User', 1)).toEqual([]);
    expect(await a.getRolePermissions(role.id)).toEqual([]);
    expect(await b.modelHasPermission('User', 1, 'write')).toBe(true);
    expect(await Permissions.modelHasPermission('User', 1, 'write')).toBe(true);
    await Permissions.deletePermission('write');
    for (const table of ['role_has_permissions', 'model_has_permissions', 'team_role_has_permissions', 'team_model_has_permissions']) {
      expect(await new QueryBuilder(table).count()).toBe(0);
    }
    await Permissions.deleteRole('editor');
    for (const table of ['model_has_roles', 'team_model_has_roles']) expect(await new QueryBuilder(table).count()).toBe(0);
  });
});
