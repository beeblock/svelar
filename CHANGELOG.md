# Changelog

All notable changes to `@beeblock/svelar` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
