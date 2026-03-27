# Additional Features

Explore Svelar's additional capabilities for a complete backend framework.

## Session Management

Sessions store user data across requests using signed cookies.

### Session Middleware

Configure sessions in `src/hooks.server.ts`:

```typescript
import { SessionMiddleware, MemorySessionStore } from 'svelar/session';

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({
      store: new MemorySessionStore(),
      secret: process.env.APP_KEY || 'dev-secret',
      lifetime: 60 * 60 * 24,  // 24 hours
      name: 'svelar_session',   // Cookie name
    }),
  ],
});
```

### Using Sessions

```typescript
// Set session data
event.locals.session.set('auth_user_id', 1);
event.locals.session.set('preferences', { theme: 'dark' });

// Get session data
const userId = event.locals.session.get('auth_user_id');
const preferences = event.locals.session.get('preferences');

// Remove from session
event.locals.session.forget('auth_user_id');

// Regenerate ID (for security after login)
event.locals.session.regenerateId();

// Get all session data
const all = event.locals.session.all();

// Check if key exists
const hasTheme = event.locals.session.has('preferences.theme');

// Get with default
const theme = event.locals.session.get('preferences.theme', 'light');
```

### Session Stores

**MemorySessionStore** (development):

```typescript
import { MemorySessionStore } from 'svelar/session';

new SessionMiddleware({
  store: new MemorySessionStore(),
});
```

**DatabaseSessionStore** (production):

```typescript
import { DatabaseSessionStore } from 'svelar/session';

new SessionMiddleware({
  store: new DatabaseSessionStore('sessions'),
});
```

## Hashing

Securely hash passwords and other sensitive data.

### Configuration

```typescript
import { Hash } from 'svelar/hashing';

Hash.configure({
  driver: 'scrypt',  // 'bcrypt', 'argon2'
});
```

### Hashing Passwords

```typescript
import { Hash } from 'svelar/hashing';

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
import { Cache } from 'svelar/cache';

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
import { Cache } from 'svelar/cache';

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

## Events & Listeners

Decouple components using a pub/sub event system.

### Emitting Events

```typescript
import { EventDispatcher } from 'svelar/events';

// Emit event
await EventDispatcher.dispatch('user:registered', user);
await EventDispatcher.dispatch('post:published', { post, author });
```

### Listening to Events

```typescript
import { EventDispatcher } from 'svelar/events';

// Listen to event
EventDispatcher.listen('user:registered', async (user) => {
  console.log('New user registered:', user.email);
  // Send welcome email, add to mailing list, etc.
});

// Multiple listeners
EventDispatcher.listen('post:published', async ({ post, author }) => {
  console.log(`${author.name} published: ${post.title}`);
});

// Listen once
EventDispatcher.listenOnce('app:started', async () => {
  console.log('App is starting up');
});

// Stop listening
EventDispatcher.stop('user:registered');
```

### Creating Event Classes

```typescript
import { Event } from 'svelar/events';

export class UserRegisteredEvent extends Event {
  constructor(readonly user: User) {
    super();
  }
}

// Dispatch
await EventDispatcher.dispatch(new UserRegisteredEvent(user));

// Listen
EventDispatcher.listen(UserRegisteredEvent, async (event) => {
  console.log('User registered:', event.user.email);
});
```

## Logging

Log messages for debugging and monitoring.

### Configuration

```typescript
import { Log } from 'svelar/logging';

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
import { Log } from 'svelar/logging';

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

## Mail

Send emails from your application.

### Configuration

```typescript
import { Mailer } from 'svelar/mail';

Mailer.configure({
  default: 'smtp',
  mailers: {
    smtp: {
      driver: 'smtp',
      host: process.env.MAIL_HOST || 'smtp.mailtrap.io',
      port: parseInt(process.env.MAIL_PORT || '465'),
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD,
      },
    },
    log: {
      driver: 'log',  // Log instead of sending (development)
    },
  },
});
```

### Sending Mail

```typescript
import { Mailer } from 'svelar/mail';

// Simple mail
await Mailer.send({
  from: 'hello@example.com',
  to: 'user@example.com',
  subject: 'Welcome',
  html: '<h1>Welcome!</h1>',
});

// With attachments
await Mailer.send({
  to: 'user@example.com',
  subject: 'Report',
  html: 'See attached report',
  attachments: [
    { filename: 'report.pdf', path: './reports/report.pdf' },
  ],
});
```

### Mailable Classes

Define reusable email templates:

```typescript
import { Mailable } from 'svelar/mail';

export class WelcomeEmail extends Mailable {
  constructor(private user: User) {
    super();
  }

  build() {
    return this.to(this.user.email)
      .subject('Welcome to Svelar')
      .html(`
        <h1>Welcome ${this.user.name}!</h1>
        <p>Thanks for signing up.</p>
      `);
  }
}

// Send
await Mailer.send(new WelcomeEmail(user));
```

## Notifications

Send notifications via multiple channels (email, SMS, database).

### Configuration

```typescript
import { Notifier } from 'svelar/notifications';

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
import { Notification } from 'svelar/notifications';

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

## Broadcasting

Real-time event broadcasting with public, private, and presence channels. Soketi (a self-hosted Pusher-compatible WebSocket server) is the default driver and ships in the Docker Compose setup out of the box.

### Quick Start (3 commands)

```bash
# 1. Scaffold everything: routes, config, client initialization
npx svelar make:broadcasting

