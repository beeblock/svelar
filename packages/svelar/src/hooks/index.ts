/**
 * Svelar Hooks
 *
 * Integration with SvelteKit's hooks system.
 * Provides a Laravel-like middleware pipeline for all incoming requests.
 *
 * @module svelar/hooks
 *
 * @example Simple (auto-wired defaults)
 * ```ts
 * // src/hooks.server.ts
 * import { createSvelarApp } from 'svelar/hooks';
 * import { auth } from './app';
 *
 * export const { handle, handleError } = createSvelarApp({ auth });
 * ```
 *
 * @example Advanced (manual pipeline)
 * ```ts
 * import { createSvelarHooks } from 'svelar/hooks';
 * import { CorsMiddleware } from 'svelar/middleware';
 *
 * export const handle = createSvelarHooks({
 *   middleware: [CorsMiddleware],
 * });
 * ```
 */

import {
  Middleware,
  MiddlewareStack,
  type MiddlewareContext,
  type MiddlewareHandler,
  CsrfMiddleware,
  OriginMiddleware,
  RateLimitMiddleware,
  ThrottleMiddleware,
} from '../middleware/Middleware.js';
import { Application } from '../container/Application.js';
import { SessionMiddleware, MemorySessionStore, type SessionStore } from '../session/Session.js';
import { AuthenticateMiddleware, type AuthManager } from '../auth/Auth.js';
import { ErrorHandler, type ErrorHandlerConfig } from '../errors/Handler.js';

// ── Types ──────────────────────────────────────────────────

export interface SvelarHooksConfig {
  /** Global middleware to run on every request */
  middleware?: Array<(new () => Middleware) | Middleware | MiddlewareHandler>;

  /** Named middleware for per-route usage */
  namedMiddleware?: Record<string, (new () => Middleware) | Middleware | MiddlewareHandler>;

  /** Error handler */
  onError?: (error: unknown, event: any) => void | Response | Promise<void | Response>;

  /** Application instance (optional — for DI integration) */
  app?: Application;
}

export interface SvelarAppConfig {
  /** Auth manager instance */
  auth?: AuthManager;

  /** Session secret key (defaults to APP_KEY env var) */
  secret?: string;

  /** Session store (default: MemorySessionStore — lost on restart) */
  sessionStore?: SessionStore;

  /** Session lifetime in seconds (default: 86400 = 24h) */
  sessionLifetime?: number;

  /** Rate limit: max requests per window (default: 100) */
  rateLimit?: number;

  /** Rate limit: window in ms (default: 60000 = 1min) */
  rateLimitWindow?: number;

  /** CSRF: paths to protect (default: ['/api/']) */
  csrfPaths?: string[];

  /** CSRF: paths to exclude (default: ['/api/webhooks']) */
  csrfExcludePaths?: string[];

  /** Auth throttle: max login attempts (default: 5) */
  authThrottleAttempts?: number;

  /** Auth throttle: decay in minutes (default: 1) */
  authThrottleDecay?: number;

  /** Enable debug error output (default: auto from NODE_ENV) */
  debug?: boolean;

  /** Additional global middleware to append */
  middleware?: Array<(new () => Middleware) | Middleware | MiddlewareHandler>;

  /** Named middleware for per-route usage */
  namedMiddleware?: Record<string, (new () => Middleware) | Middleware | MiddlewareHandler>;

  /** i18n configuration — if provided, auto-wires paraglide */
  i18n?: {
    paraglideMiddleware: (
      request: Request,
      callback: (args: { request: Request; locale: string }) => Response | Promise<Response>,
    ) => Response | Promise<Response>;
    getTextDirection?: (locale: string) => string;
  };

  /** Error handler config overrides */
  errorConfig?: Partial<ErrorHandlerConfig>;
}

// ── createSvelarApp (Simple API) ─────────────────────────

/**
 * Creates a fully-wired SvelteKit hooks setup with sensible defaults.
 * One-liner setup inspired by Laravel's bootstrap.
 *
 * Returns `{ handle, handleError }` ready to export from hooks.server.ts.
 *
 * @example
 * ```ts
 * import { createSvelarApp } from 'svelar/hooks';
 * import { auth } from './app';
 *
 * export const { handle, handleError } = createSvelarApp({ auth });
 * ```
 *
 * @example With i18n
 * ```ts
 * import { createSvelarApp } from 'svelar/hooks';
 * import { auth } from './app';
 * import { paraglideMiddleware } from '$lib/paraglide/server';
 * import { getTextDirection } from '$lib/paraglide/runtime';
 *
 * export const { handle, handleError } = createSvelarApp({
 *   auth,
 *   i18n: { paraglideMiddleware, getTextDirection },
 * });
 * ```
 */
