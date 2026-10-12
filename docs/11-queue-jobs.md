# Queue & Jobs

Learn how to queue background jobs for asynchronous processing.

## What is a Queue?

A queue allows you to defer time-consuming tasks to be processed later. Instead of executing a task synchronously (waiting for it to finish), you push it to a queue and a worker processes it in the background.

Use cases:
- Sending emails
- Generating PDFs
- Processing images
- Generating reports
- Expensive computations
- API calls to external services
- Webhook delivery

## Jobs

Jobs are classes that define work to be done.

### Creating a Job

```bash
npx svelar make:job SendWelcomeEmail
```

This creates `src/lib/jobs/SendWelcomeEmail.ts`:

```typescript
import { Job } from '@beeblock/svelar/queue';

export class SendWelcomeEmail extends Job {
  maxAttempts = 3;      // Retry up to 3 times
  retryDelay = 30;      // Wait 30 seconds between retries

  constructor(private userId: number, private email: string) {
    super();
  }

  async handle(): Promise<void> {
    console.log(`Sending welcome email to ${this.email}`);
    // await Mailer.send({
    //   to: this.email,
    //   subject: 'Welcome!',
    //   html: '<h1>Welcome</h1>',
    // });
  }

  failed(error: Error): void {
    console.error(`Failed to send email to ${this.email}:`, error.message);
    // Log to database, send alert, etc.
  }
}
```

## Job Properties & Methods

### handle()

The main method that executes the job. This is where your logic goes:

```typescript
async handle(): Promise<void> {
  const user = await User.findOrFail(this.userId);
  await Mailer.send({ to: user.email, template: 'welcome' });
}
```

### failed(error)

Called when the job fails permanently (after all retry attempts exhausted):

```typescript
failed(error: Error): void {
  console.error('Job failed:', error.message);
  // Alert admin, log to database, etc.
}
```

### retrying(attempt)

Called before each retry attempt:

```typescript
retrying(attempt: number): void {
  console.log(`Retrying, attempt ${attempt} of ${this.maxAttempts}`);
}
```

### maxAttempts

Maximum number of retry attempts (default: 3):

```typescript
export class ProcessImage extends Job {
  maxAttempts = 5;  // Retry up to 5 times
}
```

### retryDelay

Delay in seconds between retry attempts (default: 60):

```typescript
export class ProcessImage extends Job {
  maxAttempts = 3;
  retryDelay = 120;  // Wait 2 minutes between retries
}
```

### queue

Which named queue this job should be dispatched to (default: `'default'`):

```typescript
export class SendUrgentAlert extends Job {
  queue = 'urgent';  // Will be processed by workers listening on the 'urgent' queue
}
```

### progress(value, message?, metadata?)

Long-running jobs can report progress from inside `handle()`:

```typescript
export class GenerateBoardReport extends Job {
  async handle(): Promise<void> {
    await this.progress(10, 'Loading board');
    await this.progress(60, 'Rendering PDF', { stage: 'pdf' });
    await this.progress(100, 'Done');
  }
}
```

Redis/BullMQ workers persist progress through BullMQ's native progress field, and `JobMonitor.listJobs()` / `JobMonitor.getJob()` expose it as `job.progress`. All drivers also expose `jobId`, `jobClass`, and `queue` through `ApplicationContext` while the job is running.

### serialize() / restore()

Override these for custom serialization when your job carries complex data:

```typescript
export class ProcessOrder extends Job {
  private items: OrderItem[];
  private metadata: Map<string, any>;

  constructor(items: OrderItem[], metadata: Map<string, any>) {
    super();
    this.items = items;
    this.metadata = metadata;
  }

  serialize(): string {
    return JSON.stringify({
      items: this.items,
      metadata: Object.fromEntries(this.metadata),
    });
  }

  restore(data: Record<string, any>): void {
    this.items = data.items;
    this.metadata = new Map(Object.entries(data.metadata));
  }
}
```

## Dispatching Jobs

You can dispatch jobs from **anywhere** in your application — controllers, services, model hooks, middleware, other jobs, CLI commands, or scheduled tasks.

### Basic Dispatch

```typescript
import { Queue } from '@beeblock/svelar/queue';
import { SendWelcomeEmail } from '../jobs/SendWelcomeEmail.js';

// In a controller
export class AuthController extends Controller {
  async register(event: any) {
    const user = await User.create(data);

    // Dispatch to queue — returns immediately
    await Queue.dispatch(new SendWelcomeEmail(user.id, user.email));

    return this.created({ user });
  }
}
```

