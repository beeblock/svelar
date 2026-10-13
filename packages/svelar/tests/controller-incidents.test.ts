import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../src/routing/Controller.js';
import { createSvelarApp } from '../src/hooks/index.js';
import { MemorySessionStore } from '../src/session/Session.js';
import { Log } from '../src/logging/index.js';
import { ApplicationContext } from '../src/support/Context.js';

class FailingController extends Controller {
  async crash() { throw new Error('token=private-fixture-token unexpected failure'); }
}
function event() {
  const url = new URL('http://localhost/api/proof?token=private-query-token');
  return { url, request: new Request(url), params: {}, locals: {}, cookies: {}, platform: {}, getClientAddress: () => '127.0.0.1' };
}
afterEach(() => { vi.restoreAllMocks(); ApplicationContext.clear(); });

describe('Controller incident reporting', () => {
  it('uses the request-configured reporter without exposing secrets or logging query credentials', async () => {
    const logging = vi.spyOn(Log, 'error').mockResolvedValue(undefined);
    const report = vi.fn().mockResolvedValue(undefined);
    const runtime = createSvelarApp({ secret: 'isolated-controller-incident-secret', sessionStore: new MemorySessionStore(), debug: false, errorConfig: { report } });
    const response = await runtime.handle({ event: event(), resolve: (incoming: any) => new FailingController().handle('crash')(incoming) });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ message: 'Internal server error', incidentId: expect.stringMatching(/^inc_/) });
    expect(JSON.stringify(body)).not.toMatch(/private|token|stack/);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toMatchObject({ incidentId: body.incidentId, url: 'http://localhost/api/proof' });
    expect(logging.mock.calls[0][1]).toMatchObject({ url: 'http://localhost/api/proof', incidentId: body.incidentId });
    expect(ApplicationContext.get('incidentId')).toBeUndefined();
  });
  it('keeps error rendering isolated between concurrently served applications', async () => {
    vi.spyOn(Log, 'error').mockResolvedValue(undefined);
    const run = async (name: string, wait: number) => {
      const runtime = createSvelarApp({ secret: 'isolated-controller-incident-secret', sessionStore: new MemorySessionStore(), debug: false,
        errorConfig: { render: async (_error, _event, incidentId) => {
          await new Promise((resolve) => setTimeout(resolve, wait));
          return new Response(JSON.stringify({ name, incidentId }), { status: 503 });
        } } });
      return runtime.handle({ event: event(), resolve: (incoming: any) => new FailingController().handle('crash')(incoming) });
    };
    const [one, two] = await Promise.all([run('one', 20), run('two', 0)]);
    expect(await one.json()).toMatchObject({ name: 'one' }); expect(await two.json()).toMatchObject({ name: 'two' });
  });
  it('still returns a safe incident and invokes the reporter when the log backend fails', async () => {
    vi.spyOn(Log, 'error').mockRejectedValue(new Error('password=private-database-secret'));
    const fallback = vi.spyOn(console, 'error').mockImplementation(() => {});
    const report = vi.fn().mockResolvedValue(undefined);
    const runtime = createSvelarApp({ secret: 'isolated-controller-incident-secret', sessionStore: new MemorySessionStore(), debug: false, errorConfig: { report } });
    const response = await runtime.handle({ event: event(), resolve: (incoming: any) => new FailingController().handle('crash')(incoming) });
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('private');
    expect(report).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith('Svelar incident log unavailable', { incidentId: expect.stringMatching(/^inc_/) });
  });
});
