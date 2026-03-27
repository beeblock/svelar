# Building SaaS with Svelar

A complete guide to building multi-tenant SaaS applications with Svelar.

## Quick Start

Svelar comes batteries-included for SaaS:

```bash
npx create-svelar my-saas
cd my-saas
npm install
npm run dev
```

Out of the box you get:
- **Authentication** — Session + JWT support
- **Teams** — Multi-tenant workspaces
- **Database** — Migrations, ORM, seeders
- **Jobs** — Background processing (queue)
- **Scheduler** — Cron tasks
- **Broadcasting** — Real-time updates
- **Admin Dashboard** — System monitoring
- **Plugins** — Extensible architecture

## Production Checklist

Before deploying to production:

### Database
- [ ] Use PostgreSQL (not SQLite)
- [ ] Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- [ ] Run migrations: `npx svelar migrate`
- [ ] Set up backups (automated daily)

### Cache & Sessions
- [ ] Install Redis: `docker run -d -p 6379:6379 redis`
- [ ] Configure in `.env`: `CACHE_DRIVER=redis`
- [ ] Sessions: Use `DatabaseSessionStore` (not memory)

### Queue & Scheduler
- [ ] Run in separate processes: `npx svelar queue:work`
- [ ] Run scheduler: `npx svelar schedule:run`
- [ ] Use PM2 or systemd to keep them running
- [ ] Monitor with `/admin/dashboard`

### Docker
```bash
npx svelar make:docker --db=postgres --redis
docker compose up -d --build
docker compose exec app npx svelar migrate
```

### Security
- [ ] Set strong `APP_KEY`, `JWT_SECRET`
- [ ] Enable HTTPS with TLS certificate
- [ ] Configure CORS for your domain
- [ ] Set `NODE_ENV=production` and `APP_ENV=production`
- [ ] Use environment secrets (not `.env` file)

### Logging & Monitoring
- [ ] Configure log rotation in PM2
- [ ] Monitor queue depth and job failures
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Monitor database slow queries

## Recommended Architecture

### Folder Structure

```
src/
├── lib/
│   ├── models/
│   │   ├── User.ts
│   │   ├── Team.ts
│   │   ├── Subscription.ts
│   │   └── Post.ts
│   ├── services/
│   │   ├── TeamService.ts        # Business logic
│   │   ├── BillingService.ts
│   │   └── EmailService.ts
│   ├── repositories/
│   │   ├── PostRepository.ts     # Data access
│   │   └── UserRepository.ts
│   ├── jobs/
│   │   ├── SendWelcomeEmailJob.ts
│   │   └── ProcessSubscriptionJob.ts
│   ├── events/
│   │   ├── UserCreated.ts
│   │   └── SubscriptionRenewed.ts
│   ├── middleware/
│   │   ├── AuthMiddleware.ts
│   │   └── ThrottleMiddleware.ts
│   ├── scheduler/
│   │   └── Tasks.ts              # Cron tasks
│   └── controllers/
│       ├── AuthController.ts
│       └── PostController.ts
└── routes/
    ├── api/
    │   ├── +layout.ts            # API middleware
    │   ├── auth/
    │   ├── posts/
    │   └── teams/
    └── app/
        ├── +layout.svelte        # App layout
        ├── +page.svelte
        └── [team]/
            ├── +layout.svelte    # Team context
            └── posts/

```

### Models Layer

Define clear model boundaries and relationships:

```typescript
// src/lib/models/Team.ts
import { Model } from 'svelar/orm';

export class Team extends Model {
  static table = 'teams';
  static timestamps = true;
  static fillable = ['name', 'slug'];

  declare id: number;
  declare name: string;
  declare slug: string;
  declare ownerId: number;
  declare created_at: Date;
  declare updated_at: Date;

  // Relationships
  owner() {
    return this.belongsTo(() => User, 'ownerId', 'id');
  }

  members() {
    return this.hasMany(() => TeamMember, 'teamId', 'id');
  }

  async getMembersCount() {
    return this.members().count();
  }
}
```

### Services Layer

Encapsulate business logic in services:

```typescript
// src/lib/services/TeamService.ts
import { Team } from '../models/Team.js';
import { TeamMember } from '../models/TeamMember.js';
import { User } from '../models/User.js';

export class TeamService {
  async createTeam(name: string, ownerId: number) {
    const slug = this.slugify(name);

    const team = await Team.create({
      name,
      slug,
      ownerId,
    });

    // Create owner membership
    await TeamMember.create({
      teamId: team.id,
      userId: ownerId,
      role: 'owner',
    });

    return team;
  }

  async inviteMember(team: Team, email: string, role: 'member' | 'admin') {
    const user = await User.where('email', email).first();

    if (!user) {
      // Send invitation email with signup link
      // ...
      return;
    }

    await TeamMember.create({
      teamId: team.id,
      userId: user.id,
      role,
    });
  }

  async removeMember(teamId: number, userId: number) {
    await TeamMember.where('teamId', teamId).where('userId', userId).delete();
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-');
  }
}
```

### Jobs & Events

Use jobs for async work and events for loose coupling:

```typescript
// src/lib/jobs/SendWelcomeEmailJob.ts
import { Job } from 'svelar/queue';

export class SendWelcomeEmailJob extends Job {
  queue = 'default';
  maxAttempts = 3;
  maxTimeout = 30000;

  async handle(payload: { userId: number }) {
    const user = await User.find(payload.userId);
    if (!user) return;

    // Send welcome email
    const html = await EmailTemplate.render('welcome', { name: user.name });
    await Mail.to(user.email).html(html).subject('Welcome!').send();
  }
}
```

