# Release Certification

This is contributor documentation for maintainers preparing Svelar releases. Application developers do not need to run these checks in their own Svelar apps.

Svelar should not be published from ordinary unit tests alone. The release gate must prove that the package works as a framework in a real generated app.

## Commands

Run the inventory without executing checks:

```bash
npm run certify:inventory
```

Run the full pre-publish gate:

```bash
npm run certify
```

For faster local iteration while hardening a feature:

```bash
npm run certify:fast
```

## Current Gate

`npm run certify` runs:

- the core package test suite
- the generated CLI command inventory, derived from the same built-in command registry used by the `svelar` binary
- package publish dry-run checks for `@beeblock/svelar`, including its bundled `svelar` binary
- Redis cache, Redis session, and BullMQ queue smoke checks with Docker-managed random ports
- PDFKit, queued PDF job, and Gotenberg smoke checks with Docker-managed random ports
- Meilisearch indexing and search smoke checks with Docker-managed random ports
- S3-compatible storage smoke checks with Docker-managed random ports
- PostgreSQL through PgBouncer plus `pg_stat_statements` smoke checks with Docker-managed random ports
- generated DDD app certification tests, including local provider mocks for Postmark, Resend, and Mailtrap mail transports
- SQLite, PostgreSQL, and MySQL smoke checks with Docker-managed random ports
- production `adapter-node` browser smoke across the database matrix

The core package test suite includes direct gates for every built-in CLI command help screen, CLI registration drift, feature flags, outgoing webhooks, audit logging, Excel import/export/streaming, HTTP helpers and the fluent HTTP client, forms, i18n, UI/SEO/pagination component compilation, toast state, testing helpers, deployment CLI file generation, Docker compose command construction, and package-level utility commands.

Package builds fail on TypeScript declaration errors. CLI regression tests also cover nonzero exit status for reported failures, typed boolean options (including `--force=false`), rejection of unknown/missing options, and factory imports in layered DDD modules. A passing help screen alone does not prove that a command's runtime behavior works.

Generator regressions exercise 23 direct handlers in DDD and flat layouts, rejecting invalid normalized identifiers and referenced names before filesystem changes. An isolated installed-package fixture compiles only the real CLI bin entry and runs finite child-process checks for rejection exit codes, module traversal, `api-key` normalization, and preserved `new ../sibling-app --no-install` behavior; it is not a substitute for the packed-release smoke matrix. Companion-directory and collection-file symlink cases verify preflight containment.

Each generated smoke app also checks `npx svelar <command> --help` for every built-in command after installing the packed package. The same smoke run verifies existing-app upgrade safety with `npx svelar update --list`, `--dry-run`, and a forced framework-owned config refresh.

`svelar update` shares the new-app generator's DDD/flat path and import transformations. Source files, pages, routes, agent guidance, and app-owned users/posts migrations are user-owned and require explicit review with `--include-user-files`. `--force` applies to framework files only. Noninteractive updates fail promptly if they would prompt; use `--dry-run` for inspection. Upgrade checks assert that user code and `.env` secrets remain unchanged, the validation provider is preserved, and overwritten framework config has an exact `.bak` backup.

`npm run smoke:cli` installs the packed package in DDD and flat apps with both Zod and Valibot, executes every artifact generator, runs finite queue/scheduler commands and a discovered custom command, checks tinker model loading, and type-checks the generated app. Docker/SSH commands are checked with isolated process stubs so certification cannot provision a real host or stop unrelated containers. New apps run `svelte-kit sync` during `npm install` via `prepare`, including apps created with `--no-install`.

`npm run smoke:upgrade` creates and seeds apps using the published `0.7.9` baseline, then installs the current tarball. Zod targets explicitly run the installed CLI's `update --migrate-zod4 --dry-run` and `--force`, reinstall dependencies when the manifest changes, and verify approved adapter import tokens, preserved local aliases and exact-original `.zod4.bak` backups. Both providers separately run `update --migrate-core --dry-run` and `--force` for eight recognized scaffold files. The preservation gate composes the explicit adapter/core AST token expectations against the historical snapshot, checks exact `.core.bak` pre-core-phase bytes, retains earlier Zod backups and rejects any other changes to original source. Valibot schemas are not converted. The missing-only `update --add-missing-user-files --category=config --force` mode adds ambient types without overwriting user files, followed by additive framework migrations. Both providers must retain `.env` bytes, customization markers and exact seeded user records, then pass `svelte-check` and real browser login/authenticated reload before app tests/build. The first pre-core-migration DDD/Zod check preserved source/backups but failed with 14 errors in nine files; focused codemod tests alone do not certify historical compatibility. Core migration does not repair Vite/Vitest aliases or legacy JSON-body/schema contracts; reviewed admin-operation failure cases remain required. Use `--upgrade-from=<version>` to test another exact published baseline. These gates do not guarantee compatibility with arbitrary custom app code or untested historical versions.

Generated DDD and flat smoke apps receive an injected `tests/feature/svelar-certification.test.ts` file. It validates the intended Svelar flow:

```text
route -> controller -> FormRequest/schema -> DTO -> action -> service -> repository -> model -> resource
```

