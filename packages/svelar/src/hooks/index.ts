/**
 * Svelar Hooks
 *
 * Integration with SvelteKit's hooks system.
 * Provides a Laravel-like middleware pipeline for all incoming requests.
 *
 * @module @beeblock/svelar/hooks
 *
 * @example Simple (auto-wired defaults)
 * ```ts
 * // src/hooks.server.ts
 * import { createSvelarApp } from '@beeblock/svelar/hooks';
 * import { auth } from './app';
 *
 * export const { handle, handleError } = createSvelarApp({
 *   auth,
 *   secret: process.env.APP_KEY,
 * });
 * ```
 *
 * @example Advanced (manual pipeline)
 * ```ts
 * import { createSvelarHooks } from '@beeblock/svelar/hooks';
 * import { CorsMiddleware } from '@beeblock/svelar/middleware';
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
  type TrustedProxy,
  CsrfMiddleware,
  OriginMiddleware,
  RateLimitMiddleware,
  ThrottleMiddleware,
} from '../middleware/Middleware.js';
import { randomUUID } from 'node:crypto';
import { Application } from '../container/Application.js';
import { SessionMiddleware, DatabaseSessionStore, type SessionStore } from '../session/Session.js';
import { AuthenticateMiddleware, type AuthManager } from '../auth/Auth.js';
import { ErrorHandler, type ErrorHandlerConfig } from '../errors/Handler.js';
import { ApplicationContext } from '../support/Context.js';
import { DeploymentRuntime } from '../deployment/Runtime.js';

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

  /** Session store (default: DatabaseSessionStore — persists across restarts) */
  sessionStore?: SessionStore;

  /** Session lifetime in seconds (default: 86400 = 24h) */
  sessionLifetime?: number;
  sessionIdleLifetime?: number;
  sessionRememberLifetime?: number;
  sessionRememberAbsoluteLifetime?: number;
  sessionWarningBefore?: number;

  /** Absolute session lifetime in seconds. Active sessions cannot exceed this age. */
  sessionAbsoluteLifetime?: number;

  /** Extend session TTL only on real user activity (navigation/mutation), not polling/SSE. */
  sessionTouchOnActivity?: boolean;

  /** Minimum seconds between activity touches (default: 300). */
  sessionTouchThrottle?: number;

  /** Rate limit: max requests per window (default: 100) */
  rateLimit?: number;

  /** Rate limit: window in ms (default: 60000 = 1min) */
  rateLimitWindow?: number;

  /** Rate limit storage (default: memory). Use "cache" with Redis cache for multi-instance production apps. */
  rateLimitStore?: 'memory' | 'cache';

  /** Cache store name when rateLimitStore is "cache" */
  rateLimitCacheStore?: string;

  /** Trusted proxies allowed to supply X-Forwarded-For. Defaults to false. */
  trustedProxy?: TrustedProxy;

  /** CSRF: paths to protect (default: ['/api/']) */
  csrfPaths?: string[];

  /** CSRF: paths to exclude (default: signed incoming webhooks and internal bridge) */
  csrfExcludePaths?: string[];

  /** Independently signed endpoints that must not interpret provider credentials as Svelar Bearer tokens. */
  authExcludePaths?: string[];

  /** Auth throttle: max login attempts (default: 5) */
  authThrottleAttempts?: number;

  /** Auth throttle: decay in minutes (default: 1) */
  authThrottleDecay?: number;

  /** Auth throttle storage (default: same as rateLimitStore) */
  authThrottleStore?: 'memory' | 'cache';

  /** Cache store name when authThrottleStore is "cache" */
  authThrottleCacheStore?: string;

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
 * import { createSvelarApp } from '@beeblock/svelar/hooks';
 * import { auth } from './app';
 *
 * export const { handle, handleError } = createSvelarApp({ auth });
 * ```
 *
 * @example With i18n
 * ```ts
 * import { createSvelarApp } from '@beeblock/svelar/hooks';
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
    secret = process.env.APP_KEY ?? (() => { throw new Error('APP_KEY is not set. Set it in your environment or pass `secret` to createSvelarApp() — e.g. secret: process.env.APP_KEY.'); })(),
    sessionStore,
    sessionLifetime = 86400,
    sessionIdleLifetime,
    sessionRememberLifetime,
    sessionRememberAbsoluteLifetime,
    sessionWarningBefore,
    sessionAbsoluteLifetime,
    sessionTouchOnActivity = false,
    sessionTouchThrottle = 300,
    rateLimit = 100,
    rateLimitWindow = 60_000,
    rateLimitStore = 'memory',
    rateLimitCacheStore,
    trustedProxy = false,
    csrfPaths = ['/api/'],
    csrfExcludePaths = ['/api/webhooks/incoming/', '/api/internal/'],
    authExcludePaths = ['/api/webhooks/incoming/'],
    authThrottleAttempts = 5,
    authThrottleDecay = 1,
    authThrottleStore = rateLimitStore,
    authThrottleCacheStore = rateLimitCacheStore,
    debug = process.env.NODE_ENV !== 'production',
    middleware: extraMiddleware = [],
    namedMiddleware: extraNamedMiddleware = {},
    i18n,
    errorConfig = {},
  } = appConfig;

  if (authExcludePaths.some((path) => typeof path !== 'string' || !path.startsWith('/') || path === '/' || /[?#]/.test(path))) {
    throw new TypeError('authExcludePaths must contain explicit application paths, never the root path.');
  }

  // Build default middleware stack
  const defaultMiddleware: Array<Middleware | MiddlewareHandler> = [
    new RateLimitMiddleware({
      maxRequests: rateLimit,
      windowMs: rateLimitWindow,
      store: rateLimitStore,
      cacheStore: rateLimitCacheStore,
      trustedProxy,
    }),
    new SessionMiddleware({
      store: sessionStore ?? new DatabaseSessionStore(),
      secret,
      lifetime: sessionLifetime,
      idleLifetime: sessionIdleLifetime,
      rememberLifetime: sessionRememberLifetime,
      rememberAbsoluteLifetime: sessionRememberAbsoluteLifetime,
      warningBefore: sessionWarningBefore,
      absoluteLifetime: sessionAbsoluteLifetime,
      touchOnActivity: sessionTouchOnActivity,
      touchThrottle: sessionTouchThrottle,
    }),
  ];

  // Add auth middleware if auth manager is provided
  if (auth) {
    const authentication = new AuthenticateMiddleware(auth);
    defaultMiddleware.push(async (ctx, next) => {
      const pathname = ctx.event.url.pathname;
      const independent = authExcludePaths.some((path) => path.endsWith('/')
        ? pathname.startsWith(path)
        : pathname === path || pathname.startsWith(`${path}/`));
      if (!independent) return authentication.handle(ctx, next);
      // Signed provider routes authenticate themselves and must not inherit a browser identity.
      for (const locals of [ctx.event.locals, ctx.locals]) {
        locals.user = null;
        locals.apiKey = null;
        locals.authenticatedVia = null;
        locals.auth = undefined;
      }
      return next();
    });
  }

  // Only verified credential authentication can exempt an API call from browser protections.
  defaultMiddleware.push(new OriginMiddleware(), new CsrfMiddleware({ onlyPaths: csrfPaths, excludePaths: csrfExcludePaths }));

  // Add any extra middleware
  defaultMiddleware.push(...(extraMiddleware as any[]));

  // Build named middleware
  const namedMiddleware: Record<string, Middleware | MiddlewareHandler> = {
    'auth-throttle': new ThrottleMiddleware({
      maxAttempts: authThrottleAttempts,
      decayMinutes: authThrottleDecay,
      store: authThrottleStore,
      cacheStore: authThrottleCacheStore,
      trustedProxy,
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
    handle: async ({ event, resolve }: any): Promise<Response> => {
      if (DeploymentRuntime.isDraining()) return new Response(null, { status: 503, headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' } });
      const acceptedId = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
      const requestId = acceptedId(event.request?.headers?.get('x-request-id')) ?? randomUUID();
      const correlationId = acceptedId(event.request?.headers?.get('x-correlation-id')) ?? requestId;

      return ApplicationContext.runIsolated({ requestId, correlationId }, async () => {
        const response = await finalHandle({ event, resolve });
        try {
          response.headers.set('x-request-id', requestId);
        } catch {
          // Immutable responses can be returned by adapters; correlation still exists in logs.
        }
        return response;
      });
    },
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