export function createSvelarApp(appConfig: SvelarAppConfig = {}) {
  const {
    auth,
    secret = (() => { throw new Error('APP_KEY is not set. Pass `secret` to createSvelarApp() — e.g. secret: env.APP_KEY (from $env/dynamic/private).'); })(),
    sessionStore,
    sessionLifetime = 86400,
    rateLimit = 100,
    rateLimitWindow = 60_000,
    csrfPaths = ['/api/'],
    csrfExcludePaths = ['/api/webhooks'],
    authThrottleAttempts = 5,
    authThrottleDecay = 1,
    debug = process.env.NODE_ENV !== 'production',
    middleware: extraMiddleware = [],
    namedMiddleware: extraNamedMiddleware = {},
    i18n,
    errorConfig = {},
  } = appConfig;

  // Build default middleware stack
  const defaultMiddleware: Array<Middleware | MiddlewareHandler> = [
    new OriginMiddleware(),
    new RateLimitMiddleware({ maxRequests: rateLimit, windowMs: rateLimitWindow }),
    new CsrfMiddleware({ onlyPaths: csrfPaths, excludePaths: csrfExcludePaths }),
    new SessionMiddleware({
      store: sessionStore ?? new MemorySessionStore(),
      secret,
      lifetime: sessionLifetime,
    }),
  ];

  // Add auth middleware if auth manager is provided
  if (auth) {
    defaultMiddleware.push(new AuthenticateMiddleware(auth));
  }

  // Add any extra middleware
  defaultMiddleware.push(...(extraMiddleware as any[]));

  // Build named middleware
  const namedMiddleware: Record<string, Middleware | MiddlewareHandler> = {
    'auth-throttle': new ThrottleMiddleware({
      maxAttempts: authThrottleAttempts,
      decayMinutes: authThrottleDecay,
    }),
    ...extraNamedMiddleware as any,
  };

  // Create error handler
  const errorHandler = new ErrorHandler({ debug, ...errorConfig });

  // Create the svelar handle
  const svelarHandle = createSvelarHooks({
    middleware: defaultMiddleware as any[],
    namedMiddleware: namedMiddleware as any,
    onError: (error, event) => errorHandler.handle(error, event),
  });

  // Build the final handle (with optional i18n)
  let finalHandle: any;

  if (i18n) {
    const {
      paraglideMiddleware,
      getTextDirection = () => 'ltr',
    } = i18n;

    const i18nHandle = async ({ event, resolve }: any): Promise<Response> =>
      paraglideMiddleware(event.request, ({ request: localizedRequest, locale }: any) => {
        event.request = localizedRequest;
        return resolve(event, {
          transformPageChunk: ({ html }: any) =>
            html.replace('%lang%', locale).replace('%dir%', getTextDirection(locale)),
        });
      });

    finalHandle = sequence(i18nHandle, svelarHandle);
  } else {
    finalHandle = svelarHandle;
  }

  return {
    handle: finalHandle,
    handleError: errorHandler.handleSvelteKitError(),
  };
}

// ── createSvelarHooks (Advanced API) ──────────────────────

/**
 * Creates a SvelteKit `handle` hook with Svelar middleware pipeline.
 * For advanced use when you want full control over the middleware stack.
 */
export function createSvelarHooks(hookConfig: SvelarHooksConfig = {}) {
  const stack = new MiddlewareStack();

  // Register global middleware
  if (hookConfig.middleware) {
    for (const mw of hookConfig.middleware) {
      stack.use(mw as any);
    }
  }

  // Register named middleware
  if (hookConfig.namedMiddleware) {
    for (const [name, mw] of Object.entries(hookConfig.namedMiddleware)) {
      stack.register(name, mw as any);
    }
  }

  /**
   * The SvelteKit handle hook
   */
  return async function handle({
    event,
    resolve,
  }: {
    event: any;
    resolve: (event: any) => Promise<Response>;
  }): Promise<Response> {
    const ctx: MiddlewareContext = {
      event,
      params: event.params ?? {},
      locals: event.locals ?? {},
    };

    try {
      // Bootstrap application if provided
      if (hookConfig.app && !hookConfig.app.isBooted()) {
        await hookConfig.app.bootstrap();
      }

      // Execute middleware pipeline, with SvelteKit's resolve as the final handler
      const response = await stack.execute(ctx, async () => {
        return resolve(event);
      });

      return response instanceof Response ? response : resolve(event);
    } catch (error) {
      if (hookConfig.onError) {
        const errorResponse = await hookConfig.onError(error, event);
        if (errorResponse instanceof Response) return errorResponse;
      }

      // Default error response
      console.error('[Svelar] Unhandled error in hooks:', error);
      return new Response(
        JSON.stringify({
          message:
            process.env.NODE_ENV === 'production'
              ? 'Internal server error'
              : (error as Error).message,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  };
}

/**
 * Sequence multiple SvelteKit handle hooks together.
 * Similar to SvelteKit's `sequence` helper.
 */
export function sequence(
  ...handlers: Array<
    (opts: { event: any; resolve: (event: any) => Promise<Response> }) => Promise<Response>
  >
) {
  return async function sequencedHandle({
    event,
    resolve,
  }: {
    event: any;
    resolve: (event: any) => Promise<Response>;
  }): Promise<Response> {
    let currentResolve = resolve;

    // Build chain from right to left
    for (let i = handlers.length - 1; i >= 0; i--) {
      const handler = handlers[i];
      const nextResolve = currentResolve;
      currentResolve = (evt: any) => handler({ event: evt, resolve: nextResolve });
    }

    return currentResolve(event);
  };
}
