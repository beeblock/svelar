import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { Meilisearch } from 'meilisearch';
import { afterEach, describe, expect, it } from 'vitest';
import { Search } from '../src/search/index.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const exec = promisify(execFile);
function respond(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
async function endpoint(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>, run: (host: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => { void Promise.resolve(handler(request, response)).catch(() => respond(response, { code: 'fixture_error' }, 500)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture endpoint.');
  try { await run('http://127.0.0.1:' + address.port); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
afterEach(() => Search.configure({ host: 'http://127.0.0.1:1' }));

describe('Current public Meilisearch SDK integration', () => {
  it('loads the ESM SDK lazily, caches the public client, and forwards authenticated configuration', async () => {
    const authorization: (string | undefined)[] = [];
    await endpoint((request, response) => {
      authorization.push(request.headers.authorization);
      respond(response, { status: 'available' });
    }, async (host) => {
      Search.configure({ host, apiKey: 'fixture-master-key', indexPrefix: 'fixture' });
      const client = Search.getClient();
      expect(client).toBeInstanceOf(Meilisearch);
      expect(Search.getClient()).toBe(client);
      expect(await Search.health()).toEqual({ status: 'available' });
      expect(authorization).toEqual(['Bearer fixture-master-key']);
      expect(Search.getIndexName('records')).toBe('fixture_records');
      Search.configure({ host });
      expect(Search.getClient()).not.toBe(client);
      await Search.health();
      expect(authorization).toEqual(['Bearer fixture-master-key', undefined]);
    });
  });

  it('waits through the public task client after an accepted document write', async () => {
    let polls = 0;
    const documents: unknown[] = [];
    await endpoint(async (request, response) => {
      if (request.method === 'POST' && request.url === '/indexes/records/documents?primaryKey=id') {
        let body = ''; for await (const chunk of request) body += chunk;
        documents.push(JSON.parse(body));
        respond(response, { taskUid: 7, indexUid: 'records', status: 'enqueued', type: 'documentAdditionOrUpdate', enqueuedAt: new Date().toISOString() }, 202);
      } else if (request.url === '/tasks/7') {
        polls++;
        respond(response, { uid: 7, status: polls === 1 ? 'processing' : 'succeeded', error: null });
      } else respond(response, { code: 'unexpected_request' }, 404);
    }, async (host) => {
      Search.configure({ host });
      await Search.execute({ type: 'upsert', index: 'records', primaryKey: 'id', id: 1, document: { id: 1, title: 'SDK contract' } });
      expect(documents).toEqual([[{ id: 1, title: 'SDK contract' }]]);
      expect(polls).toBe(2);
    });
  });

  it('propagates failed settled tasks rather than treating enqueue as successful indexing', async () => {
    await endpoint((request, response) => {
      if (request.method === 'DELETE' && request.url === '/indexes/records/documents/1') {
        respond(response, { taskUid: 8, indexUid: 'records', status: 'enqueued', type: 'documentDeletion', enqueuedAt: new Date().toISOString() }, 202);
      } else if (request.url === '/tasks/8') respond(response, { uid: 8, status: 'failed', error: { code: 'index_not_found' } });
      else respond(response, { code: 'unexpected_request' }, 404);
    }, async (host) => {
      Search.configure({ host });
      await expect(Search.execute({ type: 'delete', index: 'records', primaryKey: 'id', id: 1 })).rejects.toThrow('Search indexing task failed: index_not_found');
    });
  });

  it('retains the missing-document no-op using the current SDK public error shape', async () => {
    await endpoint((_request, response) => respond(response, { message: 'Missing document', code: 'document_not_found', type: 'invalid_request', link: 'https://www.meilisearch.com/docs' }, 404), async (host) => {
      Search.configure({ host });
      await expect(Search.execute({ type: 'delete', index: 'records', primaryKey: 'id', id: 1 })).resolves.toBeUndefined();
    });
  });

  it('type-checks the current public constructor, config, index and task-wait contracts', async () => {
    const directory = await mkdtemp(join(packageRoot, '.test-search-sdk-types-'));
    try {
      const file = join(directory, 'contract.ts');
      await writeFile(file, `import { Meilisearch, type Config, type WaitOptions } from 'meilisearch';
        const config: Config = { host: 'http://127.0.0.1:1', apiKey: 'fixture-key' };
        const client = new Meilisearch(config);
        const wait: WaitOptions = { timeout: 30000 };
        void client.tasks.waitForTask(7, wait);
        void client.index('records').addDocuments([{ id: 1 }], { primaryKey: 'id' });
        void client.index('records').deleteDocument(1);
      `);
      await exec(process.execPath, [fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)), '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file], { cwd: packageRoot, timeout: 30000 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('preserves subclass ORM static-this inference and exposes every searchable static without caller casts', async () => {
    const directory = await mkdtemp(join(packageRoot, '.test-searchable-types-'));
    try {
      const file = join(directory, 'contract.ts');
      await writeFile(file, `import { Model } from '../src/orm/Model.js';
        import { Searchable, type SearchableInstance, type SearchableStatic, type SearchResults } from '../src/search/index.js';
        import type { SearchableStatic as RootSearchableStatic } from '../src/index.js';
        import type { QueryBuilder } from '../src/orm/QueryBuilder.js';

        class ArticleBase extends Model {
          static table = 'articles';
          static customSetting = 'retained';
          static customStatic(): number { return 7; }
          headline(): string { return 'Article'; }
        }
        class Article extends Searchable(ArticleBase) {
          excerpt(): string { return this.headline(); }
        }
        const searchable: SearchableStatic<ArticleBase & SearchableInstance> = Article;
        const rootSearchable: RootSearchableStatic<ArticleBase & SearchableInstance> = Article;
        const inherited: number = Article.customStatic();
        const query: QueryBuilder<Article> = Article.query();
        const found: Promise<Article | null> = Article.find(1);
        const created: Promise<Article> = Article.create({ title: 'Typed' });
        const records: Promise<Article[]> = Article.all();
        const result: Promise<SearchResults> = Article.search('query', { limit: 10, filter: ['status = published'] });
        const reindex: Promise<{ indexed: number }> = Article.makeAllSearchable(100);
        const clear: Promise<void> = Article.removeAllFromSearch();
        const settings: Promise<void> = Article.configureSearchIndex({ filterableAttributes: ['status'] });
        const stats: Promise<Record<string, unknown>> = Article.searchIndexStats();
        const instance = new Article({ title: 'Typed' });
        instance.headline(); instance.excerpt(); instance.searchable(); instance.unsearchable();
        void [searchable, rootSearchable, inherited, query, found, created, records, result, reindex, clear, settings, stats];
      `);
      await exec(process.execPath, [fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)), '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file, join(packageRoot, 'src/types/externals.d.ts')], { cwd: packageRoot, timeout: 30000 }).catch((error: unknown) => {
        throw new Error(error instanceof Error && 'stdout' in error ? String(error.stdout) : String(error), { cause: error });
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects invalid searchable static arguments instead of widening the class to any', async () => {
    const directory = await mkdtemp(join(packageRoot, '.test-searchable-invalid-types-'));
    try {
      const file = join(directory, 'contract.ts');
      await writeFile(file, `import { Model } from '../src/orm/Model.js';
        import { Searchable } from '../src/search/index.js';
        class Article extends Searchable(Model) { static table = 'articles'; }
        Article.search(42);
        Article.search('query', { limit: 'unbounded' });
        Article.makeAllSearchable('unbounded');
        Article.configureSearchIndex(null);
        Article.doesNotExist();
      `);
      const result = await exec(process.execPath, [fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)), '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file, join(packageRoot, 'src/types/externals.d.ts')], { cwd: packageRoot, timeout: 30000 }).then(
        () => { throw new Error('TypeScript accepted invalid searchable static arguments.'); },
        (error: unknown) => {
          if (!(error instanceof Error) || !('stdout' in error)) throw error;
          return String(error.stdout);
        },
      );
      for (const line of [4, 5, 6, 7, 8]) expect(result).toContain('contract.ts(' + line + ',');
      expect(result).toContain('TS2345');
      expect(result).toContain('TS2322');
      expect(result).toContain('TS2339');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('constructs the actual latest SDK synchronously from an independently bundled native ESM entry', async () => {
    const directory = await mkdtemp(join(packageRoot, '.test-search-sdk-esm-'));
    try {
      const file = join(directory, 'search.mjs');
      await build({
        stdin: { resolveDir: packageRoot, contents: `
          import { Search } from './src/search/index.js';
          import { Meilisearch } from 'meilisearch';
          import assert from 'node:assert/strict';
          Search.configure({ host: 'http://127.0.0.1:1' });
          const client = Search.getClient();
          assert.ok(client instanceof Meilisearch);
          assert.equal(Search.getClient(), client);
          assert.equal(typeof client.tasks.waitForTask, 'function');
          console.log(process.version);
        ` }, outfile: file, platform: 'node', format: 'esm', target: 'node22', bundle: true, packages: 'external', logLevel: 'silent',
      });
      const result = await exec(process.env.SVELAR_PACKAGE_NODE ?? process.execPath, [file], { cwd: packageRoot, timeout: 30000 });
      expect(result.stdout.trim()).toMatch(/^v(?:22|2[4-9])\./);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
