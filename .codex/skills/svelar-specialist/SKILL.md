---
name: svelar-specialist
description: Use when working on Svelar core or Svelar apps, including scaffolding, routes, controllers, FormRequests, DTOs, schemas, ORM, migrations, repositories, services, actions, resources, auth, policies, permissions, teams, queues, cache, scheduler, events, listeners, observers, mail, notifications, storage/uploads, PDF, search, SSE/Soketi broadcasting, webhooks, audit/logging, Docker, browser testing, production certification, docs sync, plugins, or any @beeblock/svelar import.
---

# Svelar Specialist

Svelar is a Laravel-inspired TypeScript framework on SvelteKit 2. Treat the docs as the product contract, but verify implementation, generated templates, tests, and runtime behavior before assuming a feature is production-ready.

## Non-Negotiable Rules

- Use Svelar CLI generators before hand-writing artifacts whenever a generator exists.
- For CRUD/API features, start with `npx svelar make:entity ... --crud` or the focused `make:controller`, `make:request`, `make:schema`, `make:dto`, `make:action`, `make:resource`, `make:repository`, and `make:model` commands. If you skip a generator, explain the reason before editing files.
- Do not bypass Svelar architecture with ad hoc page-only logic for real features.
- Default app flow is: route -> controller/page action -> FormRequest/shared schema validation -> DTO -> action -> service -> repository -> model/resource -> response.
- Use controllers for HTTP/API resources. SvelteKit page server actions may orchestrate page forms, but business workflows still go through FormRequest -> DTO -> action/service.
- Use both FormRequest classes and DTOs for write paths. FormRequest validates and authorizes; DTO carries validated data into actions/services.
- Use shared contract schemas for frontend and backend validation. Do not duplicate one schema for Superforms and another schema for FormRequest.
- Keep validation consistent with `svelar.validation.json`: Zod apps use `@beeblock/svelar/validation`; Valibot apps use `@beeblock/svelar/validation/valibot`.
- Use Svelar ORM, models, repositories, and migrations. Avoid raw SQL except explicit infrastructure-level driver behavior that the ORM cannot represent.
- Create one migration per table or focused schema change.
- Prefer integer primary keys internally plus UUID v7 or ULID public identifiers for API/UI exposure when useful.
- Use policies, permissions, roles, teams, middleware, rate limits, sessions, jobs, events, listeners, observers, cache, storage, search, PDF, mail, notifications, audit, logs, and broadcasting through Svelar APIs instead of custom one-off implementations.
- Mutating browser `fetch` calls must include the Svelar CSRF token header. Enhanced forms can rely on the form flow.
- Use `$lib/...` aliases for app-owned imports. Keep relative imports only for local SvelteKit conventions like `./$types`.
- Use generated shadcn-svelte components for app UI. Reserve Svelar UI components for framework surfaces.
- Use Svelte 5 runes in `.svelte` files only: `$props`, `$state`, `$derived`, `$effect`, and `{@render children()}`.
- Do not use Svelte runes in plain `.ts` files.

## Hard Stops

- Do not implement CRUD directly inside `src/routes/**/+server.ts`. Route files should bind or call controllers and stay thin.
- Do not put validation, authorization, persistence, and response shaping all in a SvelteKit action or API route.
- Do not create a write path without a shared schema, FormRequest, DTO, action/service, repository/model, and resource/consistent response envelope.
- Do not create database tables from runtime code. Use migrations.
- Do not use raw SQL for normal CRUD/query work. Use models, repositories, and the Svelar ORM/query builder.
- If existing code violates these rules, stop adding more of the same pattern and first refactor the touched flow toward Svelar conventions.

## Data, Config, And Seeders