### Dispatch from a Service

```typescript
import { Queue } from '@beeblock/svelar/queue';
import { GenerateInvoicePdf } from '../jobs/GenerateInvoicePdf.js';

export class OrderService extends Service {
  async completeOrder(orderId: number) {
    const order = await Order.findOrFail(orderId);
    order.status = 'completed';
    await order.save();

    // Dispatch PDF generation in the background
    await Queue.dispatch(new GenerateInvoicePdf(order.id));
  }
}
```

### Dispatch from Model Hooks

```typescript
import { Model } from '@beeblock/svelar/orm';
import { Queue } from '@beeblock/svelar/queue';
import { SendWelcomeEmail } from '../jobs/SendWelcomeEmail.js';

export class User extends Model {
  static boot() {
    this.created(async (user) => {
      // Automatically send welcome email when a user is created
      await Queue.dispatch(new SendWelcomeEmail(user.id, user.email));
    });
  }
}
```

### Dispatch from Other Jobs

```typescript
export class ProcessOrder extends Job {
  async handle(): Promise<void> {
    const order = await Order.findOrFail(this.orderId);

    await this.chargePayment(order);

    // Dispatch follow-up jobs
    await Queue.dispatch(new SendReceipt(order.id, order.email));
    await Queue.dispatch(new UpdateInventory(order.id));
    await Queue.dispatch(new NotifyWarehouse(order.id));
  }
}
```

### Dispatch from Scheduled Tasks

```typescript
import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Queue } from '@beeblock/svelar/queue';
import { GenerateMonthlyReport } from '../jobs/GenerateMonthlyReport.js';

export class MonthlyReportTask extends ScheduledTask {
  schedule() {
    return this.cron('0 0 1 * *'); // First day of each month
  }

  async handle(): Promise<void> {
    const month = new Date().toISOString().slice(0, 7);
    await Queue.dispatch(new GenerateMonthlyReport(month));
  }
}
```

### Delayed Dispatch

Delay job execution by a number of seconds:

```typescript
// Dispatch in 5 minutes
await Queue.dispatch(new SendWelcomeEmail(user.id, user.email), {
  delay: 5 * 60,
});

// Dispatch at a specific time
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
await Queue.dispatch(new SendWelcomeEmail(user.id, user.email), {
  delay: Math.floor((tomorrow.getTime() - Date.now()) / 1000),
});
```

### Dispatch Options

```typescript
await Queue.dispatch(new SendWelcomeEmail(user.id, user.email), {
  queue: 'emails',      // Send to a specific named queue
  delay: 60,            // Wait 60 seconds before processing
  maxAttempts: 5,       // Override job's maxAttempts
  jobId: `welcome:${user.id}`, // Stable idempotency key
  deduplicate: true,    // Skip enqueueing when jobId is already waiting
  priority: 1,          // Lower numbers run first in BullMQ and memory queues
  metadata: { userId: user.id, teamId }, // Dashboard/search context
});
```

`Queue.dispatch()` returns the queued job id. Use `jobId` when an external event or webhook needs idempotency. Redis/BullMQ also receives `priority`; the memory driver uses priority for local tests.

### Queue Registry

Register queue names and operational defaults during app boot so dashboards and workers can discover them without importing BullMQ directly:

```typescript
import { Queue } from '@beeblock/svelar/queue';

Queue.registerQueue({
  name: 'emails',
  label: 'Email delivery',
  concurrency: 5,
  metadata: { flow: 'notifications' },
});

Queue.registerQueues([
  { name: 'pdf', label: 'PDF generation', concurrency: 2 },
  { name: 'webhooks', label: 'Webhook processing', concurrency: 10 },
]);
```

`Queue.queues()` returns the registered queue definitions and `Queue.registeredJobs()` returns the registered job class names. `JobMonitor.getHealth()` includes both lists for admin dashboards.

### Queue Monitoring

Import the monitor from its dedicated server entry and configure it with the same default connection and connections object used by `Queue.configure()`:

```typescript
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';

JobMonitor.configure({
  ...queueConfig,
  driver: queueConfig.connections[queueConfig.default].driver,
});

const jobs = await JobMonitor.listJobs({
  queue: 'emails',
  status: 'waiting',
  jobClass: 'SendWelcomeEmail',
  limit: 25,
  offset: 0,
});

const job = await JobMonitor.getJob(jobId, 'emails');
const retried = await JobMonitor.retryJob(jobId, 'emails');
const deleted = await JobMonitor.deleteJob(jobId, 'emails');
const health = await JobMonitor.getHealth();
const runtime = health.runtime.emails;
```

Here `queueConfig` is the configuration object passed to `Queue.configure()`. All monitor operations observe that configured default connection, not a connection selected by the queue registry.

The optional second argument of `getJob(id, queueName?)`, `retryJob(id, queueName?)`, and `deleteJob(id, queueName?)` restricts the operation to that queue, including persisted failed records. Always pass the listed job's `queue` in admin actions: BullMQ numeric IDs are unique only within a queue. A missing or wrong-queue ID returns `null` for reads and `false` for mutations; there is no fallback to another queue. Without an explicit queue, Redis uses the connection's configured queue (or `default`); other drivers can find persisted IDs across queues. If a live job and a persisted failure share an ID within the requested scope, operations fail closed instead of choosing one. Retry only accepts failed jobs, never active reservations or pending jobs.

`listJobs()` orders by creation timestamp descending, then queue, ID, and status ascending for stable ties. Class and queue filters apply before pagination. Without a status filter, live jobs and persisted failures are merged into one sequence before applying the offset and limit. Stability assumes the underlying jobs have not changed between requests. Pagination requires non-negative safe integers; `limit: 0` returns an empty page. Database class filtering reads matching queue/status rows to inspect JSON payloads; these are not constant-cost indexed pages.

Exact Redis creation-order pagination requires inspecting the relevant live states because BullMQ's native ranges use queue, priority, completion, or delay order instead of global creation order. `JobMonitor.configure()` accepts a positive safe integer `redisScanLimit`, defaulting to 1,000 live jobs per listing. The monitor checks public state counts before fetching jobs, then uses finite single-state ranges with a cumulative budget and at most one overflow job as a lookahead. Listings that exceed the budget throw `RedisJobScanLimitError` from `@beeblock/svelar/queue/JobMonitor`, with `queue`, `scanLimit`, and `observedJobs` fields. No partial or guessed page is returned. This applies to both combined and status-specific live listings, including class-filtered listings; the scan budget counts jobs before class filtering. Narrowing `status` may reduce the required scan. Persisted `status: 'failed'` listings do not scan Redis and are unaffected. Increase the budget explicitly through application configuration only when that bounded request cost is acceptable.

Supported statuses are `waiting`, `active`, `completed`, `failed`, and `delayed`. Redis uses BullMQ's current state rather than inferring it from old timestamps; prioritized and paused pending jobs appear as `waiting`. Failed listings/counts come from `svelar_failed_jobs`, not an additional copy of BullMQ's retained failures. Database completed jobs are deleted, so `status: 'completed'` returns no jobs. Memory and sync expose persisted failures but not live job lists or retained completion history.

`getHealth()` returns counts and `runtime` observations for the configured default queue and registered queues whose connection is omitted or matches the monitor's default connection. Definitions on other connections remain in `registry`, without observed counts or runtime entries. Missing observations must be treated as unknown.

Each observed queue's `runtime` has:

- `workers: number | null`: fresh registered Svelar worker heartbeats, including paused or draining processes, only with complete metadata and explicit exclusive coverage. Otherwise unknown; Redis connection counts and absent keys are not proof of worker liveness or zero workers.
- `paused: boolean | null`: the BullMQ queue's global pause state, not individual workers' local pause state.
- `globalConcurrency: number | null`: the configured BullMQ global concurrency cap, or `null` when unset or unavailable.
- `effectiveConcurrency: number | null`: an observed intake concurrency ceiling, not free job slots or throughput. With explicit exclusive coverage and complete metadata, sum fresh running, unpaused, non-draining workers' actual concurrency and apply the observed BullMQ global cap. Queue pause and global-cap state must be observable; a known globally paused queue has zero intake capacity regardless of coverage. Partial, stale-only without exclusive coverage, unavailable, invalid, or truncated observations never manufacture a healthy total. Registry concurrency is only a configuration hint.
- `oldestWaitingJob: number | null`: absolute oldest ready waiting job's creation timestamp in milliseconds. Database observations exclude reserved and future-available jobs. Redis returns `null`: a bounded queue-head read cannot establish absolute creation age across retries, LIFO jobs, or priorities.
- `lag: number | null`: the absolute oldest waiting job's age in milliseconds, zero for an observed empty waiting set, or unknown when not observable. Redis returns `null` for nonempty waiting sets, including prioritized-only backlogs.
- `nextWaitingJob: number | null`: bounded ordinary waiting-list head's creation timestamp in milliseconds, including a paused waiting list, obtained through BullMQ's public `getWaiting(0, 0)`. It is not the absolute oldest job, the highest-priority job, or a prediction of the next job a worker will process. Database reports the first ready, unreserved row in creation order.
- `nextWaitingLag: number | null`: that observed head's age in milliseconds; `null` if no valid, unambiguous ordinary waiting head is observable.
- `workerTelemetry: WorkerTelemetrySnapshot | null`: redacted distributed Redis heartbeat snapshot, or `null` for non-BullMQ drivers. `records` contain opaque worker ID, queue, actual concurrency, lock duration, stalled interval, running/paused/draining state, and Redis-server timestamps (`startedAt`, `lastSeenAt`, `staleAt`, `expiresAt`) plus `live`/`stale` status. `observed` reports only the sampled records' live, active-intake, paused, draining, stale counts and local concurrency sum. These observations are not automatically queue-wide totals; counts may overlap for paused/draining states.

Memory, sync, and database cannot report worker count, pause state, or effective concurrency, so those values are `null`. Database can report oldest waiting age; memory and sync cannot report waiting age or head observations. The top-level `oldestWaitingJob` is the oldest known absolute timestamp across queues, not a sampled Redis head. Redis health never enumerates a backlog: it reads only ordinary waiting index zero (with a finite generic-getter fallback when needed), regardless of backlog size, and leaves absolute oldest metrics unknown for nonempty sets. `throughput` and `failureRate` summarize outcomes recorded in the monitor's current process during the last hour, not cluster-wide BullMQ metrics. Queue getter/database failures surface as errors. Heartbeat read failures return a redacted unavailable snapshot, not a healthy fallback.

#### Distributed Worker Heartbeats

Svelar Redis workers publish queue-scoped heartbeat metadata through their BullMQ Redis client, so a separate web process can observe actual worker settings without importing live Worker objects or issuing `CLIENT LIST`, `KEYS`, or `SCAN`. The internal v1 keys are built through BullMQ's `toKey()` namespace under `svelar:workers:v1`, with an opaque random UUID per worker, a retained registration index, and an expiring coverage marker. Different queues or Redis prefixes do not share worker records. Preserve BullMQ's cluster-compatible prefix/hash-tag configuration when using Redis Cluster.

Set `connections.<redis>.workerHeartbeat` to configure `intervalMs` (default 5,000, allowed 1,000..60,000), `staleAfterMs` (default 15,000, at least two intervals, maximum 300,000), and `retentionMs` (default 60,000, at least stale age plus one interval, maximum 3,600,000). `false` disables publication; it does not prove that there are zero workers. Server time determines freshness, avoiding worker/web clock skew. Freshness is an observation window, not an instantaneous health guarantee. Stale records remain inspectable until retention expires and never contribute intake capacity. Workers using finite/manual processing may report `running: false` even while finishing a job; worker/job activity and intake capacity are different observations.

`JobMonitor.configure()` accepts `workerTelemetryLimit` (default 100, allowed 1..1,000). Each read requests at most that many registration members plus one overflow sentinel, then at most that many records with `GETRANGE` capped at 2,048 bytes plus one size sentinel. Reads never enumerate an unbounded worker registry or Redis client list. `complete` means the bounded registry read was untruncated and valid, not that every consumer in the queue was discovered. Overflow or malformed records leave queue-wide totals unknown; `observed` is a lower-bound sample when incomplete. Redis metadata ACL/read failures yield `source: 'unavailable'` and no invented zero capacity.

The default `workerTelemetryCoverage: 'instrumented'` reports only instrumented records and leaves queue-wide `workers`/`effectiveConcurrency` unknown, even if the recent registry is empty. Custom/external BullMQ workers, telemetry-disabled workers, older consumers, or inaccessible metadata may still be processing jobs. Set `workerTelemetryCoverage: 'exclusive'` only as an explicit operational assertion that every consumer in this dedicated queue/prefix uses Svelar heartbeats. Do not select exclusive coverage in a mixed pool. With that assertion, complete fresh/stale metadata can establish totals; a recent marker and a complete empty registry can establish zero registered consumers. An absent or expired marker still remains unknown. A monitor connection configured with `workerHeartbeat: false` cannot upgrade observations to exclusive totals.

