# Svelar

**Laravel-inspired framework on top of SvelteKit 2**

Svelar brings the developer experience of Laravel to the modern TypeScript/Svelte ecosystem. It provides an Eloquent-like ORM over Drizzle, an Artisan-like CLI, middleware pipelines, IoC container, and all the conventions that make Laravel productive — all built for SvelteKit 2.

## Quick Start

```bash
# Scaffold a new project
npx svelar new my-app
cd my-app
npm install
npm run dev
```

Or add to an existing SvelteKit project:

```bash
npm install /svelar drizzle-orm better-sqlite3
```

## Features

**ORM** — Eloquent-like API over Drizzle ORM with models, relationships (HasOne, HasMany, BelongsTo, BelongsToMany), query builder, eager loading, attribute casting, and lifecycle hooks.

**Database** — Multi-database support (SQLite, PostgreSQL, MySQL), Laravel-like schema builder, migrations with batch tracking and rollback, and seeders.

**Authentication** — Session-based and JWT auth, password hashing (scrypt/bcrypt/argon2), API tokens, auth middleware, and registration helpers.

**Middleware** — Pipeline architecture integrated with SvelteKit hooks. Built-in CORS, rate limiting, CSRF, logging, and session middleware.

**Controllers** — Base controller with JSON/redirect/HTML response helpers, Zod validation, Form Request classes, and resource routing.

**IoC Container** — Service container with bind/singleton/instance, aliases, tags, and service providers with register/boot lifecycle.

**CLI** — Artisan-like scaffolding: `make:model`, `make:migration`, `make:controller`, `make:middleware`, `make:provider`, `make:seeder`, `migrate`, and `tinker` REPL.

**Events** — Typed event dispatcher with listeners, one-time listeners, wildcards, and subscriber classes.

**Cache** — Memory, file, and Redis drivers with `remember`, `pull`, TTL, increment/decrement.

**Queue** — Background job processing with sync and memory drivers, retry logic, and failure handling.

**Mail** — Email abstraction with SMTP, log, and null drivers. Mailable classes for structured emails.

**Notifications** — Multi-channel notifications (mail, database, custom) with Notification classes.

**Broadcasting** — Server-Sent Events for real-time updates, no external dependencies.

**Storage** — Filesystem abstraction with local driver (S3 ready), recursive file listing, copy, move.

**Logging** — Structured logging with console, file, and stack channels. JSON and text formats.

**Validation** — Zod-based with Laravel-like rule helpers and Form Request classes.

## Usage Examples

### Models & ORM

```typescript
import { Model } from '@beeblock/svelar/orm';

class User extends Model {
  static table = 'users';
  static fillable = ['name', 'email', 'password'];
  static hidden = ['password'];

  declare id: number;
  declare name: string;
  declare email: string;

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

// Query
const users = await User.where('active', true).orderBy('name').get();
const user = await User.find(1);
const paginated = await User.query().paginate(1, 20);

// Create
const user = await User.create({ name: 'John', email: 'john@example.com' });

// Update
await user.update({ name: 'Jane' });

// Eager loading
const usersWithPosts = await User.with('posts').get();
```

### Controllers

```typescript
// src/lib/controllers/UserController.ts
import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { z } from '@beeblock/svelar/validation';

class UserController extends Controller {
  async index(event: RequestEvent) {
    return this.json(await User.all());
  }

  async store(event: RequestEvent) {
    const data = await this.validate(event, z.object({
      email: z.string().email(),
      name: z.string().min(2),
    }));
    return this.created(await User.create(data));
  }
}

// src/routes/api/users/+server.ts
import { resource } from '@beeblock/svelar/routing';
const { GET, POST } = resource(UserController);
export { GET, POST };
```

### Hooks & Middleware

```typescript
// src/hooks.server.ts
import { createSvelarHooks, LoggingMiddleware, CorsMiddleware } from '@beeblock/svelar';
import { SessionMiddleware, MemorySessionStore } from '@beeblock/svelar/session';

export const handle = createSvelarHooks({
  middleware: [
    LoggingMiddleware,
    new CorsMiddleware({ origin: '*' }),
    new SessionMiddleware({ store: new MemorySessionStore() }),
  ],
});
```

### Authentication

```typescript
import { AuthManager, Hash } from '@beeblock/svelar';

const auth = new AuthManager({
  guard: 'jwt',
  model: User,
  jwt: { secret: process.env.JWT_SECRET! },
});

// Register
const user = await auth.register({
  name: 'John',
  email: 'john@example.com',
  password: 'secret123',
});

// Login (JWT)
const result = await auth.attemptJwt({
  email: 'john@example.com',
  password: 'secret123',
});
// result.token, result.user, result.expiresAt
```

### Events

```typescript
import { Event } from '@beeblock/svelar/events';

class UserRegistered {
  constructor(public readonly user: User) {}
}

Event.listen(UserRegistered, async (e) => {
  await sendWelcomeEmail(e.user);
});

await Event.dispatch(new UserRegistered(user));
```

### Cache

```typescript
import { Cache } from '@beeblock/svelar/cache';

await Cache.put('key', 'value', 3600);
const value = await Cache.get('key', 'default');

const users = await Cache.remember('all-users', 600, () => User.all());
```

### Queue

```typescript
import { Queue, Job } from '@beeblock/svelar/queue';

class SendEmail extends Job {
  constructor(private userId: number) { super(); }
  async handle() {
    const user = await User.findOrFail(this.userId);
    await Mailer.send({ to: user.email, subject: 'Hi!', text: 'Hello!' });
  }
}

await Queue.dispatch(new SendEmail(1));
```

## CLI Commands

```bash
svelar make:model User -a          # Model + migration + resource controller
svelar make:migration create_posts_table
svelar make:controller PostController --resource
svelar make:middleware Auth
svelar make:provider AppServiceProvider
svelar make:seeder UsersSeeder
svelar migrate                     # Run pending migrations
svelar migrate --rollback          # Rollback last batch
svelar migrate --status            # Show migration status
svelar tinker                      # Interactive REPL
```

## Project Structure

```
my-app/
├── src/
│   ├── routes/              # SvelteKit file-based routes
│   ├── lib/
│   │   ├── controllers/     # Request controllers
│   │   ├── models/          # Eloquent-like models
│   │   ├── middleware/       # Custom middleware
│   │   ├── providers/       # Service providers
│   │   └── database/
│   │       ├── migrations/  # Database migrations
│   │       └── seeders/     # Database seeders
│   ├── app.ts               # Application bootstrap
│   └── hooks.server.ts      # SvelteKit hooks with middleware
├── .env
└── package.json
```

## Database Support

Svelar supports SQLite, PostgreSQL, and MySQL out of the box through Drizzle ORM:

```typescript
import { Connection } from '@beeblock/svelar';

Connection.configure({
  default: 'sqlite',
  connections: {
    sqlite: { driver: 'sqlite', filename: 'database.db' },
    postgres: { driver: 'postgres', host: 'localhost', database: 'myapp', user: 'postgres' },
    mysql: { driver: 'mysql', host: 'localhost', database: 'myapp', user: 'root' },
  },
});
```

## Packages

| Package | Description |
|---------|-------------|
| `@beeblock/svelar` | Core framework, CLI, project scaffolder, middleware, auth, ORM, and utilities |

## License

MIT
