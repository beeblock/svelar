import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { User } from '$lib/models/User.js';
import { Post } from '$lib/models/Post.js';

export async function GET(event: RequestEvent) {
  try {
    const user = event.locals.user;

    // Check authorization
    if (!user || user.role !== 'admin') {
      return json({ message: 'Unauthorized' }, { status: 403 });
    }

    // Get all users
    const users = await User.query().get();

    return json(users.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      created_at: u.created_at,
    })));
  } catch (err: any) {
    console.error('Error fetching users:', err);
    return json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(event: RequestEvent) {
  try {
    const user = event.locals.user;

    // Check authorization
    if (!user || user.role !== 'admin') {
      return json({ message: 'Unauthorized' }, { status: 403 });
    }

    const body = await event.request.json();
    const { userId, role } = body;

    if (!userId || !role) {
      return json({ message: 'Missing userId or role' }, { status: 400 });
    }

    // Validate role
    if (!['user', 'admin'].includes(role)) {
      return json({ message: 'Invalid role' }, { status: 400 });
    }

    // Find user
    const targetUser = await User.find(userId);
    if (!targetUser) {
      return json({ message: 'User not found' }, { status: 404 });
    }

    // Update role
    targetUser.role = role;
    await targetUser.save();

    return json({
      message: 'User role updated successfully',
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
      },
    });
  } catch (err: any) {
    console.error('Error updating user:', err);
    return json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(event: RequestEvent) {
  try {
    const user = event.locals.user;

    // Check authorization
    if (!user || user.role !== 'admin') {
      return json({ message: 'Unauthorized' }, { status: 403 });
    }

    const body = await event.request.json();
    const { userId } = body;

    if (!userId) {
      return json({ message: 'Missing userId' }, { status: 400 });
    }

    // Prevent self-deletion
    if (userId === user.id) {
      return json({ message: 'Cannot delete your own account' }, { status: 400 });
    }

    // Find user
    const targetUser = await User.find(userId);
    if (!targetUser) {
      return json({ message: 'User not found' }, { status: 404 });
    }

    // Don't allow deleting the last admin
    if (targetUser.role === 'admin') {
      const adminCount = await User.where('role', '=', 'admin').count();
      if (adminCount <= 1) {
        return json(
          { message: 'Cannot delete the last admin user' },
          { status: 400 }
        );
      }
    }

    // Delete user's posts first
    await Post.where('user_id', '=', userId).delete();

    // Delete user
    await targetUser.delete();

    return json({ message: 'User deleted successfully' });
  } catch (err: any) {
    console.error('Error deleting user:', err);
    return json({ message: 'Internal server error' }, { status: 500 });
  }
}
