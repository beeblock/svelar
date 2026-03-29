import { Scheduler } from 'svelar/scheduler';
import { ScheduleMonitor } from 'svelar/scheduler/ScheduleMonitor';
import CleanupExpiredTokens from '../scheduler/CleanupExpiredTokens.js';
import CleanExpiredSessions from '../scheduler/CleanExpiredSessions.js';
import PruneAuditLogs from '../scheduler/PruneAuditLogs.js';
import QueueHealthCheck from '../scheduler/QueueHealthCheck.js';
import BroadcastNotification from '../scheduler/BroadcastNotification.js';
import DailyDigestEmail from '../scheduler/DailyDigestEmail.js';

const scheduler = new Scheduler();
for (const TaskClass of [CleanupExpiredTokens, CleanExpiredSessions, PruneAuditLogs, QueueHealthCheck, BroadcastNotification, DailyDigestEmail]) {
  const task = new TaskClass();
  task.schedule();
  scheduler.register(task);
}
ScheduleMonitor.configure(scheduler);

export { ScheduleMonitor };
