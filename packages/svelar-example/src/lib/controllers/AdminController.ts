import { Controller } from 'svelar/routing';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';
import type { RequestEvent } from '@sveltejs/kit';

export class AdminController extends Controller {
  /**
   * Get admin stats
   */
  async getStats() {
    const userCount = await User.count();
    const postCount = await Post.count();

    // Get role distribution
    const roleDistribution = await User.query()
      .select('role')
      .selectRaw('COUNT(*) as count')
      .groupBy('role')
      .get();

    return {
      users: userCount,
      posts: postCount,
      roleDistribution: roleDistribution.map((r: any) => ({
        role: r.role,
        count: r.count,
      })),
    };
  }

  /**
   * Get all users with pagination
   */
  async getAllUsers(page: number = 1, limit: number = 20) {
    const users = await User.query()
      .paginate(page, limit)
      .get();

    return users;
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: number, role: string) {
    const user = await User.find(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Validate role
    if (!['user', 'admin'].includes(role)) {
      throw new Error('Invalid role');
    }

    user.role = role;
    await user.save();

    return user;
  }

  /**
   * Delete user
   */
  async deleteUser(userId: number) {
    const user = await User.find(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Don't allow deleting the last admin
    if (user.role === 'admin') {
      const adminCount = await User.where('role', '=', 'admin').count();
      if (adminCount <= 1) {
        throw new Error('Cannot delete the last admin user');
      }
    }

    // Delete user's posts first
    await Post.where('user_id', '=', userId).delete();

    // Delete user
    await user.delete();

    return true;
  }

  /**
   * Authorize admin access
   */
  authorizeAdmin(event: RequestEvent) {
    const user = event.locals.user;
    if (!user || user.role !== 'admin') {
      throw new Error('Unauthorized: admin access required');
    }
  }
}
