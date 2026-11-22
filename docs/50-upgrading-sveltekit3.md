# Upgrading Existing Apps To SvelteKit 3

Updating Svelar and migrating an application to a new SvelteKit major are separate operations. The framework declares Kit 2/3 compatibility so an existing application can plan its migration; a package upgrade does not authorize overwriting application code, configuration, secrets or data. Peer ranges alone are not proof that every historical app version or custom integration has been tested.

## Choose The Upgrade Scope

First update to a Svelar release containing the changes described here. Until that release is actually published, use its explicitly approved test artifact in an isolated working copy, not an assumed version number or the live app. Keep the old package lock and an independent database/storage backup.

Apps staying on Kit 2 should keep their Kit 2 adapter and Superforms dependencies. New-app templates target Kit 3 and must not be copied wholesale over an existing project. A bare `svelar update --force` refuses legacy or unrecognized SvelteKit config rather than silently performing a major upgrade.

## Diagnose Before Writing

Run in a private branch or separate working copy, with the app's existing compiler dependencies installed:

```bash
npx svelar update --migrate-sveltekit3 --dry-run
```

Review every proposed edit, warning and manual item. This mode makes no writes and does not install packages, execute configuration or invoke another migrator. `--list` is also read-only. Unsupported configurations remain manual work; `--force` does not make an ambiguous transformation safe.

Contributor tooling can use `planSvelteKit3Migration(root)` from `@beeblock/svelar/cli` for the same read-only plan. `applySvelteKit3Migration(plan, { confirmed: true })` accepts only its unchanged in-process snapshot, rechecks app-owned paths and returns the exact backup paths. Do not serialize plans into unattended jobs or treat application as completed compatibility testing.

After reviewing the plan:

```bash
npx svelar update --migrate-sveltekit3 --force
```

The migration changes only recognized patterns, creates exact adjacent `.sveltekit3.bak` backups without overwriting old backups, and writes `SVELTEKIT3-MIGRATION.md`. Its checklist can be handed to a human developer or an AI agent. The command is not a declaration that the app has finished upgrading. Existing `.env`, data, migrations, validation provider, app bootstrap and lockfiles are preserved.

## Runtime And Toolchain

Kit 3 requires Node 22.17+, TypeScript 6, Svelte 5.57.1+, Vite 8.0.12+ and `@sveltejs/vite-plugin-svelte` 7. Use maintained patched releases rather than pinning these historical minimums. Update local development, CI, Docker images, web, worker and scheduler runtimes together. Svelar's own build tooling uses tsup 9 and supports Node `^22.18.0 || ^24.11.0 || >=26.0.0`; that is distinct from an installed app's Kit runtime minimum. Generated apps select supported Node 22/24/26 lines rather than promising every odd Node release.

Core contributor checkouts pin `npm@11.21.3` through the root `packageManager` field and npm engine `^11.21.3` for reproducible workspace security overrides. This developer-only constraint does not add an npm minimum or change the package manager of an existing or newly generated app.

Use a Kit-3-compatible adapter such as adapter-node 6. Superforms 3 supports Kit 2/3; preserve the chosen Zod or Valibot provider, shared contract schema, backend FormRequest and DTO. Do not opportunistically convert validation libraries or install TypeScript 7: the maintained Svelte/compiler-API baseline remains TypeScript 6 with Node 22 ambient types.

An approved npm major-graph upgrade can report `ERESOLVE` when the existing lock/installed tree still selects adapter-node 5 or Superforms 2 while the reviewed manifest selects 6/3. After owner approval, preserve the exact old `package-lock.json` and rename the entire app-owned, physical `node_modules` directory into a private backup outside the app; move the old lockfile into that backup too, then run normal `npm install` from the reviewed manifest to resolve a fresh graph. Stop for ownership review if `node_modules` is a symlink or shared store. Do not use `--force` or `--legacy-peer-deps`, delete user records, or remove/mutate shared package stores. Other package managers require their own reviewed workflow. The Svelar migration CLI does not install dependencies automatically.

## Changes Requiring Review

