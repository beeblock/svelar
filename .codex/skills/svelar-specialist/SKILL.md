---
name: svelar-specialist
description: Use when working on Svelar core or Svelar apps, including scaffolding, ORM, migrations, auth, policies, permissions, teams, queues, cache, storage, PDF, search, SSE/Soketi broadcasting, docs sync, Docker, browser testing, or production certification.
---

# Svelar Specialist

Svelar is a Laravel-inspired TypeScript framework on SvelteKit 2. Work from the docs contract, but verify code, generated templates, tests, and runtime behavior together.

## Rules

- Focus `packages/svelar` core unless plugins are explicitly requested.
- Scaffold with Svelar CLI commands whenever available. Prefer `npx svelar make:entity <Name> --module <module> --fields "<field:type,...>" --crud` for a full resource scaffold, and use focused generators when only one artifact is needed: `npx svelar new`, `npx svelar make:model`, `make:migration`, `make:controller`, `make:service`, `make:repository`, `make:schema`, `make:request`, `make:resource`, `make:action`, `make:job`, `make:task`, `make:command`, `make:route`, `make:docker`, `make:dashboard`, `make:broadcasting`.
- In DDD apps, module artifacts belong in layered folders: `domain/models`, `domain/events`, `domain/observers`, `domain/policies`, `application/actions`, `application/dto`, `application/listeners`, `application/notifications`, `application/services`, `infrastructure/repositories`, `interface/http/controllers`, `interface/http/requests`, `interface/http/resources`, and `contracts/schemas`.
- Prefer `$lib/...` aliases for app-owned imports, especially `$lib/modules/...`, `$lib/shared/...`, `$lib/database/...`, and `$lib/factories/...`. Keep relative imports only for local SvelteKit conventions like `./$types`, styles, same-component helper files, or files outside `src/lib` such as `src/app.ts`.
- Keep the Laravel-like flow: route -> controller/page action -> FormRequest validation/authorization -> DTO -> action -> service -> repository -> model/resource -> response and side effects.
- Use both FormRequest classes and DTOs for write paths. FormRequest owns validation and authorization with shared schema rules; DTOs carry validated data into services/actions. Do not pass raw `z.infer` objects or unvalidated `FormData` directly into services.
- In SvelteKit pages that submit forms, use the shared schema with Superforms when the feature contract says frontend and backend validation are shared. Do not leave dogfood apps on ad hoc form parsing if the goal is to prove Svelar flow.
- Superforms must work end to end. Page actions using `use:enhance`/`superForm` must return a resource-like envelope that follows Svelar docs: `{ data: ... }` for the action payload and optional top-level `meta` for action name, message, form, validation errors, permissions, or other UI context. Do not invent top-level `status`/`ok`/`message` shapes per page. Include the posted Superform object in `meta.form` on success, validation failure, and service failure; otherwise the enhanced client cannot update field state. Render validation failures inline under every input, set `aria-invalid`, and do not also show duplicate validation toasts/alerts for ordinary field errors. Disable controls from the action pending/delayed state, show visible success or service-level error feedback such as an alert/toast, and update any response/result panel from the action result instead of waiting for cached `load` data or manual browser refresh.
- Use Svelar ORM and migrations. Avoid raw SQL unless it is an explicit low-level driver/infrastructure exception.
- Keep one migration per table or focused schema change.
- Use integer primary keys internally when useful, plus UUID v7 or ULID public identifiers for API exposure.
- Support SQLite, PostgreSQL, and MySQL. Cross-driver test database changes.
- For PostgreSQL production checks, use PgBouncer with prepared statements disabled and `pg_stat_statements` enabled.
- Use RustFS for local S3-compatible object storage; do not add MinIO.
- Keep production build externals for optional adapters: `bcrypt`, `argon2`, `bullmq`, `ioredis`, `meilisearch`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.
- When documentation changes, mirror it in `/Users/rzeradev/projects/beeblock/svelar-docs/` and update `/Users/rzeradev/projects/beeblock/svelar-docs/src/routes/api/search/+server.ts` if docs are added, renamed, removed, or retitled.
- When building a dogfood app, keep a step-by-step timeline in the app docs and validate behavior in the browser.
- PDF tests that claim Gotenberg coverage must set `PDF_DRIVER=gotenberg`; a healthy Gotenberg container alone is not enough.
- Realtime tests should cover SSE and Soketi/Pusher separately. A Soketi health ping is not enough; prove visible cross-browser updates.
- Storage tests should prove upload metadata, storage writes, browser-safe authorized reads, and image previews when applicable. Do not render internal Docker service URLs such as `http://rustfs:9000/...` to browser users.

