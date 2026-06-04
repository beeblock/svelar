# Scheduler

Learn how to schedule periodic tasks in Svelar using cron-like syntax.

## What is the Scheduler?

The Scheduler runs tasks at specified times or intervals. It's perfect for background jobs like cleaning up expired data, generating reports, sending daily emails, etc.

## Scheduled Tasks

Scheduled tasks are classes that define when and what to run.

### Creating a Scheduled Task

```bash
npx svelar make:task CleanupExpiredSessions
```

This creates `src/lib/scheduler/CleanupExpiredSessions.ts`. Each task must be in its own file with a **default export**:

```typescript
import { ScheduledTask } from '@beeblock/svelar/scheduler';

export default class CleanupExpiredSessions extends ScheduledTask {
  name = 'cleanup-expired-sessions';

  schedule() {
    return this.daily();  // Run daily at midnight
  }

  async handle(): Promise<void> {
    console.log('Cleaning up expired sessions...');
    // await Connection.raw('DELETE FROM sessions WHERE expires_at < NOW()');
  }
}
```

## Scheduling Expressions

Define when tasks should run using fluent methods:

```typescript
export class MyTask extends ScheduledTask {
  name = 'my-task';

  schedule() {
    return this.cron('0 9 * * *');           // Every day at 9:00 AM
    return this.daily();                      // Every day at midnight
    return this.dailyAt('09:00');             // Every day at 9:00 AM
    return this.hourly();                     // Every hour
    return this.hourlyAt(15);                 // Every hour at :15 minutes
    return this.everyMinute();                // Every minute
    return this.everyFiveMinutes();           // Every 5 minutes
    return this.everyTenMinutes();            // Every 10 minutes
    return this.everyFifteenMinutes();        // Every 15 minutes
    return this.everyThirtyMinutes();         // Every 30 minutes
    return this.weekly();                     // Every Sunday at midnight
    return this.weeklyOn(3, '09:00');         // Every Wednesday at 9:00 AM (0=Sun, 3=Wed)
    return this.monthly();                    // First day of month at midnight
    return this.monthlyOn(15, '09:00');       // 15th of month at 9:00 AM
    return this.yearly();                     // January 1st at midnight
  }
}
```

## Task Methods

### handle()

The main method that runs when the task is triggered:

```typescript
export class GenerateReport extends ScheduledTask {
  name = 'generate-daily-report';

  schedule() {
    return this.dailyAt('09:00');
  }

  async handle(): Promise<void> {
    console.log('Generating report...');
    // Generate report logic
  }
}
```

### preventOverlap()

Prevent overlapping executions with a **distributed lock**. This is safe across multiple scheduler instances — only one process can execute the task at a time. The lock is database-backed and auto-expires if a process crashes:

```typescript
export default class LongRunningTask extends ScheduledTask {
  name = 'long-running-task';

  schedule() {
    return this.hourly().preventOverlap();
  }

  async handle(): Promise<void> {
    // This task won't run again until previous execution completes.
    // If another scheduler instance is already running this task, it will be skipped.
  }
}
```

By default the lock expires after 5 minutes. For longer tasks, increase the TTL:

```typescript
schedule() {
  // Lock expires after 30 minutes — use for long-running tasks
  return this.hourly().preventOverlap().lockExpiresAfter(30);
}
```

The `scheduler_locks` table is managed by Svelar core migrations.

### onSuccess()

Run code after successful execution:

```typescript
async onSuccess(): Promise<void> {
  console.log('Task completed successfully');
}
```

### onFailure()

Run code after failed execution:

```typescript
async onFailure(error: Error): Promise<void> {
  console.error('Task failed:', error.message);
}
```

## Task Registry

New scaffolded apps register tasks in `src/lib/shared/scheduler/index.ts`. Older projects can still rely on CLI task auto-discovery from `src/lib/shared/scheduler/` or `src/lib/scheduler/`. Each task file should contain a single class with a **default export**:

```
src/lib/scheduler/
├── CleanupExpiredSessions.ts
├── DailyStatsSummary.ts
└── BroadcastNotification.ts
```

```typescript
// src/lib/scheduler/DailyStatsSummary.ts
import { ScheduledTask } from '@beeblock/svelar/scheduler';

export default class DailyStatsSummary extends ScheduledTask {
  name = 'daily-stats';

  schedule() {
    return this.dailyAt('09:00');
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Generating daily stats...');
  }
}
```

You can also create a scheduler manually and register tasks programmatically:

```typescript
import { Scheduler } from '@beeblock/svelar/scheduler';
import CleanupExpiredSessions from './CleanupExpiredSessions.ts';
import DailyStatsSummary from './DailyStatsSummary.ts';

export function createScheduler(): Scheduler {
  const scheduler = new Scheduler();
  scheduler.register(new CleanupExpiredSessions());
  scheduler.register(new DailyStatsSummary());
  return scheduler;
}
```

