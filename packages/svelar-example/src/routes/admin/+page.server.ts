import type { ServerLoadEvent } from '@sveltejs/kit';
import { User } from '$lib/models/User.js';
import { Post } from '$lib/models/Post.js';
import { JobMonitor } from 'svelar/queue/JobMonitor';
import { ScheduleMonitor } from 'svelar/scheduler/ScheduleMonitor';
import { LogViewer } from 'svelar/logging/LogViewer';
import { Permissions } from 'svelar/permissions';

export async function load(event: ServerLoadEvent) {
  const user = event.locals.user;

  // Fetch all users
  const users = await User.query().get();

  // Fetch stats
  const userCount = users.length;
  const postCount = await Post.count();

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

  // Roles & Permissions
  let roles: any[] = [];
  let permissions: any[] = [];
  let rolePermissionsMap: Record<number, number[]> = {};
  let userRolesMap: Record<number, any[]> = {};
  let userDirectPermsMap: Record<number, any[]> = {};
  try {
    roles = await Permissions.allRoles();
    permissions = await Permissions.allPermissions();

    // Load permissions for each role
    for (const role of roles) {
      const rolePerms = await Permissions.getRolePermissions(role.id);
      rolePermissionsMap[role.id] = rolePerms.map((p: any) => p.id);
    }

    // Load roles and direct permissions for each user
    for (const u of users) {
      userRolesMap[u.id] = await Permissions.getModelRoles('User', u.id);
      userDirectPermsMap[u.id] = await Permissions.getModelDirectPermissions('User', u.id);
    }
  } catch { /* permissions tables may not exist yet */ }

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
      postCount,
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
    roles: roles.map((r: any) => ({
      id: r.id,
      name: r.name,
      guard: r.guard,
      description: r.description,
      created_at: r.created_at,
    })),
    permissions: permissions.map((p: any) => ({
      id: p.id,
      name: p.name,
      guard: p.guard,
      description: p.description,
      created_at: p.created_at,
    })),
    rolePermissionsMap,
    userRolesMap: Object.fromEntries(
      Object.entries(userRolesMap).map(([uid, roles]) => [
        uid,
        roles.map((r: any) => ({ id: r.id, name: r.name })),
      ]),
    ),
    userDirectPermsMap: Object.fromEntries(
      Object.entries(userDirectPermsMap).map(([uid, perms]) => [
        uid,
        perms.map((p: any) => ({ id: p.id, name: p.name })),
      ]),
    ),
  };
}