# 2. Install the client-side WebSocket library
npm install pusher-js

# 3. Start Soketi (included in docker-compose)
docker compose up -d soketi
```

The `make:broadcasting` command creates:

- `src/routes/api/broadcasting/auth/+server.ts` — Pusher/Soketi channel auth endpoint
- `src/routes/api/broadcasting/[channel]/+server.ts` — SSE streaming endpoint (fallback driver)
- `src/lib/broadcasting.ts` — Client-side initialization (import in your layout)
- `config/broadcasting.ts` — Server-side config (Soketi enabled by default)

Flags: `--sse` (SSE routes only), `--pusher` (Pusher/Soketi routes only), `--force` (overwrite).

### Server-Side Configuration

The generated `config/broadcasting.ts` uses Soketi by default:

```typescript
import { env } from 'svelar/config';

export default {
  default: env('BROADCAST_DRIVER', 'pusher'),
  drivers: {
    pusher: {
      driver: 'pusher',
      key: env('PUSHER_KEY', 'svelar-key'),
      secret: env('PUSHER_SECRET', 'svelar-secret'),
      appId: env('PUSHER_APP_ID', 'svelar-app'),
      host: env('PUSHER_HOST', 'localhost'),   // 'soketi' in Docker
      port: env<number>('PUSHER_PORT', 6001),
      useTLS: false,
    },
    sse: { driver: 'sse' },
    log: { driver: 'log' },
  },
};
```

Load it in `src/app.ts`:

```typescript
import { Broadcast } from 'svelar/broadcasting';
import broadcastingConfig from '../config/broadcasting.js';

Broadcast.configure(broadcastingConfig);
```

In Docker Compose the app gets `PUSHER_HOST=soketi` automatically, so Soketi works without any `.env` changes.

### Client-Side Setup

The generated `src/lib/broadcasting.ts` initializes the Pusher connection:

```typescript
import { usePusher } from 'svelar/broadcasting/client';

export const echo = usePusher({
  key: import.meta.env.VITE_PUSHER_KEY ?? 'svelar-key',
  wsHost: import.meta.env.VITE_PUSHER_HOST ?? 'localhost',
  wsPort: Number(import.meta.env.VITE_PUSHER_PORT ?? 6001),
  forceTLS: false,
  authEndpoint: '/api/broadcasting/auth',
});

export { useChannel, usePresenceChannel, leaveChannel } from 'svelar/broadcasting/client';
```

Import it in your root layout:

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import '$lib/broadcasting';
</script>
```

### Subscribing to Channels (Client-Side)

Svelar provides reactive helpers that wrap pusher-js with a clean, chainable API:

```svelte
<script>
  import { useChannel, usePresenceChannel } from '$lib/broadcasting';

  // Private channel
  const orders = useChannel('private-orders.123');
  orders.listen('OrderShipped', (data) => {
    console.log('Shipped:', data);
  });

  // Presence channel with member tracking
  let members = $state([]);

  const chat = usePresenceChannel('presence-chat.5');
  chat
    .here((m) => { members = m; })
    .joining((m) => { members = [...members, m]; })
    .leaving((m) => { members = members.filter(x => x.id !== m.id); })
    .listen('new-message', (data) => {
      console.log(data.text);
    });

  // Whisper (client events) — e.g. typing indicators
  function onTyping() {
    chat.whisper('typing', { name: 'Alice' });
  }
</script>

<p>Online: {members.length}</p>
```

Clean up when the component unmounts:

```svelte
<script>
  import { onDestroy } from 'svelte';
  import { useChannel, leaveChannel } from '$lib/broadcasting';

  const channel = useChannel('private-orders.123');
  channel.listen('OrderShipped', handleShipped);

  onDestroy(() => leaveChannel('private-orders.123'));
</script>
```

### SSE Client (No pusher-js)

For the SSE driver, use `useSSE` instead — no external dependencies:

```svelte
<script>
  import { useSSE } from 'svelar/broadcasting/client';

  const channel = useSSE('private-orders.123');
  channel.listen('OrderShipped', (data) => {
    console.log('Shipped!', data);
  });

  onDestroy(() => channel.close());
</script>
```

### Channel Types

Svelar supports three channel types, determined by the channel name prefix:

**Public channels** — anyone can subscribe, no authorization needed:

```typescript
Broadcast.to('updates').send('new-post', { title: 'Hello World' });
```

**Private channels** — prefixed with `private-`, require user authorization:

```typescript
Broadcast.to('private-orders.123').send('OrderShipped', { trackingId: 'XYZ' });
```

**Presence channels** — prefixed with `presence-`, require authorization + track who's online:

```typescript
Broadcast.to('presence-chat.5').send('new-message', { text: 'Hello!' });
```

### Channel Authorization

Generate a channel authorization file:

```bash
npx svelar make:channel Order
npx svelar make:channel Chat --presence
```

This creates files in `src/lib/channels/`. Register them in `src/app.ts`:

```typescript
import { Broadcast } from 'svelar/broadcasting';

// Private channel — return true/false
Broadcast.channel('private-orders.{orderId}', async (user, { orderId }) => {
  const order = await Order.findOrFail(orderId);
  return order.user_id === user.id;
});

// Presence channel — return false to deny, or user info object
Broadcast.channel('presence-chat.{roomId}', async (user, { roomId }) => {
  const room = await ChatRoom.findOrFail(roomId);
  if (!room.hasMember(user.id)) return false;
  return { id: user.id, name: user.name, avatar: user.avatar };
});
```

The scaffolded auth route at `src/routes/api/broadcasting/auth/+server.ts` handles Pusher/Soketi channel authentication automatically — it calls `Broadcast.authenticatePusher()` which checks your registered channel callbacks and generates the HMAC-SHA256 signature pusher-js expects.

### Broadcasting Events (Server-Side)

Two ways to broadcast from your server code:

```typescript
import { Broadcast } from 'svelar/broadcasting';

// Shorthand — send to a channel directly
await Broadcast.to('private-orders.123').send('OrderShipped', { orderId: 123 });

// Fluent builder — for multiple channels
await Broadcast.event('OrderShipped', { orderId: 123 })
  .on('private-orders.123')
  .on('notifications')
  .send();

// Send to a specific user within a channel
Broadcast.to('notifications', userId).send('new-message', { text: 'Hello!' });
```

### Presence Channel Members

With the SSE driver, you can query who's online server-side:

```typescript
const members = Broadcast.members('presence-chat.5');
// → [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
```

### Soketi in Docker

Soketi is included in the default Docker Compose generated by `make:docker`. The app service automatically gets `PUSHER_HOST=soketi` and `PUSHER_PORT=6001`, and Soketi starts with the default app credentials matching the config preset (`svelar-key` / `svelar-secret` / `svelar-app`). For production, set real credentials in your `.env`:

```bash
PUSHER_KEY=your-production-key
PUSHER_SECRET=your-production-secret
PUSHER_APP_ID=your-app-id
```

And expose the same key to the client via Vite env vars:

```bash
VITE_PUSHER_KEY=your-production-key
VITE_PUSHER_HOST=your-soketi-host.com
VITE_PUSHER_PORT=6001
```

## Storage

Manage file storage across local filesystem and S3-compatible object storage (RustFS, MinIO, AWS S3).

### Configuration

```typescript
import { Storage } from 'svelar/storage';

Storage.configure({
  default: 'local',
  disks: {
    local: {
      driver: 'local',
      root: './storage/uploads',
    },
    s3: {
      driver: 's3',
      bucket: process.env.S3_BUCKET ?? 'svelar',
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'svelar',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'svelarsecret',
      forcePathStyle: true,  // Required for RustFS/MinIO
    },
  },
});
```

### Using Storage

```typescript
import { Storage } from 'svelar/storage';

const disk = Storage.disk('local');

// Store file
await disk.put('avatars/user1.jpg', fileBuffer);

// Get file
const file = await disk.get('avatars/user1.jpg');

// Delete file
await disk.delete('avatars/user1.jpg');

// Check existence
const exists = await disk.exists('avatars/user1.jpg');

// List files
const files = await disk.files('avatars/');

// Get public URL
const url = disk.url('avatars/user1.jpg');
```

### S3 / RustFS Object Storage

