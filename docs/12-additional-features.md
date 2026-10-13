# Additional Features

Quick reference for Svelar's supporting modules. Each section covers configuration and common usage patterns.

For in-depth guides, see the dedicated pages: [Sessions](./22-sessions.md), [Events](./23-events.md), [Mail](./24-mail.md), [Broadcasting](./25-broadcasting.md), [Storage](./26-storage.md), [PDF](./27-pdf.md), [Excel](./28-excel.md), [Feature Flags](./21-feature-flags.md).

## Hashing

Securely hash passwords and other sensitive data.

### Configuration

```typescript
import { Hash } from '@beeblock/svelar/hashing';

Hash.configure({
  driver: 'scrypt',  // 'bcrypt', 'argon2'
});
```

### Hashing Passwords

```typescript
import { Hash } from '@beeblock/svelar/hashing';

// Hash password
const hashedPassword = await Hash.make('user-password');

// Verify password
const isValid = await Hash.verify('user-password', hashedPassword);

if (isValid) {
  console.log('Password correct');
} else {
  console.log('Password incorrect');
}
```

### Drivers

- **scrypt** (default) - Zero dependencies, fast, secure
- **bcrypt** - Battle-tested, slower
- **argon2** - Modern, memory-hard

## Caching

Cache frequently accessed data to improve performance.

### Configuration

```typescript
import { Cache } from '@beeblock/svelar/cache';

Cache.configure({
  default: 'memory',
  stores: {
    memory: {
      driver: 'memory',
      ttl: 3600,
    },
    file: {
      driver: 'file',
      path: './storage/cache',
      ttl: 3600,
    },
    redis: {
      driver: 'redis',
      host: 'localhost',
      port: 6379,
      password: process.env.REDIS_PASSWORD,
      db: 0,
      prefix: 'svelar_cache:',
      connectTimeoutMs: 2000,
      commandTimeoutMs: 2000,
      ttl: 3600,
    },
  },
});
```

The store-level `ttl` is the default TTL in seconds. It applies to `Cache.put()` and direct store calls such as `Cache.store('redis').put()` unless you pass a TTL for that call.

Framework-owned Redis clients connect lazily, share pending startup, and wait for Redis readiness before issuing cache commands. `connectTimeoutMs` and `commandTimeoutMs` default to 2000 and accept integer milliseconds from 1 to 30000. The command deadline applies to each Redis command, not an entire multi-command operation such as `flush()`. Generated app bootstrap reads these settings from `cache.stores.redis.connectTimeoutMs` and `cache.stores.redis.commandTimeoutMs`.

Connection/command failures reject (including `get()`), discard the owned connection and allow a later call to reconnect; they are not cache misses or a memory fallback. Commands are not automatically replayed. A timed-out write may already have reached Redis, so do not blindly retry increments or capacity reservations. Passing `client` borrows a caller-owned Redis client: Svelar does not connect/disconnect it, change its options/listeners or apply these deadlines; its owner must manage bounds and cleanup.

File cache treats missing, expired, and corrupted entries as cache misses and removes corrupted/expired files. Filesystem errors that are not normal cache misses are not swallowed.

### Using Cache

```typescript
import { Cache } from '@beeblock/svelar/cache';

// Set cache
await Cache.put('user:1:posts', posts, 3600);  // 1 hour

// Get cache
const cachedPosts = await Cache.get('user:1:posts');

// Get or set
const posts = await Cache.remember('user:1:posts', 3600, async () => {
  return await Post.where('user_id', 1).get();
});

// Delete cache
await Cache.forget('user:1:posts');

// Clear all cache
await Cache.flush();

// Check existence
const exists = await Cache.has('user:1:posts');
```

### Atomic Coordination

Use atomic cache operations for distributed limits and work coordination; never implement a limiter with get/calculate/put:

```typescript
const store = Cache.store('redis');
await store.incrementWithTtl(counterKey, 60);
const changed = await store.compareAndSet(stateKey, expectedState, nextState, 60);
const owner = crypto.randomUUID();
if (await store.acquireLock(lockKey, owner, 30)) {
  try { await executeBoundedWork(); }
  finally { await store.releaseLock(lockKey, owner); }
}
const claim = await store.reserveCapacity(quotaKey, 100, 60, 1);
const batch = await store.reserveCapacityMany([
  { key: credentialQuotaKey, capacity: 100, ttl: 60 },
  { key: accountQuotaKey, capacity: 1000, ttl: 60 },
]);
```

CAS compares canonical JSON values; expected `undefined` means the key must be absent. Omitting its TTL preserves the current expiry. Atomic TTLs are positive, from 0.001 seconds to one year. Lock owners must be fresh unpredictable tokens for each lease: a stale owner cannot release another owner's lock. Locks expire; this API does not renew them automatically.

Capacity reservation is all-or-none (up to 16 distinct keys). Failed reservations do not consume any quota. The first successful claim establishes the window; later claims keep its TTL. Redis uses server time for expiry metadata. Redis Cluster batch keys must share a hash slot. Keep application/server clocks synchronized when interpreting expiry timestamps.

