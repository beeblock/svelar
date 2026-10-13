import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthManager } from '../src/auth/Auth.js';
import { SessionActivityController } from '../src/auth/SessionActivityController.js';
import { Hash } from '../src/hashing/Hash.js';
import type { MiddlewareContext } from '../src/middleware/Middleware.js';
import { MemorySessionStore, Session, SessionMiddleware, type SessionConfig, type SessionData } from '../src/session/Session.js';

const start = 1_800_000_000_000;
const secret = 'session-activity-regression-secret';
const signed = (id: string) => `${id}.${createHmac('sha256', secret).update(id).digest('base64url')}`;

function fixture(options: Partial<SessionConfig> = {}) {
  const store = new MemorySessionStore();
  const middleware = new SessionMiddleware({ store, secret, idleLifetime: 60, absoluteLifetime: 300, touchOnActivity: true, touchThrottle: 10, warningBefore: 20, ...options });
  const id = Session.generateId();
  const seed = (data: SessionData = {}) => store.write(id, {
    auth_user_id: 7, _svelar_created_at: start, _svelar_last_activity_at: start, _svelar_last_touched_at: start, ...data,
  }, 10000);
  const context = (method = 'GET', headers: Record<string, string> = {}, body?: string): MiddlewareContext => {
    const url = new URL('https://app.example/activity');
    return { params: {}, locals: {}, event: {
      url, params: {}, cookies: {}, platform: {}, getClientAddress: () => '192.0.2.1',
      request: new Request(url, { method, headers: { Cookie: `svelar_session=${encodeURIComponent(signed(id))}; XSRF-TOKEN=csrf-token`, ...headers }, body }),
      locals: { user: { id: 7 } },
    } };
  };
  const run = async (ctx: MiddlewareContext, handler: (session: Session) => Promise<Response> = async () => new Response('ok')) =>
    middleware.handle(ctx, () => handler(ctx.event.locals.session));
  return { store, middleware, id, seed, context, run };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(start); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Session activity policy', () => {
  it.each([{}, { _svelar_created_at: 'yesterday' }, { _svelar_created_at: start + 1 }, { _svelar_last_activity_at: NaN }])('fails closed on legacy/invalid timing metadata (%j)', async (data) => {
    const h = fixture();
    await h.store.write(h.id, { auth_user_id: 7, ...data }, 10000);
    const ctx = h.context();
    await h.run(ctx);
    expect(ctx.event.locals.session.id).not.toBe(h.id);
    expect(ctx.event.locals.session.get('auth_user_id')).toBeUndefined();
    expect(ctx.event.locals.sessionExpiredReason).toBe('invalid');
    await expect(h.store.read(h.id)).resolves.toBeNull();
  });

  it('rejects invalid policy settings and non-atomic custom stores', () => {
    expect(() => fixture({ idleLifetime: 0 })).toThrow('idleLifetime');
    expect(() => fixture({ absoluteLifetime: NaN })).toThrow('absoluteLifetime');
    expect(() => fixture({ touchThrottle: -1 })).toThrow('touchThrottle');
    expect(() => new SessionMiddleware({ secret, idleLifetime: 60, store: { read: async () => null, write: async () => {}, destroy: async () => {} } })).toThrow('compareAndSwap');
  });

  it('does not slide idle expiry on dirty polling, and expires at the exact boundary', async () => {
    const h = fixture(); await h.seed();
    vi.setSystemTime(start + 50000);
    await h.run(h.context(), async (session) => { session.set('pollCount', 1); return new Response('ok'); });
    expect((await h.store.read(h.id))!._svelar_last_activity_at).toBe(start);
    vi.setSystemTime(start + 60000);
    const ctx = h.context(); await h.run(ctx);
    expect(ctx.event.locals.session.get('auth_user_id')).toBeUndefined();
    await expect(h.store.read(h.id)).resolves.toBeNull();
  });

  it('slides idle expiry but never resets creation or extends absolute expiry', async () => {
    const h = fixture({ absoluteLifetime: 100 }); await h.seed();
    for (const elapsed of [40000, 80000]) {
      vi.setSystemTime(start + elapsed);
      await h.run(h.context('POST'));
      expect((await h.store.read(h.id))!._svelar_created_at).toBe(start);
    }
    vi.setSystemTime(start + 100000);
    const ctx = h.context('POST'); await h.run(ctx);
    expect(ctx.event.locals.session.get('auth_user_id')).toBeUndefined();
    await expect(h.store.read(h.id)).resolves.toBeNull();
  });

  it.each([
    ['GET', { Accept: 'text/event-stream', 'X-Svelar-Session-Activity': 'true' }, false],
    ['GET', { Accept: 'text/html', 'X-Svelar-Session-Activity': 'true' }, false],
    ['GET', { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' }, true],
    ['HEAD', { 'Sec-Fetch-Mode': 'navigate' }, false],
    ['POST', { 'X-Svelar-Session-Activity': 'false' }, false],
    ['POST', {}, true],
  ] as const)('classifies %s %j without promoting polling/SSE to activity', async (method, headers, active) => {
    const h = fixture(); await h.seed(); vi.setSystemTime(start + 11000);
    await h.run(h.context(method, headers));
    expect((await h.store.read(h.id))!._svelar_last_activity_at).toBe(active ? start + 11000 : start);
  });

  it('lets a trusted server mark a relevant data load and excludes failed mutations', async () => {
    const h = fixture(); await h.seed(); vi.setSystemTime(start + 11000);
    await h.run(h.context('POST'), async () => new Response('denied', { status: 403 }));
    expect((await h.store.read(h.id))!._svelar_last_activity_at).toBe(start);
    await h.run(h.context(), async (session) => { session.markActivity(); return new Response('data'); });
    expect((await h.store.read(h.id))!._svelar_last_activity_at).toBe(start + 11000);
  });

  it('throttles store writes and cookies rather than renewing on every navigation', async () => {
    const h = fixture(); await h.seed(); const write = vi.spyOn(h.store, 'write');
    vi.setSystemTime(start + 9000);
    const response = await h.run(h.context('POST'));
    expect(write).not.toHaveBeenCalled();
    expect(response!.headers.get('set-cookie')).toBeNull();
    vi.setSystemTime(start + 10000); await h.run(h.context('POST'));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('coalesces parallel activity touches into one durable write', async () => {
    const h = fixture(); await h.seed(); vi.setSystemTime(start + 11000);
    const write = vi.spyOn(h.store, 'write');
    await Promise.all(Array.from({ length: 10 }, () => h.run(h.context('POST'))));
    expect(write).toHaveBeenCalledTimes(1);
    expect((await h.store.read(h.id))!._svelar_last_activity_at).toBe(start + 11000);
  });

  it('merges concurrent dirty fields without sliding an idle polling session', async () => {
    const h = fixture(); await h.seed(); vi.setSystemTime(start + 1000);
    await Promise.all(['first', 'second'].map((key) => h.run(h.context(), async (session) => { session.set(key, true); return new Response('ok'); })));
    expect(await h.store.read(h.id)).toMatchObject({ first: true, second: true, auth_user_id: 7, _svelar_last_activity_at: start });
  });

  it('does not resurrect an expired session when a long request finishes', async () => {
    const h = fixture(); await h.seed();
    const response = await h.run(h.context('POST'), async (session) => { session.set('late', true); vi.setSystemTime(start + 60000); return new Response('late'); });
    expect(response!.status).toBe(401);
    expect(response!.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await h.store.read(h.id))?.late).toBeUndefined();
  });

  it('withholds a read-only authenticated response if it finishes after expiry', async () => {
    const h = fixture(); await h.seed();
    const ctx = h.context();
    const response = await h.run(ctx, async () => { vi.setSystemTime(start + 60000); return new Response('private'); });
    expect(response!.status).toBe(401);
    expect(ctx.event.locals.user).toBeNull();
    expect(await response!.text()).not.toContain('private');
  });

  it('accepts a concurrent renewal when a read-only response crosses its original idle deadline', async () => {
    const h = fixture(); await h.seed();
    const response = await h.run(h.context(), async () => {
      vi.setSystemTime(start + 45000);
      await h.run(h.context('POST'), async (session) => { await session.renew(); return new Response('renewed'); });
      vi.setSystemTime(start + 60000);
      return new Response('private');
    });
    expect(response!.status).toBe(200);
    expect((await h.store.read(h.id))!._svelar_last_activity_at).toBe(start + 45000);
  });

  it('does not resurrect an old ID after concurrent logout/rotation', async () => {
    const h = fixture(); await h.seed();
    let started!: () => void; let finish!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const pending = h.run(h.context('POST'), async (session) => { session.set('stale', true); started(); await gate; return new Response('stale'); });
    await ready;
    await h.run(h.context('POST'), async (session) => { session.forget('auth_user_id'); session.regenerateId(); return new Response('logout'); });
    finish();
    expect((await pending)!.status).toBe(401);
    await expect(h.store.read(h.id)).resolves.toBeNull();
  });
});

describe('Session status and explicit renewal', () => {
  const controller = new SessionActivityController();
  it('keeps status GET read-only, cache-private and independent of activity headers', async () => {
    const h = fixture(); await h.seed(); vi.setSystemTime(start + 45000);
    const write = vi.spyOn(h.store, 'write');
    const ctx = h.context('GET', { 'Sec-Fetch-Mode': 'navigate' });
    const response = await h.run(ctx, async () => controller.status(ctx.event));
    expect(await response!.json()).toMatchObject({ data: { remainingSeconds: 15, warningAt: start + 40000, absoluteExpiresAt: start + 300000 } });
    expect(response!.headers.get('cache-control')).toContain('no-store');
    expect(write).not.toHaveBeenCalled();
  });

  it('renews with authenticated user intent and CSRF, capped at absolute lifetime', async () => {
    const h = fixture({ absoluteLifetime: 100 }); await h.seed(); vi.setSystemTime(start + 45000);
    const ctx = h.context('POST', { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-token', Origin: 'https://app.example' }, '{}');
    const response = await h.run(ctx, async () => controller.renew(ctx.event));
    expect(response!.status).toBe(200);
    expect(await response!.json()).toMatchObject({ data: { lastActivityAt: start + 45000, expiresAt: start + 100000, remainingSeconds: 55 } });
    expect(response!.headers.get('set-cookie')).toContain('Max-Age=55');
  });

  it.each([
    [{ Authorization: 'Bearer token' }, '{}', 419],
    [{ 'X-CSRF-Token': 'wrong' }, '{}', 419],
    [{ 'X-CSRF-Token': 'csrf-token', Origin: 'https://foreign.example' }, '{}', 419],
    [{ 'X-CSRF-Token': 'csrf-token' }, '{"expiresAt":9999999999999}', 422],
    [{ 'X-CSRF-Token': 'csrf-token' }, '{invalid', 422],
  ])('rejects CSRF bypasses and client-supplied policy data (%j)', async (headers, body, code) => {
    const h = fixture(); await h.seed(); vi.setSystemTime(start + 45000);
    const ctx = h.context('POST', { 'Content-Type': 'application/json', ...headers }, body);
    expect((await h.run(ctx, async () => controller.renew(ctx.event)))!.status).toBe(code);
    expect((await h.store.read(h.id))!._svelar_last_activity_at).toBe(start);
  });

  it('rejects anonymous/bearer-only renewal and never renews expired credentials', async () => {
    const h = fixture(); await h.seed(); const ctx = h.context('POST', { 'X-CSRF-Token': 'csrf-token', 'Content-Type': 'application/json' }, '{}');
    ctx.event.locals.user = null;
    expect((await h.run(ctx, async () => controller.renew(ctx.event)))!.status).toBe(401);
    vi.setSystemTime(start + 60000);
    const expired = h.context('POST', { 'X-CSRF-Token': 'csrf-token', 'Content-Type': 'application/json' }, '{}');
    expect((await h.run(expired, async () => controller.renew(expired.event)))!.status).toBe(401);
  });

  it('coalesces parallel explicit renewals without changing the absolute deadline', async () => {
    const h = fixture(); await h.seed(); vi.setSystemTime(start + 45000);
    const write = vi.spyOn(h.store, 'write');
    const responses = await Promise.all(Array.from({ length: 5 }, () => {
      const ctx = h.context('POST', { 'X-CSRF-Token': 'csrf-token', 'Content-Type': 'application/json' }, '{}');
      return h.run(ctx, async () => controller.renew(ctx.event));
    }));
    expect(responses.every((response) => response?.status === 200)).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect((await h.store.read(h.id))!._svelar_created_at).toBe(start);
  });

  it('does not report a successful renewal when persistence crosses the absolute deadline', async () => {
    const h = fixture({ absoluteLifetime: 50 }); await h.seed(); vi.setSystemTime(start + 45000);
    const original = h.store.compareAndSwap.bind(h.store);
    vi.spyOn(h.store, 'compareAndSwap').mockImplementation(async (...args) => {
      vi.setSystemTime(start + 50000);
      return original(...args);
    });
    const ctx = h.context('POST', { 'X-CSRF-Token': 'csrf-token', 'Content-Type': 'application/json' }, '{}');
    expect((await h.run(ctx, async () => controller.renew(ctx.event)))!.status).toBe(401);
    await expect(h.store.read(h.id)).resolves.toBeNull();
  });
});

describe('Real per-login remember-me', () => {
  async function auth() {
    Hash.configure({ driver: 'scrypt' });
    const password = await Hash.make('valid-password');
    const user = { getAttribute: (key: string) => ({ id: 7, email: 'user@example.com', password })[key as 'id' | 'email' | 'password'] };
    return new AuthManager({ guard: 'session', model: { where: () => ({ first: async () => user }), find: async () => user } });
  }

  it.each([false, true])('selects real cookie persistence and server lifetime (remember=%s)', async (remember) => {
    const manager = await auth();
    const h = fixture({ rememberLifetime: 600, rememberAbsoluteLifetime: 900, expireOnClose: true });
    const ctx = h.context('POST');
    const response = await h.run(ctx, async (session) => {
      expect(await manager.attempt({ email: 'user@example.com', password: 'valid-password' }, session, { remember })).not.toBeNull();
      return new Response('login');
    });
    const session: Session = ctx.event.locals.session;
    expect(session.id).not.toBe(h.id);
    expect(session.getActivityStatus()?.remembered).toBe(remember);
    if (remember) expect(response!.headers.get('set-cookie')).toContain('Max-Age=600');
    else expect(response!.headers.get('set-cookie')).not.toContain('Max-Age');
    expect(await h.store.read(session.id)).toMatchObject({ auth_user_id: 7, _svelar_remember: remember });
    vi.setSystemTime(start + 60000);
    expect(await manager.resolveFromSession(session)).toBe(remember ? manager.user() : null);
  });

  it('does not set persistence on invalid credentials or permit an unconfigured fake remember flag', async () => {
    const manager = await auth(); const h = fixture(); const ctx = h.context('POST');
    await h.run(ctx, async (session) => {
      await expect(manager.attempt({ email: 'user@example.com', password: 'wrong' }, session, { remember: true })).resolves.toBeNull();
      expect(session.has('_svelar_remember')).toBe(false);
      await expect(manager.attempt({ email: 'user@example.com', password: 'valid-password' }, session, { remember: true })).rejects.toThrow('rememberLifetime');
      expect(manager.user()).toBeNull(); return new Response('invalid', { status: 401 });
    });
  });

  it('revokes a remembered login on logout even after the normal idle window', async () => {
    const manager = await auth(); const h = fixture({ rememberLifetime: 600, rememberAbsoluteLifetime: 900 });
    const login = h.context('POST');
    await h.run(login, async (session) => { await manager.attempt({ email: 'user@example.com', password: 'valid-password' }, session, { remember: true }); return new Response('login'); });
    const oldId: string = login.event.locals.session.id;
    vi.setSystemTime(start + 90000);
    const logout = h.context('POST', { Cookie: `svelar_session=${encodeURIComponent(signed(oldId))}` });
    const response = await h.run(logout, async (session) => { await manager.logout(session); return new Response('logout'); });
    expect(response!.status).toBe(200);
    await expect(h.store.read(oldId)).resolves.toBeNull();
    expect(logout.event.locals.session.get('auth_user_id')).toBeUndefined();
    expect(logout.event.locals.session.getActivityStatus().expired).toBe(false);
  });
});