| Surface | Required review |
| --- | --- |
| Configuration | Move `svelte.config.*` settings into `sveltekit({...})` in Vite. Preserve adapter options, preprocessing, aliases, CSP, proxy/origin settings and environment configuration. Unknown configs are not overwritten. |
| CSS-only dependencies | Let Vite process style-only imports such as `tw-animate-css` during SSR instead of externalizing them to Node. Review `ssr.noExternal` and include `tw-animate-css` where needed, preserving existing array entries, `ssr.external` and other externalization settings. Custom expressions require review, not replacement. Do not ignore CSS imports or discard stylesheet content to silence build errors. |
| UI utility peers | New Kit 3 apps and reviewed opt-in Kit 3 migrations use the narrow override `"runed@>=0.35.1 <0.38.0": "^0.38.0"` for the 0.35/0.37 branches used by Bits UI, svelte-toolbelt and shadcn primitives. Version 0.38's `runed/kit` requires Kit 3. Older `runed` 0.25 users and ordinary Kit 2 updates remain unchanged. Review existing custom overrides; conflicts need manual resolution, not a blanket override or forced peer resolution. |
| Imports | Kit 3 no longer supplies `$lib` automatically. Svelar preserves it using explicit aliases. Native `#lib/*` package imports are available; an intentional rename needs real extensions and directory-index resolution. |
| Types | Extend `$app/tsconfig`, with explicit include/exclude and `$app/types` in any explicit `compilerOptions.types` array. Service workers require their own project. Hook, environment and parameter types have moved to dedicated exports. |
| State/environment | Replace removed `$app/stores` with `$app/state` and review reactive `$page` reads. `$app/environment` becomes `$app/env`; review deprecated `$env/*` and removed `$service-worker`. |
| URL/query helpers | Kit 3's `page.url` is a `ReadonlyURL`. Read-only helpers can accept a structural `ReadableUrl` with `readonly href: string` and `readonly searchParams` exposing `get(name: string): string \| null`. Clone mutable URLs with `new URL(page.url.href)`, not `new URL(page.url)`, before changing query parameters. Preserve custom helper behavior and review callers manually; custom URL source is not codemodded. |
| Forms | Enhanced `fail()` responses use their actual error HTTP status; do not treat every enhanced submission as HTTP 200. Cross-page `use:enhance` submissions navigate to the action page. In manual Superforms 3 SPA handlers, `validateForm({ update: true })` can schedule automatic focus after its Promise resolves, stealing focus while the user corrects fields. Use the public per-call `focusOnError: false`, await error rendering and input unlock, then focus the first invalid field before the handler finishes. Test fast typing and keyboard correction; keep validation, inline errors, loading state and consistent `{ data, meta }` results. Existing custom SPA handlers require manual review and are not codemodded. |
| Tests | Load the Kit 3 Vite plugin in Vitest and transform Superforms with `test.server.deps.inline: ['sveltekit-superforms']` so its `$app/server` boundary resolves through Kit. Do not mock validation or replace server APIs to make tests pass. |
| Navigation | Review `goto` options, shallow-navigation hooks, refresh behavior and preload errors. External redirects need an explicit trusted-origin policy. |
| Security | Keep CSRF protection enabled. Replace removed `csrf.checkOrigin` with reviewed trusted origins, not a blanket exemption. Review reverse-proxy origin handling and cookie 2 behavior. |
| Errors | `handleError` receives expected errors too. Preserve safe app errors, do not report ordinary expected failures as unknown incidents, and never expose validation input/issues. Review `error()` arguments and `App.Error.status`. |
| Deploy | Rebuild with the compatible adapter. Static assets are build-time artifacts, not a mutable runtime configuration channel. Test shutdown/drain, readiness and background processes. |

For remaining transformations, review and explicitly run the official migrator in the working copy:

```bash
npx sv migrate sveltekit-3
```

Svelar does not run it on your behalf. Review its TODOs and complete its diff; a codemod cannot verify custom business behavior or third-party plugin compatibility.

## Performance And Operations Changes

- Set PostgreSQL `prepare: true` only after verifying pool support. Remove the superapp-style `rawClient` proxy only after testing the native option on your actual connection topology.
- Use native scheduler heartbeat/evaluation separation rather than wrapping internal timer methods. Keep durable manual requests and distributed locks.
- High-throughput queues may opt into a reduced operations-index policy. This deliberately reduces successful-job list/timeline visibility, not BullMQ execution or dead-letter reliability. Review diagnostics and retention before switching.
- Replace private logging wrappers with public processors and output/viewer options. Use `LogViewer.addEntries()` for batches and bounded `log:prune` runs. The optional log-idempotency configuration requires the additive core migration; ordinary logging does not opt in automatically.
- Fresh apps include a bounded log-retention task. Existing apps must schedule `LogViewer.prune()` or `log:prune` explicitly after the owner approves retention. Never silently remove audit or legal-retention records.
- Remove local patches only after matching regression tests pass. Primitive snapshots must still isolate mutable values; lean queries intentionally bypass casts/accessors/hidden-field shaping and are not safe API resources by themselves.

## Checklist For A Human Or AI Agent

1. Work only on the approved branch/copy. Record baseline commit, package manager, lockfile, Node/tooling versions and validation provider; never include secret values in the report.
2. Preview the Svelar migration and review backups, changed paths and manual blockers. Do not replace custom configs with fresh scaffold files.
3. Preserve controllers, shared schemas, FormRequests, DTOs, actions/services, repositories/models, Resources, migrations, policies and CSRF. A framework upgrade is not permission to bypass these layers.
4. Resolve every official/manual migration item. Install with the app's existing package manager only after approval and inspect the resulting lockfile.
5. Run type checks, relevant unit/feature tests, production build and real browser flows for login/recovery, forms, permissions, navigation, uploads and custom integrations.
6. Exercise queue jobs, retries, scheduler manual requests and restart recovery against isolated services. Use non-default host ports and do not stop other projects' containers.
7. Apply only forward additive migrations in the approved environment. Never use `migrate --fresh`, `--reset` or `--refresh` to upgrade a populated app.
8. Record actual results and unresolved issues. Keep rollback artifacts and test the deployment path before production. Passing a codemod or dependency install is not completed acceptance.

## Recovery

Keep the pre-upgrade commit and lockfile. On a failed file migration, inspect the exact backups and any reported concurrent changes; restore only reviewed files and never overwrite newer user work. Roll back package versions and deployment artifacts together. Database rollback is a separate, reviewed operation and must not destroy newly written application data.

## References

- [SvelteKit 3 migration](https://svelte.dev/docs/kit/migrating-to-sveltekit-3)
- [SvelteKit Vite configuration](https://svelte.dev/docs/kit/@sveltejs-kit-vite)
- [Superforms releases](https://github.com/ciscoheat/sveltekit-superforms/releases)
- [PgBouncer prepared-statement support](https://www.pgbouncer.org/config.html#max_prepared_statements)
