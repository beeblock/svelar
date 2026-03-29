# Installation

Get a new Svelar project up and running in minutes.

## System Requirements

- **Node.js**: 20.0.0 or higher
- **npm**: 10.0.0 or higher (or pnpm, yarn)
- **Docker**: Recommended for production (optional for development)

## Creating a New Project

```bash
npx @beeblock/svelar new my-app
cd my-app
npm run dev
```

That's it. The CLI scaffolds a complete SvelteKit + Svelar project, installs dependencies, and you're ready to go.

### What's Scaffolded

- **SvelteKit 2** with Vite and TypeScript
- **Tailwind CSS 4** with theme variables (`--color-brand`, etc.)
- **Svelar Framework** — ORM, Auth, Sessions, Middleware, Queue, Scheduler, and 35+ modules
- **SQLite Database** — Pre-configured, zero setup
- **Icon Libraries** — `lucide-svelte` and `@tabler/icons-svelte` included
- **Environment Config** — `.env.example` with sensible defaults
- **Vite Config** — All `@beeblock/svelar/*` aliases, SSR config, and `fs.allow` pre-wired
- **EventServiceProvider** — Pre-wired for event listeners, subscribers, and model observers
- **Application Bootstrap** — `app.ts` bootstraps the service provider lifecycle

### Project Structure (DDD Modular Monolith)

```
my-app/
├── src/
│   ├── app.ts                    # Bootstrap (database, hashing, providers)
│   ├── app.css                   # Tailwind CSS + theme
│   ├── app.html                  # SvelteKit shell
│   ├── hooks.server.ts           # Middleware pipeline
│   ├── lib/
│   │   ├── modules/              # Domain modules (DDD)
│   │   │   ├── auth/             #   User.ts, UserObserver.ts, AuthController.ts, AuthService.ts
│   │   │   ├── billing/          #   Invoice.ts, BillingService.ts, billing.schema.ts
│   │   │   └── posts/            #   Post.ts, PostController.ts, PostService.ts
│   │   ├── shared/               # Cross-cutting concerns
│   │   │   ├── middleware/       #   Custom middleware
│   │   │   ├── components/       #   Shared Svelte components
│   │   │   ├── stores/           #   Svelte stores
│   │   │   ├── jobs/             #   Queue jobs
│   │   │   ├── plugins/          #   Custom plugins
│   │   │   ├── channels/         #   Broadcast channels
│   │   │   ├── commands/         #   Custom CLI commands
│   │   │   ├── providers/        #   Service providers (EventServiceProvider, etc.)
│   │   │   └── scheduler/        #   Scheduled tasks
│   │   ├── events/               # Event classes (npx svelar make:event)
│   │   ├── listeners/            # Listener classes (npx svelar make:listener)
│   │   └── database/
│   │       ├── migrations/
│   │       └── seeders/
│   └── routes/
│       ├── +layout.svelte
│       ├── +page.svelte
│       └── api/
├── storage/
│   ├── logs/                     # Application logs
│   ├── cache/                    # File-based cache
│   ├── uploads/                  # User uploads
│   └── sessions/                 # File-based sessions
├── static/
├── vite.config.ts
├── svelte.config.js
├── svelar.database.json
├── .env.example
└── package.json
```

Each **module** is a self-contained domain — its model, controller, service, repository, observers, DTOs, and schema all live together. The `shared/` folder holds cross-cutting infrastructure. The `events/` and `listeners/` folders hold application-wide event classes and their handlers.

## Step 1: Environment Variables

Copy the example env file and configure it:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# App Security — generate a random string for production
APP_KEY=change-me-to-a-random-string

# Database (SQLite by default, no extra config needed)
DB_DRIVER=sqlite
DB_PATH=database.db

# PostgreSQL (uncomment to switch)
# DB_DRIVER=postgresql
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=svelar_db
# DB_USER=postgres
# DB_PASSWORD=secret

# MySQL (uncomment to switch)
# DB_DRIVER=mysql2
# DB_HOST=localhost
# DB_PORT=3306
# DB_NAME=svelar_db
# DB_USER=root
# DB_PASSWORD=secret

# JWT (if using JWT auth)
# JWT_SECRET=your-jwt-secret-key

# Mail (optional)
# MAIL_DRIVER=log
# MAIL_FROM=hello@example.com

