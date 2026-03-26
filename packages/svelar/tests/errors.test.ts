import { describe, it, expect, beforeEach } from 'vitest';
import {
  ErrorHandler,
  HttpError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  TooManyRequestsError,
  ServiceUnavailableError,
  ModelNotFoundError,
  abort,
  abortIf,
  abortUnless,
} from '../src/errors/Handler';

describe('Error Classes', () => {
  describe('HttpError', () => {
    it('should create an HTTP error', () => {
      const error = new HttpError(400, 'Bad Request');

      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Bad Request');
      expect(error.name).toBe('HttpError');
    });

    it('should include optional details', () => {
      const error = new HttpError(422, 'Validation failed', { field: 'email' });

      expect(error.statusCode).toBe(422);
      expect(error.details).toEqual({ field: 'email' });
    });

    it('should be an instance of Error', () => {
      const error = new HttpError(500, 'Internal Server Error');

      expect(error instanceof Error).toBe(true);
    });
  });

  describe('NotFoundError', () => {
    it('should create a 404 error with default message', () => {
      const error = new NotFoundError();

      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('The requested resource was not found');
    });

    it('should allow custom message', () => {
      const error = new NotFoundError('User not found');

      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('User not found');
    });

    it('should be an HttpError', () => {
      const error = new NotFoundError();

      expect(error instanceof HttpError).toBe(true);
    });
  });

  describe('UnauthorizedError', () => {
    it('should create a 401 error', () => {
      const error = new UnauthorizedError();

      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Unauthenticated');
    });

    it('should allow custom message', () => {
      const error = new UnauthorizedError('Session expired');

      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Session expired');
    });
  });

  describe('ForbiddenError', () => {
    it('should create a 403 error', () => {
      const error = new ForbiddenError();

      expect(error.statusCode).toBe(403);
      expect(error.message).toContain('do not have permission');
    });

    it('should allow custom message', () => {
      const error = new ForbiddenError('Admin access required');

      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('Admin access required');
    });
  });

  describe('ValidationError', () => {
    it('should create a 422 error with validation errors', () => {
      const errors = { email: ['Invalid email format'] };
      const error = new ValidationError(errors);

      expect(error.statusCode).toBe(422);
      expect(error.errors).toEqual(errors);
      expect(error.message).toBe('The given data was invalid');
    });

    it('should allow custom message', () => {
      const errors = { name: ['Required'] };
      const error = new ValidationError(errors, 'Registration failed');

      expect(error.message).toBe('Registration failed');
      expect(error.errors).toEqual(errors);
    });

    it('should include errors in details', () => {
      const errors = { email: ['Invalid'] };
      const error = new ValidationError(errors);

      expect(error.details).toEqual({ errors });
    });
  });

  describe('ConflictError', () => {
    it('should create a 409 error', () => {
      const error = new ConflictError();

      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Resource conflict');
    });

    it('should allow custom message', () => {
      const error = new ConflictError('Email already exists');

      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Email already exists');
    });
  });

  describe('TooManyRequestsError', () => {
    it('should create a 429 error', () => {
      const error = new TooManyRequestsError();

      expect(error.statusCode).toBe(429);
      expect(error.message).toBe('Too many requests');
    });

    it('should include retry-after information', () => {
      const error = new TooManyRequestsError('Rate limit exceeded', 60);

      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(60);
      expect(error.details).toEqual({ retryAfter: 60 });
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should create a 503 error', () => {
      const error = new ServiceUnavailableError();

      expect(error.statusCode).toBe(503);
      expect(error.message).toBe('Service temporarily unavailable');
    });

    it('should allow custom message', () => {
      const error = new ServiceUnavailableError('Database is down');

      expect(error.statusCode).toBe(503);
      expect(error.message).toBe('Database is down');
    });
  });

  describe('ModelNotFoundError', () => {
    it('should create a 404 error for missing model', () => {
      const error = new ModelNotFoundError('User');

      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('User not found');
    });

    it('should include model ID in message', () => {
      const error = new ModelNotFoundError('Post', 123);

      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Post with ID 123 not found');
    });

    it('should be a NotFoundError', () => {
      const error = new ModelNotFoundError('User', 1);

      expect(error instanceof NotFoundError).toBe(true);
      expect(error instanceof HttpError).toBe(true);
    });
  });
});

