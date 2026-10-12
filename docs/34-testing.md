# Testing

Svelar provides a Laravel-inspired testing module built on top of **Vitest** (unit/feature) and **Playwright** (end-to-end). New projects scaffolded with `npx @beeblock/svelar new` come with everything pre-configured.

```
import { useSvelarTest, assertDatabaseHas, Factory, actingAs, createRequestEvent, fakeMail } from '@beeblock/svelar/testing';
```

## Quick Start

Scaffolded projects include test infrastructure out of the box:

```bash
npm test              # Run unit + feature tests
npm run test:watch    # Watch mode
npm run test:e2e      # Run Playwright e2e tests
npm run test:coverage # Coverage report
```

Generate test files and factories with the CLI:

```bash
npx svelar make:test UserService --unit     # tests/unit/UserService.test.ts
npx svelar make:test Auth --feature         # tests/feature/Auth.test.ts
npx svelar make:test Login --e2e            # tests/e2e/Login.spec.ts
npx svelar make:factory User --model User   # src/lib/factories/UserFactory.ts
```

## Project Structure

```
my-app/
  vitest.config.ts          # Vitest config with aliases
  playwright.config.ts      # Playwright config
  tests/
    unit/                   # Unit tests (*.test.ts)
      example.test.ts
    feature/                # Feature tests with DB (*.test.ts)
      auth.test.ts
    e2e/                    # Playwright tests (*.spec.ts)
  src/lib/
    factories/              # Model factories
      UserFactory.ts
```

## useSvelarTest()

The `useSvelarTest()` composable wires up the test environment automatically inside a `describe()` block. It configures an in-memory SQLite database and resets factory sequences between tests.

```typescript
import { describe, it, expect } from 'vitest';
import { useSvelarTest, assertDatabaseHas } from '@beeblock/svelar/testing';
import UserFactory from '$lib/factories/UserFactory';

describe('UserService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('creates a user', async () => {
    const user = await UserFactory.create({ name: 'Alice' });
    await assertDatabaseHas('users', { name: 'Alice' });
  });
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `refreshDatabase` | `boolean` | `false` | Drop all tables and re-run migrations before each test |
| `connectionName` | `string` | `undefined` | Database connection name (uses default if omitted) |
| `migrationsPath` | `string` | `svelar.database.json` or `src/lib/database/migrations` | Migration directory |
| `migrationsTable` | `string` | `svelar.database.json` or `migrations` | Migration repository table |

## Factories

Factories generate model instances with sensible defaults. Extend the `Factory<T>` base class and implement `model()` and `definition()`.

```typescript
import { Factory } from '@beeblock/svelar/testing';
import { User } from '$lib/modules/auth/domain/models/User';

export class UserFactory extends Factory<User> {
  model() {
    return User;
  }

  definition() {
    return {
      name: `User ${this.sequence}`,
      email: `user${this.sequence}@test.com`,
      password_hash: 'hashed',
      role: 'user',
    };
  }
}

// Export a singleton for convenience
export default new UserFactory();
```

### Factory Methods

```typescript
// Create and persist to database
const user = await UserFactory.create({ name: 'Alice' });

// Create multiple
const users = await UserFactory.createMany(5, { role: 'admin' });

// Make without persisting (in-memory only)
const user = UserFactory.make({ name: 'Bob' });

