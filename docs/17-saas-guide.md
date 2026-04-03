# Building SaaS with Svelar

A complete guide to building production SaaS applications with Svelar. Covers what you get out of the box, how to extend it, multi-tenancy, billing, deployment, and scaling.

## What You Get

Running `npx svelar new my-saas` scaffolds a fully working SaaS application:

```bash
npx svelar new my-saas
cd my-saas
npm run dev
```

The `new` command generates `.env` with secure random `APP_KEY` and `INTERNAL_SECRET`, installs dependencies, runs all migrations, and seeds the database automatically. You get:

### Authentication (ready to use)
- `/register` — Account creation with form validation (superforms + Zod)
- `/login` — Session-based login with CSRF protection
- `/logout` — Session invalidation and redirect
- API endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `DatabaseSessionStore` for persistent sessions across restarts
- Gates for authorization (`admin-access`, `edit-post`, `delete-post`, `manage-users`)

### User Dashboard
- `/dashboard` — Stats overview (API keys, teams, account role)
- `/dashboard/api-keys` — Create, list, copy, and revoke API keys
- `/dashboard/team` — Team management with invitations, role assignment, member removal
- `/dashboard/billing` — Subscription management, cancel/resume, payment method (Stripe Portal), invoice history
- Auth guard — unauthenticated users redirected to `/login`

### Admin Panel
- `/admin` — User management with inline role changes, user deletion
- Billing tab — list all subscriptions, cancel, issue refunds
- Roles and permissions display with seeded data
- Admin guard — non-admin users redirected to `/dashboard`
- Admin API routes for full CRUD on users, roles, permissions, role-permissions, user-roles, user-permissions, billing
- Run `npx svelar make:dashboard` for the full monitoring UI (queue, scheduler, logs, system health)

### API Routes (16 endpoints)
- Auth: register, login, logout, me
- Posts: list + create, single CRUD (GET/PUT/DELETE), my posts
- Admin: users, roles, permissions, role-permissions, user-roles, user-permissions
- Health check: `GET /api/health`
- Broadcasting: SSE channel subscription
- Internal broadcast bridge (scheduler <-> web server)

### Background Processing
- 3 jobs: `SendWelcomeEmail`, `DailyDigestJob`, `ExportDataJob`
- 5 scheduled tasks: `CleanupExpiredTokens`, `CleanExpiredSessions`, `DailyDigestEmail`, `PruneAuditLogs`, `QueueHealthCheck`
- Run scheduler: `npx svelar schedule:run`

### Domain Layer (DDD)
- Models: `User` (with `HasRoles` mixin), `Post`
- Repositories: `UserRepository`, `PostRepository`
- Services: `AuthService`, `PostService`
- Controllers: `AuthController`, `PostController`, `AdminController`
- DTOs: `RegisterRequest`, `LoginRequest`, `CreatePostRequest`, `UpdatePostRequest`
- Actions: `RegisterUserAction`, `CreatePostAction`
- Schemas: `auth.ts`, `post.ts` (Zod validation)

### Stripe Billing (opt-in)
- Install `stripe`, uncomment `Stripe.configure()` in `app.ts`, add env vars
- Subscriptions, checkout sessions, customer portal, invoices, refunds
- Webhook handler at `/api/webhooks/stripe` with signature verification
- See [Stripe Billing](./32-stripe.md) for the full setup guide

### Database
- 12 migrations: users, posts, permissions, role column, sessions, audit logs, notifications, failed jobs, stripe customer ID, subscription plans, subscriptions, invoices
- `DatabaseSeeder` with admin user, demo user, roles, permissions, sample posts
- Default accounts: `admin@svelar.dev` / `admin123`, `demo@svelar.dev` / `password`

### Infrastructure
- Full `app.ts` bootstrap: Database, Hash, Auth, Queue, Audit, ApiKeys, Webhooks, Teams, Uploads, EmailTemplates, Broadcast, Dashboard, Stripe (commented out — uncomment to enable)
- Tailwind CSS v4 with brand theme tokens
- Auth-aware navigation layout
- Error page with status-specific messaging