describe('Abort Helpers', () => {
  describe('abort', () => {
    it('should throw HttpError with status code', () => {
      expect(() => abort(404)).toThrow(HttpError);
      expect(() => abort(404)).toThrow(/not found/i);
    });

    it('should use provided message', () => {
      expect(() => abort(500, 'Custom error message')).toThrow('Custom error message');
    });

    it('should use default message if not provided', () => {
      expect(() => abort(404)).toThrow(/not found/i);
    });

    it('should never return (always throws)', () => {
      const thrower = () => abort(400);

      expect(thrower).toThrow();
    });
  });

  describe('abortIf', () => {
    it('should abort if condition is true', () => {
      expect(() => abortIf(true, 403, 'Forbidden')).toThrow('Forbidden');
    });

    it('should not abort if condition is false', () => {
      expect(() => abortIf(false, 403, 'Forbidden')).not.toThrow();
    });

    it('should use default message', () => {
      expect(() => abortIf(true, 500)).toThrow();
    });

    it('should work with boolean expressions', () => {
      const isAdmin = false;

      expect(() => abortIf(!isAdmin, 403, 'Admin access required')).toThrow(
        'Admin access required'
      );
    });
  });

  describe('abortUnless', () => {
    it('should abort if condition is false', () => {
      expect(() => abortUnless(false, 401, 'Not authenticated')).toThrow(
        'Not authenticated'
      );
    });

    it('should not abort if condition is true', () => {
      expect(() => abortUnless(true, 401, 'Not authenticated')).not.toThrow();
    });

    it('should use default message', () => {
      expect(() => abortUnless(false, 500)).toThrow();
    });

    it('should work with auth checks', () => {
      const isAuthenticated = false;

      expect(() => abortUnless(isAuthenticated, 401)).toThrow();
    });
  });
});

describe('ErrorHandler', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const handler = new ErrorHandler();

      expect(handler).toBeDefined();
    });

    it('should accept custom config', () => {
      const reporter = vi.fn();
      const handler = new ErrorHandler({
        debug: false,
        report: reporter,
      });

      expect(handler).toBeDefined();
    });

    it('should set debug mode from NODE_ENV', () => {
      const originalEnv = process.env.NODE_ENV;

      try {
        process.env.NODE_ENV = 'production';
        const handler = new ErrorHandler();
        expect(handler).toBeDefined();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('handle', () => {
    it('should handle HttpError', async () => {
      const handler = new ErrorHandler();
      const error = new HttpError(400, 'Bad request');

      const response = await handler.handle(error);

      expect(response).toBeDefined();
    });

    it('should handle generic errors', async () => {
      const handler = new ErrorHandler();
      const error = new Error('Something went wrong');

      const response = await handler.handle(error);

      expect(response).toBeDefined();
    });

    it('should call custom reporter', async () => {
      const reportFn = vi.fn();
      const handler = new ErrorHandler({ report: reportFn });
      const error = new Error('Test error');

      await handler.handle(error);

      expect(reportFn).toHaveBeenCalledWith(error, undefined);
    });

    it('should pass event context to reporter', async () => {
      const reportFn = vi.fn();
      const handler = new ErrorHandler({ report: reportFn });
      const error = new Error('Test error');
      const event = { method: 'POST', path: '/api/users', url: new URL('http://localhost/api/users') };

      await handler.handle(error, event);

      expect(reportFn).toHaveBeenCalledWith(error, { url: 'http://localhost/api/users' });
    });

    it('should skip reporting for dontReport errors', async () => {
      const reportFn = vi.fn();
      const handler = new ErrorHandler({
        report: reportFn,
        dontReport: [ValidationError],
      });
      const error = new ValidationError({ email: ['Invalid'] });

      await handler.handle(error);

      expect(reportFn).not.toHaveBeenCalled();
    });

    it('should call custom render function', async () => {
      const renderFn = vi.fn(() => new Response('Custom error'));
      const handler = new ErrorHandler({ render: renderFn });
      const error = new Error('Test');

      const response = await handler.handle(error);

      expect(renderFn).toHaveBeenCalledWith(error, undefined);
    });
  });

  describe('handleSvelteKitError', () => {
    it('should return a SvelteKit error handler', () => {
      const handler = new ErrorHandler();
      const svelteKitHandler = handler.handleSvelteKitError();

      expect(typeof svelteKitHandler).toBe('function');
    });

    it('should handle HttpError with correct status', () => {
      const handler = new ErrorHandler();
      const svelteKitHandler = handler.handleSvelteKitError();

      const result = svelteKitHandler({
        error: new HttpError(404, 'Not found'),
        event: {},
        status: 404,
        message: 'Not found',
      });

      expect(result.status).toBe(404);
      expect(result.message).toBe('Not found');
    });

    it('should include details in response', () => {
      const handler = new ErrorHandler({ debug: true });
      const svelteKitHandler = handler.handleSvelteKitError();

      const result = svelteKitHandler({
        error: new HttpError(422, 'Invalid', { errors: { email: ['Required'] } }),
        event: {},
        status: 422,
        message: 'Invalid',
      });

      expect(result.errors).toEqual({ email: ['Required'] });
    });

    it('should include stack trace in debug mode', () => {
      const handler = new ErrorHandler({ debug: true });
      const svelteKitHandler = handler.handleSvelteKitError();

      const error = new Error('Test error');
      const result = svelteKitHandler({
        error,
        event: {},
        status: 500,
        message: 'Test error',
      });

      expect(result.stack).toBeDefined();
    });

    it('should not include stack trace in production', () => {
      const handler = new ErrorHandler({ debug: false });
      const svelteKitHandler = handler.handleSvelteKitError();

      const result = svelteKitHandler({
        error: new Error('Test error'),
        event: {},
        status: 500,
        message: 'Test error',
      });

      expect(result.stack).toBeUndefined();
    });
  });
});

// Import vi for mocking
import { vi } from 'vitest';