Svelar includes a full S3-compatible storage driver that works with [RustFS](https://github.com/rustfs/rustfs), MinIO, AWS S3, and any S3-compatible service. RustFS is included by default in `docker-compose` when you run `npx svelar make:docker`.

```bash
# Install the S3 SDK (peer dependency)
npm install @aws-sdk/client-s3

# Optional: for pre-signed temporary URLs
npm install @aws-sdk/s3-request-presigner
```

S3 disks support all the same methods as local disks, plus additional features:

```typescript
// Ensure bucket exists (auto-creates if missing — great for RustFS/MinIO)
await Storage.s3Disk('s3').ensureBucket();

// Generate a pre-signed temporary URL (expires in 1 hour)
const tempUrl = await Storage.s3Disk('s3').temporaryUrl('invoices/001.pdf', 3600);

// Switch default disk to S3 for cloud-first deployments
Storage.configure({ default: 's3', disks: { ... } });
```

In Docker, RustFS runs on port 9000 (S3 API) and 9001 (web console). The app service gets `S3_ENDPOINT=http://rustfs:9000` and `STORAGE_DISK=s3` automatically.

> **RustFS Web Console**: Access at `http://localhost:9001` to browse buckets, upload files, and manage storage visually.

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

Each of these generates a file with sensible defaults and `env()` calls for environment variables. You can also create custom config files:

```bash
npx svelar make:config payments
```

### Config Files

Config files live in `config/` and export a default object. Use the `env()` helper to read environment variables with type casting and defaults:

```typescript
// config/app.ts
import { env } from 'svelar/config';

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

```typescript
// config/database.ts
import { env } from 'svelar/config';

export default {
  default: env('DB_DRIVER', 'sqlite'),
  connections: {
    sqlite: {
      driver: 'sqlite' as const,
      filename: env('DB_PATH', 'database.db'),
    },
    postgres: {
      driver: 'postgresql' as const,
      host: env('DB_HOST', 'localhost'),
      port: env<number>('DB_PORT', 5432),
      database: env('DB_NAME', 'svelar'),
      user: env('DB_USER', 'postgres'),
      password: env('DB_PASSWORD', ''),
    },
  },
};
```

### Loading Configuration

Load all config files from the directory at application startup in `src/app.ts`:

```typescript
// src/app.ts
import { config } from 'svelar/config';

// Load all config/*.ts files — each filename becomes a top-level key
await config.loadFromDirectory('./config');

// Now use configuration throughout your app
```

Or load config manually if you prefer:

```typescript
import { config, env } from 'svelar/config';

config.load({
  app: {
    name: env('APP_NAME', 'Svelar'),
    debug: env<boolean>('APP_DEBUG', false),
  },
  database: {
    default: env('DB_DRIVER', 'sqlite'),
  },
});
```

### Using Configuration

Access values anywhere using dot notation:

```typescript
import { config } from 'svelar/config';

// Get a value
const appName = config.get('app.name');
const dbDriver = config.get('database.default');
const smtpHost = config.get('mail.smtp.host');

// Get with a fallback default
const debug = config.get('app.debug', false);
const port = config.get<number>('database.connections.postgres.port', 5432);

// Check if a key exists
if (config.has('cache.stores.redis')) {
  // Redis cache is configured
}

// Set a value at runtime
config.set('app.maintenance', true);

// Get all configuration
const allConfig = config.all();
```

### The env() Helper

The `env()` function reads environment variables with automatic type casting:

```typescript
import { env } from 'svelar/config';

env('APP_NAME')                    // string (default: '')
env('APP_NAME', 'Svelar')         // string with default
env<number>('DB_PORT', 5432)      // auto-casts '5432' → 5432
env<boolean>('APP_DEBUG', false)  // auto-casts 'true' → true, 'false' → false
```

Auto-cast rules: `'true'` → `true`, `'false'` → `false`, `'null'` → `null`, numeric strings → `number`, everything else → `string`.

## Container & Service Providers

The IoC container manages application dependencies.

### Service Providers

```typescript
import { ServiceProvider } from 'svelar/container';

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
import { container } from 'svelar/container';

// Bind dependencies
container.bind('pdf', () => new PdfGenerator());
container.singleton('auth', () => new AuthManager());

// Make dependencies
const pdf = container.make('pdf');
const auth = container.make('auth');

// Check if bound
if (container.has('pdf')) {
  // ...
}

// Get all bound services
const services = container.bindings();
```

## Environment Variables

Access environment variables safely:

```typescript
import { env } from 'svelar/config';

const appKey = env('APP_KEY');
const dbHost = env('DB_HOST', 'localhost');
const debug = env('APP_DEBUG') === 'true';

// Type casting
const port = env.int('DB_PORT', 5432);
const timeout = env.float('REQUEST_TIMEOUT', 30.5);
const enabled = env.bool('FEATURE_ENABLED', false);
```

## Error Handling

Handle errors gracefully across your application.

### Error Handler

```typescript
import { ErrorHandler } from 'svelar/errors';

ErrorHandler.configure({
  render: (error, event) => {
    console.error('Unhandled error:', error);
    return new Response('Internal Server Error', { status: 500 });
  },
  report: (error) => {
    // Send to error tracking service
    console.error('Error:', error.message);
  },
});
```

### Throwing Errors

```typescript
import { abort, abortIf, abortUnless, ModelNotFoundError } from 'svelar/errors';

// Throw 404
abort(404, 'Resource not found');

// Conditional abort
abortIf(!user, 401, 'Unauthenticated');
abortUnless(isAdmin, 403, 'Forbidden');

// Model not found (throws 404)
const user = await User.findOrFail(1);

// Custom error
throw new ModelNotFoundError('User not found');
```

## Best Practices Summary

1. **Cache strategically** - Cache expensive queries and computed data
2. **Use events for loose coupling** - Decouple components with events
3. **Log important events** - Track errors, important actions, performance
4. **Queue slow tasks** - Use jobs for email, processing, API calls
5. **Validate input** - Always validate with FormRequest or Zod
6. **Handle errors gracefully** - Return appropriate HTTP status codes
7. **Use transactions** - Wrap multi-step operations in transactions
8. **Monitor your app** - Set up logging, error tracking, and metrics
9. **Secure sensitive data** - Hash passwords, use HTTPS, validate input
10. **Test thoroughly** - Unit test services, integration test controllers

## UUIDv7 & ULID

Svelar provides built-in generators for modern, time-sortable identifiers. Both are available from `svelar/support`.

### UUIDv7

UUIDv7 (RFC 9562) embeds a Unix timestamp in the first 48 bits, making IDs time-sortable while remaining globally unique. This is the recommended UUID version for database primary keys — unlike UUIDv4, rows insert in chronological order which keeps B-tree indexes efficient.

```typescript
import { uuidv7, isUuidv7, uuidv7Timestamp } from 'svelar/support';

const id = uuidv7();
// → '019503a4-6b2c-7a1e-8f3d-4a2b1c0d9e8f'

isUuidv7(id);
// → true

uuidv7Timestamp(id);
// → Date object of when the ID was created
```

Use it as a primary key in your migrations:

```typescript
async up() {
  await this.schema.createTable('orders', (table) => {
    table.uuid('id').primary();  // UUIDv7 as primary key
    table.string('status');
    table.timestamps();
  });
}
```

Then generate values in your model:

```typescript
import { Model } from 'svelar/orm';
import { uuidv7 } from 'svelar/support';

export class Order extends Model {
  static table = 'orders';
  static primaryKey = 'id';
  static incrementing = false;  // Not auto-incrementing

  static boot() {
    this.creating((order) => {
      if (!order.id) order.id = uuidv7();
    });
  }
}
```

### ULID

ULIDs are 26-character Crockford Base32 strings that are lexicographically sortable by creation time. They're URL-safe, case-insensitive, and encode 48 bits of timestamp + 80 bits of randomness.

```typescript
import { ulid, isUlid, ulidTimestamp } from 'svelar/support';

const id = ulid();
// → '01ARYZ6S41TSV4RRFFQ69G5FAV'

isUlid(id);
// → true

ulidTimestamp(id);
// → Date object of when the ID was created
```

Use the `ulid()` column type in migrations:

```typescript
async up() {
  await this.schema.createTable('events', (table) => {
    table.ulid('id').primary();  // ULID as primary key
    table.string('type');
    table.jsonb('payload');      // JSONB for structured data
    table.timestamps();
  });
}
```

### JSONB Columns

Use `jsonb()` when you explicitly want JSONB storage on PostgreSQL. On MySQL it maps to JSON, and on SQLite it falls back to TEXT. Note that `json()` also maps to JSONB on PostgreSQL automatically.

```typescript
async up() {
  await this.schema.createTable('settings', (table) => {
    table.increments('id');
    table.jsonb('preferences');   // Explicit JSONB
    table.json('metadata');       // Also JSONB on PostgreSQL
    table.timestamps();
  });
}
```

## Custom CLI Commands

Create your own CLI commands, just like Laravel's `php artisan make:command`:

```bash
npx svelar make:command SyncUsers
```

This creates `src/lib/commands/SyncUsersCommand.ts`:

```typescript
import { Command } from 'svelar/cli';

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
    await this.bootstrap(); // Initialize database

    this.info(`Syncing users from ${source}...`);

    if (flags.force) {
      this.warn('Running full sync (this may take a while).');
    }

    const limit = parseInt(flags.limit);
    // ... your sync logic here

    this.success(`Synced ${limit} users.`);
  }
}
```

Run it:

```bash
npx svelar app:sync-users api --force --limit=50
```

Custom commands are auto-discovered from `src/lib/commands/` — no registration needed. Each file should export a class that extends `Command` from `svelar/cli`.

### Specifying the Command Name

By default, `make:command` derives the command name from the class name using `app:` prefix and kebab-case. Use the `--command` flag to set a custom name:

```bash
npx svelar make:command ImportProducts --command=import:products
```

### Available Helpers

Inside your command's `handle()` method, you have access to these output helpers:

```typescript
this.info('Informational message');     // Blue text
this.success('Success message');        // Green checkmark
this.warn('Warning message');           // Yellow text
this.error('Error message');            // Red text
this.log('Plain message');              // Standard output
this.newLine();                         // Blank line
this.table(['Name', 'Email'], [        // Formatted table
  ['Alice', 'alice@example.com'],
  ['Bob', 'bob@example.com'],
]);
```

Call `this.bootstrap()` to initialize the database connection, giving you access to models and queries inside your command.

## PDF Generation (Gotenberg)

Svelar includes a built-in PDF module powered by Gotenberg — a Docker-based API for converting HTML, URLs, Markdown, and office documents to PDF. No native binaries or system dependencies required in your Node.js app; all heavy lifting happens in the Gotenberg container.

### Setup

Gotenberg is included in the default `docker-compose.yml` generated by `make:docker`. If you want to run it standalone:

```bash
docker run -d -p 3001:3000 gotenberg/gotenberg:8
```

Configure the connection in your app:

```typescript
// src/app.ts
import { PDF } from 'svelar/pdf';