## Project Structure

```
my-saas/
├── src/
│   ├── app.ts                              # Full service bootstrap
│   ├── app.css                             # Tailwind v4 + @theme
│   ├── hooks.server.ts                     # Middleware pipeline
│   ├── lib/
│   │   ├── models/                         # User.ts, Post.ts
│   │   ├── repositories/                   # UserRepository.ts, PostRepository.ts
│   │   ├── services/                       # AuthService.ts, PostService.ts
│   │   ├── controllers/                    # AuthController.ts, PostController.ts, AdminController.ts
│   │   ├── dtos/                           # RegisterRequest.ts, LoginRequest.ts, etc.
│   │   ├── actions/                        # RegisterUserAction.ts, CreatePostAction.ts
│   │   ├── auth/                           # gates.ts
│   │   ├── schemas/                        # auth.ts, post.ts (Zod)
│   │   ├── jobs/                           # SendWelcomeEmail.ts, DailyDigestJob.ts, ExportDataJob.ts
│   │   ├── scheduler/                      # CleanupExpiredTokens.ts, DailyDigestEmail.ts, etc.
│   │   ├── database/
│   │   │   ├── migrations/                 # 12 migration files
│   │   │   └── seeders/                    # DatabaseSeeder.ts
│   │   └── shared/
│   │       └── providers/                  # EventServiceProvider.ts
│   └── routes/
│       ├── +layout.svelte                  # Auth-aware nav
│       ├── +layout.server.ts               # Pass user to layout
│       ├── +error.svelte                   # Error page
│       ├── +page.svelte                    # Landing page
│       ├── login/                          # Login page
│       ├── register/                       # Registration page
│       ├── logout/                         # Logout action
│       ├── dashboard/                      # User dashboard
│       │   ├── api-keys/                   # API key management
│       │   ├── team/                       # Team management
│       │   └── billing/                    # Subscription & invoices
│       ├── admin/                          # Admin panel
│       └── api/
│           ├── health/                     # Health check
│           ├── auth/                       # Auth endpoints
│           ├── posts/                      # Posts CRUD
│           ├── broadcasting/[channel]/     # SSE
│           ├── internal/broadcast/         # Scheduler bridge
│           ├── webhooks/stripe/           # Stripe webhook
│           └── admin/                      # Admin API (users, roles, permissions, billing)
├── storage/                                # logs, cache, uploads, sessions
├── .env.example
├── svelar.database.json
└── vite.config.ts
```

## Extending the Scaffold

### Adding a New Domain Module

Follow the DDD pattern established by the scaffold:

```bash
# Generate the files
npx svelar make:model Invoice
npx svelar make:migration create_invoices_table
npx svelar make:controller InvoiceController
npx svelar make:job ProcessInvoiceJob
```

Then wire it up:

```typescript
// src/lib/models/Invoice.ts
import { Model } from '@beeblock/svelar/orm';

export class Invoice extends Model {
  static table = 'invoices';
  static timestamps = true;
  static fillable = ['user_id', 'amount', 'status', 'due_date'];

  declare id: number;
  declare user_id: number;
  declare amount: number;
  declare status: 'pending' | 'paid' | 'overdue';
  declare due_date: Date;
  declare created_at: Date;
  declare updated_at: Date;

  user() {
    return this.belongsTo(User, 'user_id');
  }
}

import { User } from './User.ts';
```

```typescript
// src/lib/services/InvoiceService.ts
import { CrudService } from '@beeblock/svelar/services';
import { Repository } from '@beeblock/svelar/repositories';
import { Invoice } from '../models/Invoice.js';

class InvoiceRepository extends Repository<Invoice> {
  model() { return Invoice; }

  async findOverdue(): Promise<Invoice[]> {
    return this.query()
      .where('status', 'pending')
      .where('due_date', '<', new Date())
      .get();
  }
}

const repo = new InvoiceRepository();

export class InvoiceService extends CrudService<Invoice> {
  protected repository() { return repo; }

  async findOverdue() { return repo.findOverdue(); }
}
```

