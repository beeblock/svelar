# Isolated Testing

Read [testing](../../../../docs/34-testing.md) and contributor [release certification](../../../../docs/47-release-certification.md). Outside this repo, use https://svelar.dev/docs/testing and https://svelar.dev/docs/release-certification.

## CLI And Write Flows

Generate tests/factories with make:test and make:factory. Test the real route/controller -> shared schema/FormRequest -> DTO -> action/service -> repository/model -> resource flow. Include unauthorized identities, foreign tenants, invalid input, CSRF and failure feedback.

New apps include actual shared-schema, hashed-factory and isolated database authentication regressions, plus desktop/mobile Playwright cases. They are examples, not proof that an application's custom business workflows are covered.

## Database Safety

useSvelarTest supports an explicit database configuration and migrations path. Always provision a disposable database. PostgreSQL/MySQL resets require allowDestructiveDatabase: true; refreshDatabase destroys tables and must never target production/shared development data. Give parallel processes separate databases. Do not import src/app.ts into tests which reset connections; common production bootstrap owns its real resources.

## Factories

Factory.definition may return attributes or a Promise. Hash.make produces real test-only password hashes in the configured password column. Capture this.sequence once per definition so name/email share an identity. create/createMany await definitions before persistence; makeAsync/makeManyAsync await without saving. Synchronous make/makeMany reject async definitions. The default User has password, not a fake password_hash: 'hashed'.

## Fakes And Context

Use callback-scoped fakeQueue, fakeEvents, fakeNotifications, fakeHttp, fakeMail and fakeClock. Await work inside the scope so it is restored reliably; unmatched HTTP calls must not silently reach the network. runWithContext, withTenant and withActor make tenant/actor expectations explicit. fakeClock needs the supported Vitest adapter and must not overwrite unrelated timer mocks.

actingAs and createRequestEvent set up a test event, not verified authentication middleware. Exercise real signed sessions/Bearer verification when claiming credential, origin or CSRF coverage.

## Native Recovery

withWebhookInbox exercises acceptance/dispatch ownership. withQueueRecovery uses a public shared queue adapter and caller-owned start/stop/kill callbacks, AbortSignal deadlines and bounded waits. It never creates tables, resets runtime configuration or kills foreign workers. Redis replacement workers own native stalled recovery; SQL completed jobs may disappear, so waitForMissing is valid while an invented completed snapshot is not.

A fake adapter is not evidence of BullMQ recovery. A health ping is not proof of Soketi/SSE browser updates. Use separate processes/browsers and preserve evidence of actual recovery, failure, cancellation and cleanup.

## Release Evidence

Run the immutable packed artifact through new apps and historical upgrades in DDD/flat and Zod/Valibot, all CLI commands, native services and production browser scenarios. Keep a test timeline under the sibling testing area. Explicitly account for gated native tests; a source suite with skips or a green build alone is not complete installed-app certification. Owned browser accounts require isolated-app acknowledgement and fixture credentials, never a shared administrator login.
