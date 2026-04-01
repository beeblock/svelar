# Additional Features

Quick reference for Svelar's supporting modules. Each section covers configuration and common usage patterns.

For in-depth guides, see the dedicated pages: [Sessions](./22-sessions.md), [Events](./23-events.md), [Mail](./24-mail.md), [Broadcasting](./25-broadcasting.md), [Storage](./26-storage.md), [PDF](./27-pdf.md), [Excel](./28-excel.md), [Feature Flags](./21-feature-flags.md).

## Hashing

Securely hash passwords and other sensitive data.

### Configuration

```typescript
import { Hash } from '@beeblock/svelar/hashing';

Hash.configure({
  driver: 'scrypt',  // 'bcrypt', 'argon2'
});
```

### Hashing Passwords

```typescript
import { Hash } from '@beeblock/svelar/hashing';

// Hash password
const hashedPassword = await Hash.make('user-password');

// Verify password
const isValid = await Hash.verify('user-password', hashedPassword);

if (isValid) {
  console.log('Password correct');
} else {
  console.log('Password incorrect');
}
```

### Drivers

- **scrypt** (default) - Zero dependencies, fast, secure
- **bcrypt** - Battle-tested, slower
- **argon2** - Modern, memory-hard

## Caching

Cache frequently accessed data to improve performance.

### Configuration

```typescript
import { Cache } from '@beeblock/svelar/cache';

Cache.configure({
  default: 'memory',
  stores: {
    memory: {
      driver: 'memory',
    },
    file: {
      driver: 'file',
      path: './storage/cache',
    },
    redis: {
      driver: 'redis',
      host: 'localhost',
      port: 6379,
    },
  },
});
```

### Using Cache

```typescript
import { Cache } from '@beeblock/svelar/cache';

// Set cache
await Cache.put('user:1:posts', posts, 3600);  // 1 hour

// Get cache
const cachedPosts = await Cache.get('user:1:posts');

// Get or set
const posts = await Cache.remember('user:1:posts', 3600, async () => {
  return await Post.where('user_id', 1).get();
});

// Delete cache
await Cache.forget('user:1:posts');

// Clear all cache
await Cache.flush();

// Check existence
const exists = await Cache.has('user:1:posts');
```

## Logging

Log messages for debugging and monitoring.

### Configuration

```typescript
import { Log } from '@beeblock/svelar/logging';

Log.configure({
  default: 'stack',
  channels: {
    console: {
      driver: 'console',
      level: 'debug',
    },
    file: {
      driver: 'file',
      path: './storage/logs/app.log',
      level: 'info',
    },
  },
});
```

### Using Logs

```typescript
import { Log } from '@beeblock/svelar/logging';

// Log levels
Log.debug('Debug message');
Log.info('Information message');
Log.warn('Warning message');
Log.error('Error message');

// With context
Log.info('User registered', { user_id: 1, email: 'john@example.com' });

// Multiple channels
Log.channel('file').info('Logged to file only');
Log.channel('console').warn('Logged to console only');
```

## Notifications

Send notifications via multiple channels (email, SMS, database).

### Configuration

```typescript
import { Notifier } from '@beeblock/svelar/notifications';

Notifier.configure({
  channels: {
    email: {
      driver: 'mail',
    },
    database: {
      driver: 'database',
      table: 'notifications',
    },
    sms: {
      driver: 'vonage',  // or 'twilio'
      api_key: process.env.VONAGE_API_KEY,
      api_secret: process.env.VONAGE_API_SECRET,
    },
  },
});
```

### Notification Classes

```typescript
import { Notification } from '@beeblock/svelar/notifications';

export class OrderShippedNotification extends Notification {
  constructor(private order: Order) {
    super();
  }

  channels() {
    return ['email', 'database'];
  }

  toEmail() {
    return {
      to: this.order.user.email,
      subject: 'Your order has shipped!',
      html: `<p>Order #${this.order.id} is on its way.</p>`,
    };
  }

  toDatabase() {
    return {
      title: 'Order Shipped',
      message: `Your order #${this.order.id} has shipped`,
      data: { order_id: this.order.id },
    };
  }
}

