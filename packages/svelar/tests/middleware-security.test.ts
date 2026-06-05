import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  CsrfMiddleware,
  SignatureMiddleware,
  MiddlewareStack,
  type MiddlewareContext,
} from '../src/middleware/Middleware.js';
import { createSvelarApp } from '../src/hooks/index.js';

// Helper to create request-like mock
function createCtx(opts: {
  method?: string;
  pathname?: string;
  origin?: string;
  search?: string;
  headers?: Record<string, string>;
  body?: string;
} = {}): MiddlewareContext {
  const method = opts.method ?? 'GET';
  const pathname = opts.pathname ?? '/';
  const origin = opts.origin ?? 'http://localhost';
  const search = opts.search ?? '';
  const hdrs = new Map(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  const bodyText = opts.body ?? '';

  return {
    event: {
      request: {
        method,
        headers: {
          get: (name: string) => hdrs.get(name.toLowerCase()) ?? null,
        },
        clone: () => ({
          text: async () => bodyText,
          json: async () => JSON.parse(bodyText || '{}'),
          formData: async () => new Map(),
        }),
      },
      url: { pathname, origin, search },
      getClientAddress: () => '127.0.0.1',
      locals: {},
    },
    params: {},
    locals: {},
  };
}

describe('CsrfMiddleware', () => {
  it('should allow GET requests and set cookie', async () => {
    const csrf = new CsrfMiddleware();
    const stack = new MiddlewareStack();
    stack.use(csrf);

    const ctx = createCtx({ method: 'GET' });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect(result).toBeInstanceOf(Response);
    const setCookie = (result as Response).headers.get('Set-Cookie');
    expect(setCookie).toContain('XSRF-TOKEN=');
    expect(setCookie).toContain('SameSite=Lax');
    // Should NOT have HttpOnly
    expect(setCookie).not.toContain('HttpOnly');
  });

  it('should reject POST without CSRF token', async () => {
    const csrf = new CsrfMiddleware();
    const stack = new MiddlewareStack();
    stack.use(csrf);

    const ctx = createCtx({ method: 'POST' });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(419);
    const body = await (result as Response).json();
    expect(body.message).toBe('CSRF token mismatch');
  });

  it('should allow POST with valid CSRF token in header', async () => {
    const csrf = new CsrfMiddleware();
    const stack = new MiddlewareStack();
    stack.use(csrf);

    const token = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const ctx = createCtx({
      method: 'POST',
      headers: {
        cookie: `XSRF-TOKEN=${token}`,
        'x-csrf-token': token,
      },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(200);
  });

  it('should allow POST with valid CSRF token in JSON body', async () => {
    const csrf = new CsrfMiddleware();
    const stack = new MiddlewareStack();
    stack.use(csrf);

    const token = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const ctx = createCtx({
      method: 'POST',
      body: JSON.stringify({ _csrf: token }),
      headers: {
        cookie: `XSRF-TOKEN=${token}`,
        'content-type': 'application/json',
      },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect((result as Response).status).toBe(200);
  });

  it('should reject POST with mismatched CSRF token', async () => {
    const csrf = new CsrfMiddleware();
    const stack = new MiddlewareStack();
    stack.use(csrf);

    const ctx = createCtx({
      method: 'POST',
      headers: {
        cookie: 'XSRF-TOKEN=valid-token-here',
        'x-csrf-token': 'different-token',
      },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect((result as Response).status).toBe(419);
  });

  it('should exempt requests with Bearer token', async () => {
    const csrf = new CsrfMiddleware();
    const stack = new MiddlewareStack();
    stack.use(csrf);

    const ctx = createCtx({
      method: 'POST',
      headers: { authorization: 'Bearer some-jwt-token' },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect((result as Response).status).toBe(200);
  });

  it('should exempt excluded paths', async () => {
    const csrf = new CsrfMiddleware({ excludePaths: ['/api/webhooks/'] });
    const stack = new MiddlewareStack();
    stack.use(csrf);

    const ctx = createCtx({
      method: 'POST',
      pathname: '/api/webhooks/stripe',
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect((result as Response).status).toBe(200);
  });

  it('should only enforce on onlyPaths when set', async () => {
    const csrf = new CsrfMiddleware({ onlyPaths: ['/admin/'] });
    const stack = new MiddlewareStack();
    stack.use(csrf);

    // Non-admin path should pass through
    const ctx = createCtx({ method: 'POST', pathname: '/api/data' });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect(result).toBeInstanceOf(Response);
    // It passes through setTokenAndContinue, so status is 200
  });

  it('should use custom cookie and header names', async () => {
    const csrf = new CsrfMiddleware({
      cookieName: 'MY-CSRF',
      headerName: 'X-My-Csrf',
    });
    const stack = new MiddlewareStack();
    stack.use(csrf);

    const token = 'custom-token-value-1234567890123456789012345678901234567890';
    const ctx = createCtx({
      method: 'POST',
      headers: {
        cookie: `MY-CSRF=${token}`,
        'x-my-csrf': token,
      },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect((result as Response).status).toBe(200);
  });

  it('should respect tokenLength when setting the CSRF cookie', async () => {
    const csrf = new CsrfMiddleware({ tokenLength: 16 });
    const stack = new MiddlewareStack();
    stack.use(csrf);

    const result = await stack.execute(createCtx({ method: 'GET' }), async () => new Response('ok'));
    const setCookie = (result as Response).headers.get('Set-Cookie') ?? '';
    const token = setCookie.match(/XSRF-TOKEN=([^;]+)/)?.[1];

    expect(token).toHaveLength(32);
  });

  it('should apply createSvelarApp CSRF defaults to generated-app style API routes', async () => {
    const { handle } = createSvelarApp({
      secret: 'csrf-test-secret',
      rateLimit: 1000,
    });

    async function run(pathname: string, headers: Record<string, string> = {}) {
      const ctx = createCtx({
        method: 'POST',
        pathname,
        origin: 'http://localhost',
        headers,
      });
      return handle({
        event: ctx.event,
        resolve: async () => new Response('ok'),
      });
    }

    await expect(run('/api/posts')).resolves.toMatchObject({ status: 419 });
    await expect(run('/api/posts', { authorization: 'Bearer token' })).resolves.toMatchObject({ status: 200 });
    await expect(run('/api/webhooks/stripe')).resolves.toMatchObject({ status: 200 });
    await expect(run('/api/internal/broadcast')).resolves.toMatchObject({ status: 200 });
  });

  it('should default createSvelarApp secret from APP_KEY', async () => {
    const previous = process.env.APP_KEY;
    process.env.APP_KEY = 'env-app-key-secret';

    try {
      const { handle } = createSvelarApp({ rateLimit: 1000 });
      const ctx = createCtx({ method: 'GET', pathname: '/dashboard' });
      const response = await handle({
        event: ctx.event,
        resolve: async () => new Response('ok'),
      });

      expect(response.status).toBe(200);
    } finally {
      if (previous === undefined) {
        delete process.env.APP_KEY;
      } else {
        process.env.APP_KEY = previous;
      }
    }
  });
});

describe('SignatureMiddleware', () => {
  const secret = 'test-signing-secret';

  function signRequest(method: string, path: string, body: string, timestamp?: number) {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const payload = `${ts}.${method.toUpperCase()}.${path}.${body}`;
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    return { signature, timestamp: ts };
  }

  it('should reject requests without signature headers', async () => {
    const sig = new SignatureMiddleware({ secret });
    const stack = new MiddlewareStack();
    stack.use(sig);

    const ctx = createCtx({ method: 'POST', pathname: '/api/data' });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect((result as Response).status).toBe(401);
    const body = await (result as Response).json();
    expect(body.message).toBe('Missing request signature');
  });

  it('should accept correctly signed requests', async () => {
    const sig = new SignatureMiddleware({ secret });
    const stack = new MiddlewareStack();
    stack.use(sig);

    const body = '{"key":"value"}';
    const { signature, timestamp } = signRequest('POST', '/api/data', body);

    const ctx = createCtx({
      method: 'POST',
      pathname: '/api/data',
      body,
      headers: {
        'x-signature': signature,
        'x-timestamp': String(timestamp),
      },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect((result as Response).status).toBe(200);
  });

  it('should reject invalid signatures', async () => {
    const sig = new SignatureMiddleware({ secret });
    const stack = new MiddlewareStack();
    stack.use(sig);

    const ts = Math.floor(Date.now() / 1000);
    const ctx = createCtx({
      method: 'POST',
      pathname: '/api/data',
      body: '{}',
      headers: {
        'x-signature': 'invalid-signature-here',
        'x-timestamp': String(ts),
      },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect((result as Response).status).toBe(401);
    const body = await (result as Response).json();
    expect(body.message).toBe('Invalid request signature');
  });

  it('should reject expired timestamps', async () => {
    const sig = new SignatureMiddleware({ secret, tolerance: 60 });
    const stack = new MiddlewareStack();
    stack.use(sig);

    const oldTs = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
    const { signature } = signRequest('POST', '/api/data', '{}', oldTs);

    const ctx = createCtx({
      method: 'POST',
      pathname: '/api/data',
      body: '{}',
      headers: {
        'x-signature': signature,
        'x-timestamp': String(oldTs),
      },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));

    expect((result as Response).status).toBe(401);
    const body = await (result as Response).json();
    expect(body.message).toBe('Request signature expired');
  });

  it('should skip paths not in onlyPaths', async () => {
    const sig = new SignatureMiddleware({
      secret,
      onlyPaths: ['/api/secure/'],
    });
    const stack = new MiddlewareStack();
    stack.use(sig);

    // Non-secure path should pass without signature
    const ctx = createCtx({ method: 'POST', pathname: '/api/public/data' });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect((result as Response).status).toBe(200);
  });

  it('should enforce on onlyPaths', async () => {
    const sig = new SignatureMiddleware({
      secret,
      onlyPaths: ['/api/secure/'],
    });
    const stack = new MiddlewareStack();
    stack.use(sig);

    // Secure path should require signature
    const ctx = createCtx({ method: 'POST', pathname: '/api/secure/data' });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect((result as Response).status).toBe(401);
  });

  it('should use custom header names', async () => {
    const sig = new SignatureMiddleware({
      secret,
      signatureHeader: 'X-Custom-Sig',
      timestampHeader: 'X-Custom-Time',
    });
    const stack = new MiddlewareStack();
    stack.use(sig);

    const body = '';
    const { signature, timestamp } = signRequest('GET', '/', body);

    const ctx = createCtx({
      method: 'GET',
      pathname: '/',
      body,
      headers: {
        'x-custom-sig': signature,
        'x-custom-time': String(timestamp),
      },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect((result as Response).status).toBe(200);
  });

  it('should include query string in signature computation', async () => {
    const sig = new SignatureMiddleware({ secret });
    const stack = new MiddlewareStack();
    stack.use(sig);

    const body = '';
    const path = '/api/data?key=value';
    const { signature, timestamp } = signRequest('GET', path, body);

    const ctx = createCtx({
      method: 'GET',
      pathname: '/api/data',
      search: '?key=value',
      body,
      headers: {
        'x-signature': signature,
        'x-timestamp': String(timestamp),
      },
    });
    const result = await stack.execute(ctx, async () => new Response('ok'));
    expect((result as Response).status).toBe(200);
  });
});
