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

    // Get stats
    const users = await User.query().get();
    const posts = await Post.query().get();

    const roleDistribution = {
      admin: users.filter((u: any) => u.role === 'admin').length,
      user: users.filter((u: any) => u.role === 'user').length,
    };

    const publishedPosts = posts.filter((p: any) => p.published).length;

    return json({
      userCount: users.length,
      postCount: posts.length,
      publishedPosts,
      draftPosts: posts.length - publishedPosts,
      roleDistribution,
    });
  } catch (err: any) {
    console.error('Error fetching stats:', err);
    return json({ message: 'Internal server error' }, { status: 500 });
  }
}
