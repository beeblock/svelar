import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { ScheduleMonitor } from 'svelar/scheduler/ScheduleMonitor';

/**
 * POST /api/admin/scheduler/[name]/run
 * Manually trigger a scheduled task
 */
export const POST: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name } = event.params;

  try {
    await ScheduleMonitor.runTask(name!);
    return json({ success: true, message: `Task '${name}' triggered` });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to run task' }, { status: 500 });
  }
};
