import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { ScheduleMonitor } from '$lib/server/scheduler-monitor.js';

/**
 * GET /api/admin/scheduler
 * List all scheduled tasks
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const tasks = ScheduleMonitor.listTasks();
    const health = ScheduleMonitor.getHealth();

    return json({ tasks, health });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to fetch scheduled tasks' }, { status: 500 });
  }
};
