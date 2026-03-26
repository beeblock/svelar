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

Send real-time updates to connected clients using Server-Sent Events or WebSockets.

### Server-Sent Events (SSE)

```typescript
import { Broadcast } from 'svelar/broadcasting';

// Send to client
await Broadcast.to('user:1').emit('order:shipped', {
  order_id: 1,
  status: 'shipped',
});

// Broadcast to all
await Broadcast.broadcast().emit('announcement', {
  message: 'System maintenance scheduled',
});
```

### Client-side (SSE)

```javascript
// Subscribe to channel
const eventSource = new EventSource('/api/broadcast/subscribe?channel=user:1');

eventSource.addEventListener('order:shipped', (event) => {
  const data = JSON.parse(event.data);
  console.log('Order shipped:', data);
});

eventSource.addEventListener('error', () => {
  console.error('Connection error');
});
```

## Storage

Manage file storage across different disks.

### Configuration

```typescript
import { Storage } from 'svelar/storage';

Storage.configure({
  default: 'local',
  disks: {
    local: {
      driver: 'local',
      path: './storage/uploads',
    },
    s3: {
      driver: 's3',
      bucket: process.env.AWS_BUCKET,
      key: process.env.AWS_KEY,
      secret: process.env.AWS_SECRET,
      region: process.env.AWS_REGION,
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

## Configuration Management

Manage application configuration.

### Configuration Files

Create config files in `src/config/`:

```typescript
// src/config/app.ts
export default {
  name: 'Svelar App',
  env: process.env.NODE_ENV || 'development',
  debug: process.env.APP_DEBUG === 'true',
  url: process.env.APP_URL || 'http://localhost:5173',
};

// src/config/cache.ts
export default {
  default: 'memory',
  stores: {
    memory: { driver: 'memory' },
    file: { driver: 'file', path: './storage/cache' },
  },
};
```

### Using Configuration

```typescript
import { config } from 'svelar/config';

// Get config value
const appName = config('app.name');
const cacheDriver = config('cache.default');

// Get with default
const debug = config('app.debug', false);

// Check existence
if (config.has('cache.stores.redis')) {
  // ...
}
```

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

## Next Steps

- Explore the [svelar-example](../packages/svelar-example) app for real-world usage
- Read the [Architecture](./README.md) guide for design patterns
- Review the [API Reference](./README.md) for detailed documentation

---

**Svelar Additional Features Guide** © 2026
