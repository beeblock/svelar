import type { RequestHandler } from '@sveltejs/kit';
import { LogViewer } from 'svelar/logging/LogViewer';

/**
 * GET /api/admin/logs/tail
 * Server-Sent Events stream of live logs
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  };

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const unsubscribe = LogViewer.tail((entry) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
        } catch {
          unsubscribe();
        }
      });

      // Clean up when client disconnects
      event.request.signal.addEventListener('abort', () => {
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, { headers });
};
