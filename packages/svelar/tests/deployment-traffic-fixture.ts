import { createServer } from 'node:http';
import { access, writeFile } from 'node:fs/promises';
import { DeploymentRuntime } from '../src/deployment/Runtime.js';

const version = process.env.RELEASE_VERSION ?? 'one';
let inflight = 0;
DeploymentRuntime.configure({ checks: { dependency: () => process.env.NOT_READY !== '1' }, cacheMs: 0 });
setTimeout(() => DeploymentRuntime.ready(), Number(process.env.START_DELAY ?? 0));
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url?.startsWith('/slow')) {
    inflight++;
    while (!await access('/app/storage/release-slow').then(() => true, () => false)) await new Promise(resolve => setTimeout(resolve, 25));
    inflight--;
  }
  if (request.url === '/release-slow') await writeFile('/app/storage/release-slow', 'released');
  if (request.url === '/inflight') { response.end(JSON.stringify({ version, inflight })); return; }
  if (request.url === '/api/ready') {
    const state = await DeploymentRuntime.readiness(); response.statusCode = state.ready ? 200 : 503;
    response.end(JSON.stringify({ data: state, meta: {}, version })); return;
  }
  if (request.url === '/api/traffic') {
    const state = await DeploymentRuntime.traffic(); response.statusCode = state.ready ? 200 : 503;
    response.end(JSON.stringify({ data: state, meta: {} })); return;
  }
  if (request.url === '/api/health' && process.env.BAD_SMOKE === '1') response.statusCode = 500;
  if (request.url === '/api/health' && process.env.BAD_GATEWAY === '1' && request.headers.host !== '127.0.0.1:3000') response.statusCode = 500;
  response.end(JSON.stringify({ version }));
});
server.listen(3000, '0.0.0.0');
process.on('SIGTERM', () => {
  console.log(JSON.stringify({ event: 'draining', inflight, version }));
  DeploymentRuntime.beginDrain(); server.close(() => process.exit(0)); server.closeIdleConnections();
  setTimeout(() => { server.closeAllConnections(); process.exit(inflight > 0 ? 1 : 0); }, Number(process.env.SHUTDOWN_TIMEOUT ?? 4) * 1000).unref();
});