PDF.configure({
  url: process.env.GOTENBERG_URL ?? 'http://localhost:3001',
  timeout: 60_000,
});
```

In Docker Compose the app connects to Gotenberg at `http://gotenberg:3000` automatically via the `GOTENBERG_URL` environment variable.

### HTML to PDF

```typescript
import { PDF } from 'svelar/pdf';

// Simple conversion
const buffer = await PDF.html('<h1>Invoice #1234</h1><p>Total: $99.00</p>').generate();

// With options
const buffer = await PDF.html(invoiceTemplate)
  .margins({ top: '1in', bottom: '1in', left: '0.75in', right: '0.75in' })
  .landscape()
  .header('<div style="font-size:10px; text-align:center">My Company</div>')
  .footer('<div style="font-size:10px; text-align:center">Page <span class="pageNumber"></span></div>')
  .printBackground()
  .generate();
```

### URL to PDF

```typescript
const buffer = await PDF.url('https://example.com/report')
  .margins({ top: '20mm', bottom: '20mm' })
  .waitDelay('3s')                         // Wait for JS to render
  .waitForExpression('window.ready === true') // Or wait for a condition
  .httpHeaders({ Authorization: 'Bearer ...' })
  .generate();
```

### Markdown to PDF

```typescript
const buffer = await PDF.markdown('# Hello World\n\nThis is **bold**.')
  .margins({ top: '1in', bottom: '1in' })
  .generate();

// With a custom HTML wrapper (use {{ toHTML "file.md" }} as placeholder)
const buffer = await PDF.markdown(content, `
  <!DOCTYPE html>
  <html>
  <head>
    <style>body { font-family: sans-serif; }</style>
  </head>
  <body>{{ toHTML "file.md" }}</body>
  </html>
