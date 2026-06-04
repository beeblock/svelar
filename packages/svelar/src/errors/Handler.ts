/**
 * Svelar Error Handler
 *
 * Centralized error handling with structured responses,
 * error reporting, and SvelteKit integration.
 *
 * Errors are automatically logged via the Svelar Log system
 * (console, file, stack channels) instead of leaking to the UI.
 *
 * @example
 * ```ts
 * // hooks.server.ts
 * import { ErrorHandler } from '@beeblock/svelar/errors';
 *
 * const handler = new ErrorHandler({
 *   debug: process.env.NODE_ENV !== 'production',
 *   report: async (error) => {
 *     // Send to Sentry, Datadog, etc.
 *   },
 * });
 *
 * export const handleError = handler.handleSvelteKitError();
 * ```
 */

import { Log } from '../logging/index.js';

// ── Error Classes ──────────────────────────────────────────

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string = 'The requested resource was not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string = 'Unauthenticated') {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string = 'You do not have permission to perform this action') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends HttpError {
  constructor(
    public readonly errors: Record<string, string[]>,
    message: string = 'The given data was invalid'
  ) {
    super(422, message, { errors });
    this.name = 'ValidationError';
  }
}

export class ConflictError extends HttpError {
  constructor(message: string = 'Resource conflict') {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(
    message: string = 'Too many requests',
    public readonly retryAfter?: number
  ) {
    super(429, message, retryAfter ? { retryAfter } : undefined);
    this.name = 'TooManyRequestsError';
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(503, message);
    this.name = 'ServiceUnavailableError';
  }
}

export class ModelNotFoundError extends NotFoundError {
  constructor(model: string, id?: any) {
    super(id ? `${model} with ID ${id} not found` : `${model} not found`);
    this.name = 'ModelNotFoundError';
  }
}

// ── Abort Helper ───────────────────────────────────────────

/**
 * Throw an HTTP error (like Laravel's abort())
 */
export function abort(statusCode: number, message?: string): never {
  throw new HttpError(statusCode, message ?? getDefaultMessage(statusCode));
}

/**
 * Abort if a condition is true
 */
export function abortIf(condition: boolean, statusCode: number, message?: string): void {
  if (condition) abort(statusCode, message);
}

/**
 * Abort unless a condition is true
 */
export function abortUnless(condition: boolean, statusCode: number, message?: string): void {
  if (!condition) abort(statusCode, message);
}

// ── Error Handler ──────────────────────────────────────────

export interface ErrorHandlerConfig {
  /** Show detailed errors (stack traces, etc.) */
  debug?: boolean;
  /** Custom error reporter (e.g. Sentry) */
  report?: (error: Error, context?: Record<string, any>) => void | Promise<void>;
  /** Errors that should not be reported */
  dontReport?: Array<new (...args: any[]) => Error>;
  /** Custom render function */
  render?: (error: Error, event?: any) => Response | Promise<Response>;
}

export class ErrorHandler {
  private config: ErrorHandlerConfig;

  constructor(config: ErrorHandlerConfig = {}) {
    this.config = {
      debug: process.env.NODE_ENV !== 'production',
      dontReport: [
        ValidationError,
        NotFoundError,
        UnauthorizedError,
        ForbiddenError,
      ],
      ...config,
    };
  }

  /**
   * Handle an error and return a Response
   */
  async handle(error: Error | unknown, event?: any): Promise<Response> {
    const err = error instanceof Error ? error : new Error(String(error));

    // Report error (if not in the dontReport list)
    await this.reportError(err, event);

    // Custom render
    if (this.config.render) {
      return this.config.render(err, event);
    }

    // Default rendering
    return this.renderError(err);
  }

  /**
   * Create a SvelteKit-compatible handleError hook
   */
  handleSvelteKitError(): (input: { error: unknown; event: any; status: number; message: string }) => any {
    return ({ error, event, status, message }) => {
      const err = error instanceof Error ? error : new Error(String(error));

      // Report
      this.reportError(err, event);

      // Return error body for SvelteKit
      if (err instanceof HttpError) {
        return {
          message: err.message,
          status: err.statusCode,
          ...(err.details ?? {}),
          ...(this.config.debug ? { stack: err.stack } : {}),
        };
      }

      return {
        message: this.config.debug ? err.message : 'An unexpected error occurred',
        status,
        ...(this.config.debug ? { stack: err.stack } : {}),
      };
    };
  }

  /**
   * Create an error-handling middleware
   */
  middleware() {
    const handler = this;
    return async (ctx: any, next: () => Promise<Response | void>): Promise<Response | void> => {
      try {
        return await next();
      } catch (error) {
        return handler.handle(error, ctx.event);
      }
    };
  }

  // ── Private ──

  private async reportError(error: Error, event?: any): Promise<void> {
    // Skip reporting for certain error types
    if (this.config.dontReport) {
      for (const ErrorClass of this.config.dontReport) {
        if (error instanceof ErrorClass) return;
      }
    }

    // Log via Svelar Log system (writes to configured channels: console, file, etc.)
    const context: Record<string, any> = {
      error: error.name,
      ...(event?.url ? { url: event.url.toString() } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
    };

    Log.error(error.message, context);

    // Custom reporter (Sentry, Datadog, etc.)
    if (this.config.report) {
      try {
        await this.config.report(error, event ? { url: event.url?.toString() } : undefined);
      } catch {
        // Don't let the reporter crash things
      }
    }
  }

  private renderError(error: Error): Response {
    if (error instanceof HttpError) {
      const body: Record<string, any> = {
        message: error.message,
      };

      if (error instanceof ValidationError) {
        body.errors = error.errors;
      }

      if (error.details) {
        Object.assign(body, error.details);
      }

      if (this.config.debug) {
        body.exception = error.name;
        body.stack = error.stack?.split('\n').map((l) => l.trim());
      }

      return new Response(JSON.stringify(body), {
        status: error.statusCode,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Unknown error
    const body: Record<string, any> = {
      message: this.config.debug ? error.message : 'Internal server error',
    };

    if (this.config.debug) {
      body.exception = error.name;
      body.stack = error.stack?.split('\n').map((l) => l.trim());
    }

    return new Response(JSON.stringify(body), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Helpers ────────────────────────────────────────────────

function getDefaultMessage(statusCode: number): string {
  const messages: Record<number, string> = {
    400: 'Bad request',
    401: 'Unauthenticated',
    403: 'Forbidden',
    404: 'Not found',
    405: 'Method not allowed',
    409: 'Conflict',
    419: 'Page expired',
    422: 'Unprocessable entity',
    429: 'Too many requests',
    500: 'Internal server error',
    502: 'Bad gateway',
    503: 'Service unavailable',
    504: 'Gateway timeout',
  };
  return messages[statusCode] ?? 'An error occurred';
}
