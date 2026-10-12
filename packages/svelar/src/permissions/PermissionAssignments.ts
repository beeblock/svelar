import { Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import type { PermissionRecord, RoleRecord } from './index.js';

/** Immutable assignment scope. Catalogues are shared; grants never inherit across scopes. */
export class PermissionAssignments {
  constructor(private readonly teamId: string | null = null) {}

  private table(name: string): string {
    return this.teamId === null ? name : `team_${name}`;
  }

  private scoped<T>(query: QueryBuilder<T>, alias?: string): QueryBuilder<T> {
    return this.teamId === null ? query : query.where(`${alias ? `${alias}.` : ''}team_id`, this.teamId);
  }

  private pivot(name: string): QueryBuilder<any> {
    return this.scoped(new QueryBuilder(this.table(name)));
  }

  private grant(data: Record<string, any>): Record<string, any> {
    return this.teamId === null ? data : { ...data, team_id: this.teamId };
  }

  private keys(columns: string[]): string[] {
    return this.teamId === null ? columns : ['team_id', ...columns];
  }

  async giveRolePermission(roleId: number, permissionId: number): Promise<void> {
    const role = await new QueryBuilder<RoleRecord>('roles').where('id', roleId).firstOrFail();
    const permission = await new QueryBuilder<PermissionRecord>('permissions').where('id', permissionId).firstOrFail();
    if (role.guard !== permission.guard) throw new Error('Role and permission guards must match.');
    await this.pivot('role_has_permissions').upsert(
      this.grant({ role_id: roleId, permission_id: permissionId }),
      this.keys(['role_id', 'permission_id']), [],
    );
  }

  async revokeRolePermission(roleId: number, permissionId: number): Promise<void> {
    await this.pivot('role_has_permissions').where('role_id', roleId).where('permission_id', permissionId).delete();
  }

  async getRolePermissions(roleId: number): Promise<PermissionRecord[]> {
    return this.scoped(new QueryBuilder<PermissionRecord>('permissions p')
      .select('p.*')
      .join(`${this.table('role_has_permissions')} rp`, 'p.id', '=', 'rp.permission_id')
      .join('roles r', 'r.id', '=', 'rp.role_id')
      .where('rp.role_id', roleId)
      .whereColumn('p.guard', 'r.guard'), 'rp').orderBy('p.name').get();
  }

  async roleHasPermission(roleId: number, permissionName: string, guard: string = 'web'): Promise<boolean> {
    return this.scoped(new QueryBuilder(`${this.table('role_has_permissions')} rp`)
      .join('permissions p', 'p.id', '=', 'rp.permission_id')
      .join('roles r', 'r.id', '=', 'rp.role_id')
      .where('rp.role_id', roleId)
      .where('p.name', permissionName)
      .where('p.guard', guard)
      .where('r.guard', guard), 'rp').exists();
  }

  async assignRole(modelType: string, modelId: number, roleId: number): Promise<void> {
    await new QueryBuilder('roles').where('id', roleId).firstOrFail();
    await this.pivot('model_has_roles').upsert(
      this.grant({ model_type: modelType, model_id: modelId, role_id: roleId }),
      this.keys(['model_type', 'model_id', 'role_id']), [],
    );
  }

  async removeRole(modelType: string, modelId: number, roleId: number): Promise<void> {
    await this.pivot('model_has_roles').where('model_type', modelType).where('model_id', modelId)
      .where('role_id', roleId).delete();
  }

  async getModelRoles(modelType: string, modelId: number): Promise<RoleRecord[]> {
    return this.scoped(new QueryBuilder<RoleRecord>('roles r')
      .select('r.*')
      .join(`${this.table('model_has_roles')} mr`, 'r.id', '=', 'mr.role_id')
      .where('mr.model_type', modelType).where('mr.model_id', modelId), 'mr').orderBy('r.name').get();
  }

  async modelHasRole(modelType: string, modelId: number, roleName: string, guard: string = 'web'): Promise<boolean> {
    return this.scoped(new QueryBuilder(`${this.table('model_has_roles')} mr`)
      .join('roles r', 'r.id', '=', 'mr.role_id')
      .where('mr.model_type', modelType).where('mr.model_id', modelId)
      .where('r.name', roleName).where('r.guard', guard), 'mr').exists();
  }

  async giveModelPermission(modelType: string, modelId: number, permissionId: number): Promise<void> {
    await new QueryBuilder('permissions').where('id', permissionId).firstOrFail();
    await this.pivot('model_has_permissions').upsert(
      this.grant({ model_type: modelType, model_id: modelId, permission_id: permissionId }),
      this.keys(['model_type', 'model_id', 'permission_id']), [],
    );
  }

  async revokeModelPermission(modelType: string, modelId: number, permissionId: number): Promise<void> {
    await this.pivot('model_has_permissions').where('model_type', modelType).where('model_id', modelId)
      .where('permission_id', permissionId).delete();
  }

  async getModelDirectPermissions(modelType: string, modelId: number): Promise<PermissionRecord[]> {
    return this.scoped(new QueryBuilder<PermissionRecord>('permissions p')
      .select('p.*')
      .join(`${this.table('model_has_permissions')} mp`, 'p.id', '=', 'mp.permission_id')
      .where('mp.model_type', modelType).where('mp.model_id', modelId), 'mp').orderBy('p.name').get();
  }

  async getModelAllPermissions(modelType: string, modelId: number): Promise<PermissionRecord[]> {
    const direct = await this.getModelDirectPermissions(modelType, modelId);
    const roles = await this.getModelRoles(modelType, modelId);
    const byId = new Map(direct.map((permission) => [permission.id, permission]));
    for (const role of roles) {
      for (const permission of await this.getRolePermissions(role.id)) byId.set(permission.id, permission);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async modelHasPermission(modelType: string, modelId: number, permissionName: string, guard: string = 'web'): Promise<boolean> {
    const direct = await this.scoped(new QueryBuilder(`${this.table('model_has_permissions')} mp`)
      .join('permissions p', 'p.id', '=', 'mp.permission_id')
      .where('mp.model_type', modelType).where('mp.model_id', modelId)
      .where('p.name', permissionName).where('p.guard', guard), 'mp').exists();
    if (direct) return true;

    const query = this.scoped(new QueryBuilder(`${this.table('model_has_roles')} mr`)
      .join(`${this.table('role_has_permissions')} rp`, 'rp.role_id', '=', 'mr.role_id')
      .join('permissions p', 'p.id', '=', 'rp.permission_id')
      .join('roles r', 'r.id', '=', 'mr.role_id')
      .where('mr.model_type', modelType).where('mr.model_id', modelId)
      .where('p.name', permissionName).where('p.guard', guard).where('r.guard', guard), 'mr');
    // Both sides of the role grant must belong to this scope, not merely the model assignment.
    return this.scoped(query, 'rp').exists();
  }

  async syncRoles(modelType: string, modelId: number, roleNames: string[], guard: string = 'web'): Promise<void> {
    await Connection.transaction(async () => {
      const roles = await this.resolveNames<RoleRecord>('roles', roleNames, guard);
      const guardRoles = await new QueryBuilder<RoleRecord>('roles').where('guard', guard).get();
      if (guardRoles.length) await this.pivot('model_has_roles')
        .where('model_type', modelType).where('model_id', modelId)
        .whereIn('role_id', guardRoles.map((role) => role.id)).delete();
      for (const role of roles) await this.assignRole(modelType, modelId, role.id);
    });
  }

  async syncPermissions(modelType: string, modelId: number, permissionNames: string[], guard: string = 'web'): Promise<void> {
    await Connection.transaction(async () => {
      const permissions = await this.resolveNames<PermissionRecord>('permissions', permissionNames, guard);
      const guardPermissions = await new QueryBuilder<PermissionRecord>('permissions').where('guard', guard).get();
      if (guardPermissions.length) await this.pivot('model_has_permissions')
        .where('model_type', modelType).where('model_id', modelId)
        .whereIn('permission_id', guardPermissions.map((permission) => permission.id)).delete();
      for (const permission of permissions) await this.giveModelPermission(modelType, modelId, permission.id);
    });
  }

  async syncRolePermissions(roleId: number, permissionNames: string[], guard: string = 'web'): Promise<void> {
    await Connection.transaction(async () => {
      const role = await new QueryBuilder<RoleRecord>('roles').where('id', roleId).firstOrFail();
      if (role.guard !== guard) throw new Error('Role and permission guards must match.');
      const permissions = await this.resolveNames<PermissionRecord>('permissions', permissionNames, guard);
      await this.pivot('role_has_permissions').where('role_id', roleId).delete();
      for (const permission of permissions) await this.giveRolePermission(roleId, permission.id);
    });
  }

  /** Remove all model grants in this scope, including every guard, atomically. */
  async removeModelAssignments(modelType: string, modelId: number): Promise<void> {
    await Connection.transaction(async () => {
      await this.pivot('model_has_roles').where('model_type', modelType).where('model_id', modelId).delete();
      await this.pivot('model_has_permissions').where('model_type', modelType).where('model_id', modelId).delete();
    });
  }

  private async resolveNames<T>(table: string, names: string[], guard: string): Promise<T[]> {
    const records: T[] = [];
    for (const name of new Set(names)) {
      const record = await new QueryBuilder<T>(table).where('name', name).where('guard', guard).first();
      if (!record) throw new Error(`${table === 'roles' ? 'Role' : 'Permission'} "${name}" does not exist for guard "${guard}".`);
      records.push(record);
    }
    return records;
  }
}