`).generate();
```

### Office Documents to PDF

Convert Word, Excel, PowerPoint, and OpenDocument files via LibreOffice:

```typescript
// From file path
const buffer = await PDF.office('/path/to/report.docx').generate();

// From buffer (e.g. uploaded file)
const buffer = await PDF.office(uploadedFile.buffer, 'report.docx').generate();

// Multiple files merged into one PDF
const buffer = await PDF.office('/path/to/cover.docx')
  .addFile('/path/to/appendix.xlsx')
  .generate();
```

Supported formats: `.docx`, `.doc`, `.xlsx`, `.xls`, `.pptx`, `.ppt`, `.odt`, `.ods`, `.odp`, `.rtf`, `.txt`, `.html`, `.csv`.

### Merging PDFs

```typescript
// Merge existing PDF files
const merged = await PDF.merge()
  .addPdfFile('/path/to/cover.pdf')
  .addPdfFile('/path/to/content.pdf')
  .addPdfFile('/path/to/appendix.pdf')
  .generate();

// Merge HTML pages into one PDF
const report = await PDF.merge()
  .addHtml('<h1>Cover Page</h1>')
  .addHtml(tableOfContents)
  .addHtml(mainContent)
  .generate();

// Mix HTML and existing PDFs
const combined = await PDF.merge()
  .addHtml('<h1>New Cover</h1>')
  .addPdfFile('/path/to/existing-report.pdf')
  .generate();
```

### Screenshots

Gotenberg can also capture screenshots of HTML or URLs:

```typescript
// Screenshot of HTML
const png = await PDF.screenshotHtml('<div style="background:red; width:800px; height:600px">Hello</div>')
  .format('png')
  .viewport(1920, 1080)
  .generate();

// Screenshot of a URL
const jpg = await PDF.screenshotUrl('https://example.com')
  .format('jpeg')
  .quality(85)
  .clip('#main-content')  // Capture only a specific element
  .generate();
```

### PDF/A Compliance

For archival purposes, request PDF/A format:

```typescript
const buffer = await PDF.html(content)
  .pdfFormat('PDF/A-2b')
  .generate();
```

### In a Controller

```typescript
import { Controller } from 'svelar';
import { PDF } from 'svelar/pdf';

export class InvoiceController extends Controller {
  async download() {
    const invoice = await Invoice.findOrFail(this.params.id);

    const html = renderInvoiceTemplate(invoice);
    const buffer = await PDF.html(html)
      .margins({ top: '1in', bottom: '1in' })
      .footer('<div style="text-align:center; font-size:9px">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>')
      .generate();

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${invoice.number}.pdf"`,
      },
    });
  }
}
```

### Save to File

Use `.store()` to generate and save in one call:

```typescript
const buffer = await PDF.html(content)
  .margins({ top: '1in', bottom: '1in' })
  .store('storage/reports/monthly-report.pdf');
```

### Async Generation (Webhooks)

For large files or batch processing, use Gotenberg's webhook mode. Instead of waiting for the PDF, Gotenberg returns `204 No Content` immediately and POSTs the result to your webhook URL when done:

```typescript
// Fire and forget — Gotenberg calls your webhook when done
await PDF.html(largeReport)
  .webhook({
    url: 'https://myapp.com/api/pdf/webhook',
    errorUrl: 'https://myapp.com/api/pdf/webhook-error',
    method: 'POST',
    extraHeaders: { Authorization: 'Bearer secret-token' },
  })
  .generateAsync();
```

Create a webhook receiver route to handle the result:

```typescript
// src/routes/api/pdf/webhook/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Broadcast } from 'svelar/broadcasting';

export const POST: RequestHandler = async ({ request }) => {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/pdf')) {
    // Success: Gotenberg sent the PDF
    const buffer = Buffer.from(await request.arrayBuffer());
    const meta = request.headers.get('x-svelar-pdf-meta');
    const parsed = meta ? JSON.parse(meta) : {};

    // Save the file
    const outputPath = parsed.outputPath ?? `storage/pdfs/${Date.now()}.pdf`;
    mkdirSync('storage/pdfs', { recursive: true });
    writeFileSync(outputPath, buffer);

    // Notify the client via broadcasting (optional)
    if (parsed.channel) {
      await Broadcast.to(parsed.channel).send('PdfReady', {
        path: outputPath,
        size: buffer.length,
      });
    }
  }

  return new Response(null, { status: 200 });
};
```

Error webhook receiver:

```typescript
// src/routes/api/pdf/webhook-error/+server.ts
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text();
  console.error('[PDF Webhook Error]', body);
  return new Response(null, { status: 200 });
};
```

You can also set a default webhook URL in `PDF.configure()` so all builders use it:

```typescript
PDF.configure({
  url: process.env.GOTENBERG_URL,
  webhookUrl: 'https://myapp.com/api/pdf/webhook',
  webhookErrorUrl: 'https://myapp.com/api/pdf/webhook-error',
});
```

### Queue-Based PDF Generation

For the best of both worlds — non-blocking requests + reliable retries — dispatch PDF generation as a queue job:

```typescript
import { PDF } from 'svelar/pdf';

