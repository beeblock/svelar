/**
 * Svelar Permissions
 *
 * Spatie-inspired roles & permissions system. Provides:
 * - Role and permission records managed through the Permissions service
 * - HasRoles trait (mixin) for any model
 * - RequirePermission / RequireRole middleware
 * - Default migrations for roles, permissions, and pivot tables
 *
 * @example
 * ```ts
 * import { Permissions, HasRoles } from '@beeblock/svelar/permissions';
 *
 * const admin = await Permissions.createRole({ name: 'admin', guard: 'web' });
 * const perm = await Permissions.createPermission({ name: 'manage-users', guard: 'web' });
 *
 * await Permissions.giveRolePermission(admin.id, perm.id);
 *
 * // On a user model:
 * class User extends HasRoles(Model) { ... }
 *
 * await user.assignRole('admin');
 * await user.givePermission('edit-posts');
 *
 * await user.hasRole('admin');              // true
 * await user.hasPermission('manage-users'); // true (via admin role)
 * await user.can('edit-posts');             // true (direct permission)
 * ```
 */

import { Middleware, type MiddlewareContext, type NextFunction } from '../middleware/Middleware.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { Connection } from '../database/Connection.js';
import { PermissionAssignments } from './PermissionAssignments.js';

export { PermissionAssignments } from './PermissionAssignments.js';

function normalizeTeamId(teamId: string | number): string {
  if ((typeof teamId !== 'string' && typeof teamId !== 'number')
    || (typeof teamId === 'number' && !Number.isSafeInteger(teamId))
    || String(teamId).trim().length === 0 || String(teamId).length > 255) {
    throw new Error('Team permission scope requires a non-empty team ID.');
  }
  return String(teamId);
}

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

export interface PermissionCapability {
  /** Stable permission name used by policies, FormRequests, middleware, and UI gates. */
  name: string;
  guard?: string;
  description?: string;
  /** Optional bounded context/module label for admin screens and docs. */
  module?: string;
  /** Optional screen/page where this capability is commonly surfaced. */
  screen?: string;
  /** Optional action label such as view, create, update, delete, export, or approve. */
  action?: string;
  /** Additional app-owned metadata. Stored in memory, not in the permissions table. */
  metadata?: Record<string, any>;
}

export interface SyncCapabilitiesOptions {
  guard?: string;
  /** Delete database permissions for the guard that are no longer registered. Default: false. */
  prune?: boolean;
}

export interface SyncCapabilitiesResult {
  created: PermissionRecord[];
  updated: PermissionRecord[];
  pruned: PermissionRecord[];
  unchanged: PermissionRecord[];
}

// ── Permission Manager ─────────────────────────────────────

class PermissionManager extends PermissionAssignments {
  private capabilityRegistry = new Map<string, PermissionCapability>();

  forTeam(teamId: string | number): PermissionAssignments {
    const assignments = new PermissionAssignments(normalizeTeamId(teamId));
    Object.freeze(assignments);
    return assignments;
  }

  global(): PermissionAssignments {
    return this;
  }

  private capabilityKey(name: string, guard: string = 'web'): string {
    return `${guard}:${name}`;
  }

  private permissionsQuery(): QueryBuilder<PermissionRecord> {
    return new QueryBuilder<PermissionRecord>('permissions');
  }

  private rolesQuery(): QueryBuilder<RoleRecord> {
    return new QueryBuilder<RoleRecord>('roles');
  }

  // ── Capability Registry ─────────────────────────────────

  registerCapability(capability: PermissionCapability): PermissionCapability {
    const guard = capability.guard ?? 'web';
    const normalized = { ...capability, guard };
    this.capabilityRegistry.set(this.capabilityKey(capability.name, guard), normalized);
    return normalized;
  }

  registerCapabilities(capabilities: PermissionCapability[]): PermissionCapability[] {
    return capabilities.map((capability) => this.registerCapability(capability));
  }

