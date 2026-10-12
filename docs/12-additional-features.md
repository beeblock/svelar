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
      ttl: 3600,
    },
    file: {
      driver: 'file',
      path: './storage/cache',
      ttl: 3600,
    },
    redis: {
      driver: 'redis',
      host: 'localhost',
      port: 6379,
      password: process.env.REDIS_PASSWORD,
      db: 0,
      prefix: 'svelar_cache:',
      ttl: 3600,
    },
  },
});
```

The store-level `ttl` is the default TTL in seconds. It applies to `Cache.put()` and direct store calls such as `Cache.store('redis').put()` unless you pass a TTL for that call.

File cache treats missing, expired, and corrupted entries as cache misses and removes corrupted/expired files. Filesystem errors that are not normal cache misses are not swallowed.

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
await Log.debug('Debug message');
await Log.info('Information message');
await Log.warn('Warning message');
await Log.error('Error message');

// With context
await Log.info('User registered', { user_id: 1, email: 'john@example.com' });

// Multiple channels
await Log.channel('file').info('Logged to file only');
await Log.channel('console').warn('Logged to console only');
```

Log writes return promises. Await file and stack channels when you need to guarantee persistence or surface write failures. Missing channels, unknown drivers, and file write errors throw instead of falling back to console.

### Correlation Context And Redaction

`createSvelarApp()` wraps each request with async-local logging context. Logs written during the request automatically include `requestId` and `correlationId`; authenticated requests also add `userId`/`actorId` when auth middleware resolves a user. Jobs, listeners, and custom integrations can use the same mechanism:

```typescript
await Log.withContext({ tenantId: team.id, jobId: job.id }, async () => {
  await Log.info('Sync started', { integration: 'stripe' });
});
```

`Log.configure()` accepts process-wide `context` and extra `redactKeys`. Sensitive fields such as passwords, tokens, secrets, authorization headers, cookies, signatures, and API keys are redacted recursively before entries reach channels or `LogViewer`.

```typescript
Log.configure({
  default: 'file',
  context: { integration: 'billing' },
  redactKeys: ['tenantSecret'],
  channels: {
    file: { driver: 'file', path: 'storage/logs/app.log', format: 'json' },
  },
});
```

## Notifications

Send notifications via email, database, and custom channels.

### Configuration

```typescript
import { Notifier } from '@beeblock/svelar/notifications';

Notifier.configure({
  channels: {
    email: {
      driver: 'email',
    },
    database: {
      driver: 'database',
      table: 'notifications',
    },
  },
});
```

### Notification Classes

```typescript
import { Notification, type NotificationChannel } from '@beeblock/svelar/notifications';

export class OrderShippedNotification extends Notification {
  constructor(private order: Order) {
    super();
  }

  channels(): NotificationChannel[] {
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
      type: 'order_shipped',
      title: 'Order Shipped',
      message: `Your order #${this.order.id} has shipped`,
      data: { order_id: this.order.id },
    };
  }
}

// Send
await Notifier.notify(user, new OrderShippedNotification(order));
```

Register custom channels with `Notifier.extend()`:

```typescript
Notifier.extend('audit', {
  async send(notifiable, notification) {
    const payload = notification.toChannel?.('audit', notifiable);
    await auditService.record(payload);
  },
});
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

Scaffolded apps call `config.loadFromDirectory('config')` in `src/app.ts`, so generated config files are loaded automatically when the web server or a Svelar CLI runtime command boots the application.

Missing config directories are treated as optional and return an empty list. Files inside an existing config directory must import successfully and export an object; syntax errors, failed imports, and invalid exports throw during bootstrap instead of being skipped.

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

Commands are auto-discovered from `src/lib/commands/` in flat projects and `src/lib/shared/commands/` in DDD projects — no registration needed.

## Admin Dashboard

Scaffold the operational admin dashboard:

```bash
npx svelar make:dashboard
```

This creates thin API routes (`/api/admin/*`) bound to the public `DashboardController` and a Svelte 5 page at `/admin/dashboard`. The same file manifest is available through `MakeDashboardCommand.files()` for project scaffolding and updates. Existing files are preserved unless `--force` is supplied; review customized routes before overwriting them.

