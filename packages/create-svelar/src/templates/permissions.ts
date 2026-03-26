/**
 * Permissions system templates
 */

export const permissionsMigration = `import { Migration } from 'svelar/database';

export default class CreatePermissionsTables extends Migration {
  async up() {
    // Create roles table
    await this.schema.createTable('roles', (table) => {
      table.increments('id');
      table.string('name').unique();
      table.string('description').nullable();
      table.timestamps();
    });

    // Create permissions table
    await this.schema.createTable('permissions', (table) => {
      table.increments('id');
      table.string('name').unique();
      table.string('description').nullable();
      table.timestamps();
    });

    // Create role_permission pivot table
    await this.schema.createTable('role_permission', (table) => {
      table.increments('id');
      table.integer('role_id').unsigned().references('id').inTable('roles').onDelete('cascade');
      table.integer('permission_id').unsigned().references('id').inTable('permissions').onDelete('cascade');
      table.timestamps();
    });

    // Add role_id to users table
    await this.schema.table('users', (table) => {
      table.integer('role_id').unsigned().nullable().references('id').inTable('roles').onDelete('set null');
    });
  }

  async down() {
    await this.schema.table('users', (table) => {
      table.dropColumn('role_id');
    });
    await this.schema.dropTable('role_permission');
    await this.schema.dropTable('permissions');
    await this.schema.dropTable('roles');
  }
}
`;

export const gatesDefinition = `/**
 * Authorization gates
 *
 * Gates allow you to authorize actions on any resource.
 * They're simple, method-based checks that run in the context of the authenticated user.
 */

import type { User } from '$lib/models/User.js';

export const gates = {
  viewAdminDashboard: (user: User | null) => {
    return user && user.role_id && ['admin', 'superadmin'].includes(user.role?.name);
  },

  manageUsers: (user: User | null) => {
    return user && user.role?.name === 'admin' || user?.role?.name === 'superadmin';
  },

  deletePost: (user: User | null, post: any) => {
    return user && (user.id === post.user_id || user.role?.name === 'admin');
  },

  manageRoles: (user: User | null) => {
    return user && user.role?.name === 'superadmin';
  },
};

export function authorize(gate: keyof typeof gates, ...args: any[]): boolean {
  return gates[gate](...args);
}
`;

export const userModelWithRoles = `import { Model } from 'svelar/orm';
import { HasRoles } from 'svelar/auth';

export class User extends Model {
  static table = 'users';
  static timestamps = true;
  static fillable = ['name', 'email', 'password', 'role_id'];
  static hidden = ['password'];

  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare role_id: number | null;
  declare created_at: Date;
  declare updated_at: Date;

  // Use HasRoles mixin for role management
  static use = [HasRoles];

  // Relationships
  role() {
    return this.belongsTo('Role', 'role_id', 'id');
  }

  permissions() {
    return this.hasManyThrough('Permission', 'Role', 'id', 'id', 'role_id', 'id');
  }
}
`;
