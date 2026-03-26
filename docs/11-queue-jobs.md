# Queue & Jobs

Learn how to queue background jobs for asynchronous processing.

## What is a Queue?

A queue allows you to defer time-consuming tasks to be processed later. Instead of executing a task synchronously (waiting for it to finish), you push it to a queue and a worker processes it in the background.

Use cases:
- Sending emails
- Processing images
- Generating reports
- Expensive computations
- API calls to external services

## Jobs

Jobs are classes that define work to be done.

### Creating a Job

Create `src/lib/jobs/SendWelcomeEmail.ts`:

```typescript
import { Job } from 'svelar/queue';

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

## Job Methods

### handle()

The main method that executes the job:

```typescript
async handle(): Promise<void> {
  // Do work here
  console.log(`Processing job: ${this.userId}`);
}
```

### failed()

Called when the job fails after all retry attempts:

```typescript
failed(error: Error): void {
  console.error('Job failed:', error.message);
  // Alert admin, log to database, etc.
}
```

### maxAttempts

Maximum number of retry attempts (default: 1):

```typescript
export class ProcessImage extends Job {
  maxAttempts = 5;  // Retry up to 5 times

  async handle(): Promise<void> {
    // Process image
  }
}
```

### retryDelay

Delay in seconds between retry attempts (default: 60):

```typescript
export class ProcessImage extends Job {
  maxAttempts = 3;
  retryDelay = 120;  // Wait 2 minutes between retries

  async handle(): Promise<void> {
    // Process image
  }
}
```

## Dispatching Jobs

### To the Queue

Dispatch a job to the queue:

```typescript
import { Queue } from 'svelar/queue';
import { SendWelcomeEmail } from '../jobs/SendWelcomeEmail.js';

// In a controller
export class AuthController extends Controller {
  async register(event: any) {
    const user = await User.create(data);

    // Dispatch job to queue
    Queue.dispatch(new SendWelcomeEmail(user.id, user.email));

    return this.created({ user });
  }
}
```

### Delayed Dispatch

Delay job execution:

```typescript
// Dispatch in 5 minutes
Queue.dispatch(new SendWelcomeEmail(user.id, user.email), {
  delay: 5 * 60,  // seconds
});

// Dispatch at specific time
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
Queue.dispatch(new SendWelcomeEmail(user.id, user.email), {
  delay: Math.floor((tomorrow.getTime() - Date.now()) / 1000),
});
```

## Queue Configuration

Configure the queue in `src/app.ts`:

```typescript
import { Queue } from 'svelar/queue';

Queue.configure({
  default: 'memory',
  connections: {
    memory: {
      driver: 'memory',
    },
    database: {
      driver: 'database',
      table: 'jobs',
    },
    sync: {
      driver: 'sync',  // Run immediately (no queueing)
    },
  },
});
```

### Queue Drivers

#### Memory Driver (Development)

Jobs are stored in memory and lost on restart:

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

Jobs are persisted to the database:

```typescript
Queue.configure({
  default: 'database',
  connections: {
    database: {
      driver: 'database',
      table: 'jobs',  // Table to store jobs
    },
  },
});
```

Create the jobs table:

```typescript
import { Migration } from 'svelar/database';

export default class CreateJobsTable extends Migration {
  async up() {
    await this.schema.createTable('jobs', (table) => {
      table.increments('id');
      table.string('queue').default('default');
      table.text('payload');
      table.integer('attempts').default(0);
      table.integer('max_attempts').default(3);
      table.integer('delay').default(0);
      table.dateTime('available_at');
      table.dateTime('reserved_at').nullable();
      table.dateTime('failed_at').nullable();
      table.text('exception').nullable();
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('jobs');
  }
}
```

#### Sync Driver

Run jobs immediately synchronously:

```typescript
Queue.configure({
  default: 'sync',
  connections: {
    sync: {
      driver: 'sync',
    },
  },
});

// Jobs execute immediately
Queue.dispatch(new SendWelcomeEmail(user.id, user.email));
// Blocks until complete
```

## Running the Worker

> **Note**: The `queue:work` CLI command is not yet implemented. For now, you can process queued jobs programmatically from a custom script or Node process.

### Programmatic Usage

```typescript
import { Queue } from 'svelar/queue';

const queue = new Queue();

// Process the next job
await queue.processNext();

// Run a worker loop
await queue.work({
  queues: ['default', 'urgent'],
  maxJobs: 100,
  sleepMs: 1000,
});
```

The worker pulls jobs from the queue, executes the `handle()` method, retries failed jobs up to `maxAttempts`, and calls `failed()` if all attempts fail.

## Job Examples

### Send Email Job

```typescript
import { Job } from 'svelar/queue';
import { Mailer } from 'svelar/mail';

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
    // Send alert to admin
  }
}
```

### Process Image Job

```typescript
import { Job } from 'svelar/queue';
import { Storage } from 'svelar/storage';
import sharp from 'sharp';

