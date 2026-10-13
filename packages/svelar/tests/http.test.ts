import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Http,
  HttpCircuitOpenError,
  HttpRequestError,
  apiFetch,
  apiFetchJson,
  buildUrl,
  getCsrfToken,
  registerToast,
  redactHttpHeaders,
  redactHttpPayload,
  signedFetch,
} from '../src/http';

const originalFetch = globalThis.fetch;
const originalDocument = (globalThis as any).document;

describe('HTTP utilities', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).document = originalDocument;
    registerToast(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) {
      delete (globalThis as any).document;
    } else {
      (globalThis as any).document = originalDocument;
    }
    vi.restoreAllMocks();
  });

  it('extracts CSRF tokens from cookies and safely no-ops outside the browser', () => {
    delete (globalThis as any).document;
    expect(getCsrfToken()).toBeNull();

    (globalThis as any).document = {
      cookie: 'theme=dark; XSRF-TOKEN=abc%20123; other=value',
    };

    expect(getCsrfToken()).toBe('abc 123');
    expect(getCsrfToken('missing')).toBeNull();
    (globalThis as any).document.cookie = 'XSRF-TOKEN=%malformed';
    expect(getCsrfToken()).toBeNull();
  });

  it('attaches CSRF and JSON headers for mutation requests', async () => {
    (globalThis as any).document = {
      cookie: 'XSRF-TOKEN=test-token',
    };
    const calls: RequestInit[] = [];
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    await apiFetch('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ title: 'Hello' }),
    });

    const headers = new Headers(calls[0].headers);
    expect(headers.get('X-CSRF-Token')).toBe('test-token');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Accept')).toBe('application/json');
  });

  it.each(['https://external.example/api', '//external.example/api', 'https://user:password@external.example/api'])('does not forward browser CSRF cookies to %s', async (url) => {
    (globalThis as any).document = { cookie: 'XSRF-TOKEN=private-browser-token' };
    const fetch = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    globalThis.fetch = fetch as any;
    await apiFetch(url, { method: 'POST', body: '{}' });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).has('X-CSRF-Token')).toBe(false);
  });

  it('shows registered toasts for validation and network errors', async () => {
    const toasts: Array<{ variant: string; title: string; opts?: any }> = [];
    registerToast((variant, title, opts) => {
      toasts.push({ variant, title, opts });
    });

    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ message: 'Invalid payload', errors: { email: ['Required'] } }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )) as any;

    await apiFetch('/api/users', { method: 'POST', body: '{}' });
    expect(toasts).toEqual([
      {
        variant: 'warning',
        title: 'The submitted data is invalid.',
        opts: { description: 'email: Required' },
      },
    ]);

    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as any;

    await expect(apiFetch('/api/users')).rejects.toThrow('offline');
    expect(toasts.at(-1)).toEqual({
      variant: 'error',
      title: 'Network Error',
      opts: { description: 'Unable to connect. Check your internet connection.' },
    });
  });

  it('reads resource-envelope error metadata without duplicating an inline form toast', async () => {
    const toasts: unknown[] = [];
    registerToast((...args) => { toasts.push(args); });
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: null, meta: { message: 'Invalid input', errors: { email: ['Required'] } } }),
      { status: 422, headers: { 'Content-Type': 'application/json' } })) as any;
    const result = await apiFetchJson('/api/proof', { showToast: false });
    expect(result.error).toMatchObject({ message: 'Invalid input', status: 422, errors: { email: ['Required'] } });
    expect(toasts).toEqual([]);
    await apiFetch('/api/proof');
    expect(toasts).toEqual([['warning', 'The submitted data is invalid.', { description: 'email: Required' }]]);
  });

  it.each([null, [], { data: null, meta: { message: {}, errors: { invalid: [null, 5] } } }])('handles malformed error metadata without throwing (%j)', async (body) => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 422, headers: { 'Content-Type': 'application/json' } })) as any;
    const result = await apiFetchJson('/api/proof', { showToast: false });
    expect(result.status).toBe(422); expect(result.error?.message).toBe('The submitted data is invalid.');
    expect(result.error?.errors).toBeUndefined();
  });

  it('returns typed JSON success, JSON errors, text success, and network failures', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

    await expect(apiFetchJson<{ id: number }>('/api/users/1')).resolves.toMatchObject({
      data: { id: 1 },
      error: null,
      status: 200,
      ok: true,
    });

    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ message: 'Nope', errors: { name: ['Required'] } }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )) as any;

    await expect(apiFetchJson('/api/users', { showToast: false })).resolves.toMatchObject({
      data: null,
      error: {
        message: 'Nope',
        status: 422,
        errors: { name: ['Required'] },
      },
      status: 422,
      ok: false,
    });

    globalThis.fetch = vi.fn(async () => new Response('plain text', { status: 200 })) as any;
    await expect(apiFetchJson('/plain')).resolves.toMatchObject({
      data: 'plain text',
      error: null,
      ok: true,
    });

    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as any;

    await expect(apiFetchJson('/offline', { showToast: false })).resolves.toMatchObject({
      data: null,
      error: { message: 'offline', status: 0 },
      status: 0,
      ok: false,
    });
  });

  it('signs requests with HMAC headers and preserves query strings', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('ok');
    }) as any;

    await signedFetch('/api/webhooks?source=test', {
      method: 'POST',
      body: JSON.stringify({ id: 1 }),
      signingSecret: 'secret',
    });

    const headers = new Headers(calls[0].init.headers);
    expect(calls[0].url).toBe('/api/webhooks?source=test');
    expect(headers.get('X-Timestamp')).toMatch(/^\d+$/);
    expect(headers.get('X-Signature')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('builds relative URLs with query parameters', () => {
    expect(buildUrl('/api/posts', { page: 2, draft: false, empty: null, skip: undefined })).toBe(
      '/api/posts?page=2&draft=false',
    );
    expect(buildUrl('/api/posts')).toBe('/api/posts');
  });

  it('sends fluent server-side HTTP client requests with auth, query, and JSON bodies', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const response = await Http
      .baseUrl('https://api.example.com/v1')
      .withToken('token')
      .withBasicAuth('ignored', 'ignored')
      .withHeaders({ Authorization: 'Bearer token', 'X-App': 'svelar' })
      .query({ page: 1, active: true, skip: null })
      .post<{ ok: boolean }>('/users', { name: 'Admin' });

    expect(response).toMatchObject({ data: { ok: true }, status: 200, ok: true });
    expect(calls[0].url).toBe('https://api.example.com/v1/users?page=1&active=true');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('Authorization')).toBe('Bearer token');
    expect(headers.get('X-App')).toBe('svelar');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Accept')).toBe('application/json');
    expect(calls[0].init.body).toBe(JSON.stringify({ name: 'Admin' }));
  });

  it('retries server errors, rejects client errors, and times out stalled requests', async () => {
    let attempts = 0;
    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response('temporary', { status: 503, statusText: 'Service Unavailable' });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    await expect(Http.baseUrl('https://api.example.com').retry(1, 0).get('/health')).resolves.toMatchObject({
      data: { ok: true },
      status: 200,
    });
    expect(attempts).toBe(2);

    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as any;
    await expect(Http.baseUrl('https://api.example.com').retry(2, 0).get('/missing')).rejects.toMatchObject({
      name: 'HttpRequestError',
      status: 404,
      body: 'not found',
    });

    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      await new Promise((_resolve, reject) => {
        (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
      return new Response('never');
    }) as any;

    await expect(Http.baseUrl('https://api.example.com').timeout(1).get('/slow')).rejects.toBeInstanceOf(HttpRequestError);
  });

  it.each([429, 503])('does not retry %s early when Retry-After exceeds the configured wait budget', async (status) => {
    const sleep = vi.fn(async () => {});
    globalThis.fetch = vi.fn(async () => new Response('wait', { status, headers: { 'Retry-After': '120' } })) as any;
    await expect(Http.retry({ times: 2, maxDelay: 30_000, sleep }).get('https://api.example.com/budget'))
      .rejects.toMatchObject({ status, body: 'wait' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('honors long Retry-After when the caller permits that wait', async () => {
    const sleep = vi.fn(async () => {});
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('wait', { status: 429, headers: { 'Retry-After': '120' } }))
      .mockResolvedValueOnce(new Response('ready'));
    await expect(Http.retry({ times: 1, maxDelay: 150_000, sleep }).get('https://api.example.com/budget'))
      .resolves.toMatchObject({ data: 'ready', status: 200 });
    expect(sleep).toHaveBeenCalledWith(120_000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry early for an HTTP-date Retry-After above the budget', async () => {
    const sleep = vi.fn(async () => {});
    const retryAt = new Date(Date.now() + 120_000).toUTCString();
    globalThis.fetch = vi.fn(async () => new Response('wait', { status: 503, headers: { 'Retry-After': retryAt } })) as any;
    await expect(Http.retry({ times: 1, maxDelay: 30_000, sleep }).get('https://api.example.com/budget'))
      .rejects.toMatchObject({ status: 503 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retains bounded backoff when the caller explicitly ignores Retry-After', async () => {
    const sleep = vi.fn(async () => {});
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('wait', { status: 429, headers: { 'Retry-After': '120' } }))
      .mockResolvedValueOnce(new Response('ready'));
    await expect(Http.retry({ times: 1, delay: 40_000, maxDelay: 30_000, respectRetryAfter: false, sleep }).get('https://api.example.com/budget'))
      .resolves.toMatchObject({ status: 200 });
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it('supports retry policies for 429 Retry-After and exponential jitter-free backoff', async () => {
    let attempts = 0;
    const delays: number[] = [];
    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response('limited', {
          status: 429,
          headers: { 'Retry-After': '2' },
        });
      }
      if (attempts === 2) {
        return new Response('temporary', { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    await expect(Http
      .baseUrl('https://api.example.com')
      .retry({
        times: 2,
        delay: 100,
        backoff: 'exponential',
        jitter: 'none',
        sleep: async (ms) => {
          delays.push(ms);
        },
      })
      .get('/quota')).resolves.toMatchObject({
      data: { ok: true },
      status: 200,
    });

    expect(attempts).toBe(3);
    expect(delays).toEqual([2000, 200]);
  });

  it('adds idempotency keys to mutation requests and exposes request/response/error hooks', async () => {
    const events: string[] = [];
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const response = await Http
      .baseUrl('https://api.example.com')
      .withIdempotencyKey('idem-123')
      .beforeRequest((request) => {
        events.push(`before:${request.attempt}`);
        request.headers['X-Trace'] = 'trace-1';
      })
      .afterResponse(({ response }) => {
        events.push(`after:${response.status}`);
      })
      .onError(() => {
        events.push('error');
      })
      .post('/payments', { amount: 100 });

    expect(response.status).toBe(201);
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('Idempotency-Key')).toBe('idem-123');
    expect(headers.get('X-Trace')).toBe('trace-1');
    expect(events).toEqual(['before:0', 'after:201']);
  });

  it('opens circuit breakers after configured failures', async () => {
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 503 })) as any;

    const client = Http
      .baseUrl('https://circuit.example.com')
      .retry(0)
      .circuitBreaker({ key: 'test-circuit', failureThreshold: 1, cooldown: 60_000 });

    await expect(client.get('/health')).rejects.toMatchObject({
      name: 'HttpRequestError',
      status: 503,
    });

    await expect(client.get('/health')).rejects.toBeInstanceOf(HttpCircuitOpenError);
  });

  it('redacts sensitive HTTP telemetry data', () => {
    expect(redactHttpHeaders({
      Authorization: 'Bearer secret',
      'X-API-Key': 'secret',
      Accept: 'application/json',
    })).toEqual({
      Authorization: '[redacted]',
      'X-API-Key': '[redacted]',
      Accept: 'application/json',
    });

    expect(redactHttpPayload({
      email: 'user@example.com',
      nested: { refreshToken: 'secret' },
    })).toEqual({
      email: 'user@example.com',
      nested: { refreshToken: '[redacted]' },
    });
  });
});