## Running the Scheduler

### Development

Run the scheduler in development:

```bash
npx svelar schedule:run
```

This boots `src/app.ts`, then uses the scheduler registry from `src/lib/shared/scheduler/index.ts` or `src/lib/scheduler/index.ts` when present. Older projects without a registry fall back to auto-discovering task files from `src/lib/shared/scheduler/` or `src/lib/scheduler/`. The runner aligns to the top of each minute and persists task execution history to `scheduled_task_runs` so the admin dashboard can display accurate run times.

To run due tasks once and exit (useful for cron):

```bash
npx svelar schedule:run --once
```

### Production

In production, run **one scheduler instance** per deployment. Use [PM2](https://pm2.keymetrics.io/) to keep it alive:

```bash
# Install PM2 globally
npm install -g pm2

# Start the scheduler as a managed background process
pm2 start "npx svelar schedule:run" --name svelar-scheduler

# Persist across server reboots
pm2 startup
pm2 save
```

Or trigger it from a system cron job:

```bash
# Run due tasks every minute via cron
* * * * * cd /app && npx svelar schedule:run --once
```

### Multiple Instances & Distributed Locking

If you need to run multiple scheduler instances for high availability (e.g., across multiple servers), use `preventOverlap()` on your tasks. This acquires a database-backed distributed lock before executing, so only one instance runs each task at a time:

```typescript
schedule() {
  return this.everyFiveMinutes().preventOverlap();
}
```

The lock uses the shared database (SQLite, PostgreSQL, or MySQL) — no Redis required. Locks auto-expire via TTL, so crashed processes don't block future executions. The `scheduler_locks` table is created automatically on first use.

## Task Examples

### Cleanup Task

Remove expired data:

```typescript
import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Connection } from '@beeblock/svelar/database';

export default class CleanupExpiredSessions extends ScheduledTask {
  name = 'cleanup-expired-sessions';

  schedule() {
    return this.daily();  // Run daily at midnight
  }

  async handle(): Promise<void> {
    const now = new Date().toISOString();
    await Connection.raw(
      'DELETE FROM sessions WHERE expires_at < ?',
      [now]
    );

    console.log('[Scheduler] Cleaned up expired sessions');
  }

  async onSuccess(): Promise<void> {
    console.log('[Scheduler] Cleanup completed successfully');
  }

  async onFailure(error: Error): Promise<void> {
    console.error('[Scheduler] Cleanup failed:', error.message);
  }
}
```

### Report Generation Task

Generate and send daily reports:

```typescript
import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { User } from '../models/User.ts';
import { Post } from '../models/Post.ts';

export default class DailyReportTask extends ScheduledTask {
  name = 'daily-report';

  schedule() {
    return this.dailyAt('09:00');  // 9:00 AM every day
  }

  async handle(): Promise<void> {
    const userCount = await User.count();
    const postCount = await Post.count();
    const newUsers = await User
      .where('created_at', '>=', this.yesterday())
      .count();

    const report = {
      date: new Date().toLocaleDateString(),
      totalUsers: userCount,
      totalPosts: postCount,
      newUsersYesterday: newUsers,
    };

    // Send email, store to database, etc.
    console.log('[Scheduler] Daily report:', report);
  }

  private yesterday(): string {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  }
}
```

### Notification Task

Send notifications periodically:

```typescript
import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { User } from '../models/User.js';
import { Notifier } from '@beeblock/svelar/notifications';

export default class SendDailyDigestTask extends ScheduledTask {
  name = 'send-daily-digest';

  schedule() {
    return this.dailyAt('08:00');  // 8:00 AM
  }

  async handle(): Promise<void> {
    const users = await User.where('digest_enabled', true).get();

    for (const user of users) {
      // Send digest email to each user
      await Notifier.notify(user, new DailyDigestNotification());
    }

    console.log(`[Scheduler] Sent digest to ${users.length} users`);
  }
}
```

### Cache Warming Task

Pre-compute expensive data:

```typescript
import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Cache } from '@beeblock/svelar/cache';
import { Post } from '../models/Post.js';

export default class WarmCacheTask extends ScheduledTask {
  name = 'warm-cache';

  schedule() {
    return this.hourly();  // Every hour
  }

  async handle(): Promise<void> {
    // Cache popular posts
    const popularPosts = await Post
      .where('published', true)
      .orderBy('views', 'desc')
      .limit(10)
      .get();

    await Cache.put('popular_posts', popularPosts, 3600);  // 1 hour

    // Cache user counts by role
    const userCounts = await User.query()
      .select('role')
      .count('* as count')
      .groupBy('role')
      .get();

    await Cache.put('user_counts_by_role', userCounts, 3600);

    console.log('[Scheduler] Cache warmed');
  }
}
```

### Database Optimization Task

Optimize tables and indexes:

```typescript
import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Connection } from '@beeblock/svelar/database';

export default class OptimizeDatabaseTask extends ScheduledTask {
  name = 'optimize-database';

  schedule() {
    return this.weeklyOn('sunday', '02:00');  // Sunday at 2:00 AM
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Optimizing database...');

    // Note: SQL varies by database
    // MySQL
    await Connection.raw('OPTIMIZE TABLE users, posts, comments');

    // PostgreSQL
    // await Connection.raw('VACUUM ANALYZE;');

    console.log('[Scheduler] Database optimized');
  }
}
```

## Broadcasting from Scheduled Tasks

The scheduler runs in a separate Node process, so it doesn't share memory with the web server. To send real-time notifications (SSE/WebSocket) from a task, use an internal HTTP bridge — the task POSTs to a protected API endpoint on the web server, which then broadcasts to connected clients:

```typescript
// src/lib/scheduler/BroadcastNotification.ts
import { ScheduledTask } from '@beeblock/svelar/scheduler';

export default class BroadcastNotification extends ScheduledTask {
  name = 'broadcast-notification';

  schedule() {
    return this.everyMinute();
  }

  async handle(): Promise<void> {
    const baseUrl = process.env.APP_URL || 'http://localhost:5173';
    const secret = process.env.INTERNAL_SECRET!;

    const res = await fetch(`${baseUrl}/api/internal/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({
        channel: 'notifications',
        eventName: 'toast',
        data: {
          variant: 'info',
          title: 'Scheduled Update',
          description: `System check completed at ${new Date().toLocaleTimeString()}`,
        },
      }),
    });

    if (!res.ok) throw new Error(`Broadcast failed (${res.status})`);
  }
}
```

The web server's internal broadcast endpoint receives the request and publishes to the in-memory SSE channel:

```typescript
// src/routes/api/internal/broadcast/+server.ts
import { Broadcast } from '@beeblock/svelar/broadcasting';
import { json, error } from '@sveltejs/kit';