export class ProcessImageJob extends Job {
  maxAttempts = 2;
  retryDelay = 120;

  constructor(private userId: number, private imagePath: string) {
    super();
  }

  async handle(): Promise<void> {
    const storage = Storage.disk('local');
    const imagePath = this.imagePath;

    // Generate thumbnail
    const imageBuffer = await storage.get(imagePath);
    const thumbnail = await sharp(imageBuffer)
      .resize(200, 200, { fit: 'cover' })
      .toBuffer();

    const thumbnailPath = imagePath.replace(/\.(jpg|png)$/, '_thumb.$1');
    await storage.put(thumbnailPath, thumbnail);

    console.log(`Generated thumbnail: ${thumbnailPath}`);
  }

  failed(error: Error): void {
    console.error(`Failed to process image ${this.imagePath}:`, error);
  }
}
```

### Generate Report Job

```typescript
import { Job } from 'svelar/queue';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';
import { Mailer } from 'svelar/mail';

export class GenerateMonthlyReportJob extends Job {
  maxAttempts = 1;

  constructor(private month: string, private adminEmail: string) {
    super();
  }

  async handle(): Promise<void> {
    const userCount = await User.count();
    const postCount = await Post.count();

    const [year, monthNum] = this.month.split('-');
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);

    const report = `
      <h2>Monthly Report - ${date.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
      <ul>
        <li>Total Users: ${userCount}</li>
        <li>Total Posts: ${postCount}</li>
      </ul>
    `;

    await Mailer.send({
      to: this.adminEmail,
      subject: `Monthly Report - ${this.month}`,
      html: report,
    });
  }

  failed(error: Error): void {
    console.error(`Failed to generate report for ${this.month}:`, error);
  }
}
```

### Webhook Job

```typescript
import { Job } from 'svelar/queue';

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

## From svelar-example

Here's the SendWelcomeEmail job from the example app:

```typescript
// src/lib/jobs/SendWelcomeEmail.ts
import { Job } from 'svelar/queue';

/**
 * Example queued job — sends a welcome email after registration.
 * Demonstrates the job/queue system.
 */
export class SendWelcomeEmail extends Job {
  maxAttempts = 3;
  retryDelay = 30;

  constructor(private userId: number, private email: string) {
    super();
  }

  async handle(): Promise<void> {
    console.log(`[Job] Sending welcome email to ${this.email} (user #${this.userId})`);
    // In production:
    // const { Mailer } = await import('svelar/mail');
    // await Mailer.send({
    //   to: this.email,
    //   subject: 'Welcome to Svelar!',
    //   html: '<h1>Welcome!</h1><p>Thanks for signing up.</p>',
    // });
  }

  failed(error: Error): void {
    console.error(`[Job] Failed to send welcome email to ${this.email}:`, error.message);
  }
}
```

Usage:

```typescript
import { Queue } from 'svelar/queue';
import { SendWelcomeEmail } from '../jobs/SendWelcomeEmail.js';

// In AuthService
const user = await userRepo.create(data);
Queue.dispatch(new SendWelcomeEmail(user.id, user.email));
```

## Best Practices

1. **Use jobs for slow operations** - Email, API calls, file processing
2. **Set reasonable retry limits** - Usually 3-5 retries
3. **Handle failures gracefully** - Implement the `failed()` method
4. **Use database driver in production** - Memory queue is lost on restart
5. **Monitor your queue** - Check failed jobs regularly
6. **Keep jobs simple** - Complex logic belongs in services
7. **Pass only needed data** - Don't pass entire models, pass IDs
8. **Test jobs** - Unit test job logic independently
9. **Log job execution** - Track which jobs ran and when
10. **Clean up old jobs** - Archive or delete completed jobs regularly

## Production Setup

In production, use a process manager to keep the worker running:

```bash
# Using PM2 with a custom worker script
pm2 start scripts/queue-worker.js --name queue-worker --watch

# Restart on reboot
pm2 startup
pm2 save
```

Or use a dedicated queue service like Bull, RabbitMQ, or Redis for scaling:

```typescript
Queue.configure({
  default: 'redis',
  connections: {
    redis: {
      driver: 'redis',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      db: 0,
    },
  },
});
```

## Next Steps

- Learn [Scheduler](./10-scheduler.md) for periodic tasks
- Explore [Services](./08-services-actions-repositories.md) for business logic
- Check [Additional Features](./12-additional-features.md) for mail and notifications

---

**Svelar Queue & Jobs Guide** © 2026