// Make multiple without persisting
const users = UserFactory.makeMany(3);
```

### Generating Factories

```bash
npx svelar make:factory User --model User
npx svelar make:factory Post --model Post
npx svelar make:factory Invoice --model Invoice --module billing
```

The `--model` flag specifies which model class to import. In DDD projects, use `--module` when the model lives in a specific module. If omitted, the command scans `src/lib/modules/*/{Model}.ts` and falls back to the conventional module name.

## Database Assertions

Assert against your database state in tests. These throw descriptive errors on failure.

```typescript
import { assertDatabaseHas, assertDatabaseMissing, assertDatabaseCount } from '@beeblock/svelar/testing';

// Assert a matching row exists
await assertDatabaseHas('users', { email: 'alice@test.com' });

// Assert no matching row exists
await assertDatabaseMissing('users', { email: 'deleted@test.com' });

// Assert exact row count
await assertDatabaseCount('users', 5);

// Assert count with conditions
await assertDatabaseCount('users', 2, { role: 'admin' });
```

## refreshDatabase()

Drops all tables and re-runs migrations from the configured migration directory. It reads `svelar.database.json` for `migrations.path` and `migrations.table`, then falls back to `src/lib/database/migrations/` and `migrations`. Called automatically when `useSvelarTest({ refreshDatabase: true })` is set, but can also be used standalone:

```typescript
import { refreshDatabase } from '@beeblock/svelar/testing';

beforeEach(async () => {
  await refreshDatabase();
});

// Override when a test needs a custom migration source
beforeEach(async () => {
  await refreshDatabase({
    migrationsPath: 'tests/fixtures/migrations',
    migrationsTable: 'test_migrations',
  });
});
```

## actingAs()

Simulate an authenticated user by setting `event.locals.user`, just like `AuthenticateMiddleware` does in production.

```typescript
import { actingAs, createRequestEvent } from '@beeblock/svelar/testing';
import UserFactory from '$lib/factories/UserFactory';

it('returns user profile', async () => {
  const user = await UserFactory.create();
  const event = actingAs(user, createRequestEvent({
    method: 'GET',
    url: '/api/me',
  }));

  const response = await controller.handle('show')(event);
  expect(response.status).toBe(200);
});
```

`actingAs()` accepts either an existing RequestEvent or options to create one:

```typescript
// With existing event
const event = createRequestEvent({ method: 'POST', url: '/api/posts' });
actingAs(user, event);

// With options (creates a new event)
const event = actingAs(user, { method: 'GET', url: '/api/me' });

// With no options (creates a default GET / event)
const event = actingAs(user);
```

## createRequestEvent()

Build a mock SvelteKit `RequestEvent` for testing server-side handlers without a running server.

```typescript
import { createRequestEvent } from '@beeblock/svelar/testing';

const event = createRequestEvent({
  method: 'POST',
  url: '/api/posts',
  headers: { 'Content-Type': 'application/json' },
  body: { title: 'Hello', content: 'World' },
  params: { id: '1' },
  locals: { user: someUser },
  cookies: { session_id: 'abc123' },
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `method` | `string` | `'GET'` | HTTP method |
| `url` | `string` | `'http://localhost:5173/'` | Request URL |
| `headers` | `Record<string, string>` | `{}` | Request headers |
| `body` | `any` | `undefined` | Request body (auto-serialized to JSON) |
| `params` | `Record<string, string>` | `{}` | Route parameters |
| `locals` | `Record<string, any>` | `{}` | SvelteKit locals |
| `cookies` | `Record<string, string>` | `{}` | Request cookies |

## Testing Controllers

Combine factories, `actingAs()`, and `createRequestEvent()` to test your controllers:

```typescript
import { describe, it, expect } from 'vitest';
import { useSvelarTest, actingAs, createRequestEvent, assertDatabaseHas } from '@beeblock/svelar/testing';
import UserFactory from '$lib/factories/UserFactory';
import { PostController } from '$lib/modules/posts/interface/http/controllers/PostController';

describe('PostController', () => {
  useSvelarTest({ refreshDatabase: true });
  const controller = new PostController();

  it('creates a post', async () => {
    const user = await UserFactory.create();
    const event = actingAs(user, createRequestEvent({
      method: 'POST',
      url: '/api/posts',
      body: { title: 'My Post', content: 'Hello world' },
    }));

    const response = await controller.handle('store')(event);
    expect(response.status).toBe(201);
    await assertDatabaseHas('posts', { title: 'My Post', user_id: user.id });
  });

  it('requires authentication', async () => {
    const event = createRequestEvent({
      method: 'POST',
      url: '/api/posts',
      body: { title: 'Unauthorized' },
    });

    const response = await controller.handle('store')(event);
    expect(response.status).toBe(401);
  });
});
```

## Faking Mail

Use callback-scoped `fakeMail()` when a feature sends email through Svelar mail, notification email channels, auth recovery, or queued jobs. It suppresses delivery without replacing mail configuration or clearing initialized transports, and restores normal delivery automatically after the callback:

```typescript
import { Mailer } from '@beeblock/svelar/mail';
import { fakeMail } from '@beeblock/svelar/testing';

it('sends a welcome email', async () => {
  await fakeMail(async (mail) => {
    await Mailer.send({
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello',
    });

    mail.assertSent((record) => record.message.to === 'alice@example.com');
    mail.assertNotSent((record) => record.message.subject === 'Password reset');
  });
});
```

`fakeMail` intercepts `send`, `sendMailable`, and named `mailer(name).send` handles, including handles created before the callback. Configured default senders and explicit message senders are honored. Records include the selected `mailer`, copied message fields and attachment buffers, fake delivery result, and timestamp. `Mailable.build()` still runs. Nested/concurrent scopes and failure teardown follow the same rules as the other runtime fakes below.

### Legacy Configuration Helper

`fakeMailer({ name?, from? })` remains available for compatibility and returns `FakeMailTransport`. It permanently calls `Mailer.configure`, clears the transport cache, and does **not** automatically restore the previous configuration. It is not safe for concurrent tests sharing a runtime. Use it only when deliberately configuring the test runtime and explicitly reconfiguring `Mailer` afterward; prefer `fakeMail(callback)` for scoped isolation without configuration snapshots.

## Scoped Runtime Fakes

Use `fakeMail`, `fakeQueue`, `fakeEvents`, `fakeNotifications`, and `fakeHttp` from `@beeblock/svelar/testing` to isolate side effects inside an awaited callback. These Node-only helpers capture records instead of sending mail, executing jobs, invoking event listeners, delivering notifications, or making HTTP requests. Each callback returns its result and automatically removes its interception hooks in `finally`, including when the callback throws.

Nested scopes restore the enclosing fake, and overlapping async callbacks capture independently. Code outside a callback continues using the original runtime. Always await all work inside the callback; do not leave background promises or timers running past its teardown. These helpers do not change `fakeMailer()`'s existing configuration-based behavior.

### Queue, Events, and Notifications

```typescript
import { Queue } from '@beeblock/svelar/queue';
import { Event } from '@beeblock/svelar/events';
import { Notifier } from '@beeblock/svelar/notifications';
import { fakeQueue, fakeEvents, fakeNotifications } from '@beeblock/svelar/testing';

await fakeQueue(async (queue) => {
  await Queue.dispatch(new SendWelcomeEmail(user.id), { queue: 'emails' });
  queue.assertPushed((record) => record.job instanceof SendWelcomeEmail && record.queue === 'emails');
  queue.assertCount(1);
});

await fakeEvents(async (events) => {
  await Event.dispatch(new UserRegistered(user));
  events.assertDispatched((record) => record.event instanceof UserRegistered);
  events.assertNotDispatched((record) => record.name === 'UserDeleted');
});

await fakeNotifications(async (notifications) => {
  await Notifier.notify(user, new WelcomeNotification());
  notifications.assertSent((record) => record.notifiable === user && record.channels.includes('email'));
  notifications.assertCount(1);
});
```

The queue fake also suppresses `dispatchSync` and `chain`. Records include the returned job ID, job reference, serialized dispatch-time `payload`, queue, `mode` (`async` or `sync`), attempts limit, scheduling timestamps, priority, deduplication flag, and copied metadata. A chain is captured as one `ChainedJob` with its serialized constituent jobs; no job runs. The original queue configuration, initialized drivers, and pending jobs remain untouched.

The event fake captures class-based `dispatch` and named `emit`, including empty payloads, without consuming one-time listeners or changing existing listener registrations. It uses the global `Event` dispatcher by default; pass `{ dispatcher }` as the second argument to fake a local `EventDispatcher`.

The notification fake captures one record per recipient for both `notify` and `notifyVia`, with a copied channel list. `notification.channels()` still selects channels during `notify`, but channel drivers and `toEmail`, `toDatabase`, and `toChannel` are not called. Email, database, custom, and even unconfigured channels cannot deliver inside the fake.

### HTTP

```typescript
import { Http } from '@beeblock/svelar/http';
import { fakeHttp } from '@beeblock/svelar/testing';

await fakeHttp(async (http) => {
  http.respond(
    (record) => record.method === 'POST' && record.url === 'https://api.example.com/payments',
    new Response(JSON.stringify({ id: 'payment-1' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  const response = await Http.post('https://api.example.com/payments', { amount: 100 });
  expect(response.status).toBe(201);
  http.assertSent((record) => JSON.parse(record.body!).amount === 100);
  http.assertCount(1);
});
```

The first matching responder wins. `respondWith(response)` matches every request; either responder method also accepts an async `(record) => Response` function for sequences and simulated errors. Response templates are cloned before consumption and can be reused. Unmatched requests throw instead of falling back to the network. Transport failures are captured with `error`; HTTP error responses retain their response status and headers.

The fake intercepts `Http`, existing `HttpClient` instances, fluent clones, `apiFetch`, `apiFetchJson`, and `signedFetch`. Direct calls to global `fetch` or other HTTP libraries are outside its scope. Global `fetch` is never replaced. Request records contain the URL, method, copied `Headers`, normalized body text, timestamp, and response status/headers or error. Retries and HTTP hooks still run; each transport attempt is captured. Abort signals and client timeouts are honored, and circuit-breaker state is isolated from the original runtime. Retry delays still apply; use the existing `retry({ sleep })` option to avoid waiting in tests.

### Records and Limits

All five fakes provide `records()`, `count(predicate?)`, `assertCount(expected, predicate?)`, and `reset()` to clear records. Queue adds `pushed`, `assertPushed`, `assertNotPushed`, and `assertNothingPushed`; events adds `dispatched`, `assertDispatched`, `assertNotDispatched`, and `assertNothingDispatched`; mail, notifications, and HTTP add `sent()` or `requests()`, `assertSent`, `assertNotSent`, and `assertNothingSent`. Positive/negative predicate assertions accept an optional custom failure message.

Record accessors return a copied array. Job, event/payload, notification, and recipient objects retain their original identity, so avoid mutating them before assertions; queue `payload` remains a serialized snapshot. Queue records also contain a copied dispatch-time `context` for tenant/actor propagation assertions, separate from the original job object. HTTP request bodies are normalized text rather than parsed JSON.

Each fake captures at most 1,000 records by default. Pass `{ maxRecords: 5000 }` as the second argument to increase the limit. Limits must be positive safe integers; overflow throws without performing the real side effect. The corresponding `FakeMail`, `FakeQueue`, `FakeEvents`, `FakeNotifications`, and `FakeHttp` classes accept the same options and expose `run(callback)` for reuse. A single instance cannot run overlapping scopes; use separate instances for nested or concurrent work. `reset()` only clears captured records, not HTTP responders or circuit state.

Svelar currently uses native time APIs without an injectable clock contract. Use Vitest's clock controls when needed; these helpers do not patch time globally.

## E2E Tests with Playwright

E2E tests live in `tests/e2e/` and use Playwright. The scaffolded `playwright.config.ts` starts your dev server automatically.

```typescript
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('can log in', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin@svelar.dev');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'wrong@test.com');
    await page.fill('input[name="password"]', 'wrong');
    await page.click('button[type="submit"]');
    await expect(page.locator('.error')).toBeVisible();
  });
});
```

Generate e2e tests:

```bash
npx svelar make:test Login --e2e       # tests/e2e/Login.spec.ts
npx svelar make:test Dashboard --e2e   # tests/e2e/Dashboard.spec.ts
```

## Configuration

### vitest.config.ts

The scaffolded config includes aliases matching your `vite.config.ts` so `$lib` and `@beeblock/svelar/*` imports work in tests:

```typescript
import { defineConfig } from 'vitest/config';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';

const require_ = createRequire(import.meta.url);
const svelarRoot = dirname(require_.resolve('@beeblock/svelar/package.json'));

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/feature/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    alias: {
      '$lib': resolve('./src/lib'),
      '@beeblock/svelar/testing': resolve(svelarRoot, 'dist/testing/index.js'),
      // ... other svelar module aliases
    },
  },
});
```

### playwright.config.ts

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `make:test Name --unit` | Unit test in `tests/unit/Name.test.ts` (default) |
| `make:test Name --feature` | Feature test in `tests/feature/Name.test.ts` |
| `make:test Name --e2e` | Playwright test in `tests/e2e/Name.spec.ts` |
| `make:factory Name --model Model --module module` | Factory in `src/lib/factories/NameFactory.ts` |

## API Reference

| Export | Description |
|--------|-------------|
| `useSvelarTest(options?)` | Wire up test environment in a `describe()` block |
| `refreshDatabase(connectionName?)` | Drop all tables, re-run migrations |
| `Factory<T>` | Base class for model factories |
| `assertDatabaseHas(table, conditions)` | Assert matching row exists |
| `assertDatabaseMissing(table, conditions)` | Assert no matching row exists |
| `assertDatabaseCount(table, expected, conditions?)` | Assert exact row count |
| `actingAs(user, event?)` | Simulate authenticated user |
| `createRequestEvent(options?)` | Build mock SvelteKit RequestEvent |
| `fakeMailer(options?)` | Configure an in-memory mail transport with sent-mail assertions |
| `FakeMailTransport` | Mail fake implementation returned by `fakeMailer()` |
