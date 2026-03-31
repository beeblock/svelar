/**
 * NewCommandTemplates — All scaffold file templates for `npx svelar new`.
 *
 * Each static method returns the full file content as a string.
 * Used by NewCommand.ts to write project files.
 */

export class NewCommandTemplates {

  // ─── Config ─────────────────────────────────────────────────

  static packageJson(name: string, svelarVersion: string = '0.4.0'): string {
    return JSON.stringify(
      {
        name,
        version: '0.0.1',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite dev',
          build: 'vite build',
          preview: 'vite preview',
          migrate: 'npx svelar migrate',
          'migrate:rollback': 'npx svelar migrate --rollback',
          'migrate:refresh': 'npx svelar migrate --refresh',
          seed: 'npx svelar seed:run',
        },
        devDependencies: {
          '@sveltejs/adapter-auto': '^3.0.0',
          '@sveltejs/kit': '^2.55.0',
          '@sveltejs/vite-plugin-svelte': '^5.0.0',
          '@tailwindcss/vite': '^4.2.2',
          'lucide-svelte': '^0.468.0',
          svelte: '^5.0.0',
          'svelte-check': '^4.0.0',
          tailwindcss: '^4.2.2',
          typescript: '^5.7.0',
          vite: '^6.0.0',
        },
        dependencies: {
          'better-sqlite3': '^11.0.0',
          'drizzle-orm': '^0.38.0',
          '@beeblock/svelar': `^${svelarVersion}`,
          exceljs: '^4.4.0',
          pdfkit: '^0.18.0',
          'sveltekit-superforms': '^2.22.0',
          zod: '^3.23.0',
        },
      },
      null,
      2
    ) + '\n';
  }

  static svelteConfig(): string {
    return `import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      '$lib': 'src/lib',
      '$lib/*': 'src/lib/*',
    },
  },
};

export default config;
`;
  }

  static viteConfig(): string {
    return `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';

// Resolve the svelar package root so we can alias submodule imports
const require_ = createRequire(import.meta.url);
const svelarRoot = dirname(require_.resolve('@beeblock/svelar/package.json'));

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  resolve: {
    alias: {
      '@beeblock/svelar/actions': resolve(svelarRoot, 'dist/actions/index.js'),
      '@beeblock/svelar/api-keys': resolve(svelarRoot, 'dist/api-keys/index.js'),
      '@beeblock/svelar/audit': resolve(svelarRoot, 'dist/audit/index.js'),
      '@beeblock/svelar/auth': resolve(svelarRoot, 'dist/auth/index.js'),
      '@beeblock/svelar/broadcasting/client': resolve(svelarRoot, 'dist/broadcasting/client.js'),
      '@beeblock/svelar/broadcasting': resolve(svelarRoot, 'dist/broadcasting/index.js'),
      '@beeblock/svelar/cache': resolve(svelarRoot, 'dist/cache/index.js'),
      '@beeblock/svelar/cli': resolve(svelarRoot, 'dist/cli/index.js'),
      '@beeblock/svelar/config': resolve(svelarRoot, 'dist/config/index.js'),
      '@beeblock/svelar/container': resolve(svelarRoot, 'dist/container/index.js'),
      '@beeblock/svelar/dashboard': resolve(svelarRoot, 'dist/dashboard/index.js'),
      '@beeblock/svelar/database': resolve(svelarRoot, 'dist/database/index.js'),
      '@beeblock/svelar/dates': resolve(svelarRoot, 'dist/support/date.js'),
      '@beeblock/svelar/email-templates': resolve(svelarRoot, 'dist/email-templates/index.js'),
      '@beeblock/svelar/errors': resolve(svelarRoot, 'dist/errors/index.js'),
      '@beeblock/svelar/events': resolve(svelarRoot, 'dist/events/index.js'),
      '@beeblock/svelar/excel': resolve(svelarRoot, 'dist/excel/index.js'),
      '@beeblock/svelar/feature-flags': resolve(svelarRoot, 'dist/feature-flags/index.js'),
      '@beeblock/svelar/forms': resolve(svelarRoot, 'dist/forms/index.js'),
      '@beeblock/svelar/hashing': resolve(svelarRoot, 'dist/hashing/index.js'),
      '@beeblock/svelar/hooks': resolve(svelarRoot, 'dist/hooks/index.js'),
      '@beeblock/svelar/http': resolve(svelarRoot, 'dist/http/index.js'),
      '@beeblock/svelar/logging/LogViewer': resolve(svelarRoot, 'dist/logging/LogViewer.js'),
      '@beeblock/svelar/logging': resolve(svelarRoot, 'dist/logging/index.js'),
      '@beeblock/svelar/mail': resolve(svelarRoot, 'dist/mail/index.js'),
      '@beeblock/svelar/middleware': resolve(svelarRoot, 'dist/middleware/index.js'),
      '@beeblock/svelar/notifications': resolve(svelarRoot, 'dist/notifications/index.js'),
      '@beeblock/svelar/orm': resolve(svelarRoot, 'dist/orm/index.js'),
      '@beeblock/svelar/pagination': resolve(svelarRoot, 'dist/pagination/index.js'),
      '@beeblock/svelar/pdf': resolve(svelarRoot, 'dist/pdf/index.js'),
      '@beeblock/svelar/pdf/GeneratePdfJob': resolve(svelarRoot, 'dist/pdf/GeneratePdfJob.js'),
      '@beeblock/svelar/permissions': resolve(svelarRoot, 'dist/permissions/index.js'),
      '@beeblock/svelar/plugins/PluginInstaller': resolve(svelarRoot, 'dist/plugins/PluginInstaller.js'),
      '@beeblock/svelar/plugins/PluginPublisher': resolve(svelarRoot, 'dist/plugins/PluginPublisher.js'),
      '@beeblock/svelar/plugins/PluginRegistry': resolve(svelarRoot, 'dist/plugins/PluginRegistry.js'),
      '@beeblock/svelar/plugins': resolve(svelarRoot, 'dist/plugins/index.js'),
      '@beeblock/svelar/queue': resolve(svelarRoot, 'dist/queue/index.js'),
      '@beeblock/svelar/queue/JobMonitor': resolve(svelarRoot, 'dist/queue/JobMonitor.js'),
      '@beeblock/svelar/repositories': resolve(svelarRoot, 'dist/repositories/index.js'),
      '@beeblock/svelar/routing': resolve(svelarRoot, 'dist/routing/index.js'),
      '@beeblock/svelar/scheduler/ScheduleMonitor': resolve(svelarRoot, 'dist/scheduler/ScheduleMonitor.js'),
      '@beeblock/svelar/scheduler': resolve(svelarRoot, 'dist/scheduler/index.js'),
      '@beeblock/svelar/services': resolve(svelarRoot, 'dist/services/index.js'),
      '@beeblock/svelar/session': resolve(svelarRoot, 'dist/session/index.js'),
      '@beeblock/svelar/storage': resolve(svelarRoot, 'dist/storage/index.js'),
      '@beeblock/svelar/support': resolve(svelarRoot, 'dist/support/index.js'),
      '@beeblock/svelar/teams': resolve(svelarRoot, 'dist/teams/index.js'),
      '@beeblock/svelar/uploads': resolve(svelarRoot, 'dist/uploads/index.js'),
      '@beeblock/svelar/validation': resolve(svelarRoot, 'dist/validation/index.js'),
      '@beeblock/svelar/webhooks': resolve(svelarRoot, 'dist/webhooks/index.js'),
      '@beeblock/svelar/ui': resolve(svelarRoot, 'src/ui/index.ts'),
      '@beeblock/svelar/i18n/LanguageSwitcher.svelte': resolve(svelarRoot, 'src/i18n/LanguageSwitcher.svelte'),
      '@beeblock/svelar/i18n': resolve(svelarRoot, 'dist/i18n/index.js'),
      '@beeblock/svelar': resolve(svelarRoot, 'dist/index.js'),
    },
  },
  server: {
    fs: {
      // Allow serving files from the svelar package (UI components are source .svelte files)
      allow: ['.', svelarRoot],
    },
  },
  ssr: {
    // Process lucide-svelte during SSR (Svelte components must be compiled)
    noExternal: ['lucide-svelte', '@tabler/icons-svelte'],
  },
  optimizeDeps: {
    exclude: ['lucide-svelte', '@tabler/icons-svelte'],
  },
});
`;
  }

  static tsConfig(): string {
    return JSON.stringify(
      {
        extends: './.svelte-kit/tsconfig.json',
        compilerOptions: {
          allowJs: true,
          checkJs: true,
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          sourceMap: true,
          strict: true,
          moduleResolution: 'bundler',
        },
      },
      null,
      2
    ) + '\n';
  }

  static appHtml(): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-prerender="true">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`;
  }

  static appCss(): string {
    return `@import "tailwindcss";
@source "../node_modules/@beeblock/svelar/src/ui";

@theme {
  --color-brand: #ff3e00;
  --color-brand-dark: #e03500;
  --color-brand-light: #fff5f2;
}
`;
  }

  static appTs(): string {
    return `/**
 * Svelar Application Bootstrap
 *
 * Configures database, hashing, auth, queue, audit, API keys,
 * webhooks, teams, uploads, email templates, feature flags, PDF, and scheduling.
 * This runs once when the server starts.
 */

import { Connection } from '@beeblock/svelar/database';
import { Hash } from '@beeblock/svelar/hashing';
import { AuthManager } from '@beeblock/svelar/auth';
import { Queue } from '@beeblock/svelar/queue';
import { Audit } from '@beeblock/svelar/audit';
import { ApiKeys } from '@beeblock/svelar/api-keys';
import { Webhooks } from '@beeblock/svelar/webhooks';
import { Teams } from '@beeblock/svelar/teams';
import { EmailTemplates } from '@beeblock/svelar/email-templates';
import { Uploads } from '@beeblock/svelar/uploads';
import { Features } from '@beeblock/svelar/feature-flags';
import { PDF } from '@beeblock/svelar/pdf';
import { configureDashboard } from '@beeblock/svelar/dashboard';
import { Broadcast } from '@beeblock/svelar/broadcasting';
import { Notifier } from '@beeblock/svelar/notifications';
import { User } from './lib/models/User.js';
import { EventServiceProvider } from './lib/shared/providers/EventServiceProvider.js';
import './lib/auth/gates.js';

// ── Database (SQLite) ─────────────────────────────────────
Connection.configure({
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      filename: process.env.DB_PATH ?? 'database.db',
    },
  },
});

// ── Hashing (scrypt, zero dependencies) ───────────────────
Hash.configure({ driver: 'scrypt' });

// ── Auth (session-based with password reset, email verification, OTP) ──
export const auth = new AuthManager({
  guard: 'session',
  model: User,
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  appName: process.env.APP_NAME ?? 'Svelar',
});

