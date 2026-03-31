# Changelog

All notable changes to `@beeblock/svelar` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.3] - 2026-03-31

### Added

- **Full-text search module (`@beeblock/svelar/search`)** — Meilisearch integration with `Searchable` mixin for automatic index syncing on create/update/delete, `Search.withoutSyncing()` for bulk operations, `Model.search()`, `Model.makeAllSearchable()`, `Model.configureSearchIndex()`, and conditional indexing via `shouldBeSearchable()`
- **Meilisearch Docker support** — `npx svelar make:docker --meilisearch` adds a Meilisearch service (v1.13, no ports exposed, persistent volume, health check)
- **Security documentation** (`docs/30-security.md`) — secrets management, session security, password hashing, middleware pipeline, Docker hardening, port exposure guide, and production checklist
- **Per-command `--help`** — `npx svelar <command> --help` now shows all available flags and descriptions for that command
- **Tinker database bootstrap** — `npx svelar tinker` now calls `bootstrap()` to configure the database connection before starting the REPL

### Security

- **Docker: removed all unnecessary port exposures** — PostgreSQL, MySQL, Redis, Soketi, Gotenberg, and RustFS S3 API no longer expose ports to the host; only the app (3000) and RustFS console (9001) are exposed
- **Docker: Redis requires authentication** — Redis now starts with `--requirepass` and the password is passed to the app container via `REDIS_PASSWORD`
- **Docker: Meilisearch internal only** — no ports exposed by default, requires `MEILI_MASTER_KEY`

### Fixed

- **`ScheduleMonitor.listTasks()` missing `await`** — admin page server loader was not awaiting the async call, causing `scheduledTasks.map is not a function` error
- **Docs: removed incorrect `npm install` for bundled packages** — `pdfkit`, `exceljs`, `sveltekit-superforms`, and `zod` are included in scaffolded projects and don't need manual installation

### Removed

- **`make:dashboard` CLI command** — the full admin panel (7 tabs: overview, users, roles, permissions, queue, scheduler, logs) is now included in the scaffold by default

## [0.4.0] - 2026-03-31

### Security

- **Removed all hardcoded fallback secrets** — `APP_KEY` is now required; the framework throws a clear error if it's missing instead of silently using a known string (`'svelar-change-me'`, `'svelar-default-secret-change-me'`) for HMAC signing, sessions, and token hashing
- **Build output is now minified** — `tsup` builds with `minify: true` so compiled JS is obfuscated
- **Source maps disabled** — `sourcemap: false` in both tsup and tsconfig; no `.map` files are published to npm
- **Removed hardcoded Soketi defaults** — Docker template no longer falls back to `svelar-key`/`svelar-secret`; requires explicit `PUSHER_KEY`/`PUSHER_SECRET` env vars
- **INTERNAL_SECRET fallback removed** — scaffold broadcast bridge now throws if `INTERNAL_SECRET` is not set instead of using a known default

### Added

