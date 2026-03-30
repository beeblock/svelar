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
- **Forms**: Superforms + Zod bridge with `createFormAction` and `loadForm` helpers
- **HTTP Utilities**: CSRF-aware fetch wrapper for client-side API calls
- **Form Validation**: Zod-based validation with FormRequest classes (DTOs)
- **Service Layer & Actions**: Clean separation of concerns with services, repositories, and single-use actions
- **Plugin System**: Extensible plugin architecture with lifecycle hooks
- **Job Queue**: Background job processing with retry logic
- **Scheduler**: Cron-like task scheduling
- **Session Management**: Cookie-based sessions with memory and database stores
- **Hashing**: Multiple hashing drivers (scrypt, bcrypt, argon2)
- **Events & Listeners**: Pub/sub event system
- **Storage**: File storage abstraction layer
- **Logging & Caching**: Built-in logging and caching drivers

## Table of Contents

0. [Getting Started](./00-getting-started.md) - **Start here** — what you get, step-by-step setup, your first 10 minutes
1. [Installation](./01-installation.md) - CLI commands, manual setup, Docker deployment
2. [Database](./02-database.md) - Migrations, seeders, and database configuration
3. [Models & ORM](./03-models-orm.md) - Eloquent-like ORM with relationships
4. [Controllers & Routing](./04-controllers-routing.md) - Request handling, resources, response objects
5. [Validation & DTOs](./05-validation-dtos.md) - Form validation with Zod, contract schemas
6. [Authentication](./06-authentication.md) - Session, JWT, refresh tokens, API tokens, request signatures
7. [Middleware](./07-middleware.md) - CORS, CSRF, rate limiting, origin validation, signatures
8. [Services, Actions & Repositories](./08-services-actions-repositories.md) - Business logic layers
9. [Plugins](./09-plugins.md) - Extend Svelar with custom plugins
10. [Scheduler](./10-scheduler.md) - Schedule periodic tasks
11. [Job Queue](./11-queue-jobs.md) - Background job processing
12. [Sessions](./22-sessions.md) - Session stores (database, file, Redis, memory)
13. [Events & Listeners](./23-events.md) - Pub/sub event system with typed listeners
14. [Mail](./24-mail.md) - SMTP, Postmark, Resend drivers with Mailable classes
15. [Broadcasting](./25-broadcasting.md) - Real-time SSE and Pusher/Soketi WebSocket
16. [Storage](./26-storage.md) - Local and S3-compatible file storage
17. [PDF Generation](./27-pdf.md) - PDFKit (default) and Gotenberg drivers
18. [Excel Import/Export](./28-excel.md) - Streaming Excel with ExcelJS
19. [Feature Flags](./21-feature-flags.md) - Per-user, per-team, and percentage rollout
20. [More Features](./12-additional-features.md) - Hashing, caching, logging, notifications, config, CLI, audit, and more
21. [UI Components](./13-ui-components.md) - Component library with theming and extension guide
22. [HTTP & Integrations](./14-http.md) - Server-side HTTP client, third-party API patterns, custom drivers
23. [Internationalization](./15-i18n.md) - Paraglide-js integration for multi-language apps
24. [Forms](./16-forms.md) - Superforms + Zod bridge for validated form actions
25. [Dates](./18-dates.md) - Date utilities and formatting
26. [Error Handling](./19-error-handling.md) - Error pages, localization, exception handling
27. [Architecture & Module Communication](./20-architecture.md) - DDD boundaries, events as glue, anti-patterns
28. [SaaS Guide](./17-saas-guide.md) - Multi-tenancy, production checklist, scaling
29. [Deployment](./29-deployment.md) - Docker, Traefik, blue-green, Swarm, CI/CD, monitoring

## Quick Start

```bash
npx @beeblock/svelar new my-app
cd my-app
cp .env.example .env
npx @beeblock/svelar migrate
npm run dev
```

Your app is now running at `http://localhost:5173` with auth, dashboard, admin panel, teams, API keys, and more — all working out of the box.

> **New to Svelar?** Read the [Getting Started](./00-getting-started.md) guide for a complete walkthrough of what you get and how to set everything up.

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
│   │   │   ├── auth/             # User.ts, UserObserver.ts, AuthController.ts, AuthService.ts
│   │   │   ├── billing/          # Invoice.ts, BillingService.ts
│   │   │   └── posts/            # Post.ts, PostController.ts, PostRepository.ts
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
│   │   ├── events/               # Event classes (npx svelar make:event)
│   │   ├── listeners/            # Listener classes (npx svelar make:listener)
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

Each **module** under `modules/` is a self-contained domain — model, controller, service, repository, observers, DTOs, and schema all live together. The `shared/` folder holds cross-cutting infrastructure that spans multiple domains.

## Architecture

Svelar follows a hybrid Domain-Driven Design (DDD) architecture that cleanly separates concerns:

```
Request
   ↓
Route (+server.ts)
   ↓
Controller (handle request, delegate)
   ↓
DTO/FormRequest (validation & authorization)
   ↓
Service (orchestrate business logic)
   ↓
Action (single use-case execution)
   ↓
Repository (data access abstraction)
   ↓
Model (ORM, database interaction)
```

### Layer Responsibilities

**Controllers**: Accept HTTP requests and delegate to services/actions. Handle response formatting (JSON, HTML, redirects).

**DTOs/FormRequest**: Validate incoming data with Zod schemas. Authorize requests before processing. Transform data if needed.

**Services**: Orchestrate multiple operations, compose repositories, emit events. Return `ServiceResult<T>` (ok/fail).

**Actions**: Execute single, well-defined use cases. Encapsulate business logic. Support middleware pipelines and hooks.

**Repositories**: Provide data access methods. Abstract the Model layer. Cache queries when needed.

**Models**: Map database tables to objects. Define relationships. Support eager loading and casting.

### Module Communication

Modules **never import each other directly**. Cross-module communication goes through the event system:

```
Auth Module ──► Event: UserRegistered ──► Billing Module (CreateFreePlan)
                                      ──► Notifications Module (SendWelcomeEmail)
```

All event-to-listener mappings and model observers are registered in the `EventServiceProvider`, giving you a single place to see how your modules interact.

See [Architecture & Module Communication](./20-architecture.md) for the full guide, including patterns, anti-patterns, shared contracts, and testing strategies.

## Configuration

Svelar configuration happens in `src/app.ts`:

```typescript
// src/app.ts
import { Connection } from '@beeblock/svelar/database';
import { Hash } from '@beeblock/svelar/hashing';
import { AuthManager } from '@beeblock/svelar/auth';
import { User } from './lib/models/User.js';

// Database
Connection.configure({
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      filename: process.env.DB_PATH ?? 'database.db',
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
      store: new DatabaseSessionStore(),  // auto-creates sessions table
      secret: process.env.APP_KEY || 'change-me',
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
- Check the [svelar-example](../packages/svelar-example) app for working examples
- Open an issue on GitHub for bugs or feature requests

---

**Svelar Documentation** © 2026. Built with ❤️ for the SvelteKit community.
