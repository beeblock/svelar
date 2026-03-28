import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { Broadcast } from 'svelar/broadcasting';

/**
 * Internal HTTP bridge for broadcasting events.
 *
 * The scheduler runs in a separate process and cannot access
 * the web server's in-memory SSE channels directly. Instead,
 * it POSTs here, and this endpoint pushes to connected SSE clients.
 *
 * Protected by a shared secret to prevent unauthorized use.
 */
export const POST: RequestHandler = async (event) => {
  const secret = event.request.headers.get('x-internal-secret');
  const expected = process.env.INTERNAL_SECRET || 'svelar-internal-secret';

  if (secret !== expected) {
    return json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { channel, eventName, data } = await event.request.json();

    if (!channel || !eventName) {
      return json({ message: 'channel and eventName are required' }, { status: 400 });
    }

    await Broadcast.to(channel).send(eventName, data ?? {});

    return json({
      message: 'Event broadcast',
      subscribers: Broadcast.totalSubscribers(),
    });
  } catch (err: any) {
    return json({ message: err.message || 'Failed to broadcast' }, { status: 500 });
  }
};