// Dispatch to background worker — returns immediately
await PDF.dispatch({
  type: 'html',
  content: invoiceHtml,
  outputPath: `storage/invoices/inv-${invoice.id}.pdf`,
  options: {
    margins: { top: '1in', bottom: '1in' },
    landscape: false,
  },
  // Optional: broadcast when done so the client knows
  broadcastEvent: 'PdfReady',
  broadcastChannel: `private-user.${userId}`,
  meta: { invoiceId: invoice.id },
});
```

The `GeneratePdfJob` handles the generation in a worker process. Register it once in `src/app.ts`:

```typescript
import { Queue } from 'svelar/queue';
import { GeneratePdfJob } from 'svelar/pdf';

Queue.register(GeneratePdfJob);
```

You can also combine queue + webhook — the job dispatches to Gotenberg in webhook mode, and the webhook receiver handles the result:

```typescript
await PDF.dispatch({
  type: 'url',
  content: 'https://internal-app.com/big-report',
  webhook: {
    url: 'https://myapp.com/api/pdf/webhook',
    errorUrl: 'https://myapp.com/api/pdf/webhook-error',
  },
  meta: { reportId: 42, userId: user.id },
});
```

### Remote Files (downloadFrom)

Instead of uploading files to Gotenberg, you can tell it to fetch them from remote URLs (S3, Azure Blob, CDN, etc.):

```typescript
// Convert a file from S3 without downloading it first
const buffer = await PDF.office()
  .downloadFrom([
    {
      url: 'https://s3.amazonaws.com/mybucket/report.docx',
      extraHttpHeaders: { 'X-Api-Key': 'my-s3-key' },
    },
  ])
  .generate();

// Multiple remote files merged into one PDF
const buffer = await PDF.office()
  .downloadFrom([
    { url: 'https://cdn.example.com/cover.docx' },
    { url: 'https://cdn.example.com/appendix.xlsx' },
  ])
  .generate();
