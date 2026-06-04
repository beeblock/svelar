# Session Management

Sessions store user data across requests using signed cookies.

### Session Middleware

The simplest way to configure sessions is via `createSvelarApp`:

```typescript
import { createSvelarApp } from '@beeblock/svelar/hooks';
import { DatabaseSessionStore } from '@beeblock/svelar/session';

export const { handle, handleError } = createSvelarApp({
  auth,
  sessionStore: new DatabaseSessionStore(),  // persistent sessions
});
```

For manual setup with `createSvelarHooks`:

```typescript
import { SessionMiddleware, DatabaseSessionStore } from '@beeblock/svelar/session';

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({
      store: new DatabaseSessionStore(),  // requires the sessions migration
      secret: process.env.APP_KEY!,
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
import { MemorySessionStore } from '@beeblock/svelar/session';

new SessionMiddleware({
  store: new MemorySessionStore(),
});
```

**DatabaseSessionStore** (production — survives server restarts):

```typescript
import { DatabaseSessionStore } from '@beeblock/svelar/session';

new SessionMiddleware({
  store: new DatabaseSessionStore('sessions'),
});
```

The `sessions` table is managed by Svelar core migrations. Works with SQLite, PostgreSQL, and MySQL.

**FileSessionStore** (simple persistent storage, no database needed):

```typescript
import { FileSessionStore } from '@beeblock/svelar/session';

new SessionMiddleware({
  store: new FileSessionStore(),  // defaults to storage/sessions/
});

// Or specify a custom directory
new SessionMiddleware({
  store: new FileSessionStore('/tmp/my-app-sessions'),
});
```

Each session is stored as a JSON file. Expired sessions are cleaned up on `gc()`. Good for single-server deployments without a database.

**RedisSessionStore** (high-performance, multi-server):

```typescript
import { RedisSessionStore } from '@beeblock/svelar/session';

// Auto-connect to localhost:6379
new SessionMiddleware({
  store: new RedisSessionStore(),
});

// Connect with a URL
new SessionMiddleware({
  store: new RedisSessionStore({ url: 'redis://user:pass@redis-host:6379' }),
});

// Bring your own ioredis client
import Redis from 'ioredis';
const redis = new Redis({ host: 'redis-host', port: 6379 });

new SessionMiddleware({
  store: new RedisSessionStore({ client: redis, prefix: 'myapp:session:' }),
});
```

Requires the `ioredis` package (`npm install ioredis`). Redis handles expiration natively via TTL — no garbage collection needed. Ideal for multi-server/load-balanced deployments.

> **Tip:** Use `MemorySessionStore` only for development. For production, choose based on your infrastructure:
> - **DatabaseSessionStore** — already using a database, simplest setup
> - **FileSessionStore** — single server, no database needed
> - **RedisSessionStore** — multi-server, best performance