- **`key:generate` CLI command** — `npx svelar key:generate` generates a cryptographically random APP_KEY and writes it to `.env`; supports `--show` (display only) and `--force` (overwrite existing)
- **Auto-generated `.env` on scaffold** — `npx svelar new` now creates `.env` with unique random `APP_KEY` and `INTERNAL_SECRET` so projects work immediately without manual secret setup
- **Failed jobs system** — jobs that exhaust all retries are persisted to `svelar_failed_jobs` database table for later inspection and retry (like Laravel's `failed_jobs`)
- **`queue:failed` CLI command** — list all failed jobs with job class, queue, date, and error
- **`queue:retry` CLI command** — retry a specific failed job by ID, or `--all` to retry all
- **`queue:flush` CLI command** — delete all failed job records
- **Programmatic failed jobs API** — `Queue.failed()`, `Queue.retry(id)`, `Queue.retryAll()`, `Queue.forgetFailed(id)`, `Queue.flushFailed()`
- **`svelar_failed_jobs` migration** — auto-included in scaffolded projects (migration 00000008)

### Fixed

- **Documentation: all `npx @beeblock/svelar` references updated to `npx svelar`** — 113 occurrences across 7 doc files + README
- **Documentation: removed all fallback secret examples** — `|| 'dev-secret'`, `|| 'change-me'`, `|| 'svelar-internal-secret'` replaced with `process.env.APP_KEY!` across 10 doc files
- **Documentation: `weekly()` scheduler** — corrected from "Monday" to "Sunday" (cron day 0)
- **Documentation: `weeklyOn()` signature** — corrected from string day name to number (0-6)
- **Documentation: inline tasks API** — fixed example to use `task()` function + `scheduler.register()`
- **Documentation: duplicate `createTable`** — removed erroneous duplicate in queue migration example
- **Documentation: stale Quick Start** — removed unnecessary `cp .env.example .env` and manual `npx svelar migrate` steps (both auto-handled by `npx svelar new`)
- **Documentation: non-existent routes removed** — removed `/api/admin/stats`, `/queue`, `/scheduler`, `/logs`, `/health` and `/dashboard/billing` from getting-started (not scaffolded)
- **Documentation: added missing CLI commands** — `key:generate`, `queue:failed`, `queue:retry`, `queue:flush` added to installation docs
- **Seeder template warnings** — added production warnings to default admin/demo user credentials in scaffold

## [0.3.2] - 2026-03-30

### Added

- **Deployment documentation** — comprehensive `docs/29-deployment.md` covering Docker, PM2, Traefik reverse proxy, SSL/TLS, horizontal scaling, blue-green deployments (Docker Compose and Docker Swarm), database backups, monitoring, CI/CD pipelines (GitHub Actions, GitLab CI), security best practices, and troubleshooting
- **`SignatureMiddleware` export** — now properly exported from `@beeblock/svelar/middleware` (was implemented but inaccessible)
- **`support/index` build entry** — `@beeblock/svelar/support` now builds correctly via tsup

### Fixed

- **Dashboard `listTasks()` not awaited** — `getDashboardData()` now properly awaits `ScheduleMonitor.listTasks()` instead of returning a Promise object
- **Scheduler `start()` fire-and-forget** — `this.run()` calls in `start()` now have `.catch()` handlers so errors are logged instead of silently swallowed
- **`MakeDashboardCommand` async mismatch** — generated scheduler/stats routes now properly `await` `ScheduleMonitor.listTasks()` and `getHealth()`
- **Broken doc links** — fixed 3 incorrect internal links in `docs/19-error-handling.md` (`07-auth.md` → `06-authentication.md`, `04-middleware.md` → `07-middleware.md`, `05-validation.md` → `05-validation-dtos.md`)

### Changed

- **Removed `svelar-example` package** — the scaffold (`npx svelar new`) is now the canonical example; docs updated to reference "scaffolded Svelar project" instead
- **Updated monorepo workspaces** — `svelar-example` removed from root `package.json`
- **Development workflow updated** — `CLAUDE.md` now references scaffolded apps for testing instead of the example package

## [0.3.1] - 2026-03-29

### Added

- **Distributed scheduler locking** — `SchedulerLock` with database-backed distributed locks (`scheduler_locks` table, auto-created); prevents duplicate task execution across multiple scheduler instances (SQLite, PostgreSQL, MySQL)
- **Database-backed scheduler history** — `ScheduleMonitor` now reads/writes task run history to the database (`scheduler_history` table); all processes (CLI, web) share the same data
- **Scheduler minute-boundary alignment** — `schedule:run` now aligns ticks to the top of each minute like crontab, runs immediately on start
- **Full DDD admin domain in scaffold** — `npx svelar new` now generates a complete admin domain: `AdminService`, `AdminController` (thin), 10 FormRequest DTOs, `adminSchema` (Zod), `RoleResource`, `PermissionResource`
- **Rate limiting on auth endpoints** — scaffold wires `ThrottleMiddleware` on login, register, forgot-password, OTP send/verify, and reset-password API routes
- **Event-driven auth** — scaffold wires `UserRegistered` event, `SendWelcomeEmailListener`, `WelcomeNotification` (database channel), and `EventServiceProvider` boot
- **Auth config toggles** — scaffold exports `authConfig` with `AUTH_OTP_ENABLED` and `AUTH_EMAIL_VERIFICATION_REQUIRED` env-driven feature toggles
- **API Resources everywhere** — scaffold uses `UserResource`, `PostResource`, `RoleResource`, `PermissionResource` for all API responses (no raw objects)
- **Broadcasting in scaffold** — `PostService` broadcasts `post:created` on the `posts` channel; `app.ts` registers `private-user-*` and `presence-admin` channel auth
- **Audit trail in scaffold** — `User` and `Post` models wrapped with `auditable()`, audit driver set to `'database'`, `audit_logs` and `notifications` migrations included

### Changed

- **ScheduleMonitor API is now async** — `listTasks()`, `getTask()`, `getTaskHistory()`, `getHealth()` return Promises (breaking for direct callers, but only used internally by Dashboard)
- **Scaffold tasks fully implemented** — `CleanExpiredSessions`, `PruneAuditLogs`, `QueueHealthCheck` now have real implementations instead of stubs
- **Scaffold jobs fully implemented** — `DailyDigestJob` sends digest emails with stats; `ExportDataJob` writes CSV/JSON to Storage
- **Admin API routes use controller** — all 6 admin API routes delegate to `AdminController.handle()` instead of inline logic

### Fixed

- **Dashboard scheduler health** — `ScheduleMonitor.getHealth()` is now properly awaited

## [0.3.0] - 2026-03-29

### Added

- **JWT refresh tokens** — single-use rotation with HMAC-SHA256 hashed storage; `attemptJwt()` returns token pairs, `refreshJwt()` exchanges refresh tokens, `revokeRefreshTokens()` revokes all for a user
- **API request signature verification** — `SignatureMiddleware` validates HMAC-SHA256 signatures over timestamp+method+path+body with configurable tolerance
- **`signedFetch()` HTTP client** — client-side fetch wrapper that signs requests using Web Crypto API
- **Toaster customization** — `<Toaster>` now accepts `variants` prop for per-variant custom icons (any Svelte component), icon/border/progress/container classes, plus global `toastClass`, `titleClass`, `descriptionClass`, `actionClass`, `closeClass`, `progressBarClass` props
- **Improved toast icons** — default icons upgraded to Lucide-inspired CircleCheck, CircleX, TriangleAlert, and CircleInfo SVGs
- **CLI `.env` loading** — the CLI now reads `.env` files on startup (zero-dependency, does not override existing env vars)
- **Getting Started guide** — comprehensive `docs/00-getting-started.md` covering out-of-the-box features, setup, migrations, configuration, and building your first features
- **Error Handling documentation** — `docs/19-error-handling.md` with custom error pages, error boundaries, and API error responses
- **Architecture documentation** — `docs/20-architecture.md` covering DDD modular monolith structure
- **Feature Flags** — database-backed feature flags with per-user, per-team, and percentage rollout support; auto-creates `feature_flags` and `feature_flag_overrides` tables; `Features.configure()`, `Features.define()`, `Features.enabledFor()`, `Features.enabledForTeam()`
- **PDF PDFKit driver** — pure JavaScript PDF generation via PDFKit (default driver, no Docker needed); swappable with Gotenberg via `PDF.configure({ driver: 'gotenberg' })`; new `PDF.create()` for programmatic document building
- **Teams database driver** — full database-backed Teams implementation; auto-creates `teams`, `team_members`, `team_invitations` tables; SQLite, PostgreSQL, and MySQL support
- **NewCommand overhaul** — `npx svelar new` now scaffolds a complete SaaS application with ~75 files: auth pages, dashboard, admin panel, API routes, jobs, scheduled tasks, migrations, seeders, DDD domain layer
- **Feature Flags documentation** — `docs/21-feature-flags.md` with setup, usage, percentage rollouts, admin API examples
- **Postmark mail driver** — zero-dependency transactional email via Postmark REST API (`driver: 'postmark'`)
- **Resend mail driver** — zero-dependency transactional email via Resend REST API (`driver: 'resend'`)
- **Mail tags support** — `MailMessage.tags` and `Mailable.tag()` for analytics (Postmark and Resend)
- **Excel import/export** — ExcelJS-based spreadsheet generation and parsing with streaming support for large datasets; `Excel.export()`, `Excel.import()`, `Excel.stream()`, `Excel.importStream()`, and `Spreadsheet` builder
- **Server-side HTTP client** — fluent `Http` client for third-party API calls with authentication, retry, timeout, and error handling; `Http.withToken()`, `Http.withHeaders()`, `Http.withBasicAuth()`, `Http.retry()`, `Http.baseUrl()`
- **Custom mail driver support** — `driver: 'custom'` with `transport` field to plug in any `MailTransport` implementation (e.g., Mailchimp, SendGrid)
- **Password reset flow** — `auth.sendPasswordReset(email)`, `auth.resetPassword(token, email, password)`; auto-creates `password_resets` table; sends the built-in `password-reset` email template with a time-limited reset link
- **Email verification flow** — `auth.sendVerificationEmail(user)`, `auth.verifyEmail(token, userId)`, `auth.isEmailVerified(user)`; auto-creates `email_verifications` table; sends the built-in `email-verification` email template
- **OTP (one-time password) login** — `auth.sendOtp(email)`, `auth.verifyOtp(email, code)`, `auth.attemptOtp(email, code, session)`; generates 6-digit numeric codes; auto-creates `otp_codes` table; supports custom purposes for 2FA
- **OTP email template** — built-in `otp-code` email template with styled code display and expiry notice
- **Token cleanup** — `auth.cleanupExpiredTokens()` deletes expired records from password_resets, email_verifications, and otp_codes; wired into the scaffolded `CleanupExpiredTokens` scheduled task
- **Scaffolded auth routes** — `npx svelar new` now includes forgot-password, reset-password, OTP send/verify, and email verification API endpoints

### Changed

- **Admin System Health** — memory display now shows actual OS RAM usage (via `os.totalmem()`/`os.freemem()`) instead of V8 heap, with Node.js process memory as secondary detail
- **Admin Scheduler tab** — tasks now appear via `ScheduleMonitor` configured with task definitions in a server-only module; "Run Now" button executes tasks in-process with direct `Broadcast` access
- **BroadcastNotification task** — uses direct `Broadcast` singleton when running in-process (admin "Run Now"), falls back to HTTP bridge for CLI scheduler; gracefully skips when web server is unavailable
- **Documentation** — expanded authentication (cookie security, password hashing, CORS, JWT vs API tokens, refresh tokens, request signatures), middleware (CORS production config, SignatureMiddleware), UI components (Toaster customization), and cross-doc link references

### Fixed

- **Docs 404s** — internal markdown links (`./06-authentication.md`) now rewrite to `/docs/slug` in both svelar-example and svelar-site
- **Scheduler CLI errors** — broadcast task no longer dumps HTML error pages; strips trailing slashes from `APP_URL`; handles `ECONNREFUSED` gracefully

## [0.2.1] - 2026-03-27

### Changed

- **UI components now use native Tailwind v4 theme classes** — all components use `bg-brand`, `text-brand`, `ring-brand`, `border-brand` instead of `bg-[var(--color-brand)]` arbitrary values
- Updated scaffold template (`NewCommand`) to use native Tailwind v4 classes
- Updated `LanguageSwitcher` component to use native Tailwind v4 classes

### Fixed

- Removed all CSS arbitrary value syntax (`var(--color-brand)`) from UI components — components now work seamlessly with Tailwind v4 `@theme` configuration

## [0.2.0] - 2026-03-27

### Added

- **DDD Modular Monolith structure** — domain code organized by module (`src/lib/modules/<domain>/`), shared infrastructure in `src/lib/shared/`, database in `src/lib/database/`
- **API Resources (response transformers)** — `Resource<T>` base class for shaping API responses, similar to Laravel's `JsonResource`
  - `Resource.make()` for single resources, `Resource.collection()` for arrays
  - `.additional()` for metadata (pagination, aggregates)
  - `.wrapper()`, `.status()`, `.headers()`, `.toResponse()`, `.toObject()`
- **`make:resource` CLI command** — generates resource files into `src/lib/modules/<module>/`
  - `--module` flag to target specific domain module
  - `--model` flag to specify the model to transform
  - `--collection` flag to also generate a collection resource
- **`--module` flag on domain make commands** — `make:model`, `make:controller`, `make:service`, `make:repository`, `make:action`, `make:request` now accept `--module=<name>` to place files in the correct domain module
- **`./package.json` export** — added to exports map for Vite config resolution
- **Toaster component** — toast notification system with variants (success, error, warning, info), auto-dismiss, pause on hover, progress bar, and configurable positioning
- **Toast state management** — `toast()` function, `subscribe()`, `dismiss()`, `pauseToast()`, `resumeToast()` utilities

### Changed

- **Package renamed** from `svelar` to `@beeblock/svelar`
- **Icon libraries bundled** — `lucide-svelte` and `@tabler/icons-svelte` moved from peerDependencies to direct dependencies (install automatically with svelar)
- **Scaffold command updated** — `npx @beeblock/svelar new` generates DDD project structure with `@beeblock/svelar` imports
- **Shared make commands** — `make:middleware`, `make:job`, `make:task`, `make:channel`, `make:plugin`, `make:command`, `make:provider` now output to `src/lib/shared/<type>/`
- **All CLI templates** use `@beeblock/svelar/` import paths
- **Auto-discover** user commands path updated to `src/lib/shared/commands`

### Removed

- Duplicate `pusher-js` entry in peerDependencies

## [0.1.0] - 2026-03-26

### Added

- **Initial release** of the Svelar framework
- **ORM** — Eloquent-style query builder with relationships (hasOne, hasMany, belongsTo, belongsToMany), soft deletes, timestamps, scopes, and pagination
- **Database** — Migration system with SQLite, PostgreSQL, and MySQL support; seeder classes
- **Authentication** — Session-based auth, JWT auth, API token auth with guards and providers
- **Session management** — Cookie, memory, Redis, and database session stores with flash data
- **Middleware pipeline** — CORS, CSRF, rate limiting, authentication, and custom middleware support
- **Controllers & Routing** — Controller base class with response helpers (`json()`, `created()`, `noContent()`, `redirect()`, `html()`, `text()`) and `handle()` method for SvelteKit route wiring
- **Validation & DTOs** — `FormRequest` base class with Zod schema validation
- **Services, Actions & Repositories** — base classes for business logic architecture
- **Queue & Jobs** — In-memory and BullMQ (Redis) queue drivers with job dispatching and processing
- **Scheduler** — Cron-based task scheduling with fluent API (`everyMinute()`, `daily()`, `hourly()`, etc.)
- **Events & Listeners** — Event dispatcher with typed event/listener registration
- **Broadcasting** — SSE and Pusher/Soketi WebSocket support with channel authorization
- **Cache** — Memory and Redis cache drivers with TTL support
- **Storage** — Local and S3-compatible file storage with streams
- **Mail** — SMTP, log, and custom mail drivers with template support
- **Notifications** — Multi-channel notification system (mail, database, broadcast)
- **Logging** — File-based logger with log levels and rotation
- **Hashing** — scrypt and bcrypt password hashing
- **Config** — Environment-aware configuration management
- **Container** — IoC service container with singleton and transient bindings
- **Permissions** — Role-based access control with permissions and gates
- **HTTP Client** — Fetch-based HTTP client with interceptors
- **i18n** — Paraglide-js integration with language switcher component
- **Forms** — SvelteKit Superforms integration helpers
- **PDF** — Gotenberg-based PDF generation with queue job support
- **Audit logging** — Model change tracking
- **API Keys** — API key generation, validation, and management
- **Webhooks** — Webhook dispatch and signature verification
- **Teams** — Multi-tenant team management
- **Email Templates** — Database-stored email templates with variable interpolation
- **Uploads** — File upload handling with validation
- **UI Components** — Button, Card, Input, Label, Alert, Badge, Avatar, Icon, Tabs, Separator (Svelte 5, Tailwind v4)
- **Dashboard** — Admin dashboard scaffolding with job monitoring, schedule monitoring, and log viewer
- **Plugin system** — Plugin discovery, registration, config publishing, and npm installation
- **CLI** — 30+ commands for code generation, migrations, seeding, scheduling, queue processing, and project scaffolding
- **Docker deployment** — `make:docker` generates Dockerfile, docker-compose.yml, PM2 ecosystem config