// ── Queue (with Redis support) ────────────────────────────
Queue.configure({
  default: process.env.QUEUE_DRIVER ?? 'sync',
  connections: {
    sync: { driver: 'sync' },
    redis: {
      driver: 'redis',
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  },
});

// ── Audit Logging ─────────────────────────────────────────
Audit.configure({ driver: 'database', table: 'audit_logs', enabled: true });

// ── API Keys ──────────────────────────────────────────────
ApiKeys.configure({ driver: 'memory', prefix: 'sk_' });

// ── Webhooks ──────────────────────────────────────────────
Webhooks.configure({ driver: 'memory', maxAttempts: 5 });

// ── Teams ─────────────────────────────────────────────────
Teams.configure({ driver: 'memory' });

// ── Uploads ───────────────────────────────────────────────
Uploads.configure({ driver: 'memory', maxFileSize: 10 * 1024 * 1024 });

// ── Email Templates ──────────────────────────────────────
EmailTemplates.configure({ driver: 'memory' });
EmailTemplates.registerDefaults();

// ── Broadcasting (SSE) ────────────────────────────────────
Broadcast.configure({
  default: 'sse',
  drivers: {
    sse: { driver: 'sse' },
  },
});

// Channel authorization — private-user-{id} for per-user channels
Broadcast.channel('private-user-*', async (user: any, params: any) => {
  return user && String(user.id) === params['0'];
});

// Presence channel for admin dashboard
Broadcast.channel('presence-admin', async (user: any) => {
  if (!user || user.role !== 'admin') return false;
  return { id: user.id, name: user.name };
});

// ── Feature Flags ────────────────────────────────────────
Features.configure({ driver: 'database' });

// ── PDF (PDFKit — no Docker needed) ─────────────────────
PDF.configure({ driver: 'pdfkit' });

// ── Dashboard ─────────────────────────────────────────────
configureDashboard({ enabled: true, prefix: '/admin' });

// ── Job Registration ──────────────────────────────────────
import { SendWelcomeEmail } from './lib/shared/jobs/SendWelcomeEmail.js';
import { DailyDigestJob } from './lib/shared/jobs/DailyDigestJob.js';
import { ExportDataJob } from './lib/shared/jobs/ExportDataJob.js';

Queue.registerAll([SendWelcomeEmail, DailyDigestJob, ExportDataJob]);

// ── Notifications ────────────────────────────────────────
Notifier.extend('database', {
  async send(notifiable: any, notification: any) {
    const data = notification.toDatabase(notifiable);
    const { Connection: DB } = await import('@beeblock/svelar/database');
    await DB.raw(
      'INSERT INTO notifications (id, notifiable_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), notifiable.id ?? notifiable.getAttribute?.('id'), data.type, JSON.stringify(data.data), new Date().toISOString()]
    );
  },
});

// ── Events (boot listeners + observers) ──────────────────
const esp = new EventServiceProvider();
esp.boot();

// ── Auth Feature Toggles ─────────────────────────────────
export const authConfig = {
  otpEnabled: process.env.AUTH_OTP_ENABLED !== 'false',
  emailVerificationRequired: process.env.AUTH_EMAIL_VERIFICATION_REQUIRED === 'true',
};

export { Connection, Hash, Broadcast };
`;
  }

  static hooksServerTs(): string {
    return `/**
 * SvelteKit Server Hooks — Svelar middleware pipeline
 */

import { createSvelarApp } from '@beeblock/svelar/hooks';
import { DatabaseSessionStore } from '@beeblock/svelar/session';
import { env } from '\$env/dynamic/private';

// Import app.ts to trigger database + hashing + auth configuration
import { auth } from './app.js';

export const { handle, handleError } = createSvelarApp({
  auth,
  secret: env.APP_KEY,
  sessionStore: new DatabaseSessionStore(),
  csrfExcludePaths: ['/api/webhooks', '/api/internal/'],
});
`;
  }

  static envExample(): string {
    return `# App Security — generate a random string for production
APP_KEY=change-me-to-a-random-string

# App
APP_NAME=My App
APP_URL=http://localhost:5173

# Internal secret (scheduler <-> web server bridge)
INTERNAL_SECRET=change-me-to-a-random-string

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

# Mail (default: log — switch to smtp, postmark, or resend for production)
# MAIL_DRIVER=log
# MAIL_FROM=hello@example.com
# POSTMARK_API_TOKEN=your-postmark-server-token
# RESEND_API_KEY=re_your-resend-api-key

# Redis (optional — needed for BullMQ queue and Redis cache/session)
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=

# Queue driver (sync = immediate, redis = background via BullMQ)
# QUEUE_DRIVER=sync

# Meilisearch (optional — full-text search engine)
# MEILISEARCH_HOST=http://localhost:7700
# MEILISEARCH_KEY=

# PDF (default driver is pdfkit — no config needed)
# Switch to Gotenberg for pixel-perfect HTML rendering:
# PDF_DRIVER=gotenberg
# GOTENBERG_URL=http://localhost:3001

# Auth Features
AUTH_OTP_ENABLED=true
AUTH_EMAIL_VERIFICATION_REQUIRED=false

# Broadcasting (optional — Pusher/Soketi WebSocket)
# PUSHER_KEY=app-key
# PUSHER_SECRET=app-secret
# PUSHER_APP_ID=app-id
# PUSHER_HOST=localhost
# PUSHER_PORT=6001
`;
  }

  static gitignore(): string {
    return `node_modules
.svelte-kit
build
dist
.env
.env.*
*.db
!.env.example

# Storage (keep dirs, ignore contents)
storage/logs/*
storage/cache/*
storage/uploads/*
storage/sessions/*
!storage/**/.gitkeep
`;
  }

  static svelarDatabaseJson(): string {
    return JSON.stringify(
      {
        default: 'sqlite',
        connections: {
          sqlite: {
            driver: 'sqlite',
            filename: 'database.db',
          },
        },
      },
      null,
      2
    ) + '\n';
  }

  // ─── Domain Layer ──────────────────────────────────────────

  static userModel(): string {
    return `import { Model } from '@beeblock/svelar/orm';
import { HasRoles } from '@beeblock/svelar/permissions';
import { auditable } from '@beeblock/svelar/audit';

/**
 * User model with HasRoles mixin and audit logging.
 */
export class User extends HasRoles(Model) {
  static table = 'users';
  static timestamps = true;
  static fillable = ['name', 'email', 'password', 'role'];
  static hidden = ['password'];

  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare role: string;
  declare created_at: Date;
  declare updated_at: Date;

  get isAdmin(): boolean {
    return this.role === 'admin';
  }

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

// Enable audit logging for User model (tracks create/update/delete)
auditable(User);

import { Post } from './Post.js';
`;
  }

  static postModel(): string {
    return `import { Model } from '@beeblock/svelar/orm';
import { auditable } from '@beeblock/svelar/audit';

export class Post extends Model {
  static table = 'posts';
  static timestamps = true;
  static fillable = ['title', 'slug', 'body', 'published', 'user_id'];

  static casts = {
    published: 'boolean' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: number;
  declare title: string;
  declare slug: string;
  declare body: string;
  declare published: boolean;
  declare user_id: number;
  declare created_at: Date;
  declare updated_at: Date;

  author() {
    return this.belongsTo(User, 'user_id');
  }
}

// Enable audit logging for Post model (tracks create/update/delete)
auditable(Post);

import { User } from './User.js';
`;
  }

  static userRepository(): string {
    return `import { Repository } from '@beeblock/svelar/repositories';
import { User } from '../models/User.js';

export class UserRepository extends Repository<User> {
  model() {
    return User;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.query().where('email', email).first();
  }

  async findWithPosts(id: number): Promise<User | null> {
    return this.query().with('posts').find(id);
  }
}
`;
  }

  static postRepository(): string {
    return `import { Repository } from '@beeblock/svelar/repositories';
import { Post } from '../models/Post.js';

export class PostRepository extends Repository<Post> {
  model() {
    return Post;
  }

  async findPublished(): Promise<Post[]> {
    return this.query()
      .where('published', true)
      .orderBy('created_at', 'desc')
      .get();
  }

  async findBySlug(slug: string): Promise<Post | null> {
    return this.query().where('slug', slug).first();
  }

  async findByUser(userId: number): Promise<Post[]> {
    return this.query()
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .get();
  }
}
`;
  }

  static authService(): string {
    return `import { Service } from '@beeblock/svelar/services';
import { Hash } from '@beeblock/svelar/hashing';
import { Event } from '@beeblock/svelar/events';
import { UserRepository } from '../repositories/UserRepository.js';
import { UserRegistered } from '../events/UserRegistered.js';

const userRepo = new UserRepository();

export class AuthService extends Service {
  async register(data: { name: string; email: string; password: string }) {
    const existing = await userRepo.findByEmail(data.email);
    if (existing) {
      return this.fail('Email already registered');
    }

    const hashedPassword = await Hash.make(data.password);
    const user = await userRepo.create({
      name: data.name,
      email: data.email,
      password: hashedPassword,
    });

    // Dispatch event — triggers SendWelcomeEmailListener (queues welcome email + notification)
    await Event.dispatch(new UserRegistered(user));
    return this.ok(user);
  }

  async login(email: string, password: string) {
    const user = await userRepo.findByEmail(email);
    if (!user) {
      return this.fail('Invalid credentials');
    }

    const valid = await Hash.verify(password, (user as any).password);
    if (!valid) {
      return this.fail('Invalid credentials');
    }

    return this.ok(user);
  }

  async forgotPassword(email: string, auth: any) {
    // Always return success to avoid leaking whether user exists
    await auth.sendPasswordReset(email);
    return this.ok({ message: 'If that email exists, a reset link has been sent.' });
  }

  async resetPassword(token: string, email: string, password: string, auth: any) {
    const success = await auth.resetPassword(token, email, password);
    if (!success) {
      return this.fail('Invalid or expired reset link');
    }
    return this.ok({ message: 'Password has been reset. You can now log in.' });
  }

  async sendOtp(email: string, auth: any) {
    await auth.sendOtp(email);
    return this.ok({ message: 'If that email exists, a verification code has been sent.' });
  }

  async verifyOtp(email: string, code: string, auth: any, session: any) {
    const user = await auth.attemptOtp(email, code, session);
    if (!user) {
      return this.fail('Invalid or expired code');
    }
    return this.ok(user);
  }
}
`;
  }

  static postService(): string {
    return `import { CrudService } from '@beeblock/svelar/services';
import { Repository } from '@beeblock/svelar/repositories';
import { Broadcast } from '@beeblock/svelar/broadcasting';
import { PostRepository } from '../repositories/PostRepository.js';
import type { Post } from '../models/Post.js';

const postRepo = new PostRepository();

export class PostService extends CrudService<Post> {
  protected repository(): Repository<Post> {
    return postRepo;
  }

  async findPublished(): Promise<Post[]> {
    return postRepo.findPublished();
  }

  async findByUser(userId: number): Promise<Post[]> {
    return postRepo.findByUser(userId);
  }

  async createForUser(userId: number, data: any): Promise<Post> {
    const post = await postRepo.create({
      ...data,
      user_id: userId,
    });

    // Broadcast post creation to subscribers on the "posts" channel
    try {
      await Broadcast.event('post:created', {
        id: (post as any).id,
        title: (post as any).title,
        userId,
      }).on('posts').send();
    } catch {
      // Broadcasting is best-effort — don't fail post creation
    }

    return post;
  }
}
`;
  }

  static authController(): string {
    return `import { Controller } from '@beeblock/svelar/routing';
import { RegisterRequest } from '../dtos/RegisterRequest.js';
import { LoginRequest } from '../dtos/LoginRequest.js';
import { RegisterUserAction } from '../actions/RegisterUserAction.js';
import { AuthService } from '../services/AuthService.js';
import { UserResource } from '../resources/UserResource.js';

const registerAction = new RegisterUserAction();
const authService = new AuthService();

export class AuthController extends Controller {
  /** POST /api/auth/register */
  async register(event: any) {
    const data = await RegisterRequest.validate(event);

    const result = await registerAction.run({
      name: data.name,
      email: data.email,
      password: data.password,
    });

    if (!result.success) {
      return this.json({ message: result.error }, 422);
    }

    const user = result.data!;
    event.locals.session.set('auth_user_id', (user as any).id);
    event.locals.session.regenerateId();

    return UserResource.make(user).status(201).toResponse();
  }

  /** POST /api/auth/login */
  async login(event: any) {
    const data = await LoginRequest.validate(event);

    const result = await authService.login(data.email, data.password);

    if (!result.success) {
      return this.json({ message: result.error }, 401);
    }

    const user = result.data!;
    event.locals.session.set('auth_user_id', (user as any).id);
    event.locals.session.regenerateId();

    return UserResource.make(user).toResponse();
  }

  /** POST /api/auth/logout */
  async logout(event: any) {
    event.locals.session.forget('auth_user_id');
    event.locals.session.regenerateId();

    return this.json({ message: 'Logged out successfully' });
  }

  /** GET /api/auth/me */
  async me(event: any) {
    const user = event.locals.user;
    if (!user) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    return UserResource.make(user).toResponse();
  }

  /** POST /api/auth/forgot-password */
  async forgotPassword(event: any) {
    const { email } = await event.request.json();
    if (!email) return this.json({ message: 'Email is required' }, 422);

    const result = await authService.forgotPassword(email, event.locals.auth);
    return this.json(result.data);
  }

  /** POST /api/auth/reset-password */
  async resetPassword(event: any) {
    const { token, email, password } = await event.request.json();
    if (!token || !email || !password) {
      return this.json({ message: 'Token, email, and password are required' }, 422);
    }

    const result = await authService.resetPassword(token, email, password, event.locals.auth);
    if (!result.success) {
      return this.json({ message: result.error }, 400);
    }
    return this.json(result.data);
  }

  /** POST /api/auth/otp/send */
  async sendOtp(event: any) {
    const { email } = await event.request.json();
    if (!email) return this.json({ message: 'Email is required' }, 422);

    const result = await authService.sendOtp(email, event.locals.auth);
    return this.json(result.data);
  }

  /** POST /api/auth/otp/verify */
  async verifyOtp(event: any) {
    const { email, code } = await event.request.json();
    if (!email || !code) return this.json({ message: 'Email and code are required' }, 422);

    const result = await authService.verifyOtp(email, code, event.locals.auth, event.locals.session);
    if (!result.success) {
      return this.json({ message: result.error }, 401);
    }

    const user = result.data!;
    return this.json({
      message: 'Login successful',
      user: { id: (user as any).id, name: (user as any).name, email: (user as any).email },
    });
  }

  /** GET /api/auth/verify-email */
  async verifyEmail(event: any) {
    const token = event.url.searchParams.get('token');
    const id = event.url.searchParams.get('id');
    if (!token || !id) return this.json({ message: 'Invalid verification link' }, 400);

    const success = await event.locals.auth.verifyEmail(token, id);
    if (!success) {
      return this.json({ message: 'Invalid or expired verification link' }, 400);
    }
    return this.json({ message: 'Email verified successfully' });
  }
}
`;
  }

  static postController(): string {
    return `import { Controller } from '@beeblock/svelar/routing';
import { CreatePostRequest } from '../dtos/CreatePostRequest.js';
import { UpdatePostRequest } from '../dtos/UpdatePostRequest.js';
import { PostService } from '../services/PostService.js';
import { CreatePostAction } from '../actions/CreatePostAction.js';
import { PostResource } from '../resources/PostResource.js';

const postService = new PostService();
const createPostAction = new CreatePostAction();

export class PostController extends Controller {
  /** GET /api/posts */
  async index(event: any) {
    const showAll = event.url.searchParams.get('all') === 'true';

    if (showAll && event.locals.user) {
      const posts = await postService.findAll();
      return PostResource.collection(posts).toResponse();
    }

    const posts = await postService.findPublished();
    return PostResource.collection(posts).toResponse();
  }

  /** GET /api/posts/:id */
  async show(event: any) {
    const post = await postService.findByIdOrFail(event.params.id);
    return PostResource.make(post).toResponse();
  }

  /** POST /api/posts */
  async store(event: any) {
    const data = await CreatePostRequest.validate(event);
    const userId = event.locals.user?.id;

    if (!userId) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    const post = await createPostAction.run({
      userId,
      title: data.title,
      slug: data.slug,
      body: data.body,
      published: data.published,
    });

    return PostResource.make(post).status(201).toResponse();
  }

  /** PUT /api/posts/:id */
  async update(event: any) {
    const data = await UpdatePostRequest.validate(event);
    const post = await postService.update(event.params.id, data);
    return PostResource.make(post).toResponse();
  }

  /** DELETE /api/posts/:id */
  async destroy(event: any) {
    await postService.delete(event.params.id);
    return this.noContent();
  }

  /** GET /api/posts/mine */
  async mine(event: any) {
    const userId = event.locals.user?.id;
    if (!userId) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    const posts = await postService.findByUser(userId);
    return PostResource.collection(posts).toResponse();
  }
}
`;
  }

  static adminController(): string {
    return `import { Controller } from '@beeblock/svelar/routing';
import { Gate } from '@beeblock/svelar/auth';
import { AdminService } from '../services/AdminService.js';
import { UserResource } from '../resources/UserResource.js';
import { RoleResource } from '../resources/RoleResource.js';
import { PermissionResource } from '../resources/PermissionResource.js';
import { UpdateUserRoleRequest } from '../dtos/UpdateUserRoleRequest.js';
import { DeleteUserRequest } from '../dtos/DeleteUserRequest.js';
import { CreateRoleRequest } from '../dtos/CreateRoleRequest.js';
import { DeleteRoleRequest } from '../dtos/DeleteRoleRequest.js';
import { CreatePermissionRequest } from '../dtos/CreatePermissionRequest.js';
import { DeletePermissionRequest } from '../dtos/DeletePermissionRequest.js';
import { RolePermissionRequest } from '../dtos/RolePermissionRequest.js';
import { UserRoleRequest } from '../dtos/UserRoleRequest.js';
import { UserPermissionRequest } from '../dtos/UserPermissionRequest.js';
import { ExportDataRequest } from '../dtos/ExportDataRequest.js';

const adminService = new AdminService();

export class AdminController extends Controller {
  private async authorize(event: any) {
    if (await Gate.denies('admin-access', event.locals.user)) {
      return this.json({ message: 'Unauthorized' }, 403);
    }
    return null;
  }

  // ── Users ────────────────────────────────────────────

  async listUsers(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const users = await adminService.listUsers();
    return UserResource.collection(users).toResponse();
  }

  async updateUserRole(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await UpdateUserRoleRequest.validate(event);
    const result = await adminService.updateUserRole(data.userId, data.role);
    if (!result.success) return this.json({ message: result.error }, 400);

    return UserResource.make(result.data).toResponse();
  }

  async deleteUser(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await DeleteUserRequest.validate(event);
    const result = await adminService.deleteUser(data.userId, event.locals.user.id);
    if (!result.success) return this.json({ message: result.error }, 400);

    return this.json(result.data);
  }

  // ── Roles ────────────────────────────────────────────

  async createRole(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await CreateRoleRequest.validate(event);
    const result = await adminService.createRole(data.name, data.guard, data.description);
    if (!result.success) return this.json({ message: result.error }, 409);

    return RoleResource.make(result.data).status(201).toResponse();
  }

  async deleteRole(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await DeleteRoleRequest.validate(event);
    const result = await adminService.deleteRole(data.name, data.guard);
    return this.json(result.data);
  }

  // ── Permissions ──────────────────────────────────────

  async createPermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await CreatePermissionRequest.validate(event);
    const result = await adminService.createPermission(data.name, data.guard, data.description);
    if (!result.success) return this.json({ message: result.error }, 409);

    return PermissionResource.make(result.data).status(201).toResponse();
  }

  async deletePermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await DeletePermissionRequest.validate(event);
    const result = await adminService.deletePermission(data.name, data.guard);
    return this.json(result.data);
  }

  // ── Role-Permission pivots ───────────────────────────

  async attachRolePermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await RolePermissionRequest.validate(event);
    const result = await adminService.attachRolePermission(data.roleId, data.permissionId);
    return this.json(result.data);
  }

  async detachRolePermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await RolePermissionRequest.validate(event);
    const result = await adminService.detachRolePermission(data.roleId, data.permissionId);
    return this.json(result.data);
  }

  // ── User-Role pivots ─────────────────────────────────

  async assignUserRole(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await UserRoleRequest.validate(event);
    const result = await adminService.assignUserRole(data.userId, data.roleId);
    return this.json(result.data);
  }

  async removeUserRole(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await UserRoleRequest.validate(event);
    const result = await adminService.removeUserRole(data.userId, data.roleId);
    return this.json(result.data);
  }

  // ── User-Permission pivots ───────────────────────────

  async grantUserPermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await UserPermissionRequest.validate(event);
    const result = await adminService.grantUserPermission(data.userId, data.permissionId);
    return this.json(result.data);
  }

  async revokeUserPermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await UserPermissionRequest.validate(event);
    const result = await adminService.revokeUserPermission(data.userId, data.permissionId);
    return this.json(result.data);
  }

  // ── Export ───────────────────────────────────────────

  async exportData(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await ExportDataRequest.validate(event);
    const result = await adminService.exportData(event.locals.user.id, data.format);
    return this.json(result.data);
  }
}
`;
  }

  static registerRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { registerSchema } from '../schemas/auth.js';

export class RegisterRequest extends FormRequest {
  rules() {
    return registerSchema;
  }
}
`;
  }

  static loginRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { loginSchema } from '../schemas/auth.js';

export class LoginRequest extends FormRequest {
  rules() {
    return loginSchema;
  }
}
`;
  }

  static createPostRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { createPostSchema } from '../schemas/post.js';

export class CreatePostRequest extends FormRequest {
  rules() {
    return createPostSchema;
  }

  authorize(event: any): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: any) {
    if (!data.slug) {
      data.slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    return data;
  }
}
`;
  }

  static updatePostRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { updatePostSchema } from '../schemas/post.js';

export class UpdatePostRequest extends FormRequest {
  rules() {
    return updatePostSchema;
  }

  authorize(event: any): boolean {
    return !!event.locals.user;
  }
}
`;
  }

  static registerUserAction(): string {
    return `import { Action } from '@beeblock/svelar/actions';
import { AuthService } from '../services/AuthService.js';
import type { User } from '../models/User.js';

interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const authService = new AuthService();

export class RegisterUserAction extends Action<RegisterInput, ServiceResult<User>> {
  async execute(input: RegisterInput): Promise<ServiceResult<User>> {
    return authService.register(input);
  }
}
`;
  }

  static createPostAction(): string {
    return `import { Action } from '@beeblock/svelar/actions';
import { PostService } from '../services/PostService.js';
import type { Post } from '../models/Post.js';

interface CreatePostInput {
  userId: number;
  title: string;
  slug?: string;
  body: string;
  published?: boolean;
}

const postService = new PostService();

export class CreatePostAction extends Action<CreatePostInput, Post> {
  async execute(input: CreatePostInput): Promise<Post> {
    const slug = input.slug || input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return postService.createForUser(input.userId, {
      title: input.title,
      slug,
      body: input.body,
      published: input.published ?? false,
    });
  }
}
`;
  }

  static userResource(): string {
    return `import { Resource } from '@beeblock/svelar/routing';

export class UserResource extends Resource {
  toJSON() {
    return {
      id: this.data.id,
      name: this.data.name,
      email: this.data.email,
      role: this.data.role ?? 'user',
      created_at: this.data.created_at,
    };
  }
}
`;
  }

  static postResource(): string {
    return `import { Resource } from '@beeblock/svelar/routing';

export class PostResource extends Resource {
  toJSON() {
    return {
      id: this.data.id,
      title: this.data.title,
      slug: this.data.slug,
      body: this.data.body,
      published: this.data.published,
      user_id: this.data.user_id,
      created_at: this.data.created_at,
      updated_at: this.data.updated_at,
    };
  }
}
`;
  }

  static adminSchema(): string {
    return `import { z } from 'zod';

export const updateUserRoleSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(['user', 'admin']),
});

export const deleteUserSchema = z.object({
  userId: z.number().int().positive(),
});