  capabilities(guard: string = 'web'): PermissionCapability[] {
    return [...this.capabilityRegistry.values()]
      .filter((capability) => capability.guard === guard)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  findCapability(name: string, guard: string = 'web'): PermissionCapability | null {
    return this.capabilityRegistry.get(this.capabilityKey(name, guard)) ?? null;
  }

  capabilityNames(guard: string = 'web'): string[] {
    return this.capabilities(guard).map((capability) => capability.name);
  }

  clearCapabilities(guard?: string): void {
    if (!guard) {
      this.capabilityRegistry.clear();
      return;
    }

    for (const capability of this.capabilities(guard)) {
      this.capabilityRegistry.delete(this.capabilityKey(capability.name, guard));
    }
  }

  async syncCapabilities(options: SyncCapabilitiesOptions = {}): Promise<SyncCapabilitiesResult> {
    const guard = options.guard ?? 'web';
    const now = new Date().toISOString();
    const result: SyncCapabilitiesResult = {
      created: [],
      updated: [],
      pruned: [],
      unchanged: [],
    };
    const capabilities = this.capabilities(guard);
    const databasePermissions = await this.allPermissions(guard);
    const byName = new Map(databasePermissions.map((permission) => [permission.name, permission]));

    for (const capability of capabilities) {
      const existing = byName.get(capability.name);
      if (!existing) {
        result.created.push(await this.createPermission({
          name: capability.name,
          guard,
          description: capability.description,
        }));
        continue;
      }

      const desiredDescription = capability.description ?? null;
      const currentDescription = existing.description ?? null;
      if (desiredDescription !== currentDescription) {
        await this.permissionsQuery().where('id', existing.id).update({
          description: desiredDescription,
          updated_at: now,
        });
        result.updated.push(await this.findPermissionById(existing.id) ?? existing);
      } else {
        result.unchanged.push(existing);
      }
    }

    if (options.prune) {
      const registered = new Set(capabilities.map((capability) => capability.name));
      for (const permission of databasePermissions) {
        if (registered.has(permission.name)) continue;
        await this.deletePermission(permission.name, guard);
        result.pruned.push(permission);
      }
    }

    return result;
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
    await Connection.transaction(async () => {
      const permission = await this.findPermission(name, guard);
      if (!permission) return;
      await new QueryBuilder('role_has_permissions').where('permission_id', permission.id).delete();
      await new QueryBuilder('model_has_permissions').where('permission_id', permission.id).delete();
      await this.permissionsQuery().where('id', permission.id).delete();
    });
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
    await Connection.transaction(async () => {
      const role = await this.findRole(name, guard);
      if (!role) return;
      await new QueryBuilder('role_has_permissions').where('role_id', role.id).delete();
      await new QueryBuilder('model_has_roles').where('role_id', role.id).delete();
      await this.rolesQuery().where('id', role.id).delete();
    });
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
  syncRoles(roleNames: string[], guard?: string): Promise<void>;
  hasRole(roleName: string, guard?: string): Promise<boolean>;
  hasAnyRole(roleNames: string[], guard?: string): Promise<boolean>;
  hasAllRoles(roleNames: string[], guard?: string): Promise<boolean>;
  givePermission(permissionName: string, guard?: string): Promise<void>;
  revokePermission(permissionName: string, guard?: string): Promise<void>;
  syncPermissions(permissionNames: string[], guard?: string): Promise<void>;
  hasPermission(permissionName: string, guard?: string): Promise<boolean>;
  can(permissionName: string, guard?: string): Promise<boolean>;
  cannot(permissionName: string, guard?: string): Promise<boolean>;
  getRoles(): Promise<RoleRecord[]>;
  getRoleNames(): Promise<string[]>;
  getAllPermissions(): Promise<PermissionRecord[]>;
  getPermissionNames(): Promise<string[]>;
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
    async hasRole(roleName: string, guard: string = 'web'): Promise<boolean> {
      return Permissions.modelHasRole(this._modelType, this._modelId, roleName, guard);
    }

    /**
     * Check if this model has any of the given roles
     */
    async hasAnyRole(roleNames: string[], guard: string = 'web'): Promise<boolean> {
      for (const name of roleNames) {
        if (await this.hasRole(name, guard)) return true;
      }
      return false;
    }

    /**
     * Check if this model has all of the given roles
     */
    async hasAllRoles(roleNames: string[], guard: string = 'web'): Promise<boolean> {
      for (const name of roleNames) {
        if (!(await this.hasRole(name, guard))) return false;
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
     * Get role names for this model.
     */
    async getRoleNames(): Promise<string[]> {
      const roles = await this.getRoles();
      return roles.map((role) => role.name);
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
    async hasPermission(permissionName: string, guard: string = 'web'): Promise<boolean> {
      return Permissions.modelHasPermission(this._modelType, this._modelId, permissionName, guard);
    }

    /**
     * Laravel-style authorization helper.
     */
    async can(permissionName: string, guard: string = 'web'): Promise<boolean> {
      return this.hasPermission(permissionName, guard);
    }

    /**
     * Check if this model lacks a permission
     */
    async cannot(permissionName: string, guard: string = 'web'): Promise<boolean> {
      return !(await this.hasPermission(permissionName, guard));
    }

    /**
     * Get all permissions (direct + via roles)
     */
    async getAllPermissions(): Promise<PermissionRecord[]> {
      return Permissions.getModelAllPermissions(this._modelType, this._modelId);
    }

    /**
     * Get permission names for this model.
     */
    async getPermissionNames(): Promise<string[]> {
      const permissions = await this.getAllPermissions();
      return permissions.map((permission) => permission.name);
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

export type PermissionScope = { teamId: string | number } | { global: true };

export interface PermissionMiddlewareOptions {
  guard?: string;
  /** Resolve an authorized scope per request. Missing scope denies; it never becomes global. */
  scope?: PermissionScope | ((ctx: MiddlewareContext) => PermissionScope | null | undefined | Promise<PermissionScope | null | undefined>);
}

async function middlewareAssignments(ctx: MiddlewareContext, options: PermissionMiddlewareOptions): Promise<PermissionAssignments | null> {
  if (options.scope === undefined) return Permissions.global();
  const scope = typeof options.scope === 'function' ? await options.scope(ctx) : options.scope;
  if (!scope || typeof scope !== 'object') return null;
  if ('teamId' in scope) {
    try {
      return Permissions.forTeam(scope.teamId);
    } catch {
      return null;
    }
  }
  return 'global' in scope && scope.global === true ? Permissions.global() : null;
}

/**
 * Middleware that requires a specific permission
 */
export class RequirePermissionMiddleware extends Middleware {
  constructor(private permission: string, private options: PermissionMiddlewareOptions = {}) {
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

    const assignments = await middlewareAssignments(ctx, this.options);
    const hasPermission = assignments && await assignments.modelHasPermission(modelType, modelId, this.permission, this.options.guard ?? 'web');
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
  constructor(private role: string, private options: PermissionMiddlewareOptions = {}) {
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

    const assignments = await middlewareAssignments(ctx, this.options);
    const hasRole = assignments && await assignments.modelHasRole(modelType, modelId, this.role, this.options.guard ?? 'web');
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
