import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { User } from '$lib/models/User.js';
import { Post } from '$lib/models/Post.js';
import { JobMonitor } from 'svelar/queue/JobMonitor';
import { ScheduleMonitor } from '$lib/server/scheduler-monitor.js';
import { LogViewer } from 'svelar/logging/LogViewer';

export async function GET(event: RequestEvent) {
  try {
    const user = event.locals.user;

    if (!user || user.role !== 'admin') {
      return json({ message: 'Unauthorized' }, { status: 403 });
    }

    // App stats
    const users = await User.query().get();
    const posts = await Post.query().get();

    const roleDistribution = {
      admin: users.filter((u: any) => u.role === 'admin').length,
      user: users.filter((u: any) => u.role === 'user').length,
    };

    const publishedPosts = posts.filter((p: any) => p.published).length;

    // System stats from monitors
    const [queueHealth] = await Promise.all([
      JobMonitor.getHealth(),
    ]);

    const schedulerHealth = await ScheduleMonitor.getHealth();
    const logStats = LogViewer.getStats();
    const recentErrors = LogViewer.getRecentErrors(10);

    return json({
      userCount: users.length,
      postCount: posts.length,
      publishedPosts,
      draftPosts: posts.length - publishedPosts,
      roleDistribution,
      queue: queueHealth,
      scheduler: schedulerHealth,
      logs: logStats,
      recentErrors,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error fetching stats:', err);
    return json({ message: 'Internal server error' }, { status: 500 });
  }
}