export const createRoleSchema = z.object({
  name: z.string().min(2, 'Role name must be at least 2 characters').max(50),
  guard: z.string().optional(),
  description: z.string().max(255).optional(),
});

export const deleteRoleSchema = z.object({
  name: z.string().min(1),
  guard: z.string().optional(),
});

export const createPermissionSchema = z.object({
  name: z.string().min(2, 'Permission name must be at least 2 characters').max(50),
  guard: z.string().optional(),
  description: z.string().max(255).optional(),
});

export const deletePermissionSchema = z.object({
  name: z.string().min(1),
  guard: z.string().optional(),
});

export const rolePermissionSchema = z.object({
  roleId: z.number().int().positive(),
  permissionId: z.number().int().positive(),
});

export const userRoleSchema = z.object({
  userId: z.number().int().positive(),
  roleId: z.number().int().positive(),
});

export const userPermissionSchema = z.object({
  userId: z.number().int().positive(),
  permissionId: z.number().int().positive(),
});

export const exportDataSchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
});
`;
  }

  // ─── Admin DTOs ──────────────────────────────────────────

  static updateUserRoleRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { updateUserRoleSchema } from '../schemas/admin.js';

export class UpdateUserRoleRequest extends FormRequest {
  rules() {
    return updateUserRoleSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
  }

  static deleteUserRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { deleteUserSchema } from '../schemas/admin.js';

export class DeleteUserRequest extends FormRequest {
  rules() {
    return deleteUserSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
  }

  static createRoleRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { createRoleSchema } from '../schemas/admin.js';

export class CreateRoleRequest extends FormRequest {
  rules() {
    return createRoleSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
  }

  static deleteRoleRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { deleteRoleSchema } from '../schemas/admin.js';

export class DeleteRoleRequest extends FormRequest {
  rules() {
    return deleteRoleSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
  }

  static createPermissionRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { createPermissionSchema } from '../schemas/admin.js';

export class CreatePermissionRequest extends FormRequest {
  rules() {
    return createPermissionSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
  }

  static deletePermissionRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { deletePermissionSchema } from '../schemas/admin.js';

export class DeletePermissionRequest extends FormRequest {
  rules() {
    return deletePermissionSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
  }

  static rolePermissionRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { rolePermissionSchema } from '../schemas/admin.js';

export class RolePermissionRequest extends FormRequest {
  rules() {
    return rolePermissionSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
  }

  static userRoleRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { userRoleSchema } from '../schemas/admin.js';

export class UserRoleRequest extends FormRequest {
  rules() {
    return userRoleSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
  }

  static userPermissionRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { userPermissionSchema } from '../schemas/admin.js';

export class UserPermissionRequest extends FormRequest {
  rules() {
    return userPermissionSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
  }

  static exportDataRequest(): string {
    return `import { FormRequest } from '@beeblock/svelar/forms';
import { exportDataSchema } from '../schemas/admin.js';

export class ExportDataRequest extends FormRequest {
  rules() {
    return exportDataSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
  }

  // ─── Admin Resources ─────────────────────────────────────

  static roleResource(): string {
    return `import { Resource } from '@beeblock/svelar/routing';

export class RoleResource extends Resource {
  toJSON() {
    return {
      id: this.data.id,
      name: this.data.name,
      guard: this.data.guard ?? 'web',
      description: this.data.description ?? null,
    };
  }
}
`;
  }

  static permissionResource(): string {
    return `import { Resource } from '@beeblock/svelar/routing';

export class PermissionResource extends Resource {
  toJSON() {
    return {
      id: this.data.id,
      name: this.data.name,
      guard: this.data.guard ?? 'web',
      description: this.data.description ?? null,
    };
  }
}
`;
  }

  // ─── Admin Service ───────────────────────────────────────

  static adminService(): string {
    return `import { Service } from '@beeblock/svelar/services';
import { Permissions } from '@beeblock/svelar/permissions';
import { Queue } from '@beeblock/svelar/queue';
import { UserRepository } from '../repositories/UserRepository.js';
import { Post } from '../models/Post.js';
import { User } from '../models/User.js';
import { ExportDataJob } from '../shared/jobs/ExportDataJob.js';

const userRepo = new UserRepository();

export class AdminService extends Service {
  // ── Users ────────────────────────────────────────

  async listUsers() {
    return User.query().get();
  }

  async updateUserRole(userId: number, role: string) {
    const user = await User.find(userId);
    if (!user) return this.fail('User not found');

    user.role = role;
    await user.save();
    return this.ok(user);
  }

  async deleteUser(userId: number, currentUserId: number) {
    if (userId === currentUserId) {
      return this.fail('Cannot delete your own account');
    }

    const user = await User.find(userId);
    if (!user) return this.fail('User not found');

    if (user.role === 'admin') {
      const adminCount = await User.where('role', '=', 'admin').count();
      if (adminCount <= 1) return this.fail('Cannot delete the last admin user');
    }

    await Post.where('user_id', '=', userId).delete();
    await user.delete();
    return this.ok({ message: 'User deleted successfully' });
  }

  // ── Roles ────────────────────────────────────────

  async createRole(name: string, guard?: string, description?: string) {
    const existing = await Permissions.findRole(name, guard);
    if (existing) return this.fail('Role already exists');

    const role = await Permissions.createRole({ name, guard, description });
    return this.ok(role);
  }

  async deleteRole(name: string, guard?: string) {
    await Permissions.deleteRole(name, guard);
    return this.ok({ message: 'Role deleted' });
  }

  // ── Permissions ──────────────────────────────────

  async createPermission(name: string, guard?: string, description?: string) {
    const existing = await Permissions.findPermission(name, guard);
    if (existing) return this.fail('Permission already exists');

    const perm = await Permissions.createPermission({ name, guard, description });
    return this.ok(perm);
  }

  async deletePermission(name: string, guard?: string) {
    await Permissions.deletePermission(name, guard);
    return this.ok({ message: 'Permission deleted' });
  }

  // ── Role-Permission pivots ───────────────────────

  async attachRolePermission(roleId: number, permissionId: number) {
    await Permissions.giveRolePermission(roleId, permissionId);
    return this.ok({ message: 'Permission attached to role' });
  }

  async detachRolePermission(roleId: number, permissionId: number) {
    await Permissions.revokeRolePermission(roleId, permissionId);
    return this.ok({ message: 'Permission detached from role' });
  }

  // ── User-Role pivots ─────────────────────────────

  async assignUserRole(userId: number, roleId: number) {
    await Permissions.assignRole('User', userId, roleId);
    return this.ok({ message: 'Role assigned to user' });
  }

  async removeUserRole(userId: number, roleId: number) {
    await Permissions.removeRole('User', userId, roleId);
    return this.ok({ message: 'Role removed from user' });
  }

  // ── User-Permission pivots ───────────────────────

  async grantUserPermission(userId: number, permissionId: number) {
    await Permissions.giveModelPermission('User', userId, permissionId);
    return this.ok({ message: 'Permission granted to user' });
  }

  async revokeUserPermission(userId: number, permissionId: number) {
    await Permissions.revokeModelPermission('User', userId, permissionId);
    return this.ok({ message: 'Permission revoked from user' });
  }

  // ── Export ───────────────────────────────────────

  async exportData(userId: number, format: 'csv' | 'json') {
    await Queue.dispatch(new ExportDataJob(userId, format));
    return this.ok({ message: \`Export job dispatched (format: \${format})\` });
  }
}
`;
  }

  static gates(): string {
    return `import { Gate } from '@beeblock/svelar/auth';

Gate.define('admin-access', (user) => user?.role === 'admin');

Gate.define('edit-post', (user, post) => {
  if (!user) return false;
  return user.id === post.user_id || user.role === 'admin';
});

Gate.define('delete-post', (user, post) => {
  if (!user) return false;
  return user.id === post.user_id || user.role === 'admin';
});

Gate.define('manage-users', (user) => user?.role === 'admin');

Gate.defineSuperUser((user) => user?.role === 'admin');
`;
  }

  static authSchema(): string {
    return `import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  password_confirmation: z.string(),
}).refine((data) => data.password === data.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  password_confirmation: z.string(),
}).refine((data) => data.password === data.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
});

export const otpRequestSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

export const otpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, 'Code must be 6 digits'),
});
`;
  }

  static postSchema(): string {
    return `import { z } from 'zod';

export const createPostSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes').optional(),
  body: z.string().min(10, 'Body must be at least 10 characters'),
  published: z.boolean().default(false),
});

export const updatePostSchema = z.object({
  title: z.string().min(3).max(255).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  body: z.string().min(10).optional(),
  published: z.boolean().optional(),
});
`;
  }

  // ─── Migrations ────────────────────────────────────────────

  static createUsersTable(): string {
    return `import { Migration } from '@beeblock/svelar/database';

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
`;
  }

  static createPostsTable(): string {
    return `import { Migration } from '@beeblock/svelar/database';

export default class CreatePostsTable extends Migration {
  async up() {
    await this.schema.createTable('posts', (table) => {
      table.increments('id');
      table.string('title');
      table.string('slug').unique();
      table.text('body');
      table.boolean('published').default(false);
      table.integer('user_id').references('id', 'users');
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('posts');
  }
}
`;
  }

  static createPermissionsTables(): string {
    return `import { Migration } from '@beeblock/svelar/database';

export default class CreatePermissionsTables extends Migration {
  async up() {
    await this.schema.createTable('permissions', (table) => {
      table.increments('id');
      table.string('name');
      table.string('guard').default('web');
      table.text('description').nullable();
      table.timestamps();
    });

    await this.schema.createTable('roles', (table) => {
      table.increments('id');
      table.string('name');
      table.string('guard').default('web');
      table.text('description').nullable();
      table.timestamps();
    });

    await this.schema.createTable('role_has_permissions', (table) => {
      table.integer('role_id').references('id', 'roles');
      table.integer('permission_id').references('id', 'permissions');
    });

    await this.schema.createTable('model_has_roles', (table) => {
      table.string('model_type');
      table.integer('model_id');
      table.integer('role_id').references('id', 'roles');
    });

    await this.schema.createTable('model_has_permissions', (table) => {
      table.string('model_type');
      table.integer('model_id');
      table.integer('permission_id').references('id', 'permissions');
    });
  }

  async down() {
    await this.schema.dropTable('model_has_permissions');
    await this.schema.dropTable('model_has_roles');
    await this.schema.dropTable('role_has_permissions');
    await this.schema.dropTable('roles');
    await this.schema.dropTable('permissions');
  }
}
`;
  }

  static addRoleToUsers(): string {
    return `import { Migration } from '@beeblock/svelar/database';

export default class AddRoleToUsers extends Migration {
  async up() {
    await this.schema.addColumn('users', (table) => {
      table.string('role').default('user');
    });
  }

  async down() {
    await this.schema.dropColumn('users', 'role');
  }
}
`;
  }

  static createSessionsTable(): string {
    return `import { Migration } from '@beeblock/svelar/database';

export default class CreateSessionsTable extends Migration {
  async up() {
    await this.schema.createTable('sessions', (table) => {
      table.string('id').primary();
      table.text('payload');
      table.string('expires_at');
    });
  }

  async down() {
    await this.schema.dropTable('sessions');
  }
}
`;
  }

  static createAuditLogsTable(): string {
    return `import { Migration } from '@beeblock/svelar/database';

export default class CreateAuditLogsTable extends Migration {
  async up() {
    await this.schema.createTable('audit_logs', (table) => {
      table.string('id').primary();
      table.integer('userId').nullable();
      table.string('action');
      table.string('modelType');
      table.string('modelId');
      table.text('oldValues').nullable();
      table.text('newValues').nullable();
      table.text('metadata').nullable();
      table.string('ipAddress').nullable();
      table.string('userAgent').nullable();
      table.integer('timestamp');
    });
  }

  async down() {
    await this.schema.dropTable('audit_logs');
  }
}
`;
  }

  static createNotificationsTable(): string {
    return `import { Migration } from '@beeblock/svelar/database';

export default class CreateNotificationsTable extends Migration {
  async up() {
    await this.schema.createTable('notifications', (table) => {
      table.string('id').primary();
      table.integer('notifiable_id');
      table.string('type');
      table.text('data');
      table.string('read_at').nullable();
      table.string('created_at');
    });
  }

  async down() {
    await this.schema.dropTable('notifications');
  }
}
`;
  }

  static createFailedJobsTable(): string {
    return `import { Migration } from '@beeblock/svelar/database';

export default class CreateFailedJobsTable extends Migration {
  async up() {
    await this.schema.createTable('svelar_failed_jobs', (table) => {
      table.string('id').primary();
      table.string('queue');
      table.string('job_class');
      table.text('payload');
      table.text('exception');
      table.integer('failed_at');
    });
  }

  async down() {
    await this.schema.dropTable('svelar_failed_jobs');
  }
}
`;
  }

  // ─── Seeders ───────────────────────────────────────────────

  static databaseSeeder(): string {
    return `import { Seeder } from '@beeblock/svelar/database';
import { Hash } from '@beeblock/svelar/hashing';
import { Permissions } from '@beeblock/svelar/permissions';
import { User } from '../../models/User.js';
import { Post } from '../../models/Post.js';

export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    // ── Create Permissions ────────────────────────────────
    await Permissions.createPermission({ name: 'manage-users', description: 'Create, edit, delete users' });
    await Permissions.createPermission({ name: 'manage-roles', description: 'Assign and manage roles' });
    await Permissions.createPermission({ name: 'manage-posts', description: 'Edit or delete any post' });
    await Permissions.createPermission({ name: 'create-posts', description: 'Create new posts' });
    await Permissions.createPermission({ name: 'view-dashboard', description: 'Access the dashboard' });
    await Permissions.createPermission({ name: 'view-admin', description: 'Access admin panel' });

    // ── Create Roles ─────────────────────────────────────
    const adminRole = await Permissions.createRole({ name: 'admin', description: 'Full access to everything' });
    const editorRole = await Permissions.createRole({ name: 'editor', description: 'Can manage posts' });
    const userRole = await Permissions.createRole({ name: 'user', description: 'Regular user' });

    // ── Assign Permissions to Roles ──────────────────────
    const allPerms = await Permissions.allPermissions();
    for (const perm of allPerms) {
      await Permissions.giveRolePermission(adminRole.id, perm.id);
    }

    const editorPerms = ['manage-posts', 'create-posts', 'view-dashboard'];
    for (const permName of editorPerms) {
      const perm = allPerms.find((p) => p.name === permName);
      if (perm) await Permissions.giveRolePermission(editorRole.id, perm.id);
    }

    const userPerms = ['create-posts', 'view-dashboard'];
    for (const permName of userPerms) {
      const perm = allPerms.find((p) => p.name === permName);
      if (perm) await Permissions.giveRolePermission(userRole.id, perm.id);
    }

    // ── Create Admin User ────────────────────────────────
    // WARNING: Change these credentials before deploying to production!
    const adminPassword = await Hash.make('admin123');
    const admin = await User.create({
      name: 'Admin',
      email: 'admin@svelar.dev',
      password: adminPassword,
      role: 'admin',
    });
    await Permissions.assignRole('User', (admin as any).id, adminRole.id);

    // ── Create Demo User ─────────────────────────────────
    // WARNING: Remove this user before deploying to production!
    const demoPassword = await Hash.make('password');
    const demo = await User.create({
      name: 'Demo User',
      email: 'demo@svelar.dev',
      password: demoPassword,
      role: 'user',
    });
    await Permissions.assignRole('User', (demo as any).id, userRole.id);

    // ── Create Sample Posts ──────────────────────────────
    await Post.create({
      title: 'Getting Started with Svelar',
      slug: 'getting-started-with-svelar',
      body: 'Svelar brings Laravel-style conventions to SvelteKit. Models, migrations, middleware, and more.',
      published: true,
      user_id: (admin as any).id,
    });

    await Post.create({
      title: 'Eloquent-Style ORM in TypeScript',
      slug: 'eloquent-style-orm-in-typescript',
      body: 'Query your database with a fluent API: User.where("active", true).with("posts").orderBy("name").get().',
      published: true,
      user_id: (demo as any).id,
    });

    await Post.create({
      title: 'Draft Post',
      slug: 'draft-post',
      body: 'This is a draft post that is not published yet. It demonstrates the published/unpublished toggle.',
      published: false,
      user_id: (demo as any).id,
    });

    console.log('[Seeder] Database seeded successfully.');
    console.log('[Seeder] Admin: admin@svelar.dev / admin123');
    console.log('[Seeder] Demo:  demo@svelar.dev / password');
  }
}
`;
  }

  // ─── Auth Pages ────────────────────────────────────────────

  static loginPageServer(): string {
    return `import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { loginSchema } from '$lib/schemas/auth';
import { AuthService } from '$lib/services/AuthService';
import { authConfig } from '../../app.js';

const authService = new AuthService();

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) throw redirect(302, '/dashboard');

  const form = await superValidate(zod(loginSchema));
  return { form, otpEnabled: authConfig.otpEnabled };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(request, zod(loginSchema));

    if (!form.valid) {
      return fail(400, { form });
    }

    const result = await authService.login(form.data.email, form.data.password);

    if (!result.success) {
      return message(form, 'Invalid email or password', { status: 401 });
    }

    const user = result.data!;
    locals.session.set('auth_user_id', (user as any).id);
    locals.session.regenerateId();

    throw redirect(302, '/dashboard');
  },
};
`;
  }

