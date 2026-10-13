import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import * as server from 'svelte/internal/server';
import { render } from 'svelte/server';
import ts from 'typescript';
import { SessionActivityClient, sessionCsrfToken, type SessionActivityBus } from '../src/ui/session-activity.js';
import { sessionActivityStatus } from '../src/session/Activity.js';

const now = 1_800_000_000_000;
const policy = { idleLifetime: 60, absoluteLifetime: 300, touchThrottle: 10, warningBefore: 20 };
const status = (activity = now, at = now) => sessionActivityStatus({ _svelar_created_at: now, _svelar_last_activity_at: activity }, policy, at);
const options = { baseUrl: 'https://app.example/dashboard', statusUrl: '/api/session', renewUrl: '/api/session/renew', csrfToken: () => 'csrf-token' };
const component = readFileSync(new URL('../src/ui/SessionWarning.svelte', import.meta.url), 'utf8');
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Session warning client', () => {
  it('polls readonly and sends explicit renewal with credentials and CSRF once for parallel clicks', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ data: status() }));
    const client = new SessionActivityClient({ ...options, fetch });
    await client.refresh();
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Svelar-Session-Activity': 'false' } });
    await Promise.all([client.renew(), client.renew()]);
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{}', headers: { 'X-CSRF-Token': 'csrf-token', 'X-Svelar-Session-Activity': 'false' } });
    expect(client.snapshot().renewing).toBe(false);
    client.dispose();
  });

  it('synchronizes tabs by rereading the server, not adopting broadcast deadlines or auto-renewing', async () => {
    const listeners = new Set<() => void>();
    const bus: SessionActivityBus = { subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, publish: () => { for (const listener of listeners) listener(); } };
    let current = status();
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') current = status(now + 20000, now + 20000);
      return Response.json({ data: current });
    });
    const first = new SessionActivityClient({ ...options, fetch, bus });
    const second = new SessionActivityClient({ ...options, fetch, bus });
    await Promise.all([first.refresh(), second.refresh()]);
    await first.renew(); await second.refresh();
    expect(second.snapshot().status?.expiresAt).toBe(now + 80000);
    bus.publish(); await Promise.all([first.refresh(), second.refresh()]);
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    first.dispose(); second.dispose(); expect(listeners.size).toBe(0);
  });

  it('uses server time for countdowns and does not extend deadlines from local activity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now + 100000);
    const client = new SessionActivityClient({ ...options, initial: status(), fetch: vi.fn(async () => Response.json({ data: status() })) });
    expect(client.remainingSeconds()).toBe(60);
    vi.setSystemTime(now + 145000); expect(client.remainingSeconds()).toBe(15);
    vi.setSystemTime(now + 160000); expect(client.remainingSeconds()).toBe(0);
    client.dispose();
  });

  it('fails closed on 401, malformed status, CSRF absence and unsafe endpoints without leaking server errors', async () => {
    const unauthorized = new SessionActivityClient({ ...options, fetch: vi.fn(async () => new Response('', { status: 401 })) });
    await unauthorized.refresh(); expect(unauthorized.snapshot().expired).toBe(true); unauthorized.dispose();
    const fetch = vi.fn(async () => Response.json({ data: { expiresAt: Infinity, message: 'secret-sentinel' } }));
    const invalid = new SessionActivityClient({ ...options, fetch });
    await invalid.refresh(); expect(invalid.snapshot().status).toBeNull(); expect(invalid.snapshot().error).not.toContain('secret-sentinel'); invalid.dispose();
    const missing = new SessionActivityClient({ ...options, csrfToken: () => null, fetch });
    fetch.mockClear(); await missing.renew(); expect(fetch).not.toHaveBeenCalled(); expect(missing.snapshot().error).toContain('Unable to renew'); missing.dispose();
    expect(() => new SessionActivityClient({ ...options, renewUrl: 'https://foreign.example/renew' })).toThrow('same-origin');
    expect(sessionCsrfToken('XSRF-TOKEN=%broken')).toBeNull();
    expect(sessionCsrfToken('other=1; XSRF-TOKEN=token%20value')).toBe('token value');
  });

  it('ignores delayed readonly responses older than a successful renewal', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const client = new SessionActivityClient({ ...options, fetch: vi.fn(async (_url, init) => init?.method === 'GET' ? pending : Response.json({ data: status(now + 20000, now + 20000) })) });
    const read = client.refresh(); await client.renew(); release(Response.json({ data: status() })); await read;
    expect(client.snapshot().status?.expiresAt).toBe(now + 80000); client.dispose();
  });
});

describe('Accessible session warning component', () => {
  it.each(['client', 'server'] as const)('compiles for %s with no accessibility warnings', (generate) => {
    const result = compile(component, { generate, filename: 'SessionWarning.svelte' });
    expect(result.warnings.filter((warning) => warning.code.startsWith('a11y'))).toEqual([]);
    expect(component).toContain('dialog.showModal()');
    expect(component).toContain('dialog?.close()');
    expect(component).toContain('aria-busy={state.renewing}');
    expect(component).toContain('aria-live="off"');
    expect(component).toContain('calc(100vw - 2rem)');
  });

  it('renders labelled native dialog, escaped titles, and a keyboard-operable renewal control', () => {
    const compiled = compile(component, { generate: 'server', filename: 'SessionWarning.svelte' });
    const js = ts.transpileModule(compiled.js.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} as { default: Parameters<typeof render>[0] } };
    const dependencies: Record<string, unknown> = { 'svelte/internal/server': server, svelte: { onMount: () => {} }, './session-activity.js': { SessionActivityClient, sessionCsrfToken } };
    new Function('exports', 'require', 'module', js)(module.exports, (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected component import ${name}`);
      return dependencies[name];
    }, module);
    const html = render(module.exports.default, { props: { ...options, initial: status(), title: '<script>secret</script>' } }).body;
    expect(html).toContain('<dialog'); expect(html).toContain('aria-labelledby='); expect(html).toContain('aria-describedby=');
    expect(html).toContain('&lt;script>'); expect(html).not.toContain('<script>secret');
    expect(html).toContain('type="button"'); expect(html).toContain('Stay signed in');
  });
});
