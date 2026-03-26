# Svelar Documentation

## Introduction

Svelar is a Laravel-inspired framework built on top of SvelteKit 2. It brings enterprise-grade patterns like MVC, ORM, middleware pipelines, session management, and authentication to the SvelteKit ecosystem. Svelar provides a complete backend framework with a familiar developer experience for anyone coming from Laravel.

### Key Features

- **UI Components**: Minimal, composable Svelte 5 component library (Button, Card, Input, Alert, Badge, Avatar, etc.) themed via CSS custom properties
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

1. [Installation](./01-installation.md) - Set up a new Svelar project
2. [Database](./02-database.md) - Migrations, seeders, and database configuration
3. [Models & ORM](./03-models-orm.md) - Eloquent-like ORM with relationships
4. [Controllers & Routing](./04-controllers-routing.md) - Request handling and routing
5. [Validation & DTOs](./05-validation-dtos.md) - Form validation with Zod and FormRequest classes
6. [Authentication](./06-authentication.md) - Session, JWT, and API token authentication
7. [Middleware](./07-middleware.md) - Global and controller-level middleware
8. [Services, Actions & Repositories](./08-services-actions-repositories.md) - Business logic layers
9. [Plugins](./09-plugins.md) - Extend Svelar with custom plugins
10. [Scheduler](./10-scheduler.md) - Schedule periodic tasks
11. [Job Queue](./11-queue-jobs.md) - Background job processing
12. [Additional Features](./12-additional-features.md) - Events, logging, mail, notifications, broadcasting, storage, and more
13. [UI Components](./13-ui-components.md) - Component library with theming and extension guide
14. [HTTP Utilities](./14-http.md) - CSRF-aware fetch wrapper
15. [Internationalization](./15-i18n.md) - Paraglide-js integration for multi-language apps
16. [Forms](./16-forms.md) - Superforms + Zod bridge for validated form actions

## Quick Start

Get a new Svelar app up and running in minutes:

```bash
# Create a new project
npx create-svelar my-app
cd my-app

# Install dependencies
npm install

# Run migrations
npx svelar migrate

# Seed demo data
npx svelar seed:run

# Start the development server
npm run dev
```

Your app is now running at `http://localhost:5173`

## Project Structure

```
my-app/
├── src/
│   ├── app.ts                    # Bootstrap (database, hash, auth config)
│   ├── app.css                   # Global styles + CSS custom properties
│   ├── app.html                  # HTML template (with %lang% / %dir% for i18n)
│   ├── app.d.ts                  # TypeScript declarations
│   ├── hooks.server.ts           # Middleware pipeline (createSvelarApp)
│   ├── hooks.ts                  # Client reroute hook (i18n)
│   ├── lib/
│   │   ├── paraglide/            # Generated i18n runtime (auto-generated)
│   │   ├── components/           # App-specific components (extend svelar/ui)
│   │   │   ├── PostCard.svelte
│   │   │   ├── FormField.svelte
│   │   │   └── ...
│   │   ├── schemas/              # Zod validation schemas
│   │   │   ├── post.ts
│   │   │   └── ...
│   │   ├── actions/              # Single-responsibility use cases
│   │   ├── controllers/          # Request handlers
│   │   ├── database/
│   │   │   ├── migrations/       # Database schema changes
│   │   │   └── seeders/          # Demo/test data
│   │   ├── dtos/                 # FormRequest validation classes
│   │   ├── models/               # ORM models (User, Post, etc.)
│   │   ├── services/             # Business logic layer
│   │   ├── repositories/         # Data access layer
│   │   ├── middleware/           # Custom middleware
│   │   ├── jobs/                 # Background queue jobs
│   │   ├── plugins/              # Custom plugins
│   │   └── scheduler/            # Scheduled tasks
│   └── routes/                   # SvelteKit routes
│       ├── +layout.svelte        # App layout (uses svelar/ui, svelar/i18n)
│       ├── +page.svelte          # Home page
│       ├── +error.svelte         # Error page
│       ├── api/                  # API endpoints
│       ├── dashboard/            # Protected pages
│       ├── login/                # Auth pages
│       ├── register/
│       └── admin/
├── messages/                     # i18n translation files
│   ├── en.json
│   └── pt.json
├── project.inlang/               # Paraglide i18n config
├── package.json
├── svelte.config.js
└── vite.config.ts
```

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

## Configuration

Svelar configuration happens in `src/app.ts`:

```typescript
// src/app.ts
import { Connection } from 'svelar/database';
import { Hash } from 'svelar/hashing';
import { AuthManager } from 'svelar/auth';
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
import { createSvelarApp } from 'svelar/hooks';
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
import { createSvelarHooks } from 'svelar/hooks';
import { SessionMiddleware, MemorySessionStore } from 'svelar/session';
import { AuthenticateMiddleware } from 'svelar/auth';
import { RateLimitMiddleware, CsrfMiddleware, OriginMiddleware } from 'svelar/middleware';
import { auth } from './app.js';

export const handle = createSvelarHooks({
  middleware: [
    new OriginMiddleware(),
    new RateLimitMiddleware({ maxRequests: 100, windowMs: 60_000 }),
    new CsrfMiddleware({ onlyPaths: ['/api/'] }),
    new SessionMiddleware({
      store: new MemorySessionStore(),
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

- Read the [Installation](./01-installation.md) guide to set up your first project
- Explore [Models & ORM](./03-models-orm.md) to understand data modeling
- Learn [Controllers & Routing](./04-controllers-routing.md) for handling requests
- Check [Authentication](./06-authentication.md) for user management
- Study the [svelar-example](https://github.com/yourusername/svelar/tree/main/packages/svelar-example) app for real-world patterns

## Getting Help

- Review the documentation for detailed guides
- Check the [svelar-example](../packages/svelar-example) app for working examples
- Open an issue on GitHub for bugs or feature requests

---

**Svelar Documentation** © 2026. Built with ❤️ for the SvelteKit community.