  static loginPageSvelte(): string {
    return `<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  const { form, errors, message, enhance, delayed } = superForm(data.form, {
    onResult: ({ result }) => {
      if (result.type === 'failure') {
        $form.password = '';
      }
    },
  });
</script>

<svelte:head>
  <title>Sign In</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Sign In</CardTitle>
      <CardDescription>Enter your credentials to access your account</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance class="space-y-4">
        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            bind:value={$form.email}
            aria-invalid={$errors.email ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.email}
            <p class="text-sm text-red-600">{$errors.email[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="Enter your password"
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password}
            <p class="text-sm text-red-600">{$errors.password[0]}</p>
          {/if}
        </div>

        <div class="flex items-center justify-between">
          <Button type="submit" class="w-full" disabled={$delayed}>
            {$delayed ? 'Signing in...' : 'Sign In'}
          </Button>
        </div>

        <div class="text-center">
          <a href="/forgot-password" class="text-sm text-gray-600 hover:text-brand hover:underline">Forgot your password?</a>
        </div>

        {#if data.otpEnabled}
          <div class="text-center">
            <a href="/otp-login" class="text-sm text-gray-600 hover:text-brand hover:underline">Sign in with a code instead</a>
          </div>
        {/if}
      </form>
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-gray-600">
        Don't have an account?
        <a href="/register" class="font-medium text-brand hover:underline">Create one</a>
      </p>
    </CardFooter>
  </Card>
</div>
`;
  }

  static registerPageServer(): string {
    return `import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message, setError } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { registerSchema } from '$lib/schemas/auth';
import { AuthService } from '$lib/services/AuthService';
import { auth, authConfig } from '../../app.js';

const authService = new AuthService();

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) throw redirect(302, '/dashboard');

  const form = await superValidate(zod(registerSchema));
  return { form };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(request, zod(registerSchema));

    if (!form.valid) {
      return fail(400, { form });
    }

    const result = await authService.register({
      name: form.data.name,
      email: form.data.email,
      password: form.data.password,
    });

    if (!result.success) {
      if (result.error?.includes('Email')) {
        return setError(form, 'email', result.error);
      }
      return message(form, result.error || 'Registration failed', { status: 422 });
    }

    const user = result.data!;
    locals.session.set('auth_user_id', (user as any).id);
    locals.session.regenerateId();

    // Send verification email if required
    if (authConfig.emailVerificationRequired) {
      try { await auth.sendVerificationEmail(user as any); } catch {}
    }

    throw redirect(302, '/dashboard');
  },
};
`;
  }

  static registerPageSvelte(): string {
    return `<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  const { form, errors, message, enhance, delayed } = superForm(data.form);
</script>

<svelte:head>
  <title>Create Account</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Create Account</CardTitle>
      <CardDescription>Fill in the details below to get started</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance class="space-y-4">
        <div class="space-y-2">
          <Label for="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="Your name"
            bind:value={$form.name}
            aria-invalid={$errors.name ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.name}
            <p class="text-sm text-red-600">{$errors.name[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            bind:value={$form.email}
            aria-invalid={$errors.email ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.email}
            <p class="text-sm text-red-600">{$errors.email[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="At least 8 characters"
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password}
            <p class="text-sm text-red-600">{$errors.password[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password_confirmation">Confirm Password</Label>
          <Input
            id="password_confirmation"
            name="password_confirmation"
            type="password"
            placeholder="Repeat your password"
            bind:value={$form.password_confirmation}
            aria-invalid={$errors.password_confirmation ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password_confirmation}
            <p class="text-sm text-red-600">{$errors.password_confirmation[0]}</p>
          {/if}
        </div>

        <Button type="submit" class="w-full" disabled={$delayed}>
          {$delayed ? 'Creating account...' : 'Create Account'}
        </Button>
      </form>
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-gray-600">
        Already have an account?
        <a href="/login" class="font-medium text-brand hover:underline">Sign in</a>
      </p>
    </CardFooter>
  </Card>
</div>
`;
  }

  static logoutPageServer(): string {
    return `import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types.js';

export const actions: Actions = {
  default: async (event) => {
    event.locals.session.forget('auth_user_id');
    event.locals.session.regenerateId();
    throw redirect(302, '/');
  },
};
`;
  }

  // ─── Forgot Password ────────────────────────────────────────

  static forgotPasswordPageServer(): string {
    return `import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { forgotPasswordSchema } from '$lib/schemas/auth';
import { auth } from '../../app.js';

export const load: PageServerLoad = async () => {
  const form = await superValidate(zod(forgotPasswordSchema));
  return { form };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, zod(forgotPasswordSchema));

    if (!form.valid) {
      return fail(400, { form });
    }

    await auth.sendPasswordReset(form.data.email);

    return message(form, 'If that email exists, a reset link has been sent. Check your inbox.');
  },
};
`;
  }

  static forgotPasswordPageSvelte(): string {
    return `<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  const { form, errors, message, enhance, delayed } = superForm(data.form);

  // Track if form was submitted successfully
  let submitted = $derived($message && !$errors.email);
</script>

<svelte:head>
  <title>Forgot Password</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Forgot Password</CardTitle>
      <CardDescription>Enter your email and we'll send you a reset link</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="default">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      {#if !submitted}
        <form method="POST" use:enhance class="space-y-4">
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              bind:value={$form.email}
              aria-invalid={$errors.email ? 'true' : undefined}
              disabled={$delayed}
            />
            {#if $errors.email}
              <p class="text-sm text-red-600">{$errors.email[0]}</p>
            {/if}
          </div>

          <Button type="submit" class="w-full" disabled={$delayed}>
            {$delayed ? 'Sending...' : 'Send Reset Link'}
          </Button>
        </form>
      {/if}
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-gray-600">
        Remember your password?
        <a href="/login" class="font-medium text-brand hover:underline">Sign in</a>
      </p>
    </CardFooter>
  </Card>
</div>
`;
  }

  // ─── Reset Password ────────────────────────────────────────

  static resetPasswordPageServer(): string {
    return `import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { resetPasswordSchema } from '$lib/schemas/auth';
import { auth } from '../../app.js';

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get('token') ?? '';
  const email = url.searchParams.get('email') ?? '';

  if (!token || !email) {
    throw redirect(302, '/forgot-password');
  }

  const form = await superValidate({ token, email, password: '', password_confirmation: '' }, zod(resetPasswordSchema));
  return { form };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, zod(resetPasswordSchema));

    if (!form.valid) {
      return fail(400, { form });
    }

    const success = await auth.resetPassword(form.data.token, form.data.email, form.data.password);

    if (!success) {
      return message(form, 'Invalid or expired reset link. Please request a new one.', { status: 400 });
    }

    throw redirect(302, '/login?reset=success');
  },
};
`;
  }

  static resetPasswordPageSvelte(): string {
    return `<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  const { form, errors, message, enhance, delayed } = superForm(data.form);
</script>

<svelte:head>
  <title>Reset Password</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Reset Password</CardTitle>
      <CardDescription>Enter your new password below</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance class="space-y-4">
        <input type="hidden" name="token" value={$form.token} />
        <input type="hidden" name="email" value={$form.email} />

        <div class="space-y-2">
          <Label for="password">New Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="At least 8 characters"
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password}
            <p class="text-sm text-red-600">{$errors.password[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password_confirmation">Confirm Password</Label>
          <Input
            id="password_confirmation"
            name="password_confirmation"
            type="password"
            placeholder="Repeat your password"
            bind:value={$form.password_confirmation}
            aria-invalid={$errors.password_confirmation ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password_confirmation}
            <p class="text-sm text-red-600">{$errors.password_confirmation[0]}</p>
          {/if}
        </div>

        <Button type="submit" class="w-full" disabled={$delayed}>
          {$delayed ? 'Resetting...' : 'Reset Password'}
        </Button>
      </form>
    </CardContent>
  </Card>
</div>
`;
  }

  // ─── OTP Login ─────────────────────────────────────────────

  static otpLoginPageServer(): string {
    return `import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { otpRequestSchema, otpVerifySchema } from '$lib/schemas/auth';
import { auth, authConfig } from '../../app.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (!authConfig.otpEnabled) throw redirect(302, '/login');
  if (locals.user) throw redirect(302, '/dashboard');

  const requestForm = await superValidate(zod(otpRequestSchema));
  const verifyForm = await superValidate(zod(otpVerifySchema));
  return { requestForm, verifyForm };
};

export const actions: Actions = {
  send: async ({ request }) => {
    const form = await superValidate(request, zod(otpRequestSchema));

    if (!form.valid) {
      return fail(400, { requestForm: form });
    }

    await auth.sendOtp(form.data.email);

    return { requestForm: form, codeSent: true, email: form.data.email };
  },

  verify: async ({ request, locals }) => {
    const form = await superValidate(request, zod(otpVerifySchema));

    if (!form.valid) {
      return fail(400, { verifyForm: form });
    }

    const user = await auth.attemptOtp(form.data.email, form.data.code, locals.session);

    if (!user) {
      return message(form, 'Invalid or expired code. Please try again.', { status: 401 });
    }

    throw redirect(302, '/dashboard');
  },
};
`;
  }

  static otpLoginPageSvelte(): string {
    return `<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';
  import { page } from '$app/state';

  let { data } = $props();

  // Two-step form: request code, then verify code
  let codeSent = $state(false);
  let email = $state('');

  const requestSuperForm = superForm(data.requestForm, {
    onResult: ({ result }) => {
      if (result.type === 'success' && result.data?.codeSent) {
        codeSent = true;
        email = result.data.email;
      }
    },
  });

  const verifySuperForm = superForm(data.verifyForm);
</script>

<svelte:head>
  <title>Sign In with Code</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Sign In with Code</CardTitle>
      <CardDescription>
        {#if codeSent}
          Enter the 6-digit code sent to {email}
        {:else}
          We'll send a one-time code to your email
        {/if}
      </CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if verifySuperForm.message}
        <Alert variant="destructive">
          <span class="text-sm">{verifySuperForm.message}</span>
        </Alert>
      {/if}

      {#if !codeSent}
        <form method="POST" action="?/send" use:requestSuperForm.enhance class="space-y-4">
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              bind:value={requestSuperForm.form.email}
              aria-invalid={requestSuperForm.errors.email ? 'true' : undefined}
              disabled={requestSuperForm.delayed}
            />
            {#if requestSuperForm.errors.email}
              <p class="text-sm text-red-600">{requestSuperForm.errors.email[0]}</p>
            {/if}
          </div>

          <Button type="submit" class="w-full" disabled={requestSuperForm.delayed}>
            {requestSuperForm.delayed ? 'Sending...' : 'Send Code'}
          </Button>
        </form>
      {:else}
        <form method="POST" action="?/verify" use:verifySuperForm.enhance class="space-y-4">
          <input type="hidden" name="email" value={email} />

          <div class="space-y-2">
            <Label for="code">Verification Code</Label>
            <Input
              id="code"
              name="code"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength={6}
              placeholder="000000"
              bind:value={verifySuperForm.form.code}
              aria-invalid={verifySuperForm.errors.code ? 'true' : undefined}
              disabled={verifySuperForm.delayed}
              class="text-center text-2xl tracking-[0.5em] font-mono"
            />
            {#if verifySuperForm.errors.code}
              <p class="text-sm text-red-600">{verifySuperForm.errors.code[0]}</p>
            {/if}
          </div>

          <Button type="submit" class="w-full" disabled={verifySuperForm.delayed}>
            {verifySuperForm.delayed ? 'Verifying...' : 'Verify & Sign In'}
          </Button>

          <button
            type="button"
            class="w-full text-sm text-gray-600 hover:text-brand hover:underline"
            onclick={() => { codeSent = false; }}
          >
            Use a different email
          </button>
        </form>
      {/if}
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-gray-600">
        Prefer a password?
        <a href="/login" class="font-medium text-brand hover:underline">Sign in with password</a>
      </p>
    </CardFooter>
  </Card>
</div>
`;
  }

  // ─── Verify Email ──────────────────────────────────────────

  static verifyEmailPageServer(): string {
    return `import type { PageServerLoad } from './$types';
import { auth } from '../../app.js';

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get('token');
  const id = url.searchParams.get('id');

  if (!token || !id) {
    return { success: false, message: 'Invalid verification link.' };
  }

  const success = await auth.verifyEmail(token, id);

  if (success) {
    return { success: true, message: 'Your email has been verified!' };
  }

  return { success: false, message: 'Invalid or expired verification link. Please request a new one.' };
};
`;
  }

  static verifyEmailPageSvelte(): string {
    return `<script lang="ts">
  import { Card, CardHeader, CardTitle, CardContent, CardFooter, Alert, Button } from '@beeblock/svelar/ui';

  let { data } = $props();
</script>

<svelte:head>
  <title>Verify Email</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Email Verification</CardTitle>
    </CardHeader>

    <CardContent>
      {#if data.success}
        <Alert variant="default">
          <span class="text-sm">{data.message}</span>
        </Alert>
      {:else}
        <Alert variant="destructive">
          <span class="text-sm">{data.message}</span>
        </Alert>
      {/if}
    </CardContent>

    <CardFooter class="border-t pt-6">
      <div class="w-full text-center">
        {#if data.success}
          <a href="/dashboard">
            <Button class="w-full">Go to Dashboard</Button>
          </a>
        {:else}
          <a href="/login">
            <Button variant="outline" class="w-full">Back to Sign In</Button>
          </a>
        {/if}
      </div>
    </CardFooter>
  </Card>
</div>
`;
  }

  // ─── Dashboard Pages ──────────────────────────────────────

  static dashboardLayoutServer(): string {
    return `import { guardAuth } from '@beeblock/svelar/auth';

export const load = guardAuth();
`;
  }

  static dashboardLayoutSvelte(): string {
    return `<script lang="ts">
  import { page } from '\$app/stores';
  import type { Snippet } from 'svelte';
  import { Icon } from '@beeblock/svelar/ui';
  import LayoutDashboard from 'lucide-svelte/icons/layout-dashboard';
  import KeyRound from 'lucide-svelte/icons/key-round';
  import Users from 'lucide-svelte/icons/users';
  import Settings from 'lucide-svelte/icons/settings';

  interface Props {
    data: any;
    children: Snippet;
  }

  let { data, children }: Props = \$props();

  const navItems = [
    { href: '/dashboard', label: 'Overview', exact: true, icon: LayoutDashboard },
    { href: '/dashboard/api-keys', label: 'API Keys', exact: false, icon: KeyRound },
    { href: '/dashboard/team', label: 'Team', exact: false, icon: Users },
  ];

  function isActive(href: string, exact: boolean, pathname: string): boolean {
    return exact ? pathname === href : pathname.startsWith(href);
  }
</script>

<div class="flex min-h-[calc(100vh-130px)]">
  <aside class="w-64 border-r border-gray-200 bg-gray-50 hidden md:block">
    <nav class="p-4 space-y-1">
      {#each navItems as item}
        {@const active = isActive(item.href, item.exact, \$page.url.pathname)}
        <a
          href={item.href}
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors {active ? 'bg-brand/10 text-brand' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}"
        >
          <Icon icon={item.icon} size={20} class={active ? 'text-brand' : 'text-gray-400'} />
          {item.label}
        </a>
      {/each}
    </nav>

    {#if data.user?.role === 'admin'}
      <div class="border-t border-gray-200 mx-4 my-2"></div>
      <div class="p-4 pt-0">
        <a
          href="/admin"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <Icon icon={Settings} size={20} class="text-gray-400" />
          Admin Panel
        </a>
      </div>
    {/if}
  </aside>

  <div class="flex-1 p-6 md:p-8">
    {@render children()}
  </div>
</div>
`;
  }

  static dashboardPageServer(): string {
    return `import type { PageServerLoad } from './$types';
import { ApiKeys } from '@beeblock/svelar/api-keys';
import { Teams } from '@beeblock/svelar/teams';

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user as any;

  let apiKeyCount = 0;
  let teamCount = 0;

  try {
    const keys = await ApiKeys.listForUser(user.id);
    apiKeyCount = keys?.length ?? 0;
  } catch {}

  try {
    const teams = await Teams.getUserTeams(user.id);
    teamCount = teams?.length ?? 0;
  } catch {}

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role ?? 'user',
    },
    stats: {
      apiKeyCount,
      teamCount,
    },
  };
};
`;
  }

  static dashboardPageSvelte(): string {
    return `<script lang="ts">
  import { Button, Badge, Card, CardHeader, CardTitle, CardContent } from '@beeblock/svelar/ui';

  let { data } = $props();
</script>

<svelte:head>
  <title>Dashboard</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
    <p class="text-gray-600">Welcome back, {data.user.name}</p>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <Card>
      <CardContent class="pt-6">
        <p class="text-sm text-gray-600">API Keys</p>
        <p class="text-3xl font-bold text-brand mt-2">{data.stats.apiKeyCount}</p>
        <a href="/dashboard/api-keys" class="text-sm text-brand hover:underline mt-2 inline-block">Manage keys</a>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="pt-6">
        <p class="text-sm text-gray-600">Teams</p>
        <p class="text-3xl font-bold text-brand mt-2">{data.stats.teamCount}</p>
        <a href="/dashboard/team" class="text-sm text-brand hover:underline mt-2 inline-block">Manage team</a>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="pt-6">
        <p class="text-sm text-gray-600">Account</p>
        <Badge variant="default" class="mt-2">{data.user.role}</Badge>
      </CardContent>
    </Card>
  </div>

  <Card>
    <CardHeader>
      <CardTitle>Quick Actions</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-wrap gap-3">
      <a href="/dashboard/api-keys"><Button variant="outline">Create API Key</Button></a>
      <a href="/dashboard/team"><Button variant="outline">Invite Team Member</Button></a>
      {#if data.user.role === 'admin'}
        <a href="/admin"><Button variant="outline">Admin Panel</Button></a>
      {/if}
    </CardContent>
  </Card>
</div>
`;
  }

