# Svelar — Codex Development Guidelines

## Required Documentation Sync

- Whenever documentation is updated in this repository, mirror the same change in `/Users/rzeradev/projects/beeblock/svelar-docs/` during the same task. If that repo is unavailable or cannot be written, report that explicitly before finishing.
- When docs are added, removed, renamed, or retitled, keep `/Users/rzeradev/projects/beeblock/svelar-docs/src/routes/api/search/+server.ts` aligned so the docs search index does not drift from the rendered docs.

## Project Context

- This is a TypeScript monorepo for Svelar, a Laravel-inspired framework on top of SvelteKit 2.
- `packages/svelar` is the core framework package.
- Project scaffolding is owned by `packages/svelar` through the published `svelar new` CLI command.
- `packages/svelar-*` packages are framework plugins/extensions and must stay consistent with core plugin conventions.

## Working Rules

- Prefer production-grade fixes that harden behavior instead of bypassing validation, auth, CSRF, typing, or security controls.
- Keep changes scoped to the feature being fixed unless a shared contract must change.
- When adding a new core subpath export, update `packages/svelar/package.json`, `packages/svelar/tsup.config.ts`, and any scaffold templates that need the path.
- After changes to `packages/svelar`, run the relevant package tests and build when feasible.
- Do not revert unrelated user changes in the working tree.

## Svelte And UI Rules

- Use Svelte 5 conventions in `.svelte` files: `$props`, `$state`, `$derived`, `$effect`, and `{@render children()}`.
- Do not use Svelte runes in `.ts` files shipped from `packages/svelar`; use normal TypeScript state or subscriber patterns.
- Import lucide icons individually, for example `lucide-svelte/icons/users`, instead of the package barrel.

## Plugin Rules

- Plugin packages must keep server-only plugin classes out of client-safe `index.ts` barrels.
- Plugin classes must live in a dedicated server entry such as `src/plugin.ts` and default-export the plugin class.
- Plugin models should extend `Model`; avoid direct `Connection.raw()` CRUD unless the feature explicitly requires raw SQL.
- Plugin controllers should extend `Controller`; form requests should extend `FormRequest`; resources should extend `Resource`.
- Plugins that ship Svelte source must include `svelte` export conditions and include every transitively imported source directory in `files`.

## Audit Focus

- Check docs, package exports, build entries, generated templates, tests, and runtime implementation together. Inconsistencies usually appear across those boundaries.
- Treat README/docs claims as contracts only after confirming the code and tests implement them.
