# Svelar Documentation

## Introduction

Svelar is a Laravel-inspired framework built on top of SvelteKit 2. It brings enterprise-grade patterns like MVC, ORM, middleware pipelines, session management, and authentication to the SvelteKit ecosystem. Svelar provides a complete backend framework with a familiar developer experience for anyone coming from Laravel.

### Key Features

- **UI Components**: Minimal, composable Svelte 5 component library (Button, Card, Input, Alert, Badge, Avatar, etc.) themed via Tailwind CSS v4 `@theme` tokens
- **ORM with Relationships**: Eloquent-like query builder with eager loading, relationships (hasOne, hasMany, belongsTo, belongsToMany)
- **Database Migrations & Seeders**: Version-controlled schema management and seed data
- **Authentication**: Session-based auth, JWT support, and API tokens
- **Middleware Pipeline**: Global and controller-level middleware with built-in CSRF, rate limiting, logging, and CORS
- **i18n**: Paraglide-js 2.x integration with server middleware, reroute hooks, and LanguageSwitcher component
- **Forms**: Superforms bridge for Zod or Valibot with `createFormAction` and `loadForm` helpers
- **HTTP Utilities**: CSRF-aware fetch wrapper for client-side API calls
- **Form Validation**: Zod or Valibot validation with FormRequest classes and DTO payloads
- **Service Layer & Actions**: Clean separation of concerns with services, repositories, and single-use actions
- **Plugin System**: Extensible plugin architecture with lifecycle hooks
- **Job Queue**: Background job processing with retry logic
- **Scheduler**: Cron-like task scheduling
- **Session Management**: Cookie-based sessions with memory and database stores
- **Hashing**: Multiple hashing drivers (scrypt, bcrypt, argon2)
- **Events & Listeners**: Pub/sub event system
- **Storage**: File storage abstraction layer
- **Logging & Caching**: Built-in logging and caching drivers
- **Full-Text Search**: Meilisearch integration with auto-syncing `Searchable` mixin

## Table of Contents

0. [Getting Started](./00-getting-started.md) - **Start here** — what you get, step-by-step setup, your first 10 minutes
1. [Installation](./01-installation.md) - CLI commands, manual setup, Docker deployment
2. [Database](./02-database.md) - Migrations, seeders, and database configuration
3. [Models & ORM](./03-models-orm.md) - Eloquent-like ORM with relationships
4. [Controllers & Routing](./04-controllers-routing.md) - Request handling, resources, response objects
5. [Validation & DTOs](./05-validation-dtos.md) - Form validation with Zod or Valibot, contract schemas
6. [Authentication](./06-authentication.md) - Session, JWT, refresh tokens, API tokens, request signatures
7. [Middleware](./07-middleware.md) - CORS, CSRF, rate limiting, origin validation, signatures
8. [Services, Actions & Repositories](./08-services-actions-repositories.md) - Business logic layers
9. [Plugins](./09-plugins.md) - Extend Svelar with custom plugins
10. [Scheduler](./10-scheduler.md) - Schedule periodic tasks
11. [Job Queue](./11-queue-jobs.md) - Background job processing
12. [Sessions](./22-sessions.md) - Session stores (database, file, Redis, memory)
13. [Events & Listeners](./23-events.md) - Pub/sub event system with typed listeners
14. [Mail](./24-mail.md) - SMTP, Postmark, Resend, Mailtrap, log, and null drivers with Mailable classes
15. [Broadcasting](./25-broadcasting.md) - Real-time SSE and Pusher/Soketi WebSocket
16. [Storage](./26-storage.md) - Local and S3-compatible file storage
17. [PDF Generation](./27-pdf.md) - PDFKit (default) and Gotenberg drivers
18. [Excel Import/Export](./28-excel.md) - Optional streaming Excel support with ExcelJS
19. [Feature Flags](./21-feature-flags.md) - Per-user, per-team, and percentage rollout
20. [More Features](./12-additional-features.md) - Hashing, caching, logging, notifications, config, CLI, audit, and more
21. [UI Components](./13-ui-components.md) - Component library with theming and extension guide
22. [HTTP & Integrations](./14-http.md) - Server-side HTTP client, third-party API patterns, custom drivers
23. [Internationalization](./15-i18n.md) - Paraglide-js integration for multi-language apps
24. [Forms](./16-forms.md) - Superforms bridge for Zod or Valibot form actions
25. [Dates](./18-dates.md) - Date utilities and formatting
26. [Error Handling](./19-error-handling.md) - Error pages, localization, exception handling
27. [Architecture & Module Communication](./20-architecture.md) - DDD boundaries, events as glue, anti-patterns
28. [SaaS Guide](./17-saas-guide.md) - Multi-tenancy, production checklist, scaling
29. [Deployment](./29-deployment.md) - Docker, Traefik, blue-green, Swarm, CI/CD, monitoring
30. [Security](./30-security.md) - Authentication, CSRF, rate limiting, Docker hardening, production checklist
31. [Full-Text Search](./31-search.md) - Meilisearch integration with Searchable mixin, auto-sync, bulk indexing
32. [Stripe Billing](./32-stripe.md) - Subscriptions, checkout, invoices, refunds, webhooks, customer portal
33. [Contributors](./48-contributors.md) - Contributing to Svelar core, docs sync rules, and maintainer workflows