  static apiKeysPageServer(): string {
    return `import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiKeys } from '@beeblock/svelar/api-keys';

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user as any;
  let keys: any[] = [];

  try {
    keys = await ApiKeys.listForUser(user.id);
  } catch {}

  return {
    user: { id: user.id, name: user.name, email: user.email },
    apiKeys: keys.map((k: any) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      permissions: k.permissions ?? [],
      lastUsedAt: k.lastUsedAt ?? null,
      createdAt: k.createdAt,
    })),
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });

    const data = await request.formData();
    const name = data.get('name') as string;
    const permissions = (data.get('permissions') as string || 'read').split(',').map(p => p.trim());

    if (!name?.trim()) {
      return fail(400, { error: 'Key name is required' });
    }

    try {
      const { plainTextKey, record } = await ApiKeys.create({
        name,
        userId: (locals.user as any).id,
        permissions,
      });

      return { success: true, plainTextKey, keyId: record.id };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to create key' });
    }
  },

  revoke: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });

    const data = await request.formData();
    const keyId = data.get('keyId') as string;

    if (!keyId) {
      return fail(400, { error: 'Key ID is required' });
    }

    try {
      await ApiKeys.revoke(keyId);
      return { success: true, revoked: true };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to revoke key' });
    }
  },
};
`;
  }

  static apiKeysPageSvelte(): string {
    return `<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Input, Label, Alert } from '@beeblock/svelar/ui';

  let { data, form: actionData } = $props();
  let apiKeys = $state(data.apiKeys);
  let showCreateForm = $state(false);
  let newKeyName = $state('');
  let newKeyPermissions = $state('read');
  let generatedKey = $state('');
  let showCopyAlert = $state(false);

  $effect(() => {
    apiKeys = data.apiKeys;
  });

  $effect(() => {
    if (actionData?.plainTextKey) {
      generatedKey = actionData.plainTextKey;
      showCreateForm = false;
      newKeyName = '';
      newKeyPermissions = 'read';
    }
  });

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    showCopyAlert = true;
    setTimeout(() => { showCopyAlert = false; }, 2000);
  }
</script>

<svelte:head>
  <title>API Keys</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">API Keys</h1>
    <p class="text-gray-600 mt-1">Manage your API keys for programmatic access</p>
  </div>

  {#if showCopyAlert}
    <Alert variant="default"><span class="text-sm">Copied to clipboard!</span></Alert>
  {/if}

  {#if actionData?.error}
    <Alert variant="destructive"><span class="text-sm">{actionData.error}</span></Alert>
  {/if}

  {#if generatedKey}
    <Alert variant="default">
      <div class="space-y-2">
        <p class="font-medium">API Key Created</p>
        <p class="text-sm">Copy this key now. You won't be able to see it again.</p>
        <div class="flex gap-2 mt-3">
          <code class="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono break-all">{generatedKey}</code>
          <Button size="sm" variant="outline" onclick={() => copyToClipboard(generatedKey)}>Copy</Button>
        </div>
      </div>
    </Alert>
  {/if}

  {#if showCreateForm}
    <Card>
      <CardHeader><CardTitle>Create New API Key</CardTitle></CardHeader>
      <CardContent>
        <form method="POST" action="?/create" use:enhance class="space-y-4">
          <div class="space-y-2">
            <Label for="keyName">Key Name</Label>
            <Input id="keyName" name="name" placeholder="My API Key" bind:value={newKeyName} required />
          </div>
          <div class="space-y-2">
            <Label for="permissions">Permissions</Label>
            <Input id="permissions" name="permissions" placeholder="read,write" bind:value={newKeyPermissions} />
            <p class="text-xs text-gray-500">Comma-separated: read, write, admin</p>
          </div>
          <div class="flex gap-2">
            <Button type="submit">Create Key</Button>
            <Button type="button" variant="outline" onclick={() => { showCreateForm = false; newKeyName = ''; }}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  {:else}
    <Button onclick={() => (showCreateForm = true)}>Create New Key</Button>
  {/if}

  <div class="space-y-4">
    <h2 class="text-xl font-bold text-gray-900">Your Keys ({apiKeys.length})</h2>

    {#if apiKeys.length === 0}
      <Card>
        <CardContent class="pt-8 text-center">
          <p class="text-gray-500 text-sm">No API keys yet. Create one to get started.</p>
        </CardContent>
      </Card>
    {:else}
      <div class="space-y-3">
        {#each apiKeys as key (key.id)}
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1">
                  <div class="flex items-center gap-2 mb-2">
                    <h3 class="font-semibold text-gray-900">{key.name}</h3>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <p class="font-mono text-xs bg-gray-100 px-2 py-1 rounded inline-block mb-2">{key.prefix}........</p>
                  <div class="flex gap-4 text-xs text-gray-500">
                    <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                    <span>{key.lastUsedAt ? 'Last used ' + new Date(key.lastUsedAt).toLocaleDateString() : 'Never used'}</span>
                  </div>
                  {#if key.permissions.length > 0}
                    <div class="flex gap-1 mt-2">
                      {#each key.permissions as perm}
                        <Badge variant="secondary" class="text-xs">{perm}</Badge>
                      {/each}
                    </div>
                  {/if}
                </div>
                <form method="POST" action="?/revoke" use:enhance>
                  <input type="hidden" name="keyId" value={key.id} />
                  <Button size="sm" variant="destructive" type="submit"
                    onclick={(e) => { if (!confirm('Revoke key "' + key.name + '"?')) e.preventDefault(); }}>
                    Revoke
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <Card>
    <CardHeader><CardTitle>Usage</CardTitle></CardHeader>
    <CardContent>
      <h4 class="font-medium text-gray-900 mb-2">Include your API key in the Authorization header</h4>
      <code class="block bg-gray-100 px-4 py-3 rounded text-sm font-mono overflow-x-auto">
        curl -H "Authorization: Bearer sk_your_key_here" https://your-app.com/api/v1/data
      </code>
    </CardContent>
  </Card>
</div>
`;
  }

  static teamPageServer(): string {
    return `import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { Teams } from '@beeblock/svelar/teams';

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user as any;

  let teams: any[] = [];
  try {
    teams = await Teams.getUserTeams(user.id);
  } catch {}

  if (teams.length === 0) {
    try {
      const team = await Teams.create({
        name: user.name + "'s Team",
        ownerId: user.id,
        personalTeam: true,
      });
      teams = [team];
    } catch {}
  }

  const currentTeam = teams[0] ?? null;
  let members: any[] = [];
  let invitations: any[] = [];

  if (currentTeam) {
    try { members = await Teams.getMembers(currentTeam.id); } catch {}
    try { invitations = await Teams.getPendingInvitations(currentTeam.id); } catch {}
  }

  return {
    user: { id: user.id, name: user.name, email: user.email },
    team: currentTeam ? { id: currentTeam.id, name: currentTeam.name, slug: currentTeam.slug } : null,
    members: members.map((m: any) => ({ id: m.id, userId: m.userId, role: m.role, joinedAt: m.joinedAt })),
    invitations: invitations.map((i: any) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt })),
  };
};

export const actions: Actions = {
  invite: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });
    const data = await request.formData();
    const email = data.get('email') as string;
    const role = data.get('role') as string || 'member';
    const teamId = data.get('teamId') as string;
    if (!email?.trim()) return fail(400, { error: 'Email is required' });
    try {
      await Teams.invite(teamId, email, role);
      return { success: true, invited: email };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to send invitation' });
    }
  },

  updateRole: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });
    const data = await request.formData();
    try {
      await Teams.updateMemberRole(data.get('teamId') as string, data.get('userId') as string, data.get('role') as string);
      return { success: true };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to update role' });
    }
  },

  removeMember: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });
    const data = await request.formData();
    try {
      await Teams.removeMember(data.get('teamId') as string, data.get('userId') as string);
      return { success: true, removed: true };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to remove member' });
    }
  },

  cancelInvitation: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });
    const data = await request.formData();
    try {
      await Teams.cancelInvitation(data.get('invitationId') as string);
      return { success: true, cancelled: true };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to cancel invitation' });
    }
  },

  updateTeam: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthenticated' });
    const data = await request.formData();
    const name = data.get('name') as string;
    if (!name?.trim()) return fail(400, { error: 'Team name is required' });
    try {
      await Teams.update(data.get('teamId') as string, { name });
      return { success: true, updated: true };
    } catch (err: any) {
      return fail(500, { error: err.message || 'Failed to update team' });
    }
  },
};
`;
  }

  static teamPageSvelte(): string {
    return `<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Alert } from '@beeblock/svelar/ui';

  let { data, form: actionData } = $props();
  let members = $state(data.members);
  let invitations = $state(data.invitations);
  let teamName = $state(data.team?.name ?? '');
  let showInviteForm = $state(false);
  let alertMessage = $state('');
  let alertType = $state<'success' | 'error'>('success');

  $effect(() => {
    members = data.members;
    invitations = data.invitations;
    teamName = data.team?.name ?? '';
  });

  $effect(() => {
    if (actionData?.invited) { alertMessage = 'Invitation sent to ' + actionData.invited; alertType = 'success'; showInviteForm = false; }
    if (actionData?.removed) { alertMessage = 'Member removed'; alertType = 'success'; }
    if (actionData?.cancelled) { alertMessage = 'Invitation cancelled'; alertType = 'success'; }
    if (actionData?.updated) { alertMessage = 'Team updated'; alertType = 'success'; }
    if (actionData?.error) { alertMessage = actionData.error; alertType = 'error'; }
  });
</script>

<svelte:head>
  <title>Team</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">Team</h1>
    <p class="text-gray-600 mt-1">Manage your team members and invitations</p>
  </div>

  {#if alertMessage}
    <Alert variant={alertType === 'error' ? 'destructive' : 'default'}>
      <span class="text-sm">{alertMessage}</span>
    </Alert>
  {/if}

  {#if data.team}
    <Card>
      <CardHeader><CardTitle>Team Info</CardTitle></CardHeader>
      <CardContent>
        <form method="POST" action="?/updateTeam" use:enhance class="space-y-4">
          <input type="hidden" name="teamId" value={data.team.id} />
          <div>
            <Label for="teamName">Team Name</Label>
            <div class="flex gap-2 mt-2">
              <Input id="teamName" name="name" bind:value={teamName} class="flex-1" />
              <Button type="submit">Save</Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Invite Member</CardTitle>
        <CardDescription>Invite someone to join your team</CardDescription>
      </CardHeader>
      <CardContent>
        {#if showInviteForm}
          <form method="POST" action="?/invite" use:enhance class="space-y-4">
            <input type="hidden" name="teamId" value={data.team.id} />
            <div>
              <Label for="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="member@example.com" required class="mt-2" />
            </div>
            <div>
              <Label for="role">Role</Label>
              <select id="role" name="role" class="mt-2 w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div class="flex gap-2">
              <Button type="submit">Send Invite</Button>
              <Button type="button" variant="outline" onclick={() => (showInviteForm = false)}>Cancel</Button>
            </div>
          </form>
        {:else}
          <Button onclick={() => (showInviteForm = true)}>Invite Member</Button>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>{members.length} member(s)</CardDescription>
      </CardHeader>
      <CardContent>
        {#if members.length > 0}
          <div class="space-y-3">
            {#each members as member (member.id)}
              <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                <div>
                  <p class="font-medium text-gray-900">
                    {member.userId == data.user.id ? data.user.name + ' (you)' : 'User #' + member.userId}
                  </p>
                  <p class="text-xs text-gray-500">Joined {new Date(member.joinedAt).toLocaleDateString()}</p>
                </div>
                <div class="flex items-center gap-2">
                  <Badge variant={member.role === 'owner' ? 'destructive' : 'default'}>
                    {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                  </Badge>
                  {#if member.role !== 'owner' && member.userId != data.user.id}
                    <form method="POST" action="?/removeMember" use:enhance>
                      <input type="hidden" name="teamId" value={data.team.id} />
                      <input type="hidden" name="userId" value={member.userId} />
                      <Button size="sm" variant="destructive" type="submit"
                        onclick={(e) => { if (!confirm('Remove this member?')) e.preventDefault(); }}>
                        Remove
                      </Button>
                    </form>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-gray-500 text-center py-4">No members yet</p>
        {/if}
      </CardContent>
    </Card>

    {#if invitations.length > 0}
      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>{invitations.length} pending</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-2">
            {#each invitations as inv (inv.id)}
              <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg bg-gray-50">
                <div>
                  <p class="font-medium text-gray-900">{inv.email}</p>
                  <p class="text-xs text-gray-600">Expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                </div>
                <div class="flex items-center gap-2">
                  <Badge variant="secondary">{inv.role}</Badge>
                  <form method="POST" action="?/cancelInvitation" use:enhance>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <Button size="sm" variant="outline" type="submit">Cancel</Button>
                  </form>
                </div>
              </div>
            {/each}
          </div>
        </CardContent>
      </Card>
    {/if}
  {:else}
    <Card>
      <CardContent class="pt-8 text-center">
        <p class="text-gray-500">Could not load team data. Try refreshing the page.</p>
      </CardContent>
    </Card>
  {/if}
</div>
`;
  }

  // ─── Admin Pages ──────────────────────────────────────────

  static adminLayoutServer(): string {
    return `import { guardAuth } from '@beeblock/svelar/auth';

export const load = guardAuth('/dashboard', { role: 'admin' });
`;
  }

  static adminLayoutSvelte(): string {
    return `<script lang="ts">
  import { page } from '\$app/stores';
  import type { Snippet } from 'svelte';
  import { Icon } from '@beeblock/svelar/ui';
  import LayoutDashboard from 'lucide-svelte/icons/layout-dashboard';
  import Users from 'lucide-svelte/icons/users';
  import ShieldCheck from 'lucide-svelte/icons/shield-check';
  import Lock from 'lucide-svelte/icons/lock';
  import ListTodo from 'lucide-svelte/icons/list-todo';
  import Clock from 'lucide-svelte/icons/clock';
  import FileText from 'lucide-svelte/icons/file-text';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';

  interface Props {
    data: any;
    children: Snippet;
  }

  let { data, children }: Props = \$props();

  const navItems = [
    { tab: 'overview', label: 'Overview', icon: LayoutDashboard },
    { tab: 'users', label: 'Users', icon: Users },
    { tab: 'roles', label: 'Roles', icon: ShieldCheck },
    { tab: 'permissions', label: 'Permissions', icon: Lock },
    { tab: 'queue', label: 'Queue', icon: ListTodo },
    { tab: 'scheduler', label: 'Scheduler', icon: Clock },
    { tab: 'logs', label: 'Logs', icon: FileText },
  ];

  function isActive(tab: string, currentUrl: URL): boolean {
    const activeTab = currentUrl.searchParams.get('tab') ?? 'overview';
    return activeTab === tab;
  }
</script>

<div class="flex min-h-[calc(100vh-130px)]">
  <aside class="w-64 border-r border-gray-200 bg-gray-50 hidden md:block">
    <div class="p-4 border-b border-gray-200">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Administration</p>
    </div>
    <nav class="p-4 space-y-1">
      {#each navItems as item}
        {@const active = isActive(item.tab, \$page.url)}
        <a
          href="/admin?tab={item.tab}"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors {active ? 'bg-brand/10 text-brand' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}"
        >
          <Icon icon={item.icon} size={20} class={active ? 'text-brand' : 'text-gray-400'} />
          {item.label}
        </a>
      {/each}
    </nav>

    <div class="border-t border-gray-200 mx-4 my-2"></div>
    <div class="p-4 pt-0">
      <a
        href="/dashboard"
        class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        <Icon icon={ArrowLeft} size={20} class="text-gray-400" />
        Back to Dashboard
      </a>
    </div>
  </aside>

  <div class="flex-1 p-6 md:p-8">
    {@render children()}
  </div>
</div>
`;
  }

