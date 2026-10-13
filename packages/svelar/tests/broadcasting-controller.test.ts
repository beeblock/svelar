import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BroadcastingController } from '../src/broadcasting/Controller.js';
import { Broadcast } from '../src/broadcasting/index.js';
import type { RequestEvent } from '../src/routing/Controller.js';
import { NewCommandTemplates as T } from '../src/cli/commands/NewCommandTemplates.js';
import { Log } from '../src/logging/index.js';

const secret = 'isolated-broadcast-controller-fixture-secret';
function event(path = '/api/internal/broadcast', options: RequestInit = {}, user?: unknown): RequestEvent {
  const url = new URL(path, 'http://localhost');
  return { url, request: new Request(url, options), params: {}, locals: { user }, getClientAddress: () => '127.0.0.1', cookies: {}, platform: {} };
}
function publish(body: string, headers: Record<string, string> = {}) {
  return new BroadcastingController().handle('publish')(event(undefined, { method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret, ...headers } }));
}
beforeEach(() => { vi.stubEnv('INTERNAL_SECRET', secret); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Broadcast protocol controllers', () => {
  it('rejects an unconfigured credential without reading the body or disclosing configuration', async () => {
    vi.stubEnv('INTERNAL_SECRET', '');
    const response = await publish('invalid');
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ data: null, meta: { code: 'BROADCAST_UNAVAILABLE' } });
  });
  it.each(['', 'wrong', 'x'.repeat(1025)])('rejects a forged internal credential before body parsing', async (credential) => {
    const response = await publish('invalid', { 'X-Internal-Secret': credential });
    expect(response.status).toBe(401);
  });
  it('validates JSON, channel and event fields before broadcasting', async () => {
    const send = vi.spyOn(Broadcast, 'to');
    expect((await publish('invalid')).status).toBe(400);
    expect((await publish('{}')).status).toBe(422);
    expect((await publish(JSON.stringify({ channel: 'updates', eventName: 'bad\nevent' }))).status).toBe(422);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects oversized declared and streamed bodies without unbounded buffering', async () => {
    expect((await publish('{}', { 'Content-Length': '262145' })).status).toBe(413);
    expect((await publish('x'.repeat(262145))).status).toBe(413);
  });
  it('runs the request/DTO/action flow and returns a private resource envelope', async () => {
    const send = vi.fn().mockResolvedValue(undefined); vi.spyOn(Broadcast, 'to').mockReturnValue({ send });
    const response = await publish(JSON.stringify({ channel: 'updates', eventName: 'progress', data: { completed: 4 } }));
    expect(response.status).toBe(200); expect(send).toHaveBeenCalledWith('progress', { completed: 4 });
    expect(await response.json()).toMatchObject({ data: { subscribers: expect.any(Number) }, meta: { message: 'Event broadcast.' } });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('never exposes a broker error or secret in the HTTP response', async () => {
    vi.spyOn(Broadcast, 'to').mockReturnValue({ send: vi.fn().mockRejectedValue(new Error('password=secret broker stack')) });
    vi.spyOn(Log, 'error').mockResolvedValue(undefined);
    const response = await publish(JSON.stringify({ channel: 'updates', eventName: 'progress' }));
    expect(response.status).toBe(503); const body = await response.json();
    expect(body.meta.incidentId).toMatch(/^[a-f0-9-]{36}$/); expect(JSON.stringify(body)).not.toMatch(/password|secret|stack/);
  });
  it.each([undefined, null])('requires a user for private subscriptions', async (user) => {
    const request = event('/api/broadcasting/private-account.1', {}, user); request.params.channel = 'private-account.1';
    expect((await new BroadcastingController().handle('stream')(request)).status).toBe(401);
  });
  it('enforces channel authorization and forwards replay and abort options for authorized subscriptions', async () => {
    const authorize = vi.spyOn(Broadcast, 'authorize').mockResolvedValue(false);
    const subscribe = vi.spyOn(Broadcast, 'subscribe').mockReturnValue(new Response('stream'));
    const request = event('/api/broadcasting/private-account.1', { headers: { 'Last-Event-ID': '123-0' } }, { id: 7 }); request.params.channel = 'private-account.1';
    expect((await new BroadcastingController().handle('stream')(request)).status).toBe(403); expect(subscribe).not.toHaveBeenCalled();
    authorize.mockResolvedValue(true);
    expect((await new BroadcastingController().handle('stream')(request)).status).toBe(200);
    expect(subscribe).toHaveBeenCalledWith('private-account.1', 7, undefined, { lastEventId: '123-0', signal: request.request.signal });
  });
  it('rejects an invalid subscription identifier before creating a stream', async () => {
    const request = event(); request.params.channel = 'a'.repeat(201);
    const subscribe = vi.spyOn(Broadcast, 'subscribe');
    expect((await new BroadcastingController().handle('stream')(request)).status).toBe(422); expect(subscribe).not.toHaveBeenCalled();
  });
  it('preserves the top-level Pusher signature protocol while validating input and authorization', async () => {
    const authenticate = vi.spyOn(Broadcast, 'authenticatePusher').mockResolvedValue({ auth: 'key:signature' });
    const controller = new BroadcastingController();
    const input = () => event('/api/broadcasting/auth', { method: 'POST', body: 'channel_name=private-account.1&socket_id=123.456', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, { id: 7 });
    const response = await controller.handle('authenticate')(input());
    expect(await response.json()).toEqual({ auth: 'key:signature' }); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(authenticate).toHaveBeenCalledWith('private-account.1', '123.456', { id: 7 });
    authenticate.mockResolvedValue(false);
    expect((await controller.handle('authenticate')(input())).status).toBe(403);
    expect((await controller.handle('authenticate')(event('/api/broadcasting/auth', { method: 'POST' }))).status).toBe(401);
  });
  it('generates thin controller bindings for each protocol endpoint', () => {
    for (const content of [T.apiBroadcasting(), T.apiPusherAuth(), T.apiInternalBroadcast()]) {
      expect(content).toContain('BroadcastingController'); expect(content).toContain('controller.handle(');
      expect(content).not.toContain('request.json('); expect(content).not.toContain('err.message');
    }
  });
});
