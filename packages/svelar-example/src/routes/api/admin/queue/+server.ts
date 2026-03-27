import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { JobMonitor } from 'svelar/queue/JobMonitor';

/**
 * GET /api/admin/queue
 * List jobs from the queue with filtering
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = event.url;
  const status = searchParams.get('status') || 'all';
  const queueName = searchParams.get('queue') || 'default';
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const jobs = await JobMonitor.listJobs({
      queue: queueName,
      status: status === 'all' ? undefined : status as any,
      limit,
      offset,
    });

    const counts = await JobMonitor.getCounts(queueName);

    return json({ jobs, counts, queueName });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to fetch queue jobs' }, { status: 500 });
  }
};
