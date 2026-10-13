import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { CreateBackgroundOperationsTable } from '../src/database/core/00000000_000046_create_background_operations_table.js';
import { BackgroundOperation, OperationsController } from '../src/operations/index.js';
import { ApplicationContext } from '../src/support/Context.js';
import { Queue } from '../src/queue/index.js';
import { Broadcast } from '../src/broadcasting/index.js';
import type { RequestEvent } from '../src/routing/Controller.js';

const owner = { tenantId: 'one', teamId: 'one', actorId: 7, userId: 7, actorType: 'user' as const };
function event(id?: string, options: { method?: string; csrf?: boolean; userId?: number; query?: string; origin?: string; authorization?: string } = {}): RequestEvent {
  const url = new URL('http://localhost/api/operations' + (options.query ?? ''));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.csrf !== false) { headers.Cookie = 'XSRF-TOKEN=trusted'; headers['X-CSRF-Token'] = 'trusted'; }
  if (options.origin) headers.Origin = options.origin;
  if (options.authorization) headers.Authorization = options.authorization;
  const method = options.method ?? 'GET';
  return { url, request: new Request(url, { method, headers, ...(method === 'POST' ? { body: '{"id":"ignored"}' } : {}) }),
    params: id ? { id } : {}, locals: { user: { id: options.userId ?? 7 } }, cookies: {} as any,
    getClientAddress: () => '127.0.0.1' };
}
beforeEach(async () => {
  Connection.configure({ default: 'fixture', connections: { fixture: { driver: 'sqlite', filename: ':memory:' } } });
  await new CreateBackgroundOperationsTable().up();
  Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
  Broadcast.configure({ default: 'sse', drivers: { sse: { driver: 'sse' } } });
  BackgroundOperation.register('controller-test', { handle: async () => ({ done: true }) });
});
afterEach(async () => { await Broadcast.drain(); Broadcast.prune(); await Connection.disconnect(); ApplicationContext.clear(); });
const create = () => ApplicationContext.runIsolated(owner, () => BackgroundOperation.dispatch('controller-test', { secret: 'not-for-browser' }, { label: 'Private export' }));
const call = (method: string, input: RequestEvent, context = owner) => ApplicationContext.runIsolated(context, () => new OperationsController().handle(method)(input));

describe('Personal background operation HTTP boundary', () => {
  it('lists a consistent resource envelope and an ownership-bound private channel without input secrets', async () => {
    const operation = await create();
    const response = await call('index', event());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    const payload = await response.json();
    expect(payload.data.map((record: any) => record.id)).toEqual([operation.id]);
    expect(payload.meta.channel).toMatch(/^private-operations\.[a-f0-9]{64}$/);
    expect(JSON.stringify(payload)).not.toContain('not-for-browser');
  });
  it('hides other actors and tenants and rejects inconsistent trusted execution context', async () => {
    const operation = await create();
    expect((await call('show', event(operation.id, { userId: 8 }), { ...owner, actorId: 8, userId: 8 })).status).toBe(404);
    expect((await call('show', event(operation.id), { ...owner, tenantId: 'two', teamId: 'two' })).status).toBe(404);
    expect((await call('show', event(operation.id), { ...owner, actorId: 8 })).status).toBe(401);
    expect((await call('show', event(operation.id), { ...owner, teamId: 'different' })).status).toBe(401);
  });
  it.each([undefined, 'Bearer forged-token'])('rejects cancellation without CSRF even with header %s', async (authorization) => {
    const operation = await create();
    const response = await call('cancel', event(operation.id, { method: 'POST', csrf: false, authorization }));
    expect(response.status).toBe(419); expect((await response.json()).meta.code).toBe('CSRF_MISMATCH');
    expect(await ApplicationContext.runIsolated(owner, () => BackgroundOperation.find(operation.id))).toMatchObject({ state: 'queued' });
  });
  it('rejects a foreign origin even with a matching CSRF token', async () => {
    const operation = await create();
    const response = await call('cancel', event(operation.id, { method: 'POST', origin: 'http://foreign.example' }));
    expect(response.status).toBe(403);
  });
  it('uses route identity instead of submitted id, returns durable state and refuses already-settled work', async () => {
    const operation = await create();
    const response = await call('cancel', event(operation.id, { method: 'POST' }));
    expect(response.status).toBe(202); expect((await response.json()).data).toMatchObject({ id: operation.id, state: 'cancelled', cancelRequested: true });
    expect((await call('cancel', event(operation.id, { method: 'POST' }))).status).toBe(409);
  });
  it('bounds page input and conceals missing/malformed IDs', async () => {
    expect((await call('index', event(undefined, { query: '?limit=101' }))).status).toBe(422);
    expect((await call('index', event(undefined, { query: '?cursor=invalid' }))).status).toBe(422);
    expect((await call('show', event('invalid'))).status).toBe(404);
    const anonymous = event(); anonymous.locals.user = null;
    expect((await call('index', anonymous)).status).toBe(401);
  });
});
