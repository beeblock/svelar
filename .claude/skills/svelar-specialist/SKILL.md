---
name: svelar-specialist
description: "Use when working on Svelar core or Svelar apps: scaffolding, migrations, ORM, auth, policies, permissions, teams, queues, cache, jobs, scheduler, mail, uploads/storage, PDF, search, SSE/Soketi broadcasting, webhooks, audit, Docker, browser testing, production certification, docs synchronization, or any @beeblock/svelar import."
---

# Svelar Specialist

Svelar is a Laravel-inspired TypeScript framework on SvelteKit 2. Treat the docs as the product contract, but verify implementation and tests before assuming a feature is production-ready.

## Non-Negotiable Rules

- Work on `packages/svelar` core first. Do not touch plugin packages unless the user explicitly asks.
- Use Svelar CLI commands to scaffold project artifacts whenever a generator exists. Prefer `npx svelar make:entity <Name> --module <module> --fields "<field:type,...>" --crud` for a full resource scaffold, and use focused generators when only one artifact is needed: `npx svelar new`, `npx svelar make:model`, `make:migration`, `make:controller`, `make:service`, `make:repository`, `make:schema`, `make:request`, `make:resource`, `make:action`, `make:job`, `make:task`, `make:command`, `make:route`, `make:docker`, `make:dashboard`, `make:broadcasting`.
- In DDD apps, module artifacts belong in layered folders: `domain/models`, `domain/events`, `domain/observers`, `domain/policies`, `application/actions`, `application/dto`, `application/listeners`, `application/notifications`, `application/services`, `infrastructure/repositories`, `interface/http/controllers`, `interface/http/requests`, `interface/http/resources`, and `contracts/schemas`.
- Prefer `$lib/...` aliases for app-owned imports, especially `$lib/modules/...`, `$lib/shared/...`, `$lib/database/...`, and `$lib/factories/...`. Keep relative imports only for local SvelteKit conventions like `./$types`, styles, same-component helper files, or files outside `src/lib` such as `src/app.ts`.
- Keep the Laravel-style flow consistent: route -> controller/page action -> FormRequest validation/authorization -> DTO -> action -> service -> repository -> model/resource -> response/action side effects.
- Use both FormRequest classes and DTOs for write paths. FormRequest owns validation and authorization with shared schema rules; DTOs carry validated data into services/actions. Do not pass raw `z.infer` objects or unvalidated `FormData` directly into services.
- For SvelteKit page forms, use shared schemas with Superforms when the feature contract says frontend and backend validation are shared. Avoid ad hoc page-action parsing in dogfood apps that are meant to prove Svelar conventions.
- Superforms must work end to end. Page actions using `use:enhance`/`superForm` must return a resource-like envelope that follows Svelar docs: `{ data: ... }` for the action payload and optional top-level `meta` for action name, message, form, validation errors, permissions, or other UI context. Do not invent top-level `status`/`ok`/`message` shapes per page. Include the posted Superform object in `meta.form` on success, validation failure, and service failure; otherwise enhanced submissions cannot update field state. Render validation failures inline under every input, set `aria-invalid`, and do not also show duplicate validation toasts/alerts for ordinary field errors. Disable controls from the action pending/delayed state, show visible success or service-level error feedback such as an alert/toast, and update response/result panels from the action result instead of waiting for cached `load` data or manual browser refresh.
- Use Svelar ORM, models, repositories, and migrations. Avoid raw SQL except explicit infrastructure-level driver behavior that the ORM cannot represent yet.
- Create separate migrations per table. Do not hide many unrelated tables in one migration.
- Store public API identifiers in UUID v7 or ULID columns when integer primary keys are kept internal.
- Use soft deletes and traits/mixins where the feature contract expects Laravel-like model behavior.
- Support SQLite, PostgreSQL, and MySQL out of the box. Database changes need cross-driver tests when feasible.
- For PostgreSQL production testing, include PgBouncer with prepared statements disabled and `pg_stat_statements` enabled for slow-query visibility.
- Use RustFS for S3-compatible local object storage. Do not introduce MinIO.
- Keep optional Node adapters externalized for production builds where needed: `bcrypt`, `argon2`, `bullmq`, `ioredis`, `meilisearch`, `@aws-sdk/client-s3`, and `@aws-sdk/s3-request-presigner`.
- When documentation changes in this repo, mirror the same change in `/Users/rzeradev/projects/beeblock/svelar-docs/` and keep `/Users/rzeradev/projects/beeblock/svelar-docs/src/routes/api/search/+server.ts` aligned.
- When building a dogfood app, keep a step-by-step timeline in the app docs and validate behavior in the browser.
- PDF tests that claim Gotenberg coverage must set `PDF_DRIVER=gotenberg`; a healthy Gotenberg container alone is not enough.
- Realtime tests should cover SSE and Soketi/Pusher separately. A Soketi health ping is not enough; prove visible cross-browser updates.
- Storage tests should prove upload metadata, storage writes, browser-safe authorized reads, and previews when applicable. Do not render internal Docker service URLs such as `http://rustfs:9000/...` to browser users.