### Contributor Documentation

- [Release Certification](./47-release-certification.md) - Pre-publish certification gate and external-service checks

## Quick Start

```bash
npx @beeblock/svelar new my-app
cd my-app
npm run dev
```

The `new` command installs dependencies, generates `.env` with secure random secrets, runs migrations, and seeds the database. Your app is ready at `http://localhost:5173` with auth, dashboard, admin panel, teams, API keys, and more — all working out of the box.

> **New to Svelar?** Read the [Getting Started](./00-getting-started.md) guide for a complete walkthrough of what you get and how to set everything up.

## Release Verification

Before publishing Svelar, run the local smoke checks from the core repository:

```bash
npm run smoke:ddd
npm run smoke:flat
npm run smoke:browser
npm run smoke:browser:headed
npm run smoke:prod
npm run smoke:db
npm run smoke:db:prod
npm run smoke:redis
npm run smoke:pdf
npm run smoke:search
npm run smoke:s3
npm run smoke:pgbouncer
npm run certify:inventory
npm run certify
```

Run `npm run certify` before publishing. It prints the release certification inventory, runs the core test suite, then runs Redis, PDF, Meilisearch, S3, and PgBouncer/`pg_stat_statements` service smoke plus the full generated-app database and production-browser smoke gate. These commands build and pack the local `@beeblock/svelar` package, scaffold real apps into the sibling `svelar-testing-area`, install UI components with the generated `npm run ui:install` script, run migrations and seeders, execute generated tests, verify production builds, and exercise the generated app in a real browser, including real `EventSource` checks for SSE public/private/presence channels. DDD smoke apps also receive an injected certification test that covers the intended `route -> controller -> FormRequest/schema -> DTO -> action -> service -> repository -> model -> resource` flow, complex ORM queries, events/listeners, model observers, queues, middleware/rate limiting, sessions, auth recovery tokens, Teams roles/invitations, SSE public/private/presence broadcasting, and Postmark/Resend/Mailtrap mail transport payloads across the configured database driver, Redis cache/session/BullMQ behavior when `REDIS_URL` is present, PDFKit/Gotenberg behavior when `GOTENBERG_URL` is present, Meilisearch `Searchable` indexing when `MEILISEARCH_HOST` is present, S3-compatible storage when `S3_CERTIFICATION` is present, and PostgreSQL through PgBouncer with `pg_stat_statements` when `PGBOUNCER_CERTIFICATION` is present. Use `npm run smoke:browser:headed` when you want to watch Chromium open and step through the browser smoke flow locally. The database, Redis, Gotenberg, Meilisearch, RustFS, and PgBouncer smoke scripts start Docker containers with random localhost ports, so they do not require 5432, 3306, 6379, 3000, 6432, 7700, or 9000 to be free. If Playwright has not downloaded Chromium locally yet, run `cd ../svelar-testing-area/apps/svelar-smoke-ddd && npx playwright install chromium`.