  static adminPageServer(): string {
    return `import type { ServerLoadEvent } from '@sveltejs/kit';
import { User } from '$lib/models/User.js';
import { Post } from '$lib/models/Post.js';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';
import { LogViewer } from '@beeblock/svelar/logging/LogViewer';
import { Permissions } from '@beeblock/svelar/permissions';

export async function load(event: ServerLoadEvent) {
  const user = event.locals.user;

  // Fetch all users
  const users = await User.query().get();

  // Fetch stats
  const userCount = users.length;
  const postCount = await Post.count();

  const roleDistribution = {
    admin: users.filter((u: any) => u.role === 'admin').length,
    user: users.filter((u: any) => u.role === 'user').length,
  };

  // Queue stats from JobMonitor
  let queueCounts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
  try {
    queueCounts = await JobMonitor.getCounts('default');
  } catch { /* sync/memory driver — no counts available */ }

  // Scheduler tasks from ScheduleMonitor
  let scheduledTasks: any[] = [];
  try {
    scheduledTasks = await ScheduleMonitor.listTasks();
  } catch { /* scheduler not configured */ }

  // Recent logs from LogViewer
  let recentLogs: any[] = [];
  let logStats = { totalEntries: 0, byLevel: {} as Record<string, number>, byChannel: {} };
  try {
    recentLogs = LogViewer.query({ limit: 50 });
    logStats = LogViewer.getStats();
  } catch { /* no logs yet */ }

  // System health
  const memUsage = process.memoryUsage();
  const health = {
    status: 'ok',
    uptime: process.uptime(),
    memoryUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    memoryTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
    memoryPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
  };

  // Roles & Permissions
  let roles: any[] = [];
  let permissions: any[] = [];
  let rolePermissionsMap: Record<number, number[]> = {};
  let userRolesMap: Record<number, any[]> = {};
  let userDirectPermsMap: Record<number, any[]> = {};
  try {
    roles = await Permissions.allRoles();
    permissions = await Permissions.allPermissions();

    // Load permissions for each role
    for (const role of roles) {
      const rolePerms = await Permissions.getRolePermissions(role.id);
      rolePermissionsMap[role.id] = rolePerms.map((p: any) => p.id);
    }

    // Load roles and direct permissions for each user
    for (const u of users) {
      userRolesMap[u.id] = await Permissions.getModelRoles('User', u.id);
      userDirectPermsMap[u.id] = await Permissions.getModelDirectPermissions('User', u.id);
    }
  } catch { /* permissions tables may not exist yet */ }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    users: users.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      created_at: u.created_at,
    })),
    stats: {
      userCount,
      postCount,
      roleDistribution,
    },
    queueCounts,
    scheduledTasks: scheduledTasks.map((t: any) => ({
      name: t.name,
      expression: t.expression,
      humanReadable: t.humanReadable,
      enabled: t.enabled,
      isRunning: t.isRunning,
      lastRun: t.lastRun?.toISOString() ?? null,
      lastStatus: t.lastStatus ?? null,
      nextRun: t.nextRun?.toISOString() ?? null,
    })),
    recentLogs: recentLogs.map((l: any) => ({
      timestamp: l.timestamp,
      level: l.level,
      channel: l.channel,
      message: l.message,
    })),
    logStats,
    health,
    roles: roles.map((r: any) => ({
      id: r.id,
      name: r.name,
      guard: r.guard,
      description: r.description,
      created_at: r.created_at,
    })),
    permissions: permissions.map((p: any) => ({
      id: p.id,
      name: p.name,
      guard: p.guard,
      description: p.description,
      created_at: p.created_at,
    })),
    rolePermissionsMap,
    userRolesMap: Object.fromEntries(
      Object.entries(userRolesMap).map(([uid, roles]) => [
        uid,
        roles.map((r: any) => ({ id: r.id, name: r.name })),
      ]),
    ),
    userDirectPermsMap: Object.fromEntries(
      Object.entries(userDirectPermsMap).map(([uid, perms]) => [
        uid,
        perms.map((p: any) => ({ id: p.id, name: p.name })),
      ]),
    ),
  };
}
`;
  }

  static adminPageSvelte(): string {
    return `<script lang="ts">
  import { page } from '\$app/stores';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Alert, Input, Label } from '@beeblock/svelar/ui';

  let { data } = \$props();
  let users = \$state(data.users);
  let message = \$state('');
  let messageType = \$state<'success' | 'error'>('success');

  // Real data from server
  let queueCounts = \$state(data.queueCounts);
  let scheduledTasks = \$state(data.scheduledTasks);
  let recentLogs = \$state(data.recentLogs);
  let logStats = \$state(data.logStats);
  let health = \$state(data.health);

  // Roles & Permissions
  let roles = \$state(data.roles ?? []);
  let permissions = \$state(data.permissions ?? []);
  let rolePermissionsMap = \$state<Record<number, number[]>>(data.rolePermissionsMap ?? {});
  let userRolesMap = \$state<Record<number, { id: number; name: string }[]>>(data.userRolesMap ?? {});
  let userDirectPermsMap = \$state<Record<number, { id: number; name: string }[]>>(data.userDirectPermsMap ?? {});

  // Form state
  let newRoleName = \$state('');
  let newRoleDesc = \$state('');
  let newPermName = \$state('');
  let newPermDesc = \$state('');
  let showRoleForm = \$state(false);
  let showPermForm = \$state(false);

  let logFilter = \$state<'all' | 'info' | 'warn' | 'error'>('all');

  const activeTab = \$derived(\$page.url.searchParams.get('tab') ?? 'overview');

  const filteredLogs = \$derived(
    logFilter === 'all' ? recentLogs : recentLogs.filter((log: any) => log.level === logFilter)
  );

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    message = msg;
    messageType = type;
  }

  async function refreshDashboard() {
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const stats = await res.json();
        if (stats.queue) {
          queueCounts = stats.queue.queues?.default ?? queueCounts;
        }
      }
    } catch { /* ignore refresh errors */ }
  }

  async function updateUserRole(userId: number, newRole: string) {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      });

      if (res.ok) {
        flash('User role updated successfully!');
        await refreshUsers();
      } else {
        const error = await res.json();
        flash(error.message || 'Failed to update user role', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  async function deleteUser(userId: number, userName: string) {
    if (!confirm(\`Are you sure you want to delete \${userName}? This cannot be undone.\`)) {
      return;
    }

    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      if (res.ok) {
        flash('User deleted successfully!');
        await refreshUsers();
      } else {
        const error = await res.json();
        flash(error.message || 'Failed to delete user', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  async function refreshUsers() {
    const res = await fetch('/api/admin/users');
    if (res.ok) {
      const data = await res.json();
      users = data;
    }
  }

  async function retryJob(jobId: string) {
    try {
      const res = await fetch(\`/api/admin/queue/\${jobId}/retry\`, { method: 'POST' });
      if (res.ok) {
        flash('Job queued for retry');
        await refreshQueue();
      }
    } catch {
      flash('Failed to retry job', 'error');
    }
  }

  async function refreshQueue() {
    try {
      const res = await fetch('/api/admin/queue');
      if (res.ok) {
        const data = await res.json();
        queueCounts = data.counts;
      }
    } catch { /* ignore */ }
  }

  async function runTask(taskName: string) {
    try {
      const res = await fetch(\`/api/admin/scheduler/\${taskName}/run\`, { method: 'POST' });
      if (res.ok) {
        flash(\`Task '\${taskName}' triggered\`);
      } else {
        const err = await res.json();
        flash(err.error || 'Failed to run task', 'error');
      }
    } catch {
      flash('Failed to run task', 'error');
    }
  }

  async function toggleTask(taskName: string, enabled: boolean) {
    try {
      const res = await fetch(\`/api/admin/scheduler/\${taskName}/toggle\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        scheduledTasks = scheduledTasks.map((t: any) =>
          t.name === taskName ? { ...t, enabled } : t
        );
        flash(\`Task '\${taskName}' \${enabled ? 'enabled' : 'disabled'}\`);
      }
    } catch {
      flash('Failed to toggle task', 'error');
    }
  }

  // -- Roles CRUD --

  async function createRole() {
    if (!newRoleName.trim()) return;
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoleName.trim(), description: newRoleDesc.trim() || undefined }),
      });
      if (res.ok) {
        const role = await res.json();
        roles = [...roles, role];
        rolePermissionsMap[role.id] = [];
        newRoleName = '';
        newRoleDesc = '';
        showRoleForm = false;
        flash('Role created');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to create role', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  async function deleteRole(name: string) {
    if (!confirm(\`Delete role "\${name}"? This will remove it from all users.\`)) return;
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const deleted = roles.find((r: any) => r.name === name);
        roles = roles.filter((r: any) => r.name !== name);
        if (deleted) delete rolePermissionsMap[deleted.id];
        for (const uid of Object.keys(userRolesMap)) {
          userRolesMap[uid as any] = userRolesMap[uid as any].filter((r: any) => r.name !== name);
        }
        flash('Role deleted');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to delete role', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  // -- Permissions CRUD --

  async function createPermission() {
    if (!newPermName.trim()) return;
    try {
      const res = await fetch('/api/admin/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPermName.trim(), description: newPermDesc.trim() || undefined }),
      });
      if (res.ok) {
        const perm = await res.json();
        permissions = [...permissions, perm];
        newPermName = '';
        newPermDesc = '';
        showPermForm = false;
        flash('Permission created');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to create permission', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  async function deletePermission(name: string) {
    if (!confirm(\`Delete permission "\${name}"? This will revoke it from all roles and users.\`)) return;
    try {
      const res = await fetch('/api/admin/permissions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const deleted = permissions.find((p: any) => p.name === name);
        permissions = permissions.filter((p: any) => p.name !== name);
        if (deleted) {
          for (const rid of Object.keys(rolePermissionsMap)) {
            rolePermissionsMap[rid as any] = rolePermissionsMap[rid as any].filter((pid: number) => pid !== deleted.id);
          }
        }
        flash('Permission deleted');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to delete permission', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  // -- Role <-> Permission --

  async function toggleRolePermission(roleId: number, permissionId: number) {
    const current = rolePermissionsMap[roleId] ?? [];
    const has = current.includes(permissionId);

    try {
      const res = await fetch('/api/admin/role-permissions', {
        method: has ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId, permissionId }),
      });
      if (res.ok) {
        if (has) {
          rolePermissionsMap[roleId] = current.filter((id: number) => id !== permissionId);
        } else {
          rolePermissionsMap[roleId] = [...current, permissionId];
        }
        rolePermissionsMap = { ...rolePermissionsMap };
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to update', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  // -- User <-> Role --

  async function assignRoleToUser(userId: number, roleId: number) {
    try {
      const res = await fetch('/api/admin/user-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roleId }),
      });
      if (res.ok) {
        const role = roles.find((r: any) => r.id === roleId);
        if (role) {
          const current = userRolesMap[userId] ?? [];
          if (!current.some((r: any) => r.id === roleId)) {
            userRolesMap[userId] = [...current, { id: role.id, name: role.name }];
            userRolesMap = { ...userRolesMap };
          }
        }
        flash('Role assigned');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to assign role', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  async function removeRoleFromUser(userId: number, roleId: number) {
    try {
      const res = await fetch('/api/admin/user-roles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roleId }),
      });
      if (res.ok) {
        userRolesMap[userId] = (userRolesMap[userId] ?? []).filter((r: any) => r.id !== roleId);
        userRolesMap = { ...userRolesMap };
        flash('Role removed');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to remove role', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  // -- User <-> Direct Permission --

  async function grantPermToUser(userId: number, permissionId: number) {
    try {
      const res = await fetch('/api/admin/user-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, permissionId }),
      });
      if (res.ok) {
        const perm = permissions.find((p: any) => p.id === permissionId);
        if (perm) {
          const current = userDirectPermsMap[userId] ?? [];
          if (!current.some((p: any) => p.id === permissionId)) {
            userDirectPermsMap[userId] = [...current, { id: perm.id, name: perm.name }];
            userDirectPermsMap = { ...userDirectPermsMap };
          }
        }
        flash('Permission granted');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to grant permission', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  async function revokePermFromUser(userId: number, permissionId: number) {
    try {
      const res = await fetch('/api/admin/user-permissions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, permissionId }),
      });
      if (res.ok) {
        userDirectPermsMap[userId] = (userDirectPermsMap[userId] ?? []).filter((p: any) => p.id !== permissionId);
        userDirectPermsMap = { ...userDirectPermsMap };
        flash('Permission revoked');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to revoke permission', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  function formatDate(date: string | null): string {
    if (!date) return 'Never';
    try {
      return new Date(date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return date;
    }
  }

  function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? \`\${h}h \${m}m\` : \`\${m}m\`;
  }

  function getLogBadgeVariant(level: string): 'default' | 'secondary' | 'destructive' {
    return level === 'error' || level === 'fatal' ? 'destructive' : level === 'warn' ? 'secondary' : 'default';
  }
</script>

<svelte:head>
  <title>Admin Dashboard</title>
</svelte:head>

<div class="space-y-8">
  <div class="flex justify-between items-center">
    <div>
      <h1 class="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
      <p class="text-gray-600 mt-1">System health, queue monitoring, and task management</p>
    </div>
    <Button variant="outline" onclick={refreshDashboard}>Refresh</Button>
  </div>

  {#if message}
    <Alert variant={messageType === 'error' ? 'destructive' : 'success'}>
      <span class="text-sm">{message}</span>
    </Alert>
  {/if}

  <!-- Overview -->
  {#if activeTab === 'overview'}
    <div class="space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Total Users</p>
              <p class="text-3xl font-bold text-[var(--color-brand)] mt-2">{data.stats.userCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Total Posts</p>
              <p class="text-3xl font-bold text-[var(--color-brand)] mt-2">{data.stats.postCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Queue Pending</p>
              <p class="text-3xl font-bold text-yellow-600 mt-2">{queueCounts.waiting}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Failed Jobs</p>
              <p class="text-3xl font-bold text-red-600 mt-2">{queueCounts.failed}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex justify-between text-sm">
            <span>Status</span>
            <Badge variant="default">{health.status}</Badge>
          </div>
          <div class="flex justify-between text-sm">
            <span>Uptime</span>
            <span class="font-medium">{formatUptime(health.uptime)}</span>
          </div>
          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>Memory Usage</span>
              <Badge variant={health.memoryPercent > 90 ? 'destructive' : health.memoryPercent > 70 ? 'secondary' : 'default'}>
                {health.memoryUsedMB} MB / {health.memoryTotalMB} MB ({health.memoryPercent}%)
              </Badge>
            </div>
            <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                class="h-full transition-all"
                class:bg-green-500={health.memoryPercent <= 70}
                class:bg-yellow-500={health.memoryPercent > 70 && health.memoryPercent <= 90}
                class:bg-red-500={health.memoryPercent > 90}
                style="width: {health.memoryPercent}%"
              ></div>
            </div>
          </div>
          <div class="flex justify-between text-sm">
            <span>Queue Throughput</span>
            <span class="font-medium">{queueCounts.total} total jobs</span>
          </div>
          <div class="flex justify-between text-sm">
            <span>Log Entries</span>
            <span class="font-medium">{logStats.totalEntries} entries ({logStats.byLevel?.error ?? 0} errors)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Users -->
  {#if activeTab === 'users'}
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>Manage user roles and permissions ({data.stats.userCount} users)</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200">
                <th class="text-left py-3 px-4 font-semibold text-gray-900">Name</th>
                <th class="text-left py-3 px-4 font-semibold text-gray-900">Email</th>
                <th class="text-left py-3 px-4 font-semibold text-gray-900">Column Role</th>
                <th class="text-left py-3 px-4 font-semibold text-gray-900">Assigned Roles</th>
                <th class="text-left py-3 px-4 font-semibold text-gray-900">Direct Permissions</th>
                <th class="text-left py-3 px-4 font-semibold text-gray-900">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each users as user (user.id)}
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                  <td class="py-3 px-4 font-medium text-gray-900">{user.name}</td>
                  <td class="py-3 px-4 text-gray-600">{user.email}</td>
                  <td class="py-3 px-4">
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                      {user.role}
                    </Badge>
                  </td>
                  <td class="py-3 px-4">
                    <div class="flex flex-wrap gap-1">
                      {#each (userRolesMap[user.id] ?? []) as role (role.id)}
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">
                          {role.name}
                          <button
                            type="button"
                            class="hover:text-red-600 font-bold"
                            onclick={() => removeRoleFromUser(user.id, role.id)}
                          >&times;</button>
                        </span>
                      {/each}
                      {#if roles.length > 0}
                        <select
                          class="text-xs border border-gray-200 rounded px-1 py-0.5"
                          onchange={(e) => {
                            const val = Number((e.target as HTMLSelectElement).value);
                            if (val) { assignRoleToUser(user.id, val); (e.target as HTMLSelectElement).value = ''; }
                          }}
                        >
                          <option value="">+ role</option>
                          {#each roles.filter((r) => !(userRolesMap[user.id] ?? []).some((ur) => ur.id === r.id)) as role (role.id)}
                            <option value={role.id}>{role.name}</option>
                          {/each}
                        </select>
                      {/if}
                    </div>
                  </td>
                  <td class="py-3 px-4">
                    <div class="flex flex-wrap gap-1">
                      {#each (userDirectPermsMap[user.id] ?? []) as perm (perm.id)}
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">
                          {perm.name}
                          <button
                            type="button"
                            class="hover:text-red-600 font-bold"
                            onclick={() => revokePermFromUser(user.id, perm.id)}
                          >&times;</button>
                        </span>
                      {/each}
                      {#if permissions.length > 0}
                        <select
                          class="text-xs border border-gray-200 rounded px-1 py-0.5"
                          onchange={(e) => {
                            const val = Number((e.target as HTMLSelectElement).value);
                            if (val) { grantPermToUser(user.id, val); (e.target as HTMLSelectElement).value = ''; }
                          }}
                        >
                          <option value="">+ perm</option>
                          {#each permissions.filter((p) => !(userDirectPermsMap[user.id] ?? []).some((up) => up.id === p.id)) as perm (perm.id)}
                            <option value={perm.id}>{perm.name}</option>
                          {/each}
                        </select>
                      {/if}
                    </div>
                  </td>
                  <td class="py-3 px-4">
                    <div class="flex gap-2">
                      {#if user.role === 'user'}
                        <Button size="sm" variant="outline" onclick={() => updateUserRole(user.id, 'admin')}>
                          Make Admin
                        </Button>
                      {:else if data.stats.roleDistribution.admin > 1}
                        <Button size="sm" variant="outline" onclick={() => updateUserRole(user.id, 'user')}>
                          Demote
                        </Button>
                      {/if}
                      {#if user.id !== data.user.id}
                        <Button size="sm" variant="destructive" onclick={() => deleteUser(user.id, user.name)}>
                          Delete
                        </Button>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  {/if}

  <!-- Roles -->
  {#if activeTab === 'roles'}
    <div class="space-y-6">
      <Card>
        <CardHeader>
          <div class="flex justify-between items-start">
            <div>
              <CardTitle>Roles</CardTitle>
              <CardDescription>{roles.length} roles defined</CardDescription>
            </div>
            <Button size="sm" onclick={() => (showRoleForm = !showRoleForm)}>
              {showRoleForm ? 'Cancel' : 'Create Role'}
            </Button>
          </div>
        </CardHeader>
        {#if showRoleForm}
          <CardContent>
            <form
              class="flex flex-wrap gap-3 items-end border-b border-gray-100 pb-4 mb-4"
              onsubmit={(e) => { e.preventDefault(); createRole(); }}
            >
              <div class="flex-1 min-w-[200px]">
                <Label for="role-name">Name</Label>
                <Input id="role-name" bind:value={newRoleName} placeholder="e.g. editor" />
              </div>
              <div class="flex-1 min-w-[200px]">
                <Label for="role-desc">Description (optional)</Label>
                <Input id="role-desc" bind:value={newRoleDesc} placeholder="Can edit content" />
              </div>
              <Button type="submit" size="sm">Create</Button>
            </form>
          </CardContent>
        {/if}
        <CardContent>
          {#if roles.length > 0}
            <div class="space-y-4">
              {#each roles as role (role.id)}
                <div class="border border-gray-200 rounded-lg p-4">
                  <div class="flex items-center justify-between mb-3">
                    <div>
                      <span class="font-medium text-gray-900">{role.name}</span>
                      <Badge variant="secondary" class="ml-2">{role.guard}</Badge>
                      {#if role.description}
                        <p class="text-xs text-gray-500 mt-1">{role.description}</p>
                      {/if}
                    </div>
                    <Button size="sm" variant="destructive" onclick={() => deleteRole(role.name)}>Delete</Button>
                  </div>
                  <div>
                    <p class="text-xs font-semibold text-gray-500 uppercase mb-2">Permissions</p>
                    <div class="flex flex-wrap gap-2">
                      {#each permissions as perm (perm.id)}
                        {@const has = (rolePermissionsMap[role.id] ?? []).includes(perm.id)}
                        <button
                          type="button"
                          class="px-2 py-1 rounded text-xs border transition-colors {has
                            ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}"
                          onclick={() => toggleRolePermission(role.id, perm.id)}
                        >
                          {perm.name}
                        </button>
                      {/each}
                      {#if permissions.length === 0}
                        <span class="text-xs text-gray-400">No permissions defined yet</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-gray-500 py-4 text-center">
              No roles defined. Create one to start assigning permissions.
            </p>
          {/if}
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Permissions -->
  {#if activeTab === 'permissions'}
    <div class="space-y-6">
      <Card>
        <CardHeader>
          <div class="flex justify-between items-start">
            <div>
              <CardTitle>Permissions</CardTitle>
              <CardDescription>{permissions.length} permissions defined</CardDescription>
            </div>
            <Button size="sm" onclick={() => (showPermForm = !showPermForm)}>
              {showPermForm ? 'Cancel' : 'Create Permission'}
            </Button>
          </div>
        </CardHeader>
        {#if showPermForm}
          <CardContent>
            <form
              class="flex flex-wrap gap-3 items-end border-b border-gray-100 pb-4 mb-4"
              onsubmit={(e) => { e.preventDefault(); createPermission(); }}
            >
              <div class="flex-1 min-w-[200px]">
                <Label for="perm-name">Name</Label>
                <Input id="perm-name" bind:value={newPermName} placeholder="e.g. manage-users" />
              </div>
              <div class="flex-1 min-w-[200px]">
                <Label for="perm-desc">Description (optional)</Label>
                <Input id="perm-desc" bind:value={newPermDesc} placeholder="Can manage user accounts" />
              </div>
              <Button type="submit" size="sm">Create</Button>
            </form>
          </CardContent>
        {/if}
        <CardContent>
          {#if permissions.length > 0}
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-gray-200">
                    <th class="text-left py-3 px-4 font-semibold text-gray-900">Name</th>
                    <th class="text-left py-3 px-4 font-semibold text-gray-900">Guard</th>
                    <th class="text-left py-3 px-4 font-semibold text-gray-900">Description</th>
                    <th class="text-left py-3 px-4 font-semibold text-gray-900">Used by Roles</th>
                    <th class="text-left py-3 px-4 font-semibold text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {#each permissions as perm (perm.id)}
                    {@const usedBy = roles.filter((r) => (rolePermissionsMap[r.id] ?? []).includes(perm.id))}
                    <tr class="border-b border-gray-100 hover:bg-gray-50">
                      <td class="py-3 px-4 font-medium text-gray-900">{perm.name}</td>
                      <td class="py-3 px-4">
                        <Badge variant="secondary">{perm.guard}</Badge>
                      </td>
                      <td class="py-3 px-4 text-gray-600">{perm.description || '---'}</td>
                      <td class="py-3 px-4">
                        <div class="flex flex-wrap gap-1">
                          {#each usedBy as role (role.id)}
                            <Badge variant="outline">{role.name}</Badge>
                          {/each}
                          {#if usedBy.length === 0}
                            <span class="text-xs text-gray-400">None</span>
                          {/if}
                        </div>
                      </td>
                      <td class="py-3 px-4">
                        <Button size="sm" variant="destructive" onclick={() => deletePermission(perm.name)}>Delete</Button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <p class="text-sm text-gray-500 py-4 text-center">
              No permissions defined. Create one to start building your authorization system.
            </p>
          {/if}
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Queue -->
  {#if activeTab === 'queue'}
    <div class="space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Waiting</p>
              <p class="text-3xl font-bold text-yellow-600 mt-2">{queueCounts.waiting}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Active</p>
              <p class="text-3xl font-bold text-blue-600 mt-2">{queueCounts.active}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Failed</p>
              <p class="text-3xl font-bold text-red-600 mt-2">{queueCounts.failed}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Completed</p>
              <p class="text-3xl font-bold text-green-600 mt-2">{queueCounts.completed}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Delayed</p>
              <p class="text-3xl font-bold text-gray-600 mt-2">{queueCounts.delayed}</p>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Queue Actions</CardTitle>
          <CardDescription>Manage job queue</CardDescription>
        </CardHeader>
        <CardContent class="flex gap-3">
          <Button variant="outline" onclick={refreshQueue}>Refresh Counts</Button>
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Scheduler -->
  {#if activeTab === 'scheduler'}
    <Card>
      <CardHeader>
        <CardTitle>Scheduled Tasks</CardTitle>
        <CardDescription>
          {scheduledTasks.length > 0
            ? \`\${scheduledTasks.length} registered tasks\`
            : 'No tasks registered. Configure your scheduler to see tasks here.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {#if scheduledTasks.length > 0}
          <div class="space-y-3">
            {#each scheduledTasks as task (task.name)}
              <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                <div class="flex-1">
                  <p class="font-medium text-gray-900">{task.name}</p>
                  <p class="text-sm text-gray-600">Schedule: {task.humanReadable}</p>
                  <p class="text-xs text-gray-500 mt-1">Last run: {formatDate(task.lastRun)}</p>
                  <p class="text-xs text-gray-500">Next run: {formatDate(task.nextRun)}</p>
                </div>
                <div class="flex items-center gap-3">
                  {#if task.lastStatus}
                    <Badge variant={task.lastStatus === 'success' ? 'default' : 'destructive'}>
                      {task.lastStatus}
                    </Badge>
                  {/if}
                  <Badge variant={task.enabled ? 'default' : 'secondary'}>
                    {task.enabled ? 'enabled' : 'disabled'}
                  </Badge>
                  <Button size="sm" variant="outline" onclick={() => runTask(task.name)}>Run Now</Button>
                  <Button size="sm" variant="outline" onclick={() => toggleTask(task.name, !task.enabled)}>
                    {task.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-gray-500 py-4 text-center">
            No scheduled tasks found. Configure the Scheduler in your app.ts to register tasks.
          </p>
        {/if}
      </CardContent>
    </Card>
  {/if}

  <!-- Logs -->
  {#if activeTab === 'logs'}
    <Card>
      <CardHeader>
        <CardTitle>Application Logs</CardTitle>
        <CardDescription>
          {logStats.totalEntries} total entries
          {#if logStats.byLevel?.error}
            ({logStats.byLevel.error} errors)
          {/if}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex gap-2 mb-4">
          <Button size="sm" variant={logFilter === 'all' ? 'default' : 'outline'} onclick={() => (logFilter = 'all')}>
            All ({logStats.totalEntries})
          </Button>
          <Button size="sm" variant={logFilter === 'info' ? 'default' : 'outline'} onclick={() => (logFilter = 'info')}>
            Info ({logStats.byLevel?.info ?? 0})
          </Button>
          <Button size="sm" variant={logFilter === 'warn' ? 'default' : 'outline'} onclick={() => (logFilter = 'warn')}>
            Warning ({logStats.byLevel?.warn ?? 0})
          </Button>
          <Button size="sm" variant={logFilter === 'error' ? 'default' : 'outline'} onclick={() => (logFilter = 'error')}>
            Error ({logStats.byLevel?.error ?? 0})
          </Button>
        </div>

        {#if filteredLogs.length > 0}
          <div class="space-y-2 max-h-96 overflow-y-auto">
            {#each filteredLogs as log, i (i)}
              <div class="flex items-start gap-3 p-3 border border-gray-200 rounded bg-gray-50 text-sm">
                <Badge variant={getLogBadgeVariant(log.level)} class="mt-0.5">
                  {log.level.toUpperCase()}
                </Badge>
                <div class="flex-1">
                  <p class="text-gray-900">{log.message}</p>
                  <p class="text-xs text-gray-500 mt-1">
                    {formatDate(log.timestamp)}
                    {#if log.channel && log.channel !== 'default'}
                      <span class="ml-2 text-gray-400">[{log.channel}]</span>
                    {/if}
                  </p>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-gray-500 py-4 text-center">
            No log entries found. Logs appear here as your application runs.
          </p>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
`;
  }

