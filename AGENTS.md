# Svelar — Codex Development Guidelines

## Required Documentation Sync

- Whenever documentation is updated in this repository, mirror the same change in `/Users/rzeradev/projects/beeblock/svelar-docs/` during the same task. If that repo is unavailable or cannot be written, report that explicitly before finishing.
- When docs are added, removed, renamed, or retitled, keep `/Users/rzeradev/projects/beeblock/svelar-docs/src/routes/api/search/+server.ts` aligned so the docs search index does not drift from the rendered docs.

## Project Context

- This is a TypeScript monorepo for Svelar, a Laravel-inspired framework on top of SvelteKit 2.
- `packages/svelar` is the core framework package.
- Focus `packages/svelar` core first. Do not touch plugin packages unless the user explicitly asks.
- Project scaffolding is owned by `packages/svelar` through `npx @beeblock/svelar new`; generated apps then use the project-local `npx svelar ...` CLI.
- `packages/svelar-*` packages are framework plugins/extensions and must stay consistent with core plugin conventions.

## Working Rules

- Use Svelar CLI commands to scaffold project artifacts whenever a generator exists.
- Keep the Laravel-like flow consistent: route -> controller/page action -> FormRequest/shared schema validation -> DTO -> action -> service -> repository -> model/resource -> response and side effects.
- Use both FormRequest classes and DTOs for write paths. FormRequest validates and authorizes; DTO carries validated data into actions/services.
- Use shared contract schemas for backend FormRequests and frontend Superforms. Keep validation consistent with `svelar.validation.json` (`@beeblock/svelar/validation` for Zod, `@beeblock/svelar/validation/valibot` for Valibot).
- In DDD apps, keep module artifacts in layered folders: `contracts/schemas`, `domain/models`, `domain/events`, `domain/observers`, `domain/policies`, `application/actions`, `application/dto`, `application/listeners`, `application/notifications`, `application/services`, `infrastructure/repositories`, `interface/http/controllers`, `interface/http/requests`, and `interface/http/resources`.
- Use `$lib/...` aliases for app-owned imports instead of deep relative paths.
- Use Svelar ORM and migrations. Avoid raw SQL unless it is an explicit low-level driver/infrastructure exception.
- Keep one migration per table or focused schema change.
- Prefer production-grade fixes that harden behavior instead of bypassing validation, auth, CSRF, typing, or security controls.
- Keep changes scoped to the feature being fixed unless a shared contract must change.
- When adding a new core subpath export, update `packages/svelar/package.json`, `packages/svelar/tsup.config.ts`, and any scaffold templates that need the path.
- After changes to `packages/svelar`, run the relevant package tests and build when feasible.
- Do not revert unrelated user changes in the working tree.

## Runtime Verification

- Before release, prefer `npm run build`, targeted tests, `npm run release:dry-run`, and `npm run certify`.
- For real app dogfooding, create sibling apps under `/Users/rzeradev/projects/beeblock/svelar-testing-area/` and keep a step-by-step timeline in the app docs.
- Use Docker services on non-default host ports because other local projects may already be running.
- Production-grade dogfood coverage should include Postgres/PgBouncer with prepared statements disabled, `pg_stat_statements`, Redis, BullMQ queues, cache, RustFS, Gotenberg, Meilisearch, auth/session/API tokens, policies/permissions, teams, webhooks, uploads, PDF, SSE, Soketi/Pusher realtime, logs, audit, exceptions, scheduler, CLI commands, and tinker.
- PDF tests that claim Gotenberg coverage must set `PDF_DRIVER=gotenberg`.
- Realtime tests should prove visible cross-browser updates. A health ping alone is not enough for Soketi.

## Svelte And UI Rules

- Use Svelte 5 conventions in `.svelte` files: `$props`, `$state`, `$derived`, `$effect`, and `{@render children()}`.
- Do not use Svelte runes in `.ts` files shipped from `packages/svelar`; use normal TypeScript state or subscriber patterns.
- Import lucide icons individually, for example `lucide-svelte/icons/users`, instead of the package barrel.

## Plugin Rules

- Plugins are postponed while core is being production-hardened unless explicitly requested.
- Plugin packages must keep server-only plugin classes out of client-safe `index.ts` barrels.
- Plugin classes must live in a dedicated server entry such as `src/plugin.ts` and default-export the plugin class.
- Plugin models should extend `Model`; avoid direct `Connection.raw()` CRUD unless the feature explicitly requires raw SQL.
- Plugin controllers should extend `Controller`; form requests should extend `FormRequest`; resources should extend `Resource`.
- Plugins that ship Svelte source must include `svelte` export conditions and include every transitively imported source directory in `files`.

## Audit Focus

- Check docs, package exports, build entries, generated templates, tests, and runtime implementation together. Inconsistencies usually appear across those boundaries.
- Treat README/docs claims as contracts only after confirming the code and tests implement them.