Closing a worker publishes `draining: true` and continues refreshing it while BullMQ finishes native close. Draining workers stay visible but have no new-job intake capacity; paused workers likewise remain registered without contributing intake capacity. After native close, Svelar clears timers, drains pending heartbeat writes, and removes only that worker's record and registration. Driver shutdown attempts every tracked worker and queue close, waits for all attempts to settle, and throws an `AggregateError` if any fail; one failure does not skip other cleanup. A crash or failed cleanup is bounded by stale/retention expiry. Startup or refresh publication failures reject/stop the Svelar worker rather than advertising a healthy fallback; supervisors must handle the failure. Scoped queue fakes do not create workers or heartbeat keys, and real dispatch interception/cleanup remains unchanged.

Heartbeat JSON uses a strict allowlist: no job payloads, user/team identifiers, connection URLs or credentials, hostnames, PIDs, worker names, arbitrary metadata, or stack traces. The reader validates version, queue/ID scope, numbers, booleans, and timestamp ordering, strips extra JSON fields, and rejects oversized records. Treat the Redis namespace as trusted infrastructure, not an authentication boundary: application endpoints must authorize access, and Redis ACLs must restrict metadata writers/readers to the application's queue prefix. Writers need the heartbeat Lua script's `TIME`, `SET`, `ZADD`, `PTTL`, `PEXPIRE`, bounded `ZRANGEBYSCORE`, `ZREM`, and `DEL` commands; readers need `TIME`, bounded `GETRANGE` and `ZRANGEBYSCORE`. Publication requires `EVAL` permission. Reusing a prefix across untrusted tenants can spoof observations and is unsupported.


## Synchronous Dispatch

Use `dispatchSync()` to run a job immediately in the current process, **bypassing the configured queue driver entirely**. The method returns a promise that resolves when the job completes.

```typescript
// Runs immediately, blocks until done
await Queue.dispatchSync(new GenerateInvoicePdf(order.id));

// Useful when you need the result before responding
export class OrderController extends Controller {
  async invoice(event: any) {
    const order = await Order.findOrFail(event.params.id);

    // Must complete before we send the response
    await Queue.dispatchSync(new GenerateInvoicePdf(order.id));

    return this.ok({ message: 'Invoice generated' });
  }
}
```

This is also useful for testing — you can run jobs synchronously without needing a worker:

```typescript
// In tests
await Queue.dispatchSync(new SendWelcomeEmail(user.id, user.email));
// Job has already completed at this point
```

The sync driver still respects `maxAttempts` — if the job throws, it retries up to `maxAttempts` times before calling `failed()`.

## Job Chaining

Chain multiple jobs to run in sequence. If any job in the chain fails (after exhausting its own retries), the chain stops and remaining jobs are skipped:

```typescript
await Queue.chain([
  new ProcessPayment(orderId),
  new SendReceipt(orderId),
  new UpdateInventory(orderId),
  new NotifyWarehouse(orderId),
]);
```

Each job runs with its own `maxAttempts` and `retryDelay`. The chain only moves to the next job after the current one succeeds.

```typescript
// Chain with dispatch options
await Queue.chain([
  new ProcessPayment(orderId),
  new SendReceipt(orderId),
], { queue: 'orders' });
```

## Queue Configuration

Configure the queue in `src/app.ts`:

```typescript
import { Queue } from '@beeblock/svelar/queue';

Queue.configure({
  default: 'memory',
  connections: {
    memory: {
      driver: 'memory',
    },
    database: {
      driver: 'database',
      table: 'svelar_jobs',
    },
    sync: {
      driver: 'sync',
    },
  },
});
```

### Registering Jobs

When using the **database driver**, you must register your job classes so the worker can reconstruct them from their serialized payloads:

```typescript
import { Queue } from '@beeblock/svelar/queue';
import { SendWelcomeEmail } from './lib/jobs/SendWelcomeEmail.js';
import { ProcessImage } from './lib/jobs/ProcessImage.js';
import { GenerateReport } from './lib/jobs/GenerateReport.js';

// Register all job classes
Queue.registerAll([
  SendWelcomeEmail,
  ProcessImage,
  GenerateReport,
]);

// Or register one at a time
Queue.register(SendWelcomeEmail);
```

