# Getting Started

Everything you need to go from zero to a running SaaS app in under 5 minutes.

## Create Your App

```bash
npx @beeblock/svelar new my-app
cd my-app
```

That's it. You now have a complete SaaS starter with authentication, dashboard, admin panel, teams, API keys, background jobs, and more — all pre-configured and ready to go.

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
| Billing | `/dashboard/billing` | Stripe integration placeholder (add your keys and go) |

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
  GET  /api/admin/stats        — System statistics
  GET  /api/admin/users        — List users
  PUT  /api/admin/users        — Update user role
  DELETE /api/admin/users      — Delete user
  GET  /api/admin/roles        — List roles
  POST /api/admin/roles        — Create role
  GET  /api/admin/permissions  — List permissions
  POST /api/admin/permissions  — Create permission
  POST /api/admin/role-permissions    — Assign permission to role
  POST /api/admin/user-roles         — Assign role to user
  GET  /api/admin/queue        — Queue job status
  GET  /api/admin/scheduler    — Scheduled task status
  GET  /api/admin/logs         — Application logs
  GET  /api/admin/health       — System health

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

### UI Components (Pre-built)

Svelar ships a component library themed with Tailwind CSS v4:

- `Button` — default, outline, destructive, ghost variants
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
- `Input`, `Label` — form elements
- `Badge` — status indicators
- `Alert` — info, success, destructive variants
- `Avatar`, `AvatarImage`, `AvatarFallback` — user avatars
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` — tabbed navigation
- `Separator` — visual dividers
- `Icon` — lucide-svelte icon wrapper
- `Toaster` — toast notifications with position, duration, action support

### Internationalization (Pre-configured)

Three locales ready out of the box: **English**, **Portuguese**, **Spanish**. A `LanguageSwitcher` component is in the layout. All UI text, error messages, and validation messages are translatable.

### Real-time Broadcasting (Pre-configured)

SSE-based real-time events. The layout already subscribes to a notifications channel and displays incoming events as toast notifications. Public, private (auth required), and presence (user metadata) channels are supported.

---

## Step-by-Step Setup

### 1. Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Required — generate with: openssl rand -hex 32
APP_KEY=your-random-secret-key-here

# Database (SQLite works out of the box, no extra setup)
DB_DRIVER=sqlite
DB_PATH=database.db

# Optional — uncomment for PostgreSQL in production
# DB_DRIVER=postgresql
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=myapp
# DB_USER=postgres
# DB_PASSWORD=secret

# Optional — for JWT auth (mobile apps, APIs)
# JWT_SECRET=your-jwt-secret

# Optional — for email sending
# MAIL_DRIVER=smtp
# MAIL_HOST=smtp.postmarkapp.com
# MAIL_PORT=587
# MAIL_USER=your-api-token
# MAIL_FROM=hello@myapp.com

# Optional — for Redis (cache, queue, sessions)
# REDIS_URL=redis://localhost:6379

# Optional — for real-time WebSockets (Pusher/Soketi)
# PUSHER_KEY=app-key
# PUSHER_SECRET=app-secret
# PUSHER_APP_ID=app-id
# PUSHER_HOST=localhost
# PUSHER_PORT=6001
```

> For development, only `APP_KEY` matters. Everything else has sensible defaults.

### 2. Run Migrations

```bash
npx @beeblock/svelar migrate
```

This creates the database tables: users, posts, sessions, roles, permissions, and all pivot tables.

Check what migrations ran:

```bash
npx @beeblock/svelar migrate --status
```

### 3. Seed Sample Data (Optional)

```bash
npx @beeblock/svelar seed:run
```

### 4. Start the Dev Server

```bash
npm run dev
```

Visit `http://localhost:5173`. You'll see the landing page. Click **Register** to create your first account.

### 5. Start the Scheduler (Separate Terminal)

```bash
npx @beeblock/svelar schedule:run
```

This starts the cron task runner. It checks every minute for tasks that need to run.

### 6. Start the Queue Worker (Separate Terminal)

```bash
npx @beeblock/svelar queue:work
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
# Create a new domain module (e.g., invoices)
npx @beeblock/svelar make:model Invoice --module=billing
npx @beeblock/svelar make:controller Invoice --module=billing
npx @beeblock/svelar make:service Billing --module=billing --crud
npx @beeblock/svelar make:repository Invoice --module=billing --model=Invoice
npx @beeblock/svelar make:schema Invoice --module=billing
npx @beeblock/svelar make:migration CreateInvoicesTable

# Create API routes
npx @beeblock/svelar make:route invoices --api --resource -c InvoiceController

# Create a background job
npx @beeblock/svelar make:job GenerateInvoicePdf

# Create a scheduled task
npx @beeblock/svelar make:task SendInvoiceReminders

# Create an event + listener
npx @beeblock/svelar make:event InvoicePaid
npx @beeblock/svelar make:listener NotifyCustomer --event=InvoicePaid
```

