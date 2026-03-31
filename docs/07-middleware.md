# Middleware

Learn how to create and use middleware to intercept and process requests.

## What is Middleware?

Middleware is a function that runs before your route handlers. It can inspect/modify requests, validate data, check authentication, log requests, rate limit, and more.

## Creating Middleware

```bash
npx svelar make:middleware CheckAdmin
```

This creates `src/lib/middleware/CheckAdmin.ts`:

```typescript
import { Middleware, type MiddlewareContext, type NextFunction } from '@beeblock/svelar/middleware';

export class CheckAdminMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    // Check if user is admin
    if (!ctx.event.locals.user?.isAdmin) {
      return new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Call next middleware/handler
    return next();
  }
}
```

## Middleware Structure

Every middleware extends the `Middleware` class and implements a `handle()` method:

```typescript
import { Middleware, type MiddlewareContext, type NextFunction } from '@beeblock/svelar/middleware';

export class MyMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    // Before: Inspect/modify request
    console.log('Request:', ctx.event.request.url);

    // Call next middleware/handler
    const response = await next();

    // After: Inspect/modify response
    console.log('Response status:', response?.status);

    return response;
  }
}
```

### MiddlewareContext

The context object provides access to the request:

```typescript
ctx.event              // SvelteKit RequestEvent
ctx.event.request      // Fetch API Request
ctx.event.params       // URL parameters
ctx.event.locals       // Shared locals object
ctx.event.cookies      // Cookie functions
ctx.event.url          // URL object
ctx.event.getClientAddress() // Client IP
```

## Quick Setup with createSvelarApp

The simplest way to set up the middleware pipeline is `createSvelarApp`. It auto-wires origin validation, rate limiting, CSRF, sessions, auth, error handling, and optionally i18n — all with sensible defaults:

```typescript
// src/hooks.server.ts
import { createSvelarApp } from '@beeblock/svelar/hooks';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getTextDirection } from '$lib/paraglide/runtime';
import { auth } from './app.js';

export const { handle, handleError } = createSvelarApp({
  auth,
  i18n: { paraglideMiddleware, getTextDirection },
});
```

You can customize every default:

```typescript
export const { handle, handleError } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY,
  sessionStore: new DatabaseSessionStore(),  // auto-creates sessions table
  sessionLifetime: 60 * 60 * 24 * 7, // 7 days
  rateLimit: 200,
  rateLimitWindow: 120_000,           // 2 minutes
  csrfPaths: ['/api/'],
  csrfExcludePaths: ['/api/webhooks'],
  authThrottleAttempts: 10,
  authThrottleDecay: 5,
  debug: true,
  i18n: { paraglideMiddleware, getTextDirection },
});
```

## Global Middleware (Manual Setup)

For full control, use `createSvelarHooks` to compose the pipeline manually:

```typescript
import { createSvelarHooks } from '@beeblock/svelar/hooks';
import { SessionMiddleware, DatabaseSessionStore } from '@beeblock/svelar/session';
import { AuthenticateMiddleware } from '@beeblock/svelar/auth';
import { RateLimitMiddleware, LoggingMiddleware, CorsMiddleware } from '@beeblock/svelar/middleware';
import { auth } from './app.js';

const sessionStore = new DatabaseSessionStore();  // auto-creates sessions table

export const handle = createSvelarHooks({
  middleware: [
    // 1. CORS (allow cross-origin requests)
    new CorsMiddleware({
      origin: process.env.CORS_ORIGIN || '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),

    // 2. Logging (log all requests)
    new LoggingMiddleware(),

    // 3. Session (read/write session cookies)
    new SessionMiddleware({
      store: sessionStore,
      secret: process.env.APP_KEY!,
      lifetime: 60 * 60 * 24,
    }),

    // 4. Auth (resolve authenticated user)
    new AuthenticateMiddleware(auth),

    // 5. Rate limiting (100 requests per minute per IP)
    new RateLimitMiddleware({ maxRequests: 100, windowMs: 60_000 }),
  ],
  onError: (error, event) => {
    console.error('[Svelar Error]', error);
  },
});
```

Middleware runs in order before reaching your route handler.

## Built-in Middleware

### SessionMiddleware

Manages session data via signed cookies:

```typescript
new SessionMiddleware({
  store: new DatabaseSessionStore(),  // or MemorySessionStore for dev
  secret: 'your-secret-key',
  lifetime: 60 * 60 * 24,           // 24 hours
  name: 'svelar_session',           // Cookie name
})
```

After this middleware, `event.locals.session` is available to get/set session data.

### AuthenticateMiddleware

Resolves authenticated user from session, JWT, or API token:

```typescript
import { AuthenticateMiddleware } from '@beeblock/svelar/auth';
import { auth } from './app.js';

new AuthenticateMiddleware(auth)
```

Sets `event.locals.user` to the User model (or null if not authenticated).

### RateLimitMiddleware

Rate limit requests by IP address:

```typescript
new RateLimitMiddleware({
  maxRequests: 100,     // Max requests
  windowMs: 60_000,     // Time window in milliseconds (1 minute)
  keyGenerator: (ctx) => ctx.event.getClientAddress(), // Custom key
  handler: (ctx) => {
    return new Response('Too many requests', { status: 429 });
  },
})
```

### LoggingMiddleware

Log all requests and responses:

```typescript
new LoggingMiddleware({
  level: 'info', // 'debug', 'info', 'warn', 'error'
  format: '[{method}] {path} -> {status}',
})
```

### CorsMiddleware

Enable Cross-Origin Resource Sharing:

```typescript
new CorsMiddleware({
  origin: '*',                                // or ['https://example.com']
  credentials: true,                         // Allow credentials
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-Total-Count'],         // Expose custom headers
  maxAge: 600,                               // Preflight cache (seconds)
})
```

#### Production CORS Configuration

> **Warning**: `origin: '*'` with `credentials: true` is invalid per the CORS spec — browsers will reject the response. Always specify explicit origins in production.

```typescript
// Production — explicit allowed origins
new CorsMiddleware({
  origin: [
    'https://myapp.com',
    'https://admin.myapp.com',
  ],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 86400, // Cache preflight for 24 hours
})

// Or use environment variable
new CorsMiddleware({
  origin: process.env.CORS_ORIGIN?.split(',') || ['https://myapp.com'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
})
```

#### Preflight Requests

Browsers send an `OPTIONS` preflight request before any "non-simple" request (e.g., `POST` with JSON body, custom headers). CorsMiddleware handles preflight automatically — it responds to `OPTIONS` with the configured CORS headers and a `204 No Content` status. No route handler is needed.

#### CORS Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `origin` | `string \| string[]` | `'*'` | Allowed origins |
| `credentials` | `boolean` | `false` | Allow cookies/auth headers |
| `allowMethods` | `string[]` | `['GET','POST','PUT','DELETE','OPTIONS']` | Allowed HTTP methods |
| `allowHeaders` | `string[]` | `['Content-Type','Authorization']` | Allowed request headers |
| `exposeHeaders` | `string[]` | `[]` | Headers the browser can read |
| `maxAge` | `number` | `600` | Preflight cache duration (seconds) |

### OriginMiddleware

Blocks cross-origin mutation requests (POST, PUT, PATCH, DELETE) that don't come from the same origin. This provides an extra layer of protection beyond CSRF tokens:

```typescript
import { OriginMiddleware } from '@beeblock/svelar/middleware';
```

