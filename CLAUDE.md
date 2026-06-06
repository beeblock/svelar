# Svelar — Claude Development Guidelines

## Required Documentation Sync

- Whenever documentation is updated in this repository, mirror the same change in `/Users/rzeradev/projects/beeblock/svelar-docs/` during the same task. If that repo is unavailable or cannot be written, report that explicitly before finishing.
- When docs are added, removed, renamed, or retitled, keep `/Users/rzeradev/projects/beeblock/svelar-docs/src/routes/api/search/+server.ts` aligned so the docs search index does not drift from the rendered docs.

## Project Focus

- Svelar is a Laravel-inspired TypeScript framework on SvelteKit 2.
- Focus on `packages/svelar` core first. Do not touch plugin packages unless the user explicitly asks.
- Treat the docs as the product contract, but verify code, generated templates, tests, and runtime behavior before assuming a feature is production-ready.
- Project scaffolding is owned by core through `npx svelar new`; there is no separate create-svelar package to maintain.

## Working Rules

- Use Svelar CLI commands to scaffold project artifacts whenever a generator exists. Prefer `npx svelar make:entity <Name> --module <module> --fields "<field:type,...>" --crud` for a full resource scaffold, and use focused generators when only one artifact is needed: `make:model`, `make:migration`, `make:controller`, `make:service`, `make:repository`, `make:schema`, `make:request`, `make:resource`, `make:action`, `make:job`, `make:task`, `make:command`, `make:route`, `make:docker`, `make:dashboard`, and `make:broadcasting`.
- In DDD apps, module artifacts belong in layered folders: `domain/models`, `domain/events`, `domain/observers`, `domain/policies`, `application/actions`, `application/dto`, `application/listeners`, `application/notifications`, `application/services`, `infrastructure/repositories`, `interface/http/controllers`, `interface/http/requests`, `interface/http/resources`, and `contracts/schemas`.
- Keep the Laravel-style flow consistent: route -> controller -> request/schema validation shared with frontend -> action/service -> repository -> model/resource -> response and side effects.
- Use Svelar ORM, models, repositories, and migrations. Avoid raw SQL except explicit low-level driver behavior that the ORM cannot represent yet.
- Create one migration per table or focused schema change.
- Support SQLite, PostgreSQL, and MySQL out of the box. Cross-driver test database changes when feasible.
- Use integer primary keys internally when useful, plus UUID v7 or ULID public identifiers for API exposure.
- Use soft deletes and traits/mixins where the Laravel-like feature contract expects them.
- Keep production build externals for optional adapters: `bcrypt`, `argon2`, `bullmq`, `ioredis`, `meilisearch`, `@aws-sdk/client-s3`, and `@aws-sdk/s3-request-presigner`.
- Do not revert unrelated user changes in the working tree.

## Svelte And UI Rules

- Use Svelte 5 conventions in `.svelte` files: `$props`, `$state`, `$derived`, `$effect`, `onMount`, and `{@render children()}`.
- Do not use Svelte runes in `.ts` files shipped from `packages/svelar`; use normal TypeScript state or subscriber patterns.
- Import lucide icons individually, for example `lucide-svelte/icons/users`, instead of the package barrel.
- Generated app UI should install and use local shadcn-svelte components for application screens. Use Svelar UI for framework/dashboard internals or documented Svelar UI surfaces.

## Runtime Verification

- Before release, prefer `npm run build`, targeted tests, `npm run release:dry-run`, and `npm run certify`.
- For real app dogfooding, create sibling apps under `/Users/rzeradev/projects/beeblock/svelar-testing-area/`.
- Dogfood apps should run Docker services on non-default host ports because other local projects may already use defaults.
- Production-grade dogfood coverage should include Postgres through PgBouncer, prepared statements disabled, `pg_stat_statements` enabled, Redis, BullMQ queues, cache, RustFS, Gotenberg, Meilisearch, auth/session/API tokens, policies/permissions, teams, webhooks, uploads, PDF, SSE, Soketi/Pusher realtime, logs, audit, exceptions, scheduler, CLI commands, and tinker.
- When building a dogfood app, keep a step-by-step timeline in the app docs so the build and test path is auditable.
- PDF tests that claim Gotenberg coverage must set `PDF_DRIVER=gotenberg`; a healthy Gotenberg container alone is not enough.
- Realtime tests should prove visible cross-browser updates. A health ping alone is not enough for Soketi.

## Core Imports

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

## Audit Focus

- Check docs, package exports, build entries, generated templates, tests, and runtime implementation together. Inconsistencies usually appear across those boundaries.
- For auth and security, verify sessions, refresh tokens, API tokens, CSRF, rate limiting, middleware, policies, permissions, and team scoping together.
- For runtime services, verify both direct code behavior and browser-visible behavior where applicable.
