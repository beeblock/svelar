/**
 * Svelar Permissions
 *
 * Spatie-inspired roles & permissions system. Provides:
 * - Role model with permissions assignment
 * - Permission model
 * - HasRoles trait (mixin) for any model
 * - RequirePermission / RequireRole middleware
 * - Default migrations for roles, permissions, and pivot tables
 *
 * @example
 * ```ts
 * import { Permission, Role, HasRoles } from '@beeblock/svelar/permissions';
 *
 * // Models are auto-configured after migrations run
 * const admin = await Role.create({ name: 'admin', guard: 'web' });
 * const perm = await Permission.create({ name: 'manage-users', guard: 'web' });
 *
 * await admin.givePermission(perm);
 *
 * // On a user model:
 * class User extends HasRoles(Model) { ... }
 *
 * await user.assignRole('admin');
 * await user.givePermission('edit-posts');
 *
 * user.hasRole('admin');            // true
 * user.hasPermission('manage-users'); // true (via admin role)
 * user.can('edit-posts');             // true (direct permission)
 * ```
 */

import { Middleware, type MiddlewareContext, type NextFunction } from '../middleware/Middleware.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';

// ── Types ──────────────────────────────────────────────────

export interface PermissionRecord {
  id: number;
  name: string;
  guard: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RoleRecord {
  id: number;
  name: string;
  guard: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

// ── Permission Manager ─────────────────────────────────────

class PermissionManager {
  /**
   * @deprecated Permissions now use Svelar's QueryBuilder and shared Connection.
   */
  configure(_getConnection: () => Promise<any>): void {
    // Kept during alpha for compatibility with older code.
  }

  private permissionsQuery(): QueryBuilder<PermissionRecord> {
    return new QueryBuilder<PermissionRecord>('permissions');
  }

  private rolesQuery(): QueryBuilder<RoleRecord> {
    return new QueryBuilder<RoleRecord>('roles');
  }

  private rolePermissionsQuery(): QueryBuilder<any> {
    return new QueryBuilder('role_has_permissions');
  }

  private modelRolesQuery(): QueryBuilder<any> {
    return new QueryBuilder('model_has_roles');
  }

  private modelPermissionsQuery(): QueryBuilder<any> {
    return new QueryBuilder('model_has_permissions');
  }

  // ── Permission CRUD ──────────────────────────────────

  async createPermission(data: { name: string; guard?: string; description?: string }): Promise<PermissionRecord> {
    const now = new Date().toISOString();
    const guard = data.guard ?? 'web';

    await this.permissionsQuery().insert({
      name: data.name,
      guard,
      description: data.description ?? null,
      created_at: now,
      updated_at: now,
    });

    return this.permissionsQuery().where('name', data.name).where('guard', guard).firstOrFail();
  }

  async findPermission(name: string, guard: string = 'web'): Promise<PermissionRecord | null> {
    return this.permissionsQuery().where('name', name).where('guard', guard).first();
  }

  async findPermissionById(id: number): Promise<PermissionRecord | null> {
    return this.permissionsQuery().where('id', id).first();
  }

  async allPermissions(guard: string = 'web'): Promise<PermissionRecord[]> {
    return this.permissionsQuery().where('guard', guard).orderBy('name').get();
  }

  async deletePermission(name: string, guard: string = 'web'): Promise<void> {
    await this.permissionsQuery().where('name', name).where('guard', guard).delete();
  }

  // ── Role CRUD ────────────────────────────────────────

  async createRole(data: { name: string; guard?: string; description?: string }): Promise<RoleRecord> {
    const now = new Date().toISOString();
    const guard = data.guard ?? 'web';

    await this.rolesQuery().insert({
      name: data.name,
      guard,
      description: data.description ?? null,
      created_at: now,
      updated_at: now,
    });

    return this.rolesQuery().where('name', data.name).where('guard', guard).firstOrFail();
  }

  async findRole(name: string, guard: string = 'web'): Promise<RoleRecord | null> {
    return this.rolesQuery().where('name', name).where('guard', guard).first();
  }

  async findRoleById(id: number): Promise<RoleRecord | null> {
    return this.rolesQuery().where('id', id).first();
  }

  async allRoles(guard: string = 'web'): Promise<RoleRecord[]> {
    return this.rolesQuery().where('guard', guard).orderBy('name').get();
  }

  async deleteRole(name: string, guard: string = 'web'): Promise<void> {
    await this.rolesQuery().where('name', name).where('guard', guard).delete();
  }

  // ── Role ↔ Permission ────────────────────────────────

  async giveRolePermission(roleId: number, permissionId: number): Promise<void> {
    await this.rolePermissionsQuery().upsert(
      { role_id: roleId, permission_id: permissionId },
      ['role_id', 'permission_id'],
      [],
    );
  }

  async revokeRolePermission(roleId: number, permissionId: number): Promise<void> {
    await this.rolePermissionsQuery().where('role_id', roleId).where('permission_id', permissionId).delete();
  }

  async getRolePermissions(roleId: number): Promise<PermissionRecord[]> {
    return new QueryBuilder<PermissionRecord>('permissions p')
      .select('p.*')
      .join('role_has_permissions rp', 'p.id', '=', 'rp.permission_id')
      .where('rp.role_id', roleId)
      .orderBy('p.name')
      .get();
  }

  async roleHasPermission(roleId: number, permissionName: string): Promise<boolean> {
    return new QueryBuilder('role_has_permissions rp')
      .join('permissions p', 'p.id', '=', 'rp.permission_id')
      .where('rp.role_id', roleId)
      .where('p.name', permissionName)
      .exists();
  }

  // ── Model ↔ Role ─────────────────────────────────────

  async assignRole(modelType: string, modelId: number, roleId: number): Promise<void> {
    await this.modelRolesQuery().upsert(
      { model_type: modelType, model_id: modelId, role_id: roleId },
      ['model_type', 'model_id', 'role_id'],
      [],
    );
  }

  async removeRole(modelType: string, modelId: number, roleId: number): Promise<void> {
    await this.modelRolesQuery()
      .where('model_type', modelType)
      .where('model_id', modelId)
      .where('role_id', roleId)
      .delete();
  }

  async getModelRoles(modelType: string, modelId: number): Promise<RoleRecord[]> {
    return new QueryBuilder<RoleRecord>('roles r')
      .select('r.*')
      .join('model_has_roles mr', 'r.id', '=', 'mr.role_id')
      .where('mr.model_type', modelType)
      .where('mr.model_id', modelId)
      .orderBy('r.name')
      .get();
  }

  async modelHasRole(modelType: string, modelId: number, roleName: string): Promise<boolean> {
    return new QueryBuilder('model_has_roles mr')
      .join('roles r', 'r.id', '=', 'mr.role_id')
      .where('mr.model_type', modelType)
      .where('mr.model_id', modelId)
      .where('r.name', roleName)
      .exists();
  }

  // ── Model ↔ Permission (direct) ──────────────────────

  async giveModelPermission(modelType: string, modelId: number, permissionId: number): Promise<void> {
    await this.modelPermissionsQuery().upsert(
      { model_type: modelType, model_id: modelId, permission_id: permissionId },
      ['model_type', 'model_id', 'permission_id'],
      [],
    );
  }

  async revokeModelPermission(modelType: string, modelId: number, permissionId: number): Promise<void> {
    await this.modelPermissionsQuery()
      .where('model_type', modelType)
      .where('model_id', modelId)
      .where('permission_id', permissionId)
      .delete();
  }

  async getModelDirectPermissions(modelType: string, modelId: number): Promise<PermissionRecord[]> {
    return new QueryBuilder<PermissionRecord>('permissions p')
      .select('p.*')
      .join('model_has_permissions mp', 'p.id', '=', 'mp.permission_id')
      .where('mp.model_type', modelType)
      .where('mp.model_id', modelId)
      .orderBy('p.name')
      .get();
  }

  /**
   * Get ALL permissions for a model (direct + via roles)
   */
  async getModelAllPermissions(modelType: string, modelId: number): Promise<PermissionRecord[]> {
    const direct = await this.getModelDirectPermissions(modelType, modelId);
    const roles = await this.getModelRoles(modelType, modelId);
    const byId = new Map<number, PermissionRecord>();

    for (const permission of direct) {
      byId.set(permission.id, permission);
    }

    for (const role of roles) {
      const permissions = await this.getRolePermissions(role.id);
      for (const permission of permissions) {
        byId.set(permission.id, permission);
      }
    }

    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Check if a model has a permission (direct or via role)
   */
  async modelHasPermission(modelType: string, modelId: number, permissionName: string): Promise<boolean> {
    // Check direct permission
    const direct = await new QueryBuilder('model_has_permissions mp')
      .join('permissions p', 'p.id', '=', 'mp.permission_id')
      .where('mp.model_type', modelType)
      .where('mp.model_id', modelId)
      .where('p.name', permissionName)
      .exists();
    if (direct) return true;

    // Check via roles
    return new QueryBuilder('model_has_roles mr')
      .join('role_has_permissions rp', 'rp.role_id', '=', 'mr.role_id')
      .join('permissions p', 'p.id', '=', 'rp.permission_id')
      .where('mr.model_type', modelType)
      .where('mr.model_id', modelId)
      .where('p.name', permissionName)
      .exists();
  }

  // ── Sync Operations ──────────────────────────────────

  /**
   * Sync roles for a model (remove all, then assign new ones)
   */
  async syncRoles(modelType: string, modelId: number, roleNames: string[], guard: string = 'web'): Promise<void> {
    await this.modelRolesQuery().where('model_type', modelType).where('model_id', modelId).delete();
    for (const roleName of roleNames) {
      const role = await this.findRole(roleName, guard);
      if (role) {
        await this.assignRole(modelType, modelId, role.id);
      }
    }
  }

  /**
   * Sync permissions for a model (remove all direct, then assign new ones)
   */
  async syncPermissions(modelType: string, modelId: number, permissionNames: string[], guard: string = 'web'): Promise<void> {
    await this.modelPermissionsQuery().where('model_type', modelType).where('model_id', modelId).delete();
    for (const permName of permissionNames) {
      const perm = await this.findPermission(permName, guard);
      if (perm) {
        await this.giveModelPermission(modelType, modelId, perm.id);
      }
    }
  }
}

// ── HasRoles Mixin ─────────────────────────────────────────

/**
 * Mixin that adds role & permission methods to any Model class.
 *
 * @example
 * ```ts
 * class User extends HasRoles(Model) {
 *   static table = 'users';
 *   // ...
 * }
 *
 * const user = await User.find(1);
 * await user.assignRole('admin');
 * await user.givePermission('manage-users');
 *
 * console.log(await user.hasRole('admin')); // true
 * console.log(await user.can('manage-users')); // true
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor = new (...args: any[]) => any;

export interface HasRolesInstance {
  readonly _modelType: string;
  readonly _modelId: number;
  assignRole(roleName: string, guard?: string): Promise<void>;
  removeRole(roleName: string, guard?: string): Promise<void>;
  hasRole(roleName: string, guard?: string): Promise<boolean>;
  givePermission(permissionName: string, guard?: string): Promise<void>;
  revokePermission(permissionName: string, guard?: string): Promise<void>;
  hasPermission(permissionName: string, guard?: string): Promise<boolean>;
  can(permissionName: string, guard?: string): Promise<boolean>;
  getRoles(): Promise<RoleRecord[]>;
  getAllPermissions(): Promise<PermissionRecord[]>;
  getDirectPermissions(): Promise<PermissionRecord[]>;
}

export function HasRoles<TBase extends Constructor>(Base: TBase): TBase & (new (...args: any[]) => HasRolesInstance) {
  class HasRolesMixin extends Base {
    get _modelType(): string {
      return (this.constructor as any).name || 'User';
    }

    get _modelId(): number {
      return (this as any).id ?? (this as any).getAttribute?.('id');
    }

    /**
     * Assign a role by name
     */
    async assignRole(roleName: string, guard: string = 'web'): Promise<void> {
      const role = await Permissions.findRole(roleName, guard);
      if (!role) throw new Error(`Role "${roleName}" does not exist.`);
      await Permissions.assignRole(this._modelType, this._modelId, role.id);
    }

    /**
     * Remove a role by name
     */
    async removeRole(roleName: string, guard: string = 'web'): Promise<void> {
      const role = await Permissions.findRole(roleName, guard);
      if (!role) return;
      await Permissions.removeRole(this._modelType, this._modelId, role.id);
    }

    /**
     * Sync roles (replace all existing roles)
     */
    async syncRoles(roleNames: string[], guard: string = 'web'): Promise<void> {
      await Permissions.syncRoles(this._modelType, this._modelId, roleNames, guard);
    }

    /**
     * Check if this model has a specific role
     */
    async hasRole(roleName: string): Promise<boolean> {
      return Permissions.modelHasRole(this._modelType, this._modelId, roleName);
    }

    /**
     * Check if this model has any of the given roles
     */
    async hasAnyRole(...roleNames: string[]): Promise<boolean> {
      for (const name of roleNames) {
        if (await this.hasRole(name)) return true;
      }
      return false;
    }

    /**
     * Check if this model has all of the given roles
     */
    async hasAllRoles(...roleNames: string[]): Promise<boolean> {
      for (const name of roleNames) {
        if (!(await this.hasRole(name))) return false;
      }
      return true;
    }

    /**
     * Get all roles for this model
     */
    async getRoles(): Promise<RoleRecord[]> {
      return Permissions.getModelRoles(this._modelType, this._modelId);
    }

    /**
     * Give a direct permission
     */
    async givePermission(permissionName: string, guard: string = 'web'): Promise<void> {
      const perm = await Permissions.findPermission(permissionName, guard);
      if (!perm) throw new Error(`Permission "${permissionName}" does not exist.`);
      await Permissions.giveModelPermission(this._modelType, this._modelId, perm.id);
    }

    /**
     * Revoke a direct permission
     */
    async revokePermission(permissionName: string, guard: string = 'web'): Promise<void> {
      const perm = await Permissions.findPermission(permissionName, guard);
      if (!perm) return;
      await Permissions.revokeModelPermission(this._modelType, this._modelId, perm.id);
    }

    /**
     * Sync permissions (replace all direct permissions)
     */
    async syncPermissions(permissionNames: string[], guard: string = 'web'): Promise<void> {
      await Permissions.syncPermissions(this._modelType, this._modelId, permissionNames, guard);
    }

    /**
     * Check if this model has a permission (direct or via role)
     */
    async hasPermission(permissionName: string): Promise<boolean> {
      return Permissions.modelHasPermission(this._modelType, this._modelId, permissionName);
    }

    /**
     * Alias for hasPermission
     */
    async can(permissionName: string): Promise<boolean> {
      return this.hasPermission(permissionName);
    }

    /**
     * Check if this model lacks a permission
     */
    async cannot(permissionName: string): Promise<boolean> {
      return !(await this.hasPermission(permissionName));
    }

    /**
     * Get all permissions (direct + via roles)
     */
    async getAllPermissions(): Promise<PermissionRecord[]> {
      return Permissions.getModelAllPermissions(this._modelType, this._modelId);
    }

    /**
     * Get only direct permissions
     */
    async getDirectPermissions(): Promise<PermissionRecord[]> {
      return Permissions.getModelDirectPermissions(this._modelType, this._modelId);
    }
  }
  return HasRolesMixin as unknown as TBase & (new (...args: any[]) => HasRolesInstance);
}

// ── Middleware ──────────────────────────────────────────────

/**
 * Middleware that requires a specific permission
 */
export class RequirePermissionMiddleware extends Middleware {
  constructor(private permission: string) {
    super();
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const user = ctx.event.locals.user;
    if (!user) {
      return new Response(
        JSON.stringify({ message: 'Unauthenticated' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const modelType = user.constructor?.name || 'User';
    const modelId = user.id ?? user.getAttribute?.('id');

    const hasPermission = await Permissions.modelHasPermission(modelType, modelId, this.permission);
    if (!hasPermission) {
      return new Response(
        JSON.stringify({ message: `Missing permission: ${this.permission}` }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return next();
  }
}

/**
 * Middleware that requires a specific role
 */
export class RequireRoleMiddleware extends Middleware {
  constructor(private role: string) {
    super();
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const user = ctx.event.locals.user;
    if (!user) {
      return new Response(
        JSON.stringify({ message: 'Unauthenticated' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const modelType = user.constructor?.name || 'User';
    const modelId = user.id ?? user.getAttribute?.('id');

    const hasRole = await Permissions.modelHasRole(modelType, modelId, this.role);
    if (!hasRole) {
      return new Response(
        JSON.stringify({ message: `Missing role: ${this.role}` }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return next();
  }
}

import { singleton } from '../support/singleton.js';

// ── Global Permissions Singleton ───────────────────────────

export const Permissions = singleton('svelar.permissions', () => new PermissionManager());