The page and every API operation require an authenticated global admin by default. Configure the server-side authorization callback for a different access policy; hiding a button does not authorize an operation. Mutations also pass through an authorizing FormRequest, validated DTO, and action/service using the public monitors. Disabled dashboards deny page/API access.

```typescript
import { configureDashboard } from '@beeblock/svelar/dashboard';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';

configureDashboard({
  enabled: true,
  authorize: (event, operation) => {
    // Replace this with your application's server-side permission contract.
    return event.locals.user?.role === 'admin';
  },
});
```

Configure `Queue`/`JobMonitor`, load the same scheduler task registry in web and scheduler processes, configure `ScheduleMonitor`, and run migrations before operating the console. The generated URLs are fixed; the dashboard plugin's `prefix` setting does not relocate generated files.

The browser uses `apiFetch` to send the `X-CSRF-Token` header from `XSRF-TOKEN`. The controller enforces CSRF for session mutations even if a caller adds a Bearer header. Responses use `{ data, meta }` and `Cache-Control: no-store`; clients migrating from older generated APIs must read `payload.data` and `payload.meta.message`.

When the dashboard plugin is booted with background health collection enabled, it records the latest health snapshot plus last run/success/error metadata. Polling begins on boot, does not overlap slow snapshots, and stops on shutdown. Health collection failures remain visible in dashboard data. Unexpected HTTP operation failures are logged with an incident ID and return a safe error, never the raw driver exception.

The overview consumes the public queue registry, counts, and `JobMonitor.getHealth().runtime`. It shows labels/metadata, waiting/active/failed/completed/delayed counts, observed workers, configured versus effective/global concurrency, pause state, and available age metrics without importing BullMQ. Missing telemetry and registry connections outside the monitor's configured connection are shown as unknown, not zero. Redis absolute oldest-job age and effective remote-worker concurrency may be unknown; registry concurrency is only a configuration hint.

Jobs have queue/status filters, pagination (`limit` 1-100, non-negative bounded `offset`), redacted payload/metadata/progress, stack errors, attempts, and the timestamps available from the monitor. Inspection, retry, and deletion pass an explicit queue name because Redis job IDs are queue-local. Retry is limited to failed jobs; active deletion is rejected. Destructive deletion requires both browser confirmation and `{ confirmed: true }`. Mutations prevent duplicate clicks and refresh visible state without an invalidation loop. Redis exact listing can refuse a backlog exceeding `JobMonitor.redisScanLimit`; configure that limit deliberately rather than assuming unbounded scans are safe.

Scheduled task controls persist through `ScheduleMonitor` to `scheduled_task_settings`; history comes from `scheduled_task_runs`. Manual runs report the actual result: overlap skips return 409 and failed runs return a safe 503 with a logged error. Enabled/running checks prevent known invalid runs, but a web process's running flag is not a distributed lock viewer.

Mutations record intent before executing and completion afterwards through `Audit`. Configure a persistent audit driver for production. If intent cannot be recorded, the operation is blocked; if completion audit fails after execution, the response warns not to repeat the operation without checking state. Queue/scheduler side effects and audit persistence are not a single transaction.

The logs tab has minimum-level/channel/search filters and pagination with filtered totals. Payloads, log context, and common credential formats in text are redacted at the dashboard boundary. Invalid/unstructured job payloads are withheld rather than exposed verbatim. Keep secrets out of free-form logs: redaction cannot recognize every arbitrary secret string. LogViewer queries and SSE tail are explicitly scoped to the current web process's ring buffer, not persistent shared log storage. SSE disconnect/cancel paths unsubscribe, bound slow clients, and reconnect periodically to recheck authorization.

