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
  sessionLifetime: 60 * 60 * 24,             // idle lifetime
  sessionIdleLifetime: 60 * 60,              // optional distinct authenticated idle timeout
  sessionAbsoluteLifetime: 60 * 60 * 24 * 30, // hard maximum age
  sessionTouchOnActivity: true,              // do not renew on polling/SSE
  sessionTouchThrottle: 300,                 // touch at most every 5 minutes
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
      absoluteLifetime: 60 * 60 * 24 * 30,
      touchOnActivity: true,
      touchThrottle: 300,
      cookieName: 'svelar_session',   // Cookie name
    }),
  ],
});
```

### Sliding Sessions

Set `touchOnActivity: true` when you want sessions to slide based on real user activity. Svelar renews the store TTL for mutations and document navigations, but ignores SSE (`Accept: text/event-stream`) and polling-style requests. `X-Svelar-Session-Activity: false` can opt out; a client-supplied `true` cannot turn polling into human activity. For a trusted relevant server-side data load, call `event.locals.session.markActivity(true)`, or supply the manual middleware's `activity(ctx)` callback. Status/polling endpoints should call `markActivity(false)`.

Use `absoluteLifetime` for a hard cap that activity cannot extend. `touchThrottle` prevents every click or tab from writing the session store; the default is 300 seconds.

Activity policies require atomic `compareAndSwap` support in the session store. All built-in stores implement it; custom stores must implement it too. Concurrent requests merge their own changes rather than resurrecting a logged-out session or overwriting another tab. An expired idle/absolute session is destroyed, not renewed by polling or a late response. Regular cookies are session cookies unless configured otherwise; remembered logins intentionally get a bounded persistent cookie.

### Remember-Me And Expiry Warning

Configure `sessionRememberLifetime` and `sessionRememberAbsoluteLifetime` in `createSvelarApp`, or `rememberLifetime`/`rememberAbsoluteLifetime` in manual `SessionMiddleware`. Remember-me is unavailable unless configured. Login uses `auth.attempt(credentials, session, { remember: true })`; it rotates the session ID and resets timing from successful authentication. Absolute expiry still requires signing in again. Logout removes remember state and invalidates the stored session.

New apps ship a shared Zod/Valibot boolean `remember` field, inline Superforms validation, password visibility control, disabled/spinning submit state and an authenticated expiry warning. Set `SESSION_REMEMBER_LIFETIME=0` to hide/disable persistent sign-in. Session defaults are configurable in `.env`; regular and remembered idle/absolute limits are independent.

The generated `/api/auth/session` route binds `SessionActivityController`: GET returns `{ data: SessionActivityStatus, meta }` without touching the session; POST explicitly renews a still-valid authenticated session and requires same-origin CSRF. It does not extend absolute expiry. Unknown, forged or expired sessions return 401, not an anonymous renewal. Custom cookie/header names must be supplied to the controller and UI consistently.

`SessionWarning` from `@beeblock/svelar/ui` provides an accessible expiry dialog and a retryable renewal action. Its multitab bus only invalidates state: a tab cannot extend another tab's deadline by broadcasting a message. Only authenticated server responses update timing, with server-clock offset handling. It checks on visibility/warning boundaries, not continuous keep-alive polling. Mount it with the server's `session.getActivityStatus()` and the configured status/renew URLs; use `SessionActivityClient` directly for a custom presentation.

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
