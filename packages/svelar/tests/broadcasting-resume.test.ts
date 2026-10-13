import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Broadcast, MemoryBroadcastBackplane, RedisBroadcastBackplane } from '../src/broadcasting/index.js';

const decode = (value?: Uint8Array) => new TextDecoder().decode(value);
beforeEach(async () => {
  await Broadcast.drain();
  Broadcast.prune();
  Broadcast.configure({ default: 'sse', drivers: { sse: { driver: 'sse' } } });
});
afterEach(async () => { await Broadcast.drain(); Broadcast.prune(); vi.useRealTimers(); });

describe('Resumable and bounded SSE', () => {
  it('replays after a stable cursor without replacing it with the connected event ID', async () => {
    const first = Broadcast.subscribe('resume');
    const reader = first.body!.getReader();
    expect(decode((await reader.read()).value)).not.toContain('id: ');
    await Broadcast.to('resume').send('changed', { value: 1 });
    const event = decode((await reader.read()).value);
    const id = event.match(/^id: (.+)$/m)![1];
    await reader.cancel();
    await Broadcast.to('resume').send('changed', { value: 2 });
    const next = Broadcast.subscribe('resume', undefined, undefined, { lastEventId: id });
    const resumed = next.body!.getReader();
    await resumed.read();
    expect(decode((await resumed.read()).value)).toContain('"value":2');
    await resumed.cancel();
  });

  it('never replays another targeted user event and handles unknown cursors with reset', async () => {
    const backplane = new MemoryBroadcastBackplane();
    Broadcast.useBackplane(backplane); await Broadcast.ready();
    await backplane.publish({ id: 'cursor', origin: 'other', channel: 'targeted', event: 'one', data: {}, targetUserId: 1 });
    await backplane.publish({ id: 'secret', origin: 'other', channel: 'targeted', event: 'one', data: { secret: 'not-for-user-one' }, targetUserId: 2 });
    await backplane.publish({ id: 'visible', origin: 'other', channel: 'targeted', event: 'one', data: { visible: true }, targetUserId: 1 });
    const response = Broadcast.subscribe('targeted', 1, undefined, { lastEventId: 'cursor' });
    const reader = response.body!.getReader(); await reader.read();
    const result = decode((await reader.read()).value);
    expect(result).toContain('visible'); expect(result).not.toContain('secret');
    await reader.cancel();
    const expired = Broadcast.subscribe('targeted', 1, undefined, { lastEventId: 'unknown' });
    const expiredReader = expired.body!.getReader(); await expiredReader.read();
    expect(decode((await expiredReader.read()).value)).toContain('event: reset');
    await expiredReader.cancel();
  });

  it('heartbeats and periodically reconnects to enforce authorization renewal', async () => {
    vi.useFakeTimers();
    const response = Broadcast.subscribe('heartbeat', undefined, undefined, { heartbeatSeconds: 1, maxDurationSeconds: 3 });
    const reader = response.body!.getReader(); await reader.read();
    await vi.advanceTimersByTimeAsync(1000);
    expect(decode((await reader.read()).value)).toBe(': heartbeat\n\n');
    await vi.advanceTimersByTimeAsync(2000);
    let output = '';
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; output += decode(chunk.value); }
    expect(output).toContain('reauthorize');
    expect(Broadcast.totalSubscribers()).toBe(0);
  });

  it('cleans up aborted clients, rejects frame injection and closes slow consumers', async () => {
    const abort = new AbortController();
    const response = Broadcast.subscribe('abort', undefined, undefined, { signal: abort.signal });
    const reader = response.body!.getReader(); await reader.read();
    abort.abort(); expect((await reader.read()).done).toBe(true);
    expect(Broadcast.totalSubscribers()).toBe(0);
    await expect(Broadcast.to('safe').send('bad\ndata: injected', {})).rejects.toThrow('Invalid SSE event');
    const slow = Broadcast.subscribe('slow', undefined, undefined, { maxBufferedEvents: 2 });
    const slowReader = slow.body!.getReader(); await slowReader.read();
    await Broadcast.to('slow').send('one', {}); await Broadcast.to('slow').send('two', {}); await Broadcast.to('slow').send('three', {});
    expect(Broadcast.totalSubscribers()).toBe(0);
    expect(Broadcast.metrics().backpressureClosed).toBeGreaterThan(0);
    await slowReader.cancel();
  });

  it('drains streams and refuses new subscriptions until reconfigured', async () => {
    const reader = Broadcast.subscribe('drain').body!.getReader(); await reader.read();
    await Broadcast.drain();
    expect(decode((await reader.read()).value)).toContain('event: reconnect');
    expect((await reader.read()).done).toBe(true);
    expect(Broadcast.subscribe('drain').status).toBe(503);
  });

  it('uses one Redis-issued ID for persistence, pubsub and local delivery', async () => {
    const publisher = { eval: vi.fn(async () => '1234-0'), xrange: vi.fn(async (_key: string, start: string) => start === '1234-0' ? [['1234-0', []]] : [['1235-0', ['message', JSON.stringify({ id: 'original', channel: 'redis', origin: 'other', event: 'changed', data: { ok: true } })]]]) };
    const subscriber = { on: vi.fn(), subscribe: vi.fn(async () => {}), unsubscribe: vi.fn(async () => {}) };
    const backplane = new RedisBroadcastBackplane({ driver: 'redis', client: publisher, subscriber });
    Broadcast.useBackplane(backplane); await Broadcast.ready();
    const reader = Broadcast.subscribe('redis').body!.getReader(); await reader.read();
    await Broadcast.to('redis').send('changed', { ok: true });
    expect(decode((await reader.read()).value)).toContain('id: 1234-0');
    expect(await backplane.replay('redis', '1234-0', 10)).toMatchObject({ reset: false, messages: [{ id: '1235-0' }] });
    await reader.cancel();
  });
});
