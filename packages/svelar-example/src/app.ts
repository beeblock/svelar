/**
 * Svelar Example — Application Bootstrap
 *
 * Configures database, hashing, auth, queue, audit, API keys,
 * webhooks, teams, uploads, email templates, and scheduling.
 * This runs once when the server starts.
 */

import { Connection } from 'svelar/database';
import { Hash } from 'svelar/hashing';
import { AuthManager } from 'svelar/auth';
import { Queue } from 'svelar/queue';
import { Audit } from 'svelar/audit';
import { ApiKeys } from 'svelar/api-keys';
import { Webhooks } from 'svelar/webhooks';
import { Teams } from 'svelar/teams';
import { EmailTemplates } from 'svelar/email-templates';
import { Uploads } from 'svelar/uploads';
import { configureDashboard } from 'svelar/dashboard';
import { User } from './lib/models/User.js';
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
Hash.configure({
  driver: 'scrypt',
});

// ── Auth (session-based) ──────────────────────────────────
export const auth = new AuthManager({
  guard: 'session',
  model: User,
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
Audit.configure({ driver: 'memory', enabled: true });

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

// ── Dashboard ─────────────────────────────────────────────
configureDashboard({ enabled: true, prefix: '/admin' });

// ── Job Registration ──────────────────────────────────────
import { SendWelcomeEmail } from './lib/jobs/SendWelcomeEmail.js';
import { DailyDigestJob } from './lib/jobs/DailyDigestJob.js';
import { ExportDataJob } from './lib/jobs/ExportDataJob.js';

Queue.registerAll([SendWelcomeEmail, DailyDigestJob, ExportDataJob]);

export { Connection, Hash };