// Send
await Notifier.notify(user, new OrderShippedNotification(order));
```

## Configuration Management

Svelar uses a directory-based configuration system like Laravel. Each concern gets its own file in a `config/` directory at your project root.

### Generating Config Files

```bash
npx svelar make:config app
npx svelar make:config database
npx svelar make:config auth
npx svelar make:config mail
npx svelar make:config cache
npx svelar make:config queue
npx svelar make:config storage
npx svelar make:config logging
```

### Config Files

Config files live in `config/` and export a default object. Use the `env()` helper to read environment variables with type casting and defaults:

```typescript
// config/app.ts
import { env } from '@beeblock/svelar/config';

export default {
  name: env('APP_NAME', 'Svelar'),
  env: env('APP_ENV', 'development'),
  debug: env<boolean>('APP_DEBUG', false),
  url: env('APP_URL', 'http://localhost:5173'),
  key: env('APP_KEY', ''),
  timezone: 'UTC',
  locale: 'en',
};
```

### Loading Configuration

```typescript
import { config } from '@beeblock/svelar/config';

await config.loadFromDirectory('./config');
```

### Using Configuration

```typescript
import { config } from '@beeblock/svelar/config';

const appName = config.get('app.name');
const dbDriver = config.get('database.default');
const debug = config.get('app.debug', false);

config.set('app.maintenance', true);
```

### The env() Helper

```typescript
import { env } from '@beeblock/svelar/config';

env('APP_NAME')                    // string (default: '')
env('APP_NAME', 'Svelar')         // string with default
env<number>('DB_PORT', 5432)      // auto-casts '5432' → 5432
env<boolean>('APP_DEBUG', false)  // auto-casts 'true' → true
```

## Container & Service Providers

The IoC container manages application dependencies.

### Service Providers

```typescript
import { ServiceProvider } from '@beeblock/svelar/container';

export class AnalyticsProvider extends ServiceProvider {
  register() {
    this.app.singleton('analytics', () => new AnalyticsService());
  }

  boot() {
    const analytics = this.app.make('analytics');
    console.log('Analytics service booted');
  }
}
```

### Container Usage

```typescript
import { container } from '@beeblock/svelar/container';

container.bind('pdf', () => new PdfGenerator());
container.singleton('auth', () => new AuthManager());

const pdf = container.make('pdf');
const auth = container.make('auth');
```

## Error Handling

Handle errors gracefully across your application.

```typescript
import { abort, abortIf, abortUnless, ModelNotFoundError } from '@beeblock/svelar/errors';

abort(404, 'Resource not found');
abortIf(!user, 401, 'Unauthenticated');
abortUnless(isAdmin, 403, 'Forbidden');
```

See [Error Handling](./19-error-handling.md) for the full guide.

## UUIDv7 & ULID

Svelar provides built-in generators for modern, time-sortable identifiers. Both are available from `@beeblock/svelar/support`.

### UUIDv7

```typescript
import { uuidv7, isUuidv7, uuidv7Timestamp } from '@beeblock/svelar/support';

const id = uuidv7();
// → '019503a4-6b2c-7a1e-8f3d-4a2b1c0d9e8f'

isUuidv7(id);         // → true
uuidv7Timestamp(id);  // → Date object
```

### ULID

```typescript
import { ulid, isUlid, ulidTimestamp } from '@beeblock/svelar/support';

const id = ulid();
// → '01ARYZ6S41TSV4RRFFQ69G5FAV'

isUlid(id);         // → true
ulidTimestamp(id);   // → Date object
```

### JSONB Columns

Use `jsonb()` in migrations for explicit JSONB storage on PostgreSQL. On MySQL it maps to JSON, on SQLite it falls back to TEXT.

## Custom CLI Commands

Create your own CLI commands:

```bash
npx svelar make:command SyncUsers
```

```typescript
import { Command } from '@beeblock/svelar/cli';

