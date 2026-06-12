# Svelar

Laravel-inspired framework and application scaffold for SvelteKit 2.

Svelar brings Laravel-style conventions to TypeScript and SvelteKit: a DDD-friendly module structure, Eloquent-like models, migrations, FormRequests, DTOs, actions, services, repositories, policies, queues, scheduler tasks, events, listeners, observers, storage, mail, PDF generation, search, broadcasting, and a project-local Artisan-like CLI.

## Quick Start

```bash
npx @beeblock/svelar new my-app
cd my-app
npm run dev
```

For a Valibot scaffold instead of the default Zod scaffold:

```bash
npx @beeblock/svelar new my-app --validation=valibot
```

Use `npx @beeblock/svelar new` when npm needs to fetch the package for a new app. Generated apps install `@beeblock/svelar`, so project-local commands use the shorter binary:

```bash
npx svelar make:entity Invoice --module=billing --fields "title:string,total:number,status:enum(draft,paid)" --crud
npx svelar migrate
npm run dev:worker
npm run dev:scheduler
```

The scaffold installs dependencies, installs shadcn-svelte UI components, generates secure `.env` secrets, runs migrations, seeds users, and ships Codex/Claude Svelar guidance files.

Default seeded accounts:

```text
Admin: admin@svelar.dev / admin123
Demo:  demo@svelar.dev / password
```

## What You Get

- **DDD modular structure** with `domain`, `application`, `infrastructure`, `interface/http`, and `contracts/schemas` layers.
- **Route to resource flow**: route -> controller/page action -> FormRequest/shared schema -> DTO -> action/service -> repository -> model/resource -> response.
- **Validation choice** with Zod or Valibot. One shared contract schema remains the source of truth for backend FormRequests/DTOs and frontend Superforms.
- **ORM and migrations** over Drizzle, with SQLite, PostgreSQL, and MySQL support, focused migrations, relationships, casts, soft deletes, observers, UUID v7/ULID helpers, and public identifiers.
- **Auth and security** with sessions, JWT, refresh tokens, API tokens, CSRF, rate limiting, request signatures, policies, roles, permissions, teams, OTP, password resets, and email verification.
- **Queues and scheduler** with sync/database/Redis BullMQ workers, retry/failure handling, database-backed scheduler locks, local `dev:worker` and `dev:scheduler` scripts, and dashboard monitoring.
- **Events and listeners** for side effects, plus observer registration through providers. Slow or retryable listeners can dispatch queue jobs.
- **Realtime** through SSE channels and Pusher-compatible Soketi/WebSocket broadcasting.
- **Storage and uploads** with local and S3-compatible disks, including RustFS for local Docker.
- **PDF, mail, search, Excel, webhooks, audit, logs, notifications, feature flags, i18n, forms, HTTP helpers, testing helpers, and UI primitives**.
- **Production Docker scaffolding** with app, worker, scheduler, PostgreSQL/PgBouncer, Redis, Soketi, Gotenberg, RustFS, Meilisearch, health checks, and non-default local service ports.

## Project Structure

Default scaffolds use a DDD modular monolith layout:

```text
my-app/
├── src/
│   ├── app.ts
│   ├── hooks.server.ts
│   ├── lib/
│   │   ├── modules/
│   │   │   └── posts/
│   │   │       ├── contracts/schemas/
│   │   │       ├── domain/
│   │   │       │   ├── events/
│   │   │       │   ├── models/
│   │   │       │   ├── observers/
│   │   │       │   └── policies/
│   │   │       ├── application/
│   │   │       │   ├── actions/
│   │   │       │   ├── dto/
│   │   │       │   ├── listeners/
│   │   │       │   ├── notifications/
│   │   │       │   └── services/
│   │   │       ├── infrastructure/repositories/
│   │   │       └── interface/http/
│   │   │           ├── controllers/
│   │   │           ├── requests/
│   │   │           └── resources/
│   │   ├── shared/
│   │   │   ├── channels/
│   │   │   ├── commands/
│   │   │   ├── jobs/
│   │   │   ├── middleware/
│   │   │   ├── providers/
│   │   │   └── scheduler/
│   │   └── database/
│   │       ├── migrations/
│   │       └── seeders/
│   └── routes/
├── storage/
├── svelar.database.json
├── svelar.validation.json
└── package.json
```

