import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { Broadcast } from '../src/broadcasting/index.js';

Broadcast.configure({ default: 'sse', drivers: { sse: { driver: 'sse', backplane: {
  driver: 'redis', url: process.env.SVELAR_TEST_SSE_REDIS_URL,
  channel: process.env.SVELAR_SSE_NAMESPACE, historyLimit: 10, historyTtlSeconds: 60,
} } } });
await Broadcast.ready();

const server = process.env.SVELAR_SSE_ROLE === 'web' ? createServer((request, response) => {
  const result = Broadcast.subscribe('proof', undefined, undefined, { lastEventId: request.headers['last-event-id'] as string | undefined });
  response.writeHead(result.status, Object.fromEntries(result.headers));
  const readable = Readable.fromWeb(result.body! as any);
  response.once('close', () => readable.destroy());
  readable.pipe(response);
}) : undefined;
if (server) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
process.send?.({ event: 'ready', port: (server?.address() as { port: number } | undefined)?.port });
process.on('message', async (message: any) => {
  if (message.command === 'publish') {
    try { await Broadcast.to('proof').send('changed', { value: message.value }); process.send?.({ event: 'published', value: message.value }); }
    catch (error) { process.send?.({ event: 'error', message: String(error) }); }
  }
});
process.once('SIGTERM', () => {
  void (async () => { await Broadcast.drain(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); process.disconnect?.(); })();
});
