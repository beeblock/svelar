# Feature Guide Map

Use the local guides below for the actual public API and generated examples. Outside this repo, the matching pages live under https://svelar.dev/docs. Verify current package exports/types when an API is uncertain; never invent singular facades or copy historical automatic-table bootstrap.

| Feature | Current guide | Essential boundary |
|---|---|---|
| Architecture, modules, contracts | [Architecture](../../../../docs/20-architecture.md) | Layered modules; narrow service/query contracts for reads, events for side effects |
| ORM, casts, traits, relationships, scopes | [Models/ORM](../../../../docs/03-models-orm.md) | Repository queries; tenant/global guards; explicit eventless bulk writes |
| Migrations, indexes, SQLite/PostgreSQL/MySQL | [Database](../../../../docs/02-database.md) | Focused migrations, no runtime DDL; native driver proof |
| Controller, DTO, FormRequest, Resource | [HTTP flow](../../../../docs/04-controllers-routing.md), [Validation](../../../../docs/05-validation-dtos.md) | CLI-first write architecture and shared frontend schema |
| Actions, services, repositories | [Application flow](../../../../docs/08-services-actions-repositories.md) | Orchestration vs domain/query ownership |
| Auth, JWT, refresh, OTP, policies | [Auth](../../../../docs/06-authentication.md) | Per-request AuthManager, eligibility and configured model identity |
| Middleware, proxy trust, rate limits | [Middleware](../../../../docs/07-middleware.md) | Verified credentials; atomic distributed quotas; no forged-header bypass |
| Permissions, teams, profiles | [Permissions](../../../../docs/49-permissions.md), [Additional features](../../../../docs/12-additional-features.md) | Literal manifests, explicit scope, membership and credential ceilings |
| Queue, BullMQ, jobs, recovery, DLQ | [Queue](../../../../docs/11-queue-jobs.md) | Registered jobs, daemon profiles, public named adapters, incomplete telemetry remains unknown |
| Scheduler and persistent controls | [Scheduler](../../../../docs/10-scheduler.md) | Renewable leases, timezones/catch-up, queued requestRun; HTTP does not run tasks |
| Events, listeners, observers, providers | [Events](../../../../docs/23-events.md) | Explicit provider registration; events are not data queries |
| Cache, notifications, audit, API keys | [Additional features](../../../../docs/12-additional-features.md) | Public facades, configured drivers, real cross-process semantics and safe metadata |
| HTTP clients, distributed budgets | [HTTP](../../../../docs/14-http.md) | Same-origin CSRF, resource envelopes and account/provider budgets |
| Sessions and expiry UX | [Sessions](../../../../docs/22-sessions.md) | Idle/absolute/remember policy; real activity, protected renewals and multitab invalidation |
| Mail, templates and providers | [Mail](../../../../docs/24-mail.md), [Additional features](../../../../docs/12-additional-features.md) | Configured Mailer/templates and notifications; no one-off delivery clients |
| Uploads and RustFS/S3 storage | [Storage](../../../../docs/26-storage.md), [Additional features](../../../../docs/12-additional-features.md) | Configured public URLs/disks, authorization, preview and safe object access |
| PDF/Gotenberg/webhooks | [PDF](../../../../docs/27-pdf.md) | Real gotenberg driver proof, durable readiness/results, provider-signed callback acceptance |
| Excel and streaming | [Excel](../../../../docs/28-excel.md) | ExcelJS, bounded imports/exports and failure validation |
| Meilisearch and durable outbox | [Search](../../../../docs/31-search.md) | After-commit delivery, outage recovery, bounded keyset reindex and current SDK |
| SSE/Soketi/Pusher, private/presence channels | [Broadcasting](../../../../docs/25-broadcasting.md) | Broadcast.to(...).send or event(...).on(...).send, channel authorization, visible cross-browser proof |
| Background operations and inbox | [Additional features](../../../../docs/12-additional-features.md) | Durable state, tenant/actor ownership, idempotent handlers and scheduler sweeps |
| Shared logs and incidents | [Errors](../../../../docs/19-error-handling.md), [Additional features](../../../../docs/12-additional-features.md) | Redaction, persistent viewers, request-scoped global handler and safe incident IDs |
| UI, forms, operational patterns | [UI](../../../../docs/13-ui-components.md), [Forms](../../../../docs/16-forms.md) | Svelte 5/shadcn, Superforms, loading/inline feedback and stable layouts |
| Translation and dates | [i18n](../../../../docs/15-i18n.md), [Dates](../../../../docs/18-dates.md) | Shared messages and configured date helpers instead of hand-written formatting |
| Flags and runtime config | [Flags](../../../../docs/21-feature-flags.md), [Getting started](../../../../docs/00-getting-started.md) | Environment/config controls, no scattered secret/ID/provider literals |
| Testing and fakes | [Testing](../../../../docs/34-testing.md) | Isolated migrations, real hashes, scoped fakes, explicit native recovery evidence |
| Docker, worker/scheduler, readiness, rollback | [Deployment](../../../../docs/29-deployment.md) | Separate runtimes, non-default local service ports, graceful drain and promotion |
| Plugin conventions | [Plugins](../../../../docs/09-plugins.md) | Dedicated server plugin entry, public exports, Model/Controller/FormRequest/Resource conventions |
| Stripe, OAuth, DataTable | [Stripe](../../../../docs/32-stripe.md), [Social auth](../../../../docs/36-social-auth.md), [Datatable](../../../../docs/33-datatable.md) | Explicit capability guards, verified provider signatures and host-owned scopes |
| Other plugin drafts | Guides 35-45 | Verify the actual package, migrations, peers and guarded public API; local drafts are not published guarantees |
| Security and release acceptance | [Security](../../../../docs/30-security.md), [Certification](../../../../docs/47-release-certification.md) | Audits plus immutable installed-app, upgrade, CLI, native and browser gates |

## Runtime Rules

No facade creates tables automatically. Core/plugin initial data comes from migrations/seeders. Use real configured SDK versions and optional peer exports. A queue/SSE signal never replaces durable state. An unknown dependency observation is not a healthy zero. Use factories/test setup for acceptance data and preserve owned-resource cleanup/evidence.