Memory coordination is process-local. File coordination uses proper-lockfile serialization and a recovery journal across processes; storage failures can conservatively consume capacity but cannot expose a partially committed batch. Null stores reject atomic coordination with `CacheAtomicUnavailableError` rather than silently allowing protected work. Configure Redis for horizontally scaled applications. This lock/reservation API is infrastructure, not authorization.

## Logging

Log messages for debugging and monitoring.

### Configuration

```typescript
import { Log } from '@beeblock/svelar/logging';

Log.configure({
  default: 'stack',
  channels: {
    console: {
      driver: 'console',
      level: 'debug',
    },
    file: {
      driver: 'file',
      path: './storage/logs/app.log',
      level: 'info',
    },
  },
});
```

### Using Logs

```typescript
import { Log } from '@beeblock/svelar/logging';

// Log levels
await Log.debug('Debug message');
await Log.info('Information message');
await Log.warn('Warning message');
await Log.error('Error message');

// With context
await Log.info('User registered', { user_id: 1, email: 'john@example.com' });

// Multiple channels
await Log.channel('file').info('Logged to file only');
await Log.channel('console').warn('Logged to console only');
```

Log writes return promises. Await file and stack channels when you need to guarantee persistence or surface write failures. Missing channels, unknown drivers, and file write errors throw instead of falling back to console.

### Correlation Context And Redaction

`createSvelarApp()` wraps each request with async-local logging context. Logs written during the request automatically include `requestId` and `correlationId`; authenticated requests also add `userId`/`actorId` when auth middleware resolves a user. Jobs, listeners, and custom integrations can use the same mechanism:

```typescript
await Log.withContext({ tenantId: team.id, jobId: job.id }, async () => {
  await Log.info('Sync started', { integration: 'stripe' });
});
```

`Log.configure()` accepts process-wide `context` and extra `redactKeys`. Sensitive fields such as passwords, tokens, secrets, authorization headers, cookies, signatures, and API keys are redacted recursively before entries reach channels or `LogViewer`.

```typescript
Log.configure({
  default: 'file',
  context: { integration: 'billing' },
  redactKeys: ['tenantSecret'],
  channels: {
    file: { driver: 'file', path: 'storage/logs/app.log', format: 'json' },
  },
});
```

### Shared Persistent Log Viewer

New apps configure the database viewer in `src/app.ts`, so web, workers and scheduler use the same `svelar_logs` table. Run the generated migration before starting these processes; the logger never creates tables at runtime. The memory driver remains an explicitly process-local option for tests or ephemeral development.

```typescript
import { Log, LogViewer } from '@beeblock/svelar/logging';

Log.configure({
  default: 'console',
  channels: { console: { driver: 'console', format: 'json' } },
  viewer: { driver: 'database', retentionSeconds: 30 * 86400, tailIntervalMs: 1000 },
});
await Log.info('Import completed', { tenantId: team.id, correlationId: 'import-17' });
const first = await LogViewer.page({ tenantId: team.id, limit: 25 });
const next = first.meta.nextCursor === null ? null
  : await LogViewer.page({ tenantId: team.id, limit: 25, cursor: first.meta.nextCursor });
const stats = await LogViewer.getStats();
await LogViewer.prune(); // Schedule retention through a normal scheduled task.
```

All viewer reads/writes (`query`, `page`, `getStats`, `getRecentErrors`, `addEntry`, `clear`, `prune`) are asynchronous for both drivers. Await them, including in existing apps when upgrading. `page` returns `{ data, meta }` with stable entry-ID cursors; stats are aggregated in the database rather than loading every log. Search, channel, minimum severity, tenant and correlation filters are supported. The configured viewer and output channel must both succeed for an awaited log write to complete.

`LogViewer.tail(callback, { cursor })` follows durable entries across processes using bounded database polling; the callback receives redacted entries and the returned function closes the subscription. Omitting the cursor tails only new entries. Retention defines the available replay window. The dashboard exposes the tail as authorized SSE, including entry IDs and `Last-Event-ID` resume, heartbeat, slow-client bounds and periodic reauthorization. Configure `onTailError` to report connectivity failures through a different sink, avoiding recursive logging.

Secrets are redacted at ingestion, including direct viewer writes, before storage or tailing. Free-form logging still must not contain secrets that cannot be recognized by key or known credential syntax. A tenant filter is a query filter, not authorization; scope it on the server after checking the caller's permissions.

## Notifications

Send notifications via email, database, and custom channels.

### Configuration

```typescript
import { Notifier } from '@beeblock/svelar/notifications';

Notifier.configure({
  channels: {
    email: {
      driver: 'email',
    },
    database: {
      driver: 'database',
      table: 'notifications',
    },
  },
});
```

### Notification Classes

```typescript
import { Notification, type NotificationChannel } from '@beeblock/svelar/notifications';

export class OrderShippedNotification extends Notification {
  constructor(private order: Order) {
    super();
  }

  channels(): NotificationChannel[] {
    return ['email', 'database'];
  }

  toEmail() {
    return {
      to: this.order.user.email,
      subject: 'Your order has shipped!',
      html: `<p>Order #${this.order.id} is on its way.</p>`,
    };
  }

  toDatabase() {
    return {
      type: 'order_shipped',
      title: 'Order Shipped',
      message: `Your order #${this.order.id} has shipped`,
      data: { order_id: this.order.id },
    };
  }
}

