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

import { randomUUID } from 'node:crypto';
import { Log } from '../logging/index.js';
import { ApplicationContext } from '../support/Context.js';

// ── Error Classes ──────────────────────────────────────────

type ErrorLike = {
  name: string;
  message: string;
  stack?: string;
  statusCode?: number;
  status?: number;
  body?: Record<string, any>;
  details?: Record<string, any>;
  errors?: Record<string, string[]>;
};

type HttpErrorLike = ErrorLike & ({ statusCode: number } | { status: number });

export class HttpError extends Error implements ErrorLike {
  public readonly statusCode: number;
  public readonly status: number;
  public readonly details?: Record<string, any>;
  public readonly body: Record<string, any>;

  constructor(statusCode: number, message: string, details?: Record<string, any>) {
    super(message);
    this.statusCode = statusCode;
    this.status = statusCode;
    this.details = details;
    this.body = { message, ...(details ?? {}) };
    this.name = 'HttpError';

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    } else {
      this.stack = new Error(message).stack;
    }
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

function normalizeError(error: Error | unknown): ErrorLike {
  if (error instanceof Error || isHttpErrorLike(error)) {
    const err = error as ErrorLike;
    if (!err.message && err.body?.message) err.message = err.body.message;
    if (!err.name) err.name = 'Error';
    return err;
  }

  return new Error(String(error)) as ErrorLike;
}

function errorStatus(error: unknown): number | undefined {
  const err = error as any;
  return typeof err?.statusCode === 'number'
    ? err.statusCode
    : typeof err?.status === 'number'
      ? err.status
      : undefined;
}

function errorDetails(error: unknown): Record<string, any> | undefined {
  const err = error as any;
  return err?.details ?? err?.body;
}

function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  const status = errorStatus(error);
  return typeof status === 'number' && status >= 400;
}

function isValidationErrorLike(error: unknown): error is ErrorLike & { errors: Record<string, string[]> } {
  return error instanceof ValidationError || !!(error as any).errors || !!(error as any).body?.errors;
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
  report?: (error: ErrorLike, context?: Record<string, any>) => void | Promise<void>;
  /** Errors that should not be reported */
  dontReport?: Array<new (...args: any[]) => unknown>;
  /** Custom render function */
  render?: (error: ErrorLike, event?: any, incidentId?: string) => Response | Promise<Response>;
  /** Include incident ID in safe error responses (default: true). */
  exposeIncidentId?: boolean;
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
      exposeIncidentId: true,
      ...config,
    };
  }

  /**
   * Handle an error and return a Response
   */
  async handle(error: Error | unknown, event?: any): Promise<Response> {
    const err = normalizeError(error);

    // Report error (if not in the dontReport list)
    const incidentId = await this.reportError(err, event);

    // Custom render
    if (this.config.render) {
      return this.config.render(err, event, incidentId);
    }

    // Default rendering
    return this.renderError(err, incidentId);
  }

  /**
   * Create a SvelteKit-compatible handleError hook
   */
  handleSvelteKitError(): (input: { error: unknown; event: any; status: number; message: string }) => any {
    return ({ error, event, status, message }) => {
      const err = normalizeError(error);

      // Report
      const incidentId = this.shouldReport(err) ? this.createIncidentId() : undefined;
      void this.reportError(err, event, incidentId);

      // Return error body for SvelteKit
      if (err instanceof HttpError || isHttpErrorLike(err)) {
        return {
          message: err.message,
          status: errorStatus(err),
          ...(this.config.exposeIncidentId && incidentId ? { incidentId } : {}),
          ...(errorDetails(err) ?? {}),
          ...(this.config.debug ? { stack: err.stack } : {}),
        };
      }

      return {
        message: this.config.debug ? err.message : 'An unexpected error occurred',
        status,
        ...(this.config.exposeIncidentId && incidentId ? { incidentId } : {}),
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

  private shouldReport(error: ErrorLike): boolean {
    // Skip reporting for certain error types
    if (this.config.dontReport) {
      for (const ErrorClass of this.config.dontReport) {
        if (error instanceof ErrorClass) return false;
      }
    }
    return true;
  }

  private createIncidentId(): string {
    return `inc_${randomUUID()}`;
  }

  private async reportError(error: ErrorLike, event?: any, incidentId?: string): Promise<string | undefined> {
    if (!this.shouldReport(error)) return undefined;

    const resolvedIncidentId = incidentId ?? this.createIncidentId();
    ApplicationContext.set('incidentId', resolvedIncidentId);

    // Log via Svelar Log system (writes to configured channels: console, file, etc.)
    const context: Record<string, any> = {
      incidentId: resolvedIncidentId,
      error: error.name,
      status: errorStatus(error) ?? 500,
      ...(event?.url ? { url: event.url.toString() } : {}),
      ...(event?.request?.method ? { method: event.request.method } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
    };

    await Log.error(error.message, context);

    // Custom reporter (Sentry, Datadog, etc.)
    if (this.config.report) {
      try {
        await this.config.report(error, event ? {
          incidentId: resolvedIncidentId,
          url: event.url?.toString(),
          method: event.request?.method,
          ...ApplicationContext.snapshot(),
        } : { incidentId: resolvedIncidentId, ...ApplicationContext.snapshot() });
      } catch {
        // Don't let the reporter crash things
      }
    }

    return resolvedIncidentId;
  }

  private renderError(error: ErrorLike, incidentId?: string): Response {
    if (error instanceof HttpError || isHttpErrorLike(error)) {
      const body: Record<string, any> = {
        message: error.message,
      };
      if (this.config.exposeIncidentId && incidentId) {
        body.incidentId = incidentId;
      }

      if (isValidationErrorLike(error)) {
        body.errors = (error as any).errors ?? (error as any).body?.errors;
      }

      const details = errorDetails(error);
      if (details) {
        Object.assign(body, details);
      }

      if (this.config.debug) {
        body.exception = error.name;
        body.stack = error.stack?.split('\n').map((l: string) => l.trim());
      }

      return new Response(JSON.stringify(body), {
        status: errorStatus(error),
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Unknown error
    const body: Record<string, any> = {
      message: this.config.debug ? error.message : 'Internal server error',
    };
    if (this.config.exposeIncidentId && incidentId) {
      body.incidentId = incidentId;
    }

    if (this.config.debug) {
      body.exception = error.name;
      body.stack = error.stack?.split('\n').map((l: string) => l.trim());
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
