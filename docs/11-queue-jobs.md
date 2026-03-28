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
});
```

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

Create the jobs table migration:

```typescript
import { Migration } from '@beeblock/svelar/database';

export default class CreateSvelarJobsTable extends Migration {
  async up() {
    await this.schema.createTable('svelar_jobs', (table) => {
      table.string('id', 36).primary();
      table.string('queue').default('default');
      table.text('payload');
      table.integer('attempts').default(0);
      table.integer('max_attempts').default(3);
      table.integer('available_at');
      table.integer('reserved_at').nullable();
      table.integer('created_at');
    });

    await this.schema.createTable('svelar_jobs', (t) => {});
  }

  async down() {
    await this.schema.dropTable('svelar_jobs');
  }
}
```

> **Important**: Remember to call `Queue.registerAll([...])` with all your job classes when using the database driver. Without this, the worker can't reconstruct jobs from the database.

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

The worker blocks until `Queue.stop()` is called. In Docker, PM2 manages the lifecycle automatically (see `npx svelar make:docker`).

> **Docker Compose**: Redis is included by default when you run `npx svelar make:docker`. The app service gets `QUEUE_DRIVER=redis` and `REDIS_HOST=redis` automatically.

> **Important**: Like the database driver, you must register job classes with `Queue.registerAll([...])` so the worker can reconstruct jobs from Redis payloads.

## Running the Worker

Process queued jobs with the worker:

```bash
npx svelar queue:work
```

The worker pulls jobs from the queue, executes `handle()`, retries on failure up to `maxAttempts`, deletes completed jobs, and calls `failed()` when all retries are exhausted.

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

# Process a single job and exit
npx svelar queue:work --once
```

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

// Register all jobs (required for database driver)
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
6. **Monitor your queue** - Check failed jobs and queue size regularly
7. **Keep jobs focused** - One job, one responsibility. Complex logic belongs in services
8. **Pass IDs, not objects** - Don't serialize entire models, pass IDs and fetch fresh data in `handle()`
9. **Use `dispatchSync()` in tests** - No worker needed, jobs complete immediately
10. **Chain related jobs** - Use `Queue.chain()` instead of dispatching from inside `handle()`

## Production Setup

In production, use a process manager to keep the worker running. [PM2](https://pm2.keymetrics.io/) is a Node.js process manager that keeps your services alive, auto-restarts on crash, and handles log rotation:

```bash
# Install PM2 globally
npm install -g pm2

# Start the queue worker as a managed background process
pm2 start "npx svelar queue:work" --name queue-worker

# Run multiple workers for higher throughput
pm2 start "npx svelar queue:work --queue=urgent" --name queue-urgent -i 2

# Persist across server reboots
pm2 startup
pm2 save
```

## Next Steps

- Learn [Scheduler](./10-scheduler.md) for periodic tasks
- Explore [Services](./08-services-actions-repositories.md) for business logic
- Check [Additional Features](./12-additional-features.md) for mail and notifications

---

**Svelar Queue & Jobs Guide** © 2026