  // ─── API Routes ───────────────────────────────────────────

  static apiHealth(): string {
    return `import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
  return json({
    status: 'ok',
    framework: 'svelar',
    timestamp: new Date().toISOString(),
  });
};
`;
  }

  static apiAuthRegister(): string {
    return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/controllers/AuthController.js';

const throttle = new ThrottleMiddleware({ maxAttempts: 5, decayMinutes: 2 });
const ctrl = new AuthController();

export async function POST(event: any) {
  const blocked = await throttle.handle({ event, params: event.params, locals: event.locals }, async () => {});
  if (blocked) return blocked;
  return ctrl.handle('register')(event);
}
`;
  }

  static apiAuthLogin(): string {
    return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/controllers/AuthController.js';

const throttle = new ThrottleMiddleware({ maxAttempts: 5, decayMinutes: 1 });
const ctrl = new AuthController();

export async function POST(event: any) {
  const blocked = await throttle.handle({ event, params: event.params, locals: event.locals }, async () => {});
  if (blocked) return blocked;
  return ctrl.handle('login')(event);
}
`;
  }

  static apiAuthLogout(): string {
    return `import { AuthController } from '$lib/controllers/AuthController.js';

const ctrl = new AuthController();
export const POST = ctrl.handle('logout');
`;
  }

  static apiAuthMe(): string {
    return `import { AuthController } from '$lib/controllers/AuthController.js';

const ctrl = new AuthController();
export const GET = ctrl.handle('me');
`;
  }

  static apiAuthForgotPassword(): string {
    return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/controllers/AuthController.js';

const throttle = new ThrottleMiddleware({ maxAttempts: 3, decayMinutes: 5 });
const ctrl = new AuthController();

export async function POST(event: any) {
  const blocked = await throttle.handle({ event, params: event.params, locals: event.locals }, async () => {});
  if (blocked) return blocked;
  return ctrl.handle('forgotPassword')(event);
}
`;
  }

  static apiAuthResetPassword(): string {
    return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/controllers/AuthController.js';

const throttle = new ThrottleMiddleware({ maxAttempts: 5, decayMinutes: 5 });
const ctrl = new AuthController();

export async function POST(event: any) {
  const blocked = await throttle.handle({ event, params: event.params, locals: event.locals }, async () => {});
  if (blocked) return blocked;
  return ctrl.handle('resetPassword')(event);
}
`;
  }

  static apiAuthOtpSend(): string {
    return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/controllers/AuthController.js';

const throttle = new ThrottleMiddleware({ maxAttempts: 3, decayMinutes: 2 });
const ctrl = new AuthController();

export async function POST(event: any) {
  const blocked = await throttle.handle({ event, params: event.params, locals: event.locals }, async () => {});
  if (blocked) return blocked;
  return ctrl.handle('sendOtp')(event);
}
`;
  }

  static apiAuthOtpVerify(): string {
    return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/controllers/AuthController.js';

const throttle = new ThrottleMiddleware({ maxAttempts: 5, decayMinutes: 5 });
const ctrl = new AuthController();

export async function POST(event: any) {
  const blocked = await throttle.handle({ event, params: event.params, locals: event.locals }, async () => {});
  if (blocked) return blocked;
  return ctrl.handle('verifyOtp')(event);
}
`;
  }

  static apiAuthVerifyEmail(): string {
    return `import { AuthController } from '$lib/controllers/AuthController.js';

const ctrl = new AuthController();
export const GET = ctrl.handle('verifyEmail');
`;
  }

  static apiPosts(): string {
    return `import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('index');
export const POST = ctrl.handle('store');
`;
  }

  static apiPostsSingle(): string {
    return `import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('show');
export const PUT = ctrl.handle('update');
export const DELETE = ctrl.handle('destroy');
`;
  }

  static apiPostsMine(): string {
    return `import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('mine');
`;
  }

  static apiBroadcasting(): string {
    return `import type { RequestHandler } from '@sveltejs/kit';
import { Broadcast } from '@beeblock/svelar/broadcasting';

export const GET: RequestHandler = async (event) => {
  const channelName = event.params.channel!;

  if (channelName.startsWith('private-') || channelName.startsWith('presence-')) {
    const user = event.locals.user;
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const authorized = await Broadcast.authorize(channelName, user);
    if (!authorized) {
      return new Response('Forbidden', { status: 403 });
    }

    if (channelName.startsWith('presence-') && typeof authorized === 'object') {
      return Broadcast.subscribe(channelName, user.id, authorized);
    }

    return Broadcast.subscribe(channelName, user.id);
  }

  const user = event.locals.user;
  return Broadcast.subscribe(channelName, user?.id);
};
`;
  }

  static apiInternalBroadcast(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { Broadcast } from '@beeblock/svelar/broadcasting';

export const POST: RequestHandler = async (event) => {
  const secret = event.request.headers.get('x-internal-secret');
  const expected = process.env.INTERNAL_SECRET;
  if (!expected) return json({ message: 'INTERNAL_SECRET not set' }, { status: 500 });

  if (secret !== expected) {
    return json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { channel, eventName, data } = await event.request.json();

    if (!channel || !eventName) {
      return json({ message: 'channel and eventName are required' }, { status: 400 });
    }

    await Broadcast.to(channel).send(eventName, data ?? {});

    return json({
      message: 'Event broadcast',
      subscribers: Broadcast.totalSubscribers(),
    });
  } catch (err: any) {
    return json({ message: err.message || 'Failed to broadcast' }, { status: 500 });
  }
};
`;
  }

  static apiAdminUsers(): string {
    return `import { AdminController } from '$lib/controllers/AdminController.js';

const ctrl = new AdminController();
export const GET = ctrl.handle('listUsers');
export const PUT = ctrl.handle('updateUserRole');
export const DELETE = ctrl.handle('deleteUser');
`;
  }

  static apiAdminRoles(): string {
    return `import { AdminController } from '$lib/controllers/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('createRole');
export const DELETE = ctrl.handle('deleteRole');
`;
  }

  static apiAdminPermissions(): string {
    return `import { AdminController } from '$lib/controllers/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('createPermission');
export const DELETE = ctrl.handle('deletePermission');
`;
  }

  static apiAdminRolePermissions(): string {
    return `import { AdminController } from '$lib/controllers/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('attachRolePermission');
export const DELETE = ctrl.handle('detachRolePermission');
`;
  }

  static apiAdminUserRoles(): string {
    return `import { AdminController } from '$lib/controllers/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('assignUserRole');
export const DELETE = ctrl.handle('removeUserRole');
`;
  }

  static apiAdminUserPermissions(): string {
    return `import { AdminController } from '$lib/controllers/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('grantUserPermission');
export const DELETE = ctrl.handle('revokeUserPermission');
`;
  }

  static apiAdminExport(): string {
    return `import { AdminController } from '$lib/controllers/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('exportData');
`;
  }

  // ─── Admin Dashboard API Routes ──────────────────────────

  static apiAdminHealth(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '0.1.0',
  };

  return json(health);
};
`;
  }

