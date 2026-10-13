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

In DDD apps this creates `src/lib/shared/scheduler/CleanupExpiredSessions.ts`; in flat apps it creates `src/lib/scheduler/CleanupExpiredSessions.ts`. Each task should live in its own file with a **default export**, then be registered in the scheduler registry.

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
export default class MyTask extends ScheduledTask {
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

### Cron Semantics And Timezones

Svelar uses [cron-parser 5](https://github.com/harrisiirak/cron-parser) for validation, calendar iteration, and timezone handling. The public contract remains five fields: minute, hour, day of month, month, and day of week. Numeric lists, ranges, positive steps, three-letter month/weekday names, and Sunday `0` or `7` are supported. Seconds fields, macros, randomized `H`, and Quartz-style `L`, `#`, or `?` extensions are not enabled.

The calendar engine and its timezone dependency are bundled privately into Svelar's server builds. Applications do not need to add or override `cron-parser`; BullMQ can retain its own required major version without production SSR resolving Svelar's calendar calls against that older version.

`parseCron(expression)` returns sorted numeric arrays, with `null` for literal `*` fields and Sunday normalized to `0`. Invalid zero steps, out-of-range values, reversed ranges, trailing characters, and impossible explicit calendar dates reject before iteration. Fluent methods validate their inputs too; time strings must use `HH:MM` (a single-digit hour is also accepted).

When both day of month and day of week are restricted, either may match: `0 9 1 * MON` runs on the first of the month **or** on Mondays. The minute, hour, and month still must match. `cronMatches` checks the specified minute and ignores seconds/milliseconds without modifying the caller's date.

Use a per-task timezone for consistent behavior across hosts:

```typescript
schedule() {
  return this.dailyAt('09:00').timezone('America/Sao_Paulo');
}
```

Without an explicit timezone, schedules use the process's system timezone (including `TZ`); they do not implicitly default to UTC. In persistent mode the precedence is the stored task timezone, scheduler scope timezone, task `.timezone(...)`, then system time. Both execution and monitor previews use that effective timezone. DST calendar adjustments follow cron-parser's iterator policy.

`Scheduler.register()` validates a task before adding it. A legacy, non-persistent scheduler can execute twice if `run()` is called twice in the same due minute. Persistent mode records checked minutes and supports bounded missed-run policies, but neither mode guarantees exactly-once side effects. Tasks must remain idempotent.

### handle()

The main method that runs when the task is triggered:

```typescript
export default class GenerateReport extends ScheduledTask {
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

By default the lease TTL is 5 minutes. Execution renews the lease while the task and its asynchronous hooks are still running. Choose a TTL that tolerates expected database latency and event-loop delays:

```typescript
schedule() {
  // Allow a longer interruption before the renewable lease expires.
  return this.hourly().preventOverlap().lockExpiresAfter(30);
}
```

The `scheduler_locks` table is managed by Svelar core migrations. If the lock table or database connection is unavailable, a `preventOverlap()` task fails instead of running without a distributed lock. Persistent mode leases every task, even without `.preventOverlap()`. Losing ownership aborts the task's execution signal and prevents the old owner from recording a successful completion or releasing a successor's lease. Tasks must observe that signal before further side effects; a lease cannot stop uncooperative application code.

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

Svelar uses an explicit scheduler registry. DDD apps register tasks in `src/lib/shared/scheduler/index.ts`; flat apps register tasks in `src/lib/scheduler/index.ts`. The CLI does not auto-discover task files, so every scheduled task must be imported and registered in the registry.

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

Create a scheduler and register tasks programmatically:

```typescript
import { Scheduler } from '@beeblock/svelar/scheduler';
import CleanupExpiredSessions from '$lib/shared/scheduler/CleanupExpiredSessions';
import DailyStatsSummary from '$lib/shared/scheduler/DailyStatsSummary';

export function createScheduler(): Scheduler {
  const scheduler = new Scheduler({
    persistent: true,
    timezone: process.env.SCHEDULER_TIMEZONE,
  });
  scheduler.register(new CleanupExpiredSessions());
  scheduler.register(new DailyStatsSummary());
  return scheduler;
}
```

Use `$lib/scheduler/...` imports in flat apps. Declare `SCHEDULER_TIMEZONE` in the app's `.env.example` and load environment configuration through the normal `src/app.ts` bootstrap. Leaving it unset retains task/system timezone behavior.

## Persistent Runtime

Production controls are opt-in: use `new Scheduler({ persistent: true })` or `scheduler.persistRuntimeToDatabase()`. Both enable shared history, task settings, runtime state, renewable leases and durable run-now requests. Calling only `.persistToDatabase().persistTaskSettings()` retains the older history/settings mode; it does not enable durable requests or shared execution state. Plain `new Scheduler()` remains local and does not deduplicate repeated due checks.

Before enabling persistent mode, run:

```bash
npx svelar migrate
```

Core migrations manage `scheduler_locks`, `scheduled_task_runs`, `scheduled_task_settings`, `scheduler_runtime` and `scheduler_requests`. The focused settings upgrade preserves existing global enable/disable records, including disabled tasks. Missing tables and database errors fail closed; runtime code never creates tables.

### Tenant Scope And Configuration Profiles

A scheduler captures its tenant and connection scope at construction. It never infers tenant scope from the current web request. Build separate instances with trusted configuration, register the same task catalog in the web process and worker, and use the same shared database:

```typescript
import { Scheduler, type SchedulerOptions } from '@beeblock/svelar/scheduler';
import CleanupExpiredSessions from '$lib/shared/scheduler/CleanupExpiredSessions';

export function createScopedScheduler(options: SchedulerOptions): Scheduler {
  return new Scheduler({ ...options, persistent: true })
    .register(new CleanupExpiredSessions());
}

// Values come from authorized tenant configuration, not client input.
const scheduler = createScopedScheduler({
  tenantId: tenant.id,
  timezone: tenant.timezone,
  connectionName: schedulerConnectionName,
});
```

These are application configuration profiles, not a `--profile` CLI flag. The CLI boots `src/app.ts` and consumes the scope returned by the registry's `createScheduler()` or `scheduler` export. An omitted/null tenant selects the global scope. A non-null tenant automatically enables persistent mode. The same task name in two tenants has separate settings, locks, requests, history and runtime state; tenant tasks execute in an isolated `ApplicationContext` with the captured team ID.

### Persistent Controls

Apply operator changes through an authorized FormRequest/DTO/action flow. These service APIs do not authorize callers themselves:

```typescript
await scheduler.configureTask('cleanup-expired-sessions', {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  missedRun: { policy: 'catch-up', windowMinutes: 60, maxRuns: 10 },
});

await scheduler.configureTask('cleanup-expired-sessions', { enabled: false });
// null removes the stored timezone override and restores scope/task fallback.
await scheduler.configureTask('cleanup-expired-sessions', { timezone: null });
```

The worker reads persisted controls on its next poll. Changes survive restart; disabling does not forcibly interrupt an already-running task. Pending requests remain pending while disabled, and new requests for a disabled task reject. Re-enabling does not replay the entire disabled interval.

### Missed Runs

Task defaults can be declared in `schedule()`; a stored `configureTask()` policy overrides them:

```typescript
schedule() {
  return this.everyFiveMinutes()
    .missedRuns('catch-up', { windowMinutes: 60, maxRuns: 10 });
}
```

- `skip` is the default: run only if the current minute is due.
- `latest` runs at most the latest missed slot within the configured window.
- `catch-up` executes the most recent missed slots, in chronological order, up to `maxRuns` within the window.

The window is bounded to 1-10,080 minutes and the run count to 1-100; defaults are 60 minutes and 10 runs. Catch-up begins from the persisted checked minute, so a first-ever startup does not invent historical runs. Older slots beyond the window/count are discarded. `this.getExecutionContext()?.scheduledFor` identifies a scheduled slot; a manual request has a `requestId` instead. There is no general exactly-once guarantee after a crash: use idempotency keys around external side effects.

### Queued Run Now

Queue a registered task without executing it in the web/command process:

```typescript
const request = await scheduler.requestRun('cleanup-expired-sessions');
// request.state === 'pending'; completion comes from a scheduler worker.
const status = await scheduler.getRunRequest(request.task, request.id);
const cancelled = await scheduler.cancelRunRequest(request.task, request.id);
```

Cancellation returns `true` only for a pending request in this scheduler's task/tenant scope; running or terminal requests cannot be cancelled through this API. Unknown tasks reject, and a foreign request lookup returns `null`. Requests transition through `pending`, `running`, `succeeded`/`failed` or `cancelled`. A worker renews request and task leases together. Abandoned running requests become eligible after lease expiry, so recovery is at-least-once: a crash after an external write can repeat that write. `requestedBy` and correlation context are captured from the authenticated `ApplicationContext`; populate them on the server, not from a request body.

## Running the Scheduler

### Development

Run the scheduler in development:

```bash
npx svelar schedule:work
```

This boots `src/app.ts`, then loads the scheduler registry from `src/lib/shared/scheduler/index.ts` in DDD apps or `src/lib/scheduler/index.ts` in flat apps. `schedule:work` and continuous `schedule:run` use the same worker implementation. Persistent workers poll for durable requests (default 1,000 ms) and deduplicate scheduled minutes through shared state; legacy registries run due checks once per minute.

Run `npx svelar migrate` before starting the scheduler in any app that calls `persistToDatabase()`. If the `scheduled_task_runs` table is unavailable, the scheduler run fails instead of silently dropping history.

When using the built-in `Scheduler.start()` ticker, call `scheduler.getRuntimeStatus()` from health checks or dashboards to inspect `lastTickAt`, `lastSuccessAt`, `lastErrorAt`, `lastError`, and consecutive `failures`. Timer failures are recorded there instead of being logged and forgotten.

To run due tasks once and exit (useful for cron):

```bash
npx svelar schedule:run --once
```

In persistent mode, this also consumes pending requests during that tick. Failed task results set a nonzero command exit status; an overlap-skipped result is not a failure.

Queue one manual run and exit, then inspect shared status without executing tasks:

```bash
npx svelar schedule:run --task=cleanup-expired-sessions
npx svelar schedule:list
npx svelar schedule:list --json
```

`--task` requires a persistent registry and prints the durable request ID/state, not a success claim for the task itself. `schedule:list --json` returns `{ data, meta }` with task names, tenant IDs, effective timezones, enablement, last/next run, duration/state, lock owners/expiry and missed-run policies.

### Graceful Drain

```bash
npx svelar schedule:work --sleep=1000 --max-time=3600 --grace-period=30
```

`--sleep` accepts 10-60,000 milliseconds. `--max-time` begins draining after a positive number of seconds; omitting it runs until a signal. `--grace-period` is a positive warning interval in seconds, not a force-kill deadline. `SIGINT`, `SIGTERM`, `--max-time` and `await scheduler.stop()` stop accepting work and wait for the active handler and hooks. Leases stay renewed until actual completion, even beyond the grace period. Configure the process manager's termination timeout accordingly.

Lease renewal failures surface as errors instead of false successful completion. Cooperative handlers should call `this.getExecutionContext()?.signal.throwIfAborted()` before further external writes and pass the signal to cancellation-aware clients. Draining itself does not abort healthy work.

### Production

In production, a single worker is the simplest topology. Persistent mode also supports competing workers sharing one database and the same explicit task/tenant scopes. The generated Docker topology includes a dedicated `scheduler` service:

```bash
docker compose up -d scheduler
```

For local development, keep infrastructure in Docker and run the scheduler from source:

```bash
npm run dev:scheduler
```

Or trigger it from a system cron job:

```bash
# Run due tasks every minute via cron
* * * * * cd /app && npx svelar schedule:run --once
```

### Multiple Instances & Distributed Locking

Persistent mode acquires renewable database leases for every task and guards request claims with an invocation owner token. For a legacy registry, explicitly use `preventOverlap()` if several instances can run the same task:

```typescript
schedule() {
  return this.everyFiveMinutes().preventOverlap();
}
```

The lock uses the shared database (SQLite, PostgreSQL, or MySQL), with no Redis requirement. Crashed processes eventually lose their leases. This prevents simultaneous healthy owners, not repeated side effects after a crash or stalled process. Database outages fail closed; graceful shutdown awaits work before releasing ownership.

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
    return this.weeklyOn(0, '02:00');  // Sunday at 2:00 AM
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

Task execution history is persisted to `scheduled_task_runs` when the registry calls `persistToDatabase()` or enables persistent runtime. The CLI writes history and the monitor reads it across processes. Missing storage fails instead of silently dropping history. Persistent tenant histories use scoped task keys, so the same task name in another tenant does not appear in this scope. The monitor bounds history per task, so a frequently running task cannot hide another task's last failure.

`persistTaskSettings()` remains available for legacy shared enable/disable controls; prefer persistent runtime for production controls, requests and shared execution state. All scheduler tables are managed by core migrations.

## Monitoring Scheduled Tasks

The `ScheduleMonitor` reads durable task state and history for admin dashboards. Use a separate monitor per immutable scheduler scope, especially in concurrent tenant requests:

Run `npx svelar migrate` before using the monitor in production. Missing storage fails rather than returning fabricated empty history. Enable/disable calls persist settings, so the web process can control the worker after restart.

```typescript
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';

const monitor = ScheduleMonitor.forScheduler(scheduler);

// List all tasks with status, last run, next run, history
const tasks = await monitor.listTasks();

// Shared process heartbeat health plus task errors/status
const health = await monitor.getHealth();

// Enqueue only: a worker records the eventual outcome.
const request = await monitor.requestRun('cleanup-expired-sessions');
const status = await monitor.getRunRequest(request.task, request.id);

// Enable/disable tasks
await monitor.disableTask('daily-stats');
await monitor.enableTask('daily-stats');
```

For a single fixed global scope, `ScheduleMonitor.configure(scheduler)` remains available during bootstrap. Never reconfigure that shared singleton per request/tenant; use `forScheduler()` instead. `runTask()` rejects inline execution for persistent schedulers: production controls must call `requestRun()`. Legacy `runTask()` returns a `TaskResult`, whose resolved promise is not proof of success; inspect `success` and `skipped`. Overlap-skipped tasks do not add a successful run to history.

`listTasks()` exposes effective timezone, last/next run, duration, enablement, active lock owner/lease expiry and missed-run policy. A disabled task's next run is `null`. Tasks with no history have an undefined `lastStatus`, not a false failure. Persisted settings take precedence over process-local state; enable/disable writes use an atomic upsert. `getHealth().processes` exposes shared worker owner/state/heartbeat and recent errors. Its `healthy` flag requires a running process with a recent heartbeat; a web monitor's own `uptime` is not worker uptime.

Calendar previews handle distant dates such as February 29 without a one-year minute scan. `TaskInfo.nextRun` is `Date | null`; a preview failure returns `null` with safe `nextRunError`, never a fabricated current timestamp. `TaskInfo.timezone` is the effective explicit timezone; undefined means system time. Handle absent previews and avoid rendering raw task errors or request results to unauthorized clients.

## Best Practices

1. **Keep tasks idempotent** — Tasks should be safe to run multiple times
2. **Set appropriate intervals** — Don't run expensive tasks too frequently
3. **Handle errors gracefully** — Use `onFailure()` to log and handle errors
4. **Enable persistent runtime for production controls** — Share settings, leases, requests and history
5. **Set `lockExpiresAfter()`** — Allow expected latency while leases renew, and observe the execution signal
6. **Scope every worker explicitly** — Match tenant, timezone, connection and task catalog across processes
7. **Test tasks** — Write tests for task logic
8. **Keep tasks focused** — One responsibility per task

## Next Steps

- Learn [Queue Jobs](./11-queue-jobs.md) for background job processing
- Explore [Services](./08-services-actions-repositories.md) for task logic
- Check [Events](./12-additional-features.md) for event-driven tasks

---

**Svelar Scheduler Guide** © 2026