- Never hardcode app data in routes, controllers, actions, services, repositories, or Svelte components.
- Schema changes go in migrations. Do not create or alter tables from runtime code, route handlers, services, stores, jobs, or app bootstrap.
- Demo/default/reference data goes in seeders. Use `npx svelar make:seeder` or the existing seeder structure, then run `npx svelar seed:run`.
- Test data goes in factories or test setup, not production seeders or route handlers.
- Runtime settings go through `.env`, `.env.example`, `src/app.ts`, and Svelar config helpers. Do not hardcode secrets, URLs, ports, bucket names, provider keys, feature flags, user IDs, team IDs, role IDs, or permission IDs.
- Permission and role names may be named constants/contracts, but assignment of initial roles/permissions belongs in seeders.
- File paths, public URLs, mail provider names, queue names, disk names, and search index names should come from config or central constants, not scattered string literals.
- If a feature needs initial admin/demo records, create or update a seeder and document the login/test data.

## Feature Checklist

- HTTP/API: route file -> controller -> FormRequest -> DTO -> action/service -> repository/model -> resource/response.
- Page form: shared schema -> Superforms -> page action -> FormRequest/DTO/action -> resource-like `{ data, meta }` result.
- Database: migration per table/focused change, model, repository, seeder/factory where needed.
- Authorization: FormRequest `authorize`, policies for model decisions, roles/permissions/teams where feature access is user-configurable.
- Side effects: events/listeners/observers; queue jobs for slow or retryable work.
- Runtime services: use Svelar cache, queue, scheduler, storage/uploads, PDF, mail, search, broadcasting, audit/logging, and webhooks APIs instead of one-off integrations.
- UI: loading states, inline validation, no duplicate validation toasts, success/error feedback, empty states, and realtime updates where expected.
- Tests: add focused unit/feature/browser tests for the behavior touched, including permissions and failure cases.

## CLI-First Workflow

For a full Laravel-style resource, start here:

```bash
npx svelar make:entity Invoice --module=billing --fields "title:string,total:number,status:enum(draft,paid)" --crud --capability=invoices --scope=team --screen-route=/invoices
```

Use focused generators for individual artifacts:

```bash
npx svelar make:model Invoice --module=billing
npx svelar make:migration create_invoices_table
npx svelar make:schema invoice --module=billing
npx svelar make:dto CreateInvoice --module=billing --input=CreateInvoiceInput --schema=invoice
npx svelar make:request CreateInvoiceRequest --module=billing
npx svelar make:action CreateInvoiceAction --module=billing
npx svelar make:service InvoiceService --module=billing
npx svelar make:repository InvoiceRepository --module=billing
npx svelar make:controller InvoiceController --module=billing --capability=invoices --scope=team --screen-route=/invoices
npx svelar make:resource InvoiceResource --module=billing
npx svelar make:event InvoicePaid --module=billing
npx svelar make:listener SendInvoiceReceipt --module=billing
npx svelar make:observer InvoiceObserver --module=billing
npx svelar make:job SyncInvoiceJob
npx svelar make:task PruneOldInvoices
npx svelar make:command ReconcileInvoices
npx svelar make:channel TeamChannel
npx svelar make:broadcasting
npx svelar make:dashboard --capability=operations --scope=platform
npx svelar make:docker
npx svelar make:test InvoiceService --unit
```

Runtime commands:

```bash
npx svelar migrate
npx svelar seed:run
npx svelar routes:list
npx svelar queue:work --queue=default --once
npx svelar queue:failed
npx svelar queue:retry --all
npx svelar schedule:run
npx svelar search:setup
npx svelar tinker
npm run dev:worker
npm run dev:scheduler
```

When creating a new app:

```bash
npx @beeblock/svelar new my-app --validation=zod
npx @beeblock/svelar new my-app --validation=valibot
npx @beeblock/svelar new my-app --flat
```

## DDD Module Layout

In generated DDD apps, module artifacts belong here:

```txt
src/lib/modules/<module>/
  contracts/schemas/<name>.schema.ts
  domain/models/<Model>.ts
  domain/events/<Event>.ts
  domain/observers/<Observer>.ts
  domain/policies/<Policy>.ts
  application/actions/<Action>.ts
  application/dto/<Dto>.ts
  application/listeners/<Listener>.ts
  application/notifications/<Notification>.ts
  application/services/<Service>.ts
  infrastructure/repositories/<Repository>.ts
  interface/http/controllers/<Controller>.ts
  interface/http/requests/<Request>.ts
  interface/http/resources/<Resource>.ts

src/lib/shared/
  channels/
  commands/
  jobs/
  middleware/
  providers/
  scheduler/

src/lib/database/
  migrations/
  seeders/
```

Do not put a pile of unrelated feature files directly under the module root. Keep routes thin and delegate to controllers/actions.

## Required Write Flow

For create/update/delete workflows:

1. Shared schema in `contracts/schemas`.
2. FormRequest in `interface/http/requests` imports the schema, authorizes, and returns a DTO from `passedValidation`.
3. DTO in `application/dto` is a plain typed payload.
4. Action in `application/actions` executes the use case.
5. Service in `application/services` orchestrates reusable business behavior.
6. Repository in `infrastructure/repositories` owns persistence queries.
7. Model in `domain/models` owns table mapping, casts, relationships, fillable/hidden, soft deletes, observers.
8. Resource in `interface/http/resources` shapes API responses.
9. Controller in `interface/http/controllers` accepts the request and returns Svelar responses/resources.

For page forms, the page action may call the FormRequest/action directly, but it must not become the business layer.

## Validation And Superforms

Native Zod 4 schema (do not pass Zod 3 schemas to the native adapters):

```ts
import { z, rules } from '@beeblock/svelar/validation';

export const createPostSchema = z.object({
  title: rules.required(),
  body: rules.string(10, 5000),
});

export type CreatePostInput = z.output<typeof createPostSchema>;
```

Use `zod4`/`zod4Client` from `sveltekit-superforms/adapters` for this schema; retain `valibot` for Valibot apps. Zod 4 `.default()` supplies output without parsing; use `.prefault()` for validated/transformed input fallbacks. Derive DTOs from the output type because coerced input types may be `unknown`.

Valibot schema:

```ts
import { rules, v } from '@beeblock/svelar/validation/valibot';

export const createPostSchema = v.object({
  title: rules.required(),
  body: rules.string(10, 5000),
});

export type CreatePostInput = v.InferOutput<typeof createPostSchema>;
```

Superforms rules:

- Use the same shared schema as FormRequest.
- Render validation failures inline under every input.
- Use `aria-invalid` for invalid controls.
- Do not show duplicate validation toasts for ordinary field errors.
- Disable controls during pending/delayed submissions.
- Reset create forms after successful create when that is expected UX.
- Return a Svelar resource-like envelope: `{ data, meta }`.
- Include `meta.form` on success, validation failure, and service failure so enhanced forms update immediately.
- Update response/result panels from the action result, not from stale cached load data.

## API Response Shape

Prefer Svelar resources:

```ts
return this.ok(new PostResource(post));
return this.created(new PostResource(post));
return this.forbidden('You do not have permission to move this card.');
```

Use consistent envelopes:

```ts
{
  data: { ... },
  meta: {
    message: 'Saved',
    permissions: { ... },
    form,
  }
}
```

Do not invent unrelated `{ ok, status, payload }` shapes per feature.

## Controllers And Routes

API route files should be thin:

```ts
import { resource } from '@beeblock/svelar/routing';
import { PostController } from '$lib/modules/posts/interface/http/controllers/PostController.js';

const { GET, POST } = resource(PostController);
export { GET, POST };
```

Controllers delegate:

```ts
import { Controller } from '@beeblock/svelar/routing';
import { CreatePostAction } from '$lib/modules/posts/application/actions/CreatePostAction.js';
import { CreatePostRequest } from '$lib/modules/posts/interface/http/requests/CreatePostRequest.js';
import { PostResource } from '$lib/modules/posts/interface/http/resources/PostResource.js';

export class PostController extends Controller {
  async store(event) {
    const request = new CreatePostRequest();
    const dto = await request.validate(event);
    const post = await new CreatePostAction().run(dto);
    return this.created(new PostResource(post));
  }
}
```

