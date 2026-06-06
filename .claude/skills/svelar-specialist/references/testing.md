# Testing API Reference

Full docs: https://svelar.dev/docs/testing

Import: `from '@beeblock/svelar/testing'`

## Table of Contents
- [useSvelarTest()](#usesvelartest)
- [Factory](#factory)
- [Database Assertions](#database-assertions)
- [actingAs()](#actingas)
- [createRequestEvent()](#createrequestevent)
- [refreshDatabase()](#refreshdatabase)
- [Testing Controllers](#testing-controllers)
- [E2E Tests (Playwright)](#e2e-tests)
- [CLI Commands](#cli-commands)

---

## useSvelarTest()

Wires up the test environment in a `describe()` block. Configures in-memory SQLite, resets factory sequences between tests.

```typescript
import { useSvelarTest } from '@beeblock/svelar/testing';

describe('UserService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('works', async () => {
    // Database is fresh before each test
  });
});
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `refreshDatabase` | `boolean` | `false` | Drop all tables + re-run migrations before each test |
| `connectionName` | `string` | `undefined` | Database connection name |

**Requires:** `globals: true` in `vitest.config.ts` (uses `beforeAll`, `beforeEach` from Vitest globals).

## Factory

Base class for model factories. Subclass it for each model.

```typescript
import { Factory } from '@beeblock/svelar/testing';
import { User } from '$lib/modules/auth/User';

export class UserFactory extends Factory<User> {
  model() { return User; }

  definition() {
    return {
      name: `User ${this.sequence}`,
      email: `user${this.sequence}@test.com`,
      password_hash: 'hashed',
      role: 'user',
    };
  }
}

// Singleton for convenience
export default new UserFactory();
```

### Methods

```typescript
// Create and persist to database
const user = await factory.create({ name: 'Alice' });

// Create multiple
const users = await factory.createMany(5, { role: 'admin' });

// Make without persisting (in-memory only)
const user = factory.make({ name: 'Bob' });

// Make multiple
const users = factory.makeMany(3);
```

### Static Methods

```typescript
// Reset sequence counter (done automatically by useSvelarTest)
Factory.resetSequence();
```

### Properties

- `this.sequence` -- auto-incrementing counter, unique per invocation

### Generating Factories

```bash
npx svelar make:factory User --model User    # src/lib/factories/UserFactory.ts
npx svelar make:factory Post --model Post    # src/lib/factories/PostFactory.ts
```

Auto-detects DDD vs flat structure for import paths.

## Database Assertions

All assertions are async. They throw descriptive errors on failure.

```typescript
import { assertDatabaseHas, assertDatabaseMissing, assertDatabaseCount } from '@beeblock/svelar/testing';

// Assert a matching row exists
await assertDatabaseHas('users', { email: 'alice@test.com' });

// Assert no matching row exists
await assertDatabaseMissing('users', { email: 'deleted@test.com' });

// Assert exact row count (all rows)
await assertDatabaseCount('users', 5);

// Assert exact row count with conditions
await assertDatabaseCount('users', 2, { role: 'admin' });

// All accept optional connectionName as last argument
await assertDatabaseHas('users', { email: 'x@test.com' }, 'secondary');
```

## actingAs()

Simulates an authenticated user by setting `event.locals.user`.

```typescript
import { actingAs, createRequestEvent } from '@beeblock/svelar/testing';

// With existing event
const event = createRequestEvent({ method: 'GET', url: '/api/me' });
actingAs(user, event);

// With options (creates new event)
const event = actingAs(user, { method: 'POST', url: '/api/posts' });

// With no options (GET /)
const event = actingAs(user);
```

## createRequestEvent()

Builds a mock SvelteKit `RequestEvent` for testing server-side handlers.

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

**Options:**
| Option | Type | Default |
|--------|------|---------|
| `method` | `string` | `'GET'` |
| `url` | `string` | `'http://localhost:5173/'` |
| `headers` | `Record<string, string>` | `{}` |
| `body` | `any` | `undefined` |
| `params` | `Record<string, string>` | `{}` |
| `locals` | `Record<string, any>` | `{}` |
| `cookies` | `Record<string, string>` | `{}` |

**Provides:** `request`, `url`, `params`, `locals`, `route`, `cookies` (get/set/delete/getAll/serialize), `fetch`, `getClientAddress()`, `setHeaders()`.

## refreshDatabase()

Drops all tables and re-runs migrations. Called automatically by `useSvelarTest({ refreshDatabase: true })`.

```typescript
import { refreshDatabase } from '@beeblock/svelar/testing';

// Standalone usage
beforeEach(async () => {
  await refreshDatabase();
});

// With specific connection
await refreshDatabase('secondary');
```

Uses `Migrator.fresh()` internally -- loads migrations from `src/lib/database/migrations/`.

## Testing Controllers

Full pattern for testing controllers:

```typescript
import { describe, it, expect } from 'vitest';
import { useSvelarTest, actingAs, createRequestEvent, assertDatabaseHas } from '@beeblock/svelar/testing';
import UserFactory from '$lib/factories/UserFactory';
import { PostController } from '$lib/modules/posts/PostController';

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
    const event = createRequestEvent({ method: 'POST', url: '/api/posts' });
    const response = await controller.handle('store')(event);
    expect(response.status).toBe(401);
  });

  it('lists posts', async () => {
    const user = await UserFactory.create();
    const event = actingAs(user, createRequestEvent({ method: 'GET', url: '/api/posts' }));
    const response = await controller.handle('index')(event);
    expect(response.status).toBe(200);
  });
});
```

## E2E Tests

Playwright tests in `tests/e2e/`. Config auto-starts dev server.

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
});
```

Generate: `npx svelar make:test Login --e2e`

## CLI Commands

| Command | Output |
|---------|--------|
| `make:test Name --unit` | `tests/unit/Name.test.ts` (default) |
| `make:test Name --feature` | `tests/feature/Name.test.ts` |
| `make:test Name --e2e` | `tests/e2e/Name.spec.ts` |
| `make:factory Name --model Model` | `src/lib/factories/NameFactory.ts` |

## Project Setup

New projects scaffolded with `npx svelar new` include:

- `vitest.config.ts` -- aliases for `$lib` and `@beeblock/svelar/*`
- `playwright.config.ts` -- webServer auto-start
- `tests/unit/example.test.ts`
- `tests/feature/auth.test.ts`
- `src/lib/factories/UserFactory.ts`
- Scripts: `test`, `test:watch`, `test:e2e`, `test:coverage`
- DevDeps: `vitest`, `@playwright/test`
