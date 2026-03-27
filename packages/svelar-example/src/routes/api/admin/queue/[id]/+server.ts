import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { JobMonitor } from 'svelar/queue/JobMonitor';

/**
 * GET /api/admin/queue/[id]
 * Get details for a single job
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = event.params;

  try {
    const job = await JobMonitor.getJob(id!);
    if (!job) {
      return json({ error: 'Job not found' }, { status: 404 });
    }
    return json(job);
  } catch (error: any) {
    return json({ error: error.message || 'Failed to fetch job' }, { status: 500 });
  }
};

/**
 * DELETE /api/admin/queue/[id]
 * Remove a job from the queue
 */
export const DELETE: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = event.params;

  try {
    await JobMonitor.deleteJob(id!);
    return json({ success: true, message: 'Job removed' });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to remove job' }, { status: 500 });
  }
};
