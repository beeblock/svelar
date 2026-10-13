import { describe, expect, it, vi } from 'vitest';
import { RedisQueueOperations } from '../src/queue/RedisOperations.js';

function fixture(overrides: Record<string, unknown> = {}) {
  let stored = '';
  const job = { id: 'job-a', name: 'ExampleJob', data: { payload: '{}', metadata: { resourceId: 'invoice-a' } },
    opts: { attempts: 3 }, attemptsMade: 2, attemptsStarted: 3, timestamp: 100, processedOn: 200, finishedOn: 300,
    failedReason: 'Failed', stacktrace: ['Error: Failed\n    at ExampleJob.handle (jobs.ts:10:4)'],
    getState: async () => 'failed', ...overrides };
  const client = { eval: vi.fn(async (_script: string, _keys: number, _jobs: string, _timeline: string, _id: string, value: string) => { stored = value; }),
    hget: async () => stored, time: async () => ['1', '0'] };
  const queue = { client, getJob: async () => job, toKey: (key: string) => `queue:${key}` };
  return { job, client, operations: new RedisQueueOperations(async () => queue, 'reports', 'invoices'), stored: () => JSON.parse(stored) };
}

describe('Redis operational diagnostics', () => {
  it('retains frames, started attempts, timestamps and metadata in snapshots and the shared index', async () => {
    const test = fixture(); const snapshot = await test.operations.snapshot(test.job);
    expect(snapshot).toMatchObject({ connection: 'reports', queue: 'invoices', attempts: 2, attemptsStarted: 3,
      processedAt: 200, finishedAt: 300, metadata: { resourceId: 'invoice-a' }, stacktraceMeta: { total: 1, truncated: false } });
    expect(snapshot?.stacktrace?.[0]).toContain('at ExampleJob.handle');
    expect(test.stored().stacktrace).toEqual(snapshot?.stacktrace);
    expect(snapshot).not.toHaveProperty('indexKeys');
  });

  it.each([
    ['password="long secret value"', 'long secret value'],
    ['{"access_token":"quoted secret value"}', 'quoted secret value'],
    ["api-key='private value'", 'private value'],
    ['Bearer bearer-secret', 'bearer-secret'],
    ['https://user:uri-secret@host.example/path', 'uri-secret'],
    ['Cookie: session_id=cookie-secret; tracking=other-secret', 'other-secret'],
    ['-----BEGIN PRIVATE KEY-----\nkey-secret\n-----END PRIVATE KEY-----', 'key-secret'],
  ])('redacts sensitive diagnostic text %s before persistence', async (line, secret) => {
    const test = fixture({ stacktrace: [`Error: ${line}\n    at ExampleJob.handle (jobs.ts:10:4)`], failedReason: line });
    const snapshot = await test.operations.snapshot(test.job);
    expect(JSON.stringify(snapshot?.stacktrace)).not.toContain(secret);
    expect(snapshot?.error).not.toContain(secret);
    expect(JSON.stringify(test.stored())).not.toContain(secret);
    expect(snapshot?.stacktrace?.[0]).toContain('[REDACTED]');
    expect(snapshot?.stacktrace?.[0]).toContain('at ExampleJob.handle');
  });

  it('keeps the newest five traces and explicitly reports omitted attempts', async () => {
    const test = fixture({ stacktrace: Array.from({ length: 8 }, (_, index) => `attempt-${index}`) });
    const snapshot = await test.operations.snapshot(test.job);
    expect(snapshot?.stacktrace).toEqual(['attempt-3', 'attempt-4', 'attempt-5', 'attempt-6', 'attempt-7']);
    expect(snapshot?.stacktraceMeta).toEqual({ total: 8, truncated: true });
  });

  it('bounds UTF-8 bytes across retained traces and redacts before truncating', async () => {
    const trace = `password="secret with spaces"\n${'\u00e9'.repeat(20_000)}`;
    const test = fixture({ stacktrace: Array.from({ length: 5 }, () => trace), failedReason: trace });
    const snapshot = await test.operations.snapshot(test.job);
    expect(snapshot?.stacktrace?.reduce((sum, value) => sum + Buffer.byteLength(value), 0)).toBeLessThanOrEqual(32 * 1024);
    expect(snapshot?.stacktrace?.every(value => value.endsWith('[truncated]'))).toBe(true);
    expect(snapshot?.stacktraceMeta).toEqual({ total: 5, truncated: true });
    expect(Buffer.byteLength(snapshot!.error!)).toBeLessThanOrEqual(8 * 1024);
    expect(JSON.stringify(snapshot)).not.toContain('secret with spaces');
  });

  it('fails closed for oversized or malformed trace entries without serializing their contents', async () => {
    const test = fixture({ stacktrace: ['private'.repeat(30_000), { token: 'malformed-secret' }] });
    const snapshot = await test.operations.snapshot(test.job);
    expect(snapshot?.stacktraceMeta).toEqual({ total: 2, truncated: true });
    expect(snapshot?.stacktrace).toEqual(['[REDACTED: diagnostic exceeds input limit]', '[REDACTED: invalid diagnostic]']);
    expect(JSON.stringify(test.stored())).not.toContain('malformed-secret');
  });

  it('keeps empty diagnostics and unsupported native start counters absent, including epoch timestamps', async () => {
    const test = fixture({ stacktrace: [], failedReason: '', attemptsStarted: undefined, processedOn: 0, finishedOn: 0 });
    const snapshot = await test.operations.snapshot(test.job);
    expect(snapshot).toMatchObject({ processedAt: 0, finishedAt: 0 });
    expect(snapshot).not.toHaveProperty('stacktrace');
    expect(snapshot).not.toHaveProperty('stacktraceMeta');
    expect(snapshot).not.toHaveProperty('attemptsStarted');
  });
});
