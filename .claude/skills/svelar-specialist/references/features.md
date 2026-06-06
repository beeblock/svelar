# Feature Modules API Reference

Full docs: https://svelar.dev/docs

## Table of Contents
- [Queue & Jobs](#queue--jobs)
- [Scheduler](#scheduler)
- [Events & Listeners](#events--listeners)
- [Mail](#mail)
- [Cache](#cache)
- [Storage](#storage)
- [Broadcasting (SSE / Soketi/Pusher)](#broadcasting)
- [Stripe Billing](#stripe-billing)
- [Permissions & Roles](#permissions--roles)
- [Full-Text Search](#full-text-search)
- [Plugins](#plugins)
- [Container & Providers](#container--providers)
- [Config & Environment](#config--environment)
- [Hashing](#hashing)
- [Sessions](#sessions)
- [Notifications](#notifications)
- [Audit Logging](#audit-logging)
- [API Keys](#api-keys)
- [Webhooks](#webhooks)
- [Teams](#teams)
- [Uploads](#uploads)
- [Feature Flags](#feature-flags)
- [Email Templates](#email-templates)
- [PDF Generation](#pdf-generation)
- [Excel Import/Export](#excel-importexport)
- [Support Utilities](#support-utilities)

---

## Queue & Jobs

Docs: https://svelar.dev/docs/queue

Import: `from '@beeblock/svelar/queue'`

```typescript
// Define a job
class SendWelcomeEmail extends Job {
  constructor(private userId: number) { super(); }
  maxAttempts = 3;
  retryDelay = 60;    // seconds
  queue = 'emails';   // named queue

  async handle() {
    const user = await User.findOrFail(this.userId);
    await Mailer.send({ to: user.email, subject: 'Welcome!', html: '...' });
  }

  async failed(error: Error) {
    console.error('Job failed permanently:', error);
  }
}

// Dispatch
await Queue.dispatch(new SendWelcomeEmail(user.id));
await Queue.dispatchSync(new SendWelcomeEmail(user.id));  // run immediately
await Queue.chain([new Job1(), new Job2()]);               // sequential

// Worker
await Queue.work({ queue: 'emails', maxJobs: 100, sleep: 3 });

// Failed jobs
const failed = await Queue.failed();
await Queue.retry(failedJobId);
await Queue.retryAll();
await Queue.flushFailed();

// Queue must be configured in app.ts:
Queue.configure({ driver: 'database' });  // 'sync' | 'memory' | 'database' | 'redis'
Queue.register(SendWelcomeEmail);
```

## Scheduler

Docs: https://svelar.dev/docs/scheduler

Import: `from '@beeblock/svelar/scheduler'`

Tasks are auto-discovered from `src/lib/scheduler/`. Each file must have a `default export`.

```typescript
export default class CleanupTokens extends ScheduledTask {
  name = 'cleanup:tokens';

  schedule() { return this.daily(); }
  // Or: this.everyMinute(), this.everyMinutes(5), this.hourly(),
  //     this.hourlyAt(30), this.dailyAt('03:00'), this.twiceDaily(),
  //     this.weekly(), this.weeklyOn(1, '08:00'), this.weekdays(),
  //     this.weekends(), this.monthly(), this.monthlyOn(1, '00:00'),
  //     this.quarterly(), this.yearly(), this.cron('*/5 * * * *')

  async handle() {
    const result = await auth.cleanupExpiredTokens();
    console.log('Cleaned:', result);
  }

  async onSuccess() { console.log('Task completed'); }
  async onFailure(error: Error) { console.error('Task failed:', error); }
}
```

Run: `npx svelar schedule:run`

## Events & Listeners

Docs: https://svelar.dev/docs/events

Import: `from '@beeblock/svelar/events'`

```typescript
// Listen
Event.listen('user:registered', async (user) => {
  await Queue.dispatch(new SendWelcomeEmail(user.id));
});

Event.once('app:ready', async () => { /* one-time */ });
Event.onAny(async (eventName, payload) => { /* wildcard */ });

// Emit
Event.emit('user:registered', user);
Event.emit('order:completed', { orderId: 123 });

// Class-based events
class OrderPlaced extends BaseEvent {
  constructor(public order: Order) { super(); }
}
Event.listen(OrderPlaced, async (event) => { /* event.order */ });
Event.dispatch(new OrderPlaced(order));

// Cleanup
Event.forget('user:registered');
Event.flush();
```

## Mail

Docs: https://svelar.dev/docs/mail

Import: `from '@beeblock/svelar/mail'`

```typescript
Mailer.configure({
  default: 'smtp',
  mailers: {
    smtp: { driver: 'smtp', host: '...', port: 587, auth: { user, pass } },
    resend: { driver: 'resend', apiKey: '...' },
    postmark: { driver: 'postmark', apiKey: '...' },
  },
  from: { name: 'App', email: 'noreply@app.com' },
});

// Send directly
await Mailer.send({
  to: 'user@example.com',
  subject: 'Hello',
  html: '<p>Welcome!</p>',
});

// Mailable class
class WelcomeEmail extends Mailable {
  constructor(private user: User) { super(); }
  build() {
    this.to(this.user.email)
      .subject('Welcome!')
      .html(`<p>Hello ${this.user.name}</p>`);
  }
}
await Mailer.sendMailable(new WelcomeEmail(user));
```

## Cache

Docs: https://svelar.dev/docs/additional-features

Import: `from '@beeblock/svelar/cache'`

```typescript
Cache.configure({
  default: 'memory',
  stores: {
    memory: { driver: 'memory' },
    file: { driver: 'file', path: './storage/cache' },
    redis: { driver: 'redis', host: 'localhost', port: 6379 },
  },
});

await Cache.put('key', value, 3600);          // TTL in seconds
const val = await Cache.get('key', default?);
await Cache.forget('key');
await Cache.flush();
await Cache.has('key');
await Cache.increment('counter');
await Cache.decrement('counter');

// Remember pattern
const posts = await Cache.remember('posts', 3600, async () => {
  return await Post.all();
});
const config = await Cache.rememberForever('config', async () => {
  return await loadConfig();
});
const val = await Cache.pull('key');  // get & delete
```

## Storage

Docs: https://svelar.dev/docs/storage

Import: `from '@beeblock/svelar/storage'`

```typescript
Storage.configure({
  default: 'local',
  disks: {
    local: { driver: 'local', root: './storage/app' },
    s3: { driver: 's3', bucket: '...', region: '...', credentials: { ... } },
  },
});

await Storage.put('uploads/file.txt', content);
const data = await Storage.get('uploads/file.txt');     // Buffer
const text = await Storage.getText('uploads/file.txt'); // string
await Storage.exists('uploads/file.txt');
await Storage.delete('uploads/file.txt');
await Storage.copy('from.txt', 'to.txt');
await Storage.move('from.txt', 'to.txt');
const files = await Storage.files('uploads/');
const allFiles = await Storage.allFiles('uploads/');    // recursive
const url = Storage.url('uploads/file.txt');
const size = await Storage.size('uploads/file.txt');

// S3-specific
const s3 = Storage.s3Disk();
const signedUrl = await s3.temporaryUrl('file.txt', 3600);
await s3.ensureBucket();

// Switch disk
await Storage.disk('s3').put('file.txt', content);
```

## Broadcasting

Docs: https://svelar.dev/docs/broadcasting

Import: `from '@beeblock/svelar/broadcasting'`

**Singleton via `Symbol.for()` on `globalThis`** -- same instance across imports.

```typescript
Broadcast.configure({
  driver: 'sse',  // 'sse' | 'pusher' | 'log'
  channels: {
    'private-user.*': (user, channelName) => {
      const userId = channelName.split('.')[1];
      return user && String(user.id) === userId;
    },
    'presence-room.*': (user) => !!user,
  },
});

// Send events
Broadcast.event('message', { text: 'Hello' }).on('chat-room').send();
Broadcast.to('private-user.1').send('notification', { title: 'New message' });

// SSE subscribe endpoint (in +server.ts)
export async function GET(event) {
  const userId = event.locals.user?.id;
  return Broadcast.subscribe('private-user.' + userId, userId);
}

// Channel info
Broadcast.activeChannels();
Broadcast.totalSubscribers();
Broadcast.members('presence-room.1');

// IMPORTANT: Scheduler runs in separate process.
// To send SSE from scheduler/jobs, POST to /api/internal/broadcast
```

For Soketi/Pusher-compatible realtime, configure the `pusher` driver and test real cross-browser event delivery. A successful `/health` or ping request only proves the socket service is reachable.

### Client-side
```typescript
import { sseClient } from '@beeblock/svelar/broadcasting/client';

const client = sseClient('/api/broadcasting/sse');
client.on('notification', (data) => { /* handle */ });
client.connect();
client.disconnect();
```

## Stripe Billing

Docs: https://svelar.dev/docs/stripe

Import: `from '@beeblock/svelar-stripe'`

Available as the `@beeblock/svelar-stripe` official plugin.

```typescript
Stripe.configure({
  secretKey: env.STRIPE_SECRET_KEY,
  publishableKey: env.STRIPE_PUBLISHABLE_KEY,
  webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  currency: 'usd',
});

// Service
const service = Stripe.service();
await service.createCustomer({ email, name, metadata });
await service.createSubscription(customerId, priceId, { trialDays: 14 });
await service.cancelSubscription(subId, true);   // immediately
await service.cancelSubscription(subId, false);  // at period end
await service.createCheckoutSession({ customerId, priceId, successUrl, cancelUrl });
await service.createPortalSession(customerId, returnUrl);
await service.createRefund(paymentIntentId, amount?);

// Built-in controllers for billing routes
import { BillingController, StripeWebhookController } from '@beeblock/svelar-stripe/server';

// src/routes/api/webhooks/stripe/+server.ts
const webhook = new StripeWebhookController();
export const POST = webhook.handle('handleWebhook');

// src/routes/api/admin/billing/subscriptions/+server.ts
const billing = new BillingController();
export const GET = billing.handle('listSubscriptions');

// Register webhook event handlers in app.ts
Stripe.webhooks()
  .on('customer.subscription.created', async (event) => { /* ... */ })
  .on('invoice.payment_succeeded', async (event) => { /* ... */ });

// Subscription Manager (with DB sync)
const mgr = Stripe.subscriptions({ db, userId: user.id });
await mgr.subscribe(priceId, { trialDays: 7 });
await mgr.cancel();
await mgr.resume();
await mgr.changePlan(newPriceId);
```

## Permissions & Roles

Docs: https://svelar.dev/docs/middleware (permissions section)

Import: `from '@beeblock/svelar/permissions'`

Spatie-inspired RBAC with pivot tables.

```typescript
// Model mixin
class User extends HasRoles(Model) {
  static table = 'users';
}

// Assign roles & permissions
await user.assignRole('editor');
await user.syncRoles(['admin', 'editor']);
await user.givePermission('posts:write');

// Check
user.hasRole('admin');
user.hasAnyRole('admin', 'editor');
user.hasPermission('posts:write');
user.can('posts:write');

// Manager
await Permissions.createRole({ name: 'editor', guard: 'web' });
await Permissions.createPermission({ name: 'posts:write', guard: 'web' });
await Permissions.giveRolePermission('editor', 'posts:write');

// Middleware
this.middleware(new RequireRoleMiddleware('admin'));
this.middleware(new RequirePermissionMiddleware('posts:write'));
```

## Full-Text Search

Docs: https://svelar.dev/docs/search

Import: `from '@beeblock/svelar/search'`

Meilisearch integration with model mixin.

```typescript
Search.configure({ host: 'http://localhost:7700', apiKey: '...' });

class Post extends Searchable(Model) {
  static table = 'posts';
  toSearchableObject() {
    return { id: this.id, title: this.title, content: this.content };
  }
}

const results = await Post.search('hello world');
await Post.makeAllSearchable();                    // reindex all
await Post.removeAllFromSearch();
await Post.configureSearchIndex({ sortableAttributes: ['created_at'] });
```

## Plugins

Docs: https://svelar.dev/docs/plugins

Import: `from '@beeblock/svelar/plugins'`

### Creating a Plugin

Generate scaffold: `npx svelar make:plugin AnalyticsPlugin`

```typescript
import { Plugin } from '@beeblock/svelar/plugins';
import type { Container } from '@beeblock/svelar/container';

class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';
  description = 'Analytics tracking for Svelar apps';
  readonly dependencies = ['svelar-other-plugin'];  // resolved via topological sort

  // Lifecycle: register -> boot -> shutdown
  async register(app: Container) { app.singleton('analytics', () => new AnalyticsService()); }
  async boot(app: Container) { /* all plugins registered, safe to resolve cross-plugin */ }
  async shutdown() { /* cleanup, no arguments */ }

  // Capabilities (all optional)
  config() { return { key: 'analytics', defaults: { enabled: true, trackPageViews: true } }; }

  middleware() { return [{ name: 'track-views', handler: async (ctx: any, next: any) => {
    console.log('Page:', ctx.event.url.pathname);
    return next();
  }}]; }

  routes() { return [{ method: 'GET' as const, path: '/api/analytics/stats', handler: async () => {
    return new Response(JSON.stringify({ views: 42 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }}]; }

  commands() { return [{ name: 'analytics:clear', description: 'Clear analytics', handler: async (args: string[]) => {
    console.log('Cleared.');
  }}]; }

  listeners() { return [{ event: 'user:registered', handler: async (user: any) => {
    console.log('New user:', user.id);
  }}]; }

  migrations() { return ['./database/migrations/create_events_table.ts']; }

  publishables() { return {
    analytics: [
      { source: './config/analytics.ts', dest: 'config/analytics.ts', type: 'config' as const },
      { source: './migrations/create_events.ts', dest: 'src/lib/database/migrations/create_events.ts', type: 'migration' as const },
    ],
  }; }
}
```

### Using Plugins

```typescript
import { container } from '@beeblock/svelar/container';
import { PluginManager, discoverPlugins } from '@beeblock/svelar/plugins';

const mgr = new PluginManager(container);

// Manual registration
mgr.use(new AnalyticsPlugin());
mgr.useMany([new AnalyticsPlugin(), new SeoPlugin()]);
await mgr.boot();

// Auto-discover from directory
const plugins = await discoverPlugins('./src/lib/shared/plugins');
mgr.useMany(plugins);
await mgr.boot();

// Access plugin services
const analytics = container.make('analytics');

// Plugin hooks (cross-plugin communication)
mgr.on('analytics:reset', async () => { console.log('Reset!'); });
await mgr.triggerHook('analytics:reset');
// Built-in hooks: app:boot, app:shutdown, request:before, request:after,
//   model:creating, model:created, model:updating, model:updated, model:deleting, model:deleted
```

### Publishing as npm Package

```
svelar-analytics/
  src/index.ts          -- export the Plugin class
  config/analytics.ts   -- default config (publishable)
  package.json
```

```json
{
  "name": "svelar-analytics",
  "keywords": ["svelar-plugin"],
  "peerDependencies": { "@beeblock/svelar": ">=0.4.0" }
}
```

The `svelar-plugin` keyword enables auto-discovery via `npx svelar plugin:list`.

```bash
npx svelar plugin:install svelar-analytics    # npm install + register + publish assets
npx svelar plugin:publish svelar-analytics    # copy config/migrations to user app
npx svelar plugin:publish svelar-analytics --only config --force
npx svelar plugin:list                        # show installed plugins
```

> **Note:** Stripe billing is available as the `@beeblock/svelar-stripe` official plugin.

## Container & Providers

Import: `from '@beeblock/svelar/container'`

```typescript
container.bind('pdf', () => new PdfGenerator());       // new instance each time
container.singleton('auth', () => new AuthManager());   // cached
container.instance('config', configObj);                // fixed value
const pdf = container.make('pdf');

class AppProvider extends ServiceProvider {
  register() { this.app.singleton('cache', () => new CacheManager()); }
  boot() { const cache = this.app.make('cache'); cache.init(); }
}
```

## Config & Environment

Import: `from '@beeblock/svelar/config'`

```typescript
// config/app.ts
import { env } from '@beeblock/svelar/config';
export default {
  name: env('APP_NAME', 'Svelar'),
  debug: env<boolean>('APP_DEBUG', false),
  url: env('APP_URL', 'http://localhost:5173'),
};

// Usage
import { config } from '@beeblock/svelar/config';
await config.loadFromDirectory('./config');
config.get('app.name');
config.get('database.default', 'sqlite');
config.set('app.maintenance', true);
```

## Hashing

Import: `from '@beeblock/svelar/hashing'`

```typescript
Hash.configure({ driver: 'scrypt' }); // 'scrypt' | 'bcrypt' | 'argon2'
const hashed = await Hash.make('password');
const valid = await Hash.check('password', hashed);
```

## Sessions

Import: `from '@beeblock/svelar/session'`

```typescript
// Always use DatabaseSessionStore in production
const store = new DatabaseSessionStore();

// In hooks.server.ts (handled by createSvelarApp)
// Or manually:
session.get('key', default?);
session.put('key', value);
session.forget('key');
session.flush();
session.all();
```

Stores: `DatabaseSessionStore` (recommended), `MemorySessionStore` (dev), `FileSessionStore`, `RedisSessionStore`

## Notifications

Import: `from '@beeblock/svelar/notifications'`

```typescript
class OrderShipped extends Notification {
  constructor(private order: Order) { super(); }
  channels() { return ['email', 'database']; }
  toEmail() { return { to: this.order.user.email, subject: '...', html: '...' }; }
  toDatabase() { return { title: '...', message: '...', data: {} }; }
}

await Notifier.notify(user, new OrderShipped(order));
```

## Audit Logging

Import: `from '@beeblock/svelar/audit'`

```typescript
await Audit.log('user:created', { userId: user.id, email: user.email, ip: event.getClientAddress() });
const entries = await Audit.query().where('action', 'user:created').limit(10).get();
```

## API Keys

Import: `from '@beeblock/svelar/api-keys'`

```typescript
const key = await ApiKey.create('My Integration', ['users:read', 'posts:write']);
// key.plainToken -- show once, then hashed
```

## Webhooks

Import: `from '@beeblock/svelar/webhooks'`

```typescript
await Webhook.register('https://example.com/events', { events: ['user:created'] });
await Webhook.dispatch('user:created', { id: user.id });
// HMAC-signed, auto-retried
```

## Teams

Import: `from '@beeblock/svelar/teams'`

```typescript
const team = await Team.create({ name: 'Acme', ownerId: user.id });
await team.invite('member@example.com', 'editor');
// Roles: owner, admin, member, viewer
```

## Uploads

Import: `from '@beeblock/svelar/uploads'`

```typescript
const upload = await Upload.store(formFile, { disk: 'local', path: `users/${user.id}`, visibility: 'private' });
const url = await upload.url({ expiresIn: 3600 });
```

## Feature Flags

Import: `from '@beeblock/svelar/feature-flags'`

```typescript
FeatureFlag.define('new-dashboard', { enabled: false, percentage: 10 });
if (await FeatureFlag.isEnabled('new-dashboard', user)) { /* show new UI */ }
```

## Email Templates

Import: `from '@beeblock/svelar/email-templates'`

```typescript
await EmailTemplate.register('welcome', { subject: 'Welcome {{ name }}', body: '<p>Hello {{ name }}</p>' });
const html = await EmailTemplate.render('welcome', { name: user.name });
```

## PDF Generation

Import: `from '@beeblock/svelar/pdf'`

```typescript
// Requires Gotenberg service
const pdf = await Pdf.fromHtml('<h1>Report</h1>');
const pdf = await Pdf.fromUrl('https://example.com/report');
```

## Excel Import/Export

Import: `from '@beeblock/svelar/excel'`

```typescript
const buffer = await Excel.export(users, { columns: ['name', 'email'], sheetName: 'Users' });
const rows = await Excel.import(file);
```

## Support Utilities

Import: `from '@beeblock/svelar/support'`

```typescript
uuidv7();                    // time-sortable UUID
ulid();                      // ULID
isUuidv7(str);               // validate
isUlid(str);                 // validate
uuidv7Timestamp(uuid);       // extract Date
ulidTimestamp(ulid);         // extract Date

singleton('key', () => new Service());  // create/cache singleton

// Pipeline
new Pipeline()
  .send(data)
  .through(transform1, transform2)
  .then((result) => { /* final */ });
```
