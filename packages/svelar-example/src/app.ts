/**
 * Svelar Example — Application Bootstrap
 *
 * Configures database, hashing, auth, and session.
 * This runs once when the server starts.
 */

import { Connection } from 'svelar/database';
import { Hash } from 'svelar/hashing';
import { AuthManager } from 'svelar/auth';
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

export { Connection, Hash };