## Feature Coverage

When hardening Svelar core or a dogfood app, explicitly account for these areas:

- CLI: `new`, make commands, `migrate`, `seed:run`, `routes:list`, `tinker`, custom commands, scheduler commands, queue worker commands.
- Database/ORM: migrations, schema builder, query builder, models, repositories, relationships, casts, fillable rules, soft deletes, traits/mixins, integer IDs plus UUID v7/ULID public IDs, cross-driver SQLite/PostgreSQL/MySQL behavior.
- Auth/security: sessions, CSRF, password hashing, optional bcrypt/argon2 externals, API tokens, refresh tokens, OTP/email verification/password reset, rate limiting, global and route middleware.
- Authorization: policies, permissions, roles, teams, team-scoped resource access, admin-only routes, API and page enforcement.
- App flow: route -> controller/page action -> FormRequest/shared schema validation -> DTO -> action -> service -> repository -> model/resource -> response. Side effects belong in actions/services, not scattered through pages.
- Cross-module reads use a narrow public application service/query/facade from the owning module and should return plain contract/DTO data, not another module's ORM model. Events are for side effects, not request/response queries. Controllers, repositories, and models are not cross-module APIs.
- Frontend forms: Superforms for shared schema validation, action results that follow `{ data, meta }` resource shape with `meta.form` for Superforms state, visible inline validation messages for every field without duplicate validation toasts, disabled/loading states that always clear after failures, visible success/service-error feedback, live response/result updates after 200 responses, reset-on-success where appropriate, and no stale inputs after successful create/comment/upload actions.
- Queues/cache: Redis cache, BullMQ async jobs, sync/database fallback queues, retries, finite `--once` workers, queue dashboard visibility.
- Scheduler/events/observers: scheduled tasks, custom commands, events/listeners, observers, audit logs, webhooks, exception handler behavior.
- Storage/uploads: local and S3-compatible disks, RustFS Docker service, upload metadata, authorized app download/proxy routes, image previews, no leaked internal S3 endpoints.
- PDF/mail/search: Gotenberg sync and webhook flows, PDF storage/download, Postmark/Resend/Mailtrap/log drivers, Meilisearch indexing/search/fallbacks.
- Realtime: SSE rooms/streams and Soketi/Pusher websocket events tested separately, with visible cross-browser updates.
- Production Docker: adapter-node, optional dependency externals, PgBouncer with `DB_PREPARE=false`, `pg_stat_statements`, non-default local ports, healthchecks, GitHub Actions-safe build behavior.
- Observability: logs, audit trail, runtime health checks, failed job visibility, exception rendering/reporting.

## Dogfood App Standard

A dogfood app is not just a service ping dashboard. It must expose user workflows that prove Svelar features in realistic paths:

- Use Svelar CLI scaffolding first, then fill in generated artifacts.
- Keep a timeline in the app docs for every material step and verification.
- Use the framework feature being tested in the visible workflow. For example, if validating uploads to RustFS, show an uploaded image preview through an authenticated app route. If validating Soketi, show another browser updating without refresh.
- Test with real Docker services where possible: Postgres/PgBouncer, Redis/BullMQ/cache, RustFS, Gotenberg, Meilisearch, Soketi, and any mail provider adapter under review.
- Validate browser UX, not only API status: loading states, empty states, inline validation errors without duplicate toasts, toast/alert feedback for successful actions and service failures, response panels that refresh immediately after successful enhanced submissions, realtime updates, and no stale form state.

## Imports

Use `@beeblock/svelar/<module>` subpaths:

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

## Svelte

- Use Svelte 5 runes in `.svelte`: `$props`, `$state`, `$derived`, `$effect`, `{@render children()}`.
- Do not use Svelte runes in `.ts` files shipped from `packages/svelar`.
- Import lucide icons individually, for example `lucide-svelte/icons/users`.
- Use generated app shadcn-svelte components for app UI; reserve Svelar UI for framework surfaces.

## Production Verification

Before release, prefer `npm run build`, targeted tests, `npm run release:dry-run`, and `npm run certify`. For real app dogfooding, create sibling apps in `/Users/rzeradev/projects/beeblock/svelar-testing-area/`, use non-default host ports, and test with Postgres/PgBouncer, Redis, BullMQ, cache, RustFS, Gotenberg, Meilisearch, auth/session/API tokens, policies, permissions, teams, webhooks, uploads, PDF, SSE, Soketi/Pusher realtime, logs, audit, exception handling, scheduler, CLI commands, and tinker.
