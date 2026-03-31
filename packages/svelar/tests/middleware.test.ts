import { describe, it, expect, beforeEach } from 'vitest';
import {
  Middleware,
  MiddlewareStack,
  CorsMiddleware,
  RateLimitMiddleware,
  LoggingMiddleware,
  CsrfMiddleware,
  OriginMiddleware,
  ThrottleMiddleware,
  type MiddlewareContext,
  type NextFunction,
} from '../src/middleware/Middleware.js';

// Helper to create a mock context
function createCtx(overrides: Partial<{
  method: string;
  pathname: string;
  origin: string;
  headers: Record<string, string>;
  cookies: string;
  getClientAddress: () => string;
}>= {}): MiddlewareContext {
  const method = overrides.method ?? 'GET';
  const pathname = overrides.pathname ?? '/';
  const origin = overrides.origin ?? 'http://localhost';
  const headers = new Map(Object.entries(overrides.headers ?? {}));
  if (overrides.cookies) {
    headers.set('cookie', overrides.cookies);
  }

  return {
    event: {
      request: {
        method,
        headers: {
          get: (name: string) => headers.get(name.toLowerCase()) ?? null,
        },
        clone: () => ({
          text: async () => '',
          json: async () => ({}),
          formData: async () => new Map(),
        }),
      },
      url: {
        pathname,
        origin,
        search: '',
      },
      getClientAddress: overrides.getClientAddress ?? (() => '127.0.0.1'),
      locals: {},
    },
    params: {},
    locals: {},
  };
}

describe('MiddlewareStack', () => {
  let stack: MiddlewareStack;

  beforeEach(() => {
    stack = new MiddlewareStack();
  });

  it('should start with zero middleware', () => {
    expect(stack.count()).toBe(0);
  });

  it('should add middleware and increment count', () => {
    const handler = async (_ctx: MiddlewareContext, next: NextFunction) => next();
    stack.use(handler);
    expect(stack.count()).toBe(1);
  });

  it('should execute middleware in order', async () => {
    const order: number[] = [];

    stack.use(async (_ctx, next) => {
      order.push(1);
      const res = await next();
      order.push(4);
      return res;
    });

    stack.use(async (_ctx, next) => {
      order.push(2);
      const res = await next();
      order.push(3);
      return res;
    });

    const ctx = createCtx();
    await stack.execute(ctx, async () => {
      order.push(99);
    });

    expect(order).toEqual([1, 2, 99, 3, 4]);
  });

  it('should short-circuit when middleware returns Response', async () => {
    stack.use(async (_ctx, _next) => {
      return new Response('blocked', { status: 403 });
    });

    stack.use(async (_ctx, next) => {
      return next();
    });

    const ctx = createCtx();
    const result = await stack.execute(ctx, async () => {
      return new Response('ok');
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it('should register and use named middleware', async () => {
    const called: string[] = [];

    stack.register('auth', async (_ctx, next) => {
      called.push('auth');
      return next();
    });

    const ctx = createCtx();
    await stack.execute(ctx, async () => { called.push('handler'); }, ['auth']);

    expect(called).toEqual(['auth', 'handler']);
  });

  it('should get named middleware', () => {
    const handler = async (_ctx: MiddlewareContext, next: NextFunction) => next();
    stack.register('test', handler);
    expect(stack.get('test')).toBe(handler);
    expect(stack.get('nonexistent')).toBeUndefined();
  });

  it('should accept class-based middleware via use()', () => {
    class TestMw extends Middleware {
      async handle(_ctx: MiddlewareContext, next: NextFunction) {
        return next();
      }
    }
    stack.use(TestMw);
    expect(stack.count()).toBe(1);
  });
});

describe('CorsMiddleware', () => {
  it('should add CORS headers to response', async () => {
    const cors = new CorsMiddleware({ origin: 'http://example.com' });
    const stack = new MiddlewareStack();
    stack.use(cors);

    const ctx = createCtx();
    const result = await stack.execute(ctx, async () => {
      return new Response('ok');
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
  });

  it('should default to wildcard origin', async () => {
    const cors = new CorsMiddleware();
    const stack = new MiddlewareStack();
    stack.use(cors);

    const ctx = createCtx();
    const result = await stack.execute(ctx, async () => {
      return new Response('ok');
    });

    expect((result as Response).headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('should handle OPTIONS preflight', async () => {
    const cors = new CorsMiddleware();
    const stack = new MiddlewareStack();
    stack.use(cors);

    const ctx = createCtx({ method: 'OPTIONS' });
    const result = await stack.execute(ctx, async () => {
      return new Response('ok');
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(204);
  });
});

describe('RateLimitMiddleware', () => {
  it('should allow requests under the limit', async () => {
    const limiter = new RateLimitMiddleware({ maxRequests: 5, windowMs: 60000 });
    const stack = new MiddlewareStack();
    stack.use(limiter);

    const ctx = createCtx();
    const result = await stack.execute(ctx, async () => {
      return new Response('ok');
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(200);
  });

  it('should block requests over the limit', async () => {
    const limiter = new RateLimitMiddleware({ maxRequests: 2, windowMs: 60000 });
    const stack = new MiddlewareStack();
    stack.use(limiter);

    const ctx = createCtx();

    // First 2 requests should pass
    await stack.execute(ctx, async () => new Response('ok'));
    await stack.execute(ctx, async () => new Response('ok'));

    // Third should be blocked
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
  });
});

describe('ThrottleMiddleware', () => {
  it('should allow requests under threshold', async () => {
    const throttle = new ThrottleMiddleware({ maxAttempts: 3, decayMinutes: 1 });
    const stack = new MiddlewareStack();
    stack.use(throttle);

    const ctx = createCtx({ method: 'POST', pathname: '/login' });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(200);
  });

  it('should count failed attempts and block', async () => {
    const throttle = new ThrottleMiddleware({ maxAttempts: 2, decayMinutes: 1 });
    const stack = new MiddlewareStack();
    stack.use(throttle);

    const ctx = createCtx({ method: 'POST', pathname: '/login' });

    // 2 failed attempts (401 responses)
    await stack.execute(ctx, async () => new Response('fail', { status: 401 }));
    await stack.execute(ctx, async () => new Response('fail', { status: 401 }));

    // Third attempt should be blocked
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
  });
});

describe('OriginMiddleware', () => {
  it('should allow safe methods', async () => {
    const origin = new OriginMiddleware();
    const stack = new MiddlewareStack();
    stack.use(origin);

    const ctx = createCtx({ method: 'GET' });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect((result as Response).status).toBe(200);
  });

  it('should allow same-origin requests', async () => {
    const origin = new OriginMiddleware();
    const stack = new MiddlewareStack();
    stack.use(origin);

    const ctx = createCtx({
      method: 'POST',
      origin: 'http://localhost',
      headers: { origin: 'http://localhost' },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect((result as Response).status).toBe(200);
  });

  it('should block cross-origin mutation requests', async () => {
    const origin = new OriginMiddleware();
    const stack = new MiddlewareStack();
    stack.use(origin);

    const ctx = createCtx({
      method: 'POST',
      origin: 'http://localhost',
      headers: { origin: 'http://evil.com' },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it('should allow requests with Bearer token', async () => {
    const origin = new OriginMiddleware();
    const stack = new MiddlewareStack();
    stack.use(origin);

    const ctx = createCtx({
      method: 'POST',
      headers: { authorization: 'Bearer some-token', origin: 'http://evil.com' },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect((result as Response).status).toBe(200);
  });
});
