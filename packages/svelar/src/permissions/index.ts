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
 * import { Permission, Role, HasRoles } from 'svelar/permissions';
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
  private connectionGetter?: () => Promise<any>;

  /**
   * Configure the database connection for permissions
   */
  configure(getConnection: () => Promise<any>): void {
    this.connectionGetter = getConnection;
  }

  private async db() {
    if (this.connectionGetter) return this.connectionGetter();
    const { Connection } = await import('../database/Connection.js');
    return Connection;
  }

  // ── Permission CRUD ──────────────────────────────────

  async createPermission(data: { name: string; guard?: string; description?: string }): Promise<PermissionRecord> {
    const conn = await this.db();
    const now = new Date().toISOString();
    const guard = data.guard ?? 'web';

    await conn.raw(
      `INSERT INTO permissions (name, guard, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [data.name, guard, data.description ?? null, now, now],
    );

    const rows = await conn.raw(`SELECT * FROM permissions WHERE name = ? AND guard = ?`, [data.name, guard]);
    return rows[0];
  }

  async findPermission(name: string, guard: string = 'web'): Promise<PermissionRecord | null> {
    const conn = await this.db();
    const rows = await conn.raw(`SELECT * FROM permissions WHERE name = ? AND guard = ?`, [name, guard]);
    return rows[0] ?? null;
  }

  async findPermissionById(id: number): Promise<PermissionRecord | null> {
    const conn = await this.db();
    const rows = await conn.raw(`SELECT * FROM permissions WHERE id = ?`, [id]);
    return rows[0] ?? null;
  }

  async allPermissions(guard: string = 'web'): Promise<PermissionRecord[]> {
    const conn = await this.db();
    return conn.raw(`SELECT * FROM permissions WHERE guard = ? ORDER BY name`, [guard]);
  }

  async deletePermission(name: string, guard: string = 'web'): Promise<void> {
    const conn = await this.db();
    await conn.raw(`DELETE FROM permissions WHERE name = ? AND guard = ?`, [name, guard]);
  }

  // ── Role CRUD ────────────────────────────────────────

  async createRole(data: { name: string; guard?: string; description?: string }): Promise<RoleRecord> {
    const conn = await this.db();
    const now = new Date().toISOString();
    const guard = data.guard ?? 'web';

    await conn.raw(
      `INSERT INTO roles (name, guard, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [data.name, guard, data.description ?? null, now, now],
    );

    const rows = await conn.raw(`SELECT * FROM roles WHERE name = ? AND guard = ?`, [data.name, guard]);
    return rows[0];
  }

  async findRole(name: string, guard: string = 'web'): Promise<RoleRecord | null> {
    const conn = await this.db();
    const rows = await conn.raw(`SELECT * FROM roles WHERE name = ? AND guard = ?`, [name, guard]);
    return rows[0] ?? null;
  }

  async findRoleById(id: number): Promise<RoleRecord | null> {
    const conn = await this.db();
    const rows = await conn.raw(`SELECT * FROM roles WHERE id = ?`, [id]);
    return rows[0] ?? null;
  }

  async allRoles(guard: string = 'web'): Promise<RoleRecord[]> {
    const conn = await this.db();
    return conn.raw(`SELECT * FROM roles WHERE guard = ? ORDER BY name`, [guard]);
  }

  async deleteRole(name: string, guard: string = 'web'): Promise<void> {
    const conn = await this.db();
    await conn.raw(`DELETE FROM roles WHERE name = ? AND guard = ?`, [name, guard]);
  }

  // ── Role ↔ Permission ────────────────────────────────

  async giveRolePermission(roleId: number, permissionId: number): Promise<void> {
    const conn = await this.db();
    try {
      await conn.raw(
        `INSERT INTO role_has_permissions (role_id, permission_id) VALUES (?, ?)`,
        [roleId, permissionId],
      );
    } catch {
      // Already exists, ignore
    }
  }

  async revokeRolePermission(roleId: number, permissionId: number): Promise<void> {
    const conn = await this.db();
    await conn.raw(
      `DELETE FROM role_has_permissions WHERE role_id = ? AND permission_id = ?`,
      [roleId, permissionId],
    );
  }

  async getRolePermissions(roleId: number): Promise<PermissionRecord[]> {
    const conn = await this.db();
    return conn.raw(
      `SELECT p.* FROM permissions p
       INNER JOIN role_has_permissions rp ON p.id = rp.permission_id
       WHERE rp.role_id = ?
       ORDER BY p.name`,
      [roleId],
    );
  }

  async roleHasPermission(roleId: number, permissionName: string): Promise<boolean> {
    const conn = await this.db();
    const rows = await conn.raw(
      `SELECT 1 FROM role_has_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ? AND p.name = ?`,
      [roleId, permissionName],
    );
    return rows.length > 0;
  }

  // ── Model ↔ Role ─────────────────────────────────────

  async assignRole(modelType: string, modelId: number, roleId: number): Promise<void> {
    const conn = await this.db();
    try {
      await conn.raw(
        `INSERT INTO model_has_roles (model_type, model_id, role_id) VALUES (?, ?, ?)`,
        [modelType, modelId, roleId],
      );
    } catch {
      // Already assigned
    }
  }

  async removeRole(modelType: string, modelId: number, roleId: number): Promise<void> {
    const conn = await this.db();
    await conn.raw(
      `DELETE FROM model_has_roles WHERE model_type = ? AND model_id = ? AND role_id = ?`,
      [modelType, modelId, roleId],
    );
  }

  async getModelRoles(modelType: string, modelId: number): Promise<RoleRecord[]> {
    const conn = await this.db();
    return conn.raw(
      `SELECT r.* FROM roles r
       INNER JOIN model_has_roles mr ON r.id = mr.role_id
       WHERE mr.model_type = ? AND mr.model_id = ?
       ORDER BY r.name`,
      [modelType, modelId],
    );
  }

  async modelHasRole(modelType: string, modelId: number, roleName: string): Promise<boolean> {
    const conn = await this.db();
    const rows = await conn.raw(
      `SELECT 1 FROM model_has_roles mr
       INNER JOIN roles r ON r.id = mr.role_id
       WHERE mr.model_type = ? AND mr.model_id = ? AND r.name = ?`,
      [modelType, modelId, roleName],
    );
    return rows.length > 0;
  }

  // ── Model ↔ Permission (direct) ──────────────────────

  async giveModelPermission(modelType: string, modelId: number, permissionId: number): Promise<void> {
    const conn = await this.db();
    try {
      await conn.raw(
        `INSERT INTO model_has_permissions (model_type, model_id, permission_id) VALUES (?, ?, ?)`,
        [modelType, modelId, permissionId],
      );
    } catch {
      // Already assigned
    }
  }

  async revokeModelPermission(modelType: string, modelId: number, permissionId: number): Promise<void> {
    const conn = await this.db();
    await conn.raw(
      `DELETE FROM model_has_permissions WHERE model_type = ? AND model_id = ? AND permission_id = ?`,
      [modelType, modelId, permissionId],
    );
  }

  async getModelDirectPermissions(modelType: string, modelId: number): Promise<PermissionRecord[]> {
    const conn = await this.db();
    return conn.raw(
      `SELECT p.* FROM permissions p
       INNER JOIN model_has_permissions mp ON p.id = mp.permission_id
       WHERE mp.model_type = ? AND mp.model_id = ?
       ORDER BY p.name`,
      [modelType, modelId],
    );
  }

  /**
   * Get ALL permissions for a model (direct + via roles)
   */
  async getModelAllPermissions(modelType: string, modelId: number): Promise<PermissionRecord[]> {
    const conn = await this.db();
    return conn.raw(
      `SELECT DISTINCT p.* FROM permissions p
       LEFT JOIN model_has_permissions mp
         ON p.id = mp.permission_id AND mp.model_type = ? AND mp.model_id = ?
       LEFT JOIN role_has_permissions rp ON p.id = rp.permission_id
       LEFT JOIN model_has_roles mr
         ON rp.role_id = mr.role_id AND mr.model_type = ? AND mr.model_id = ?
       WHERE mp.permission_id IS NOT NULL OR mr.role_id IS NOT NULL
       ORDER BY p.name`,
      [modelType, modelId, modelType, modelId],
    );
  }

  /**
   * Check if a model has a permission (direct or via role)
   */
  async modelHasPermission(modelType: string, modelId: number, permissionName: string): Promise<boolean> {
    const conn = await this.db();

    // Check direct permission
    const direct = await conn.raw(
      `SELECT 1 FROM model_has_permissions mp
       INNER JOIN permissions p ON p.id = mp.permission_id
       WHERE mp.model_type = ? AND mp.model_id = ? AND p.name = ?`,
      [modelType, modelId, permissionName],
    );
    if (direct.length > 0) return true;

    // Check via roles
    const viaRole = await conn.raw(
      `SELECT 1 FROM model_has_roles mr
       INNER JOIN role_has_permissions rp ON rp.role_id = mr.role_id
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE mr.model_type = ? AND mr.model_id = ? AND p.name = ?`,
      [modelType, modelId, permissionName],
    );
    return viaRole.length > 0;
  }

  // ── Sync Operations ──────────────────────────────────

  /**
   * Sync roles for a model (remove all, then assign new ones)
   */
  async syncRoles(modelType: string, modelId: number, roleNames: string[], guard: string = 'web'): Promise<void> {
    const conn = await this.db();
    await conn.raw(
      `DELETE FROM model_has_roles WHERE model_type = ? AND model_id = ?`,
      [modelType, modelId],
    );
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
    const conn = await this.db();
    await conn.raw(
      `DELETE FROM model_has_permissions WHERE model_type = ? AND model_id = ?`,
      [modelType, modelId],
    );
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

// ── Default Migrations SQL ─────────────────────────────────

/**
 * SQL statements for creating the permissions tables.
 * These are database-agnostic and work with SQLite, PostgreSQL, and MySQL.
 */
export const PERMISSIONS_MIGRATION_SQL = {
  up: [
    `CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      guard VARCHAR(255) NOT NULL DEFAULT 'web',
      description TEXT,
      created_at DATETIME,
      updated_at DATETIME,
      UNIQUE(name, guard)
    )`,
    `CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      guard VARCHAR(255) NOT NULL DEFAULT 'web',
      description TEXT,
      created_at DATETIME,
      updated_at DATETIME,
      UNIQUE(name, guard)
    )`,
    `CREATE TABLE IF NOT EXISTS role_has_permissions (
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS model_has_roles (
      model_type VARCHAR(255) NOT NULL,
      model_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY (model_type, model_id, role_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS model_has_permissions (
      model_type VARCHAR(255) NOT NULL,
      model_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (model_type, model_id, permission_id),
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    )`,
  ],
  down: [
    `DROP TABLE IF EXISTS model_has_permissions`,
    `DROP TABLE IF EXISTS model_has_roles`,
    `DROP TABLE IF EXISTS role_has_permissions`,
    `DROP TABLE IF EXISTS roles`,
    `DROP TABLE IF EXISTS permissions`,
  ],
};

import { singleton } from '../support/singleton.js';

// ── Global Permissions Singleton ───────────────────────────

export const Permissions = singleton('svelar.permissions', () => new PermissionManager());