  static apiAdminQueue(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';

export const GET: RequestHandler = async (event) => {
  const { searchParams } = event.url;
  const status = searchParams.get('status') || 'all';
  const queueName = searchParams.get('queue') || 'default';
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const jobs = await JobMonitor.listJobs({
      queue: queueName,
      status: status === 'all' ? undefined : status as any,
      limit,
      offset,
    });
    const counts = await JobMonitor.getCounts(queueName);
    return json({ jobs, counts, queueName });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to fetch queue jobs' }, { status: 500 });
  }
};
`;
  }

  static apiAdminQueueRetry(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';

export const POST: RequestHandler = async (event) => {
  const { id } = event.params;
  try {
    await JobMonitor.retryJob(id);
    return json({ success: true, message: 'Job queued for retry' });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to retry job' }, { status: 500 });
  }
};
`;
  }

  static apiAdminQueueDelete(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';

export const DELETE: RequestHandler = async (event) => {
  const { id } = event.params;
  try {
    await JobMonitor.deleteJob(id);
    return json({ success: true, message: 'Job removed' });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to remove job' }, { status: 500 });
  }
};
`;
  }

  static apiAdminScheduler(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';

export const GET: RequestHandler = async () => {
  try {
    const tasks = await ScheduleMonitor.listTasks();
    const health = await ScheduleMonitor.getHealth();
    return json({ tasks, health });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to fetch scheduled tasks' }, { status: 500 });
  }
};
`;
  }

  static apiAdminSchedulerRun(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';

export const POST: RequestHandler = async (event) => {
  const { name } = event.params;
  try {
    await ScheduleMonitor.runTask(name);
    return json({ success: true, message: \`Task '\${name}' triggered\` });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to run task' }, { status: 500 });
  }
};
`;
  }

  static apiAdminSchedulerToggle(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';

export const POST: RequestHandler = async (event) => {
  const { name } = event.params;
  const body = await event.request.json();
  const enabled = body.enabled ?? true;

  try {
    if (enabled) {
      ScheduleMonitor.enableTask(name);
    } else {
      ScheduleMonitor.disableTask(name);
    }
    return json({ success: true, message: \`Task '\${name}' \${enabled ? 'enabled' : 'disabled'}\` });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to toggle task' }, { status: 500 });
  }
};
`;
  }

  static apiAdminLogs(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { LogViewer } from '@beeblock/svelar/logging/LogViewer';

export const GET: RequestHandler = async (event) => {
  const { searchParams } = event.url;
  const level = searchParams.get('level');
  const channel = searchParams.get('channel');
  const search = searchParams.get('search');
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const logs = LogViewer.query({
      level: level as any,
      channel: channel ?? undefined,
      search: search ?? undefined,
      limit,
      offset,
    });
    const stats = LogViewer.getStats();
    return json({ logs, total: stats.totalEntries, limit, offset });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to fetch logs' }, { status: 500 });
  }
};
`;
  }

  static apiAdminStats(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';
import { LogViewer } from '@beeblock/svelar/logging/LogViewer';

export const GET: RequestHandler = async () => {
  try {
    const [queueHealth, recentErrors] = await Promise.all([
      JobMonitor.getHealth(),
      Promise.resolve(LogViewer.getRecentErrors(10)),
    ]);
    const schedulerHealth = await ScheduleMonitor.getHealth();
    const logStats = LogViewer.getStats();

    return json({
      queue: queueHealth,
      scheduler: schedulerHealth,
      logs: logStats,
      recentErrors,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to fetch stats' }, { status: 500 });
  }
};
`;
  }

  // ─── Jobs ─────────────────────────────────────────────────

  static sendWelcomeEmail(): string {
    return `import { Job } from '@beeblock/svelar/queue';
import { EmailTemplates } from '@beeblock/svelar/email-templates';
import { Mailer } from '@beeblock/svelar/mail';

export class SendWelcomeEmail extends Job {
  maxAttempts = 3;
  retryDelay = 30;

  constructor(private userId: number, private email: string, private name: string) {
    super();
  }

  async handle(): Promise<void> {
    const appName = process.env.APP_NAME ?? 'Svelar';
    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

    const rendered = await EmailTemplates.render('welcome', {
      appName,
      'user.name': this.name,
      'user.email': this.email,
      confirmUrl: \`\${appUrl}/verify-email\`,
    });

    await Mailer.send({
      to: this.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  failed(error: Error): void {
    console.error(\`[Job] Failed to send welcome email to \${this.email}:\`, error.message);
  }
}
`;
  }

  static dailyDigestJob(): string {
    return `import { Job } from '@beeblock/svelar/queue';
import { Mailer } from '@beeblock/svelar/mail';
import { User } from '../../models/User.js';
import { Post } from '../../models/Post.js';

export class DailyDigestJob extends Job {
  maxAttempts = 3;
  retryDelay = 60;

  declare date: string;

  constructor(date?: string) {
    super();
    this.date = date ?? new Date().toISOString().split('T')[0];
  }

  async handle(): Promise<void> {
    const appName = process.env.APP_NAME ?? 'Svelar';
    const userCount = await User.count();
    const postCount = await Post.count();
    const recentPosts = await Post.where('published', true)
      .orderBy('created_at', 'desc')
      .limit(5)
      .get();

    const postList = recentPosts.length > 0
      ? recentPosts.map((p: any) => \`- \${p.title}\`).join('\\n')
      : 'No new posts today.';

    // Send digest to all admin users
    const admins = await User.where('role', 'admin').get();

    for (const admin of admins) {
      try {
        await Mailer.send({
          to: (admin as any).email,
          subject: \`[\${appName}] Daily Digest — \${this.date}\`,
          html: \`
            <h2>\${appName} Daily Digest</h2>
            <p><strong>Date:</strong> \${this.date}</p>
            <p><strong>Total Users:</strong> \${userCount}</p>
            <p><strong>Total Posts:</strong> \${postCount}</p>
            <h3>Recent Posts</h3>
            <pre>\${postList}</pre>
          \`,
        });
      } catch {
        console.warn(\`[DailyDigestJob] Failed to send digest to \${(admin as any).email}\`);
      }
    }

    console.log(\`[DailyDigestJob] Digest sent to \${admins.length} admins\`);
  }

  failed(error: Error): void {
    console.error(\`[DailyDigestJob] Failed to generate digest for \${this.date}:\`, error.message);
  }

  serialize(): Record<string, unknown> {
    return { date: this.date };
  }

  static restore(data: Record<string, unknown>): DailyDigestJob {
    return new DailyDigestJob(data.date as string);
  }
}
`;
  }

  static exportDataJob(): string {
    return `import { Job } from '@beeblock/svelar/queue';
import { Storage } from '@beeblock/svelar/storage';
import { User } from '../../models/User.js';
import { Post } from '../../models/Post.js';

export class ExportDataJob extends Job {
  maxAttempts = 2;
  retryDelay = 120;

  declare userId: number;
  declare format: 'csv' | 'json';

  constructor(userId?: number, format: 'csv' | 'json' = 'csv') {
    super();
    this.userId = userId ?? 0;
    this.format = format;
  }

  async handle(): Promise<void> {
    if (!this.userId) throw new Error('User ID is required for export');

    const user = await User.find(this.userId);
    if (!user) throw new Error(\`User #\${this.userId} not found\`);

    const posts = await Post.where('user_id', '=', this.userId).get();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = \`exports/user-\${this.userId}-\${timestamp}.\${this.format}\`;

    let content: string;

    if (this.format === 'csv') {
      const rows = [
        'ID,Title,Slug,Published,Created At',
        ...posts.map((p: any) =>
          \`\${p.id},"\${p.title}","\${p.slug}",\${p.published},\${p.created_at}\`
        ),
      ];
      content = rows.join('\\n');
    } else {
      content = JSON.stringify(
        posts.map((p: any) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          body: p.body,
          published: p.published,
          created_at: p.created_at,
        })),
        null,
        2
      );
    }

    await Storage.put(filename, content);
    console.log(\`[ExportDataJob] Exported \${posts.length} posts to \${filename}\`);
  }

  failed(error: Error): void {
    console.error(\`[ExportDataJob] Failed for user #\${this.userId}:\`, error.message);
  }

  serialize(): Record<string, unknown> {
    return { userId: this.userId, format: this.format };
  }

  static restore(data: Record<string, unknown>): ExportDataJob {
    return new ExportDataJob(data.userId as number, (data.format as 'csv' | 'json') ?? 'csv');
  }
}
`;
  }

  // ─── Scheduled Tasks ──────────────────────────────────────

  static cleanupExpiredTokens(): string {
    return `import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { auth } from '../../../app.js';

export default class CleanupExpiredTokens extends ScheduledTask {
  name = 'cleanup-expired-tokens';

  schedule() {
    return this.daily();
  }

  async handle(): Promise<void> {
    const result = await auth.cleanupExpiredTokens();
    console.log(
      \`[CleanupExpiredTokens] Deleted: \${result.passwordResets} password resets, \` +
      \`\${result.verifications} email verifications, \${result.otpCodes} OTP codes\`
    );
  }
}
`;
  }

  static cleanExpiredSessions(): string {
    return `import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Connection } from '@beeblock/svelar/database';

export default class CleanExpiredSessions extends ScheduledTask {
  name = 'clean-expired-sessions';

  schedule() {
    return this.daily();
  }

  async handle(): Promise<void> {
    try {
      const now = new Date().toISOString();
      await Connection.raw('DELETE FROM sessions WHERE expires_at < ?', [now]);
      console.log('[CleanExpiredSessions] Expired sessions cleaned');
    } catch (err: any) {
      if (!err.message?.includes('no such table')) {
        throw err;
      }
    }
  }
}
`;
  }

  static dailyDigestEmail(): string {
    return `import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Queue } from '@beeblock/svelar/queue';
import { DailyDigestJob } from '../jobs/DailyDigestJob.js';

export default class DailyDigestEmail extends ScheduledTask {
  name = 'daily-digest-email';

  schedule() {
    return this.dailyAt('09:00');
  }

  async handle(): Promise<void> {
    await Queue.dispatch(new DailyDigestJob());
  }
}
`;
  }

  static pruneAuditLogs(): string {
    return `import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Connection } from '@beeblock/svelar/database';

export default class PruneAuditLogs extends ScheduledTask {
  name = 'prune-audit-logs';

  schedule() {
    return this.weeklyOn(0, '02:00');
  }

  async handle(): Promise<void> {
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

    try {
      await Connection.raw('DELETE FROM audit_logs WHERE timestamp < ?', [ninetyDaysAgo]);
      console.log('[PruneAuditLogs] Pruned audit logs older than 90 days');
    } catch (err: any) {
      // Table may not exist yet if no auditable events have fired
      if (!err.message?.includes('no such table')) {
        throw err;
      }
    }
  }
}
`;
  }

  static queueHealthCheck(): string {
    return `import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Queue } from '@beeblock/svelar/queue';

export default class QueueHealthCheck extends ScheduledTask {
  name = 'queue-health-check';

  schedule() {
    return this.everyFiveMinutes();
  }

  async handle(): Promise<void> {
    const stats = await Queue.stats();
    const { pending, failed } = stats;

    if (failed > 0) {
      console.warn(\`[QueueHealthCheck] \${failed} failed jobs in queue\`);
    }

    if (pending > 100) {
      console.warn(\`[QueueHealthCheck] Queue backlog: \${pending} pending jobs\`);
    }

    console.log(\`[QueueHealthCheck] Queue stats: \${pending} pending, \${failed} failed\`);
  }
}
`;
  }

  // ─── Layout & Other ───────────────────────────────────────

  static rootLayoutSvelte(name: string): string {
    return `<script lang="ts">
  import '../app.css';
  import { Button } from '@beeblock/svelar/ui';

  let { data, children } = $props();
  const year = new Date().getFullYear();
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<div class="flex flex-col min-h-screen">
  <nav class="border-b border-gray-200 bg-white shadow-sm sticky top-0 z-50">
    <div class="px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
      <div class="flex items-center gap-6">
        <a href="/" class="flex items-center gap-2">
          <div class="w-8 h-8 bg-brand rounded-md flex items-center justify-center">
            <span class="text-white font-bold text-sm">&lt;/&gt;</span>
          </div>
          <span class="font-bold text-lg">${name}</span>
        </a>
        {#if data.user}
          <a href="/dashboard" class="text-gray-600 hover:text-gray-900 text-sm font-medium">Dashboard</a>
          {#if data.user.role === 'admin'}
            <a href="/admin" class="text-gray-600 hover:text-gray-900 text-sm font-medium">Admin</a>
          {/if}
        {/if}
      </div>

      <div class="flex items-center gap-3">
        {#if data.user}
          <span class="text-sm text-gray-600 hidden sm:inline">{data.user.name}</span>
          <form method="POST" action="/logout">
            <Button type="submit" variant="ghost" size="sm">Logout</Button>
          </form>
        {:else}
          <a href="/login"><Button variant="outline" size="sm">Login</Button></a>
          <a href="/register" class="hidden sm:inline"><Button size="sm">Register</Button></a>
        {/if}
      </div>
    </div>
  </nav>

  <main class="flex-1 px-4 sm:px-6 lg:px-8 py-8">
    {@render children()}
  </main>

  <footer class="border-t border-gray-200 bg-white py-8 text-center text-sm text-gray-500">
    <p>&copy; {year} ${name}. All rights reserved.</p>
  </footer>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
</style>
`;
  }

  static rootLayoutServer(): string {
    return `import type { ServerLoadEvent } from '@sveltejs/kit';

export async function load(event: ServerLoadEvent) {
  const user = event.locals.user;

  return {
    user: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role ?? 'user',
        }
      : null,
  };
}
`;
  }

  static errorSvelte(): string {
    return `<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '@beeblock/svelar/ui';
</script>

<svelte:head>
  <title>{page.status} — Error</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)] px-4">
  <div class="text-center max-w-md">
    <h1 class="text-7xl font-bold text-gray-200 mb-4">{page.status}</h1>
    <p class="text-xl font-semibold text-gray-900 mb-2">
      {page.status === 404 ? 'Page Not Found' : page.status === 403 ? 'Forbidden' : page.status === 401 ? 'Unauthorized' : 'Something Went Wrong'}
    </p>
    <p class="text-gray-500 mb-8">
      {page.error?.message || 'An unexpected error occurred. Please try again.'}
    </p>
    <div class="flex gap-3 justify-center">
      <Button href="/">Go Home</Button>
      <Button variant="outline" onclick={() => history.back()}>Go Back</Button>
    </div>
  </div>
</div>
`;
  }

  static userRegisteredEvent(): string {
    return `export class UserRegistered {
  constructor(public readonly user: any) {}
}
`;
  }

  static sendWelcomeEmailListener(): string {
    return `import { Queue } from '@beeblock/svelar/queue';
import { Notifier } from '@beeblock/svelar/notifications';
import { SendWelcomeEmail } from '../shared/jobs/SendWelcomeEmail.js';
import { WelcomeNotification } from '../notifications/WelcomeNotification.js';

export class SendWelcomeEmailListener {
  async handle(event: any): Promise<void> {
    const user = event.user;

    // Dispatch welcome email job to the queue
    await Queue.dispatch(new SendWelcomeEmail(user.id, user.email, user.name));

    // Send welcome notification (persisted to database)
    await Notifier.send(user, new WelcomeNotification(user));
  }
}
`;
  }

  static welcomeNotification(): string {
    return `import { Notification } from '@beeblock/svelar/notifications';

export class WelcomeNotification extends Notification {
  constructor(private user: any) {
    super();
  }

  via() {
    return ['database'] as const;
  }

  toDatabase() {
    return {
      type: 'welcome',
      data: {
        message: \`Welcome to \${process.env.APP_NAME ?? 'Svelar'}, \${this.user.name}!\`,
        userId: this.user.id,
      },
    };
  }
}
`;
  }

  static eventServiceProvider(): string {
    return `import { EventServiceProvider as BaseProvider } from '@beeblock/svelar/events';
import { UserRegistered } from '../../events/UserRegistered.js';
import { SendWelcomeEmailListener } from '../../listeners/SendWelcomeEmailListener.js';

export class EventServiceProvider extends BaseProvider {
  protected listen = {
    [UserRegistered.name]: [SendWelcomeEmailListener],
  };

  protected observers = {};
  protected subscribe = [];
}
`;
  }

  static homePage(name: string): string {
    return `<script lang="ts">
  import { Button, Card, Badge, Separator } from '@beeblock/svelar/ui';
</script>

<svelte:head>
  <title>${name} — Powered by Svelar</title>
</svelte:head>

<div class="min-h-screen bg-white flex flex-col items-center justify-center px-4">
  <div class="text-center max-w-lg">
    <div class="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-6">
      <span class="text-white font-bold text-2xl">&lt;/&gt;</span>
    </div>

    <Badge variant="outline" class="mb-4">Svelar + SvelteKit</Badge>

    <h1 class="text-4xl font-extrabold text-gray-900 mb-4">
      Welcome to <span class="text-brand">${name}</span>
    </h1>

    <p class="text-gray-600 mb-8 leading-relaxed">
      Your new Svelar project is ready. Edit
      <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm text-brand">src/routes/+page.svelte</code>
      to get started.
    </p>

    <div class="flex items-center justify-center gap-3">
      <a href="/register"><Button>Get Started</Button></a>
      <a href="/login"><Button variant="outline">Sign In</Button></a>
    </div>
  </div>

  <Separator class="my-12 max-w-sm w-full" />

  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full">
    <Card class="p-5 text-center">
      <h3 class="font-semibold text-gray-900 mb-1">ORM</h3>
      <p class="text-sm text-gray-500">Eloquent-style models with Drizzle</p>
    </Card>
    <Card class="p-5 text-center">
      <h3 class="font-semibold text-gray-900 mb-1">Auth</h3>
      <p class="text-sm text-gray-500">Sessions, JWT, API tokens</p>
    </Card>
    <Card class="p-5 text-center">
      <h3 class="font-semibold text-gray-900 mb-1">Middleware</h3>
      <p class="text-sm text-gray-500">CORS, CSRF, rate limiting</p>
    </Card>
  </div>
</div>
`;
  }
}
