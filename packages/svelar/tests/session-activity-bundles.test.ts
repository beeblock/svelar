import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

describe('Session activity across independently bundled subpaths', () => {
  let root: string;
  let hooks: typeof import('../src/hooks/index.js');
  let sessions: typeof import('../src/session/Session.js');
  let auth: typeof import('../src/auth/index.js');
  let activity: typeof import('../src/session/Activity.js');
  let controllers: typeof import('../src/auth/SessionActivityController.js');
  const secret = 'cross-bundle-session-regression-secret';

  beforeAll(async () => {
    root = await mkdtemp(resolve('.test-session-activity-bundles-'));
    await build({
      entryPoints: {
        hooks: resolve('src/hooks/index.ts'), session: resolve('src/session/Session.ts'),
        auth: resolve('src/auth/index.ts'), activity: resolve('src/session/Activity.ts'),
        controller: resolve('src/auth/SessionActivityController.ts'),
      },
      outdir: root, outExtension: { '.js': '.mjs' }, bundle: true, splitting: false,
      packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
    });
    hooks = await import(pathToFileURL(join(root, 'hooks.mjs')).href);
    sessions = await import(pathToFileURL(join(root, 'session.mjs')).href);
    auth = await import(pathToFileURL(join(root, 'auth.mjs')).href);
    activity = await import(pathToFileURL(join(root, 'activity.mjs')).href);
    controllers = await import(pathToFileURL(join(root, 'controller.mjs')).href);
  }, 30000);
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  async function fixture(csrf?: { cookieName: string; headerName: string }) {
    const store = new sessions.MemorySessionStore();
    const id = sessions.Session.generateId();
    const signed = `${id}.${createHmac('sha256', secret).update(id).digest('base64url')}`;
    const now = Date.now();
    await store.write(id, {
      auth_user_id: 7, _svelar_created_at: now - 10000,
      _svelar_last_activity_at: now - 5000, _svelar_last_touched_at: now - 5000,
    }, 60);
    const user = { getAttribute: (key: string) => key === 'id' ? 7 : undefined };
    const manager = new auth.AuthManager({ guard: 'session', model: { find: async () => user } });
    const app = hooks.createSvelarApp({
      auth: manager, secret, sessionStore: store, sessionLifetime: 60, sessionAbsoluteLifetime: 300,
      sessionTouchOnActivity: true, sessionTouchThrottle: 0, rateLimit: 1000,
      csrfPaths: csrf ? [] : ['/api/'], debug: false,
    });
    const controller = new controllers.SessionActivityController(csrf);
    function event(method: 'GET' | 'POST' = 'GET') {
      const url = new URL('https://session.example/api/session');
      const token = csrf ? 'encoded csrf token' : 'csrf-token';
      return {
        url, params: {}, locals: {} as Record<string, unknown>, cookies: {},
        getClientAddress: () => '192.0.2.40',
        request: new Request(url, {
          method, headers: {
            Cookie: `svelar_session=${encodeURIComponent(signed)}; ${csrf?.cookieName ?? 'XSRF-TOKEN'}=${encodeURIComponent(token)}`,
            Origin: url.origin, 'Content-Type': 'application/json',
            [csrf?.headerName ?? 'X-CSRF-Token']: token,
          },
          ...(method === 'POST' ? { body: '{}' } : {}),
        }),
      };
    }
    return { app, controller, store, id, event };
  }

  it('authenticates a hooks-created Session and serves read-only status despite different constructors', async () => {
    const h = await fixture();
    const before = await h.store.read(h.id);
    const event = h.event();
    const response = await h.app.handle({ event, resolve: h.controller.handle('status') });
    expect(event.locals.session).not.toBeInstanceOf(sessions.Session);
    expect(sessions.isSession(event.locals.session)).toBe(true);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ data: { expired: false, canRenew: true } });
    expect(Number.isFinite(body.data.warningAt)).toBe(true);
    expect(await h.store.read(h.id)).toEqual(before);
  });

  it('renews through the independently bundled controller/auth/hooks/session stack', async () => {
    const h = await fixture();
    const before = (await h.store.read(h.id))!;
    const response = await h.app.handle({ event: h.event('POST'), resolve: h.controller.handle('renew') });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.lastActivityAt).toBeGreaterThan(before._svelar_last_activity_at);
    expect(body.data.absoluteExpiresAt).toBe(before._svelar_created_at + 300000);
    expect(response.headers.get('set-cookie')).toContain('svelar_session=');
    expect((await h.store.read(h.id))!._svelar_created_at).toBe(before._svelar_created_at);
  });

  it('recognizes a hooks-bundle expiry error during renewal instead of returning 500', async () => {
    const h = await fixture();
    const response = await h.app.handle({ event: h.event('POST'), resolve: async (event) => {
      await h.store.destroy(h.id);
      return h.controller.handle('renew')(event);
    } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ data: null, meta: { code: 'SESSION_EXPIRED' } });
    await expect(h.store.read(h.id)).resolves.toBeNull();
  });

  it.each(['duck', 'prototype', 'copied'] as const)('rejects a forged Session (%s)', async (kind) => {
    const h = await fixture();
    const genuine = new sessions.Session(h.id, (await h.store.read(h.id))!);
    const forged = kind === 'duck' ? { get: () => 7, getActivityStatus: () => ({ expired: false }), markActivity: () => {} }
      : kind === 'prototype' ? Object.create(sessions.Session.prototype)
      : Object.assign(Object.create(sessions.Session.prototype), genuine);
    expect(sessions.isSession(genuine)).toBe(true);
    expect(sessions.isSession(forged)).toBe(false);
    const response = await h.app.handle({ event: h.event(), resolve: async (event) => {
      event.locals.session = forged;
      return h.controller.handle('status')(event);
    } });
    expect(response.status).toBe(401);
  });

  it('brands genuine expiry errors across bundles without trusting names or prototypes', () => {
    const error = new activity.SessionExpiredError();
    expect(activity.isSessionExpiredError(error)).toBe(true);
    expect(activity.isSessionExpiredError(Object.assign(new Error('fake'), { name: 'SessionExpiredError' }))).toBe(false);
    expect(activity.isSessionExpiredError(Object.create(activity.SessionExpiredError.prototype))).toBe(false);
  });

  it('lets hooks middleware recognize an expiry error thrown by a separately bundled store', async () => {
    const h = await fixture();
    vi.spyOn(h.store, 'compareAndSwap').mockRejectedValue(new activity.SessionExpiredError());
    const response = await h.app.handle({ event: h.event('POST'), resolve: async () => new Response('private') });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ data: null, meta: { code: 'SESSION_EXPIRED' } });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('supports shared CSRF configuration with encoded cookies across the bundles', async () => {
    const h = await fixture({ cookieName: 'APP-CSRF', headerName: 'X-App-Csrf' });
    const response = await h.app.handle({ event: h.event('POST'), resolve: h.controller.handle('renew') });
    expect(response.status).toBe(200);
  });
});
