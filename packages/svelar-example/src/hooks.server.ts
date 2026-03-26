/**
 * SvelteKit Server Hooks — Svelar middleware pipeline
 *
 * Middleware execution order:
 * 1. Origin validation — blocks cross-origin mutation requests
 * 2. Rate limiting — global 100 req/min per IP
 * 3. CSRF protection — double-submit cookie pattern
 * 4. Session management — reads/writes signed cookies
 * 5. Auth resolution — resolves user from session
 * 6. Auth throttle — stricter rate limiting on login/register (5 attempts/min)
 */

import { createSvelarHooks } from 'svelar/hooks';
import { SessionMiddleware, MemorySessionStore } from 'svelar/session';
import { AuthenticateMiddleware } from 'svelar/auth';
import {
  RateLimitMiddleware,
  CsrfMiddleware,
  OriginMiddleware,
  ThrottleMiddleware,
} from 'svelar/middleware';

// Import app.ts to trigger Connection + Hash + Auth configuration
import { auth } from './app.js';

const sessionStore = new MemorySessionStore();

export const handle = createSvelarHooks({
  middleware: [
    // 1. Block cross-origin mutation requests
    new OriginMiddleware(),

    // 2. Global rate limiting (100 requests per minute per IP)
    new RateLimitMiddleware({ maxRequests: 100, windowMs: 60_000 }),

    // 3. CSRF protection — only for /api/* routes.
    //    SvelteKit form actions (/login, /register, etc.) are already
    //    protected by OriginMiddleware + SvelteKit's built-in origin check.
    new CsrfMiddleware({
      onlyPaths: ['/api/'],
      excludePaths: ['/api/webhooks'],
    }),

    // 4. Session management (reads/writes cookies, attaches event.locals.session)
    new SessionMiddleware({
      store: sessionStore,
      secret: process.env.APP_KEY || 'svelar-example-secret-change-me',
      lifetime: 60 * 60 * 24, // 24 hours
    }),

    // 5. Auth resolution (reads session, attaches event.locals.user)
    new AuthenticateMiddleware(auth),
  ],

  // Named middleware for per-route usage
  namedMiddleware: {
    // Stricter throttle for auth endpoints: 5 failed attempts per minute
    'auth-throttle': new ThrottleMiddleware({ maxAttempts: 5, decayMinutes: 1 }),
  },

  onError: (error, event) => {
    console.error('[Svelar Error]', error);
  },
});