This step is **not needed** for the `sync` or `memory` drivers (they keep the original job instance in-process), but it's recommended to always register your jobs so you can switch drivers without code changes.

### Queue Drivers

#### Sync Driver

Jobs run immediately when dispatched — no background processing. This is the **default** driver and is useful for development and testing:

```typescript
Queue.configure({
  default: 'sync',
  connections: {
    sync: {
      driver: 'sync',
    },
  },
});

// Jobs execute immediately when dispatched
await Queue.dispatch(new SendWelcomeEmail(user.id, user.email));
// By this line, the email has already been sent
```

> **Note**: `dispatchSync()` always runs the job synchronously regardless of the configured driver. The sync *driver* makes `dispatch()` also run synchronously.

#### Memory Driver (Development)

Jobs are stored in-process and processed by a worker. Jobs are lost if the process restarts:

```typescript
Queue.configure({
  default: 'memory',
  connections: {
    memory: {
      driver: 'memory',
    },
  },
});
```

#### Database Driver (Production)

Jobs are persisted to a database table and survive process restarts. This is the recommended driver for production:

```typescript
Queue.configure({
  default: 'database',
  connections: {
    database: {
      driver: 'database',
      table: 'svelar_jobs',  // Default table name
    },
  },
});
```

The `svelar_jobs` table is managed by Svelar core migrations.

> **Important**: Remember to call `Queue.registerAll([...])` with all your job classes when using the database driver. Without this, the worker can't reconstruct jobs from the database.

Database queue payloads must be valid JSON generated by Svelar. If a queued row has a malformed payload, workers and queue monitors fail with the job ID and table name instead of reserving or running a corrupted job.

#### Redis Driver (Production — BullMQ)

