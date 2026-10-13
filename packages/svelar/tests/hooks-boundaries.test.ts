import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSvelarApp } from '../src/hooks/index.js';
import { MemorySessionStore } from '../src/session/Session.js';
import { ApplicationContext } from '../src/support/Context.js';
import { DeploymentRuntime } from '../src/deployment/Runtime.js';
import type { AuthManager } from '../src/auth/Auth.js';
import { CsrfMiddleware, SignatureMiddleware } from '../src/middleware/Middleware.js';

function event(tenant = 'one', requestId = '') {
  const url = new URL('http://localhost/api/proof');
  return { url, params: { tenant }, locals: {}, getClientAddress: () => '127.0.0.1',
    request: new Request(url, { headers: { 'X-Request-ID': requestId, 'X-Correlation-ID': requestId } }) };
}
function app() { return createSvelarApp({ secret: 'fixture-only-request-boundaries-secret', sessionStore: new MemorySessionStore(), rateLimit: 1000 }); }
beforeEach(() => { DeploymentRuntime.configure({}); ApplicationContext.clear(); });
afterEach(() => { DeploymentRuntime.configure({}); ApplicationContext.clear(); });

describe('HTTP execution and drain boundaries', () => {
  it.each(['/api/internal/other', '/api/internal/broadcast-evil', '/api/internal/broadcast/child', '/api/webhooks/stripe', '/api/webhooks/incoming-evil'])('retains CSRF outside the exact signed bridge: %s', async (path) => {
    const runtime = app();
    const url = new URL(path, 'http://localhost');
    const resolve = vi.fn(() => new Response('must not execute'));
    const response = await runtime.handle({ event: { ...event(), url, request: new Request(url, { method: 'POST' }) }, resolve });
    expect(response.status).toBe(419);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(['/api/internal/broadcast', '/api/webhooks/incoming/provider'])('delegates only the signed endpoint namespace to its handler: %s', async (path) => {
    const url = new URL(path, 'http://localhost');
    const response = await app().handle({ event: { ...event(), url, request: new Request(url, { method: 'POST' }) }, resolve: async () => new Response('handler must verify its credential') });
    expect(response.status).toBe(200);
  });

  it('uses path-segment prefix boundaries for explicitly configured exclusions', async () => {
    const runtime = createSvelarApp({ secret: 'fixture-only-request-boundaries-secret', csrfExcludePaths: ['/api/provider'], csrfExcludeExactPaths: [] });
    for (const [path, status] of [['/api/provider', 200], ['/api/provider/callback', 200], ['/api/provider-evil', 419]] as const) {
      const url = new URL(path, 'http://localhost');
      expect((await runtime.handle({ event: { ...event(), url, request: new Request(url, { method: 'POST' }) }, resolve: async () => new Response('ok') })).status).toBe(status);
    }
  });

  it.each(['relative', '//provider', '/api/provider?skip', '/api/provider#skip', '/api/\\provider', '/api/provider\n'])('rejects ambiguous CSRF path configuration: %s', (path) => {
    for (const key of ['onlyPaths', 'excludePaths', 'excludeExactPaths'] as const) expect(() => new CsrfMiddleware({ [key]: [path] })).toThrow(TypeError);
  });

  it('never inherits a CLI/global tenant or actor into an incoming request', async () => {
    ApplicationContext.set('tenantId', 'unrelated-cli'); ApplicationContext.set('actorId', 'unrelated-actor');
    const response = await app().handle({ event: event(), resolve: async () => new Response(JSON.stringify(ApplicationContext.snapshot())) });
    const context = await response.json(); expect(context.tenantId).toBeUndefined(); expect(context.actorId).toBeUndefined();
    expect(context.requestId).toBeTruthy(); expect(ApplicationContext.get('tenantId')).toBe('unrelated-cli');
  });
  it('isolates two simultaneous tenant executions', async () => {
    const runtime = app();
    const handle = (tenant: string, wait: number) => runtime.handle({ event: event(tenant), resolve: async () => {
      ApplicationContext.set('tenantId', tenant); await new Promise((resolve) => setTimeout(resolve, wait));
      return new Response(String(ApplicationContext.get('tenantId')));
    } });
    const results = await Promise.all([handle('one', 20), handle('two', 0)]);
    expect(await results[0].text()).toBe('one'); expect(await results[1].text()).toBe('two');
  });
  it('bounds untrusted correlation metadata before storing or reflecting it', async () => {
    const response = await app().handle({ event: event('one', 'x'.repeat(500)), resolve: async () => new Response(JSON.stringify(ApplicationContext.snapshot())) });
    const context = await response.json(); expect(context.requestId.length).toBeLessThanOrEqual(128);
    expect(context.correlationId).toBe(context.requestId); expect(response.headers.get('x-request-id')).toBe(context.requestId);
  });
  it('refuses new requests after drain but lets an already-started request finish', async () => {
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; }); const waiting = new Promise<void>((resolve) => { release = resolve; });
    const runtime = app();
    const inFlight = runtime.handle({ event: event(), resolve: async () => { entered(); await waiting; return new Response('finished'); } });
    await started; DeploymentRuntime.beginDrain();
    const declined = await runtime.handle({ event: event(), resolve: async () => new Response('must not execute') });
    expect(declined.status).toBe(503); expect(declined.headers.get('Retry-After')).toBe('1');
    release(); expect(await (await inFlight).text()).toBe('finished');
  });

  it('lets independently signed incoming routes inspect provider credentials without trusting them', async () => {
    const resolveFromToken = vi.fn().mockResolvedValue(null);
    const auth = { clearUser() {}, resolveFromToken, resolveFromApiToken: vi.fn().mockResolvedValue(null),
      resolveFromSession: vi.fn().mockResolvedValue(null), apiKey: () => null } as unknown as AuthManager;
    const runtime = createSvelarApp({ auth, secret: 'fixture-only-request-boundaries-secret', sessionStore: new MemorySessionStore(), rateLimit: 1000 });
    const url = new URL('http://localhost/api/webhooks/incoming/provider');
    const incoming = { ...event(), url, request: new Request(url, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer provider-owned-secret' } }) };
    const response = await runtime.handle({ event: incoming, resolve: async (requestEvent: any) => {
      expect(requestEvent.locals.user).toBeNull();
      expect(requestEvent.locals.apiKey).toBeNull();
      expect(requestEvent.locals.authenticatedVia).toBeNull();
      expect(requestEvent.request.headers.get('authorization')).toBe('Bearer provider-owned-secret');
      return await new SignatureMiddleware({ secret: 'fixture-provider-signature' }).handle({ event: requestEvent, locals: requestEvent.locals, params: {} }, async () => new Response('must not execute'));
    } });
    expect(resolveFromToken).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
  });

  it('does not exempt incoming-prefix lookalikes or normal cookie actions from authentication', async () => {
    const resolveFromToken = vi.fn().mockResolvedValue(null);
    const resolveFromApiToken = vi.fn().mockResolvedValue(null);
    const auth = { clearUser() {}, resolveFromToken, resolveFromApiToken,
      resolveFromSession: vi.fn().mockResolvedValue({ id: 1 }), apiKey: () => null } as unknown as AuthManager;
    const runtime = createSvelarApp({ auth, secret: 'fixture-only-request-boundaries-secret', sessionStore: new MemorySessionStore(), rateLimit: 1000 });
    for (const path of ['/api/webhooks/incoming-evil', '/api/posts']) {
      const url = new URL(path, 'http://localhost');
      const incoming = { ...event(), url, request: new Request(url, { method: 'POST', headers: { Authorization: 'Bearer forged' } }) };
      const resolve = vi.fn(() => new Response('must not execute'));
      const response = await runtime.handle({ event: incoming, resolve });
      expect(response.status).toBe(401); expect(resolve).not.toHaveBeenCalled();
    }
    expect(resolveFromToken).toHaveBeenCalledTimes(2);
    expect(auth.resolveFromSession).not.toHaveBeenCalled();
  });

  it.each(['/', '', 'relative', '/api/hook?wildcard'])('rejects an ambiguous authentication exclusion: %s', (path) => {
    expect(() => createSvelarApp({ secret: 'fixture-only-request-boundaries-secret', authExcludePaths: [path] })).toThrow(/authExcludePaths/);
  });
});