```

The remote server must return a `Content-Disposition` header with a `filename` parameter.

### Health Check

Verify Gotenberg is reachable from your app:

```typescript
const health = await PDF.health();
// { status: 'up', details: { chromium: { status: 'up' }, libreoffice: { status: 'up' } } }
```

## Admin Dashboard

Scaffold a production-ready admin dashboard with system monitoring:

```bash
npx svelar make:dashboard
```

This creates API routes (`/api/admin/*`) and a dashboard page with system health, queue monitoring, scheduler management, and log viewing.

### Dashboard Configuration

Configure the dashboard in your `app.ts`:

```typescript
import { configureDashboard } from 'svelar/dashboard';
import { JobMonitor } from 'svelar/queue/JobMonitor';
import { ScheduleMonitor } from 'svelar/scheduler/ScheduleMonitor';
import { LogViewer } from 'svelar/logging/LogViewer';

// Configure JobMonitor with your queue connection
JobMonitor.configure({
  driver: process.env.QUEUE_DRIVER ?? 'sync',
  default: process.env.QUEUE_DRIVER ?? 'sync',
  connections: {
    sync: { driver: 'sync' },
    redis: {
      driver: 'redis',
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  },
});

// ScheduleMonitor is configured automatically when you use the Scheduler
// LogViewer collects entries automatically from the logging system

configureDashboard({ enabled: true, prefix: '/admin' });
```

### Dashboard API Endpoints

The `make:dashboard` command scaffolds these SvelteKit API routes:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/health` | System health (uptime, memory, node version) |
| GET | `/api/admin/queue` | List jobs with filtering (`?status=failed&limit=50`) |
| GET | `/api/admin/queue/[id]` | Get a single job's details |
| POST | `/api/admin/queue/[id]/retry` | Retry a failed job |
| DELETE | `/api/admin/queue/[id]` | Remove a job |
| GET | `/api/admin/scheduler` | List all scheduled tasks |
| POST | `/api/admin/scheduler/[name]/run` | Manually trigger a task |
| POST | `/api/admin/scheduler/[name]/toggle` | Enable/disable a task |
| GET | `/api/admin/logs` | Query logs with filtering (`?level=error&search=timeout`) |
| GET | `/api/admin/logs/tail` | SSE stream of live logs |
| GET | `/api/admin/stats` | Combined dashboard stats |

### Using the Monitors Directly

You can use the monitor singletons from anywhere in your server code:

```typescript
import { JobMonitor } from 'svelar/queue/JobMonitor';
import { ScheduleMonitor } from 'svelar/scheduler/ScheduleMonitor';
import { LogViewer } from 'svelar/logging/LogViewer';

// Queue job counts
const counts = await JobMonitor.getCounts('default');
// { waiting: 5, active: 2, completed: 100, failed: 3, delayed: 0, total: 110 }

// List failed jobs
const failedJobs = await JobMonitor.listJobs({ status: 'failed', limit: 10 });

// Retry a job
await JobMonitor.retryJob('job-id-123');

// Queue health metrics
const health = await JobMonitor.getHealth();
// { driver: 'redis', queues: {...}, failureRate: 2.5, throughput: 150 }

// Scheduler tasks
const tasks = ScheduleMonitor.listTasks();
// [{ name: 'CleanupTokens', expression: '0 0 * * *', humanReadable: 'Daily at midnight', ... }]

// Run a task manually
await ScheduleMonitor.runTask('CleanupTokens');

// Log stats
const stats = LogViewer.getStats();
// { totalEntries: 1500, byLevel: { info: 1200, warn: 250, error: 50 }, byChannel: {...} }

// Query logs
const errors = LogViewer.query({ level: 'error', limit: 20 });

// Live tail (for SSE endpoints)
const unsubscribe = LogViewer.tail((entry) => {
  console.log(`${entry.level}: ${entry.message}`);
});
```

### Protecting Dashboard Routes

Each scaffolded route includes a `// TODO: Add admin middleware check` placeholder. Replace it with your auth logic:

```typescript
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }
  // ... rest of handler
};
```

Access the dashboard at `/admin` (or `/admin/dashboard` if using the scaffolded page).

## Plugin System

Plugins extend Svelar with new capabilities. Install plugins from npm:

```typescript
import { PluginManager } from 'svelar/plugins';

const plugins = new PluginManager(app);
plugins.use(new StripePlugin());
plugins.use(new PostmarkPlugin());
await plugins.boot();
```

**Creating Plugins**: Extend the `Plugin` base class and override:
- `register()` — Register services and config
- `boot()` — Initialize after all plugins load
- `migrations()` — Return migration file names
- `config()` — Define default config

**Publishing Plugins**: Use `plugin:publish <name>` to export config and migrations to your app.

## Audit Logging

Track user actions and system changes:

```typescript
import { Audit } from 'svelar/audit';

// Log an action
await Audit.log('user:created', {
  userId: user.id,
  email: user.email,
  ipAddress: event.getClientAddress(),
});

// Query audit entries
const entries = await Audit.query()
  .where('action', 'user:created')
  .limit(10)
  .get();
```

Use the `@auditable()` decorator on models to track all changes automatically.

## API Key Management

Secure token-based authentication:

```typescript
import { ApiKey } from 'svelar/api-keys';

// Create a key
const key = await ApiKey.create('My Integration', ['users:read', 'posts:write']);

// Validate requests
const middleware = ApiKeyMiddleware;
// Key sent as: Authorization: Bearer sk_live_xxx
```

Keys are hashed and can be revoked at any time.

## Outgoing Webhooks

Send events to external services:

```typescript
import { Webhook } from 'svelar/webhooks';

// Register an endpoint
await Webhook.register('https://example.com/events', {
  events: ['user:created', 'order:shipped'],
});

// Dispatch an event
await Webhook.dispatch('user:created', { id: user.id, email: user.email });
```

Events are signed with HMAC and retried automatically.

## Teams & Workspaces

Multi-tenant team management:

```typescript
import { Team } from 'svelar/teams';

// Create a team
const team = await Team.create({
  name: 'Acme Corp',
  ownerId: user.id,
});

// Invite members
await team.invite('member@example.com', 'editor');

// Check permissions
if (user.can('edit', team)) {
  // Allow action
}
```

Supports role-based access control (owner, admin, member, viewer).

## Email Templates

Manage and render email templates:

```typescript
import { EmailTemplate } from 'svelar/email-templates';

// Register a template
await EmailTemplate.register('welcome', {
  subject: 'Welcome to {{ appName }}',
  body: `<p>Hello {{ userName }},</p>...`,
});

// Render and send
const html = await EmailTemplate.render('welcome', {
  appName: 'My App',
  userName: user.name,
});
```

Built-in templates for password reset, invitations, and notifications.

## File Uploads

Track and serve user-uploaded files:

```typescript
import { Upload } from 'svelar/uploads';

// Store a file
const upload = await Upload.store(formFile, {
  disk: 'local',
  path: `users/${user.id}`,
  visibility: 'private',
});

// Generate download URL
const url = await upload.url({ expiresIn: 3600 });
```

Metadata is tracked automatically (size, mime type, hash).

## Billing with Stripe

Add subscription billing via the `svelar-stripe` plugin:

```bash
npm install svelar-stripe
npx svelar plugin:publish svelar-stripe
```

Then configure:

```typescript
import { Stripe } from 'svelar/stripe';

const subscription = await Stripe.createSubscription(user, {
  plan: 'pro',
  paymentMethod: pmId,
});
```

Handles subscriptions, invoices, refunds, and webhook events.

## Email Providers

Switch between email providers (Postmark, Resend, SMTP):

```bash
npm install svelar-postmark
# or
npm install svelar-resend
```

Then configure in `.env`:

```bash
MAIL_DRIVER=postmark
POSTMARK_TOKEN=your_token
```

All Mail operations use the configured driver automatically.

## Next Steps

- Explore the [svelar-example](../packages/svelar-example) app for real-world usage
- Read the [Architecture](./README.md) guide for design patterns
- Review the [API Reference](./README.md) for detailed documentation
- Build SaaS features with [SaaS Guide](./17-saas-guide.md)

---

**Svelar Additional Features Guide** © 2026
