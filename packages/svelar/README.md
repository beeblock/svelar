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

Or add to an existing SvelteKit project:

```bash
npm install @beeblock/svelar
```

See the [Getting Started guide](https://svelar.dev/docs/getting-started) for a complete walkthrough.

## Features

| Module | Import | Description |
|--------|--------|-------------|
| **ORM** | `svelar/orm` | Eloquent-style models with relationships, soft deletes, scopes, eager loading |
| **Database** | `svelar/database` | Schema builder, migrations, seeders (SQLite, PostgreSQL, MySQL) |
| **Auth** | `svelar/auth` | Session, JWT (with refresh tokens), API tokens, password reset, email verification, OTP login |
| **Middleware** | `svelar/middleware` | CORS, CSRF, rate limiting, origin validation, request signatures |
| **Routing** | `svelar/routing` | Controllers, form requests, API resources, response helpers |
| **Validation** | `svelar/validation` | Zod-based validation with FormRequest DTOs |
| **Session** | `svelar/session` | Cookie, memory, Redis, and database session stores |
| **Hashing** | `svelar/hashing` | scrypt (zero-dep), bcrypt, argon2 |
| **Queue** | `svelar/queue` | Job dispatching with sync, memory, and Redis (BullMQ) drivers |
| **Scheduler** | `svelar/scheduler` | Cron-based task scheduling with distributed locking and DB history |
| **Events** | `svelar/events` | Typed event dispatcher with listeners and subscribers |
| **Broadcasting** | `svelar/broadcasting` | Server-Sent Events and Pusher/Soketi WebSocket support |
| **Cache** | `svelar/cache` | Memory and Redis cache with TTL and remember pattern |
| **Storage** | `svelar/storage` | Local and S3-compatible file storage |
| **Mail** | `svelar/mail` | SMTP, Postmark, Resend, log, and null transports with Mailable classes |
| **Excel** | `svelar/excel` | Import/export Excel files with streaming support for large datasets |
| **Notifications** | `svelar/notifications` | Multi-channel notifications (mail, database, broadcast) |
| **Logging** | `svelar/logging` | File-based logger with levels and rotation |
| **HTTP Client** | `svelar/http` | Client-side CSRF fetch + server-side fluent HTTP client for third-party APIs |
| **Permissions** | `svelar/permissions` | Role-based access control with permissions and gates |
| **i18n** | `svelar/i18n` | Paraglide-js integration with language switcher |
| **Forms** | `svelar/forms` | SvelteKit Superforms integration helpers |
| **UI Components** | `svelar/ui` | Minimal built-in components + [shadcn-svelte](https://shadcn-svelte.com) pre-installed |
| **SEO** | `svelar/ui` | `<Seo>` component for meta tags, Open Graph, Twitter Cards, JSON-LD structured data |
| **Hooks** | `svelar/hooks` | One-line SvelteKit hooks setup with sensible defaults |
| **Container** | `svelar/container` | IoC container with singleton/transient bindings |
| **Plugins** | `svelar/plugins` | Plugin discovery, publishing, and CLI management |
| **PDF** | `svelar/pdf` | PDF generation with PDFKit (default) and Gotenberg drivers |
| **Feature Flags** | `svelar/feature-flags` | Per-user, per-team, and percentage rollout feature flags |
| **Audit** | `svelar/audit` | Model change tracking |
| **API Keys** | `svelar/api-keys` | API key generation, validation, and management |
| **Webhooks** | `svelar/webhooks` | Webhook dispatch and signature verification |
| **Teams** | `svelar/teams` | Multi-tenant team management with database-backed storage |
| **Email Templates** | `svelar/email-templates` | Database-stored templates with variable interpolation |
| **Uploads** | `svelar/uploads` | File upload handling with validation (local + S3) |
| **Dashboard** | `svelar/dashboard` | Admin dashboard with job/scheduler monitoring and log viewer |
| **Search** | `svelar/search` | Meilisearch integration with auto-syncing `Searchable` mixin |
| **Testing** | `svelar/testing` | Factory, `useSvelarTest()`, `refreshDatabase()`, `actingAs()`, database assertions |

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
npx svelar plugin:list                 # list discovered plugins
npx svelar plugin:install @beeblock/svelar-tags  # install + publish
npx svelar plugin:publish @beeblock/svelar-tags  # publish migrations & routes
```

44 commands available. Run `npx svelar` to see all commands.

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
