import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Connection, Schema, CreateSvelarLogsTable, CreateSearchOutboxTable } from '../src/database/index.js';
import { Log, LogViewer, type LogFilter } from '../src/logging/index.js';
import { Model, QueryBuilder } from '../src/orm/index.js';
import { Queue } from '../src/queue/index.js';
import { Search, Searchable } from '../src/search/index.js';
import { ApplicationContext } from '../src/support/index.js';

interface Request { id: number; operation: string; args?: Record<string, any>; }
const role = process.env.SVELAR_SHARED_ROLE!;
const directory = process.env.SVELAR_SHARED_DIRECTORY!;
Connection.configure({ default: 'shared', connections: {
  shared: { driver: 'sqlite', filename: process.env.SVELAR_SHARED_DATABASE! },
} });
Queue.configure({ default: 'sync', connections: { sync: { driver: 'sync' } } });
const tails = new Map<string, () => void>();
const tailErrors: string[] = [];

function configureLogs(driver: 'database' | 'memory' = 'database') {
  Log.configure({ default: role, channels: { [role]: {
    driver: 'file', path: join(directory, `${role}-${process.pid}.jsonl`), format: 'json', level: 'debug',
  } }, context: { processRole: role, processId: process.pid }, viewer: {
    driver, connection: 'shared', tailIntervalMs: 25, retentionSeconds: 60,
    onTailError: error => {
      const message = error instanceof Error ? error.message : String(error);
      tailErrors.push(message); process.send?.({ event: 'tail-error', message });
    },
  } });
}
configureLogs();

class SharedArticle extends Searchable(Model) {
  static table = 'shared_process_articles';
  static fillable = ['title', 'private_value'];
  static hidden = ['private_value'];
}
class SharedCatalog extends Searchable(Model) {
  static table = 'shared_process_catalog';
  static primaryKey = 'code';
  static incrementing = false;
  static timestamps = false;
  static hidden = ['private_value'];
  static casts = { published: 'boolean' as const };
  shouldBeSearchable() { return this.getAttribute('published') === true; }
}
function filter(args: Record<string, any> = {}): LogFilter {
  return { ...args, ...(args.since ? { since: new Date(args.since) } : {}), ...(args.until ? { until: new Date(args.until) } : {}) };
}
function table(name: string) { return new QueryBuilder(name, undefined, 'shared'); }
function searchState() {
  return Promise.all([table(SharedArticle.table).get(), table('svelar_search_outbox').orderBy('id').get()])
    .then(([articles, outbox]) => ({ articles, outbox }));
}

async function handle({ operation, args = {} }: Request): Promise<unknown> {
  switch (operation) {
    case 'migrate':
      await new CreateSvelarLogsTable().up();
      await new CreateSearchOutboxTable().up();
      await new Schema('shared').createTable(SharedArticle.table, columns => {
        columns.increments('id'); columns.string('title'); columns.string('private_value').nullable(); columns.timestamps();
      });
      await new Schema('shared').createTable(SharedCatalog.table, columns => {
        columns.string('code').primary(); columns.string('title'); columns.string('private_value').nullable(); columns.boolean('published');
      });
      return { migrated: true };
    case 'identity': return { pid: process.pid, role, node: process.version, module: import.meta.url, scope: LogViewer.scope };
    case 'log':
      await ApplicationContext.runIsolated(args.context ?? {}, () => Log[args.level as 'info' | 'error' ?? 'info'](args.message, args.extra ?? {}));
      return { written: true, pid: process.pid };
    case 'entry': await LogViewer.addEntry(args.entry); return { written: true };
    case 'page': return LogViewer.page(filter(args.filter));
    case 'stats': return LogViewer.getStats();
    case 'rows': return table('svelar_logs').orderBy('id').get();
    case 'prune': return { removed: await LogViewer.prune(new Date(args.now)) };
    case 'tail': {
      if (tails.has(args.name)) throw new Error('Duplicate fixture tail');
      tails.set(args.name, LogViewer.tail(entry => process.send?.({ event: 'tail', name: args.name, entry }), filter(args.filter)));
      return { subscribed: true };
    }
    case 'untail': tails.get(args.name)?.(); tails.delete(args.name); return { stopped: true };
    case 'tail-errors': return tailErrors;
    case 'memory': configureLogs('memory'); return { scope: LogViewer.scope };
    case 'configure-search':
      Search.configure({ host: args.host, apiKey: args.apiKey, indexPrefix: args.indexPrefix,
        outbox: { connection: 'shared', retrySeconds: 1, leaseSeconds: 2, maxAttempts: args.maxAttempts ?? 3 } });
      return { configured: true };
    case 'sdk': {
      const client = Search.getClient();
      const { Meilisearch } = createRequire(import.meta.url)('meilisearch') as typeof import('meilisearch');
      return { publicConstructor: client instanceof Meilisearch, waitForTask: typeof client.tasks?.waitForTask, node: process.version };
    }
    case 'create': {
      const article = await ApplicationContext.runIsolated(args.context ?? {}, () => SharedArticle.create({ title: args.title, private_value: args.privateValue }));
      return article?.toJSON();
    }
    case 'search-state': return searchState();
    case 'article-rows': return table(SharedArticle.table).get();
    case 'rollback': {
      const rollback = new Error('intentional fixture rollback');
      try {
        await Connection.transaction(async () => {
          await SharedArticle.create({ title: 'Must roll back', private_value: 'not-indexed' });
          throw rollback;
        }, 'shared');
      } catch (error) { if (error !== rollback) throw error; }
      return searchState();
    }
    case 'drop-outbox': await new Schema('shared').dropTable('svelar_search_outbox'); return { dropped: true };
    case 'process-search': return Search.processOutbox('shared', args.limit ?? 100);
    case 'search-stats': return Search.outbox('shared').stats();
    case 'enqueue': await Search.outbox('shared').enqueue(args.operation); return { queued: true };
    case 'seed-catalog': await table(SharedCatalog.table).insertMany(args.rows); return { inserted: args.rows.length };
    case 'remove-catalog': return { removed: await table(SharedCatalog.table).whereIn('code', args.codes).delete() };
    case 'catalog': return table(SharedCatalog.table).orderBy('code').get();
    case 'reindex': return SharedCatalog.makeAllSearchable(args.batchSize);
    case 'shutdown':
      for (const stop of tails.values()) stop(); tails.clear();
      await Queue.stop(); await Connection.disconnect();
      return { stopped: true };
    default: throw new Error(`Unknown fixture operation: ${operation}`);
  }
}

let pending = Promise.resolve();
process.on('message', message => {
  const request = message as Request;
  pending = pending.then(async () => {
    try {
      const result = await handle(request);
      await new Promise<void>((resolve, reject) => process.send?.({ reply: request.id, result }, error => error ? reject(error) : resolve()));
      if (request.operation === 'shutdown') process.disconnect();
    } catch (error) {
      process.send?.({ reply: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
});
process.send?.({ event: 'ready', pid: process.pid, role });