### Adding Scheduled Tasks

Create a new file in `src/lib/scheduler/` with a default export:

```typescript
// src/lib/scheduler/MarkOverdueInvoices.ts
import { ScheduledTask } from '@beeblock/svelar/scheduler';

export default class MarkOverdueInvoices extends ScheduledTask {
  name = 'mark-overdue-invoices';

  schedule() {
    return this.dailyAt('06:00');
  }

  async handle(): Promise<void> {
    const { InvoiceService } = await import('../services/InvoiceService.ts');
    const service = new InvoiceService();
    const overdue = await service.findOverdue();

    for (const invoice of overdue) {
      invoice.status = 'overdue';
      await invoice.save();
    }
  }
}
```

The scheduler auto-discovers all files in `src/lib/scheduler/`. Run it with:

```bash
npx svelar schedule:run
```

See [Scheduler](./10-scheduler.md) for all scheduling expressions (`everyMinute()`, `hourly()`, `weekly()`, `cron()`, etc.).

### Adding Background Jobs

```typescript
// src/lib/jobs/ProcessInvoiceJob.ts
import { Job } from '@beeblock/svelar/queue';

export class ProcessInvoiceJob extends Job {
  maxAttempts = 3;
  retryDelay = 60;

  constructor(private invoiceId: number) {
    super();
  }

  async handle(): Promise<void> {
    const { Invoice } = await import('../models/Invoice.ts');
    const invoice = await Invoice.find(this.invoiceId);
    if (!invoice) return;

    // Process payment, send receipt, etc.
    invoice.status = 'paid';
    await invoice.save();
  }

  failed(error: Error): void {
    console.error(`Failed to process invoice #${this.invoiceId}:`, error.message);
  }

  serialize() { return { invoiceId: this.invoiceId }; }
  static restore(data: Record<string, unknown>) {
    return new ProcessInvoiceJob(data.invoiceId as number);
  }
}
```

Register in `src/app.ts`:

```typescript
import { ProcessInvoiceJob } from './lib/jobs/ProcessInvoiceJob.js';
Queue.registerAll([SendWelcomeEmail, DailyDigestJob, ExportDataJob, ProcessInvoiceJob]);
```

Dispatch from anywhere:

```typescript
import { Queue } from '@beeblock/svelar/queue';
import { ProcessInvoiceJob } from '$lib/jobs/ProcessInvoiceJob.js';

await Queue.dispatch(new ProcessInvoiceJob(invoice.id));
```

See [Queue & Jobs](./11-queue-jobs.md) for queue drivers, workers, and monitoring.

### Adding API Routes

Follow the controller pattern from the scaffold:

```typescript
// src/lib/controllers/InvoiceController.ts
import { Controller } from '@beeblock/svelar/routing';
import { InvoiceService } from '../services/InvoiceService.js';

const invoiceService = new InvoiceService();

export class InvoiceController extends Controller {
  async index(event: any) {
    const userId = event.locals.user?.id;
    if (!userId) return this.json({ message: 'Unauthenticated' }, 401);

    const invoices = await invoiceService.findAll();
    return this.json(invoices);
  }

  async store(event: any) {
    // validate, create, return
  }
}
```

```typescript
// src/routes/api/invoices/+server.ts
import { InvoiceController } from '$lib/controllers/InvoiceController.js';

const ctrl = new InvoiceController();
export const GET = ctrl.handle('index');
export const POST = ctrl.handle('store');
```

### Adding Events & Listeners

Wire up cross-module communication in `EventServiceProvider`:

```typescript
// src/lib/shared/providers/EventServiceProvider.ts
import { EventServiceProvider as BaseProvider } from '@beeblock/svelar/events';