Every generator creates files in the right location following the DDD module structure. Run `npx @beeblock/svelar migrate` after creating migrations.

### The Pattern

For any new feature, the workflow is:

```
1. npx svelar make:model + make:migration   → Define your data
2. npx svelar migrate                        → Create the table
3. npx svelar make:schema                    → Define the contract (Zod types)
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
| **ORM** | `svelar/orm` | Eloquent-style query builder, models, relationships, eager loading |
| **Database** | `svelar/database` | Migrations, seeders, multi-driver (SQLite, PostgreSQL, MySQL) |
| **Routing** | `svelar/routing` | Controllers, FormRequests, Resources, response objects |
| **Validation** | `svelar/validation` | Zod-based validation with named rules |
| **Auth** | `svelar/auth` | Session, JWT, API token auth, gates, policies |
| **Middleware** | `svelar/middleware` | CORS, CSRF, rate limiting, origin validation, request signatures |
| **Session** | `svelar/session` | Cookie sessions with memory, database, file, or Redis store |
| **Hashing** | `svelar/hashing` | Password hashing (scrypt, bcrypt, argon2) |

### You'll Use for Business Logic

| Module | Import | What It Does |
|--------|--------|--------------|
| **Services** | `svelar/services` | Service base class with `ok()`/`fail()` result pattern |
| **Actions** | `svelar/actions` | Single-responsibility operations with hooks and middleware |
| **Repositories** | `svelar/repositories` | Data access layer with CRUD, pagination, scoped queries |
| **Events** | `svelar/events` | Pub/sub event system with typed listeners and subscribers |
| **Forms** | `svelar/forms` | SuperForms + Zod bridge for SvelteKit form actions |

### You'll Use for Infrastructure

| Module | Import | What It Does |
|--------|--------|--------------|
| **Queue** | `svelar/queue` | Background jobs with retry logic (sync, memory, database, Redis/BullMQ) |
| **Scheduler** | `svelar/scheduler` | Cron tasks with helpers: `daily()`, `hourly()`, `everyMinute()` |
| **Mail** | `svelar/mail` | Email sending with SMTP, templates, attachments |
| **Notifications** | `svelar/notifications` | Multi-channel notifications (mail, database, custom) |
| **Broadcasting** | `svelar/broadcasting` | Real-time SSE/WebSocket events with channel auth |
| **Cache** | `svelar/cache` | Multi-driver cache (memory, file, Redis) with `remember()` |
| **Storage** | `svelar/storage` | File storage (local, S3/MinIO/RustFS) with pre-signed URLs |
| **Logging** | `svelar/logging` | Structured logging with channels (console, file) |

### You'll Use for SaaS Features

| Module | Import | What It Does |
|--------|--------|--------------|
| **Teams** | `svelar/teams` | Multi-tenant workspaces with members, roles, invitations |
| **Permissions** | `svelar/permissions` | Spatie-inspired RBAC with roles, permissions, middleware |
| **API Keys** | `svelar/api-keys` | Generate, validate, revoke scoped API keys |
| **Audit** | `svelar/audit` | Track user actions (create, update, delete) for compliance |
| **Webhooks** | `svelar/webhooks` | Outgoing webhooks with HMAC signing and retry logic |
| **Uploads** | `svelar/uploads` | File upload tracking with MIME/size validation |
| **PDF** | `svelar/pdf` | PDF generation via Gotenberg (HTML, Markdown, screenshots) |
| **Email Templates** | `svelar/email-templates` | Reusable templates: welcome, password-reset, invoice, team-invite |

### You'll Use for Developer Experience

| Module | Import | What It Does |
|--------|--------|--------------|
| **CLI** | `svelar/cli` | 30+ code generators, migrations, scheduler, queue worker |
| **Container** | `svelar/container` | Dependency injection / IoC container |
| **Config** | `svelar/config` | Type-safe environment + config management |
| **Plugins** | `svelar/plugins` | Plugin architecture with lifecycle hooks |
| **HTTP** | `svelar/http` | CSRF-aware fetch, signed requests, typed responses |
| **i18n** | `svelar/i18n` | Paraglide integration for multi-language apps |
| **Dashboard** | `svelar/dashboard` | Admin dashboard data (health, queue, scheduler, logs) |
| **Errors** | `svelar/errors` | HTTP errors, `abort()` helpers, error handler |

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
npx @beeblock/svelar make:docker

# Build and start
docker compose up -d --build

# Run migrations in the container
docker compose exec app npx @beeblock/svelar migrate

# Seed data
docker compose exec app npx @beeblock/svelar seed:run
```

This sets up: your app (clustered via PM2), PostgreSQL, Redis, queue workers, scheduler, and optionally Soketi (WebSockets), Gotenberg (PDFs), and RustFS (S3-compatible storage).

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