export class SyncUsersCommand extends Command {
  name = 'app:sync-users';
  description = 'Sync users from external API';
  arguments = ['source'];
  flags = [
    { name: 'force', alias: 'f', description: 'Force full sync', type: 'boolean' as const },
    { name: 'limit', description: 'Max users to sync', type: 'string' as const, default: '100' },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const source = args[0] ?? 'default';
    await this.bootstrap();
    this.info(`Syncing users from ${source}...`);
    this.success(`Done.`);
  }
}
```

Commands are auto-discovered from `src/lib/commands/` — no registration needed.

## Admin Dashboard

Scaffold a production-ready admin dashboard:

```bash
npx svelar make:dashboard
```

This creates API routes (`/api/admin/*`) and a dashboard page with system health, queue monitoring, scheduler management, and log viewing.

```typescript
import { configureDashboard } from '@beeblock/svelar/dashboard';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';

configureDashboard({ enabled: true, prefix: '/admin' });
```

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/health` | System health |
| GET | `/api/admin/queue` | List jobs |
| POST | `/api/admin/queue/[id]/retry` | Retry failed job |
| GET | `/api/admin/scheduler` | List scheduled tasks |
| POST | `/api/admin/scheduler/[name]/run` | Run task manually |
| GET | `/api/admin/logs` | Query logs |
| GET | `/api/admin/stats` | Combined dashboard stats |

## Plugin System

Plugins extend Svelar with new capabilities:

```typescript
import { PluginManager } from '@beeblock/svelar/plugins';

const plugins = new PluginManager(app);
plugins.use(new StripePlugin());
await plugins.boot();
```

Create plugins by extending the `Plugin` base class with `register()`, `boot()`, `migrations()`, and `config()` lifecycle hooks.

## Audit Logging

Track user actions and system changes:

```typescript
import { Audit } from '@beeblock/svelar/audit';

await Audit.log('user:created', {
  userId: user.id,
  email: user.email,
  ipAddress: event.getClientAddress(),
});

const entries = await Audit.query()
  .where('action', 'user:created')
  .limit(10)
  .get();
```

## API Key Management

Secure token-based authentication:

```typescript
import { ApiKey } from '@beeblock/svelar/api-keys';

const key = await ApiKey.create('My Integration', ['users:read', 'posts:write']);
```

Keys are hashed and can be revoked at any time.

## Outgoing Webhooks

Send events to external services:

```typescript
import { Webhook } from '@beeblock/svelar/webhooks';

await Webhook.register('https://example.com/events', {
  events: ['user:created', 'order:shipped'],
});

await Webhook.dispatch('user:created', { id: user.id, email: user.email });
```

Events are signed with HMAC and retried automatically.

## Teams & Workspaces

Multi-tenant team management:

```typescript
import { Team } from '@beeblock/svelar/teams';

const team = await Team.create({
  name: 'Acme Corp',
  ownerId: user.id,
});

await team.invite('member@example.com', 'editor');
```

Tables are auto-created. Supports role-based access control (owner, admin, member, viewer).

## Email Templates

Manage and render email templates:

```typescript
import { EmailTemplate } from '@beeblock/svelar/email-templates';

await EmailTemplate.register('welcome', {
  subject: 'Welcome to {{ appName }}',
  body: `<p>Hello {{ userName }},</p>...`,
});

const html = await EmailTemplate.render('welcome', {
  appName: 'My App',
  userName: user.name,
});
```

## File Uploads

Track and serve user-uploaded files:

```typescript
import { Upload } from '@beeblock/svelar/uploads';

const upload = await Upload.store(formFile, {
  disk: 'local',
  path: `users/${user.id}`,
  visibility: 'private',
});

const url = await upload.url({ expiresIn: 3600 });
```

## Billing with Stripe

Stripe billing is built into the core — no plugins needed. Install the Stripe SDK and configure:

```bash
npm install stripe
```

```typescript
// src/app.ts
import { Stripe } from '@beeblock/svelar/stripe';

Stripe.configure({
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  currency: 'usd',
});
```

```typescript
// Create a subscription
const subscription = await Stripe.service().createSubscription(
  user.stripe_customer_id,
  'price_xxxxx',
  { trialDays: 14 },
);

// Cancel at end of billing period
await Stripe.service().cancelSubscription(subscription.id, false);

// Handle webhooks
Stripe.webhooks()
  .on('invoice.payment_succeeded', async (event) => {
    // Record payment
  });
```

The scaffold includes a billing page at `/dashboard/billing`, admin billing management, and a webhook route at `/api/webhooks/stripe`.

See [Stripe Billing](./32-stripe.md) for the full guide: products, prices, currencies, checkout, portal, invoices, refunds, and webhook events.

---
