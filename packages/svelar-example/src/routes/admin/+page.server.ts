import { redirect } from '@sveltejs/kit';
import type { ServerLoadEvent } from '@sveltejs/kit';
import { User } from '$lib/models/User.js';

export async function load(event: ServerLoadEvent) {
  const user = event.locals.user;

  // Check if user is admin
  if (!user || user.role !== 'admin') {
    throw redirect(302, '/dashboard');
  }

  // Fetch all users
  const users = await User.query().get();

  // Fetch stats
  const userCount = users.length;
  const postCount = await User.query()
    .selectRaw('COUNT(*) as count')
    .from('posts')
    .first();

  const roleDistribution = {
    admin: users.filter((u: any) => u.role === 'admin').length,
    user: users.filter((u: any) => u.role === 'user').length,
  };

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    users: users.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      created_at: u.created_at,
    })),
    stats: {
      userCount,
      postCount: postCount?.count || 0,
      roleDistribution,
    },
  };
}