The Redis driver uses [BullMQ](https://docs.bullmq.io/) for production-grade queues with priorities, rate limiting, automatic retries, delays, and dashboard support. This is the recommended driver for production when you need high throughput and reliability.

```bash
npm install bullmq
```

```typescript
Queue.configure({
  default: 'redis',
  connections: {
    redis: {
      driver: 'redis',
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD ?? '',
      db: 0,
      prefix: 'svelar',
      defaultJobOptions: {
        removeOnComplete: 100,  // Keep last 100 completed jobs
        removeOnFail: 500,      // Keep last 500 failed jobs
      },
    },
  },
});
```

You can also connect using a Redis URL:

```typescript
redis: {
  driver: 'redis',
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  prefix: 'svelar',
}
```

The Redis driver differs from other drivers in one key way: when you call `Queue.work()`, it starts a native BullMQ Worker instead of polling. BullMQ Workers are event-driven and handle concurrency, retries, and backoff natively — no sleep interval needed.

```typescript
// Start a worker with concurrency
await Queue.work({
  queue: 'default',
  concurrency: 5,  // Process 5 jobs in parallel
});
```

The worker blocks until `Queue.stop()` is called. In Docker, the generated `worker` service manages the lifecycle automatically (see `npx svelar make:docker`).

> **Docker Compose**: Redis is included by default when you run `npx svelar make:docker`. The app service gets `QUEUE_DRIVER=redis` and `REDIS_HOST=redis` automatically.

> **Important**: Like the database driver, you must register job classes with `Queue.registerAll([...])` so the worker can reconstruct jobs from Redis payloads.

If a Redis/BullMQ job exhausts its attempts but its class is not registered, Svelar persists the raw job class, payload, queue, and resolution error to `svelar_failed_jobs` so it remains visible through `Queue.failed()` and `queue:failed`.

If Redis failed-job persistence cannot write to `svelar_failed_jobs`, `Queue.work()` rejects and closes the BullMQ Worker. Worker supervisors should treat that as an infrastructure failure and restart after the database issue is fixed.

## Running the Worker

Process queued jobs with the worker:

```bash
npx svelar queue:work
```

The worker pulls jobs from the queue, executes `handle()`, retries on failure up to `maxAttempts`, deletes completed jobs, and calls `failed()` when all retries are exhausted.

`queue:work` boots `src/app.ts` before processing jobs. Configure `Queue.configure()` and `Queue.registerAll([...])` in `src/app.ts` so the worker uses the same queue driver and job registry as the web process.

### Worker Options

```bash
# Process a specific queue
npx svelar queue:work --queue=urgent

# Stop after processing 100 jobs
npx svelar queue:work --max-jobs=100

# Stop after 1 hour
npx svelar queue:work --max-time=3600

# Adjust polling interval (ms)
npx svelar queue:work --sleep=2000

# Process Redis/BullMQ jobs concurrently
npx svelar queue:work --concurrency=5

# Tune BullMQ lock and stalled-job detection windows (ms)
npx svelar queue:work --lock-duration=45000 --stalled-interval=30000

# Process a single job and exit
npx svelar queue:work --once
```

Without `--once` or `--max-jobs`, `queue:work` starts one long-lived worker
process. Redis queues use one native BullMQ Worker instead of an application
polling loop, so concurrency, locks, retries, backoff, and stalled-job detection
stay inside BullMQ. `--max-jobs` and `--once` are intended for tests, one-off
maintenance commands, and finite certification checks.

### Programmatic Usage

You can also run the worker from code:

```typescript
import { Queue } from '@beeblock/svelar/queue';

// Process up to 100 jobs from the 'emails' queue
const processed = await Queue.work({
  queue: 'emails',
  maxJobs: 100,
});

console.log(`Processed ${processed} jobs`);
```

### Queue Size and Cleanup

```typescript
// Check how many jobs are pending
const pending = await Queue.size('default');
console.log(`${pending} jobs waiting`);

// Clear all jobs from a queue
await Queue.clear('default');
```

## Failed Jobs

When a job exceeds its `maxAttempts`, Svelar persists it to a `svelar_failed_jobs` database table so you can inspect, retry, or discard it later. This works with all queue drivers (sync, memory, database, redis).

The `svelar_failed_jobs` table is managed by Svelar core migrations. Run `npx svelar migrate` before processing queues. If the table or database connection is unavailable, exhausted jobs fail loudly instead of being logged and lost.

### CLI Commands

```bash
# List all failed jobs
npx svelar queue:failed

# Retry a specific failed job by ID
npx svelar queue:retry abc123

# Retry all failed jobs
npx svelar queue:retry --all

# Delete all failed job records
npx svelar queue:flush
```

### Programmatic API

You can also manage failed jobs from your application code:

```typescript
import { Queue } from '@beeblock/svelar/queue';

// Get all failed jobs
const failures = await Queue.failed();
// => FailedJobRecord[] { id, queue, jobClass, payload, exception, failedAt }

// Retry a specific job (removes from failed_jobs, re-dispatches to queue)
const retried = await Queue.retry('abc123');

// Retry all failed jobs
const count = await Queue.retryAll();

// Delete a single failed job record
await Queue.forgetFailed('abc123');

// Delete all failed job records
await Queue.flushFailed();
```

### How It Works

When a job fails after exhausting all retry attempts:

1. The `failed()` method on the job class is called (if defined)
2. The job payload, exception, queue name, and timestamp are saved to `svelar_failed_jobs`
3. The record stays there until you retry or flush it

When you retry a failed job, Svelar deserializes the original JSON payload, creates a new job instance, dispatches it back onto the same queue, and deletes the failed record. If the payload is malformed, the retry fails and the failed record stays in `svelar_failed_jobs`.

`Queue.retryAll()` attempts every failed record. If any record cannot be deserialized or dispatched, it throws a `QueueRetryAllError` with `retried` and `failures` details, and leaves the failed record in `svelar_failed_jobs` for inspection.

## Job Examples

### Send Email Job

```typescript
import { Job } from '@beeblock/svelar/queue';
import { Mailer } from '@beeblock/svelar/mail';

export class SendWelcomeEmail extends Job {
  maxAttempts = 3;
  retryDelay = 60;

  constructor(private userId: number, private email: string) {
    super();
  }

  async handle(): Promise<void> {
    await Mailer.send({
      to: this.email,
      subject: 'Welcome to Svelar!',
      html: `<h1>Welcome!</h1><p>Thanks for signing up.</p>`,
    });
  }

  failed(error: Error): void {
    console.error(`Failed to send welcome email to ${this.email}:`, error);
  }
}
```

### Generate PDF Job

```typescript
import { Job } from '@beeblock/svelar/queue';

export class GenerateInvoicePdf extends Job {
  maxAttempts = 2;
  retryDelay = 30;

  constructor(private orderId: number) {
    super();
  }

  async handle(): Promise<void> {
    const order = await Order.with('items', 'user').findOrFail(this.orderId);

    // Generate PDF using your preferred library
    const pdf = await generatePdf({
      template: 'invoice',
      data: { order, items: order.items, user: order.user },
    });

    await Storage.disk('local').put(`invoices/${order.id}.pdf`, pdf);
  }

  failed(error: Error): void {
    console.error(`Failed to generate invoice for order #${this.orderId}:`, error);
  }
}
```

### Process Image Job

```typescript
import { Job } from '@beeblock/svelar/queue';
import { Storage } from '@beeblock/svelar/storage';
import sharp from 'sharp';