## Migrations

Use Svelar schema builder:

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

## Models, Repositories, And ORM

- Models extend `Model`.
- Use `fillable`, `hidden`, casts, relationships, timestamps, soft deletes, observers, and public ID helpers as needed.
- Repositories wrap query use cases and hide query details from services/controllers.
- Prefer `Model.query()` and repository methods over raw connection queries.
- Use `upsert` APIs where available instead of driver-specific SQL.
- Cross-driver behavior matters: SQLite, PostgreSQL, and MySQL are supported out of the box.

### Scope And Cast Contracts

- Register named scopes through `Model.addGlobalScope`; scopes inherit safely and use a synchronous, frozen, condition-only adapter. They cannot execute/raw-rewrite a query. Group application OR predicates inside protected boundaries.
- Scope-aware inserts require explicit equality/IN/null-compatible attributes. Never infer defaults from arbitrary predicates; range/pattern/negative scope inserts fail closed. Authorize `withoutGlobalScope` explicitly; scoped bulk upsert/FROM/union bypasses are rejected.
- Use exact `decimal`/`decimal:<scale>` string casts for monetary decimals instead of Number. Custom `AttributeCast` defines synchronous get/set/optional equals. Mutable JSON/Date edits are tracked against deep originals and persisted change snapshots.
- Keyset iteration respects custom primary keys and OR grouping. Bulk QueryBuilder writes remain eventless; individual Model persistence provides observers/audit/search outbox effects.

### Find-Or-Create Contracts

- Model-aware `firstOrCreate` and `updateOrCreate` return full Model instances, even after `select(...)`. Clone builders to preserve caller filters, connection, tenant scope, and soft-delete scope; do not append lookup criteria to the caller.
- Keep automatic tenant and soft-delete guards outside grouped user predicates, including OR/raw OR. Helpers also group caller predicates before adding search criteria and the row primary key, so OR cannot widen a lookup or single-record update beyond those guards.
- Delegate model writes to the full `Model.create` / `fill` / `save` lifecycle: respect `fillable`, generated IDs, timestamps, JSON casts, observers, audit, and configured Searchable synchronization. An existing `firstOrCreate` match is read-only.
- Seed new records only from the passed search plus create/update attributes, not inferred `where` defaults. Use SQL `IS NULL` for null search attributes and reject undefined search attributes.
- `Model.forTenant(teamId)` and a plain builder's `.forTenant(teamId)` establish real explicit tenant scopes, preserved by clone. They guard reads/writes, auto-assign the selected tenant during helper creation, and guard upsert without ambient context; conflicting tenant values are rejected. Arbitrary `where('team_id', teamId)` is not a creation default. Authorize `withoutTenantScope()` as an administrative bypass; unscoped tenant-model creation still requires an explicit tenant attribute.
- Require matching database unique constraints in migrations. Recover only a recognized unique violation from the INSERT, then re-read the winner using the same visible, filtered, scoped search. In an active PostgreSQL transaction, isolate the INSERT with a savepoint before recovery.
- Propagate unrelated storage and observer errors; do not treat lifecycle failures as duplicate-insert success or retry the whole lifecycle. If a scoped update target is missing, throw before updated/saved post-hooks, including no-dirty updates.
- These helpers are not atomic; concurrent updates to an existing record are last-writer-wins. Use database `upsert` or transaction/locking when atomicity is needed; `upsert` is eventless and does not run the full Model lifecycle.
- Tenant-scoped `upsert` requires the tenant column in `conflictColumns` and a matching composite unique constraint; ambient or explicit `forTenant()` scope assigns tenant values and rejects conflicts. Upsert rejects all row predicates and soft-delete scopes: consciously use `withTrashed().upsert(...)` for table identity, or eventful helpers for scoped row writes. PostgreSQL/SQLite guard target/excluded tenant equality; MySQL guards each assignment against any unique/PK collision. A foreign collision can throw on PostgreSQL/SQLite or no-op on MySQL; metadata is not Model success. Upsert stays eventless: supply IDs/timestamps and authorize the tenant-only `withoutTenantScope()` admin bypass. MySQL's empty-update self-assignment is not `INSERT IGNORE`; unrelated validation/storage errors propagate.
- A raw `QueryBuilder` without a model class is eventless and returns plain rows. Its helpers require stable unique row identity through an `id` column, not a custom model primary key. Both model and raw helpers require a single-table write target and reject joined, grouped/HAVING, CTE, and union queries.