export async function POST({ request }) {
  const secret = request.headers.get('X-Internal-Secret');
  if (!process.env.INTERNAL_SECRET || secret !== process.env.INTERNAL_SECRET) {
    throw error(403, 'Forbidden');
  }

  const { channel, eventName, data } = await request.json();
  Broadcast.channel(channel).emit(eventName, data);
  return json({ ok: true });
}
```

## Inline Tasks

For simple cases, use inline tasks without creating separate classes:

```typescript
import { task, Scheduler } from '@beeblock/svelar/scheduler';

const scheduler = new Scheduler();

const cleanupTask = task('cleanup', async () => {
  console.log('Cleaning up...');
}, (t) => t.daily());

scheduler.register(cleanupTask);
```

## Task Run History

Task execution history is automatically persisted to the `scheduled_task_runs` database table. This is shared across all processes — the CLI scheduler writes to it, and the admin dashboard reads from it.

Both the `scheduled_task_runs` and `scheduler_locks` tables are managed by Svelar core migrations.

## Monitoring Scheduled Tasks

The `ScheduleMonitor` provides a real-time view of all tasks for use in admin dashboards. It reads history from the database so it reflects runs from all scheduler processes:

```typescript
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';

// Configure once with your scheduler instance.
// New scaffolded apps do this in src/lib/shared/scheduler/index.ts.
ScheduleMonitor.configure(scheduler);

// List all tasks with status, last run, next run, history
const tasks = await ScheduleMonitor.listTasks();

// Get health metrics (total tasks, errors, uptime)
const health = await ScheduleMonitor.getHealth();

// Manually trigger a task from the admin panel
await ScheduleMonitor.runTask('cleanup-expired-sessions');

// Enable/disable tasks
ScheduleMonitor.disableTask('daily-report');
ScheduleMonitor.enableTask('daily-report');
```

## Best Practices

1. **Keep tasks idempotent** — Tasks should be safe to run multiple times
2. **Set appropriate intervals** — Don't run expensive tasks too frequently
3. **Handle errors gracefully** — Use `onFailure()` to log and handle errors
4. **Use `preventOverlap()` for long tasks** — Prevents duplicate execution across processes
5. **Set `lockExpiresAfter()`** — Match the TTL to your task's expected duration
6. **Run one scheduler instance** — Unless using `preventOverlap()` for distributed locking
7. **Test tasks** — Write tests for task logic
8. **Keep tasks focused** — One responsibility per task

## Next Steps

- Learn [Queue Jobs](./11-queue-jobs.md) for background job processing
- Explore [Services](./08-services-actions-repositories.md) for task logic
- Check [Events](./12-additional-features.md) for event-driven tasks

---

**Svelar Scheduler Guide** © 2026
