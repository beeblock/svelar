import { Model } from 'svelar/orm';
import { HasRoles } from 'svelar/permissions';

/**
 * User model with HasRoles mixin for role/permission support.
 *
 * Methods added by HasRoles:
 * - user.assignRole('admin')
 * - user.removeRole('admin')
 * - user.hasRole('admin')
 * - user.givePermission('manage-users')
 * - user.hasPermission('manage-users')
 * - user.can('manage-users')
 * - user.getRoles()
 * - user.getAllPermissions()
 */
export class User extends HasRoles(Model) {
  static table = 'users';
  static timestamps = true;
  static fillable = ['name', 'email', 'password', 'role'];
  static hidden = ['password'];

  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare role: string;
  declare created_at: Date;
  declare updated_at: Date;

  /**
   * Check if this user is an admin (quick check via role column)
   */
  get isAdmin(): boolean {
    return this.role === 'admin';
  }

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

// Import here to avoid circular dep issues at class level
import { Post } from './Post.js';
