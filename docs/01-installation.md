# Installation

Get a new Svelar project up and running in minutes.

## System Requirements

- **Node.js**: 20.0.0 or higher
- **npm**: 10.0.0 or higher (or pnpm, yarn)
- **TypeScript**: 5.0 or higher (included automatically)

## Creating a New Project

The easiest way to scaffold a new Svelar application is with `create-svelar`:

```bash
npx create-svelar my-app
cd my-app
npm install
npm run dev
```

This creates a fully configured SvelteKit project with Svelar, a sample database schema, and example controllers.

### What's Included

The scaffolded project includes:

- **SvelteKit 2** - Latest version with Vite
- **TypeScript** - Full type safety
- **Svelar Framework** - All core modules (ORM, Auth, Middleware, etc.)
- **SQLite Database** - Pre-configured, zero setup
- **Example App** - Controllers, models, migrations, seeders
- **Environment Config** - `.env.example` file with sensible defaults

## Manual Setup

If you prefer to set up Svelar manually, start with a basic SvelteKit project:

```bash
npm create svelte@latest my-app
cd my-app
npm install
```

Then install Svelar:

```bash
npm install svelar
```

### Bootstrap Configuration

Create `src/app.ts` to configure database, hashing, and auth:

```typescript
// src/app.ts
import { Connection } from 'svelar/database';
import { Hash } from 'svelar/hashing';
import { AuthManager } from 'svelar/auth';
import { User } from './lib/models/User.js';

// Configure Database
Connection.configure({
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      filename: process.env.DB_PATH ?? 'database.db',
    },
  },
});

// Configure Hashing
Hash.configure({
  driver: 'scrypt', // 'bcrypt', 'argon2'
});

// Configure Auth
export const auth = new AuthManager({
  guard: 'session', // 'jwt', 'api'
  model: User,
});

export { Connection, Hash };
```

### Middleware Setup

Create `src/hooks.server.ts` to set up the middleware pipeline. The simplest setup uses `createSvelarApp`, which auto-wires origin validation, rate limiting, CSRF, sessions, auth, and error handling:

```typescript
// src/hooks.server.ts
import { createSvelarApp } from 'svelar/hooks';
import { auth } from './app.js';

export const { handle, handleError } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY || 'dev-secret',
});
```

To add i18n, pass the paraglide middleware:

```typescript
// src/hooks.server.ts
import { createSvelarApp } from 'svelar/hooks';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getTextDirection } from '$lib/paraglide/runtime';
import { auth } from './app.js';

export const { handle, handleError } = createSvelarApp({
  auth,
  i18n: { paraglideMiddleware, getTextDirection },
});
```

For full manual control, see [Middleware](./07-middleware.md).

### Create Your First Model

Create `src/lib/models/User.ts`:

```typescript
// src/lib/models/User.ts
import { Model } from 'svelar/orm';

export class User extends Model {
  static table = 'users';
  static timestamps = true;
  static fillable = ['name', 'email', 'password'];
  static hidden = ['password'];

  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare created_at: Date;
  declare updated_at: Date;
}
```

### Create Your First Migration

Create `src/lib/database/migrations/20260325000001_create_users_table.ts`:

```typescript
// src/lib/database/migrations/20260325000001_create_users_table.ts
import { Migration } from 'svelar/database';

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

### Run Migrations

```bash
npx svelar migrate
```

You're all set! Your Svelar app is ready to use.

## Database Configuration

### SQLite (Default)

SQLite requires no external setup and is great for development:

```typescript
// src/app.ts
Connection.configure({
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      filename: process.env.DB_PATH ?? 'database.db',
    },
  },
});
```

### PostgreSQL

```typescript
Connection.configure({
  default: 'pgsql',
  connections: {
    pgsql: {
      driver: 'postgresql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'svelar',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    },
  },
});
```

### MySQL

```typescript
Connection.configure({
  default: 'mysql',
  connections: {
    mysql: {
      driver: 'mysql2',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      database: process.env.DB_NAME || 'svelar',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
    },
  },
});
```

## Environment Variables

Create a `.env` file in your project root:

```bash
# Database
DB_PATH=database.db                    # SQLite only
DB_HOST=localhost                      # PostgreSQL/MySQL
DB_PORT=5432                           # PostgreSQL/MySQL
DB_NAME=svelar_db                      # PostgreSQL/MySQL
DB_USER=postgres                       # PostgreSQL/MySQL
DB_PASSWORD=password                   # PostgreSQL/MySQL

# App Security
APP_KEY=your-random-secret-key         # Used for sessions
JWT_SECRET=your-jwt-secret-key         # Used for JWT tokens

# Mail (Optional)
MAIL_DRIVER=log                        # 'smtp', 'log'
MAIL_FROM=hello@example.com

# Storage (Optional)
STORAGE_DISK=local
```

## Verify Installation

Test that everything is working:

```bash
# Run migrations
npx svelar migrate

# Seed demo data (if you have a DatabaseSeeder)
npx svelar seed:run

# Start dev server
npm run dev
```

Visit `http://localhost:5173` in your browser. You should see the SvelteKit welcome page.

## Project Structure Overview

```
my-app/
├── config/                      # Configuration files
│   ├── app.ts
│   ├── database.ts
│   ├── auth.ts
│   ├── mail.ts
│   └── queue.ts
├── src/
│   ├── app.ts                    # Bootstrap configuration
│   ├── hooks.server.ts           # Middleware pipeline
│   ├── lib/
│   │   ├── controllers/          # Request handlers
│   │   ├── models/               # ORM models
│   │   ├── services/             # Business logic
│   │   ├── repositories/         # Data access
│   │   ├── dtos/                 # Validation classes
│   │   ├── actions/              # Single-use cases
│   │   ├── middleware/           # Custom middleware
│   │   ├── channels/            # Broadcast channel authorization
│   │   ├── commands/            # Custom CLI commands
│   │   ├── plugins/             # Custom plugins
│   │   ├── scheduler/           # Scheduled tasks
│   │   ├── database/
│   │   │   ├── migrations/
│   │   │   └── seeders/
│   │   └── jobs/                # Queue jobs
│   └── routes/                   # SvelteKit routes
│       ├── +layout.svelte
│       ├── +page.svelte
│       └── api/
├── package.json
├── svelte.config.js
├── vite.config.ts
└── .env
```

## Available Commands

After installation, you have access to Svelar CLI commands:

```bash
# Migrations
npx svelar migrate                # Run pending migrations
npx svelar migrate --rollback     # Rollback last migration batch
npx svelar migrate --reset        # Rollback ALL migrations
npx svelar migrate --refresh      # Reset + re-run all migrations
npx svelar migrate --fresh        # Drop all tables + re-run all migrations
npx svelar migrate --status       # Show migration status table
npx svelar migrate --seed         # Run seeders after migrating
npx svelar migrate --fresh --force # Force destructive command in production

# Seeding
npx svelar seed:run               # Run database seeders

# Code Generation
npx svelar make:model Name        # Create new model
npx svelar make:migration Name    # Create new migration
npx svelar make:controller Name   # Create new controller
npx svelar make:middleware Name   # Create new middleware
npx svelar make:seeder Name       # Create new seeder
npx svelar make:provider Name     # Create new service provider
npx svelar make:service Name      # Create new service (--crud for CrudService)
npx svelar make:repository Name   # Create new repository (--model=ModelName)
npx svelar make:action Name       # Create new action
npx svelar make:request Name      # Create new FormRequest DTO
npx svelar make:plugin Name       # Create new plugin
npx svelar make:task Name         # Create new scheduled task
npx svelar make:job Name          # Create new queue job
npx svelar make:command Name      # Create new custom CLI command
npx svelar make:config Name       # Create new config file (presets: app, database, auth, mail, etc.)
npx svelar make:channel Name      # Create new broadcast channel authorization (-p for presence)
npx svelar make:broadcasting      # Scaffold broadcasting routes, client init, and config
npx svelar make:docker            # Scaffold Docker deployment files (Dockerfile, compose, PM2)

# Scheduler & Queue
npx svelar schedule:run           # Run the scheduler (checks every 60s)
npx svelar schedule:run --once    # Run due tasks once and exit (for cron)
npx svelar queue:work             # Process queued jobs
npx svelar queue:work --queue=urgent   # Process a specific queue
npx svelar queue:work --max-jobs=100   # Stop after N jobs
npx svelar queue:work --max-time=3600  # Stop after N seconds
npx svelar queue:work --sleep=2000     # Polling interval in ms
npx svelar queue:work --once           # Process one job and exit

# Utilities
npx svelar tinker                 # Interactive REPL for your app

# Dev Server (SvelteKit)
npm run dev                        # Start dev server
npm run build                      # Build for production
npm run preview                    # Preview production build
```

> **Production safety**: Destructive migration commands (`--reset`, `--refresh`, `--fresh`) are blocked in production unless you pass `--force`. Svelar checks `NODE_ENV` and `APP_ENV` environment variables to detect the production environment.

## Docker Deployment

Svelar includes built-in Docker support for production deployments. Generate all the necessary files with a single command:

```bash
npx svelar make:docker
```

By default this includes Soketi (WebSocket) and Gotenberg (PDF generation). This creates four files:

- **Dockerfile** — Multi-stage build (Node 20 Alpine). Stage 1 installs deps and builds the SvelteKit app; stage 2 copies the production build and runs it with PM2.
- **docker-compose.yml** — Orchestrates the app, PostgreSQL (default), Soketi (WebSocket server), and Gotenberg (PDF engine). All services include health checks and named volumes.
- **ecosystem.config.cjs** — PM2 process config that runs three processes: the SvelteKit web server (clustered across all CPU cores), queue workers, and the scheduler.
- **.dockerignore** — Excludes `node_modules`, `.env`, build artifacts, and database files from the Docker context.

### Flags

```bash
npx svelar make:docker --db=mysql      # Use MySQL instead of PostgreSQL
npx svelar make:docker --db=sqlite     # SQLite (no external DB service)
npx svelar make:docker --redis         # Add Redis service
npx svelar make:docker --no-soketi     # Skip Soketi WebSocket server
npx svelar make:docker --no-gotenberg  # Skip Gotenberg PDF service
npx svelar make:docker --force         # Overwrite existing files
```

### Quick Start

```bash
# Generate Docker files
npx svelar make:docker

# Build and start all services
docker compose up -d --build

# Run migrations
docker compose exec app npx svelar migrate

# Seed demo data
docker compose exec app npx svelar seed:run

# View logs
docker compose logs -f app

# Stop everything
docker compose down
```

### PM2 Process Management

The `ecosystem.config.cjs` runs three processes inside the container:

| Process   | Description                        | Instances     |
|-----------|-------------------------------------|---------------|
| web       | SvelteKit production server         | All CPU cores |
| worker    | Queue job processor                 | 2             |
| scheduler | Scheduled task runner               | 1 (always)    |

The web process uses PM2's cluster mode for zero-downtime restarts and automatic load balancing. Workers auto-restart after `--max-time=3600` (1 hour) to prevent memory leaks. The scheduler always runs as a single instance to prevent duplicate task execution.

### Soketi (WebSocket Server)

The generated `docker-compose.yml` includes Soketi — a self-hosted, Pusher-compatible WebSocket server. It connects automatically to your Svelar app via the `PUSHER_HOST=soketi` environment variable. Configure your broadcasting to use the Pusher driver and point it at Soketi:

```typescript
// config/broadcasting.ts
export default {
  default: 'pusher',
  drivers: {
    pusher: {
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      appId: process.env.PUSHER_APP_ID,
      host: process.env.PUSHER_HOST,   // 'soketi' in Docker
      port: Number(process.env.PUSHER_PORT ?? 6001),
      useTLS: false,
    },
  },
};
```

### Production Checklist

Before deploying to production:

1. Set strong values for `APP_KEY`, `JWT_SECRET`, `DB_PASSWORD`, and Pusher credentials in `.env`
2. Set `NODE_ENV=production` and `APP_ENV=production`
3. Use named Docker volumes for database persistence (`pgdata`, `mysqldata`)
4. Configure log rotation for PM2 logs in `storage/logs/`
5. Set up a reverse proxy (Nginx, Traefik, Caddy) in front of the app for TLS termination
6. Run `docker compose exec app npx svelar migrate` after every deployment

## Troubleshooting

### "Cannot find module 'svelar'"

Make sure you've installed Svelar:

```bash
npm install svelar
```

### Database file not found

Check that `DB_PATH` is set correctly in your `.env` file. The default is `database.db` in your project root.

### Migrations not running

Ensure `src/app.ts` is imported in `src/hooks.server.ts` to initialize the database connection:

```typescript
// src/hooks.server.ts
import { auth } from './app.js'; // This triggers app.ts
```

### TypeScript errors with models

Make sure you have `skipLibCheck: true` in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "skipLibCheck": true
  }
}
```

## Next Steps

- Read the [Database](./02-database.md) guide to learn about migrations and seeders
- Explore [Models & ORM](./03-models-orm.md) to build your data layer
- Check [Controllers & Routing](./04-controllers-routing.md) to handle requests
- Learn [Authentication](./06-authentication.md) for user management

---

**Svelar Installation Guide** © 2026