export class EventServiceProvider extends BaseProvider {
  protected listen = {
    'invoice:paid': [SendInvoiceReceipt, UpdateAccountBalance],
    'user:registered': [SendWelcomeEmailListener],
  };

  protected observers = {};
  protected subscribe = [];
}
```

Emit events from services:

```typescript
// Inside a service method
await this.emit({ type: 'invoice:paid', invoice });
```

See [Additional Features](./12-additional-features.md) for the full event system.

## Multi-Tenancy with Teams

Svelar's built-in Teams system handles multi-tenancy. It's configured out of the box in `app.ts`:

```typescript
import { Teams } from '@beeblock/svelar/teams';
Teams.configure({ driver: 'memory' });
```

### Team Operations

```typescript
import { Teams } from '@beeblock/svelar/teams';

// Create a team
const team = await Teams.create({
  name: "Acme Corp",
  ownerId: user.id,
  personalTeam: false,
});

// Invite members
await Teams.invite(team.id, 'colleague@example.com', 'admin');

// Get team members
const members = await Teams.getMembers(team.id);

// Update member role
await Teams.updateMemberRole(team.id, memberId, 'admin');

// Remove member
await Teams.removeMember(team.id, memberId);

// Get user's teams
const teams = await Teams.getUserTeams(user.id);
```

### Team-Scoped Queries

Filter data by team in your repositories:

```typescript
export class ProjectRepository extends Repository<Project> {
  model() { return Project; }

  async findByTeam(teamId: string): Promise<Project[]> {
    return this.query().where('team_id', teamId).orderBy('created_at', 'desc').get();
  }
}
```

The dashboard team page at `/dashboard/team` provides a complete UI for team management, invitations, and member roles.

## API Keys

API keys are configured in `app.ts` and managed via the `/dashboard/api-keys` page:

```typescript
import { ApiKeys } from '@beeblock/svelar/api-keys';
ApiKeys.configure({ driver: 'memory', prefix: 'sk_' });
```

### Programmatic Usage

```typescript
import { ApiKeys } from '@beeblock/svelar/api-keys';

// Create a key
const { plainTextKey, record } = await ApiKeys.create({
  name: 'Production Key',
  userId: user.id,
  permissions: ['read', 'write'],
});

// List user's keys
const keys = await ApiKeys.listForUser(user.id);

// Revoke a key
await ApiKeys.revoke(keyId);
```

Users authenticate API requests with:
```
Authorization: Bearer sk_your_key_here
```

## Permissions & Roles

The scaffold includes a full Spatie-inspired permission system with seeded roles (`admin`, `editor`, `user`) and permissions (`manage-users`, `manage-roles`, `manage-posts`, `create-posts`, `view-dashboard`, `view-admin`).

### Using Permissions

```typescript
import { Permissions } from '@beeblock/svelar/permissions';

// Create roles and permissions
const role = await Permissions.createRole({ name: 'editor', description: 'Can manage posts' });
const perm = await Permissions.createPermission({ name: 'publish-posts' });

// Assign permissions to roles
await Permissions.giveRolePermission(role.id, perm.id);

// Assign roles to users
await Permissions.assignRole('User', user.id, role.id);

// Check permissions on User model (HasRoles mixin)
const user = await User.find(userId);
await user.hasRole('admin');        // true/false
await user.hasPermission('manage-users');  // true/false
await user.can('manage-users');     // alias for hasPermission
```

### Authorization Gates

Gates defined in `src/lib/auth/gates.ts` provide inline authorization:

```typescript
import { Gate } from '@beeblock/svelar/auth';

Gate.define('admin-access', (user) => user?.role === 'admin');
Gate.define('edit-post', (user, post) => {
  if (!user) return false;
  return user.id === post.user_id || user.role === 'admin';
});

