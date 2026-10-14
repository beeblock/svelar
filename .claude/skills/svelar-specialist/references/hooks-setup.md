# App Bootstrap And Hooks

Read the current [installation](../../../../docs/01-installation.md), [deployment](../../../../docs/29-deployment.md), [authentication](../../../../docs/06-authentication.md) and [broadcasting](../../../../docs/25-broadcasting.md) guides before changing bootstrap. Outside this repo, use https://svelar.dev/docs/installation and the corresponding guide URLs. Inspect the app's generated src/app.ts, hooks.server.ts and validation manifest first.

## Bootstrap Contract

- Use the installed Svelar CLI to create apps/artifacts. Preserve app-owned configuration on upgrade; review update --dry-run and explicit migration modes.
- Connection.configure receives a named connections registry, not db.configure({ client }). PostgreSQL/PgBouncer transaction pooling requires prepare: false.
- Construct AuthManager with the application's User model and configured secrets. Auth.configure, singular ApiKey/Webhook/Team/Upload/EmailTemplate facades and fallback dev-secret examples are not current APIs.
- Current facades include ApiKeys, Webhooks, WebhookInbox, Teams, Uploads, EmailTemplates, Queue, Cache, Audit, Log, Search, PDF and Broadcast. Register jobs, listeners, observers, scheduler tasks and durable inbox/search/operation sweeps in common web/worker/scheduler bootstrap.
- Configuration never creates tables. Publish focused core/plugin migrations and run migrate. Reference/default records belong in seeders.
- Queue.configure uses default plus named connections; register the actual Job classes before workers consume them. Shared operational monitoring uses named public adapters, never process-local guesses.
- Store real APP_KEY/internal/provider secrets in environment/config. Validate required secrets; never introduce development fallback credentials into production paths.

## Hooks Contract

Use createSvelarApp and the configured auth/session store. Authenticate before origin/CSRF verification. A supplied Bearer header is not a bypass: only authenticatedVia === 'bearer' after verification authorizes the machine exemption, and invalid Bearer credentials never fall back to a cookie session.

The only default exceptions are narrowly scoped independently authenticated incoming-webhook/internal bridge routes. Do not exempt all /api/internal or /api/webhooks paths. Signed provider handlers verify exact raw bytes and map a trusted account before durable acceptance; internal broadcasts use the configured server secret.

Configure idle/absolute/remember session lifetimes, warning thresholds, trusted proxies and real request activity. Status polling does not renew sessions. Global ErrorHandler configuration is also used by controllers and must await reporters/renderers without exposing raw exceptions.

## Health And Shutdown

Use DeploymentRuntime readiness/traffic/drain hooks and the generated worker/scheduler runtime scripts. Database/cache/queue probes must reflect actual configured sources. Null or memory state is not distributed health; SSE ready alone does not prove cross-browser delivery. Drain HTTP and active workers before closing database/Redis resources. Use the generated Docker/Caddy promotion/rollback workflow instead of compose down/up.

Inspect existing `sveltekit:shutdown` cleanup before adding listeners. After HTTP drain, await scheduler/Queue/Broadcast shutdown, public `Cache.close()` from `@beeblock/svelar/cache`, then database shutdown; attempt later cleanup even after an earlier failure. Never replace resource teardown with `Cache.flush()` or forced exit, and leave borrowed clients to their owner. See [Closing cache resources](../../../../docs/12-additional-features.md#closing-cache-resources) for initialized-store ownership and close semantics. A logging-only active-handle diagnosis is not a pristine installed-deployment PASS.
