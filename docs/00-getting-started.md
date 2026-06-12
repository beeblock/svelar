# Getting Started

Everything you need to go from zero to a running SaaS app in under 5 minutes.

## Create Your App

```bash
npx @beeblock/svelar new my-app
cd my-app
npm run dev
```

That's it. The `new` command installs dependencies, generates `.env` with secure random `APP_KEY` and `INTERNAL_SECRET`, runs migrations, and seeds the database. You now have a complete SaaS starter with authentication, dashboard, admin panel, teams, API keys, background jobs, and more — all pre-configured and ready to go.

By default, projects use a **DDD modular structure** (`src/lib/modules/{domain}/...`) with domain, application, infrastructure, interface, and contract layers inside each module. If you prefer a traditional flat layout, use `--flat`:

```bash
npx @beeblock/svelar new my-app --flat   # src/lib/models/, src/lib/services/, etc.
```

## What You Get Out of the Box

When you run `npx @beeblock/svelar new`, Svelar scaffolds a full-featured application. Here's everything that's included and working from day one:

### Authentication (Ready to Use)

| Feature | URL | What It Does |
|---------|-----|--------------|
| Registration | `/register` | Full sign-up form with validation |
| Login | `/login` | Email + password login with session cookie |
| Logout | via dashboard | Destroys session, regenerates ID |
| Forgot Password | `/forgot-password` | Password reset request flow |
| Current User API | `GET /api/auth/me` | Returns authenticated user data |

All auth pages are pre-built with styled forms and validation. Passwords are hashed with scrypt (zero dependencies). Sessions are signed cookies stored in the database so they survive server restarts.

### User Dashboard (Ready to Use)

| Page | URL | What It Does |
|------|-----|--------------|
| Overview | `/dashboard` | Stats, recent activity, getting started checklist |
| API Keys | `/dashboard/api-keys` | Create, copy, revoke API keys with scoped permissions |
| Team | `/dashboard/team` | Create team, invite members, assign roles, manage invitations |

### Admin Panel (Ready to Use)

The admin panel at `/admin` has 7 tabs:

| Tab | What It Does |
|-----|--------------|
| **Overview** | System health: uptime, memory, user count, queue depth, error count |
| **Users** | List all users, assign roles/permissions, promote/demote admins, delete users |
| **Roles** | Create roles, assign permissions with visual toggle matrix |
| **Permissions** | Create permissions, see which roles use each one |
| **Queue** | Monitor jobs: waiting, active, failed, completed. Retry failed jobs |
| **Scheduler** | View all cron tasks, next/last run, enable/disable, run manually |
| **Logs** | Browse application logs, filter by level (info, warning, error) |

### API Endpoints (Ready to Use)

These API routes work immediately after running migrations:

```
Auth:
  POST /api/auth/register      — Create account
  POST /api/auth/login         — Login (session cookie)
  POST /api/auth/logout        — Logout
  GET  /api/auth/me            — Current user

Content (example):
  GET  /api/posts              — List published posts
  POST /api/posts              — Create post (auth required)
  GET  /api/posts/:id          — Get post
  PUT  /api/posts/:id          — Update post (owner/admin)
  GET  /api/posts/mine         — Current user's posts

Admin:
  GET  /api/admin/users        — List users
  PUT  /api/admin/users        — Update user role
  DELETE /api/admin/users      — Delete user
  POST /api/admin/roles        — Create role
  DELETE /api/admin/roles      — Delete role
  POST /api/admin/permissions  — Create permission
  DELETE /api/admin/permissions — Delete permission
  POST /api/admin/role-permissions    — Assign permission to role
  POST /api/admin/user-roles         — Assign role to user
  POST /api/admin/user-permissions   — Grant direct user permission
  GET  /api/admin/export       — Export data

Real-time:
  GET  /api/broadcasting/:channel — SSE subscription

System:
  GET  /api/health             — Health check
```

### Background Jobs (Pre-configured)

These jobs are scaffolded and ready to dispatch:

| Job | Trigger | What It Does |
|-----|---------|--------------|
| `SendWelcomeEmail` | User registration | Sends welcome email (3 retries) |
| `DailyDigestJob` | Scheduler (daily) | Sends activity digest |
| `ExportDataJob` | On demand | Exports data in background |

### Scheduled Tasks (Pre-configured)

These cron tasks run automatically when you start the scheduler:

| Task | Schedule | What It Does |
|------|----------|--------------|
| `DailyDigestEmail` | 09:00 AM daily | Dispatches digest job |
| `CleanupExpiredTokens` | Midnight daily | Removes expired auth tokens |
| `CleanExpiredSessions` | Periodic | Cleans up old sessions |
| `PruneAuditLogs` | Periodic | Removes old audit entries |
| `QueueHealthCheck` | Periodic | Monitors queue health |

### UI Components (Pre-installed)

Svelar scaffolds projects with **[shadcn-svelte](https://shadcn-svelte.com)** — a comprehensive component library with 50+ components including Dialog, Dropdown, Select, Combobox, Calendar, Sheet, Command Palette, Data Table, and more. All components are installed at `$lib/components/ui/` and ready to use.

Dark mode is supported out of the box via `mode-watcher`. Import components from `$lib/components/ui/`:

```svelte
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
```

Svelar also ships its own minimal components (`@beeblock/svelar/ui`) used internally by the dashboard and admin panel: `Button`, `Card`, `Input`, `Label`, `Badge`, `Alert`, `Avatar`, `Tabs`, `Separator`, `Icon`, and `Toaster`.

> You're not locked into shadcn-svelte — use any CSS framework or component library you prefer.

### Internationalization (Pre-configured)

Three locales ready out of the box: **English**, **Portuguese**, **Spanish**. A `LanguageSwitcher` component is in the layout. All UI text, error messages, and validation messages are translatable.

### Real-time Broadcasting (Pre-configured)

SSE-based real-time events. The layout already subscribes to a notifications channel and displays incoming events as toast notifications. Public, private (auth required), and presence (user metadata) channels are supported.

---

## Step-by-Step Setup

### 1. Environment Variables

`npx @beeblock/svelar new` automatically generates a `.env` file with secure random `APP_KEY` and `INTERNAL_SECRET`. No manual setup needed.

To regenerate your app key at any time:

```bash
npx svelar key:generate
```

For existing projects or if you need to recreate `.env`:

```bash
cp .env.example .env
npx svelar key:generate
```

### 2. Run Migrations

If you used `npx @beeblock/svelar new`, migrations and seeding already ran automatically. For manual setup:

```bash
npx svelar migrate
```

This creates the database tables: users, posts, sessions, roles, permissions, audit logs, notifications, failed jobs, and all pivot tables.

Check what migrations ran:

```bash
npx svelar migrate --status
```

### 3. Seed Sample Data (Optional)

```bash
npx svelar seed:run
```

### 4. Start the Dev Server

```bash
npm run dev
```

Visit `http://localhost:5173`. You'll see the landing page. Click **Register** to create your first account.

### 5. Start the Scheduler (Separate Terminal)

```bash
npx svelar schedule:run
```

This starts the cron task runner. It checks every minute for tasks that need to run.

### 6. Start the Queue Worker (Separate Terminal)

```bash
npx svelar queue:work
```

This processes background jobs (welcome emails, data exports, etc.).

---

## Your First 10 Minutes

After setup, here's what to try:

1. **Register** at `/register` — creates your account
2. **Visit `/dashboard`** — see the overview with stats and checklist
3. **Create an API key** at `/dashboard/api-keys` — try copying it and calling `GET /api/auth/me` with it
4. **Create a team** at `/dashboard/team` — invite a team member
5. **Visit `/admin`** — browse users, create roles, check system health
6. **Create a post** via API:
   ```bash
   curl -X POST http://localhost:5173/api/posts \
     -H "Content-Type: application/json" \
     -H "Cookie: svelar_session=<your-cookie>" \
     -d '{"title": "Hello World", "body": "My first post", "published": true}'
   ```

---

## Building Your Features

Svelar handles the repetitive SaaS infrastructure. You focus on your core business logic.

### Generate Domain Code

```bash
# Create a new resource inside a domain module
npx svelar make:entity Invoice --module=billing --fields "title:string,total:number,status:enum(draft,paid)" --crud

# Or generate individual artifacts when you only need one file
npx svelar make:model Invoice --module=billing
npx svelar make:controller Invoice --module=billing
npx svelar make:schema Invoice --module=billing

# Create API routes
npx svelar make:route invoices --api --resource -c InvoiceController

# Create a background job
npx svelar make:job GenerateInvoicePdf

# Create a scheduled task
npx svelar make:task SendInvoiceReminders

# Create an event + listener (in the billing module)
npx svelar make:event InvoicePaid --module=billing
npx svelar make:listener NotifyCustomer --event=InvoicePaid --module=billing
```

Every generator creates files in the right layered module location. `make:entity` creates the model, contract schema, DTOs, FormRequests, actions, resource, repository, service, controller, and a focused migration. Run `npx svelar migrate` after creating migrations.

### The Pattern

For any new feature, the workflow is:

```
1. npx svelar make:entity or make:model + make:migration → Define your data
2. npx svelar migrate                        → Create the table
3. npx svelar make:schema                    -> Define the contract (Zod or Valibot types)
4. npx svelar make:controller + make:service → Handle requests + business logic
5. npx svelar make:route                     → Wire up API endpoints
6. Build your UI in src/routes/              → Svelte pages
```

---

## Core Modules Reference

Svelar ships 35+ modules. Here's what each one does and when you'll use it:

### You'll Use Every Day

| Module | Import | What It Does |
|--------|--------|--------------|
| **ORM** | `@beeblock/svelar/orm` | Eloquent-style query builder, models, relationships, eager loading |
| **Database** | `@beeblock/svelar/database` | Migrations, seeders, multi-driver (SQLite, PostgreSQL, MySQL) |
| **Routing** | `@beeblock/svelar/routing` | Controllers, FormRequests, Resources, response objects |
| **Validation** | `@beeblock/svelar/validation` | Zod helpers; FormRequest also accepts Valibot schemas |
| **Auth** | `@beeblock/svelar/auth` | Session, JWT, API token auth, gates, policies |
| **Middleware** | `@beeblock/svelar/middleware` | CORS, CSRF, rate limiting, origin validation, request signatures |
| **Session** | `@beeblock/svelar/session` | Cookie sessions with memory, database, file, or Redis store |
| **Hashing** | `@beeblock/svelar/hashing` | Password hashing (scrypt, bcrypt, argon2) |

### You'll Use for Business Logic

| Module | Import | What It Does |
|--------|--------|--------------|
| **Services** | `@beeblock/svelar/services` | Service base class with `ok()`/`fail()` result pattern |
| **Actions** | `@beeblock/svelar/actions` | Single-responsibility operations with hooks and middleware |
| **Repositories** | `@beeblock/svelar/repositories` | Data access layer with CRUD, pagination, scoped queries |
| **Events** | `@beeblock/svelar/events` | Pub/sub event system with typed listeners and subscribers |
| **Forms** | `@beeblock/svelar/forms` | SuperForms bridge for Zod or Valibot form actions |

### You'll Use for Infrastructure

| Module | Import | What It Does |
|--------|--------|--------------|
| **Queue** | `@beeblock/svelar/queue` | Background jobs with retry logic (sync, memory, database, Redis/BullMQ) |
| **Scheduler** | `@beeblock/svelar/scheduler` | Cron tasks with helpers: `daily()`, `hourly()`, `everyMinute()` |
| **Mail** | `@beeblock/svelar/mail` | Email sending with SMTP, Postmark, Resend, log, and null drivers |
| **Notifications** | `@beeblock/svelar/notifications` | Multi-channel notifications (mail, database, custom) |
| **Broadcasting** | `@beeblock/svelar/broadcasting` | Real-time SSE/WebSocket events with channel auth |
| **Cache** | `@beeblock/svelar/cache` | Multi-driver cache (memory, file, Redis) with `remember()` |
| **Storage** | `@beeblock/svelar/storage` | File storage (local, S3/RustFS) with pre-signed URLs |
| **Logging** | `@beeblock/svelar/logging` | Structured logging with channels (console, file) |

### You'll Use for SaaS Features

| Module | Import | What It Does |
|--------|--------|--------------|
| **Teams** | `@beeblock/svelar/teams` | Multi-tenant workspaces with members, roles, invitations |
| **Permissions** | `@beeblock/svelar/permissions` | Spatie-inspired RBAC with roles, permissions, middleware |
| **API Keys** | `@beeblock/svelar/api-keys` | Generate, validate, revoke scoped API keys |
| **Audit** | `@beeblock/svelar/audit` | Track user actions (create, update, delete) for compliance |
| **Webhooks** | `@beeblock/svelar/webhooks` | Outgoing webhooks with HMAC signing and retry logic |
| **Uploads** | `@beeblock/svelar/uploads` | File upload tracking with MIME/size validation |
| **PDF** | `@beeblock/svelar/pdf` | PDF generation via PDFKit (default) or Gotenberg |
| **Email Templates** | `@beeblock/svelar/email-templates` | Reusable templates: welcome, password-reset, invoice, team-invite |

Most first-party facades are also available from the root package, for example `import { PDF, ApiKeys, Teams } from '@beeblock/svelar'`. Subpath imports remain supported when you want a narrower import.

### You'll Use for Developer Experience

| Module | Import | What It Does |
|--------|--------|--------------|
| **CLI** | `@beeblock/svelar/cli` | 30+ code generators, migrations, scheduler, queue worker |
| **Container** | `@beeblock/svelar/container` | Dependency injection / IoC container |
| **Config** | `@beeblock/svelar/config` | Type-safe environment + config management |
| **Plugins** | `@beeblock/svelar/plugins` | Plugin architecture with lifecycle hooks |
| **HTTP** | `@beeblock/svelar/http` | CSRF-aware fetch, signed requests, typed responses |
| **i18n** | `@beeblock/svelar/i18n` | Paraglide integration for multi-language apps |
| **Dashboard** | `@beeblock/svelar/dashboard` | Admin dashboard data (health, queue, scheduler, logs) |
| **Errors** | `@beeblock/svelar/errors` | HTTP errors, `abort()` helpers, error handler |

---

## Built-in Email Templates

These templates are registered and ready to use with `EmailTemplates.render()`:

| Template | Variables | Use Case |
|----------|-----------|----------|
| `welcome` | `name` | New user registration |
| `password-reset` | `name`, `resetUrl` | Forgot password flow |
| `email-verification` | `name`, `verifyUrl` | Verify email address |
| `team-invitation` | `teamName`, `inviterName`, `acceptUrl` | Team member invite |
| `invoice` | `invoiceNumber`, `amount`, `dueDate` | Payment invoice |
| `subscription-confirmation` | `planName`, `amount` | Subscription started |
| `subscription-canceled` | `planName`, `endDate` | Subscription ended |

---

## Pre-configured Security

All of this is enabled by default when you use `createSvelarApp`:

| Protection | What It Does |
|------------|--------------|
| **CSRF** | Double-submit cookie pattern on all `/api/` POST/PUT/DELETE requests |
| **Origin Validation** | Blocks cross-origin mutations (OriginMiddleware) |
| **Rate Limiting** | 100 requests/minute per IP globally |
| **Auth Throttling** | 5 failed login attempts before lockout |
| **Session Security** | `httpOnly`, `secure` in production, `sameSite: lax` |
| **Password Hashing** | scrypt with timing-safe comparison |
| **Session Fixation** | Auto-regenerate session ID on login/logout |
| **Bearer Token Bypass** | API calls with Bearer tokens skip CSRF (not vulnerable) |

---

## Production Deployment

When you're ready to deploy:

```bash
# Generate Docker files
npx svelar make:docker

# Build and start
docker compose up -d --build

# Run migrations in the container
docker compose exec app npx svelar migrate

# Seed data
docker compose exec app npx svelar seed:run
```

This sets up: your adapter-node app, PostgreSQL through PgBouncer, Redis, Soketi (WebSockets), Gotenberg (PDFs), RustFS (S3-compatible storage), and Meilisearch.

See the [Production Checklist](./17-saas-guide.md#production-checklist) for the full list.

---

## What You Bring

Svelar handles the infrastructure. You bring:

- **Your API keys** — Stripe, Postmark/Resend, analytics, etc.
- **Your business logic** — the domain models, services, and rules unique to your product
- **Your UI** — Svelte pages for your product features (the layout, auth, and dashboard are already done)

Everything else — auth, sessions, roles, teams, API keys, jobs, scheduling, emails, file storage, audit logs, admin panel — is already built and waiting for you.

## Next Steps

- [Database](./02-database.md) — Customize migrations and switch to PostgreSQL
- [Models & ORM](./03-models-orm.md) — Define your domain models
- [Controllers & Routing](./04-controllers-routing.md) — Build your API
- [Authentication](./06-authentication.md) — JWT, refresh tokens, request signatures
- [Architecture](./20-architecture.md) — DDD module boundaries and patterns
- [SaaS Guide](./17-saas-guide.md) — Multi-tenancy, billing, and production deployment

---

**Svelar** — The Laravel of SvelteKit. Build your SaaS, not your infrastructure.