// Super user bypass — admins pass all gates
Gate.defineSuperUser((user) => user?.role === 'admin');
```

### Admin API Routes

The scaffold includes 6 admin API routes for managing the permission system:

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/admin/users` | GET, PUT, DELETE | List, update role, delete users |
| `/api/admin/roles` | POST, DELETE | Create, delete roles |
| `/api/admin/permissions` | POST, DELETE | Create, delete permissions |
| `/api/admin/role-permissions` | POST, DELETE | Attach/detach permissions from roles |
| `/api/admin/user-roles` | POST, DELETE | Assign/remove roles from users |
| `/api/admin/user-permissions` | POST, DELETE | Grant/revoke direct user permissions |

All admin routes require `role === 'admin'`.

## Broadcasting & Real-Time Updates

SSE-based broadcasting is configured out of the box:

```typescript
import { Broadcast } from '@beeblock/svelar/broadcasting';

Broadcast.configure({
  default: 'sse',
  drivers: { sse: { driver: 'sse' } },
});
```

### Server-Side Broadcasting

```typescript
// Send events to connected clients
await Broadcast.to('notifications').send('toast', {
  variant: 'success',
  title: 'Invoice paid',
  description: 'Invoice #1234 has been processed',
});
```

### Client-Side Subscription

```typescript
import { useSSE } from '@beeblock/svelar/broadcasting/client';

const channel = useSSE('notifications');
channel.listen('toast', (data) => {
  // Show toast notification
});

// Cleanup
channel.close();
```

### Scheduler HTTP Bridge

The scheduler runs in a separate process and can't access in-memory SSE channels. It uses the internal HTTP bridge at `/api/internal/broadcast`:

```typescript
// From a scheduled task
const res = await fetch('http://localhost:5173/api/internal/broadcast', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Secret': process.env.INTERNAL_SECRET!,
  },
  body: JSON.stringify({ channel: 'notifications', eventName: 'toast', data: { title: 'Update' } }),
});
```

CSRF is excluded for `/api/internal/` paths.

## Webhooks

Send and receive webhooks:

```typescript
import { Webhooks } from '@beeblock/svelar/webhooks';

Webhooks.configure({ driver: 'memory', maxAttempts: 5 });

// Register a webhook endpoint
await Webhooks.create({
  url: 'https://example.com/webhook',
  events: ['invoice.paid', 'user.created'],
  secret: 'whsec_...',
});

// Dispatch a webhook event
await Webhooks.dispatch('invoice.paid', { invoiceId: 123, amount: 99.99 });
```

## Stripe Billing

Stripe billing is available as the `@beeblock/svelar-stripe` plugin. Set it up in three steps:

### 1. Install & Configure

```bash
npm install stripe
```

```typescript
// src/app.ts — uncomment the Stripe block
import { Stripe } from '@beeblock/svelar-stripe';

Stripe.configure({
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  currency: 'usd',
});
```

### 2. Create Products in Stripe Dashboard

