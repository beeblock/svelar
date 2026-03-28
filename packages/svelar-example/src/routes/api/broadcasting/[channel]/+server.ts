import type { RequestHandler } from '@sveltejs/kit';
import { Broadcast } from 'svelar/broadcasting';

/**
 * SSE subscription endpoint.
 * GET /api/broadcasting/:channel → returns an SSE stream.
 */
export const GET: RequestHandler = async (event) => {
  const channelName = event.params.channel!;

  // Private/presence channels require authentication
  if (channelName.startsWith('private-') || channelName.startsWith('presence-')) {
    const user = event.locals.user;
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const authorized = await Broadcast.authorize(channelName, user);
    if (!authorized) {
      return new Response('Forbidden', { status: 403 });
    }

    if (channelName.startsWith('presence-') && typeof authorized === 'object') {
      return Broadcast.subscribe(channelName, user.id, authorized);
    }

    return Broadcast.subscribe(channelName, user.id);
  }

  // Public channels — no auth needed
  const user = event.locals.user;
  return Broadcast.subscribe(channelName, user?.id);
};