This bounded console does not yet provide batch retry/cleanup, DLQ routing, safe resource deep links, queue pause/resume commands, a distributed scheduler lock inspector, persistent shared log queries, integration kill switches, or a complete user/tenant permission editor. Those require additional public contracts or their owning scaffold surfaces; the UI does not invent telemetry or bypass those boundaries.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/health` | System health |
| GET | `/api/admin/queue` | Status-filtered paginated jobs (default: failed) |
| GET | `/api/admin/queue/[id]?queue=...` | Redacted job inspection |
| POST | `/api/admin/queue/[id]/retry` | Retry failed job |
| DELETE | `/api/admin/queue/[id]?queue=...` | Delete non-active job with explicit confirmation |
| GET | `/api/admin/scheduler` | List scheduled tasks |
| POST | `/api/admin/scheduler/[name]/run` | Run task manually |
| POST | `/api/admin/scheduler/[name]/toggle` | Persist boolean enabled state |
| GET | `/api/admin/logs` | Query logs |
| GET | `/api/admin/logs/tail` | Authorized, redacted process-local SSE logs |
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

For ORM models, call `auditable(ModelClass)` once during boot to register a
model observer. It records `created`, `updated`, `deleted`, `restored`, and
`forceDeleted` lifecycle events with `getChanges()` / `getPreviousOriginal()`
diffs, redacts sensitive fields such as passwords and tokens, and includes
`userId`, `teamId`, and `correlationId` from the Svelar application context.

## API Key Management

Secure token-based authentication:

```typescript
import { ApiKeys } from '@beeblock/svelar/api-keys';

const { plainTextKey, record } = await ApiKeys.create({
  name: 'My Integration',
  userId: user.id,
  permissions: ['users:read', 'posts:write'],
});
```

Keys are hashed and can be revoked at any time. Permissions are deny-by-default: an empty permission list authenticates the key owner but does not pass permission checks. Use `'*'` only for deliberately unrestricted keys.

User-facing revocation must use `await ApiKeys.revokeForUser(keyId, authenticatedUser.id)`. It atomically checks ownership and returns `false` for missing, foreign or already revoked keys. Never accept the owner ID from submitted data. `ApiKeys.revoke(keyId)` is an unrestricted infrastructure operation for already authorized administrative code, not a substitute for ownership authorization. Generated API-key actions use the owner-scoped operation and return an inline 403 failure instead of a 500 for unauthorized revocation.

## Outgoing Webhooks

Send events to external services:

```typescript
import { Webhooks } from '@beeblock/svelar/webhooks';

await Webhooks.register({
  url: 'https://example.com/events',
  events: ['user:created', 'order:shipped'],
  active: true,
});

await Webhooks.dispatch('user:created', { id: user.id, email: user.email });
```

Events are signed with HMAC and retried automatically.

## Incoming Webhook Inbox

Use `WebhookInbox` when your app receives webhooks from payment providers, marketplaces, Gotenberg callbacks, or other external systems. It stores the raw payload, redacted headers, digest, status, tenant/actor context, and an idempotency key before any slow processing happens.

```typescript
import { WebhookInbox } from '@beeblock/svelar/webhooks';