## Project Structure (DDD Modular Monolith)

```
my-app/
├── src/
│   ├── app.ts                    # Bootstrap (database, hashing, providers)
│   ├── app.css                   # Tailwind CSS v4 + @theme tokens
│   ├── app.html                  # HTML template
│   ├── hooks.server.ts           # Middleware pipeline (createSvelarApp)
│   ├── lib/
│   │   ├── modules/              # Domain modules (DDD)
│   │   │   ├── auth/
│   │   │   │   ├── contracts/schemas/
│   │   │   │   ├── domain/models/
│   │   │   │   ├── application/actions/
│   │   │   │   ├── infrastructure/repositories/
│   │   │   │   └── interface/http/
│   │   │   └── posts/
│   │   │       ├── contracts/schemas/
│   │   │       ├── domain/models/
│   │   │       ├── application/actions/
│   │   │       ├── infrastructure/repositories/
│   │   │       └── interface/http/
│   │   ├── shared/               # Cross-cutting concerns
│   │   │   ├── middleware/       # Custom middleware
│   │   │   ├── components/       # Shared Svelte components
│   │   │   ├── stores/           # Svelte stores
│   │   │   ├── jobs/             # Background queue jobs
│   │   │   ├── plugins/          # Custom plugins
│   │   │   ├── channels/         # Broadcast channel authorization
│   │   │   ├── commands/         # Custom CLI commands
│   │   │   ├── providers/        # Service providers (EventServiceProvider, etc.)
│   │   │   └── scheduler/        # Scheduled tasks
│   │   └── database/
│   │       ├── migrations/       # Database schema changes
│   │       └── seeders/          # Seed data
│   └── routes/                   # SvelteKit routes
│       ├── +layout.svelte
│       ├── +page.svelte
│       ├── api/
│       ├── dashboard/
│       └── admin/
├── storage/
│   ├── logs/                     # Application logs
│   ├── cache/                    # File-based cache
│   ├── uploads/                  # User uploads
│   └── sessions/                 # File-based sessions
├── package.json
├── svelte.config.js
├── svelar.database.json
├── .env.example
└── vite.config.ts
```

Each **module** under `modules/` is a self-contained domain with its own `domain/`, `application/`, `infrastructure/`, `interface/http/`, and `contracts/schemas` layers. The `shared/` folder holds cross-cutting infrastructure that spans multiple domains.

## Architecture

Svelar follows a hybrid Domain-Driven Design (DDD) architecture that cleanly separates concerns:

```
Request
   ↓
Route (+server.ts)
   ↓
Controller (handle request, delegate)
   ↓
FormRequest (validation & authorization) -> DTO
   ↓
Action (single use-case execution)
   ↓
Service (orchestrate business logic)
   ↓
Repository (data access abstraction)
   ↓
Model (ORM, database interaction)
```

### Layer Responsibilities

**Controllers**: Accept HTTP requests and delegate to services/actions. Handle response formatting (JSON, HTML, redirects).

**FormRequests**: Validate incoming data with Zod or Valibot schemas and authorize requests before processing.

**DTOs**: Carry validated data from FormRequests into services and actions.

**Services**: Orchestrate multiple operations, compose repositories, emit events. Return `ServiceResult<T>` (ok/fail).

**Actions**: Execute single, well-defined use cases. Encapsulate business logic. Support middleware pipelines and hooks.

**Repositories**: Provide data access methods. Abstract the Model layer. Cache queries when needed.

**Models**: Map database tables to objects. Define relationships. Support eager loading and casting.

### Module Communication

Use events for side effects:

```
Auth Module ──► Event: UserRegistered ──► Billing Module listener (CreateFreePlan)
                                      ──► Notifications listener (SendWelcomeEmail)
```

