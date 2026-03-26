import { redirect } from '@sveltejs/kit';
import type { ServerLoadEvent } from '@sveltejs/kit';

export async function load(event: ServerLoadEvent) {
  if (!event.locals.user) {
    throw redirect(302, '/login');
  }

  // Fetch user's posts
  let posts: any[] = [];
  try {
    const res = await event.fetch('/api/posts/mine');
    if (res.ok) {
      posts = await res.json();
    }
  } catch {}

  return {
    user: {
      id: event.locals.user.id,
      name: event.locals.user.name,
      email: event.locals.user.email,
    },
    posts,
  };
}