export const POST = async ({ request }) => {
  const result = await WebhookInbox.receiveRequest('stripe', request, {
    event: request.headers.get('stripe-event') ?? undefined,
    idempotencyKey: request.headers.get('stripe-event-id') ?? undefined,
    verifier: WebhookInbox.hmacVerifier(process.env.STRIPE_WEBHOOK_SECRET!, {
      header: 'stripe-signature',
      prefix: 'sha256',
    }),
  });

  if (!result.duplicate) {
    await WebhookInbox.markQueued(result.entry.id);
    // Dispatch a queue job from here if processing is slow or retryable.
  }

  return new Response(null, { status: 202 });
};
```

The inbox supports memory and database drivers. Run Svelar core migrations to create `webhook_inbox_entries`, then use `markProcessing()`, `markProcessed()`, `markFailed()`, and `replay()` from workers or admin tooling. Invalid HMAC signatures throw `WebhookSignatureError` before the entry is stored.

Capture is idempotent within `(source, tenantId, idempotencyKey)`: concurrent deliveries return one winning entry and retain its original payload. Different tenants can receive the same provider key without sharing entries. Numeric tenant IDs normalize to strings (`42` and `'42'` identify the same tenant); omitted or `null` tenant IDs share a separate global namespace. The visible `idempotencyKey` is unchanged. Database arbitration uses a unique internal SHA-256 hash of the JSON scope tuple, including the global namespace, rather than a nullable tenant column in a composite unique constraint.

Resolve `tenantId` from trusted server-side configuration or an authorized provider-account mapping. Do not trust a tenant ID supplied in webhook headers or payloads. Signature verification runs before duplicate recovery, including for existing keys; a valid signature alone does not authorize the tenant mapping. Entry lookup and processing by ID still require application-level authorization.

For existing installations, stop webhook receivers, review `npx svelar update --category migration --dry-run`, apply the missing framework migration with `npx svelar update --category migration`, and run `npx svelar migrate` before restarting updated receivers. Additive migration `00000000_000034_scope_webhook_inbox_idempotency` backfills retained records, creates `idx_webhook_inbox_deduplication`, then removes the old source/key-only constraint; it does not replace stored payloads or visible keys. Custom inbox tables need the same `deduplication_key` column and unique index. Do not run mixed old/new writers during this change. SQLite and PostgreSQL schema changes are transactional; MySQL DDL implicitly commits, so take a backup and inspect any failed migration before retrying. Rollback refuses to restore the old global source/key constraint when different tenants share a key; it never deletes entries to make rollback succeed.

## Teams & Workspaces

Multi-tenant team management:

```typescript
import { Teams } from '@beeblock/svelar/teams';

const team = await Teams.create({
  name: 'Acme Corp',
  ownerId: user.id,
});

await Teams.invite(team.id, 'member@example.com', 'admin');
```

Tables are managed by Svelar core migrations. Teams use `owner`, `admin`, `member`, and `viewer` roles by default; pass `roles` to `Teams.configure()` to allow custom roles. The `owner` role is reserved for the team owner, cannot be assigned through invitations or member updates, and the owner member cannot be removed through `removeMember()`.

Use `Teams.runWithTeam()` for tenant-scoped work. Svelar stores the current
team in `AsyncLocalStorage`, so concurrent requests, events, and queued jobs do
not overwrite each other's team context:

```typescript
import { TenantModel } from '@beeblock/svelar/orm';
import { Teams } from '@beeblock/svelar/teams';

class Project extends TenantModel {
  static table = 'projects';
  static fillable = ['name'];
}

await Teams.runWithTeam(team.id, async () => {
  await Project.create({ name: 'Roadmap' }); // team_id is filled automatically
  const projects = await Project.all();      // WHERE team_id = current team
});
```

`TenantModel` fails closed when no team context exists. Use
`Project.withoutTenantScope()` only for explicit admin/reporting workflows.

## Email Templates

Manage and render email templates:

```typescript
import { EmailTemplates } from '@beeblock/svelar/email-templates';

await EmailTemplates.register({
  name: 'welcome',
  subject: 'Welcome to {{ appName }}',
  html: `<p>Hello {{ userName }},</p>...`,
  variables: ['appName', 'userName'],
  active: true,
});

const { html } = await EmailTemplates.render('welcome', {
  appName: 'My App',
  userName: user.name,
});
```

## File Uploads

Track and serve user-uploaded files:

```typescript
import { Uploads } from '@beeblock/svelar/uploads';

const upload = await Uploads.store(formFile, {
  disk: 'local',
  directory: `users/${user.id}`,
  userId: user.id,
});

const url = await Uploads.getUrl(upload.id, 3600);
```

`Uploads.store()`, `Uploads.delete()`, and `Uploads.getUrl()` use the configured Storage disk and throw storage configuration, filesystem, or S3/RustFS errors. Upload metadata is only created after the file write succeeds, and metadata is not deleted when file deletion fails.

## Billing with Stripe

Stripe billing is available as the `@beeblock/svelar-stripe` plugin. Install the Stripe SDK and configure:

```bash
npm install @beeblock/svelar-stripe stripe
npx svelar plugin:install @beeblock/svelar-stripe
```

```typescript
// src/app.ts
import { Stripe } from '@beeblock/svelar-stripe';

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