## Auth, Policies, Permissions, And Teams

- Controllers, entities, routes and dashboards require an explicit capability decision. Prefer `--capability=<resource>` with the correct team/platform scope and page path. Use `--public` only as a reviewed functional-RBAC exemption; it does not disable auth, policies, validation or CSRF. `make:model --all` forwards the decision too.
- Use the central literal PermissionManifest and generated access.server resolver. Guard endpoints/page actions before FormRequest parsing; keep model/resource policies afterward. Run `lint:architecture` to catch absent static capabilities and unguarded exports. Read the Permissions & Capabilities guide before implementing a role editor or custom resolver.
- System profiles evolve as defaults - exclusions + inclusions; custom profiles are exact. A full-product tenant role cannot become platform owner. Verify platform identity from current trusted account data, not tenant-editable grants, browser snapshots or captured job flags.
- User-bound API credentials are a ceiling on current user authority, not all of their owner's roles. Pass verified `credentialCapabilities`; service accounts need matching tenant/actor context and cannot grant platform capabilities. Client `permissions/client` snapshots are presentation only.

- Use Svelar auth/session/API-token helpers instead of custom auth code.
- Use FormRequest `authorize` for request-level authorization.
- Use policies for model/resource decisions.
- Use `Permissions`/roles for RBAC.
- Use `Teams` for team-scoped membership, invitations, and resource access.
- Team RBAC uses an explicit immutable `Permissions.forTeam(team.id)` facade after membership authorization. Global `Permissions`/`HasRoles` checks do not inherit team grants. Use `Permissions.global()` for platform gates.
- Register application capabilities in code and sync them in a seeder with `Permissions.syncCapabilities()`; UI-created permission names alone do not create backend gates.
- Unauthorized page actions should surface a toast/alert/modal or inline message where the user can continue, not crash into a generic 500.
- API routes should return 401/403 resource responses, not unhandled exceptions.

## Events, Listeners, Observers, And Cross-Module Reads

Events are for side effects:

```ts
await Event.dispatch(new BoardChanged(boardId));
```

Listeners react:

```ts
export class BroadcastBoardChangedListener {
  async handle(event: BoardChanged) {
    await Broadcast.to(`boards.${event.boardId}`).send('board.changed', { boardId: event.boardId });
  }
}
```

Observers handle model lifecycle work. Register observers and listeners in a provider, usually `EventServiceProvider`.

For request/response reads across modules, do not import another module's model/repository/controller. Use a narrow public application service/query/facade from the owning module and return plain DTO/contract data. Events are not for data queries.

## Queues, Scheduler, Cache