Go to [Stripe Products](https://dashboard.stripe.com/products), create your plans (e.g., Free, Pro at $29/mo, Enterprise at $99/mo), and copy each Price ID (`price_xxx`).

### 3. Handle Webhooks

Register event handlers in `app.ts`:

```typescript
Stripe.webhooks()
  .on('customer.subscription.created', async (event) => {
    // Sync subscription to your database
  })
  .on('invoice.payment_failed', async (event) => {
    // Notify user about failed payment
  });
```

The webhook endpoint at `/api/webhooks/stripe` is already scaffolded with signature verification.

For the full guide including checkout sessions, customer portal, refunds, subscription management, and testing — see [Stripe Billing](./32-stripe.md).

## Audit Logging

Track user actions:

```typescript
import { Audit } from '@beeblock/svelar/audit';

Audit.configure({ driver: 'memory', enabled: true });

// Log an action
await Audit.log({
  action: 'invoice.created',
  modelType: 'Invoice',
  modelId: invoice.id,
  userId: user.id,
  changes: { status: 'pending' },
});

// Query audit trail
const entries = await Audit.query({ limit: 50 });
```

## Email Templates

```typescript
import { EmailTemplates } from '@beeblock/svelar/email-templates';

EmailTemplates.configure({ driver: 'memory' });
EmailTemplates.registerDefaults(); // registers welcome, reset-password, etc.
```

## Feature Flags

Database-backed feature flags with per-user, per-team, and percentage rollout support:

```typescript
import { Features } from '@beeblock/svelar/feature-flags';

Features.configure({ driver: 'database' });

// Define flags at startup (in app.ts)
await Features.define('new-dashboard', { description: 'Redesigned UI' });
await Features.define('beta-api', { description: 'API v2', percentage: 20 });

// Check flags in routes
if (await Features.enabledFor('beta-api', user.id)) {
  // This user gets the beta experience
}

// Per-team flags (for enterprise features)
if (await Features.enabledForTeam('enterprise-sso', teamId)) {
  // This team has SSO
}

// Admin controls
await Features.enable('new-dashboard');          // Turn on globally
await Features.enableFor('beta-api', userId);    // Force on for a user
await Features.disableForTeam('beta-api', teamId); // Force off for a team
```

Tables (`feature_flags`, `feature_flag_overrides`) are auto-created — no migration required.

See [Feature Flags](./21-feature-flags.md) for the full guide including percentage rollouts, admin APIs, and Svelte page integration.

## Excel Import/Export

Export data for your users or import bulk records:

```typescript
import { Excel } from '@beeblock/svelar/excel';

// Export endpoint
export async function GET() {
  const users = await User.query().all();
  const buffer = await Excel.export({
    sheets: [{
      name: 'Users',
      columns: [
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Email', key: 'email', width: 40 },
      ],
      rows: users,
    }],
  });
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="users.xlsx"',
    },
  });
}
```

For large datasets, use `Excel.stream()` with async generators to keep memory low. See [Excel](./28-excel.md) for streaming examples.

## File Uploads

```typescript
import { Uploads } from '@beeblock/svelar/uploads';

Uploads.configure({ driver: 'memory', maxFileSize: 10 * 1024 * 1024 }); // 10MB
```

## Production Checklist

### Database
- [ ] Switch from SQLite to PostgreSQL: update `svelar.database.json` and `.env`
- [ ] Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- [ ] Run migrations: `npx svelar migrate`
- [ ] Set up automated daily backups

### Security
- [ ] Set a strong `APP_KEY` (random 32+ char string)
- [ ] Set `INTERNAL_SECRET` for the broadcast bridge
- [ ] Enable HTTPS with TLS certificate
- [ ] Set `NODE_ENV=production`
- [ ] Use environment secrets (not `.env` file in production)
- [ ] Configure CORS for your domain

### Stripe (if using billing)
- [ ] Switch to live mode keys (`sk_live_`, `pk_live_`)
- [ ] Set `STRIPE_WEBHOOK_SECRET` for production webhook endpoint
- [ ] Register webhook URL in Stripe Dashboard: `https://yourdomain.com/api/webhooks/stripe`
- [ ] Test the webhook with `stripe trigger customer.subscription.created`

### Sessions & Cache
- [ ] Already using `DatabaseSessionStore` (persistent across restarts)
- [ ] For Redis sessions/cache: install Redis, set `CACHE_DRIVER=redis` in `.env`

### Queue & Scheduler
- [ ] Switch queue driver from `sync` to `redis`: set `QUEUE_DRIVER=redis` in `.env`
- [ ] Run scheduler as a daemon: `npx svelar schedule:run`
- [ ] Use PM2 or systemd to keep processes running:
  ```bash
  pm2 start "npx svelar schedule:run" --name scheduler
  ```
- [ ] Run `npx svelar make:dashboard` and use `/admin` to monitor queue and scheduler

### Docker Deployment

```bash
npx svelar make:docker --db=postgres --redis
docker compose up -d --build
docker compose exec app npx svelar migrate
docker compose exec app npx svelar seed:run
```

### Logging & Monitoring
- [ ] Configure log rotation in PM2
- [ ] Monitor queue depth and job failures via admin dashboard
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Monitor the health endpoint: `GET /api/health`

## Scaling

### Horizontal Scaling

Run multiple instances behind a load balancer:

```yaml
# docker-compose.yml
services:
  app-1:
    build: .
    environment:
      - INSTANCE_ID=1
  app-2:
    build: .
    environment:
      - INSTANCE_ID=2

  postgres:
    image: postgres:15
  redis:
    image: redis:latest
```

Requirements for horizontal scaling:
- Use PostgreSQL (not SQLite) for shared database
- Use Redis for queue, cache, and sessions
- `DatabaseSessionStore` ensures sessions work across instances
- The scheduler's `SchedulerLock` prevents duplicate task execution across instances

### Caching Strategy

```typescript
import { Cache } from '@beeblock/svelar/cache';

// Cache expensive queries
const posts = await Cache.remember(
  'user:' + userId + ':posts',
  () => Post.where('user_id', userId).get(),
  3600 // 1 hour TTL
);

// Invalidate on changes
await Cache.forget('user:' + userId + ':posts');
```

### Database Optimization

- Index frequently queried columns (email, slug, user_id, team_id)
- Use `paginate()` for large result sets
- Use eager loading (`with()`) to avoid N+1 queries
- Monitor slow queries in production

## Adding i18n

The scaffold ships with hardcoded English. To add internationalization:

1. Install Paraglide: follow the [i18n guide](./15-i18n.md)
2. Replace hardcoded strings with `m.xxx()` message functions
3. Add `LanguageSwitcher` to your layout
4. Update `hooks.server.ts` to include `i18n` config:

```typescript
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getTextDirection } from '$lib/paraglide/runtime';

export const { handle, handleError } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY!,
  sessionStore: new DatabaseSessionStore(),
  csrfExcludePaths: ['/api/webhooks', '/api/internal/'],
  i18n: { paraglideMiddleware, getTextDirection },
});
```

## Plugin Ecosystem

### Creating Custom Plugins

```typescript
// src/lib/plugins/AnalyticsPlugin.ts
import { Plugin } from '@beeblock/svelar/plugins';
import { Container } from '@beeblock/svelar/container';

export class AnalyticsPlugin extends Plugin {
  readonly name = 'analytics';
  readonly version = '1.0.0';

  async register(app: Container) {
    app.singleton('analytics', () => new AnalyticsService());
  }

  async boot(app: Container) {
    // Initialize tracking
  }

  config() {
    return {
      key: 'analytics',
      defaults: {
        trackingId: process.env.ANALYTICS_ID,
      },
    };
  }
}
```

Register in `src/app.ts`:

```typescript
import { PluginManager } from '@beeblock/svelar/plugins';
import { AnalyticsPlugin } from './lib/plugins/AnalyticsPlugin.js';

const plugins = new PluginManager(app);
plugins.use(new AnalyticsPlugin());
await plugins.boot();
```

See [Plugins](./09-plugins.md) for the full plugin API.

## Next Steps

- [Getting Started](./00-getting-started.md) — Walkthrough of setup and first 10 minutes
- [Controllers & Routing](./04-controllers-routing.md) — API design patterns
- [Authentication](./06-authentication.md) — JWT, refresh tokens, API tokens, request signatures
- [Queue & Jobs](./11-queue-jobs.md) — Background processing and workers
- [Scheduler](./10-scheduler.md) — Cron task configuration
- [Additional Features](./12-additional-features.md) — Events, logging, mail, storage, broadcasting
- [Architecture](./20-architecture.md) — DDD boundaries, module communication, anti-patterns

---

**Svelar SaaS Guide** &copy; 2026
