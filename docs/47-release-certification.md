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
- Redis cache, Redis session, and BullMQ queue smoke checks with Docker-managed random ports
- PDFKit, queued PDF job, and Gotenberg smoke checks with Docker-managed random ports
- Meilisearch indexing and search smoke checks with Docker-managed random ports
- S3-compatible storage smoke checks with Docker-managed random ports
- PostgreSQL through PgBouncer plus `pg_stat_statements` smoke checks with Docker-managed random ports
- generated DDD app certification tests, including local provider mocks for Postmark, Resend, and Mailtrap mail transports
- SQLite, PostgreSQL, and MySQL smoke checks with Docker-managed random ports
- production `adapter-node` browser smoke across the database matrix

Generated DDD smoke apps receive an injected `tests/feature/svelar-certification.test.ts` file. It validates the intended Svelar flow:

```text
route -> controller -> DTO/schema -> action -> service -> repository -> model -> resource
```

The injected test also covers complex ORM queries, soft deletes, UUID v7/ULID primary keys, secondary public UUID/ULID keys, UUID v7/ULID validation rules, event listeners, full model observer create/update/delete lifecycles, `EventServiceProvider` observer/listener wiring, sync and async queue jobs, global and named middleware, route-level rate limiting, session primitives, password reset/email verification/OTP recovery tokens, API key Bearer authentication fallback, Teams roles/members/invitations, SSE public/private/presence broadcasting, Postmark/Resend/Mailtrap mail transport payloads and auth headers, notification email/database/custom channel delivery, file logging, `LogViewer` query/stats/tailing, exception handling payloads/reporting/middleware recovery, PDFKit generation, and queued PDF jobs against the configured database driver. When `REDIS_URL` is present, it also certifies Redis cache operations, Redis-backed sessions, and a real BullMQ worker. When `GOTENBERG_URL` is present, it certifies Gotenberg HTML, Markdown, merge, office conversion, and screenshot paths. When `MEILISEARCH_HOST` is present, it certifies Meilisearch health, `Searchable` auto-sync on create/update/delete, `Search.withoutSyncing()`, manual indexing, index settings, search filters, and index stats. When `S3_CERTIFICATION` is present, it certifies S3-compatible storage, bucket creation, object operations, listings, and temporary URLs. When `PGBOUNCER_CERTIFICATION` is present, it certifies PostgreSQL through PgBouncer and verifies `pg_stat_statements` captures app queries.

Because generated certification tests refresh and mutate the database, the smoke runner refreshes migrations and runs seeders again immediately before browser smoke. Browser assertions therefore exercise a real production `adapter-node` server against a known seeded app state instead of leftover test data. The browser smoke opens real `EventSource` subscriptions for SSE public, private, and presence channels and broadcasts through the generated internal HTTP bridge.

## Pending External-Service Phases

All currently planned Svelar core external-service phases are wired into the certification suite. Provider mail tests use local HTTP mocks so the release gate can verify payload shape, headers, error handling, and generated app wiring without sending real email.