- Use `Queue` and `Job` for background work.
- Use Redis/BullMQ for async production queues where configured.
- Use finite `--once` workers in tests.
- Use `ScheduledTask` and register tasks explicitly.
- Schedules use fixed five-field cron with standard day-of-month/day-of-week OR semantics. Use `.timezone('America/Sao_Paulo')` when host-local time is not intended; handle nullable `TaskInfo.nextRun` instead of fabricating a timestamp.
- Use database-backed scheduler locks for no-overlap tasks.
- Run `npm run dev:worker` and `npm run dev:scheduler` when testing local runtime behavior.
- Expose queue/scheduler status through the Svelar dashboard when relevant.
- Pass the queue name to `JobMonitor.getJob/retryJob/deleteJob` so job IDs cannot resolve in another queue. Runtime metrics can be unknown; do not replace null with a false healthy value.
- Inspect `ScheduleMonitor.runTask()` results: `skipped` means overlap prevented execution and `success: false` means execution failed. An awaited promise alone is not success.
- Use callback-scoped `fakeQueue`, `fakeEvents`, `fakeNotifications`, `fakeHttp`, and `fakeMail` from `@beeblock/svelar/testing`; await all work inside the callback so interception is restored reliably.

## Production Runtime Contracts

- Authenticate before Origin/CSRF. Only verified `authenticatedVia === 'bearer'` credentials can exempt machine requests; a supplied Bearer header cannot bypass browser protections or fall back to a session. Independently signed incoming-webhook paths resolve provider credentials themselves and never borrow a browser identity.
- Single authenticated endpoints use `csrfExcludeExactPaths`/`excludeExactPaths`; never exempt all `/api/internal/`. Prefix exceptions use path-segment boundaries and handlers still verify their own credentials. Review recognized legacy exclusions through `update --migrate-core` instead of assuming a package update overwrites app hooks.
- Use configured `AuthManager` eligibility on password, session, token, refresh, OTP and federation paths. Federation callbacks call `auth.login()` after provider/state proof and secure account linking; never write `auth_user_id` directly. Add migrations before enabling new account-status columns in existing apps. Auth APIs already audit attempts: do not emit duplicate template events or record passwords/tokens.
- Use the configured model primary key and `auth.id()` for identity, not a caller's shadow `user.id`. Match actual foreign-key types through app migrations. Preserve server-validated return paths across login/register/recovery/OTP links; never redirect from unvalidated client input.
- Unknown controller failures delegate to the current request's configured global ErrorHandler. Allow `Response | Promise<Response>` and return or await `super.handleError(error, event)`; preserve native HTTP errors/redirects and do not dump secrets or bypass incident reporting.
- Bind public branding through `auth.presentation()`, never expose server auth configuration. Render only real available configured provider buttons; branding slots do not install OAuth/OIDC/SAML adapters. New-app auth uses the generated shared AuthFrame.

- For named/multi-process queue operations, use `Queue.adapter(queue, connection)` or `JobMonitor.adapter`, including source (`live`/`dead-letter`) on references. Use public indexed filters, batch retry/cleanup, durable replay and timelines; never import BullMQ internals in app code. Redact adapter payload/error/context before browser output. Unknown/foreign worker telemetry is null/incomplete, not healthy zero.
- Define worker profiles explicitly and run `queue:work --profile=...`; a daemon holds one worker and drains on signals. Finite workers are intentional tests, not daemon loops. Register jobs/definitions in the common bootstrap.
- Use persistent scheduler runtime and `ScheduleMonitor.requestRun()` for operator run-now. A queued request is not a completed task. Scope tenant schedulers immutably, configure timezone/missed-run bounds, and wait for active tasks before releasing their locks.
- Use Cache atomic counters/CAS/owner locks/reservations for coordination and `Http.budget` for distributed credential/account quotas. Null coordination fails closed; memory is process-local. Trust only the configured proxy chain, not the leftmost forwarded header.
- Register durable WebhookInbox sources with exact raw-byte provider verification and trusted account mapping. New apps sweep pending receipts; existing apps must add the sweep. Handlers are at-least-once and require domain idempotency. Do not use the generic body-HMAC adapter as a Stripe timestamp verifier. Protect replay/ignore/raw inspections; never acknowledge before durable capture.
- Use `BackgroundOperation` for persisted progress/result/cancellation and safe local resource links. Register handlers/sweep across processes, enforce tenant+actor ownership and private channel auth. Cancellation is cooperative; queue/realtime are wake-up signals, not the only copy of state.
- Session renewal comes from real navigation/mutations or trusted server `markActivity`, not client polling headers. Use configured idle/absolute/remember limits and the protected status/renew controller; multitab messages invalidate state only. Shared schemas/Superforms still validate login fields.
- Use callback-scoped `fakeClock` only in a sequential Vitest test with its public testContext; await ticks and restore real timers. Use explicit `runWithContext`/`withTenant`/`withActor` and real `withWebhookInbox` harnesses. Native DB resets require an isolated test database and explicit destructive acknowledgement.

