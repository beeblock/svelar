# Hooks & App Bootstrap

Full docs: https://svelar.dev/docs/getting-started, https://svelar.dev/docs/installation

## Table of Contents
- [App Bootstrap (src/app.ts)](#app-bootstrap)
- [Hooks Setup (src/hooks.server.ts)](#hooks-setup)
- [With i18n (Paraglide)](#with-i18n)
- [Database Setup](#database-setup)
- [Environment Variables](#environment-variables)

## App Bootstrap

`src/app.ts` is the central configuration file. It initializes all services:

```typescript
import { db } from '@beeblock/svelar/database';
import { Auth } from '@beeblock/svelar/auth';
import { Hash } from '@beeblock/svelar/hashing';
import { Queue } from '@beeblock/svelar/queue';
import { Audit } from '@beeblock/svelar/audit';
import { ApiKey } from '@beeblock/svelar/api-keys';
import { Webhook } from '@beeblock/svelar/webhooks';
import { Team } from '@beeblock/svelar/teams';
import { Upload } from '@beeblock/svelar/uploads';
import { EmailTemplate } from '@beeblock/svelar/email-templates';
import { Broadcast } from '@beeblock/svelar/broadcasting';
import { configureDashboard } from '@beeblock/svelar/dashboard';
import { User } from '$lib/models/User.js';
import { SendWelcomeEmail } from '$lib/jobs/SendWelcomeEmail.js';

// Database
db.configure({ client: 'better-sqlite3', filename: './database.sqlite' });

// Hashing
Hash.configure({ driver: 'scrypt' });

// Auth
export const auth = Auth.configure({
  guard: 'session',
  model: User,
  jwt: {
    secret: process.env.APP_KEY ?? 'dev-secret',
    expiresIn: 3600,
    refreshTokens: true,
    refreshExpiresIn: 604800,
  },
});

// Queue
Queue.configure({ driver: 'database' });
Queue.register(SendWelcomeEmail);

// Services that auto-create tables
Audit.configure();
ApiKey.configure();
Webhook.configure();
Team.configure();
Upload.configure();
EmailTemplate.configure();

// Broadcasting (SSE)
Broadcast.configure({
  driver: 'sse',
  channels: {
    'private-user.*': (user, channelName) => {
      const userId = channelName.split('.')[1];
      return user && String(user.id) === userId;
    },
  },
});

// Admin dashboard
configureDashboard({ enabled: true, prefix: '/admin' });
```

## Hooks Setup

`src/hooks.server.ts` sets up the SvelteKit middleware chain:

### Simple (recommended)
```typescript
import { createSvelarApp } from '@beeblock/svelar/hooks';
import { DatabaseSessionStore } from '@beeblock/svelar/session';
import { auth } from './app';

export const { handle, handleError } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY,
  sessionStore: new DatabaseSessionStore(),
  sessionLifetime: 604800,          // 7 days
  rateLimit: 200,                   // requests per window
  rateLimitWindow: 60000,           // 1 minute
  csrfPaths: ['/api/'],             // protect these paths
  csrfExcludePaths: ['/api/webhooks', '/api/internal/'],
  authThrottleAttempts: 5,
  authThrottleDecay: 1,             // minutes
  debug: false,
});
```

### Advanced (manual middleware stack)
```typescript
import { createSvelarHooks } from '@beeblock/svelar/hooks';
import { CorsMiddleware, CsrfMiddleware, RateLimitMiddleware } from '@beeblock/svelar/middleware';
import { SessionMiddleware, DatabaseSessionStore } from '@beeblock/svelar/session';
import { AuthenticateMiddleware } from '@beeblock/svelar/auth';
import { auth } from './app';

export const handle = createSvelarHooks({
  middleware: [
    new CorsMiddleware({ origin: '*' }),
    new RateLimitMiddleware({ maxRequests: 200 }),
    new CsrfMiddleware({ excludePaths: ['/api/webhooks'] }),
    new SessionMiddleware({
      store: new DatabaseSessionStore(),
      secret: process.env.APP_KEY,
    }),
    new AuthenticateMiddleware(auth),
  ],
  namedMiddleware: {
    'auth': new RequireAuthMiddleware(),
    'admin': new GateMiddleware('admin'),
  },
});
```

## With i18n

When using Paraglide for internationalization:

```typescript
import { createSvelarApp } from '@beeblock/svelar/hooks';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getTextDirection } from '$lib/paraglide/runtime';
import { DatabaseSessionStore } from '@beeblock/svelar/session';
import { auth } from './app';

export const { handle, handleError } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY,
  sessionStore: new DatabaseSessionStore(),
  i18n: {
    paraglideMiddleware,
    getTextDirection,
  },
  csrfExcludePaths: ['/api/webhooks', '/api/internal/'],
});
```

## Database Setup

### SQLite (default)
```typescript
db.configure({ client: 'better-sqlite3', filename: './database.sqlite' });
```

### PostgreSQL
```typescript
db.configure({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'myapp',
  },
});
```

### MySQL
```typescript
db.configure({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'myapp',
  },
});
```

## Environment Variables

`.env` file at project root:

```bash
# App
APP_NAME=MyApp
APP_KEY=base64:your-secret-key
APP_URL=http://localhost:5173
APP_ENV=development
APP_DEBUG=true

# Database
DB_CLIENT=better-sqlite3
DB_FILENAME=./database.sqlite
# Or for Postgres/MySQL:
# DB_HOST=localhost
# DB_PORT=5432
# DB_USER=postgres
# DB_PASSWORD=
# DB_NAME=myapp

# Auth
JWT_SECRET=your-jwt-secret

# Mail (optional)
MAIL_DRIVER=smtp
MAIL_HOST=smtp.mailtrap.io
MAIL_PORT=587
MAIL_USER=
MAIL_PASS=

# Stripe (optional)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Broadcasting (optional)
BROADCAST_DRIVER=sse
INTERNAL_SECRET=your-internal-secret

# Search (optional)
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_KEY=your-master-key

# Storage S3 (optional)
S3_BUCKET=my-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_ENDPOINT=  # for RustFS
```

Generate APP_KEY: `npx svelar key:generate`

## Layout Setup

### Root layout (`src/routes/+layout.svelte`)
```svelte
<script>
  import { Toaster } from '@beeblock/svelar/ui';
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    data: { user: any };
  }
  let { children, data }: Props = $props();
</script>

<Toaster position="bottom-right" />
{@render children()}
```

### Root layout server (`src/routes/+layout.server.ts`)
```typescript
export async function load({ locals }) {
  return { user: locals.user ?? null };
}
```

### Auth guard for dashboard (`src/routes/dashboard/+layout.server.ts`)
```typescript
import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
  if (!locals.user) throw redirect(302, '/login');
  return { user: locals.user };
}
```

### Admin guard (`src/routes/admin/+layout.server.ts`)
```typescript
import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
  if (!locals.user) throw redirect(302, '/login');
  if (locals.user.role !== 'admin') throw redirect(302, '/dashboard');
  return { user: locals.user };
}
```
