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
# Certify an already-built immutable package without rebuilding/repacking:
npm run certify -- --tarball=/absolute/path/beeblock-svelar-version.tgz --million \
  --type-deps=/absolute/path/installed-app/node_modules
```

For faster local iteration while hardening a feature:

```bash
npm run certify:fast
```

The final orchestrator preflights a supplied archive before application changes, records its SHA-256 and package/CLI identity, and uses the extracted artifact CLI for every fresh target. Each phase verifies the same bytes and fails rather than mixing builds. It writes durable per-gate logs and a manifest; a failed or skipped required phase cannot certify a release. Source-native runtime scenarios remain explicitly labeled separately from installed-package evidence.

On shared development hosts, core and generated-app suites use one Vitest worker. Run heavy build/install/browser phases sequentially; optional native scenarios still create the processes needed to prove their explicit concurrency contracts. A machine timeout remains a failed gate until investigated and rerun, never an accepted or silently skipped test.

## Current Gate

`npm run certify` runs:

- the core package test suite (native/optional gates are accounted for separately)
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

`npm run smoke:upgrade` creates and seeds apps using the published `0.7.9` baseline, then installs the current tarball. Zod targets explicitly run the installed CLI's `update --migrate-zod4 --dry-run` and `--force`, reinstall dependencies when the manifest changes, and verify approved adapter import tokens, preserved local aliases and exact-original `.zod4.bak` backups. Both providers separately run `update --migrate-core --dry-run` and `--force` for eleven recognized scaffold files, including the narrowed incoming-webhook prefix/exact bridge exception in hooks and awaited viewer calls in the explicit admin logs/stats routes. Already Promise-aware calls remain unchanged; applying again is idempotent. The installed CLI performs the approved edits and backups, not manual fixture patches. The preservation gate composes the explicit adapter/core AST token expectations against the historical snapshot, checks exact `.core.bak` pre-core-phase bytes, retains earlier Zod backups and rejects any other changes to original source. Valibot schemas are not converted. The missing-only `update --add-missing-user-files --category=config --force` mode adds ambient types without overwriting user files, followed by additive framework migrations. Both providers must retain `.env` bytes, customization markers and exact seeded user records, then pass `svelte-check` and real browser login/authenticated reload before app tests/build. The first pre-core-migration DDD/Zod check preserved source/backups but failed with 14 errors in nine files; focused codemod tests alone do not certify historical compatibility. Core migration does not repair Vite/Vitest aliases or legacy JSON-body/schema contracts; reviewed admin-operation failure cases remain required. Use `--upgrade-from=<version>` to test another exact published baseline. These gates do not guarantee compatibility with arbitrary custom app code or untested historical versions.

Generated DDD and flat smoke apps receive an injected `tests/feature/svelar-certification.test.ts` file. It validates the intended Svelar flow:

```text
route -> controller -> FormRequest/schema -> DTO -> action -> service -> repository -> model -> resource
```

The injected test also covers complex ORM queries, soft deletes, UUID v7/ULID primary keys, secondary public UUID/ULID keys, UUID v7/ULID validation rules, event listeners, full model observer create/update/delete lifecycles, `EventServiceProvider` observer/listener wiring, sync and async queue jobs, global and named middleware, route-level rate limiting, session primitives, password reset/email verification/OTP recovery tokens, API key Bearer authentication fallback, Teams roles/members/invitations, SSE public/private/presence broadcasting, Postmark/Resend/Mailtrap mail transport payloads and auth headers, notification email/database/custom channel delivery, file logging, `LogViewer` query/stats/tailing, exception handling payloads/reporting/middleware recovery, PDFKit generation, and queued PDF jobs against the configured database driver. When `REDIS_URL` is present, it also certifies Redis cache operations, Redis-backed sessions, and a real BullMQ worker. When `GOTENBERG_URL` is present, it certifies Gotenberg HTML, Markdown, merge, office conversion, and screenshot paths. When `MEILISEARCH_HOST` is present, it certifies Meilisearch health, `Searchable` auto-sync on create/update/delete, `Search.withoutSyncing()`, manual indexing, index settings, search filters, and index stats. When `S3_CERTIFICATION` is present, it certifies S3-compatible storage, bucket creation, object operations, listings, and temporary URLs. When `PGBOUNCER_CERTIFICATION` is present, it certifies PostgreSQL through PgBouncer and verifies `pg_stat_statements` captures app queries.

Because generated certification tests refresh and mutate the database, the smoke runner refreshes migrations and runs seeders again immediately before browser smoke. Browser assertions therefore exercise a real production `adapter-node` server against a known seeded app state instead of leftover test data. The browser smoke opens real `EventSource` subscriptions for SSE public, private, and presence channels and broadcasts through the generated internal HTTP bridge.

## External-Service Phases

The documentation site's search keeps inline API names/CLI identifiers searchable, derives sections from the shared document registry, and refreshes its index within 30 seconds of documentation changes. Concurrent searches share one index build.

The existing external-service gates are wired into the certification suite. Provider mail tests use local HTTP mocks so the release gate can verify payload shape, headers, error handling, and generated app wiring without sending real email.

## Evolution Acceptance Scope

### Verification Snapshot (2026-10-12)

- Core: 1,823 tests in 100 files passed with no skips; strict package build and publish dry-run passed. The complete dry-run inventory contains 294 files.
- Packed CLI: DDD/flat with Zod/Valibot executed the registered generator/runtime gates, type-checked with zero errors/warnings, ran 32 app tests per target (128 total), built, and passed all four production browser flows.
- Published upgrade: all four 0.7.9 layout/provider targets passed type-checks with zero errors/warnings, preserved source outside reviewed migration tokens, retained exact backups and `.env`, compared SHA-256 fingerprints of complete stored user records without exposing password/token values, logged in/reloaded in a real browser, ran 30 tests each (120 total), and built.
- Drivers: the latest SQLite CLI target passed 32 tests; separate PostgreSQL and MySQL targets passed 30 tests each. Installed regressions cover model-aware find/create/update lifecycles, UUID/custom-key identity, OR predicate isolation, explicit tenant scopes, tenant-safe bulk upserts including foreign primary-key collisions, competing creation and PostgreSQL savepoint recovery inside an outer transaction. Repeated team RBAC grants, competing API-key rotation and signed tenant-isolated inbox capture also passed.
- ORM source regressions cover fillable guards, JSON casts, null searches, UUID v7/ULID IDs, timestamps, hooks/observers, audit diffs, Searchable persistence-option forwarding, model/raw result contracts, and rejection of missing or out-of-scope writes before success events.
- Browser regressions check accessible field labels, inline validation without duplicate alerts, all seven default admin tabs at mobile width, and keyboard scrolling in default/operational table regions. The final production browser proof and its screenshots passed; the two legitimate focus-region compiler warnings from the first CLI matrix were addressed with narrowly explained annotations and compiler regressions.
- Dependency audit: zero findings at every severity. Docs search: five route regressions and site production build passed. Local Docker test services and owned browser servers were cleaned up.

Builds still report upstream optional validation-adapter, circular-dependency and annotation warnings; the docs build externalizes optional bcrypt/argon2. These are separate from the zero-error/zero-warning Svelte type checks. Meilisearch/Redis/PDF/storage/PgBouncer service phases were not rerun in this ORM slice.

These results certify the stated scenarios, not every proposed feature or 100% statement/branch coverage. Full `npm run certify` must still be repeated on the final release artifact, including its external-service phases, before publishing.

Passing the existing suite is not proof that every requested evolution is implemented, nor a claim of 100% application or branch coverage. The beeHub evolution request includes broader contracts than the original release suite. At that earlier snapshot, the following broader contracts still required separate implementation and acceptance evidence:

- SVE-001/002/003: interrupted-worker recovery, multiprocess atomic rate limits and concurrent tenant/actor propagation across installed subpaths.
- SVE-004/005: observer diffs/auditing and SvelteKit HTTP control flow in installed generated apps, not only source-unit imports.
- SVE-006/007/008/009: inbox replay/retention, queue coalescing/DLQ/worker telemetry, scheduler locks/missed-run policy and durable after-commit search recovery. That snapshot did not implement every item in these proposals.
- SVE-010/011/012/013: shared persistent log viewing across web/worker/scheduler, session expiry UX, distributed integration budgets and service-account rotation/audit guarantees.
- SVE-014/015: all CLI generators must execute and type-check in both layouts/providers; advanced PostgreSQL indexes/checks and custom decimal casts need their own contracts and driver tests.
- SVE-016/017: replayable SSE/background-operation lifecycle and zero-downtime deployment/drain/rollback are distinct from Redis fan-out and safer Compose commands.
- SVE-018/019/020: dependency-aware capability manifests/system profiles, tenant editors, clock/context harnesses and optional operational UI patterns need explicit acceptance tests beyond RBAC scopes and callback fakes.
- SVE-021/022: complete operational dashboard and authentication UX require desktop/mobile browser checks. Batch/DLQ operations, shared logs, distributed controls and per-login remember-me are not implied by existing dashboard or login scaffolds.

Plugin dependency upgrades are included in the current evolution task and require their own migration tests; the core suite alone does not certify them. Using a supported Node/SvelteKit baseline is not the same as blindly selecting every registry `latest` tag.
### Complete Request Ledger (2026-10-13)

All 22 beeHub items are tracked below, with remaining implementation and acceptance work explicit; none is accepted. The 2026-10-13 source inventory is historical, not a current finding that every requested API exists. The independent 2026-10-14 audit confirmed missing SVE-015 JSON/window helpers and additional acceptance gaps, superseding any earlier completion conclusion without invalidating the dated, scoped receipts. The remaining work is not optional: repeat every required installed-package, driver, upgrade, CLI and production-browser scenario on the same final artifact. "Final gate pending" does not mean release-ready. An item becomes accepted only after implementation, installed-package verification and documentation agree; unit totals alone never close a row.

| Item | Remaining implementation or acceptance work | State |
|---|---|---|
| SVE-001 | SOURCE-native daemon/lock/recovery proofs exist; packaged installed-CLI five-way concurrency, long-lock renewal, SIGTERM/SIGKILL recovery and context proof required on final artifact | Final gate pending |
| SVE-002 | Atomic coordination and trusted proxy chains implemented; real 1,000-request/four-process Redis proof passed, repeat final artifact | Final gate pending |
| SVE-003 | General global-scope registry, all mutation boundaries and context propagation across jobs/events/scheduler/CLI | Final gate pending |
| SVE-004 | Deep original snapshots, semantic decimal/custom casts and complete context-aware audit evidence | Final gate pending |
| SVE-005 | Native HTTP errors/redirects are implemented; repeat installed-controller failure-path evidence on final artifact | Final gate pending |
| SVE-006 | Transactional dispatch, coalescing/version ordering, retry/DLQ/replay, retention/redaction and reconciliation/lag | Final gate pending |
| SVE-007 | Registry/profiles, deduplication/bulk dispatch and named shared adapters implemented; installed console and final worker proof pending | Final gate pending |
| SVE-008 | Persistent controls, queued run-now, tenant timezone/catch-up, renewable locks and drain implemented; final process/application proof pending | Final gate pending |
| SVE-009 | Durable after-commit search outbox, bounded keyset reindex, explicit bulk lifecycle and outage/rollback recovery | Final gate pending |
| SVE-010 | Shared database log viewer, cursor/search/retention, distributed tail and safe incident reporting | Final gate pending |
| SVE-011 | Idle/absolute activity semantics, throttled touch, multitab expiry warning and protected renewal | Final gate pending |
| SVE-012 | Distributed credential/account budget and real concurrent HTTP resilience proof | Final gate pending |
| SVE-013 | Rotation overlap, revocation audit, last-use address and explicit service-account policy context | Final gate pending |
| SVE-014 | Architectural lint, apiFetch adoption codemod and every command in every layout/validation provider | Final gate pending |
| SVE-015 | Advanced PostgreSQL indexes/checks/alterations, casts, keyset/custom primary keys and eventful bulk operations; typed JSON/window helpers and combined native/model-lifecycle proofs outstanding | Final gate pending |
| SVE-016 | SSE heartbeat/resume/reconnect/drain and persisted background operation progress/result/cancellation/deep links | Final gate pending |
| SVE-017 | Docker/Caddy promotion/rollback passed with no dropped HTTP requests; verify generated adapter-node readiness/drain on final artifact | Final gate pending |
| SVE-018 | Dependency-aware manifest, system/custom profiles, generated gates/editor, alias migration and protected platform boundary | Final gate pending |
| SVE-019 | Scoped clock/context fakes and explicit native database profiles implemented; final integrated certification pending | Final gate pending |
| SVE-020 | Six optional shadcn patterns and make:ui implemented; latest installed primitives and browser verification pending | Final gate pending |
| SVE-021 | Complete generated operational shell/users/roles/queue/DLQ/scheduler/shared logs/kill switches and browser workflows | Final gate pending |
| SVE-022 | Remember-me, branding/federation slots, expiry/error flows and generated desktop/mobile/keyboard tests; non-login busy/duplicate-submit addon passed on candidate 13, repeat on final artifact | Final gate pending |

All Dependabot PRs are part of this release task, including affected plugin repositories. Superseded PRs must be linked to the tested replacement commit; incompatible updates must be resolved explicitly, not silently left open. No package is published while a required row remains unaccepted.

### Runtime Evidence (2026-10-13)

- All three repositories (`beeblock/svelar`, `beeblock/svelar-docs`, `beeblock/svelar-datatable`) have no open PRs at the latest audit. Dependency updates are committed independently; the root npm audit has zero known vulnerabilities. Missing GitHub `dependencies` and `security` labels were created to match Dependabot configuration. Unversioned plugin drafts stay local and are not absorbed into core Git.
- Queue verification passed 372 tests across 19 files without skips, including real Redis lifecycle/monitoring and PostgreSQL/MySQL Node-process cases. Scheduler verification passed 105 tests, including actual SQLite runtime and PostgreSQL/MySQL SQL contracts; those contracts are not a claim of native scheduler driver coverage.
- Four Node HTTP servers admitted exactly 137 of 1,000 requests with a 137-request Redis quota; 863 were rejected, TTL remained positive, and spoofed forwarded headers were ignored. SSE verification used separate HTTP replicas and a killed/replaced process with replay.
- Deployment passed 36 unit/CLI checks plus four real Docker/Caddy traffic scenarios. Shared logs/search passed ten separate-process scenarios without skips, including real Meilisearch outage/recovery, failed async tasks and keyset reindexing under concurrent deletes. These fixtures do not replace the final installed SvelteKit application gate.
- Earlier installed probes correctly blocked release on cross-bundle Model/FormError identity, Vite 8 configuration, current shadcn utility types and protocol-route annotations. Those defects have focused regressions. Candidate 4 also exposed an overly broad internal CSRF exception in default hooks/scaffolding; it is not publishable, and the narrowed bridge exception must be certified in the next immutable package.
- An earlier formal source gate passed 3,413 tests with one worker and 86 explicitly gated native/optional skips. Those skips remain acceptance obligations; they are not included in the native zero-skip claim. Earlier failed CLI-timeout and obsolete OTP-assertion runs are retained separately and do not certify a release. The source runtime runner separately passed 75 native scenarios before the new active-worker deployment gate.
- Native active-worker promotion/rollback passed twice: the latest run served 1,146 HTTP responses, all 200, while four BullMQ jobs each started/completed once, locks renewed during both SIGTERM drains, and replacements consumed the next jobs. This is a source-native fixture with real Docker/Caddy/Redis, not final installed-artifact certification.
- All 14 local plugins passed 423 focused tests against candidate 5, with builds/types, packed consumer audits and additional native PostgreSQL/MySQL and Node 22.12 evidence. This includes the custom-primary-key impersonation fix and eight Charts failure-boundary regressions. Candidate 6 changes only seven CLI files; the other 358 packaged files, including all runtime entries, declarations and the manifest, are byte-identical. Final artifact provenance and installed CLI acceptance still need their own completion. Ignored no-Git drafts remain local by explicit owner instruction.
- One-million-row keyset reindexing used real SQLite and bounded SDK-contract batches under a 128 MiB heap limit; maximum RSS was 121.4 MiB. This is not a one-million-document Meilisearch-server claim. Real Meilisearch outage/recovery is verified separately.
- Six generated UI patterns passed eight real browser scenarios, including private SSE progress across two browsers and a 390px viewport. Auth UI passed 23 installed-app scenarios. These checkpoint results must be repeated after final source changes; populated operational controls and installed invitation workflows are separate required gates.
- Candidate 5 installed invitation workflows passed 14 production-app scenarios with preserved source/database fingerprints. The OTP probe confirmed an obsolete expected message in the harness; its correction retains the 401, single alert, code clearing, successful verification and consumed-code replay denial. These are checkpoint proofs, not the final full Auth UI gate.
- Installed probes also found and fixed the published 0.7.9 hook literal, incompatible historical Meilisearch SDK range, Valibot conversion of fixed core dashboard schemas, model/migration pluralization and five generated Team action error leaks. The final coordinator includes both invitation providers, populated operational controls and their standalone fixture tests before later phases overwrite apps.
- Candidate 6's full DDD production browser checkpoint passed after the OTP assertion fix, but exposed an owned Redis cache client that kept reconnecting after a dependency probe timed out. The bounded lifecycle fix passed 126 focused tests, including three native Redis scenarios: unavailable startup, silent readiness and actual command stall/outage/recovery. Borrowed clients remain caller-owned. Candidate 7 has a successful strict build and 365 packaged files; final integrated acceptance remains pending.
- Installed certification now explicitly asserts native SvelteKit 404/303 control flow and safe unexpected errors. Its Redis phase also checks actual outbound HTTP, credential/account quotas and retry accounting across independent Node processes against a real loopback receiver. Adding these assertions does not claim their final installed run has passed.

### Candidate 8 Checkpoint (2026-10-13)

These earlier candidate 8 checkpoints supplement the evidence; they are not completion of the final integrated release gate. Candidate 8 is blocked by the historical-upgrade failure below. All 22 ledger rows remain **Final gate pending** until the required final artifact gates and explicit Node 22.12 floor checks pass. Earlier failed manifests/logs remain preserved and are not superseded by an acceptance claim.

- A fresh Git checkout at `865a5bf` completed normal `npm ci`, including the native SQLite dependency, then passed 335 focused tests and the strict build. This proves the normal tracked-source install/build path, not publication or all installed-app acceptance scenarios.
- The full fresh-checkout source suite passed **3,465 tests**, with **90 explicitly gated native/optional skips**, across **202 files**: 190 passed and 12 skipped. These skips are disclosed acceptance obligations, not native zero-skip evidence.
- The first formal candidate 8 run passed its first five gates: source units, all four fresh DDD/flat × Zod/Valibot CLI/type/test/build/production-browser targets, security audit, publish dry-run and operational fixture tests. Its source result was 3,466 passed with 89 conditional skips, versus the fresh-checkout 3,465/90 above: an available default consumer enabled one additional type-check case. All 202 source test files were verified byte-identical; these are distinct run counts, not a source change.
- That run then stopped at Auth UI Zod after 22 of 24 checks, with a 10-second wait for the “Stay signed in” dialog to close. The fixture had only 15 seconds of idle lifetime remaining, while its 1.8-second request pacer delayed the renewal until after expiry. The endpoint correctly returned 401; the timeout did not prove a runtime renewal hang. The failed manifest/logs and completed cleanup remain preserved.
- Harness-only commit `0a20249` gives the owned fixture 45 seconds remaining inside a 60-second warning window, keeps creation/activity timestamps consistent, and asserts the renewal POST status/payload before waiting for dismissal. Its 38 regression tests passed without skips. A minimal actual-candidate8 probe returned 200, hid both browser dialogs and preserved the absolute expiry cap. A normal expired-session request returned 401 JSON in about 5 ms, and an independent browser read succeeded; the CDP body-read probe issue was instrumentation, not a stalled runtime. Core 0.8.0 tarball bytes are unchanged.
- The recheck under `evolution-candidate/certification8-auth-recheck` passed its first 14 phases before failing phase 15, the real published-0.7.9 historical upgrade. Its source suite passed 3,479 with 89 conditional skips; all four fresh apps passed 45 tests each, CLI execution, zero-error/zero-warning type checks and production browsers. Both Auth UI providers completed 24 checks with zero runtime errors; UI patterns passed eight, invitations passed 14 per provider with preserved source, and populated operations passed nine. Source-native runtime passed 163, million-row checks two and strict consumer types 13 without skips. These completed phases do not accept the unfinished installed-native phases, full coordinator or ledger rows; the two explicit Node 22.12 floor checks also remain required.
- Phase 15 exposed an omitted official migration target: the legacy `src/routes/api/admin/logs/+server.ts` read `stats.totalEntries` from an unawaited `LogViewer.getStats()` result. The same missing await in `src/routes/api/admin/stats/+server.ts` would serialize a Promise as `{}` instead of resolved statistics. Candidate 8 is therefore not publishable; its failed manifest/logs remain preserved, with no manual test-app patch or synchronous compatibility workaround.
- Source commit `19df187` extends the bounded core codemod from nine to eleven known scaffold paths by adding only those logs/stats routes. Its Promise-aware pass preserves native resolve/aggregations/chains and type-only bindings, supports named import aliases, and rejects unsafe/shadowed contexts before writes. Exact backups, idempotence, resolved responses, strict typing and source preservation are covered by 148 focused passing tests with no skips. This is source codemod evidence, not a successful historical upgrade on candidate 8. Candidate 9's bounded build and identity are recorded below; required installed rechecks remain pending.
- All 14 local plugins were checked against actual candidate 8: the initial focused total was **423**. The bounded corrected Datatable rerun passed **42**, replacing its earlier 40-test contribution for a composed total of **425**, not 423 plus 42. Eleven native authentication stages also passed; these plugin/consumer stages do not replace the final core coordinator.
- The corrected packed Datatable 0.3.0 checkpoint passed 42 focused tests and eight browser scenarios, including the 390px mobile overflow correction; its standalone consumer audit reported zero known vulnerabilities. Its receipt records Node 22.12.0, 58 packaged files, no missing import/export targets and no physical-package symlink. These are separate evidence scopes, not extra tests to add again to the composed plugin total.

The preserved blocked candidate 8 core archive is `evolution-candidate/beeblock-svelar-0.8.0-candidate8.tgz`, SHA-256 `4093aed3e7240ad1451cecf2eea09851aedd26efc854cc375988883a1767b7bf`. The corrected Datatable archive is `plugin-final8/datatable-afterwrap/beeblock-svelar-datatable-0.3.0.tgz`, SHA-256 `b348f5cd0f6fc761c5dea6f4f2fb84e88bcd92e4cd2458ff36413e02cde807a4`; use its adjacent `datatable-packed-acceptance.json` receipt, not the earlier same-version archive outside `datatable-afterwrap`. Paths are relative to `../svelar-testing-area/artifacts/`.

Candidate 9 is `evolution-candidate/candidate9/beeblock-svelar-0.8.0.tgz`, SHA-256 `eb27f7c14db79b9da7fc58f1ac947fc4dcd0a8df8916da8f3849b7ae5bdf0a0d`. Its strict build passed, with 365 packaged files and 63 CLI commands. The byte comparison against candidate 8 changes only `dist/cli/bin.js` and `dist/cli/index.js`; the other 363 runtime/declaration/manifest files are identical. The targeted published-0.7.9 upgrade probe passed all four DDD/flat × Zod/Valibot shapes, preserving source, environment, seeded data and exact logs/stats backups; each passed zero-error/zero-warning types, login, 32 tests and build. Candidate 9's subsequent full coordinator still failed Auth UI gate 6 as recorded below, so this archive is not publishable. This artifact identity and bounded build do not establish final release acceptance.

### OTP Scaffold Race And Candidate 10 (2026-10-13)

Candidate 9's full run stopped at Auth UI gate 6 when invalid-code verification returned 400 instead of the expected 401. The bounded repro found `654321` in the input DOM but an empty `code` in the POST: the send action's delayed `/otp-login/__data.json` invalidation completed between entry and verification serialization, resetting the second Superform. A direct backend request with that same populated invalid code returned 401. This was a genuine generated-frontend state race, not a schema/Auth API regression or a harness expectation to weaken; the failed run remains preserved.

Source commit `c8bbc69` changes only the OTP page template and its regressions: send-side `invalidateAll: false`, plus verify `onResult` clearing only a matching posted failure; transport `onError` clearing remains. The 63 focused Zod/Valibot snapshot/render/callback tests passed without skips in about three seconds, and the scoped strict source check passed. Shared schemas and backend auth APIs were not changed. These source tests do not certify browser ordering in the packed app.

Candidate 10's completed build and subsequent installed checkpoints are recorded below. All 22 items remain **Final gate pending**, and neither candidate 8 nor 9 is accepted or released.

### Candidate 10 Pending Final Gate (2026-10-14)

The immutable archive is `evolution-candidate/candidate10/beeblock-svelar-0.8.0.tgz`, SHA-256 `4f72573381beef38f61b9fae9244f6c01a86767ca313455eba2a1d0bb90a28f7`, with 365 files and 63 CLI commands. The following contributor harness corrections do not rebuild or change this archive.

- The mandatory coordinator now has **25 gates**: the earlier 21 plus installed scheduler web/restart, literal capability-button absence with direct HTTP 403 for Zod and Valibot, and generated adapter-node deployment. The three added helper suites join the existing fixture gate rather than adding three more gates. Generated-app deployment remains separate from the existing SOURCE-native joint traffic/active-worker proof. The helper checkpoint passed 45 new tests plus 12 existing tests, totaling 57, not 58; the corrected plan suite passed 76 without skips. Its earlier stale client-count expectation failure remains preserved.
- The earlier 21-gate attempt passed 18 gates before PgBouncer reset failed because the harness had not supplied the explicit destructive-database acknowledgement. The safety guard remained intact. Harness commit `aae002d` derives authorization only from owned SQL services/PgBouncer and rejects external or mismatched SQL targets; SQLite does not need this authorization. The targeted PgBouncer recheck passed 43 tests, but does not complete a full coordinator run.
- The first 25-gate attempt passed its first 11 gates. Source units passed **3,554**, with **89 explicitly conditional skips**, across **204 files**. All four fresh DDD/flat x Zod/Valibot apps passed 45 tests each, CLI execution, zero-error/zero-warning types, builds and production browsers. Helper Node tests passed 57; both Auth UI providers completed 24 checks, patterns passed eight, invitations passed 14 per provider with source preservation, and populated operations passed nine. These scopes are distinct and must not be summed into an installed-only total.
- Gate 12, scheduler process/restart, failed at fixture startup: the harness imported `ScheduleMonitor` from the scheduler root instead of the dedicated `@beeblock/svelar/scheduler/ScheduleMonitor` public subpath. Only its artifact-identity check ran; this failed attempt proves no scheduler execution or restart behavior. The failed manifest under `candidate10/certification-final25/78b58fef-77f2-4475-950f-7f9b9a51bb4d/`, logs and completed cleanup remain preserved.
- After the harness-only import/preflight correction, the standalone actual-Core10 scheduler report passed **10 checks**, including separate web enable/disable, real cron execution, killed/replaced daemon PIDs, persisted last/next state and queued execution after restart. Its **34 helper tests** passed without skips. The installed public HTTP/process harness is not browser UI evidence; see `candidate10/scheduler-addon-recheck-20261014/native-attempt1/report.json`. Standalone success does not turn the failed integrated run into a pass.
- The explicit Node **22.12.0** floor suite passed **21 tests without skips**, including both opt-ins; see `candidate10/node22-floor-full.json`. This is a separate floor receipt, not 21 completed coordinator gates. Plugin focused/consumer receipts and native evidence transferred by byte identity remain separately scoped, not a claim that all plugin native scenarios reran on Core10.
- `candidate10/p0-published079/index.json` records **five representative P0 IDs and 11 reproduced negative observations** against the physical published 0.7.9 package on Node 22.12.0. These cover CLI concurrency/expired locks and absent replacement recovery within the observed 35 seconds, Redis lost updates/admission/XFF, concurrent tenant identities, persisted ORM diffs/instance audit omissions and native Kit 404/303 becoming 500. **TTL loss was not observed.** The initial invalid counter decoder receipt is quarantined and excluded; the corrected public `Cache.get()` receipt is authoritative. These bounded negatives map to current counterpart tests but do not claim all baseline acceptance criteria or current-Core10 positive results. Owned Redis/process cleanup completed.

### Candidate 10 Generated Deployment Blocker (2026-10-14)

**Candidate 10 is not publishable.** The standalone generated-app Docker proof found a real packed-template defect, distinct from the earlier harness failures: the read-only `pgbouncer.ini` has no active `[databases]` mapping. Supplying `DATABASE_URL` generates credentials but cannot populate that existing configuration. Migration bootstrap failed with `no such database: svelar` before readiness or traffic promotion.

Both generated Docker images built and passed installed Core10 SHA/integrity provenance, but generated-app readiness/drain, start-first promotion and retained rollback remain **unproven**. The failed report, diagnostic JSON and owned-resource cleanup are preserved under `candidate10/generated-deployment-addon-recheck-20261014/ffc74886-d392-4b6f-87ae-1288af6f7ccf/`. The earlier SOURCE-native joint HTTP/BullMQ deployment evidence does not replace this failed installed-app gate.

Source commit `94b64e1` adds wildcard routing without forcing a database name, separate database environment variables, explicit SCRAM alignment and authenticated `SELECT 1` health; see [PgBouncer deployment configuration](./29-deployment.md#pgbouncer-connection-pooling). Its 38 focused tests passed without skips and the strict source type check passed. Its SOURCE-native report passed six checks with no cleanup errors: default/custom database routing, read-only configuration preserved, correct punctuation credentials accepted, incorrect credentials rejected, and real container health rejecting bad credentials. A double-quote-containing password remains unsupported by the pinned image's unescaped userlist writer. The receipt is `candidate10/pgbouncer-source-correction-20261014/576865eb-5f1a-4ec9-893d-ae72606950c0/native-report.json`; it is not installed candidate 11 or generated adapter-node deployment evidence.

The replacement candidate 11 build/provenance completed, but its installed deployment recheck exposed the separate runtime blocker below. A source patch or successful query alone cannot certify promotion/drain/rollback, and no test-app workaround makes the preserved Core10 archive publishable.

### Candidate 11 Scheduler PostgreSQL Blocker (2026-10-14)

**Candidate 11 is not publishable.** Its archive is `evolution-candidate/candidate11/beeblock-svelar-0.8.0.tgz`, SHA-256 `9bb767194ef8fb8794f6631c513b9564d655ef277c06e5dfaf0724482381b2f4`. The strict build passed with 365 files and 63 CLI commands. Only two CLI files changed against candidate 10; the other 363 files are byte-identical, which is provenance evidence, not a claim that their runtime behavior passed this installed scenario.

The actual generated Docker app passed PgBouncer/migration bootstrap and installed-image integrity. The interrupted run recorded four partial checks: production provenance, initial blue app/worker/scheduler process startup, dependency-controlled readiness 503 while liveness remained 200, and old-slot traffic ineligibility 503. Initial process startup does not prove stable scheduler health or domain-job readiness.

The PostgreSQL scheduler then crash-looped: `SchedulerRuntimeStore.process()` builds an upsert update-column list from `['state', 'heartbeat_at', ...Object.keys(data)]`, while `writeHeartbeat()` also supplies `state` and `heartbeat_at`. The duplicated assignments cause PostgreSQL to reject the heartbeat with `multiple assignments to same column "state"`. The container restarted seven times with exit code 1. The runner was deliberately interrupted on this real defect; its interruption is not a passing availability result.

The report and scheduler container log remain under `candidate11/generated-deployment-addon-recheck-20261014/2dd71d59-bbdb-46e0-913f-d8cc47b89034/`, including `report.json` and `container-51e996df829f.log`; owned-resource cleanup completed without errors. Completion of the held HTTP request with 200, drain exit 0 and retained rollback remain **unproven**. Earlier SOURCE-native deployment receipts and Core10 standalone checks do not close this installed failure.

The bounded runtime correction, PostgreSQL/MySQL regressions and runner restart-count checks are recorded below with candidate 12's build identity. They do not complete installed generated deployment or accept any package for publication.

### Candidate 12 Pending Installed Gate (2026-10-14)

The frozen archive is `evolution-candidate/candidate12/beeblock-svelar-0.8.0.tgz`, SHA-256 `f36e8386312f9d46fc239d72b131e6fa79f9b1cd45e161e565b4ef2ff07ba7ed`, built at `2889799` with runtime correction `e5b0514`. Strict build/declarations and CLI preflight passed, with 365 packaged files and 63 commands. This is artifact/build provenance, not completed release acceptance.

The runtime fix deduplicates the heartbeat upsert columns. The contributor deployment runner now checks zero restarts, live role PIDs/health and captures the exact failing role's log, repeating role checks after promotion/rollback. Focused source tests passed 45 without skips, helper Node tests passed 18 without skips, and the strict source type check passed.

The SOURCE-native receipt `candidate11/scheduler-source-correction-20261014/dc598d76-719d-4885-abf5-bbf33206dc21/report.json` passed three checks for each of PostgreSQL and MySQL, six total, using four real CLI scheduler processes. It verifies advancing heartbeats, durable run-now execution once per generation, SIGTERM exit 0, distinct replacement PIDs/owners and persisted stopped records; cleanup had no errors. These source-built processes used Node 24.19.0. They are not packed candidate 12 execution, SRI or Node 22.12 floor evidence.

The byte comparison against candidate 11 changed four entries: `dist/cli/bin.js`, `dist/cli/index.js`, `dist/index.js` and `dist/scheduler/index.js`; 361 files remain identical, with no additions/removals. Changed root/scheduler runtime bundles prevent a blanket transfer of earlier native results. Unchanged bytes alone do not establish that all native/plugin scenarios reran on candidate 12.

### Candidate 12 Installed Drain Failure (2026-10-14)

**Candidate 12 is not accepted or ready for publication.** Its actual generated-app addon failed `assertDrain`. Installed-image integrity, initial role health with zero restarts, readiness 503/liveness 200 and old-slot traffic ineligibility 503 passed their bounded checks, but the old app exited **137**, with `OOMKilled=false`, after real SIGTERM and the 30-second Docker stop deadline. Promotion observations do not establish graceful shutdown or completed rollback.

The original helper did not retain the held HTTP response status before asserting drain. Do not infer either successful HTTP completion or a failed response from that missing value. The report/logs and cleanup without errors remain preserved under `candidate12/generated-deployment-addon-20261014/d912e143-ba1d-4c5a-b059-0f623bb25283/`.

The initial run left the shutdown cause under investigation. A later logging-only causal probe used the same exact candidate 12 archive: the held HTTP response completed with **200**, body `{ data: [] }`, after **22,083 ms**, but the app still exited 137 without OOM. At +1/+5/+10/+20 seconds after `sveltekit:shutdown`, the sole remaining referenced TCP handle was the exact framework-owned `RedisCacheStore` stream (`owned=true`, `ready`, `refed=true`, matching the active handle); database/queue sockets had gone. This identifies the retained owned-cache socket rather than assuming it from the exit code.

The causal receipt is `candidate12/generated-deployment-causal-recheck-20261014/83303f99-8783-4c46-bb07-184cbfec19ee/causal-proof.json`, with the container log alongside it and cleanup without errors. Its read-only mount/ESM preload observed handles without closing/flushing them or forcing exit. It is **logging-only diagnostic evidence, not pristine generated-app acceptance**; it does not fill the original run's missing response field or prove rollback. The required drain/rollback assertions must not be relaxed.

Source correction `d6f96cb` adds owner-safe public `Cache.close()` and awaited generated cleanup after HTTP drain; it does not flush Redis keys or disconnect a borrowed client. Its 176 focused tests and four SOURCE-native Redis tests passed without skips; strict source types passed. Under `candidate12/cache-source-correction-20261014/`, the owned-close child exited naturally with code 0 in 273 ms and the independent reader in 222 ms, both with only `PipeWrap` resources: data survived and the borrowed client remained usable. Diagnostic helper commit `aa02589` passed 20 Node tests without skips. These source/helper receipts are not a packed candidate 13 SRI, generated-app promotion/drain/rollback or full-certification result; see [Closing cache resources](./12-additional-features.md#closing-cache-resources) for the public lifecycle contract.

Candidate 11/12 failure receipts stay preserved and blocked; the source correction does not retroactively pass either run.

### Candidate 13 Scoped Installed Checkpoint (2026-10-14)

The frozen archive is `evolution-candidate/candidate13/beeblock-svelar-0.8.0.tgz`, SHA-256 `06c8c008d980182d0c476a8957a401b86ccd42b99ca9cc220207a25ea9d93bb7`, built at `21122d0` with cache correction `d6f96cb`. Strict build/declarations passed with 365 files and 63 CLI commands. The comparison against candidate 12 changes 19 packaged entries, including cache declarations/runtime and importing bundles; 346 remain identical. This does not permit a blanket transfer of earlier native/plugin execution results.

The pristine installed generated-app addon passed **11 checks** under `candidate13/generated-deployment-20261014/8c465222-aa85-4eca-a9eb-536aece33181/report.json`, with the exact archive/SRI, no diagnostic preload and preserved source fingerprints. Promotion completed the held HTTP request with 200 in 21,881 ms, rollback with 200 in 14,948 ms; both received SIGTERM, remained alive until release, then exited 0 without OOM or forced SIGKILL. Readiness returned 503 while liveness stayed 200 under the controlled dependency lock. All 14 ordinary HTTP samples returned 200, with zero drops or retries; nine app/worker/scheduler observations recorded live PIDs and zero restarts. Owned Docker/app cleanup completed without errors.

This proves the stated generated adapter-node HTTP/deployment CLI boundary, promotion and retained rollback. Worker/scheduler observations are **startup only**, not generated domain-job execution or long active-job drain; that work has separate SOURCE-native receipts. TLS, multi-host failover, SSE/WebSocket drain and differing schema-version rollback are outside this addon. It is not 100% coverage or completion of the integrated release gate.

Plugin receipt `plugin-final13/evidence/final-acceptance.json` records a fresh execution of **425 focused tests across 14 plugins** on Node 22.12.0, **11 native stages** exiting 0 and **eight browser checks** with zero page errors. These are separate counts, not a combined test total or transferred candidate 8-12 evidence. All 365 installed core files matched the selected archive before and after the native/browser checks, without source aliases; the reused graph directory's historical name does not select an older package. The exact Datatable archive matched all 58 physical files, had no missing export/relative-import targets and passed strict packed-peer resolution; its fresh lock audit, including optional Excel, reported zero vulnerabilities. This scoped plugin proof does not certify every SDK branch, core CSRF middleware or a fresh live Meilisearch server.

Formal **25-gate** run `candidate13/certification/4302a860-846b-4107-b6fd-84f631ca5f0b/manifest.json`, with `--million` and `--type-deps`, was **intentionally interrupted and superseded, incomplete and not accepted** after a read-only requirements audit. Its preserved manifest records seven passed phases: SOURCE unit, security audit, exact-archive publication dry-run, fresh four-app CLI/type/test/build/production-browser matrix, source helper fixtures and both Auth UI providers. The next `ui-patterns` phase is literally `failed`, with `Release certification interrupted.`; the remaining 17 phases were not run. This is not a full-25 PASS or a diagnosed UI-pattern runtime failure.

SOURCE unit reported 3,575 passes and 90 conditional skips (3,665 total) across 205 files: 193 passed and 12 conditional, in 201.87 seconds. Conditional skips are not acceptance; distinct required opt-in receipts must prove their stated coverage. This SOURCE run is not installed-SDK or fresh-CI evidence.

The audit identified SVE-015's explicitly requested typed JSON/window QueryBuilder helpers as missing. Combined native PostgreSQL JSONB-operator/binding coverage and a combined `firstOrCreate` UUID/tenant/observer/audit lifecycle regression remain required on the replacement archive, as does browser coverage for non-login auth busy states and duplicate-submit prevention. Implementation and final-artifact proofs are pending; no new helper API is claimed here. A replacement candidate 14 identity has not yet been recorded.

Follow-up `54e0e07` adds the combined UUID/tenant/model-observer/persistent-audit assertion to the installed certification fixture. Its reported receipts are 17 harness tests and 45 actual SQLite app tests, separate counts; they do not close PostgreSQL/MySQL or replacement-artifact acceptance. ORM helper verification and final-artifact repetition remain pending.

Non-login pending-state addon `candidate13/pending-browser-20261014/summary.json` passed on the exact candidate 13 SHA: **25 Auth checks per provider** and **14 invitation checks per provider**, without skips. Its 12 real-POST barrier records cover password recovery/reset, OTP send/verify and invitation accept/decline in both Zod and Valibot. Validated submissions showed visible loading/busy feedback, disabled controls and one POST despite duplicate-submit attempts; the real actions resumed without response stubs. Existing secret-clearing, CSRF, permission and result checks were retained. Harness regressions passed 47 Auth and 31 invitation tests, separate from the installed browser counts. The before/after receipts preserve app source, build entries, lock SRI and eight selected physical core entries; all four runs have no cleanup errors. This closes the stated addon gap on candidate 13 only, not the interrupted formal run; repetition on the replacement artifact remains mandatory. Harness-only commits `b708d11` and `8610866` do not change the certified core archive.

A further SVE-001 gap is explicit: the five-way queue CLI/recovery proof is **SOURCE-native**, whereas the existing installed Redis fixture runs same-process concurrency 1. Neither proves packaged-CLI concurrency 5, long renewable locks, SIGTERM drain, SIGKILL recovery or job context on the final installed artifact. The successor source plan now registers **26 mandatory phases**, including an installed-native sidecar using the packaged CLI, snapshot-preserved generated fixtures and owned Redis, and inventories **10 SOURCE-native groups** with JSON/window queries. The installed queue phase follows generated deployment and precedes SOURCE-native checks; registration is not execution or acceptance. Candidate 14's strict pack and fresh runtime receipts are still pending. A full-25 result alone cannot close this newly identified requirement. An independent installed `LogViewer` reader from a job is an additional proposed check, not a completed receipt.

The complete integrated run, fresh CI, final core Node 22.12 floor and final approval remain **pending**. Plugin Node 22.12 execution does not replace the core floor gate. These scoped PASS receipts do not accept the whole package or authorize publication.

All SVE-001 through SVE-022 rows remain **Final gate pending**. The earlier npm E401 is historical authentication context, not a blocker to technical test readiness or ledger acceptance. No parent/agent login is required now: the user has chosen to publish manually later. Release notes remain **Unreleased** until the user supplies a verified publication receipt.

### Publication After Final Approval

**Manual publication only.** The user will publish later; agents must not run npm login/publish, change registry tags or create a GitHub Release. Normal hardening commits and pushes do not authorize publication. Authentication is a prerequisite only for the user's later manual upload, not for technical acceptance.

**Do not run the publication steps while any required gate or ledger row is pending.** First retain a successful manifest covering all 26 required phases (including installed-native queue CLI), plus separate floor/fresh-CI/plugin receipts and final approval binding both package versions to their archive SHA/SRI. Candidate 13 is superseded and must not be published; the replacement candidate's identity and approval are pending. Select the approved core path and identity together when available; never edit or repack an archive.

Only core `@beeblock/svelar@0.8.0` and `@beeblock/svelar-datatable@0.3.0` are intended publication targets. Other plugin drafts are not part of these publish commands. From the core repository root, the core path below deliberately remains a placeholder until final approval; Datatable's retained candidate path is also subject to that approval:

```bash
ARTIFACTS="$PWD/../svelar-testing-area/artifacts"
CORE_TARBALL="/absolute/path/to/final-approved/beeblock-svelar-0.8.0.tgz"
DT_TARBALL="$ARTIFACTS/plugin-final8/datatable-afterwrap/beeblock-svelar-datatable-0.3.0.tgz"
shasum -a 256 "$CORE_TARBALL" "$DT_TARBALL"
```

Stop unless both hashes match the final approved receipts. Core's approved SHA/SRI is not yet selected; candidate 13's historical SHA above is not publication approval. The retained Datatable SHA is `b348f5cd0f6fc761c5dea6f4f2fb84e88bcd92e4cd2458ff36413e02cde807a4`. The approved core `identity.json` and Datatable's adjacent `datatable-packed-acceptance.json` must supply the matching SRI. The older same-version Datatable archive outside `datatable-afterwrap` is not selected.

1. When you choose to publish manually after technical acceptance and final approval, authenticate your maintainer account and verify its identity. It must have publishing rights to both packages; finish any browser/2FA challenge. If E401 persists then, privately check registry/scoped-registry and configuration precedence. Never paste `.npmrc`, passwords or tokens into reports. See [npm login](https://docs.npmjs.com/cli/v11/commands/npm-login/).

```bash
npm login --scope=@beeblock --auth-type=web --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
```

2. Check the exact target versions before writing to the registry. A genuine version-not-found result is different from E401/network failure. If a version already exists, compare its SRI with the approved receipt: matching bytes mean it is already published; different bytes require maintainer review. Do not overwrite, unpublish or bump versions to work around a conflict. See [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

```bash
npm view @beeblock/svelar@0.8.0 version dist.integrity --json --registry=https://registry.npmjs.org
npm view @beeblock/svelar-datatable@0.3.0 version dist.integrity --json --registry=https://registry.npmjs.org
```

3. Dry-run the exact approved archives. Do not use `npm run release`, workspace publishing, `npm version`, another build or `npm pack`: the current workspace release helper runs validation/build and publishes the workspace, and core's `prepublishOnly` rebuilds. Tarball publication with [ignore-scripts](https://docs.npmjs.com/cli/v11/using-npm/config/#ignore-scripts) avoids those lifecycle hooks.

```bash
npm publish "$CORE_TARBALL" --dry-run --ignore-scripts --access=public --tag=latest --registry=https://registry.npmjs.org
npm publish "$DT_TARBALL" --dry-run --ignore-scripts --access=public --tag=latest --registry=https://registry.npmjs.org
```

4. Publish core first, then verify the exact registry version and SRI against its approved identity. Stop on any mismatch before publishing Datatable.

```bash
npm publish "$CORE_TARBALL" --ignore-scripts --access=public --tag=latest --registry=https://registry.npmjs.org
npm view @beeblock/svelar@0.8.0 version dist.integrity --json --registry=https://registry.npmjs.org
```

5. Only after core verification, publish Datatable and verify its SRI. Its selected archive has core peer `^0.8.0`, so the order matters.

```bash
npm publish "$DT_TARBALL" --ignore-scripts --access=public --tag=latest --registry=https://registry.npmjs.org
npm view @beeblock/svelar-datatable@0.3.0 version dist.integrity --json --registry=https://registry.npmjs.org
```

6. Preserve publication/registry receipts. If an upload times out, query the exact version/SRI before retrying; never blindly republish. Record a partial publication if core succeeds but Datatable does not. Convert `Unreleased` to the actual release version/date only after the relevant registry publication is verified, without rebuilding the certified archives. These instructions do not execute or authorize publication themselves.

No candidate is declared accepted or released here. Technical acceptance still requires every final phase and ledger row; it does not require npm login. Publication is a separate later action by the user, using only the exact approved archives with `--ignore-scripts`; do not rebuild, repack or patch their versions. Keep `Unreleased` until the user's actual registry receipt is verified.
