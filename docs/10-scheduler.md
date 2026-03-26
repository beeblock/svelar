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

This creates `src/lib/scheduler/CleanupExpiredSessions.ts`:

```typescript
import { ScheduledTask } from 'svelar/scheduler';

export class CleanupExpiredSessions extends ScheduledTask {
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

## Creating the Scheduler

Create a scheduler instance and register tasks:

```typescript
// src/lib/scheduler/tasks.ts
import { ScheduledTask, Scheduler } from 'svelar/scheduler';
import { Connection } from 'svelar/database';

class CleanupExpiredSessions extends ScheduledTask {
  name = 'cleanup-expired-sessions';

  schedule() {
    return this.daily();
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Cleaning expired sessions...');
    // await Connection.raw('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
  }
}

class DailyStatsSummary extends ScheduledTask {
  name = 'daily-stats';

  schedule() {
    return this.dailyAt('09:00');
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Generating daily stats...');
    // const userCount = await User.count();
    // const postCount = await Post.count();
    // Send report email...
  }
}

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

This runs tasks as they're scheduled. It blocks until interrupted.

### Production

In production, run the scheduler as a background process:

```bash
# Run with a process manager like PM2
pm2 start "npx svelar schedule:run" --name svelar-scheduler
```

Or use a cron job to trigger:

```bash
# Run scheduler every minute
* * * * * cd /app && npx svelar schedule:work
```

## Task Examples

### Cleanup Task

Remove expired data:

```typescript
import { ScheduledTask } from 'svelar/scheduler';
import { Connection } from 'svelar/database';

export class CleanupExpiredSessions extends ScheduledTask {
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
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';

export class DailyReportTask extends ScheduledTask {
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

export class SendDailyDigestTask extends ScheduledTask {
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

export class WarmCacheTask extends ScheduledTask {
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

export class OptimizeDatabaseTask extends ScheduledTask {
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

## Complete Example from svelar-example

From the svelar-example app:

```typescript
// src/lib/scheduler/tasks.ts
import { ScheduledTask, Scheduler } from 'svelar/scheduler';
import { Connection } from 'svelar/database';

class CleanupExpiredSessions extends ScheduledTask {
  name = 'clean-expired-sessions';

  schedule() {
    return this.daily();
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Cleaning expired sessions...');
    // await Connection.raw('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
  }
}

class DailyStatsSummary extends ScheduledTask {
  name = 'daily-stats';

  schedule() {
    return this.dailyAt('09:00');
  }

  async handle(): Promise<void> {
    console.log('[Scheduler] Generating daily stats...');
    // const userCount = await User.count();
    // const postCount = await Post.count();
    // await Mailer.send({ to: 'admin@example.com', body: `Users: ${userCount}, Posts: ${postCount}` });
  }
}

export function createScheduler(): Scheduler {
  const scheduler = new Scheduler();
  scheduler.register(new CleanupExpiredSessions());
  scheduler.register(new DailyStatsSummary());
  return scheduler;
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