// Send
await Notifier.notify(user, new OrderShippedNotification(order));
```

Register custom channels with `Notifier.extend()`:

```typescript
Notifier.extend('audit', {
  async send(notifiable, notification) {
    const payload = notification.toChannel?.('audit', notifiable);
    await auditService.record(payload);
  },
});
```

## Configuration Management

Svelar uses a directory-based configuration system like Laravel. Each concern gets its own file in a `config/` directory at your project root.

### Generating Config Files

```bash
npx svelar make:config app
npx svelar make:config database
npx svelar make:config auth
npx svelar make:config mail
npx svelar make:config cache
npx svelar make:config queue
npx svelar make:config storage
npx svelar make:config logging
```

### Config Files

Config files live in `config/` and export a default object. Use the `env()` helper to read environment variables with type casting and defaults:

```typescript
// config/app.ts
import { env } from '@beeblock/svelar/config';

export default {
  name: env('APP_NAME', 'Svelar'),
  env: env('APP_ENV', 'development'),
  debug: env<boolean>('APP_DEBUG', false),
  url: env('APP_URL', 'http://localhost:5173'),
  key: env('APP_KEY', ''),
  timezone: 'UTC',
  locale: 'en',
};
```

### Loading Configuration

```typescript
import { config } from '@beeblock/svelar/config';

await config.loadFromDirectory('./config');
```

Scaffolded apps call `config.loadFromDirectory('config')` in `src/app.ts`, so generated config files are loaded automatically when the web server or a Svelar CLI runtime command boots the application.

Missing config directories are treated as optional and return an empty list. Files inside an existing config directory must import successfully and export an object; syntax errors, failed imports, and invalid exports throw during bootstrap instead of being skipped.

### Using Configuration

```typescript
import { config } from '@beeblock/svelar/config';

const appName = config.get('app.name');
const dbDriver = config.get('database.default');
const debug = config.get('app.debug', false);

config.set('app.maintenance', true);
```

### The env() Helper

```typescript
import { env } from '@beeblock/svelar/config';

env('APP_NAME')                    // string (default: '')
env('APP_NAME', 'Svelar')         // string with default
env<number>('DB_PORT', 5432)      // auto-casts '5432' → 5432
env<boolean>('APP_DEBUG', false)  // auto-casts 'true' → true
```

## Container & Service Providers

The IoC container manages application dependencies.

### Service Providers

```typescript
import { ServiceProvider } from '@beeblock/svelar/container';

export class AnalyticsProvider extends ServiceProvider {
  register() {
    this.app.singleton('analytics', () => new AnalyticsService());
  }

  boot() {
    const analytics = this.app.make('analytics');
    console.log('Analytics service booted');
  }
}
```

### Container Usage

```typescript
import { container } from '@beeblock/svelar/container';

container.bind('pdf', () => new PdfGenerator());
container.singleton('auth', () => new AuthManager());

const pdf = container.make('pdf');
const auth = container.make('auth');
```

## Error Handling

Handle errors gracefully across your application.

```typescript
import { abort, abortIf, abortUnless, ModelNotFoundError } from '@beeblock/svelar/errors';

abort(404, 'Resource not found');
abortIf(!user, 401, 'Unauthenticated');
abortUnless(isAdmin, 403, 'Forbidden');
```

See [Error Handling](./19-error-handling.md) for the full guide.

## UUIDv7 & ULID

Svelar provides built-in generators for modern, time-sortable identifiers. Both are available from `@beeblock/svelar/support`.

### UUIDv7

```typescript
import { uuidv7, isUuidv7, uuidv7Timestamp } from '@beeblock/svelar/support';

const id = uuidv7();
// → '019503a4-6b2c-7a1e-8f3d-4a2b1c0d9e8f'

isUuidv7(id);         // → true
uuidv7Timestamp(id);  // → Date object
```

### ULID

```typescript
import { ulid, isUlid, ulidTimestamp } from '@beeblock/svelar/support';

const id = ulid();
// → '01ARYZ6S41TSV4RRFFQ69G5FAV'

isUlid(id);         // → true
ulidTimestamp(id);   // → Date object
```

### JSONB Columns

Use `jsonb()` in migrations for explicit JSONB storage on PostgreSQL. On MySQL it maps to JSON, on SQLite it falls back to TEXT.

## Custom CLI Commands

Create your own CLI commands:

```bash
npx svelar make:command SyncUsers
```

```typescript
import { Command } from '@beeblock/svelar/cli';