The injected test also covers complex ORM queries, soft deletes, UUID v7/ULID primary keys, secondary public UUID/ULID keys, UUID v7/ULID validation rules, event listeners, full model observer create/update/delete lifecycles, `EventServiceProvider` observer/listener wiring, sync and async queue jobs, global and named middleware, route-level rate limiting, session primitives, password reset/email verification/OTP recovery tokens, API key Bearer authentication fallback, Teams roles/members/invitations, SSE public/private/presence broadcasting, Postmark/Resend/Mailtrap mail transport payloads and auth headers, notification email/database/custom channel delivery, file logging, `LogViewer` query/stats/tailing, exception handling payloads/reporting/middleware recovery, PDFKit generation, and queued PDF jobs against the configured database driver. When `REDIS_URL` is present, it also certifies Redis cache operations, Redis-backed sessions, and a real BullMQ worker. When `GOTENBERG_URL` is present, it certifies Gotenberg HTML, Markdown, merge, office conversion, and screenshot paths. When `MEILISEARCH_HOST` is present, it certifies Meilisearch health, `Searchable` auto-sync on create/update/delete, `Search.withoutSyncing()`, manual indexing, index settings, search filters, and index stats. When `S3_CERTIFICATION` is present, it certifies S3-compatible storage, bucket creation, object operations, listings, and temporary URLs. When `PGBOUNCER_CERTIFICATION` is present, it certifies PostgreSQL through PgBouncer and verifies `pg_stat_statements` captures app queries.

Because generated certification tests refresh and mutate the database, the smoke runner refreshes migrations and runs seeders again immediately before browser smoke. Browser assertions therefore exercise a real production `adapter-node` server against a known seeded app state instead of leftover test data. The browser smoke opens real `EventSource` subscriptions for SSE public, private, and presence channels and broadcasts through the generated internal HTTP bridge.

## Pending External-Service Phases

The documentation site's search keeps inline API names/CLI identifiers searchable, derives sections from the shared document registry, and refreshes its index within 30 seconds of documentation changes. Concurrent searches share one index build.

The existing external-service gates are wired into the certification suite. Provider mail tests use local HTTP mocks so the release gate can verify payload shape, headers, error handling, and generated app wiring without sending real email.

## Evolution Acceptance Scope

### Verification Snapshot (2026-10-12)

- Core: 1,753 tests in 94 files passed with no skips; strict package build and publish dry-run passed.
- Packed CLI: DDD/flat with Zod/Valibot executed the registered generator/runtime gates, type-checked with zero errors, ran 30 app tests per target (120 total), built, and passed production browser flows.
- Published upgrade: all four 0.7.9 layout/provider targets passed type-checks with zero errors/warnings, preserved source outside reviewed migration tokens, retained exact backups and `.env`, compared SHA-256 fingerprints of complete stored user records without exposing password/token values, logged in/reloaded in a real browser, ran 28 tests each (112 total), and built.
- Drivers: SQLite, PostgreSQL and MySQL passed 28 packed-app tests each (84 total), including competing API-key rotation and signed, concurrent, tenant-isolated inbox capture.
- Browser regressions check accessible field labels, inline validation without duplicate alerts, all seven default admin tabs at mobile width, and keyboard scrolling in default/operational table regions. The final production browser proof and its screenshots passed; the two legitimate focus-region compiler warnings from the first CLI matrix were addressed with narrowly explained annotations and compiler regressions.
- Dependency audit: zero findings at every severity. Docs search: five route regressions and site production build passed. Local Docker test services and owned browser servers were cleaned up.

These results certify the stated scenarios, not every proposed feature or 100% statement/branch coverage. Full `npm run certify` must still be repeated on the final release artifact, including its external-service phases, before publishing.

Passing the existing suite is not proof that every requested evolution is implemented, nor a claim of 100% application or branch coverage. The beeHub evolution request includes broader contracts than the original release suite. Before publishing, track those contracts separately and require their acceptance evidence:

- SVE-001/002/003: interrupted-worker recovery, multiprocess atomic rate limits and concurrent tenant/actor propagation across installed subpaths.
- SVE-004/005: observer diffs/auditing and SvelteKit HTTP control flow in installed generated apps, not only source-unit imports.
- SVE-006/007/008/009: inbox replay/retention, queue coalescing/DLQ/worker telemetry, scheduler locks/missed-run policy and durable after-commit search recovery. Current APIs and their bounded tests do not implement every item in these proposals.
- SVE-010/011/012/013: shared persistent log viewing across web/worker/scheduler, session expiry UX, distributed integration budgets and service-account rotation/audit guarantees.
- SVE-014/015: all CLI generators must execute and type-check in both layouts/providers; advanced PostgreSQL indexes/checks and custom decimal casts need their own contracts and driver tests.
- SVE-016/017: replayable SSE/background-operation lifecycle and zero-downtime deployment/drain/rollback are distinct from Redis fan-out and safer Compose commands.
- SVE-018/019/020: dependency-aware capability manifests/system profiles, tenant editors, clock/context harnesses and optional operational UI patterns need explicit acceptance tests beyond RBAC scopes and callback fakes.
- SVE-021/022: complete operational dashboard and authentication UX require desktop/mobile browser checks. Batch/DLQ operations, shared logs, distributed controls and per-login remember-me are not implied by existing dashboard or login scaffolds.

Plugin packages are outside this core certification scope. Dependency major upgrades require their own migration tests; using a supported Node/SvelteKit baseline is not the same as blindly selecting every registry `latest` tag.
