/**
 * Svelar Hooks
 *
 * Integration with SvelteKit's hooks system.
 * Provides a Laravel-like middleware pipeline for all incoming requests.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { createSvelarHooks } from 'svelar/hooks';
 * import { AuthMiddleware } from '$lib/middleware/AuthMiddleware';
 * import { CorsMiddleware, LoggingMiddleware } from 'svelar/middleware';
 *
 * export const handle = createSvelarHooks({
 *   middleware: [LoggingMiddleware, CorsMiddleware, AuthMiddleware],
 *   onError: (error, event) => {
 *     console.error('Unhandled error:', error);
 *   },
 * });
 * ```
 */

import {
  Middleware,
  MiddlewareStack,
  type MiddlewareContext,
  type MiddlewareHandler,
} from '../middleware/Middleware.js';
import { Application } from '../container/Application.js';

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

// ── Hook Creator ───────────────────────────────────────────

/**
 * Creates a SvelteKit `handle` hook with Svelar middleware pipeline.
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
