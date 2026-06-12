---
name: svelar-specialist
description: Use when working on Svelar core or Svelar apps, including scaffolding, routes, controllers, FormRequests, DTOs, schemas, ORM, migrations, repositories, services, actions, resources, auth, policies, permissions, teams, queues, cache, scheduler, events, listeners, observers, mail, notifications, storage/uploads, PDF, search, SSE/Soketi broadcasting, webhooks, audit/logging, Docker, browser testing, production certification, docs sync, plugins, or any @beeblock/svelar import.
---

# Svelar Specialist

Svelar is a Laravel-inspired TypeScript framework on SvelteKit 2. Treat the docs as the product contract, but verify implementation, generated templates, tests, and runtime behavior before assuming a feature is production-ready.

## Non-Negotiable Rules

- Use Svelar CLI generators before hand-writing artifacts whenever a generator exists.
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

## CLI-First Workflow

For a full Laravel-style resource, start here:

```bash
npx svelar make:entity Invoice --module=billing --fields "title:string,total:number,status:enum(draft,paid)" --crud
```

Use focused generators for individual artifacts:

```bash
npx svelar make:model Invoice --module=billing
npx svelar make:migration create_invoices_table
npx svelar make:schema invoice --module=billing
npx svelar make:request CreateInvoiceRequest --module=billing
npx svelar make:action CreateInvoiceAction --module=billing
npx svelar make:service InvoiceService --module=billing
npx svelar make:repository InvoiceRepository --module=billing
npx svelar make:controller InvoiceController --module=billing
npx svelar make:resource InvoiceResource --module=billing
npx svelar make:event InvoicePaid --module=billing
npx svelar make:listener SendInvoiceReceipt --module=billing
npx svelar make:observer InvoiceObserver --module=billing
npx svelar make:job SyncInvoiceJob
npx svelar make:task PruneOldInvoices
npx svelar make:command ReconcileInvoices
npx svelar make:channel TeamChannel
npx svelar make:broadcasting
npx svelar make:dashboard
npx svelar make:docker
npx svelar make:test InvoiceService --type=unit
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

Zod schema:

```ts
import { z, rules } from '@beeblock/svelar/validation';

export const createPostSchema = z.object({
  title: rules.required(),
  body: rules.string(10, 5000),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
```

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

## Auth, Policies, Permissions, And Teams

- Use Svelar auth/session/API-token helpers instead of custom auth code.
- Use FormRequest `authorize` for request-level authorization.
- Use policies for model/resource decisions.
- Use `Permissions`/roles for RBAC.
- Use `Teams` for team-scoped membership, invitations, and resource access.
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
    await Broadcast.channel(`boards.${event.boardId}`).event('board.changed', event);
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
- Use database-backed scheduler locks for no-overlap tasks.
- Run `npm run dev:worker` and `npm run dev:scheduler` when testing local runtime behavior.
- Expose queue/scheduler status through the Svelar dashboard when relevant.

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

Before release-impacting work, prefer:

```bash
npm run build
npm test
npm run release:dry-run
npm run certify
```

For generated app or dogfood verification, create sibling apps under `/Users/rzeradev/projects/beeblock/svelar-testing-area/`, use non-default service ports, and test browser-visible behavior with Postgres/PgBouncer, Redis/BullMQ/cache, RustFS, Gotenberg, Meilisearch, auth/session/API tokens, policies/permissions, teams, webhooks, uploads, PDF, SSE, Soketi/Pusher realtime, logs, audit, exception handling, scheduler, CLI commands, and tinker.