For request/response reads across module boundaries, use a narrow public application service/query/facade from the owning module and return plain DTO/contract data. Do not import another module's models, repositories, controllers, or internal services as your cross-module API.

All event-to-listener mappings and model observers are registered in the `EventServiceProvider`, giving you a single place to see side-effect wiring.

See [Architecture & Module Communication](./20-architecture.md) for the full guide, including patterns, anti-patterns, shared contracts, and testing strategies.

## Configuration

Svelar configuration happens in `src/app.ts`:

```typescript
// src/app.ts
import { Connection } from '@beeblock/svelar/database';
import { Hash } from '@beeblock/svelar/hashing';
import { AuthManager } from '@beeblock/svelar/auth';
import { User } from '$lib/modules/auth/domain/models/User.js';

// Database
Connection.configure({
  default: process.env.DB_DRIVER ?? 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      filename: process.env.DB_PATH ?? 'database.db',
    },
    postgres: {
      driver: 'postgres',
      url: process.env.DATABASE_URL,
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'svelar_db',
      user: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? '',
    },
    mysql: {
      driver: 'mysql',
      url: process.env.DATABASE_URL,
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 3306),
      database: process.env.DB_NAME ?? 'svelar_db',
      user: process.env.DB_USER ?? 'root',
      password: process.env.DB_PASSWORD ?? '',
    },
  },
});

// Hashing
Hash.configure({
  driver: 'scrypt', // or 'bcrypt', 'argon2'
});

// Auth
export const auth = new AuthManager({
  guard: 'session', // or 'jwt', 'api'
  model: User,
});

export { Connection, Hash };
```

## Middleware Pipeline

The simplest way to set up the middleware pipeline is `createSvelarApp`, which auto-wires origin validation, rate limiting, CSRF, sessions, auth, error handling, and optionally i18n:

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

For full control, use `createSvelarHooks` to compose the pipeline manually:

```typescript
import { createSvelarHooks } from '@beeblock/svelar/hooks';
import { SessionMiddleware, DatabaseSessionStore } from '@beeblock/svelar/session';
import { AuthenticateMiddleware } from '@beeblock/svelar/auth';
import { RateLimitMiddleware, CsrfMiddleware, OriginMiddleware } from '@beeblock/svelar/middleware';
import { auth } from './app.js';

export const handle = createSvelarHooks({
  middleware: [
    new OriginMiddleware(),
    new RateLimitMiddleware({ maxRequests: 100, windowMs: 60_000 }),
    new CsrfMiddleware({ onlyPaths: ['/api/'] }),
    new SessionMiddleware({
      store: new DatabaseSessionStore(),  // requires the sessions migration
      secret: process.env.APP_KEY!,
      lifetime: 60 * 60 * 24,
    }),
    new AuthenticateMiddleware(auth),
  ],
  onError: (error, event) => {
    console.error('[Svelar Error]', error);
  },
});
```

## Environment Variables

Create a `.env` file in your project root:

```bash
# Database
DB_PATH=database.db

# App
APP_KEY=your-secret-key-for-sessions

# Auth
JWT_SECRET=your-jwt-secret-key

# Mail (optional)
MAIL_DRIVER=log
MAIL_FROM=hello@example.com

# Storage (optional)
STORAGE_DISK=local
```

## Next Steps

- **Start here**: [Getting Started](./00-getting-started.md) — what you get, setup steps, first 10 minutes
- [Installation](./01-installation.md) — CLI commands, Docker deployment, manual setup
- [Models & ORM](./03-models-orm.md) — define your domain models
- [Controllers & Routing](./04-controllers-routing.md) — build your API
- [Authentication](./06-authentication.md) — JWT, refresh tokens, API tokens, request signatures
- [Architecture](./20-architecture.md) — DDD module boundaries and patterns

## Getting Help

- Review the documentation for detailed guides
- Scaffold a new project with `npx @beeblock/svelar new my-app` to explore working examples
- Open an issue on GitHub for bugs or feature requests

---

**Svelar Documentation** © 2026. Built with ❤️ for the SvelteKit community.
