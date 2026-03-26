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

import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getTextDirection } from '$lib/paraglide/runtime';
import { createSvelarHooks } from 'svelar/hooks';
import { SessionMiddleware, MemorySessionStore } from 'svelar/session';
import { AuthenticateMiddleware } from 'svelar/auth';
import {
  RateLimitMiddleware,
  CsrfMiddleware,
  OriginMiddleware,
  ThrottleMiddleware,
} from 'svelar/middleware';
import { ErrorHandler } from 'svelar/errors';

// Import app.ts to trigger Connection + Hash + Auth configuration
import { auth } from './app.js';

const errorHandler = new ErrorHandler({
  debug: process.env.NODE_ENV !== 'production',
  // report: async (error) => { /* Send to Sentry, Datadog, etc. */ },
});

const sessionStore = new MemorySessionStore();

const svelarHandle = createSvelarHooks({
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
    return errorHandler.handle(error, event);
  },
});

/** Paraglide i18n handle — resolves locale from URL and sets lang/dir */
const paraglideHandle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request: localizedRequest, locale }) => {
    event.request = localizedRequest;
    return resolve(event, {
      transformPageChunk: ({ html }) => {
        return html
          .replace('%lang%', locale)
          .replace('%dir%', getTextDirection(locale));
      },
    });
  });

/** Compose paraglide i18n + Svelar middleware pipeline */
export const handle = sequence(paraglideHandle, svelarHandle);

/** SvelteKit's handleError hook — catches unhandled errors in load/actions */
export const handleError = errorHandler.handleSvelteKitError();
