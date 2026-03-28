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
import { ScheduledTask } from 'svelar/scheduler';

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
    return this.weekly();                     // Every Monday at midnight
    return this.weeklyOn('wednesday', '09:00'); // Every Wednesday at 9:00 AM
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

### preventing()

Prevent overlapping executions:

```typescript
export class LongRunningTask extends ScheduledTask {
  name = 'long-running-task';

  schedule() {
    return this.hourly();
  }

  async handle(): Promise<void> {
    // This task won't run again until previous execution completes
  }

  preventing() {
    return true;  // Default is false
  }
}
```

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

## Task Discovery

The CLI auto-discovers task files from `src/lib/scheduler/`. Each file must contain a single class with a **default export**:

```
src/lib/scheduler/
├── CleanupExpiredSessions.ts
├── DailyStatsSummary.ts
└── BroadcastNotification.ts
```

```typescript
// src/lib/scheduler/DailyStatsSummary.ts
import { ScheduledTask } from 'svelar/scheduler';

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
import { Scheduler } from 'svelar/scheduler';
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

This auto-discovers task files from `src/lib/scheduler/`, checks which tasks are due every 60 seconds, and runs them.

To run due tasks once and exit (useful for cron):

```bash
npx svelar schedule:run --once
```

### Production

In production, run the scheduler as a background process. [PM2](https://pm2.keymetrics.io/) is a Node.js process manager that keeps your services alive, auto-restarts on crash, and handles log rotation:

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

Create a script that calls `scheduler.runDueTasks()` and schedule it with cron:

```bash
# Run every minute
* * * * * cd /app && node scripts/run-scheduler.js
```

## Task Examples

### Cleanup Task

Remove expired data:

```typescript
import { ScheduledTask } from 'svelar/scheduler';
import { Connection } from 'svelar/database';

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
import { ScheduledTask } from 'svelar/scheduler';
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
import { ScheduledTask } from 'svelar/scheduler';
import { User } from '../models/User.js';
import { Notifier } from 'svelar/notifications';

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
import { ScheduledTask } from 'svelar/scheduler';
import { Cache } from 'svelar/cache';
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
import { ScheduledTask } from 'svelar/scheduler';
import { Connection } from 'svelar/database';

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
import { ScheduledTask } from 'svelar/scheduler';

export default class BroadcastNotification extends ScheduledTask {
  name = 'broadcast-notification';

  schedule() {
    return this.everyMinute();
  }

  async handle(): Promise<void> {
    const baseUrl = process.env.APP_URL || 'http://localhost:5173';
    const secret = process.env.INTERNAL_SECRET || 'svelar-internal-secret';

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
import { Broadcast } from 'svelar/broadcasting';
import { json, error } from '@sveltejs/kit';

export async function POST({ request }) {
  const secret = request.headers.get('X-Internal-Secret');
  if (secret !== (process.env.INTERNAL_SECRET || 'svelar-internal-secret')) {
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
import { task } from 'svelar/scheduler';

export const scheduler = new Scheduler()
  .task('cleanup', async () => {
    console.log('Cleaning up...');
  })
  .schedule(() => scheduler.task('cleanup').daily());
```

## Monitoring Scheduled Tasks

Monitor task execution:

```typescript
export class TaskMonitoring extends ScheduledTask {
  name = 'task-monitoring';

  schedule() {
    return this.everyMinute();
  }

  async handle(): Promise<void> {
    const tasks = this.scheduler.getTasks();
    const nextRun = tasks[0].nextRunAt();

    console.log(`Next scheduled task: ${tasks[0].name} at ${nextRun}`);
  }
}
```

## Best Practices

1. **Keep tasks idempotent** - Tasks should be safe to run multiple times
2. **Set appropriate intervals** - Don't run expensive tasks too frequently
3. **Handle errors gracefully** - Use onFailure() to log and handle errors
4. **Monitor task execution** - Track which tasks ran and when
5. **Use preventing() for long tasks** - Avoid overlapping executions
6. **Log task execution** - Always log when tasks start and finish
7. **Test tasks** - Write tests for task logic
8. **Document purposes** - Explain why each task exists

## Next Steps

- Learn [Queue Jobs](./11-queue-jobs.md) for background job processing
- Explore [Services](./08-services-actions-repositories.md) for task logic
- Check [Events](./12-additional-features.md) for event-driven tasks

---

**Svelar Scheduler Guide** © 2026
