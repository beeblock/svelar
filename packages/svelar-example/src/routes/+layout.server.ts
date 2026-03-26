import type { ServerLoadEvent } from '@sveltejs/kit';

export async function load(event: ServerLoadEvent) {
  const user = event.locals.user;

  return {
    user: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
        }
      : null,
  };
}