How it works:
- **GET/HEAD/OPTIONS** requests pass through unconditionally
- **POST/PUT/PATCH/DELETE** requests must have an `Origin` or `Referer` header matching the app's host
- Requests with a `Bearer` token in the `Authorization` header are exempted (API clients don't send Origin headers)
- `createSvelarApp` enables OriginMiddleware automatically — no extra configuration needed

This is different from CORS (which controls what *other* sites can access) — OriginMiddleware controls what origins can *mutate* your data.

### SignatureMiddleware

Verify HMAC-signed API requests to prevent tampering and replay attacks. See [API Request Signatures](./06-authentication.md#api-request-signatures) for full documentation.

```typescript
import { SignatureMiddleware } from '@beeblock/svelar/middleware';

new SignatureMiddleware({
  secret: process.env.API_SIGNING_SECRET!,
  tolerance: 300,                    // 5 minute window
  onlyPaths: ['/api/partner/'],      // Only enforce on specific routes
})
```

### CsrfMiddleware

Protect against CSRF attacks:

```typescript
import { CsrfMiddleware } from '@beeblock/svelar/middleware';

new CsrfMiddleware({
  tokenLength: 32,
  headerName: 'X-CSRF-Token',
  cookieName: 'csrf_token',
})
```

## Custom Middleware Example

Here's a custom auth middleware from a scaffolded project:

```typescript
// src/lib/middleware/AuthMiddleware.ts
import { Middleware, type MiddlewareContext, type NextFunction } from '@beeblock/svelar/middleware';

export class AuthMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const token = ctx.event.request.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      return new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify token and load user
    // const user = await User.where('api_token', token).first();
    // if (!user) return new Response(...);
    // ctx.event.locals.user = user;

    return next();
  }
}
```

## Controller-Level Middleware

Apply middleware to specific controller methods:

```typescript
import { Controller } from '@beeblock/svelar/routing';
import { RequireAuthMiddleware } from '@beeblock/svelar/auth';

export class PostController extends Controller {
  constructor() {
    super();

    // Require auth for these methods only
    this.middleware('auth').only(['store', 'update', 'destroy']);

    // Or exclude methods
    this.middleware('auth').except(['index', 'show']);
  }

  async index(event: any) {
    // No auth required
    return this.json({ message: 'Public endpoint' });
  }

  async store(event: any) {
    // Auth required
    const user = event.locals.user;
    return this.created({ message: 'Created' });
  }
}
```

## Middleware Order

Middleware runs in the order you register them:

```typescript
export const handle = createSvelarHooks({
  middleware: [
    // 1. CORS runs first
    new CorsMiddleware(),

    // 2. Session runs second
    new SessionMiddleware({ store, secret, lifetime }),

    // 3. Auth runs third (can access session)
    new AuthenticateMiddleware(auth),

    // 4. Rate limit runs last
    new RateLimitMiddleware(),
  ],
});

// Request flow:
// CORS → Session → Auth → RateLimit → Route Handler
// Response flow:
// Route Handler → RateLimit → Auth → Session → CORS
```

## Modifying Request/Response

Middleware can modify both request and response:

```typescript
export class LoggingMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const start = Date.now();
    const path = ctx.event.url.pathname;
    const method = ctx.event.request.method;

    // Call next middleware/handler
    const response = await next();

    const duration = Date.now() - start;
    const status = response?.status || 200;

    console.log(`[${method}] ${path} -> ${status} (${duration}ms)`);

    return response;
  }
}
```

## Error Handling Middleware

Catch errors from downstream middleware and handlers:

```typescript
export class ErrorHandlingMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    try {
      return await next();
    } catch (error: any) {
      console.error('Error:', error);

      return new Response(JSON.stringify({
        message: 'Internal Server Error',
        error: error.message,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}
```

## Conditional Middleware

Run middleware conditionally based on route or method:

```typescript
export class AdminOnlyMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const isAdminRoute = ctx.event.url.pathname.startsWith('/admin');
    if (!isAdminRoute) {
      return next();
    }

    // Only check admin for /admin routes
    const user = ctx.event.locals.user;
    if (!user?.isAdmin) {
      return new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return next();
  }
}
```

## Complete Middleware Pipeline Example

Here's the complete setup from a scaffolded Svelar project using `createSvelarApp`:

```typescript
// src/hooks.server.ts
import { createSvelarApp } from '@beeblock/svelar/hooks';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getTextDirection } from '$lib/paraglide/runtime';
import { auth } from './app.js';

export const { handle, handleError } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY!,
  i18n: { paraglideMiddleware, getTextDirection },
});
```

This single call sets up: origin validation, rate limiting (100 req/min), CSRF protection on `/api/*`, sessions (24h lifetime), auth resolution, auth throttling (5 attempts/min on login), error handling, and i18n locale detection from URLs.

## Best Practices

1. **Keep middleware focused** - Each middleware should do one thing
2. **Order matters** - Dependencies go first (e.g., session before auth)
3. **Use controller middleware for authorization** - Apply auth checks at controller level
4. **Handle errors gracefully** - Return appropriate HTTP status codes
5. **Avoid middleware for everything** - Use services/actions for business logic
6. **Document your middleware** - Explain what each does and why it's there
7. **Test middleware** - Unit test middleware independently

## Next Steps

- Learn [Authentication](./06-authentication.md) to protect routes
- Explore [Services & Actions](./08-services-actions-repositories.md) for business logic
- Check [Controllers & Routing](./04-controllers-routing.md) to handle requests

---

**Svelar Middleware Guide** © 2026