Prefer the DDD layout for production apps. Use `--flat` only for small experiments:

```bash
npx @beeblock/svelar new my-app --flat
```

## CLI

First-run scaffolding:

```bash
npx @beeblock/svelar new my-app
npx @beeblock/svelar new my-app --validation=zod
npx @beeblock/svelar new my-app --validation=valibot
npx @beeblock/svelar new my-app --flat
```

Common project-local commands:

```bash
npx svelar make:entity Post --module=posts --fields "title:string,body:text,published:boolean" --crud
npx svelar make:model User
npx svelar make:migration create_posts_table
npx svelar make:controller PostController
npx svelar make:request CreatePostRequest
npx svelar make:resource PostResource
npx svelar make:job SendWelcomeEmail
npx svelar make:task PruneAuditLogs
npx svelar make:event UserRegistered
npx svelar make:listener SendWelcomeEmailListener
npx svelar make:observer UserObserver
npx svelar make:docker
npx svelar make:dashboard
npx svelar make:broadcasting
npx svelar migrate
npx svelar seed:run
npx svelar routes:list
npx svelar queue:work
npx svelar schedule:run
npx svelar tinker
```

`make:entity` is the main Laravel-style resource generator. It creates the model, focused migration, contract schema, DTOs, FormRequests, actions, resource, repository, service, controller, and route pieces.

## Validation

Svelar supports Zod and Valibot. The scaffold choice is stored in `svelar.validation.json`, and generators read that file so schemas, requests, and entity scaffolds stay consistent.

```bash
npx @beeblock/svelar new zod-app --validation=zod
npx @beeblock/svelar new valibot-app --validation=valibot
```

Zod imports come from:

```ts
import { z, rules } from '@beeblock/svelar/validation';
```

Valibot imports come from:

```ts
import { v, rules } from '@beeblock/svelar/validation/valibot';
```

Both providers keep the same architecture: shared contract schema -> FormRequest validation/authorization -> DTO -> action/service.

## Module Communication

Use events for side effects:

```ts
await Event.dispatch(new UserRegistered(user));
```

Listeners can do immediate work or dispatch queue jobs for slow/retryable work.

For request/response reads across modules, use a narrow public application service/query/facade from the owning module and return plain DTO/contract data. Do not import another module's models, repositories, controllers, or internal services as your cross-module API.

## Database And Runtime Services

Generated apps support SQLite by default and can use PostgreSQL or MySQL. Production Docker scaffolds can include:

- PostgreSQL through PgBouncer with prepared statements disabled where needed
- `pg_stat_statements` for slow-query visibility
- Redis for cache, sessions, and BullMQ queues
- Soketi for Pusher-compatible WebSockets
- Gotenberg for PDF conversion
- RustFS for local S3-compatible object storage
- Meilisearch for full-text search

The generated Docker files use separate app, worker, and scheduler services. Local development can use the generated `npm run dev:worker` and `npm run dev:scheduler` scripts without rebuilding containers on every code change.

## Release Verification

Core release checks live in the monorepo root:

```bash
npm run test
npm run build
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
npm run release:dry-run
```

`npm run certify` builds and packs the local core package, scaffolds real apps into the sibling `svelar-testing-area`, runs migrations/seeders/tests/builds, and exercises browser-visible flows. Service smoke checks start Docker services on non-default/random host ports so they do not conflict with other local projects.

Publish only `@beeblock/svelar`. It includes the `svelar` binary. There is no separate unscoped `svelar` package because npm blocks that package name as too similar to `svelte`.

## Documentation

Start here:

- [Getting Started](docs/00-getting-started.md)
- [Installation](docs/01-installation.md)
- [Validation & DTOs](docs/05-validation-dtos.md)
- [Architecture & Module Communication](docs/20-architecture.md)
- [Deployment](docs/29-deployment.md)
- [Release Certification](docs/47-release-certification.md)

## License

MIT
