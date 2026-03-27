import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { LogViewer } from 'svelar/logging/LogViewer';

/**
 * GET /api/admin/logs
 * Retrieve logs with filtering
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = event.url;
  const level = searchParams.get('level');
  const channel = searchParams.get('channel');
  const search = searchParams.get('search');
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const logs = LogViewer.query({
      level: level as any,
      channel: channel ?? undefined,
      search: search ?? undefined,
      limit,
      offset,
    });

    const stats = LogViewer.getStats();

    return json({ logs, total: stats.totalEntries, limit, offset });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to fetch logs' }, { status: 500 });
  }
};
