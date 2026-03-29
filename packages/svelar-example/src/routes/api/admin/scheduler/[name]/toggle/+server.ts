import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { ScheduleMonitor } from '$lib/server/scheduler-monitor.js';

/**
 * POST /api/admin/scheduler/[name]/toggle
 * Enable or disable a scheduled task
 */
export const POST: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name } = event.params;
  const body = await event.request.json();
  const enabled = body.enabled ?? true;

  try {
    if (enabled) {
      ScheduleMonitor.enableTask(name!);
    } else {
      ScheduleMonitor.disableTask(name!);
    }

    return json({ success: true, message: `Task '${name}' ${enabled ? 'enabled' : 'disabled'}` });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to toggle task' }, { status: 500 });
  }
};
