# Svelar Documentation

## Introduction

Svelar is a Laravel-inspired framework built on top of SvelteKit 2. It brings enterprise-grade patterns like MVC, ORM, middleware pipelines, session management, and authentication to the SvelteKit ecosystem. Svelar provides a complete backend framework with a familiar developer experience for anyone coming from Laravel.

### Key Features

- **ORM with Relationships**: Eloquent-like query builder with eager loading, relationships (hasOne, hasMany, belongsTo, belongsToMany)
- **Database Migrations & Seeders**: Version-controlled schema management and seed data
- **Authentication**: Session-based auth, JWT support, and API tokens
- **Middleware Pipeline**: Global and controller-level middleware with built-in CSRF, rate limiting, logging, and CORS
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
npx svelar db:seed

# Start the development server
npm run dev
```

Your app is now running at `http://localhost:5173`

## Project Structure

```
my-app/
├── src/
│   ├── app.ts                    # Bootstrap (database, hash, auth config)
│   ├── app.d.ts                  # TypeScript declarations
│   ├── hooks.server.ts           # Middleware pipeline
│   ├── lib/
│   │   ├── actions/              # Single-responsibility use cases
│   │   │   ├── CreatePostAction.ts
│   │   │   ├── RegisterUserAction.ts
│   │   │   └── ...
│   │   ├── controllers/          # Request handlers
│   │   │   ├── AuthController.ts
│   │   │   ├── PostController.ts
│   │   │   └── ...
│   │   ├── database/
│   │   │   ├── migrations/       # Database schema changes
│   │   │   │   ├── 20260325000001_create_users_table.ts
│   │   │   │   └── ...
│   │   │   └── seeders/          # Demo/test data
│   │   │       ├── DatabaseSeeder.ts
│   │   │       └── ...
│   │   ├── dtos/                 # FormRequest validation classes
│   │   │   ├── LoginRequest.ts
│   │   │   ├── RegisterRequest.ts
│   │   │   ├── CreatePostRequest.ts
│   │   │   └── ...
│   │   ├── jobs/                 # Background queue jobs
│   │   │   ├── SendWelcomeEmail.ts
│   │   │   └── ...
│   │   ├── middleware/           # Custom middleware
│   │   │   ├── AuthMiddleware.ts
│   │   │   └── ...
│   │   ├── models/               # ORM models
│   │   │   ├── User.ts
│   │   │   ├── Post.ts
│   │   │   └── ...
│   │   ├── plugins/              # Custom plugins
│   │   │   ├── AnalyticsPlugin.ts
│   │   │   └── ...
│   │   ├── repositories/         # Data access layer
│   │   │   ├── UserRepository.ts
│   │   │   ├── PostRepository.ts
│   │   │   └── ...
│   │   ├── scheduler/            # Scheduled tasks
│   │   │   └── tasks.ts
│   │   └── services/             # Business logic layer
│   │       ├── AuthService.ts
│   │       ├── PostService.ts
│   │       └── ...
│   └── routes/                   # SvelteKit routes
│       ├── +layout.svelte        # App layout
│       ├── +page.svelte          # Home page
│       ├── api/                  # API endpoints
│       │   ├── auth/
│       │   │   ├── register/+server.ts
│       │   │   ├── login/+server.ts
│       │   │   ├── logout/+server.ts
│       │   │   └── me/+server.ts
│       │   ├── posts/
│       │   │   ├── +server.ts    # GET /api/posts, POST /api/posts
│       │   │   ├── [id]/+server.ts
│       │   │   └── ...
│       │   └── ...
│       ├── dashboard/            # Protected pages
│       │   └── +page.svelte
│       ├── login/                # Auth pages
│       │   └── +page.svelte
│       ├── register/
│       │   └── +page.svelte
│       └── ...
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

Middleware runs before route handlers in `src/hooks.server.ts`:

```typescript
import { createSvelarHooks } from 'svelar/hooks';
import { SessionMiddleware, MemorySessionStore } from 'svelar/session';
import { AuthenticateMiddleware } from 'svelar/auth';
import { RateLimitMiddleware } from 'svelar/middleware';
import { auth } from './app.js';

const sessionStore = new MemorySessionStore();

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({
      store: sessionStore,
      secret: process.env.APP_KEY || 'change-me',
      lifetime: 60 * 60 * 24,
    }),
    new AuthenticateMiddleware(auth),
    new RateLimitMiddleware({ maxRequests: 100, windowMs: 60_000 }),
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
