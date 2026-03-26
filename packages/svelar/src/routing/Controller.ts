/**
 * Svelar Controller
 *
 * Laravel-inspired base Controller class for SvelteKit route handlers.
 *
 * @example
 * ```ts
 * // src/lib/controllers/UserController.ts
 * class UserController extends Controller {
 *   async index(event: RequestEvent) {
 *     const users = await User.all();
 *     return this.json(users);
 *   }
 *
 *   async show(event: RequestEvent) {
 *     const user = await User.findOrFail(event.params.id);
 *     return this.json(user);
 *   }
 *
 *   async store(event: RequestEvent) {
 *     const data = await this.validate(event, {
 *       email: z.string().email(),
 *       name: z.string().min(2),
 *     });
 *     const user = await User.create(data);
 *     return this.json(user, 201);
 *   }
 * }
 *
 * // src/routes/api/users/+server.ts
 * import { UserController } from '$lib/controllers/UserController';
 * const ctrl = new UserController();
 * export const GET = ctrl.handle('index');
 * export const POST = ctrl.handle('store');
 * ```
 */

import { z, type ZodObject, type ZodRawShape } from 'zod';
import { MiddlewareStack, type MiddlewareHandler, Middleware } from '../middleware/Middleware.js';

// ── Types ──────────────────────────────────────────────────

export interface RequestEvent {
  request: Request;
  url: URL;
  params: Record<string, string>;
  locals: Record<string, any>;
  getClientAddress: () => string;
  cookies: any;
  platform: any;
}

// ── Controller Base Class ──────────────────────────────────

export abstract class Controller {
  private controllerMiddleware: Array<{
    middleware: Middleware | MiddlewareHandler;
    only?: string[];
    except?: string[];
  }> = [];

  /**
   * Register middleware for this controller
   */
  protected middleware(
    middleware: Middleware | MiddlewareHandler | (new () => Middleware),
    options?: { only?: string[]; except?: string[] }
  ): void {
    let mw: Middleware | MiddlewareHandler;
    if (typeof middleware === 'function' && middleware.prototype instanceof Middleware) {
      mw = new (middleware as new () => Middleware)();
    } else {
      mw = middleware as Middleware | MiddlewareHandler;
    }

    this.controllerMiddleware.push({
      middleware: mw,
      only: options?.only,
      except: options?.except,
    });
  }

  /**
   * Create a SvelteKit-compatible request handler bound to a controller method.
   *
   * @example
   * ```ts
   * export const GET = ctrl.handle('index');
   * export const POST = ctrl.handle('store');
   * ```
   */
  handle(method: string): (event: RequestEvent) => Promise<Response> {
    return async (event: RequestEvent): Promise<Response> => {
      try {
        // Build middleware stack for this method
        const applicableMiddleware = this.controllerMiddleware.filter((mw) => {
          if (mw.only && !mw.only.includes(method)) return false;
          if (mw.except && mw.except.includes(method)) return false;
          return true;
        });

        if (applicableMiddleware.length > 0) {
          const stack = new MiddlewareStack();
          for (const { middleware } of applicableMiddleware) {
            stack.use(middleware as Middleware);
          }

          const ctx = {
            event,
            params: event.params,
            locals: event.locals,
          };

          const response = await stack.execute(ctx, async () => {
            return this.callMethod(method, event);
          });

          if (response instanceof Response) return response;
        }

        return await this.callMethod(method, event);
      } catch (error: any) {
        return this.handleError(error, event);
      }
    };
  }

  // ── Response Helpers ─────────────────────────────────────

