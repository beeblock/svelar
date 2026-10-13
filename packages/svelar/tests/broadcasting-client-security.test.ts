import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const constructed = vi.hoisted(() => vi.fn());
vi.mock('pusher-js', () => ({ default: class {
  constructor(key: string, options: unknown) { constructed(key, options); }
  disconnect() {}
} }));
import { pusherAuthorizationHeaders, usePusher } from '../src/broadcasting/client.js';

const options = { key: 'public-fixture-key' };
let documentFixture: { cookie: string };
let connection: ReturnType<typeof usePusher> | undefined;
beforeEach(() => {
  documentFixture = { cookie: 'XSRF-TOKEN=first-token' };
  vi.stubGlobal('document', documentFixture);
  vi.stubGlobal('window', { location: new URL('http://localhost/dashboard') });
  constructed.mockClear();
});
afterEach(() => { connection?.disconnect(); connection = undefined; vi.unstubAllGlobals(); });

describe('Pusher browser authorization security', () => {
  it('reads the latest CSRF cookie on every channel authorization', () => {
    connection = usePusher(options);
    const config = constructed.mock.calls[0][1];
    expect(config.channelAuthorization).toMatchObject({ endpoint: '/api/broadcasting/auth', transport: 'ajax' });
    expect(config.channelAuthorization.headersProvider()).toEqual({ 'X-CSRF-Token': 'first-token' });
    documentFixture.cookie = 'XSRF-TOKEN=rotated-token';
    expect(config.channelAuthorization.headersProvider()).toEqual({ 'X-CSRF-Token': 'rotated-token' });
  });
  it.each(['https://other.example/auth', '//other.example/auth'])('does not disclose the browser CSRF credential to %s', (authEndpoint) => {
    expect(pusherAuthorizationHeaders({ ...options, authEndpoint })).toEqual({});
  });
  it('supports custom names and caller-owned headers without replacing explicit authorization', () => {
    documentFixture.cookie = 'custom-token=encoded%20token';
    expect(pusherAuthorizationHeaders({ ...options, csrfCookieName: 'custom-token', csrfHeaderName: 'X-Custom-Csrf', authHeaders: { Authorization: 'Bearer explicit-fixture' } }))
      .toEqual({ Authorization: 'Bearer explicit-fixture', 'X-Custom-Csrf': 'encoded token' });
    expect(pusherAuthorizationHeaders({ ...options, authHeaders: { 'x-csrf-token': 'caller-owned' } })).toEqual({ 'x-csrf-token': 'caller-owned' });
  });
  it('omits missing or malformed cookies instead of interrupting authentication', () => {
    for (const cookie of ['', 'XSRF-TOKEN=%malformed']) {
      documentFixture.cookie = cookie;
      expect(pusherAuthorizationHeaders(options)).toEqual({});
    }
  });
  it('never reads browser credentials during SSR', () => {
    vi.stubGlobal('window', undefined);
    expect(pusherAuthorizationHeaders(options)).toEqual({});
  });
});
