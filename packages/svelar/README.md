# Svelar

Laravel-inspired framework on top of SvelteKit 2. Brings the developer experience of Laravel — routing, middleware, Eloquent-style ORM, service container, auth, sessions, caching, queues, mail, and more — into the SvelteKit ecosystem.

## Quick Start

```bash
# Scaffold a new project
npm create svelar@latest my-app
cd my-app
npm install
npm run dev
```

Or add to an existing SvelteKit project:

```bash
npm install svelar
```

## Features

| Module | Import | Description |
|--------|--------|-------------|
| **ORM** | `svelar/orm` | Eloquent-style models with relationships, casting, eager loading |
| **Database** | `svelar/database` | Schema builder, migrations, seeders (SQLite, PostgreSQL, MySQL) |
| **Container** | `svelar/container` | IoC container with bind/singleton/instance, service providers |
| **Routing** | `svelar/routing` | Controllers with validation, form requests, resource routes |
| **Middleware** | `svelar/middleware` | Middleware pipeline, CORS, rate limiting, CSRF protection |
| **Auth** | `svelar/auth` | Session & JWT authentication, API tokens, guards |
| **Session** | `svelar/session` | Server-side sessions with memory & database stores |
| **Hashing** | `svelar/hashing` | scrypt (zero-dep), bcrypt, argon2 |
| **Validation** | `svelar/validation` | Zod-based validation with Laravel-style rule helpers |
| **Cache** | `svelar/cache` | Memory & file cache with remember pattern |
| **Queue** | `svelar/queue` | Job dispatching with sync & memory drivers |
| **Events** | `svelar/events` | Typed event dispatcher with subscribers |
| **Mail** | `svelar/mail` | SMTP, log, null transports with Mailable classes |
| **Notifications** | `svelar/notifications` | Multi-channel notifications (mail, database) |
| **Broadcasting** | `svelar/broadcasting` | Server-Sent Events for real-time |
| **Storage** | `svelar/storage` | Filesystem abstraction with local disk |
| **Logging** | `svelar/logging` | Console, file, stack channels |
| **Errors** | `svelar/errors` | HTTP error hierarchy, error handler |
| **Config** | `svelar/config` | Dot-notation config with env() helper |
| **Hooks** | `svelar/hooks` | SvelteKit hooks integration |

## Usage

### Bootstrap (`src/hooks.server.ts`)

```ts
import { createSvelarHooks } from 'svelar/hooks';
import { CorsMiddleware } from 'svelar/middleware';
import { SessionMiddleware, MemorySessionStore } from 'svelar/session';

export const handle = createSvelarHooks({
  providers: [],
  middleware: [
    new CorsMiddleware(),
    new SessionMiddleware({ store: new MemorySessionStore() }),
  ],
});
```

### Models

```ts
import { Model } from 'svelar/orm';

class User extends Model {
  static table = 'users';
  static fillable = ['name', 'email', 'password'];
  static hidden = ['password'];
  static casts = { created_at: 'date' };

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

// Query
const users = await User.where('active', true).with('posts').orderBy('name').get();
const user = await User.find(1);
```

### Controllers

```ts
import { Controller } from 'svelar/routing';
import { z } from 'svelar/validation';

class UserController extends Controller {
  async index(event) {
    const users = await User.all();
    return this.json(users);
  }

  async store(event) {
    const data = await this.validate(event, z.object({
      name: z.string().min(2),
      email: z.string().email(),
    }));
    const user = await User.create(data);
    return this.created(user);
  }
}
```

### CLI

```bash
npx svelar make:model Post -m -c     # model + migration + controller
npx svelar make:middleware Auth
npx svelar migrate                     # run migrations
npx svelar migrate:rollback
npx svelar tinker                      # interactive REPL
```

## Database Support

Install the driver for your database:

```bash
# SQLite (recommended for development)
npm install better-sqlite3

# PostgreSQL
npm install postgres

# MySQL
npm install mysql2
```

## Requirements

- Node.js >= 20
- SvelteKit >= 2.0

## License

MIT
