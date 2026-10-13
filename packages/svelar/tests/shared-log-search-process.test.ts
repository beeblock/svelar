import { fork, execFile, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const nativeSearch = process.env.SVELAR_TEST_SHARED_MEILI === '1';
const image = process.env.SVELAR_TEST_SHARED_MEILI_IMAGE ?? 'getmeili/meilisearch:v1.54.3';
const masterKey = `svelar-proof-${crypto.randomUUID()}`;
interface Exit { code: number | null; signal: NodeJS.Signals | null; }
interface Process {
  child: ChildProcess;
  events: any[];
  output: string;
  exit: Promise<Exit>;
  request(operation: string, args?: Record<string, any>): Promise<any>;
}
let directory: string;
let working: string;
let fixture: string;
let processes: Process[];
let meiliContainer: string | undefined;
let meiliHost = '';
let proxy: Server | undefined;
async function docker(args: string[]) {
  return (await execute('docker', args, { timeout: 180000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
}
async function until<T>(callback: () => T | Promise<T>, timeout = 10000): Promise<T> {
  const deadline = Date.now() + timeout;
  do { const result = await callback(); if (result) return result; await sleep(25); } while (Date.now() < deadline);
  throw new Error('Shared log/search process proof timed out');
}
async function healthy() {
  await until(async () => {
    try { return (await fetch(`${meiliHost}/health`, { signal: AbortSignal.timeout(1000) })).status === 200; }
    catch { return false; }
  }, 30000);
}
async function randomPort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Missing random test port');
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return address.port;
}
async function documents(index: string, expected: number) {
  const found = await until(async () => {
    const response = await fetch(`${meiliHost}/indexes/${encodeURIComponent(index)}/documents?limit=100`, {
      headers: { Authorization: `Bearer ${masterKey}` }, signal: AbortSignal.timeout(2000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Meilisearch document read failed: ${response.status}`);
    const result = await response.json() as { results: any[] };
    return result.results.length === expected ? result.results : null;
  }, 15000);
  if (!found) throw new Error('Meilisearch document observation is unavailable');
  return found;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'svelar-shared-process-proof-'));
  await symlink(resolve(import.meta.dirname, '../../../node_modules'), join(directory, 'node_modules'), 'dir');
  await mkdir(join(directory, 'api'));
  // Mirror independently bundled public entry points, not a monolithic test import.
  for (const name of ['database', 'logging', 'orm', 'queue', 'search', 'support']) {
    await build({ entryPoints: [resolve(import.meta.dirname, `../src/${name}/index.ts`)], outfile: join(directory, 'api', `${name}.mjs`),
      bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', keepNames: true, logLevel: 'silent' });
  }
  fixture = join(directory, 'fixture.mjs');
  await build({ entryPoints: [resolve(import.meta.dirname, 'shared-log-search-process-fixture.ts')], outfile: fixture,
    bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', keepNames: true, logLevel: 'silent',
    plugins: [{ name: 'independent-public-entries', setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/(database|logging|orm|queue|search|support)\/index\.js$/ }, args => ({
        path: `./api/${args.path.split('/')[2]}.mjs`, external: true,
      }));
    } }],
  });
  if (nativeSearch) {
    await docker(['image', 'inspect', image]).catch(() => docker(['pull', image]));
    meiliContainer = `svelar-shared-search-${crypto.randomUUID().slice(0, 12)}`;
    await docker(['run', '-d', '--name', meiliContainer, '-p', `127.0.0.1:${await randomPort()}:7700`, '-e', `MEILI_MASTER_KEY=${masterKey}`,
      '-e', 'MEILI_ENV=production', '-e', 'MEILI_NO_ANALYTICS=true', image]);
    meiliHost = `http://${await docker(['port', meiliContainer, '7700/tcp'])}`;
    await healthy();
  }
}, 180000);
beforeEach(async () => {
  working = join(directory, crypto.randomUUID()); await mkdir(working); processes = [];
  const setup = await spawn('web'); await setup.request('migrate');
});
afterEach(async () => {
  if (proxy) { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy!.close(() => resolve())); proxy = undefined; }
  for (const entry of processes) {
    if (entry.child.exitCode === null && entry.child.signalCode === null) {
      await entry.request('shutdown').catch(() => { entry.child.kill('SIGKILL'); });
      const stopped = await Promise.race([entry.exit.then(() => true), sleep(2000).then(() => false)]);
      if (!stopped) entry.child.kill('SIGKILL');
    }
    await entry.exit;
  }
});
afterAll(async () => {
  try { if (meiliContainer) await docker(['rm', '-fv', meiliContainer]); }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}, 30000);

async function spawn(role: string): Promise<Process> {
  const child = fork(fixture, [], { env: { ...process.env, SVELAR_SHARED_ROLE: role, SVELAR_SHARED_DIRECTORY: working,
    SVELAR_SHARED_DATABASE: join(working, 'shared.sqlite') }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let nextId = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let ready!: () => void; let failed!: (error: Error) => void;
  const startup = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
  const entry: Process = { child, events: [], output: '', exit: new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    request(operation, args = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture ${role} ${operation} timed out: ${entry.output}`)); }, operation === 'shutdown' ? 3000 : 40000);
        pending.set(id, { resolve, reject, timer });
        child.send({ id, operation, args }, error => {
          if (error) { clearTimeout(timer); pending.delete(id); reject(error); }
        });
      });
    },
  };
  processes.push(entry);
  child.on('message', message => {
    const data = message as any;
    if (data.event === 'ready') ready();
    if (data.reply) {
      const request = pending.get(data.reply);
      if (request) { clearTimeout(request.timer); pending.delete(data.reply); data.error ? request.reject(new Error(data.error)) : request.resolve(data.result); }
    } else entry.events.push(data);
  });
  child.on('error', failed);
  child.on('exit', () => {
    const error = new Error(`Fixture ${role} exited: ${entry.output}`); failed(error);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear();
  });
  child.stdout?.on('data', data => { entry.output += data; }); child.stderr?.on('data', data => { entry.output += data; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([startup, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${entry.output}`)), 15000); })]); }
  finally { clearTimeout(timer); }
  return entry;
}
function logs(entry: Process, name: string) { return entry.events.filter(event => event.event === 'tail' && event.name === name).map(event => event.entry); }
async function configureSearch(entry: Process, indexPrefix: string, host = meiliHost, maxAttempts = 3) {
  return entry.request('configure-search', { host, apiKey: masterKey, indexPrefix, maxAttempts });
}
const context = { teamId: 'proof-team', correlationId: 'proof-correlation', userId: 'proof-actor' };

describe('Shared database logs through independent Node ESM processes', () => {
  it('persists web/worker/scheduler channels, correlation and redaction across process replacement', async () => {
    const web = processes[0]; const worker = await spawn('worker'); const scheduler = await spawn('scheduler');
    const identities = await Promise.all([web, worker, scheduler].map(entry => entry.request('identity')));
    expect(new Set(identities.map(identity => identity.pid)).size).toBe(3);
    expect(identities.every(identity => identity.pid !== process.pid && identity.module.endsWith('fixture.mjs'))).toBe(true);
    for (const [entry, name] of [[web, 'web'], [worker, 'worker'], [scheduler, 'scheduler']] as const) {
      await entry.request('log', { context, message: `${name} token=${name}-secret Bearer ${name}-bearer https://operator:${name}-url-secret@example.test`,
        extra: { nested: { password: `${name}-password`, authorization: `${name}-authorization` }, safe: name } });
    }
    const page = await web.request('page', { filter: { tenantId: context.teamId, correlationId: context.correlationId, limit: 10 } });
    expect(page.meta).toMatchObject({ total: 3, scope: 'shared database', hasMore: false });
    expect(page.data.map((entry: any) => entry.channel)).toEqual(['web', 'worker', 'scheduler']);
    expect(page.data.every((entry: any) => entry.context.tenantId === context.teamId && entry.context.actorId === context.userId)).toBe(true);
    const rows = await scheduler.request('rows');
    const files = await Promise.all(identities.map(identity => readFile(join(working, `${identity.role}-${identity.pid}.jsonl`), 'utf8')));
    for (const name of ['web', 'worker', 'scheduler']) {
      for (const suffix of ['secret', 'bearer', 'url-secret', 'password', 'authorization']) {
        expect(JSON.stringify({ page, rows, files })).not.toContain(`${name}-${suffix}`);
      }
    }
    expect(rows.every((row: any) => row.correlation_id === context.correlationId && row.tenant_id === context.teamId)).toBe(true);
    await web.request('shutdown'); expect(await web.exit).toEqual({ code: 0, signal: null });
    const replacement = await spawn('web');
    expect((await replacement.request('page')).data).toEqual(page.data);
  }, 20000);

  it('uses stable shared entry cursors while new writers append and filters do not leak another scope', async () => {
    const web = processes[0]; const worker = await spawn('worker'); const scheduler = await spawn('scheduler');
    await worker.request('log', { context, message: 'First' }); await scheduler.request('log', { context, message: 'Second' });
    const filter = { tenantId: context.teamId, correlationId: context.correlationId, limit: 1 };
    const first = await web.request('page', { filter }); expect(first.meta).toMatchObject({ total: 2, hasMore: true });
    await worker.request('log', { context: { teamId: 'foreign', correlationId: context.correlationId }, message: 'Foreign tenant' });
    await scheduler.request('log', { context: { ...context, correlationId: 'foreign-correlation' }, message: 'Foreign correlation' });
    await worker.request('log', { context, message: 'Third' });
    const second = await web.request('page', { filter: { ...filter, cursor: first.meta.nextCursor } });
    const third = await web.request('page', { filter: { ...filter, cursor: second.meta.nextCursor } });
    expect([first, second, third].flatMap(page => page.data.map((entry: any) => entry.message))).toEqual(['First', 'Second', 'Third']);
    expect(third.meta).toMatchObject({ total: 3, hasMore: false, nextCursor: null });
    expect(new Set([first, second, third].flatMap(page => page.data.map((entry: any) => entry.id))).size).toBe(3);
    expect((await web.request('page', { filter: { tenantId: 'nonmember' } })).meta.total).toBe(0);
  }, 20000);

  it('tails scheduler/worker writes from another process, resumes after SIGKILL and stops delivery on unsubscribe', async () => {
    const web = processes[0]; const worker = await spawn('worker'); const scheduler = await spawn('scheduler');
    await worker.request('log', { context, message: 'Already read' });
    const cursor = (await web.request('page')).data[0].id;
    const filter = { cursor, tenantId: context.teamId, correlationId: context.correlationId };
    await web.request('tail', { name: 'stream', filter });
    await worker.request('log', { context, message: 'Worker live password=worker-tail-secret' });
    await scheduler.request('log', { context, message: 'Scheduler live' });
    await scheduler.request('log', { context: { ...context, teamId: 'foreign' }, message: 'Not visible' });
    await until(() => logs(web, 'stream').length === 2);
    expect(logs(web, 'stream').map(entry => entry.channel)).toEqual(['worker', 'scheduler']);
    expect(JSON.stringify(logs(web, 'stream'))).not.toContain('worker-tail-secret');
    const lastId = logs(web, 'stream').at(-1).id;
    web.child.kill('SIGKILL'); expect((await web.exit).signal).toBe('SIGKILL');
    await worker.request('log', { context, message: 'Persisted while reader stopped' });
    const replacement = await spawn('web'); await replacement.request('tail', { name: 'resume', filter: { ...filter, cursor: lastId } });
    await until(() => logs(replacement, 'resume').length === 1);
    expect(logs(replacement, 'resume')[0].message).toBe('Persisted while reader stopped');
    expect(logs(replacement, 'resume')[0].id).toBeGreaterThan(lastId);
    await replacement.request('untail', { name: 'resume' });
    await scheduler.request('log', { context, message: 'After unsubscribe' }); await sleep(100);
    expect(logs(replacement, 'resume')).toHaveLength(1);
    expect(await replacement.request('tail-errors')).toEqual([]);
    expect((await replacement.request('page', { filter: { ...filter, cursor: lastId } })).data.map((entry: any) => entry.message))
      .toEqual(['Persisted while reader stopped', 'After unsubscribe']);
  }, 20000);

  it('applies persisted retention from a separate scheduler and retains the exact cutoff boundary', async () => {
    const web = processes[0]; const worker = await spawn('worker'); const scheduler = await spawn('scheduler');
    const now = new Date(); const cutoff = now.getTime() - 60000;
    for (const [writer, timestamp, message] of [[worker, cutoff - 1, 'Expired'], [web, cutoff, 'Boundary'], [scheduler, now.getTime(), 'Current']] as const) {
      await writer.request('entry', { entry: { timestamp: new Date(timestamp).toISOString(), level: 'info', channel: 'retention', message,
        context: { tenantId: context.teamId, correlationId: context.correlationId } } });
    }
    const expired = (await web.request('page', { filter: { limit: 1 } })).data[0].id;
    expect(await scheduler.request('prune', { now: now.toISOString() })).toEqual({ removed: 1 });
    const result = await worker.request('page', { filter: { cursor: expired } });
    expect(result.data.map((entry: any) => entry.message)).toEqual(['Boundary', 'Current']);
    expect(result.meta.total).toBe(2); expect((await web.request('stats')).totalEntries).toBe(2);
  }, 20000);

  it('proves memory viewing is process-local instead of treating separate singleton instances as shared state', async () => {
    const web = processes[0]; const worker = await spawn('worker');
    await web.request('memory'); await worker.request('memory');
    await worker.request('log', { context, message: 'Only in worker memory' });
    expect((await worker.request('page')).meta).toMatchObject({ total: 1, scope: 'process' });
    expect((await web.request('page')).meta).toMatchObject({ total: 0, scope: 'process' });
  }, 20000);
});

describe('Transactional search intent through independent Node ESM processes', () => {
  it('rolls back model data and durable intent together, verified from another process', async () => {
    const web = processes[0]; const scheduler = await spawn('scheduler');
    await configureSearch(web, 'rollback', 'http://127.0.0.1:1');
    expect(await web.request('rollback')).toEqual({ articles: [], outbox: [] });
    expect(await scheduler.request('search-state')).toEqual({ articles: [], outbox: [] });
  }, 20000);
  it('rolls back the model insertion when the actual outbox table is unavailable', async () => {
    const web = processes[0]; const reader = await spawn('worker');
    await configureSearch(web, 'missing', 'http://127.0.0.1:1'); await web.request('drop-outbox');
    await expect(web.request('create', { title: 'Must not commit', privateValue: 'private' })).rejects.toThrow('svelar_search_outbox');
    await expect(reader.request('search-state')).rejects.toThrow('svelar_search_outbox');
    expect(await reader.request('article-rows')).toEqual([]);
  }, 20000);
});

describe.skipIf(!nativeSearch)('Native Meilisearch outage/recovery and keyset process proofs', () => {
  it('commits while the actual server is stopped, persists a failed delivery and recovers from another worker', async () => {
    const prefix = `outage_${crypto.randomUUID().replaceAll('-', '')}`;
    const web = processes[0]; const worker = await spawn('worker'); const scheduler = await spawn('scheduler');
    await configureSearch(web, prefix); await configureSearch(worker, prefix); await configureSearch(scheduler, prefix);
    expect(await worker.request('sdk')).toMatchObject({ publicConstructor: true, waitForTask: 'function' });
    await docker(['stop', '--time', '2', meiliContainer!]);
    try {
      await web.request('create', { title: 'Committed during outage', privateValue: 'never-searchable', context });
      const persisted = await scheduler.request('search-state'); expect(persisted.articles).toHaveLength(1); expect(persisted.outbox).toHaveLength(1);
      expect(JSON.stringify(persisted.outbox)).not.toContain('never-searchable');
      expect(JSON.parse(persisted.outbox[0].context)).toMatchObject(context);
      expect(await worker.request('process-search')).toEqual({ completed: 0, failed: 1 });
      const failed = await scheduler.request('search-state'); expect(failed.outbox[0]).toMatchObject({ status: 'pending', attempts: 1, owner: null });
      expect(failed.articles[0].title).toBe('Committed during outage'); expect(JSON.stringify(failed.outbox)).not.toContain(masterKey);
    } finally { await docker(['start', meiliContainer!]); await healthy(); }
    await sleep(1100);
    expect(await scheduler.request('process-search')).toEqual({ completed: 1, failed: 0 });
    expect((await worker.request('search-state')).outbox[0]).toMatchObject({ status: 'completed', owner: null, error: null });
    const indexed = await documents(`${prefix}_shared_process_articles`, 1);
    expect(indexed[0].title).toBe('Committed during outage'); expect(JSON.stringify(indexed)).not.toContain('never-searchable');
  }, 60000);

  it('detects a real asynchronous failed indexing task rather than treating broker acceptance as completion', async () => {
    const prefix = `failed_${crypto.randomUUID().replaceAll('-', '')}`;
    const worker = processes[0]; const reader = await spawn('scheduler'); await configureSearch(worker, prefix, meiliHost, 1);
    await worker.request('enqueue', { operation: { type: 'upsert', index: `${prefix}_invalid`, primaryKey: 'id', id: 'invalid id',
      document: { id: 'invalid id', title: 'Rejected document' } } });
    expect(await worker.request('process-search')).toEqual({ completed: 0, failed: 1 });
    const state = await reader.request('search-state');
    expect(state.outbox[0]).toMatchObject({ status: 'dead', attempts: 1, owner: null, processed_at: null });
    expect(state.outbox[0].error).toContain('invalid_document_id');
  }, 30000);

  it('reindexes custom keys in bounded batches without OFFSET skips when leading rows disappear', async () => {
    const prefix = `keyset_${crypto.randomUUID().replaceAll('-', '')}`;
    const worker = processes[0]; const web = await spawn('web');
    const codes = ['A10', 'B20', 'D40', 'F60', 'H80', 'J90', 'M99'];
    await web.request('seed-catalog', { rows: codes.map(code => ({ code, title: `Catalog ${code}`, private_value: 'hidden-catalog', published: true }))
      .concat([{ code: 'Z00', title: 'Draft', private_value: 'hidden-catalog', published: false }]) });
    const batches: string[][] = [];
    let release!: () => void; let arrived!: () => void;
    const firstBatch = new Promise<void>(resolve => { arrived = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    proxy = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        if (request.method === 'POST' && request.url?.includes('/documents')) {
          const docs = JSON.parse(body.toString()); batches.push(docs.map((doc: any) => doc.code));
          if (batches.length === 1) { arrived(); await barrier; }
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (!['host', 'connection', 'transfer-encoding', 'content-length'].includes(name) && value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
        }
        const upstream = await fetch(`${meiliHost}${request.url}`, { method: request.method, headers,
          ...(body.length ? { body } : {}), signal: AbortSignal.timeout(10000) });
        response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        response.end(Buffer.from(await upstream.arrayBuffer()));
      })().catch(error => { response.writeHead(502); response.end(String(error)); });
    });
    await new Promise<void>(resolve => proxy!.listen(0, '127.0.0.1', resolve));
    const address = proxy.address(); if (!address || typeof address === 'string') throw new Error('Missing isolated proxy port');
    await configureSearch(worker, prefix, `http://127.0.0.1:${address.port}`);
    const reindex = worker.request('reindex', { batchSize: 2 });
    try {
      await Promise.race([firstBatch, reindex.then(() => { throw new Error('Reindex did not reach the native batch barrier'); })]);
      expect(await web.request('remove-catalog', { codes: codes.slice(0, 2) })).toEqual({ removed: 2 });
    } finally { release(); }
    expect(await reindex).toEqual({ indexed: codes.length });
    expect(batches.every(batch => batch.length <= 2)).toBe(true); expect(batches.flat()).toEqual(codes);
    const indexed = await documents(`${prefix}_shared_process_catalog`, codes.length);
    expect(indexed.map(doc => doc.code).sort()).toEqual(codes); expect(JSON.stringify(indexed)).not.toContain('hidden-catalog');
    expect(indexed.some(doc => doc.title === 'Draft')).toBe(false);
  }, 30000);
});