export class ProcessImageJob extends Job {
  maxAttempts = 2;
  retryDelay = 120;

  constructor(private userId: number, private imagePath: string) {
    super();
  }

  async handle(): Promise<void> {
    const storage = Storage.disk('local');
    const imageBuffer = await storage.get(this.imagePath);

    const thumbnail = await sharp(imageBuffer)
      .resize(200, 200, { fit: 'cover' })
      .toBuffer();

    const thumbnailPath = this.imagePath.replace(/\.(jpg|png)$/, '_thumb.$1');
    await storage.put(thumbnailPath, thumbnail);
  }

  failed(error: Error): void {
    console.error(`Failed to process image ${this.imagePath}:`, error);
  }
}
```

### Webhook Delivery Job

```typescript
import { Job } from '@beeblock/svelar/queue';

export class TriggerWebhookJob extends Job {
  maxAttempts = 5;
  retryDelay = 30;

  constructor(
    private webhookUrl: string,
    private event: string,
    private payload: Record<string, any>
  ) {
    super();
  }

  async handle(): Promise<void> {
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: this.event,
        data: this.payload,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`);
    }
  }

  failed(error: Error): void {
    console.error(`Failed to trigger webhook ${this.webhookUrl}:`, error);
  }
}
```

## Complete Setup Example

Here's a full production setup in `src/app.ts`:

```typescript
import { Queue } from '@beeblock/svelar/queue';
import { SendWelcomeEmail } from './lib/jobs/SendWelcomeEmail.js';
import { ProcessImageJob } from './lib/jobs/ProcessImageJob.js';
import { GenerateInvoicePdf } from './lib/jobs/GenerateInvoicePdf.js';
import { TriggerWebhookJob } from './lib/jobs/TriggerWebhookJob.js';

// Configure the queue driver
Queue.configure({
  default: process.env.QUEUE_DRIVER ?? 'sync',
  connections: {
    sync: { driver: 'sync' },
    memory: { driver: 'memory' },
    database: {
      driver: 'database',
      table: 'svelar_jobs',
    },
    redis: {
      driver: 'redis',
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD ?? '',
      prefix: 'svelar',
    },
  },
});

// Register all jobs (required for database and Redis drivers)
Queue.registerAll([
  SendWelcomeEmail,
  ProcessImageJob,
  GenerateInvoicePdf,
  TriggerWebhookJob,
]);
```

## Best Practices

1. **Use jobs for slow operations** - Email, PDF generation, API calls, file processing
2. **Set reasonable retry limits** - Usually 3-5 retries for network operations
3. **Handle failures gracefully** - Always implement `failed()` to log or alert
4. **Use redis or database driver in production** - Memory queue is lost on restart. Redis (BullMQ) is recommended for high-throughput apps
5. **Register all job classes** - Even if not using database driver yet (makes switching easy)
6. **Monitor your queue** - Use `npx svelar queue:failed` to inspect failures and `queue:retry` to re-process them
7. **Keep jobs focused** - One job, one responsibility. Complex logic belongs in services
8. **Pass IDs, not objects** - Don't serialize entire models, pass IDs and fetch fresh data in `handle()`
9. **Use `dispatchSync()` in tests** - No worker needed, jobs complete immediately
10. **Chain related jobs** - Use `Queue.chain()` instead of dispatching from inside `handle()`

## Production Setup

In production, run workers as long-lived services. The generated Docker topology includes a `worker` service for the `default` queue:

```bash
docker compose up -d worker
```

For local development, keep Redis in Docker and run the worker from source:

```bash
npm run dev:worker
```

For additional queues, add another Compose service or script that passes `--queue=<name>`.

## Next Steps

- Learn [Scheduler](./10-scheduler.md) for periodic tasks
- Explore [Services](./08-services-actions-repositories.md) for business logic
- Check [Additional Features](./12-additional-features.md) for mail and notifications

---

**Svelar Queue & Jobs Guide** © 2026
