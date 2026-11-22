# Svelar

Laravel-inspired framework and application scaffold for SvelteKit, with Kit 3 new apps and an explicit upgrade path for existing Kit 2 projects.

Svelar brings Laravel-style conventions to TypeScript: Eloquent-like models, migrations, FormRequests, DTOs, actions, services, repositories, policies, queues, scheduler tasks, events, storage, mail, PDF generation, search and broadcasting.

[Documentation](https://svelar.dev/docs/getting-started) | [Installation](https://svelar.dev/docs/installation) | [SvelteKit 3 Upgrade Guide](https://svelar.dev/docs/upgrading-sveltekit3)

## Compatibility And Requirements

| Use | Supported baseline |
| --- | --- |
| Installed core in an existing Kit 2 app | Node.js `>=22.12.0`; keep compatible Kit 2 adapters and app dependencies |
| New Kit 3 app | Node.js `^22.17.0 || ^24.0.0 || >=26.0.0`, Svelte 5, Vite 8, adapter-node 6 and Superforms 3 |
| Building Svelar from source | Node.js `^22.18.0 || ^24.11.0 || >=26.0.0` for tsup 9; contributor checkouts pin `npm@11.21.3` with npm engine `^11.21.3` |
| TypeScript tooling | TypeScript 6.0.3 (`^6.0.3`) and Node 22 ambient types; TypeScript 7 is not the supported compiler-API baseline |

Core declares SvelteKit `^2.0.0 || ^3.0.0` peers for staged upgrades. A peer range is not proof that every historical app, adapter or third-party integration has been tested. Select maintained patched dependencies, not just historical minimum versions.

The root `packageManager` pin applies only to Svelar core contributors so workspace security overrides resolve reproducibly. It does not raise an installed app's runtime floor or impose a new npm minimum/package-manager choice on generated apps.

Kit 3 configuration belongs in the SvelteKit Vite plugin. Generated apps keep an explicit `$lib` alias alongside native `#lib/*` imports, extend `$app/tsconfig`, and retain `$app/types`, `node` and `vite/client` ambient types.

## Quick Start

```bash
npx @beeblock/svelar new my-app
cd my-app
npm run dev
```

New apps use a DDD modular structure and Zod by default. Choose Valibot or a flat layout explicitly:

```bash
npx @beeblock/svelar new my-app --validation=valibot
npx @beeblock/svelar new small-app --flat
```

The normal scaffold installs dependencies and shadcn-svelte components, creates secure `.env` secrets, runs migrations and seeds development users. Generated apps include `npm run ui:install` for a reviewed manual `--no-install` setup.

The development seed accounts are `admin@svelar.dev / admin123` and `demo@svelar.dev / password`. Replace these credentials and review seed data before exposing the app.

Use the package name for first-run scaffolding. Generated apps install the same package and expose its project-local `svelar` binary:

```bash
npx svelar make:entity Invoice --module=billing --fields "title:string,total:number,status:enum(draft,paid)" --crud --capability=invoices --scope=team --screen-route=/invoices
npx svelar migrate
npm run dev:worker
npm run dev:scheduler
```

Adding `@beeblock/svelar` to an existing app does not automatically configure its architecture or migrate its SvelteKit major. Follow the [installation guide](https://svelar.dev/docs/installation) and review the app's existing setup.

## Existing Apps And Kit 3 Migration

Updating Svelar and upgrading SvelteKit are separate operations. Start in an approved working copy with backups, using a Svelar release that contains the migrator:

```bash
npx svelar update --migrate-sveltekit3 --dry-run
```

Review every proposed edit and manual item before applying the migration. It preserves custom configuration when it cannot safely recognize it, creates exact adjacent backups for supported edits and can generate `SVELTEKIT3-MIGRATION.md` for developers or AI agents. `--force` is not permission to replace unknown custom code.

Preserve `.env`, data, schema history, the Zod/Valibot provider and the old lockfile. Approve dependency installation separately. Until a release is published, use only an explicitly approved test artifact in an isolated copy, not an assumed registry version.

Review removed Kit APIs, forms, hooks, navigation, CSRF, cookies, adapters and third-party integrations. Kit 3's `page.url` is a `ReadonlyURL`: read-only helpers should accept an appropriate structural input, and mutations need a clone such as `new URL(page.url.href)`. Custom URL helpers and callers require manual review, not a blanket codemod.

Complete the [upgrade guide](https://svelar.dev/docs/upgrading-sveltekit3), app checklist, relevant tests, production build and real browser flows before deployment. A successful codemod or install is not completed acceptance.

## Architecture

Keep write workflows explicit:

```text
route -> controller/page action -> shared schema/FormRequest -> DTO
      -> action/service -> repository -> model/resource -> response
```

FormRequests validate and authorize; DTOs carry validated data. Controllers and page actions stay thin. Use policies, permissions, teams and CSRF rather than bypassing security in generated or custom routes. Entity/controller/dashboard generators require a capability or an explicitly reviewed public exemption.

Default modules live under `src/lib/modules/<module>/`:

```text
contracts/schemas/
domain/models/
domain/events/
domain/observers/
domain/policies/
application/actions/
application/dto/
application/listeners/
application/notifications/
application/services/
infrastructure/repositories/
interface/http/controllers/
interface/http/requests/
interface/http/resources/
```

App-wide jobs, tasks, commands and providers live under `src/lib/shared/`; migrations and seeders live under `src/lib/database/`. App-owned imports use `$lib/...`.

Use events/listeners for side effects and queue jobs for slow or retryable work. Cross-module reads should use narrow public application services returning DTO/contract data, not another module's models, repositories or controllers.

See [Architecture & Modules](https://svelar.dev/docs/architecture) and [Services, Actions & Repositories](https://svelar.dev/docs/services).

## Framework Features

- **ORM and migrations:** Drizzle-backed SQLite, PostgreSQL and MySQL support, relationships, casts, soft deletes, observers, public UUID v7/ULID identifiers, migrations, seeders and factories. Read-only `lean()` results bypass model casts, accessors and hidden-field filtering; use reviewed projections and Resources for responses.
- **Validation and forms:** shared Zod or Valibot schemas for backend FormRequests, DTOs and frontend Superforms. Generators honor `svelar.validation.json`.
- **Auth and authorization:** sessions, JWT/refresh tokens, API credentials, password recovery, email verification, OTP, policies, roles, scoped permissions and teams, plus CSRF, rate limits and request signatures.
- **Queues and scheduler:** sync, memory, database and Redis/BullMQ drivers, retries and failed-job handling, named-queue adapters, persistent scheduler requests and distributed leases. Memory queues are process-local; reduced Redis operations indexing deliberately reduces successful-job visibility.
- **Events and realtime:** typed events, listeners and model observers, SSE channels and Pusher-compatible Soketi broadcasting. Realtime signals do not replace durable application state.
- **Storage and documents:** local/S3-compatible disks, validated uploads, PDFKit/Gotenberg PDF generation and Excel import/export. Optional backends require their configured peers and services.
- **Mail and integrations:** Mailable classes, notifications, webhooks, HTTP helpers and Meilisearch with a durable transactional search outbox; inline search delivery is an explicit alternative.
- **Logs and audit:** ordered log processors, output/viewer destination controls, redaction, shared database viewer, bulk `LogViewer.addEntries()` and bounded `log:prune`. Optional idempotency needs its additive migration. Review retention before enabling scheduled pruning; operational logs and audit/legal retention are separate policies.
- **App helpers and UI:** feature flags, email templates, dates, testing helpers, dashboard surfaces, shadcn-svelte scaffolding and opt-in [Paraglide integration](https://svelar.dev/docs/i18n). New apps do not enable multilingual routing automatically.
- **Deployment scaffolding:** separate app, worker and scheduler processes, health checks and optional PostgreSQL/PgBouncer, Redis, Soketi, Gotenberg, RustFS and Meilisearch services, with non-default local service ports.

Use documented package subpaths such as `@beeblock/svelar/orm`, `@beeblock/svelar/routing`, `@beeblock/svelar/logging` and `@beeblock/svelar/queue` for focused imports. Backend credentials and server-only imports must stay out of client bundles.

## Validation Providers

```ts
// Zod app
import { z, rules } from '@beeblock/svelar/validation';

// Valibot app
import { v, rules } from '@beeblock/svelar/validation/valibot';
```

Choose one app provider and retain the shared-schema -> FormRequest -> DTO -> action/service flow. A framework or Kit upgrade is not a reason to switch providers implicitly.

## Project-Local CLI

```bash
npx svelar make:schema invoice --module=billing
npx svelar make:dto CreateInvoice --module=billing --input=CreateInvoiceInput --schema=invoice
npx svelar make:request CreateInvoiceRequest --module=billing
npx svelar make:action CreateInvoiceAction --module=billing
npx svelar make:resource InvoiceResource --module=billing
npx svelar make:job SendWelcomeEmail
npx svelar make:task PruneApplicationLogs
npx svelar migrate
npx svelar seed:run
npx svelar routes:list
npx svelar queue:work
npx svelar schedule:run
npx svelar tinker
```

`make:entity --crud` generates the coordinated model, focused migration, shared schema, DTOs, FormRequests, actions, resource, repository, service, controller and route pieces. Run `npx svelar` to inspect the commands available in the installed version.

## Plugins

Plugins are optional, separately versioned packages. The publicly published [DataTable package](https://www.npmjs.com/package/@beeblock/svelar-datatable) has its own [integration guide](https://svelar.dev/docs/datatable); check the selected release's core/Svelte peer requirements and test it with your app.

Other plugin documentation and local candidate checkouts do not imply that every plugin or compatible update has been published. Registry availability, declared compatibility and local test results are separate facts. Consult the [plugin guide](https://svelar.dev/docs/plugins) and each package's actual registry release before installing. Do not assume a repository-wide plugin table is a public release inventory.

## Documentation And Verification

- [Getting Started](https://svelar.dev/docs/getting-started)
- [Installation](https://svelar.dev/docs/installation)
- [Validation & DTOs](https://svelar.dev/docs/validation)
- [Architecture & Modules](https://svelar.dev/docs/architecture)
- [Security](https://svelar.dev/docs/security)
- [Logging And Additional Features](https://svelar.dev/docs/additional-features)
- [Deployment](https://svelar.dev/docs/deployment)
- [SvelteKit 3 Upgrade Guide](https://svelar.dev/docs/upgrading-sveltekit3)
- [Release Certification](https://svelar.dev/docs/release-certification)
- [Changelog](https://svelar.dev/docs/changelog)

Release verification tooling belongs to the source monorepo, not an installed application's scripts. Read the certification guide for required build, test, generated-app, browser and isolated-service evidence. These are acceptance gates, not a claim that all checks or plugins have passed for a particular artifact.

The `@beeblock/svelar` package includes the `svelar` binary. There is no separate unscoped `svelar` package to publish.

## License

MIT
