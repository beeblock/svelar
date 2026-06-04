<p align="center">
  <img src="https://raw.githubusercontent.com/beeblock/svelar/main/docs/assets/svelar-full-logo.svg" alt="Svelar" width="180" />
</p>

<h1 align="center">Svelar</h1>

Laravel-inspired framework on top of SvelteKit 2. Brings the developer experience of Laravel — routing, middleware, Eloquent-style ORM, service container, auth, sessions, caching, queues, mail, broadcasting, and more — into the SvelteKit ecosystem.

**Batteries included.** Authentication, dashboard, admin panel, email templates, API keys, team management, file uploads, and more — all out of the box so you can focus on building your core business features.

## Documentation

Full documentation is available at **[svelar.dev](https://svelar.dev)**.

## Quick Start

```bash
# Scaffold a new project (installs deps, shadcn-svelte, runs migrations automatically)
npx svelar new my-app
cd my-app
npm run dev
```

The short `npx svelar` command is provided by the unscoped `svelar` CLI shim. Generated apps install the framework package as `@beeblock/svelar`.

Or add to an existing SvelteKit project:

```bash
npm install @beeblock/svelar
```

## Publishing

Run the monorepo release script from the repository root:

```bash
npm run release:dry-run
npm run release
```

It syncs and publishes both `@beeblock/svelar` and the unscoped `svelar` CLI shim used by `npx svelar`.

See the [Getting Started guide](https://svelar.dev/docs/getting-started) for a complete walkthrough.

## Features

| Module | Import | Description |
|--------|--------|-------------|
| **ORM** | `@beeblock/svelar/orm` | Eloquent-style models with relationships, soft deletes, scopes, eager loading |
| **Database** | `@beeblock/svelar/database` | Schema builder, migrations, seeders (SQLite, PostgreSQL, MySQL) |
| **Auth** | `@beeblock/svelar/auth` | Session, JWT (with refresh tokens), API tokens, password reset, email verification, OTP login |
| **Middleware** | `@beeblock/svelar/middleware` | CORS, CSRF, rate limiting, origin validation, request signatures |
| **Routing** | `@beeblock/svelar/routing` | Controllers, form requests, API resources, response helpers |
| **Validation** | `@beeblock/svelar/validation` | Zod-based validation with FormRequest DTOs |
| **Session** | `@beeblock/svelar/session` | Cookie, memory, Redis, and database session stores |
| **Hashing** | `@beeblock/svelar/hashing` | scrypt (zero-dep), bcrypt, argon2 |
| **Queue** | `@beeblock/svelar/queue` | Job dispatching with sync, memory, and Redis (BullMQ) drivers |
| **Scheduler** | `@beeblock/svelar/scheduler` | Cron-based task scheduling with distributed locking and DB history |
| **Events** | `@beeblock/svelar/events` | Typed event dispatcher with listeners and subscribers |
| **Broadcasting** | `@beeblock/svelar/broadcasting` | Server-Sent Events and Pusher/Soketi WebSocket support |
| **Cache** | `@beeblock/svelar/cache` | Memory and Redis cache with TTL and remember pattern |
| **Storage** | `@beeblock/svelar/storage` | Local and S3-compatible file storage |
| **Mail** | `@beeblock/svelar/mail` | SMTP, Postmark, Resend, log, and null transports with Mailable classes |
| **Excel** | `@beeblock/svelar/excel` | Import/export Excel files with streaming support for large datasets |
| **Notifications** | `@beeblock/svelar/notifications` | Multi-channel notifications (mail, database, broadcast) |
| **Logging** | `@beeblock/svelar/logging` | File-based logger with levels and rotation |
| **HTTP Client** | `@beeblock/svelar/http` | Client-side CSRF fetch + server-side fluent HTTP client for third-party APIs |
| **Permissions** | `@beeblock/svelar/permissions` | Role-based access control with permissions and gates |
| **i18n** | `@beeblock/svelar/i18n` | Paraglide-js integration with language switcher |
| **Forms** | `@beeblock/svelar/forms` | SvelteKit Superforms integration helpers |
| **UI Components** | `@beeblock/svelar/ui` | Minimal built-in components + [shadcn-svelte](https://shadcn-svelte.com) pre-installed |
| **SEO** | `@beeblock/svelar/ui` | `<Seo>` component for meta tags, Open Graph, Twitter Cards, JSON-LD structured data |
| **Hooks** | `@beeblock/svelar/hooks` | One-line SvelteKit hooks setup with sensible defaults |
| **Container** | `@beeblock/svelar/container` | IoC container with singleton/transient bindings |
| **Plugins** | `@beeblock/svelar/plugins` | Plugin discovery, publishing, and CLI management |
| **PDF** | `@beeblock/svelar/pdf` | PDF generation with PDFKit (default) and Gotenberg drivers |
| **Feature Flags** | `@beeblock/svelar/feature-flags` | Per-user, per-team, and percentage rollout feature flags |
| **Audit** | `@beeblock/svelar/audit` | Model change tracking |
| **API Keys** | `@beeblock/svelar/api-keys` | API key generation, validation, and management |
| **Webhooks** | `@beeblock/svelar/webhooks` | Webhook dispatch and signature verification |
| **Teams** | `@beeblock/svelar/teams` | Multi-tenant team management with database-backed storage |
| **Email Templates** | `@beeblock/svelar/email-templates` | Database-stored templates with variable interpolation |
| **Uploads** | `@beeblock/svelar/uploads` | File upload handling with validation (local + S3) |
| **Dashboard** | `@beeblock/svelar/dashboard` | Admin dashboard with job/scheduler monitoring and log viewer |
| **Search** | `@beeblock/svelar/search` | Meilisearch integration with auto-syncing `Searchable` mixin |
| **Testing** | `@beeblock/svelar/testing` | Factory, `useSvelarTest()`, `refreshDatabase()`, `actingAs()`, database assertions |

## Official Plugins

| Package | Description |
|---------|-------------|
| [`@beeblock/svelar-datatable`](https://www.npmjs.com/package/@beeblock/svelar-datatable) | DataTable with sorting, searching, pagination, inline editing, export, virtual scroll |
| [`@beeblock/svelar-media`](https://www.npmjs.com/package/@beeblock/svelar-media) | File attachments with image conversions, collections, S3/local storage |
| [`@beeblock/svelar-social-auth`](https://www.npmjs.com/package/@beeblock/svelar-social-auth) | OAuth providers (Google, GitHub, Facebook, Twitter, Discord) |
| [`@beeblock/svelar-two-factor`](https://www.npmjs.com/package/@beeblock/svelar-two-factor) | TOTP two-factor authentication with QR setup and recovery codes |
| [`@beeblock/svelar-settings`](https://www.npmjs.com/package/@beeblock/svelar-settings) | Typed settings with database persistence and per-user/per-team scoping |
| [`@beeblock/svelar-comments`](https://www.npmjs.com/package/@beeblock/svelar-comments) | Threaded comments with moderation, voting, and HasComments mixin |
| [`@beeblock/svelar-activity-log`](https://www.npmjs.com/package/@beeblock/svelar-activity-log) | Audit trail with LogsActivity mixin and causer tracking |
| [`@beeblock/svelar-backup`](https://www.npmjs.com/package/@beeblock/svelar-backup) | Database backup with local/S3 destinations and cleanup policies |
| [`@beeblock/svelar-charts`](https://www.npmjs.com/package/@beeblock/svelar-charts) | SVG chart components (line, bar, pie, doughnut, area) |
| [`@beeblock/svelar-stripe`](https://www.npmjs.com/package/@beeblock/svelar-stripe) | Stripe billing with polymorphic Billable mixin, subscriptions, one-time payments, checkout, invoices, webhooks |
| [`@beeblock/svelar-tags`](https://www.npmjs.com/package/@beeblock/svelar-tags) | Tagging with HasTags mixin, tag types, slugs, and tag input UI |
| [`@beeblock/svelar-impersonate`](https://www.npmjs.com/package/@beeblock/svelar-impersonate) | User impersonation with session guards and banner UI |
| [`@beeblock/svelar-sitemap`](https://www.npmjs.com/package/@beeblock/svelar-sitemap) | XML sitemap generation with scheduling and model discovery |

## CLI

```bash
npx svelar new my-app                  # scaffold with shadcn-svelte + all components
npx svelar update                      # update scaffold files without overwriting
npx svelar make:model Post -m -c       # model + migration + controller
npx svelar make:service PaymentService # service class
npx svelar make:job SendEmail          # queue job
npx svelar make:task CleanupTokens     # scheduled task
npx svelar make:test Auth --feature    # feature test
npx svelar make:factory User --model User  # model factory
npx svelar migrate                     # run migrations
npx svelar schedule:run                # start the scheduler
npx svelar queue:work                  # process queue jobs
npx svelar tinker                      # interactive REPL
npx svelar plugin:install @beeblock/svelar-tags  # install + publish

# Deployment
npx svelar make:deploy                 # scaffold Docker + CI/CD + infra
npx svelar make:docker                 # Dockerfile, compose files, health endpoint
npx svelar make:ci                     # GitHub Actions workflow
npx svelar make:infra                  # droplet setup script + env template
npx svelar infra:setup                 # provision droplet + copy files via SSH
npx svelar dev:up                      # start dev containers (hot-reload)
npx svelar dev:logs                    # follow dev container logs
npx svelar prod:deploy                 # pull latest image + restart prod
```

54 commands available. Run `npx svelar` to see all commands.

## Database Support

```bash
# SQLite (recommended for development)
npm install better-sqlite3

# PostgreSQL
npm install postgres

# MySQL
npm install mysql2
```

## Requirements

- Node.js >= 20
- SvelteKit >= 2.0

## License

MIT
