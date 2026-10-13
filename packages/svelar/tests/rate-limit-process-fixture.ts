import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { Cache } from '../src/cache/index.js';
import { RateLimitMiddleware } from '../src/middleware/Middleware.js';

const require = createRequire(process.env.SVELAR_TEST_REDIS_CLIENT!);
const Redis = require('ioredis');
const client = new Redis(process.env.SVELAR_TEST_REDIS_URL!, { maxRetriesPerRequest: 1, connectTimeout: 3000 });
await client.ping();
Cache.configure({ default: 'redis', stores: { redis: { driver: 'redis', client, prefix: process.env.SVELAR_RATE_NAMESPACE! } } });
const limiter = new RateLimitMiddleware({ maxRequests: 137, windowMs: 60_000, store: 'cache', cacheStore: 'redis', trustedProxy: false });
const server = createServer((request, response) => {
  void (async () => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const result = await limiter.handle({ params: {}, locals: {}, event: {
      request: new Request(`http://127.0.0.1${request.url}`, { headers }), getClientAddress: () => request.socket.remoteAddress,
    } }, async () => new Response('admitted')) as Response;
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text());
  })().catch(() => { response.writeHead(503); response.end('coordination unavailable'); });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
process.send?.({ event: 'ready', port: (server.address() as { port: number }).port });
process.once('SIGTERM', () => { void (async () => {
  await new Promise<void>((resolve) => server.close(() => resolve())); await client.quit(); process.disconnect?.();
})(); });