## Shared Logs And Durable Search

- Configure the database log viewer in the common app bootstrap so web, workers and scheduler see the same entries. Run its migration; never create its table at runtime. Memory viewing is explicitly process-local.
- Await all LogViewer reads/writes. Use `await LogViewer.page({ cursor, limit, tenantId, correlationId })` and its `{ data, meta }` envelope, not a process-local buffer or client-side filtering as authorization. Schedule `LogViewer.prune()` for retention.
- Database log tails follow persisted entries from all processes; close subscriptions on disconnect, use entry-ID cursors/Last-Event-ID, and report failures through a different sink. Never log unknown free-form secrets.
- Search defaults to a durable outbox on the model database. Keep Model writes and indexing intent in one transaction; signal registered queue jobs only after the outer commit. Register `SearchOutboxSweep` in existing apps so failed dispatches/retries are recovered.
- Meilisearch outages must not make a committed database write look failed. Outbox persistence failure must roll back the write. Inspect `Search.outbox().stats()`, dead-letter/replay and retention instead of swallowing lost synchronization.
- Inline search delivery is explicit `syncDriver: 'inline'`; use it only when its immediate error/latency semantics are required. Indexing must honor hidden fields or an explicit safe `toSearchableObject()`.
- Reindex with keyset `chunkById`, not OFFSET or loading all records. Query-builder bulk writes remain eventless; use individual Model writes for observers/audit/outbox effects.
- `Connection.afterCommit` captures application context and discards callbacks on rollback. `AfterCommitError.committed === true` means the original write must not be blindly repeated. Await database work; detached work cannot reuse an ended transaction.

## Storage, Uploads, PDF, Mail, Search

- Use `Storage` and `Uploads`; do not expose internal Docker URLs such as `http://rustfs:9000/...` to browser users.
- Use RustFS for local S3-compatible storage. Do not add MinIO.
- Browser-facing downloads/previews should go through authorized app routes or temporary public URLs.
- PDFKit is the local default; Gotenberg tests must set `PDF_DRIVER=gotenberg`.
- Gotenberg webhook workflows should show visible queued/ready state in the UI and notify users when ready.
- Mail drivers include SMTP, Postmark, Resend, Mailtrap, log, and null.
- Use `Search`/`Searchable` for Meilisearch indexing and fallback search.

## Broadcasting And Realtime

- SSE and Soketi/Pusher are separate paths; test both when claiming realtime coverage.
- Soketi health pings are not enough. Prove visible cross-browser updates.
- Use channel authorization for private/presence channels.
- Browser mutations that should update other users must broadcast an event after the successful action/service commit.

## Docker And Production

- Generated Docker should use adapter-node.
- Keep separate `app`, `worker`, and `scheduler` services.
- Keep optional runtime adapters externalized when needed: `bcrypt`, `argon2`, `bullmq`, `ioredis`, `meilisearch`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.
- For PostgreSQL production checks, use PgBouncer with prepared statements disabled and `pg_stat_statements` enabled.
- Generated local service ports should be non-default/randomizable because other local projects may already use common ports.

## Imports

Use `@beeblock/svelar/<module>` subpaths:

```ts
import { Model, SoftDeletes } from '@beeblock/svelar/orm';
import { Migration } from '@beeblock/svelar/database';
import { Controller, Resource, FormRequest } from '@beeblock/svelar/routing';
import { z } from '@beeblock/svelar/validation';
import { rules as valibotRules, v } from '@beeblock/svelar/validation/valibot';
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

Use `$lib` aliases for app/module imports:

```ts
import { BoardService } from '$lib/modules/boards/application/services/BoardService.js';
import { Board } from '$lib/modules/boards/domain/models/Board.js';
import { EventServiceProvider } from '$lib/shared/providers/EventServiceProvider.js';
```

## Dogfood App Standard

A dogfood app must expose user workflows that prove Svelar features, not only service health pings.

- Start with Svelar CLI scaffolding.
- Keep a step-by-step timeline in the app docs for material work and verification.
- Use the feature being tested in a visible workflow.
- Upload tests should show browser-safe previews/downloads.
- Soketi tests should update a second browser without refresh.
- Gotenberg webhook tests should update a queue/listing screen.
- Test with real Docker services where possible: Postgres/PgBouncer, Redis/BullMQ/cache, RustFS, Gotenberg, Meilisearch, Soketi, and mail provider adapters.
- Validate browser UX: loading states, empty states, inline validation errors without duplicate toasts, toast/alert feedback, realtime updates, and no stale form state.

## Verification

Generated apps keep ambient `App.Locals` types in `src/svelar.d.ts`. Do not name this file `src/app.d.ts`: the `src/app.ts` bootstrap shadows that declaration during TypeScript glob discovery. Preserve nullable anonymous users and narrow authentication before accessing their IDs.

Run `npm run smoke:cli` for installed CLI execution and artifact type checks in DDD/flat apps with Zod/Valibot, and `npm run smoke:upgrade` for an exact published baseline. Help screens, source-only tests and a green build alone do not prove these contracts. Review `svelar update --dry-run` first; do not force-overwrite app-owned source or migrations. Native Zod 4 adapter migration is explicitly opt-in, uses exact-original backups, and still requires semantic schema review.

For recognized 0.7.9 scaffolds, separately review `update --migrate-core --dry-run` before approving `--force`. This edits narrowly recognized AST tokens with exact-original `.core.bak` backups; customized patterns can require manual review. It is not a blanket template refresh or a compatibility guarantee. Test login, authorization, operator failure outcomes and the production adapter-node build after migration.

Test both `/admin` and `/admin/dashboard` at desktop/mobile widths. Verify label associations, inline errors without duplicate toasts, document width and keyboard access to bounded table scroll regions. Browser test startup failures must unwind cleanup, not call `process.exit()` before their owning `finally` block.

Before release-impacting work, prefer:

```bash
npm run build
npm test
npm run release:dry-run
npm run certify
```

For generated app or dogfood verification, create sibling apps under `/Users/rzeradev/projects/beeblock/svelar-testing-area/`, use non-default service ports, and test browser-visible behavior with Postgres/PgBouncer, Redis/BullMQ/cache, RustFS, Gotenberg, Meilisearch, auth/session/API tokens, policies/permissions, teams, webhooks, uploads, PDF, SSE, Soketi/Pusher realtime, logs, audit, exception handling, scheduler, CLI commands, and tinker.

## Isolated Acceptance Tests

- Async factories may await real password hashes in `definition()`. Use `makeAsync`/`makeManyAsync` for non-persisted async definitions; synchronous `make` methods reject them. Never store fake hashes or import production app bootstrap into reset-based tests.
- Use `withQueueRecovery` with a public shared adapter and caller-owned start/stop/kill fixtures. Await all operations, honor abort signals/deadlines, and clean only owned processes/services. Fake adapters do not prove native Redis/BullMQ recovery.
- Dashboard queue topology, retained diagnostics, scheduler pages and dependency probes have explicit coverage/truncation/unknown state. Copy cache driver inventory from the actual configuration object. Empty/null reads and subscription readiness are not distributed health or proof of visible realtime delivery.
