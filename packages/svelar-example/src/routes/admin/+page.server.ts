import { redirect } from '@sveltejs/kit';
import type { ServerLoadEvent } from '@sveltejs/kit';
import { User } from '$lib/models/User.js';
import { JobMonitor } from 'svelar/queue/JobMonitor';
import { ScheduleMonitor } from 'svelar/scheduler/ScheduleMonitor';
import { LogViewer } from 'svelar/logging/LogViewer';

export async function load(event: ServerLoadEvent) {
  const user = event.locals.user;

  // Check if user is admin
  if (!user || user.role !== 'admin') {
    throw redirect(302, '/dashboard');
  }

  // Fetch all users
  const users = await User.query().get();

  // Fetch stats
  const userCount = users.length;
  const postCount = await User.query()
    .selectRaw('COUNT(*) as count')
    .from('posts')
    .first();

  const roleDistribution = {
    admin: users.filter((u: any) => u.role === 'admin').length,
    user: users.filter((u: any) => u.role === 'user').length,
  };

  // Queue stats from JobMonitor
  let queueCounts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
  try {
    queueCounts = await JobMonitor.getCounts('default');
  } catch { /* sync/memory driver — no counts available */ }

  // Scheduler tasks from ScheduleMonitor
  let scheduledTasks: any[] = [];
  try {
    scheduledTasks = ScheduleMonitor.listTasks();
  } catch { /* scheduler not configured */ }

  // Recent logs from LogViewer
  let recentLogs: any[] = [];
  let logStats = { totalEntries: 0, byLevel: {} as Record<string, number>, byChannel: {} };
  try {
    recentLogs = LogViewer.query({ limit: 50 });
    logStats = LogViewer.getStats();
  } catch { /* no logs yet */ }

  // System health
  const memUsage = process.memoryUsage();
  const health = {
    status: 'ok',
    uptime: process.uptime(),
    memoryUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    memoryTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
    memoryPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
  };

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    users: users.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      created_at: u.created_at,
    })),
    stats: {
      userCount,
      postCount: postCount?.count || 0,
      roleDistribution,
    },
    queueCounts,
    scheduledTasks: scheduledTasks.map((t: any) => ({
      name: t.name,
      expression: t.expression,
      humanReadable: t.humanReadable,
      enabled: t.enabled,
      isRunning: t.isRunning,
      lastRun: t.lastRun?.toISOString() ?? null,
      lastStatus: t.lastStatus ?? null,
      nextRun: t.nextRun?.toISOString() ?? null,
    })),
    recentLogs: recentLogs.map((l: any) => ({
      timestamp: l.timestamp,
      level: l.level,
      channel: l.channel,
      message: l.message,
    })),
    logStats,
    health,
  };
}