Dispatch jobs from controllers or services:

```typescript
import { Queue } from 'svelar/queue';
import { SendWelcomeEmailJob } from '../jobs/SendWelcomeEmailJob.js';

// In a service or controller
await Queue.dispatch(SendWelcomeEmailJob, { userId: user.id });
```

### Scheduler Tasks

Run periodic tasks with the scheduler:

```typescript
// src/lib/scheduler/Tasks.ts
import { scheduler } from 'svelar/scheduler';
import { SubscriptionService } from '../services/SubscriptionService.js';

scheduler.add('renew-subscriptions', {
  cron: '0 2 * * *', // 2 AM daily
  async run() {
    const service = new SubscriptionService();
    await service.renewExpiredSubscriptions();
  },
});

scheduler.add('sync-stripe', {
  cron: '*/5 * * * *', // Every 5 minutes
  async run() {
    const service = new SubscriptionService();
    await service.syncWithStripe();
  },
});
```

## Multi-Tenancy

### Team-Scoped Queries

Always filter by team in multi-tenant apps:

```typescript
// src/lib/controllers/PostController.ts
import { Team } from '../models/Team.js';
import { Post } from '../models/Post.js';

export async function listPosts(event) {
  const team = await Team.find(event.params.teamId);
  if (!team) return new Response('Not found', { status: 404 });

  const posts = await Post.where('teamId', team.id).get();
  return json(posts);
}
```

### Team Middleware

Create middleware to inject the current team:

```typescript
// src/lib/middleware/TeamMiddleware.ts
import { Team } from '../models/Team.js';

export async function TeamMiddleware(event, next) {
  const teamId = parseInt(event.params.teamId);
  const team = await Team.find(teamId);

  if (!team) {
    return new Response('Team not found', { status: 404 });
  }

  // Verify user is a member
  const isMember = await team.members()
    .where('userId', event.locals.auth.id)
    .first();

  if (!isMember) {
    return new Response('Forbidden', { status: 403 });
  }

  event.locals.team = team;
  return next();
}
```

Use in routes:

```typescript
// src/routes/api/[team]/posts/+server.ts
import { TeamMiddleware } from '../../../lib/middleware/TeamMiddleware.js';

export const GET = TeamMiddleware(async (event) => {
  const posts = await Post.where('teamId', event.locals.team.id).get();
  return json(posts);
});
```

## Plugin Ecosystem

### Official Plugins

**Stripe for Billing**
```bash
npm install svelar-stripe
npx svelar plugin:publish svelar-stripe
```

**Postmark for Email**
```bash
npm install svelar-postmark
npx svelar plugin:publish svelar-postmark
```

**Resend for Email**
```bash
npm install svelar-resend
npx svelar plugin:publish svelar-resend
```

### Creating Custom Plugins

```typescript
// src/lib/plugins/AnalyticsPlugin.ts
import { Plugin } from 'svelar/plugins';
import { Container } from 'svelar/container';

export class AnalyticsPlugin extends Plugin {
  readonly name = 'my-analytics';
  readonly version = '1.0.0';

  async register(app: Container) {
    app.singleton('analytics', () => new AnalyticsService());
  }

  async boot(app: Container) {
    const analytics = app.make('analytics');
    // Track page views, custom events, etc.
  }

  config() {
    return {
      key: 'analytics',
      defaults: {
        trackingId: process.env.ANALYTICS_ID,
        endpoint: 'https://api.analytics.com',
      },
    };
  }
}
```

Register in `src/app.ts`:

```typescript
import { PluginManager } from 'svelar/plugins';
import { AnalyticsPlugin } from './lib/plugins/AnalyticsPlugin.js';

const plugins = new PluginManager(app);
plugins.use(new AnalyticsPlugin());
await plugins.boot();
```

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
  app-3:
    build: .
    environment:
      - INSTANCE_ID=3

  # Shared infrastructure
  postgres:
    image: postgres:15
  redis:
    image: redis:latest
```

### Cache Strategy

Use Redis for caching and sessions:

```typescript
import { Cache } from 'svelar/cache';

// Cache user posts for 1 hour
const posts = await Cache.remember(
  `user:${userId}:posts`,
  () => Post.where('userId', userId).get(),
  3600
);

// Invalidate when post is created/updated
Post.addEventListener('created', async (post) => {
  await Cache.forget(`user:${post.userId}:posts`);
});
```

### Database Optimization

- Use read replicas for reporting queries
- Index frequently queried columns
- Monitor slow queries
- Paginate large result sets

## Monitoring & Observability

### Admin Dashboard

Monitor system health at `/admin/dashboard`:
- Queue status and job errors
- Scheduler execution
- System metrics (CPU, memory)
- Application logs

### Queue Monitoring

```typescript
import { Queue } from 'svelar/queue';

// Get queue health
const health = await Queue.health();
// { waiting: 10, active: 2, failed: 1, completed: 1000 }
```

### Error Tracking

Integrate Sentry or similar:

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.APP_ENV,
});
```

## Next Steps

- Read [Controllers & Routing](./04-controllers-routing.md) for API design
- Learn [Authentication](./06-authentication.md) for auth strategies
- Explore [Queue & Jobs](./11-queue-jobs.md) for background processing
- Check [Plugins](./09-plugins.md) for extensibility

---

**Svelar SaaS Guide** © 2026