export class SyncUsersCommand extends Command {
  name = 'app:sync-users';
  description = 'Sync users from external API';
  arguments = ['source'];
  flags = [
    { name: 'force', alias: 'f', description: 'Force full sync', type: 'boolean' as const },
    { name: 'limit', description: 'Max users to sync', type: 'string' as const, default: '100' },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const source = args[0] ?? 'default';
    await this.bootstrap();
    this.info(`Syncing users from ${source}...`);
    this.success(`Done.`);
  }
}
```

Commands are auto-discovered from `src/lib/commands/` in flat projects and `src/lib/shared/commands/` in DDD projects — no registration needed.

## Admin Dashboard

Scaffold the protected operational console:

```bash
npx svelar make:dashboard --capability=operations --scope=platform
```

The generator creates thin `/api/admin/*` routes bound to the public `DashboardController`, a Svelte 5 console at `/admin/dashboard`, and the manifest capabilities for each operation. Every protected endpoint checks its declared capability before controller dispatch and FormRequest parsing. An explicit `--public` exempts functional RBAC only: dashboard authentication, server authorization, validation and CSRF remain. Existing customized files require review before `--force`; updates do not delete app-owned files automatically.

New apps use the same console backend, with an authenticated capability-checked `/admin` redirect that preserves query tabs and queue scope. The minimal admin layout does not duplicate console navigation. `configureDashboard({ authorize, providers })` binds a trusted server authorizer and typed app-owned providers; the custom authorizer replaces the legacy global-admin default and can admit granular platform operators without a physical admin role. Disabled dashboards deny access. Hiding controls or returning a browser permission snapshot never authorizes a request.

Configure named `Queue` connections and queue definitions, the common worker/task registry, persistent scheduler runtime, and the database log/audit drivers in the application bootstrap; run their migrations and capability seeders. Seed initial roles and assignments deliberately. The generator's URLs are fixed: the dashboard plugin's `prefix` setting does not relocate them. Its optional background health collector is separate from the on-demand console; use `refreshInterval: 0` when background collection is not needed.

The responsive shell keeps the active tab, filters and pagination in the URL. Server loading requests only the selected panels. Browser commands use `apiFetch` with the CSRF token; adding a Bearer header does not exempt this session console from CSRF. Responses use `{ data, meta }` and `Cache-Control: no-store`. Per-action pending state, confirmations, inline errors and explicit refresh prevent duplicate submissions and polling/invalidation loops. Unexpected failures return a safe incident ID rather than a raw driver exception.

Queue topology merges the safe `Queue.configuredConnections({ limit: 100 })` inventory, local definitions and one bounded `Queue.discoverQueuesPage(connection, { limit: 100 })` page per shared connection. Entries are deduplicated by connection and queue; local labels, job definitions, worker profiles and registry metadata survive discovery. At most 100 merged queues and 60 retained metric buckets per queue are observed. Connection/page coverage, continuation cursors, truncation and observation errors remain visible; instrumented discovery does not claim to enumerate external unregistered queues. Aggregate counts and stalled/expired-lock totals remain unknown when discovery or the required lock observations are incomplete.

Queue panels use `Queue.adapter(queue, connection)`, never a default-only or process-local total. Counts, pause state, worker liveness/active/draining/stale observations, effective concurrency and bounded ready-job age are shown only when the driver can observe them. Incomplete worker coverage, external/unobservable workers and unsupported drivers stay unknown, not zero or healthy. Ready-job age is the adapter's bounded observation, not an unbounded absolute-oldest scan. Volatile memory/sync drivers are not presented as shared monitoring.

Job queries use indexed metadata filters for tenant/account/resource/correlation/job class and finite pages (`limit` 1-100, bounded non-negative `offset`). Indexed coverage is explicit; it is not a claim that every external BullMQ job has been instrumented. Inspection and mutations retain the exact connection, queue and source (`live` or `dead-letter`), so colliding IDs cannot mutate another queue. The inspector shows redacted payload/progress/error and available retained stack traces, attempts/attempts-started, created/processed/finished/delayed/failed/replayed timestamps, lock source/owner/expiry and retained timeline attempts/replay IDs, plus a same-origin resource link. Unknown fields stay unknown. Diagnostic traces retain at most five entries and 32 KiB in the driver, with explicit total/truncation metadata; the console also bounds its redacted text. DLQ queries use a bounded lookahead and report unknown filtered totals rather than borrowing an unfiltered count.

Failed/live and dead-letter retry, bounded selected-record retry/cleanup, and supported queue pause/resume controls use the adapter's state checks. Busy or protected jobs remain retained; batch responses expose partial outcomes. Destructive, batch and pause commands require explicit confirmation. Provider/adapter state remains authoritative after the browser selection.

Scheduler panels show persistent settings, available run history, leases and runtime observations. `GET /api/admin/scheduler?limit=25&offset=0&processOffset=0` returns a stable name-ordered task page, exact registered-task `meta.total`, `hasMore` and `truncated`; limits are 1-100 and registries over 1,000 tasks fail explicitly. Task/process page controls retain their offsets in the URL. Process pages include `observedTotal` and the public scheduler source's 100-observation bound: a full source page sets `sourceTruncated` and a null total rather than inventing an exact process count. Run-now calls `ScheduleMonitor.requestRun()`: the HTTP response means a durable request was queued, not that the task completed. The web process never executes `runTask()` for this control. Missing distributed observations remain unknown.

The default app provider installs `createConfiguredDashboardDependencyObserver(healthInventory)` from `@beeblock/svelar/dashboard`. It observes declared named database/cache configuration, every bounded runtime queue connection, and public Search/PDF probes. Read-only database probes use constant `SELECT 1`, not table scans; cache probes read one key and queue probes read scoped counts. Pass `cacheStores: [{ name, driver }]` copied from the same object supplied to `Cache.configure`: without runtime inventory, an empty read could come from Null and cache success remains unknown. SQLite/cache memory observations are process-scoped, not distributed health. Optional storage/mail/realtime drivers without a trustworthy public reachability proof stay unknown; SSE subscription readiness alone does not prove browser delivery. Applications configuring additional runtime sources outside the declared config registries must provide explicit named probes through `createDashboardDependencyObserver`, and replace the observer when reconfiguring its runtime sources.

Dependency observation accepts at most 100 unique names, defaults to four in-flight calls, a one-second deadline and five-second result caching, and coalesces concurrent refreshes. A timed-out SDK call keeps its pool slot until it settles, so refreshes cannot launch unlimited replacements. Probe exceptions are not returned to the browser; each observation includes scope and an unsupported/timeout/capacity/failure reason when applicable. An observed outage takes precedence over unrelated unknown dependencies. The separate legacy background health collector no longer reports healthy from missing worker/scheduler observations.

Users and roles are supplied through `DashboardUserProvider` and `DashboardPermissionProvider`, not imports of an application User model into the core console. Optional callbacks expose scoped access snapshots, role creation, role assignment/detachment and direct capability grant/revoke. Missing callbacks report unavailable and disable their controls. Access snapshots must match the requested user/scope exactly and contain at most 100 roles and 10,000 bounded capability names. Role choices and direct-grant displays are paged.

Role creation adds a shared catalog role with an empty custom profile in the explicitly selected platform/team scope; it grants and assigns nothing automatically. The role profile editor preserves custom exact sets versus system defaults minus exclusions plus inclusions, including visible stale selections. Individual grants accept only current canonical capabilities in the selected scope, never wildcard or legacy-alias expansion. Existing stale direct names can be revoked only when present in that scoped snapshot. Dependencies must be granted explicitly; selecting an action alone does not manufacture its screen grant.

The console's role/grant forms bind Superforms stores and inline errors using `zod4Client` and the public browser-safe `@beeblock/svelar/dashboard/schemas`. Backend FormRequests consume those same framework-owned Zod 4 schemas before DTO/action/service execution. This console contract does not change the application's Zod/Valibot choice for its own user forms. Scope/team identity comes from the validated mutation body; the route user ID cannot be replaced by JSON or query values.

Core checks reject self access changes, protected users, reserved platform-owner roles, incompatible guards and unknown/out-of-scope grants. App-owned callbacks must also recheck persisted user protection, self identity, authorized tenant membership and the selected role profile at the transactional write boundary. Assignments must never update a trusted platform-owner identity column or fall back to legacy broad grants. Use an explicitly bound `Permissions.forTeam(teamId)` or `Permissions.global()` facade, and `PermissionProfiles` for role profiles; a team grant cannot become platform authority.

Configured integration kill switches use public `Features` APIs and an explicit bounded name registry. Logs use the configured shared/process-local viewer, filtered pages and entry-ID cursors; authorized SSE tails bound slow clients and periodically recheck access. Payloads, context and common credential text are redacted, but redaction is not a substitute for keeping arbitrary secrets out of logs.

Every mutation records intent through `Audit` before its side effect and completion/failure afterwards, including user/role/capability and assignment scope where applicable. Configure a persistent, non-excluded dashboard audit sink. Intent failure blocks execution; completion-audit failure after execution returns a warning not to repeat blindly. Queue/scheduler effects and the audit sink are not one atomic transaction.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/console`, `/health`, `/stats` | Authorized shell/access state and bounded observations |
| GET | `/api/admin/queue` | Indexed, status/source-filtered page |
| GET / DELETE | `/api/admin/queue/[id]` | Exact scoped inspection / confirmed removal |
| POST | `/api/admin/queue/[id]/retry` | Exact scoped retry |
| GET | `/api/admin/queue/[id]/timeline` | Bounded retained history |
| POST | `/api/admin/queue/batch/retry`, `/queue/batch/cleanup` | Up to 100 explicit references; partial outcomes |
| POST | `/api/admin/queue/control/pause` | Confirmed pause/resume where supported |
| GET | `/api/admin/scheduler` | Paged registered tasks and bounded persistent process observations |
| POST | `/api/admin/scheduler/[name]/run`, `/[name]/toggle` | Queue run request / persist enabled state |
| GET | `/api/admin/scheduler/[name]/requests/[requestId]` | Safe run-request status |
| GET | `/api/admin/logs`, `/logs/tail` | Filtered logs / authorized SSE |
| GET | `/api/admin/users`, `/users/[id]/access` | User page / exact scoped role/direct-grant snapshot |
| POST / DELETE | `/api/admin/users/[id]/roles`, `/users/[id]/capabilities` | Confirmed scoped assign/detach or grant/revoke |
| POST / DELETE | `/api/admin/users/[id]/reset-password` / `/users/[id]` | Provider-authorized reset / confirmed deletion |
| GET / POST | `/api/admin/permissions` / `/permissions/roles` | Public catalog/role page / create empty scoped profile |
| GET / PUT | `/api/admin/permissions/roles/[id]/profile` | Scoped preview / confirmed system or custom profile |
| DELETE | `/api/admin/permissions/roles/[id]` | Confirmed scoped role/profile/assignment cleanup |
| GET / PUT | `/api/admin/features` / `/features/[name]` | Registered flags / confirmed boolean change |

## Plugin System

Plugins extend Svelar with new capabilities:

```typescript
import { PluginManager } from '@beeblock/svelar/plugins';

const plugins = new PluginManager(app);
plugins.use(new StripePlugin());
await plugins.boot();
```

Create plugins by extending the `Plugin` base class with `register()`, `boot()`, `migrations()`, and `config()` lifecycle hooks.

## Audit Logging

Track user actions and system changes:

```typescript
import { Audit } from '@beeblock/svelar/audit';

Audit.configure({ driver: 'database', table: 'audit_logs', enabled: true });

await Audit.log({
  userId: user.id,
  action: 'user:created',
  modelType: 'User',
  modelId: user.id,
  newValues: { email: user.email },
  ipAddress: event.getClientAddress(),
});

const entries = await Audit.query({ action: 'user:created', limit: 10 });
const stats = await Audit.getStats();
```

Call `auditable(ModelClass, options)` once during boot. The class must extend Svelar `Model`; static duck-typed CRUD wrappers are not supported. The instance observer records `created`, `updated`, `deleted`, `restored`, and `forceDeleted`, with one entry for a force-delete rather than an additional ordinary-delete entry.

```typescript
import { auditable } from '@beeblock/svelar/audit';

auditable(Invoice, {
  ignore: ['heartbeat', 'settings.lastCheckedAt'],
  redact: ['settings.credentials.*'],
});
```

Updates compare cast-aware persisted before/after values from `getPreviousOriginal()` and `getChanges()`. Equivalent decimal values such as `400.000` and `400`, and changes containing only ignored fields or the model's created/updated timestamps, do not produce update entries. A real sensitive-field change still produces an entry even when both displayed values are redacted.

`Audit.configure()` also accepts `ignore` and `redact` lists, combined with model options. Matching is case-insensitive and ignores underscores/hyphens; a single field name applies recursively, while dotted paths can use `*` for a path segment. Ignoring removes a field; redaction retains `[redacted]`. Objects, arrays, JSON-valued strings, and metadata are sanitized without mutating caller data. Do not put secrets in arbitrary free-form text.

Application context supplies user/actor identity, actor type, team/tenant, service-account/API-key identity, IP, user-agent, request ID and correlation ID. Database statistics use bounded `COUNT`/`GROUP BY` queries, not a full audit-row read. Database audit writes participate in the current transaction; memory/log events publish only after commit and are discarded on rollback. Memory storage is process-local and bounded to 10,000 entries. Audit filters are not authorization: validate access and scope reads in application code.

## API Key Management

Secure token-based authentication:

```typescript
import { ApiKeys } from '@beeblock/svelar/api-keys';

const { plainTextKey, record } = await ApiKeys.create({
  name: 'My Integration',
  userId: user.id,
  permissions: ['users:read', 'posts:write'],
});
```

Keys are hashed and can be revoked at any time. Permissions are deny-by-default: an empty permission list authenticates the key owner but does not pass permission checks. Use `'*'` only for deliberately unrestricted keys.

User-facing revocation must use `await ApiKeys.revokeForUser(keyId, authenticatedUser.id)`. It atomically checks ownership and returns `false` for missing, foreign or already revoked keys. Never accept the owner ID from submitted data. `ApiKeys.revoke(keyId)` is an unrestricted infrastructure operation for already authorized administrative code, not a substitute for ownership authorization. Generated API-key actions use the owner-scoped operation and return an inline 403 failure instead of a 500 for unauthorized revocation.

For machine actors, use a tenant-bound service account:

```typescript
type IntegrationAbility = 'orders:read' | 'orders:sync';

const credential = await ApiKeys.createServiceAccount<IntegrationAbility>({
  name: 'Tenant integration',
  teamId: team.id,
  abilities: ['orders:read'],
  allowedIps: integrationConfig.allowedIps,
  rateLimit: integrationConfig.rateLimit,
  metadata: { integration: integrationConfig.name },
});

const allowed = await ApiKeys.runWithKey(
  submittedToken,
  { tenantId: authorizedTenant.id, ip: event.getClientAddress() },
  (authenticated) => ApiKeys.hasAbility(authenticated, 'orders:read'),
);
```

Service accounts require a nonempty string or safe-integer team ID and carry a stable service-account actor identity, not the sponsoring user's authority. `abilities` is the typed alias for `permissions`; if both are supplied they must agree. IP restrictions accept exact IP addresses, not CIDR ranges. Missing/wrong IP or tenant raises `ApiKeyAccessDeniedError`; an exhausted quota raises `ApiKeyRateLimitError` with `retryAfter`, for both memory and database drivers. Invalid, expired, disabled, or revoked credentials return `null`. Successful validation records last-use time/address and supplies the actor/tenant context.

`runWithKey()` isolates context for its callback and restores the surrounding context. `hasAbility()` requires the exact record returned by validation plus matching actor, API-key and tenant context; cloned/listed/forged records fail closed. Treat these synchronous snapshots as request-scoped: validate on every request, including on other workers. Committed local rotation/control changes invalidate existing policy snapshots, requiring fresh validation. Tenant credentials cannot claim platform authority.

`await ApiKeys.rotate(id, { overlapSeconds: 30 })` atomically publishes one replacement. The default overlap is zero. During an explicit overlap, the original is accepted strictly before the deadline, capped by absolute expiry. Rotation preserves permissions, tenant, IP restrictions, rate limit, metadata, expiry and disabled state; it never revives a disabled/expired key or resets the lineage's quota budget.

`disable()`, `enable()`, and `revoke()` apply to the complete rotation lineage. Revocation clears overlap and cannot be undone by enabling. These are infrastructure operations requiring application authorization. Creation, rotation, disable/enable and revocation write an audit trail without the plaintext token or stored hash. Persistent audit failures roll back database security mutations.

Run core migration `00000000_000045_add_api_key_rotation_state` before using these database APIs. It adds rotation state and backfills existing keys without replacing them; rollback refuses while an overlap window is live. Configure database storage and a shared Redis cache for multi-process credentials/quotas; memory implementations are process-local.

## Outgoing Webhooks

Send events to external services:

```typescript
import { Webhooks } from '@beeblock/svelar/webhooks';

await Webhooks.register({
  url: 'https://example.com/events',
  events: ['user:created', 'order:shipped'],
  active: true,
});

await Webhooks.dispatch('user:created', { id: user.id, email: user.email });
```

Events are signed with HMAC and retried automatically.

## Incoming Webhook Inbox

Use `WebhookInbox` when your app receives webhooks from payment providers, marketplaces, Gotenberg callbacks, or other external systems. It stores the raw payload, redacted headers, digest, status, tenant/actor context, and an idempotency key before any slow processing happens.

```typescript
import { WebhookInbox } from '@beeblock/svelar/webhooks';

// In a registered provider, using application-owned account mapping and action:
WebhookInbox.configure({ driver: 'database' });
WebhookInbox.registerSource('partner', {
  verifier: WebhookInbox.hmacVerifier(signingSecret, { header: 'x-partner-signature', prefix: 'sha256' }),
  resolveTenant: async (payload, headers) => accountMapping.resolveAuthorizedTenant(payload, headers),
  idempotencyKey: (payload) => partnerContract.parse(payload).eventId,
  orderingKey: (payload) => partnerContract.parse(payload).resourceId,
  version: (payload) => partnerContract.parse(payload).version,
  ackStatus: 202,
  maxAttempts: 5,
  deduplicationWindowSeconds: 3600,
  handler: async (entry) => incomingPartnerAction.run(partnerDto.from(partnerContract.parse(entry.payload))),
});

// The generated /api/webhooks/incoming/[source]/+server.ts stays thin:
import { IncomingWebhookController } from '@beeblock/svelar/webhooks';
const controller = new IncomingWebhookController();
export const POST = controller.handle('receive');
```

The registered-source processor requires the database driver and all inbox migrations, including `00000000_000037_add_webhook_inbox_processing`. Configure the same sources in web, worker and scheduler bootstrap. New apps register `WebhookInboxSweep`; registered queue jobs wake processing after commit without delaying acknowledgement. A sync queue does not run slow handlers in the receiver: the sweep is the durable fallback. Queue outages do not lose committed receipts.

Source names are bounded identifiers (letters/digits plus `.`, `_`, `-`, up to 128 characters). Signature verification uses exact raw bytes before JSON parsing, tenant mapping or deduplication. Requests are capped at 1 MiB by default (configurable up to 16 MiB). The generic HMAC adapter verifies a body digest, not Stripe's timestamped signature protocol; use the provider's official verifier for provider-specific signatures, replay tolerance and secret rotation. Never substitute a verifier that returns `true` in a public receiver.

Processing claims renewable owner leases, preserves tenant/actor/correlation context and orders events per trusted account/resource key. Older versions are ignored after a newer version has succeeded. `coalesce: true` keeps only the latest waiting state while retaining every receipt; use it for desired-state updates, not independent financial transactions. A failed earlier ordered event blocks later versions until replay or an authorized ignore decision. Retries use bounded backoff; exhausted attempts remain in the DLQ (`failed` without `availableAt`). `replay(id)` resets attempts and wakes the processor but refuses an actively leased entry.

`process(source, limit)`, `stats(source?)`, `reconcile(source)` and `prune(cutoffTimestamp)` are public operational contracts. Stats include status counts and oldest pending age. Configure `redactAfterProcessing` for sensitive payload keys and schedule retention explicitly. Redacted records remain redacted on replay; keep only payload data the integration genuinely needs. Raw storage must be protected, encrypted/backed up according to application requirements and never dumped into public responses. Handler side effects are at-least-once: enforce domain idempotency for external writes because a worker can die after its side effect but before settlement.

The basic `receiveRequest`/`receive` primitives also support memory tests and custom controller workflows. They do not automatically manage leases/retries. `bodyBytes(entry)` restores binary raw-body bytes, including stored base64. Manual status methods remain for unmanaged receipts. Invalid basic HMAC signatures throw `WebhookSignatureError`; the registered-source controller returns safe 401/403/413/422/503 envelopes and acknowledges 200/202/204 only after durable capture.

Capture is idempotent within `(source, tenantId, idempotencyKey)`: concurrent deliveries return one winning entry and retain its original payload. Different tenants can receive the same provider key without sharing entries. Numeric tenant IDs normalize to strings (`42` and `'42'` identify the same tenant); omitted or `null` tenant IDs share a separate global namespace. The visible `idempotencyKey` is unchanged. Database arbitration uses a unique internal SHA-256 hash of the JSON scope tuple, including the global namespace, rather than a nullable tenant column in a composite unique constraint.

Resolve `tenantId` from trusted server-side configuration or an authorized provider-account mapping. Do not trust a tenant ID supplied in webhook headers or payloads. Signature verification runs before duplicate recovery, including for existing keys; a valid signature alone does not authorize the tenant mapping. Entry lookup and processing by ID still require application-level authorization.

For existing installations, stop webhook receivers, review `npx svelar update --category migration --dry-run`, apply the missing framework migration with `npx svelar update --category migration`, and run `npx svelar migrate` before restarting updated receivers. Additive migration `00000000_000034_scope_webhook_inbox_idempotency` backfills retained records, creates `idx_webhook_inbox_deduplication`, then removes the old source/key-only constraint; it does not replace stored payloads or visible keys. Custom inbox tables need the same `deduplication_key` column and unique index. Do not run mixed old/new writers during this change. SQLite and PostgreSQL schema changes are transactional; MySQL DDL implicitly commits, so take a backup and inspect any failed migration before retrying. Rollback refuses to restore the old global source/key constraint when different tenants share a key; it never deletes entries to make rollback succeed.

## Teams & Workspaces

Multi-tenant team management:

```typescript
import { Teams } from '@beeblock/svelar/teams';

const team = await Teams.create({
  name: 'Acme Corp',
  ownerId: user.id,
});

await Teams.invite(team.id, 'member@example.com', 'admin');
```

Tables are managed by Svelar core migrations. Teams use `owner`, `admin`, `member`, and `viewer` roles by default; pass `roles` to `Teams.configure()` to allow custom roles. The `owner` role is reserved for the team owner, cannot be assigned through invitations or member updates, and the owner member cannot be removed through `removeMember()`.

Use `Teams.runWithTeam()` for tenant-scoped work. Svelar stores the current
team in `AsyncLocalStorage`, so concurrent requests, events, and queued jobs do
not overwrite each other's team context:

```typescript
import { TenantModel } from '@beeblock/svelar/orm';
import { Teams } from '@beeblock/svelar/teams';

class Project extends TenantModel {
  static table = 'projects';
  static fillable = ['name'];
}

await Teams.runWithTeam(team.id, async () => {
  await Project.create({ name: 'Roadmap' }); // team_id is filled automatically
  const projects = await Project.all();      // WHERE team_id = current team
});
```

`TenantModel` fails closed when no team context exists. Use
`Project.withoutTenantScope()` only for explicit admin/reporting workflows.

## Email Templates

Manage and render email templates:

```typescript
import { EmailTemplates } from '@beeblock/svelar/email-templates';

await EmailTemplates.register({
  name: 'welcome',
  subject: 'Welcome to {{ appName }}',
  html: `<p>Hello {{ userName }},</p>...`,
  variables: ['appName', 'userName'],
  active: true,
});

const { html } = await EmailTemplates.render('welcome', {
  appName: 'My App',
  userName: user.name,
});
```

## File Uploads

Track and serve user-uploaded files:

```typescript
import { Uploads } from '@beeblock/svelar/uploads';

const upload = await Uploads.store(formFile, {
  disk: 'local',
  directory: `users/${user.id}`,
  userId: user.id,
});

const url = await Uploads.getUrl(upload.id, 3600);
```

`Uploads.store()`, `Uploads.delete()`, and `Uploads.getUrl()` use the configured Storage disk and throw storage configuration, filesystem, or S3/RustFS errors. Upload metadata is only created after the file write succeeds, and metadata is not deleted when file deletion fails.

## Billing with Stripe

Stripe billing is available as the `@beeblock/svelar-stripe` plugin. Install the Stripe SDK and configure:

```bash
npm install @beeblock/svelar-stripe stripe
npx svelar plugin:install @beeblock/svelar-stripe
```

```typescript
// src/app.ts
import { Stripe } from '@beeblock/svelar-stripe';

Stripe.configure({
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  currency: 'usd',
});
```

```typescript
// Create a subscription
const subscription = await Stripe.service().createSubscription(
  user.stripe_customer_id,
  'price_xxxxx',
  { trialDays: 14 },
);

// Cancel at end of billing period
await Stripe.service().cancelSubscription(subscription.id, false);

// Handle webhooks
Stripe.webhooks()
  .on('invoice.payment_succeeded', async (event) => {
    // Record payment
  });
```

The scaffold includes a billing page at `/dashboard/billing`, admin billing management, and a webhook route at `/api/webhooks/stripe`.

See [Stripe Billing](./32-stripe.md) for the full guide: products, prices, currencies, checkout, portal, invoices, refunds, and webhook events.

---
