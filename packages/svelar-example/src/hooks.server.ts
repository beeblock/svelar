/**
 * SvelteKit Server Hooks — Svelar middleware pipeline
 *
 * Uses createSvelarApp for a fully-wired setup with sensible defaults:
 * Origin validation, rate limiting, CSRF, sessions, auth, error handling, i18n.
 */

import { createSvelarApp } from 'svelar/hooks';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getTextDirection } from '$lib/paraglide/runtime';

// Import app.ts to trigger Connection + Hash + Auth configuration
import { auth } from './app.js';

export const { handle, handleError } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY || 'svelar-example-secret-change-me',
  csrfExcludePaths: ['/api/webhooks', '/api/internal/'],
  i18n: { paraglideMiddleware, getTextDirection },
});