# Redis (optional — needed for BullMQ queue and Redis cache/session)
# REDIS_URL=redis://localhost:6379

# Broadcasting (optional — Pusher/Soketi WebSocket)
# PUSHER_KEY=app-key
# PUSHER_SECRET=app-secret
# PUSHER_APP_ID=app-id
# PUSHER_HOST=localhost
# PUSHER_PORT=6001
```

## Step 2: Create Your First Model & Migration

```bash
npx @beeblock/svelar make:model User
npx @beeblock/svelar make:migration CreateUsersTable
```

Edit the generated migration in `src/lib/database/migrations/`:

```typescript
import { Migration } from '@beeblock/svelar/database';

export default class CreateUsersTable extends Migration {
  async up() {
    await this.schema.createTable('users', (table) => {
      table.increments('id');
      table.string('name');
      table.string('email').unique();
      table.string('password');
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('users');
  }
}
```

## Step 3: Run Migrations

```bash
npx @beeblock/svelar migrate
```

Check migration status:

```bash
npx @beeblock/svelar migrate --status
```

## Step 4: Start Building

```bash
npm run dev
```

Visit `http://localhost:5173`. Your app is running.

## Docker Deployment

When you're ready for production, scaffold Docker files:

```bash
npx @beeblock/svelar make:docker
```

This generates:

| File | Description |
|------|-------------|
| `Dockerfile` | Multi-stage Node 20 Alpine build with PM2 |
| `docker-compose.yml` | App + PostgreSQL + Redis + Soketi + Gotenberg + RustFS |
| `ecosystem.config.cjs` | PM2 config: web (clustered), queue workers, scheduler |
| `.dockerignore` | Excludes node_modules, .env, build artifacts |

### Docker Flags

```bash
npx @beeblock/svelar make:docker --db=mysql       # MySQL instead of PostgreSQL
npx @beeblock/svelar make:docker --db=sqlite      # SQLite (no external DB)
npx @beeblock/svelar make:docker --no-redis       # Skip Redis
npx @beeblock/svelar make:docker --no-soketi      # Skip WebSocket server
npx @beeblock/svelar make:docker --no-gotenberg   # Skip PDF service
npx @beeblock/svelar make:docker --no-rustfs      # Skip object storage
npx @beeblock/svelar make:docker --force          # Overwrite existing files
```

### Quick Start

```bash
# Generate Docker files
npx @beeblock/svelar make:docker

# Build and start everything
docker compose up -d --build

# Run migrations inside the container
docker compose exec app npx @beeblock/svelar migrate

# Seed data
docker compose exec app npx @beeblock/svelar seed:run

# View logs
docker compose logs -f app

# Stop
docker compose down
```

### PM2 Processes

| Process | Description | Instances |
|---------|-------------|-----------|
| web | SvelteKit production server | All CPU cores |
| worker | Queue job processor | 2 |
| scheduler | Scheduled task runner | 1 |

## Manual Setup

If you prefer adding Svelar to an existing SvelteKit project:

```bash
npm install @beeblock/svelar
```

Then create `src/app.ts`:

```typescript
import { Connection } from '@beeblock/svelar/database';
import { Hash } from '@beeblock/svelar/hashing';

Connection.configure({
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      filename: process.env.DB_PATH ?? 'database.db',
    },
  },
});

Hash.configure({ driver: 'scrypt' });
```

And `src/hooks.server.ts`:

```typescript
import { createSvelarApp } from '@beeblock/svelar/hooks';
import { MemorySessionStore } from '@beeblock/svelar/session';
import './app.js';

export const { handle, handleError } = createSvelarApp({
  secret: process.env.APP_KEY || 'change-me',
  sessionStore: new MemorySessionStore(),
});
```

> **Note:** Manual setup requires configuring Vite aliases for `@beeblock/svelar/*` submodules. Use `npx @beeblock/svelar new` to see the full vite.config.ts as reference.

## CLI Commands

All commands available after installation:

```bash
# Project
npx @beeblock/svelar new <name>              # Scaffold new project

# Migrations
npx @beeblock/svelar migrate                 # Run pending migrations
npx @beeblock/svelar migrate --rollback      # Rollback last batch
npx @beeblock/svelar migrate --reset         # Rollback ALL
npx @beeblock/svelar migrate --refresh       # Reset + re-run all
npx @beeblock/svelar migrate --fresh         # Drop all tables + re-run
npx @beeblock/svelar migrate --status        # Show migration status
npx @beeblock/svelar migrate --seed          # Run seeders after migrating

# Seeding
npx @beeblock/svelar seed:run                # Run database seeders

# Code Generation — Domain (goes into src/lib/modules/<module>/)
npx @beeblock/svelar make:model User --module=auth        # Model
npx @beeblock/svelar make:controller User --module=auth   # Controller
npx @beeblock/svelar make:service Billing --module=billing # Service (--crud)
npx @beeblock/svelar make:repository User --module=auth   # Repository (--model=X)
npx @beeblock/svelar make:action CreateUser --module=auth  # Action
npx @beeblock/svelar make:request StoreUser --module=auth  # FormRequest DTO
npx @beeblock/svelar make:resource User --module=auth     # API Resource (response)
npx @beeblock/svelar make:schema User --module=auth       # Contract schema (Zod + shared types)
npx @beeblock/svelar make:observer UserObserver --model=User --module=auth  # Model Observer

# Code Generation — Routes
npx @beeblock/svelar make:route posts --api --resource -c PostController    # CRUD routes
npx @beeblock/svelar make:route admin/settings --api -m GET,PUT             # Custom methods
npx @beeblock/svelar routes:list                           # Show all routes
npx @beeblock/svelar routes:list --api                     # API routes only
npx @beeblock/svelar routes:list --method POST             # Filter by method

# Code Generation — Events (goes into src/lib/events/ and src/lib/listeners/)
npx @beeblock/svelar make:event UserRegistered             # Event class
npx @beeblock/svelar make:listener SendWelcomeEmail --event=UserRegistered  # Listener class

# Code Generation — Shared (goes into src/lib/shared/<type>/)
npx @beeblock/svelar make:middleware RateLimit  # Middleware
npx @beeblock/svelar make:job SendWelcomeEmail  # Queue job
npx @beeblock/svelar make:task CleanupExpired   # Scheduled task
npx @beeblock/svelar make:command SyncUsers     # Custom CLI command
npx @beeblock/svelar make:plugin Stripe         # Plugin class
npx @beeblock/svelar make:provider App          # Service provider
npx @beeblock/svelar make:channel Order         # Broadcast channel (-p for presence)

# Code Generation — Database (goes into src/lib/database/)
npx @beeblock/svelar make:migration <Name>   # Migration file
npx @beeblock/svelar make:seeder <Name>      # Seeder class
npx @beeblock/svelar make:config <Name>      # Config file

# Scaffolding
npx @beeblock/svelar make:docker             # Docker deployment files
npx @beeblock/svelar make:broadcasting       # Broadcasting routes + client
npx @beeblock/svelar make:dashboard          # Admin dashboard routes

# Plugins
npx @beeblock/svelar plugin:list             # List plugins
npx @beeblock/svelar plugin:publish <name>   # Publish plugin config/migrations
npx @beeblock/svelar plugin:install <pkg>    # Install plugin from npm

# Runtime
npx @beeblock/svelar schedule:run            # Run scheduler
npx @beeblock/svelar queue:work              # Process queued jobs
npx @beeblock/svelar tinker                  # Interactive REPL
```

> **Production safety**: Destructive migration commands (`--reset`, `--refresh`, `--fresh`) are blocked in production unless you pass `--force`.

## Troubleshooting

### "Cannot find module '@beeblock/svelar'"

```bash
npm install @beeblock/svelar
```

### Database file not found

Check `DB_PATH` in your `.env`. Default is `database.db` in project root.

### Migrations not running

Make sure `src/app.ts` is imported in `src/hooks.server.ts`:

```typescript
import './app.js'; // Triggers database configuration
```

### TypeScript errors with models

Add `skipLibCheck: true` to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "skipLibCheck": true
  }
}
```

## Next Steps

- [Database](./02-database.md) — Migrations, seeders, multiple drivers
- [Models & ORM](./03-models-orm.md) — Eloquent-style queries, relationships
- [Controllers & Routing](./04-controllers-routing.md) — Request handling
- [Authentication](./06-authentication.md) — Sessions, JWT, API tokens
- [Middleware](./07-middleware.md) — CORS, CSRF, rate limiting, custom middleware
