import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { JobMonitor } from 'svelar/queue/JobMonitor';

/**
 * POST /api/admin/queue/[id]/retry
 * Retry a failed job
 */
export const POST: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = event.params;

  try {
    await JobMonitor.retryJob(id!);
    return json({ success: true, message: 'Job queued for retry' });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to retry job' }, { status: 500 });
  }
};