## Core Imports

Use module subpaths from `@beeblock/svelar`:

```ts
import { Model, SoftDeletes } from '@beeblock/svelar/orm';
import { Migration } from '@beeblock/svelar/database';
import { Controller } from '@beeblock/svelar/routing';
import { z } from '@beeblock/svelar/validation';
import { AuthManager } from '@beeblock/svelar/auth';
import { Hash } from '@beeblock/svelar/hashing';
import { Cache } from '@beeblock/svelar/cache';
import { Queue, Job } from '@beeblock/svelar/queue';
import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Storage } from '@beeblock/svelar/storage';
import { Uploads } from '@beeblock/svelar/uploads';
import { Search, Searchable } from '@beeblock/svelar/search';
import { PDF } from '@beeblock/svelar/pdf';
import { Broadcast } from '@beeblock/svelar/broadcasting';
import { Audit } from '@beeblock/svelar/audit';
import { Webhooks } from '@beeblock/svelar/webhooks';
import { Teams } from '@beeblock/svelar/teams';
import { Permissions } from '@beeblock/svelar/permissions';
import { ApiKeys } from '@beeblock/svelar/api-keys';
import { createSvelarApp } from '@beeblock/svelar/hooks';
import { config, env } from '@beeblock/svelar/config';
```

Use `$lib` aliases for generated app/module imports:

```ts
import { BoardService } from '$lib/modules/boards/application/services/BoardService.js';
import { Board } from '$lib/modules/boards/domain/models/Board.js';
import { EventServiceProvider } from '$lib/shared/providers/EventServiceProvider.js';
```

Use local shadcn-svelte UI from the generated app for application screens. Use Svelar UI components only for framework/dashboard internals or documented Svelar UI surfaces.

## Svelte Rules

- Use Svelte 5 runes in `.svelte` files: `$props`, `$state`, `$derived`, `$effect`, `{@render children()}`.
- Do not use runes in `.ts` files shipped from `packages/svelar`; use normal TypeScript state or subscriber patterns.
- Import lucide icons individually, for example `lucide-svelte/icons/users`; do not import from the lucide barrel.
- Keep app screens usable first. Avoid landing pages for tools and dashboards.

## Feature Shape

Prefer this module shape for app features:

```txt
src/lib/modules/<feature>/
  contracts/schemas/<feature>.schema.ts
  domain/models/<Model>.ts
  domain/events/<Event>.ts
  domain/observers/<Observer>.ts
  domain/policies/<Policy>.ts
  application/actions/<Action>.ts
  application/dto/<Dto>.ts
  application/listeners/<Listener>.ts
  application/services/<Service>.ts
  infrastructure/repositories/<Repository>.ts
  interface/http/controllers/<Controller>.ts
  interface/http/requests/<Request>.ts
  interface/http/resources/<Resource>.ts

src/lib/database/migrations/
  YYYYMMDDHHMMSS_create_<table>_table.ts

src/routes/
  dashboard/<feature>/
  api/<feature>/
```

For production hardening, cover the behavior with CLI tests, unit/integration tests, and a real app smoke test when the feature touches runtime services.

## Feature Coverage

When hardening Svelar core or dogfooding an app, explicitly cover:

- CLI: `new`, make commands, migrations, seeders, `routes:list`, `tinker`, custom commands, scheduler commands, queue workers.
- Database/ORM: migrations, schema builder, query builder, models, repositories, relationships, casts, fillable rules, soft deletes, traits/mixins, integer IDs plus UUID v7/ULID public IDs, SQLite/PostgreSQL/MySQL behavior.
- Auth/security: sessions, CSRF, password hashing, optional bcrypt/argon2 externals, API tokens, refresh tokens, OTP, email verification, password reset, rate limiting, middleware.
- Authorization: policies, permissions, roles, teams, team-scoped resource access, admin-only routes, API and page enforcement.
- App flow: route -> controller/page action -> FormRequest/shared schema validation -> DTO -> action -> service -> repository -> model/resource -> response. Keep side effects in actions/services.
- Cross-module reads use a narrow public application service/query/facade from the owning module and should return plain contract/DTO data, not another module's ORM model. Events are for side effects, not request/response queries. Controllers, repositories, and models are not cross-module APIs.
- Frontend forms: Superforms with action results that follow `{ data, meta }` resource shape with `meta.form` for Superforms state, visible inline validation messages for every field without duplicate validation toasts, disabled/loading states that always clear after failures, visible success/service-error feedback, live response/result updates after 200 responses, reset-on-success where appropriate, and no stale inputs after successful create/comment/upload actions.
- Queues/cache: Redis cache, BullMQ async jobs, sync/database queue fallbacks, retries, finite `--once` workers, queue dashboard visibility.
- Scheduler/events/observers: scheduled tasks, custom commands, events/listeners, observers, audit logs, webhooks, exception handler behavior.
- Storage/uploads: local and S3-compatible disks, RustFS Docker service, upload metadata, authorized app download/proxy routes, image previews, no leaked internal S3 endpoints.
- PDF/mail/search: Gotenberg sync and webhook flows, PDF storage/download, Postmark/Resend/Mailtrap/log drivers, Meilisearch indexing/search/fallbacks.
- Realtime: SSE streams and Soketi/Pusher websocket events tested separately with visible cross-browser updates.
- Production Docker: adapter-node, optional dependency externals, PgBouncer with `DB_PREPARE=false`, `pg_stat_statements`, non-default local ports, healthchecks, GitHub Actions-safe build behavior.
- Observability: logs, audit trail, runtime health checks, failed job visibility, exception rendering/reporting.

## Dogfood App Standard

A dogfood app must expose user workflows that prove Svelar features, not only service health pings:

- Start with Svelar CLI scaffolding and fill in generated artifacts.
- Keep a step-by-step timeline in the app docs for material work and verification.
- Use the feature being tested in a visible workflow. Upload tests should show browser-safe previews/downloads; Soketi tests should update a second browser without refresh; Gotenberg webhook tests should update a queue/listing screen.
- Test with real Docker services where possible: Postgres/PgBouncer, Redis/BullMQ/cache, RustFS, Gotenberg, Meilisearch, Soketi, and mail provider adapters under review.
- Validate browser UX: loading states, empty states, inline validation errors without duplicate toasts, toast/alert feedback for successful actions and service failures, response panels that refresh immediately after successful enhanced submissions, realtime updates, and no stale form state.

## Migrations

```ts
import { Migration } from '@beeblock/svelar/database';

export default class CreateBoardsTable extends Migration {
  async up() {
    await this.schema.createTable('boards', (table) => {
      table.increments();
      table.ulid('public_id').unique();
      table.string('name');
      table.integer('owner_id').unsigned().references('id', 'users').onDelete('CASCADE');
      table.timestamps();
      table.softDeletes();
    });
  }

  async down() {
    await this.schema.dropTableIfExists('boards');
  }
}
```

Use `.default(value)`, not `.defaultTo(value)`. Use `addColumn` and `dropColumn`; do not invent `alterTable`.

## Production Certification

Before release, prefer:

```sh
npm run build
npm test
npm run release:dry-run
npm run certify
```

For real app verification, create sibling apps under `/Users/rzeradev/projects/beeblock/svelar-testing-area/`, run Docker services on non-default host ports, and test in the browser with Postgres/PgBouncer, Redis/BullMQ/cache, RustFS, Gotenberg, Meilisearch, queues, scheduler, auth/session/API tokens, policies/permissions, teams, webhooks, uploads, PDF, SSE, Soketi/Pusher realtime, logs, audit, exception handling, CLI commands, and tinker.
