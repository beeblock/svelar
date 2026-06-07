# Testing

Svelar provides a Laravel-inspired testing module built on top of **Vitest** (unit/feature) and **Playwright** (end-to-end). New projects scaffolded with `npx @beeblock/svelar new` come with everything pre-configured.

```
import { useSvelarTest, assertDatabaseHas, Factory, actingAs, createRequestEvent } from '@beeblock/svelar/testing';
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