  protected json(data: any, status: number = 200, headers: Record<string, string> = {}): Response {
    const body = JSON.stringify(data, null, 2);
    return new Response(body, {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
  }

  protected text(content: string, status: number = 200): Response {
    return new Response(content, {
      status,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  protected html(content: string, status: number = 200): Response {
    return new Response(content, {
      status,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  protected redirect(url: string, status: number = 302): Response {
    return new Response(null, {
      status,
      headers: { Location: url },
    });
  }

  protected noContent(): Response {
    return new Response(null, { status: 204 });
  }

  protected created(data?: any): Response {
    if (data) return this.json(data, 201);
    return new Response(null, { status: 201 });
  }

  // ── Validation ───────────────────────────────────────────

  protected async validate<T extends ZodRawShape>(
    event: RequestEvent,
    schema: ZodObject<T> | T
  ): Promise<z.infer<ZodObject<T>>> {
    const zodSchema = schema instanceof z.ZodObject ? schema : z.object(schema);

    let data: any;
    const contentType = event.request.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      data = await event.request.json();
    } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await event.request.formData();
      data = Object.fromEntries(formData);
    } else {
      // Try query params
      data = Object.fromEntries(event.url.searchParams);
    }

    const result = zodSchema.safeParse(data);

    if (!result.success) {
      throw new ValidationError(result.error);
    }

    return result.data;
  }

  /**
   * Validate query parameters
   */
  protected validateQuery<T extends ZodRawShape>(
    event: RequestEvent,
    schema: ZodObject<T> | T
  ): z.infer<ZodObject<T>> {
    const zodSchema = schema instanceof z.ZodObject ? schema : z.object(schema);
    const data = Object.fromEntries(event.url.searchParams);
    const result = zodSchema.safeParse(data);

    if (!result.success) {
      throw new ValidationError(result.error);
    }

    return result.data;
  }

  /**
   * Validate route parameters
   */
  protected validateParams<T extends ZodRawShape>(
    event: RequestEvent,
    schema: ZodObject<T> | T
  ): z.infer<ZodObject<T>> {
    const zodSchema = schema instanceof z.ZodObject ? schema : z.object(schema);
    const result = zodSchema.safeParse(event.params);

    if (!result.success) {
      throw new ValidationError(result.error);
    }

    return result.data;
  }

  // ── Error Handling ───────────────────────────────────────

  protected handleError(error: any, event: RequestEvent): Response {
    if (error instanceof ValidationError) {
      return this.json(
        {
          message: 'Validation failed',
          errors: error.errors,
        },
        422
      );
    }

    if (error instanceof NotFoundError) {
      return this.json({ message: error.message || 'Not found' }, 404);
    }

    if (error instanceof UnauthorizedError) {
      return this.json({ message: error.message || 'Unauthorized' }, 401);
    }

    if (error instanceof ForbiddenError) {
      return this.json({ message: error.message || 'Forbidden' }, 403);
    }

    // Generic server error
    console.error(`[Svelar] Controller error:`, error);
    return this.json(
      {
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
      },
      500
    );
  }

  // ── Private ──

  private async callMethod(method: string, event: RequestEvent): Promise<Response> {
    const fn = (this as any)[method];
    if (typeof fn !== 'function') {
      throw new Error(`Method "${method}" not found on controller "${this.constructor.name}".`);
    }
    const result = await fn.call(this, event);

    // If the method returns raw data (not a Response), wrap it in JSON
    if (result instanceof Response) return result;
    return this.json(result);
  }
}

// ── Resource Controller ────────────────────────────────────

/**
 * Helper to bind all CRUD methods of a ResourceController to SvelteKit handlers.
 *
 * @example
 * ```ts
 * // src/routes/api/users/+server.ts
 * import { resource } from 'svelar/routing';
 * import { UserController } from '$lib/controllers/UserController';
 *
 * const { GET, POST } = resource(UserController);
 * export { GET, POST };
 *
 * // src/routes/api/users/[id]/+server.ts
 * const { GET, PUT, DELETE } = resource(UserController, true);
 * export { GET, PUT, DELETE };
 * ```
 */
export function resource<T extends Controller>(
  ControllerClass: new () => T,
  isSingleResource: boolean = false
): Record<string, (event: RequestEvent) => Promise<Response>> {
  const ctrl = new ControllerClass();

  if (isSingleResource) {
    return {
      GET: ctrl.handle('show'),
      PUT: ctrl.handle('update'),
      PATCH: ctrl.handle('update'),
      DELETE: ctrl.handle('destroy'),
    };
  }

  return {
    GET: ctrl.handle('index'),
    POST: ctrl.handle('store'),
  };
}

// ── Error Classes ──────────────────────────────────────────

export class ValidationError extends Error {
  public errors: Record<string, string[]>;

  constructor(zodError: z.ZodError) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.errors = {};

    for (const issue of zodError.issues) {
      const path = issue.path.join('.');
      if (!this.errors[path]) this.errors[path] = [];
      this.errors[path].push(issue.message);
    }
  }
}

export class NotFoundError extends Error {
  constructor(message: string = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}
