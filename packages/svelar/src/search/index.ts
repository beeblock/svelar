/**
 * Svelar Search — Meilisearch integration for models
 *
 * Provides a Searchable mixin for automatic index syncing,
 * a Search singleton for configuration, and a SearchObserver
 * for hooking into model lifecycle events.
 *
 * @example
 * ```typescript
 * import { Search, Searchable } from '@beeblock/svelar/search';
 * import { Model } from '@beeblock/svelar/orm';
 *
 * Search.configure({
 *   host: env.MEILISEARCH_HOST ?? 'http://localhost:7700',
 *   apiKey: env.MEILISEARCH_KEY,
 * });
 *
 * class Post extends Searchable(Model) {
 *   static table = 'posts';
 *
 *   // Customize what gets indexed (optional)
 *   toSearchableObject() {
 *     return {
 *       id: this.getAttribute('id'),
 *       title: this.getAttribute('title'),
 *       content: this.getAttribute('content'),
 *       author: this.getAttribute('author_name'),
 *     };
 *   }
 * }
 *
 * // Search
 * const results = await Post.search('hello world');
 *
 * // Bulk operations without syncing
 * await Search.withoutSyncing(async () => {
 *   await Post.query().where('status', 'draft').update({ status: 'archived' });
 * });
 *
 * // Manually re-index all records
 * await Post.makeAllSearchable();
 * ```
 */

import { singleton } from '../support/singleton.js';

import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Connection } from '../database/Connection.js';
import { Job, Queue } from '../queue/index.js';
import { SearchOutbox, type SearchOutboxOptions } from './SearchOutbox.js';
import { redactLogText } from '../logging/Redaction.js';
import { ScheduledTask } from '../scheduler/index.js';

const requireOptionalPeer = createRequire(import.meta.url);

function isSearchDocumentMissingError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as {
    code?: string;
    errorCode?: string;
    type?: string;
    name?: string;
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };

  return (
    err.status === 404 ||
    err.statusCode === 404 ||
    err.response?.status === 404 ||
    err.code === 'document_not_found' ||
    err.errorCode === 'document_not_found' ||
    err.type === 'document_not_found' ||
    err.name === 'DocumentNotFoundError'
  );
}

// ── Types ──────────────────────────────────────────────────

export interface SearchConfig {
  host: string;
  apiKey?: string;
  indexPrefix?: string;
  syncMode?: SearchSyncMode;
  syncHandler?: SearchSyncHandler;
  /** Durable outbox is the default. Inline synchronization is an explicit opt-in. */
  syncDriver?: 'outbox' | 'inline';
  outbox?: SearchOutboxOptions;
}

export type SearchSyncMode = 'strict' | 'fail-open';

export interface SearchSyncOperation {
  type: 'upsert' | 'delete';
  index: string;
  primaryKey: string;
  id: string | number;
  document?: Record<string, any>;
}

export type SearchSyncHandler = (
  operation: SearchSyncOperation,
  next: () => Promise<void>
) => Promise<void>;

export interface SearchHit {
  [key: string]: any;
}

export interface SearchResults {
  hits: SearchHit[];
  query: string;
  processingTimeMs: number;
  estimatedTotalHits?: number;
  limit: number;
  offset: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  filter?: string | string[];
  sort?: string[];
  attributesToRetrieve?: string[];
  attributesToHighlight?: string[];
  facets?: string[];
}

export interface SearchableInstance {
  getSearchableIndex(): string;
  getSearchableId(): string | number;
  toSearchableObject(): Record<string, any>;
  searchableAs(): string;
  shouldBeSearchable(): boolean;
}

type Constructor = new (...args: any[]) => any;

// ── Search Manager (Singleton) ─────────────────────────────

class SearchManager {
  private config: SearchConfig | null = null;
  private client: any = null;
  private syncingContext = new AsyncLocalStorage<{ disabled: boolean }>();
  private persistenceContext = new AsyncLocalStorage<{ connection?: string }>();

  configure(config: SearchConfig): void {
    if (!config.host) throw new Error('Search host is required.');
    if (config.syncDriver && !['outbox', 'inline'].includes(config.syncDriver)) throw new Error('Invalid search synchronization driver.');
    new SearchOutbox(config.outbox);
    this.config = config;
    this.client = null; // Reset client on reconfigure
    Queue.register(ProcessSearchOutboxJob);
    if (config.outbox?.queue) Queue.registerQueue({ name: config.outbox.queue, label: 'Search synchronization' });
  }

  getClient(): any {
    if (!this.config) {
      throw new Error(
        'Search not configured. Call Search.configure({ host, apiKey }) first.'
      );
    }

    if (!this.client) {
      // Lazy-load meilisearch to avoid requiring it when not used
      let MeiliSearch: any;
      try {
        ({ MeiliSearch } = requireOptionalPeer('meilisearch'));
      } catch {
        throw new Error(
          'meilisearch package not installed. Run: npm install meilisearch'
        );
      }

      this.client = new MeiliSearch({
        host: this.config.host,
        apiKey: this.config.apiKey,
      });
    }

    return this.client;
  }

  getIndexName(baseName: string): string {
    const prefix = (this.config?.indexPrefix ?? '').replace(/_+$/g, '');
    const normalizedBase = baseName.replace(/^_+/g, '');
    return prefix ? `${prefix}_${normalizedBase}` : normalizedBase;
  }

  isSyncingDisabled(): boolean {
    return this.syncingContext.getStore()?.disabled === true;
  }

  getSyncMode(): SearchSyncMode {
    return this.config?.syncMode ?? 'strict';
  }

  isConfigured(): boolean { return this.config !== null; }

  getSyncDriver(): 'outbox' | 'inline' { return this.config?.syncDriver ?? 'outbox'; }

  /** Keep the model write and its outbox entry in the same database transaction. */
  async persist<T>(callback: () => Promise<T>, connection?: string): Promise<T> {
    if (this.isSyncingDisabled() || this.getSyncDriver() === 'inline') return callback();
    if (!this.config) throw new Error('Search not configured.');
    const configuredConnection = this.config.outbox?.connection;
    if (configuredConnection !== undefined && Connection.getConfig(configuredConnection) !== Connection.getConfig(connection)) {
      throw new Error('Automatic search outbox must use the model database connection.');
    }
    return this.persistenceContext.run({ connection }, () => Connection.transaction(callback, connection));
  }

  async processOutbox(connection?: string, limit = 100) {
    return this.outbox(connection).drain((operation) => this.execute(operation), limit);
  }

  outbox(connection?: string): SearchOutbox {
    if (!this.config) throw new Error('Search not configured.');
    return new SearchOutbox({ ...this.config.outbox, connection: connection ?? this.config.outbox?.connection });
  }

  async execute(operation: SearchSyncOperation): Promise<void> {
    const client = this.getClient();
    const index = client.index(operation.index);
    let task: any;
    try {
      task = operation.type === 'delete' ? await index.deleteDocument(operation.id)
        : await index.addDocuments([operation.document], { primaryKey: operation.primaryKey });
    } catch (error) {
      if (operation.type === 'delete' && isSearchDocumentMissingError(error)) return;
      throw error;
    }
    if (task?.taskUid !== undefined) {
      const settled = await client.waitForTask(task.taskUid, { timeOutMs: 30_000 });
      if (settled.status !== 'succeeded') throw new Error(`Search indexing task ${settled.status}: ${settled.error?.code ?? 'unknown'}`);
    }
  }

  async sync(operation: SearchSyncOperation, next: () => Promise<void>): Promise<void> {
    if (this.getSyncDriver() === 'outbox') {
      const connection = this.persistenceContext.getStore()?.connection ?? this.config?.outbox?.connection;
      await this.outbox(connection).enqueue(operation);
      await Connection.afterCommit(async () => {
        // Sync queues cannot make this asynchronous; the persistent scheduler sweep is the fallback.
        if (Queue.getDriver() === 'sync') return;
        try { await Queue.dispatch(new ProcessSearchOutboxJob(connection), { queue: this.config?.outbox?.queue ?? 'default' }); }
        catch (error) { this.reportSyncFailure(operation, error); }
      }, connection);
      return;
    }
    const run = this.config?.syncHandler
      ? () => this.config!.syncHandler!(operation, next)
      : next;

    try {
      await run();
    } catch (error) {
      if (this.getSyncMode() === 'strict') throw error;
      this.reportSyncFailure(operation, error);
    }
  }

  /**
   * Execute a callback with search index syncing disabled.
   * Useful for bulk operations, seeding, or migrations where
   * you don't want every model save to trigger an index update.
   *
   * @example
   * ```typescript
   * await Search.withoutSyncing(async () => {
   *   for (const row of bulkData) {
   *     await Post.create(row);
   *   }
   * });
   *
   * // Re-index everything after bulk insert
   * await Post.makeAllSearchable();
   * ```
   */
  async withoutSyncing<T>(callback: () => T | Promise<T>): Promise<T> {
    if (this.isSyncingDisabled()) return callback();
    return this.syncingContext.run({ disabled: true }, callback);
  }

  private reportSyncFailure(operation: SearchSyncOperation, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[svelar:search] ${operation.type} sync failed for ${operation.index}:${operation.id}: ${redactLogText(message)}`
    );
  }

  /**
   * Check if the Meilisearch instance is reachable.
   */
  async health(): Promise<{ status: string }> {
    const client = this.getClient();
    return client.health();
  }
}

export const Search: SearchManager = singleton(
  'svelar.search',
  () => new SearchManager()
);

/** A durable outbox remains recoverable even if queue dispatch is temporarily unavailable. */
export class ProcessSearchOutboxJob extends Job {
  constructor(readonly connection?: string, readonly batchSize = 100) { super(); }
  async handle(): Promise<void> { await Search.processOutbox(this.connection, this.batchSize); }
}
export class SearchOutboxSweep extends ScheduledTask {
  name = 'search-outbox-sweep';
  schedule() { return this.everyMinute().preventOverlap(); }
  async handle(): Promise<void> { if (Search.isConfigured()) await Search.processOutbox(); }
}
export { SearchOutbox } from './SearchOutbox.js';
export type { SearchOutboxOptions } from './SearchOutbox.js';

// ── Searchable Mixin ───────────────────────────────────────

export function Searchable<TBase extends Constructor>(
  Base: TBase
): TBase & (new (...args: any[]) => SearchableInstance) {
  class SearchableMixin extends Base {
    /**
     * Get the index name for this model.
     * Override to customize (defaults to table name).
     */
    getSearchableIndex(): string {
      const table = (this.constructor as any).table ?? this.constructor.name.toLowerCase() + 's';
      return Search.getIndexName(table);
    }

    /**
     * Get the unique ID for this document in the search index.
     */
    getSearchableId(): string | number {
      const primaryKey = (this.constructor as any).primaryKey ?? 'id';
      return (this as any).getAttribute?.(primaryKey) ?? (this as any)[primaryKey];
    }

    /**
     * The name of the primary key field in the search index.
     */
    searchableAs(): string {
      return (this.constructor as any).primaryKey ?? 'id';
    }

    /**
     * Whether this model instance should be indexed.
     * Override to conditionally exclude records (e.g., drafts).
     *
     * @example
     * ```typescript
     * shouldBeSearchable(): boolean {
     *   return this.getAttribute('status') === 'published';
     * }
     * ```
     */
    shouldBeSearchable(): boolean {
      return true;
    }

    /**
     * Get the data to index for this model.
     * Override to customize which fields are searchable.
     *
     * @example
     * ```typescript
     * toSearchableObject() {
     *   return {
     *     id: this.getAttribute('id'),
     *     title: this.getAttribute('title'),
     *     content: this.getAttribute('content'),
     *     tags: this.getAttribute('tags'),
     *   };
     * }
     * ```
     */
    toSearchableObject(): Record<string, any> {
      const attrs = (this as any).toJSON?.() ?? (this as any).attributes ?? {};
      // Clone to avoid mutating the model
      return { ...attrs };
    }

    /**
     * Index this model instance in Meilisearch.
     */
    async searchable(): Promise<void> {
      if (!this.shouldBeSearchable()) {
        // If it shouldn't be searchable, remove it
        await this.unsearchable();
        return;
      }

      const indexName = this.getSearchableIndex();
      const primaryKey = this.searchableAs();
      const doc = this.toSearchableObject();
      const id = this.getSearchableId();
      doc[primaryKey] = id;

      await Search.sync({ type: 'upsert', index: indexName, primaryKey, id, document: doc }, async () => {
        const client = Search.getClient();
        const index = client.index(indexName);
        await index.addDocuments([doc], { primaryKey });
      });
    }

    /**
     * Remove this model instance from the search index.
     */
    async unsearchable(): Promise<void> {
      const indexName = this.getSearchableIndex();
      const primaryKey = this.searchableAs();
      const id = this.getSearchableId();

      await Search.sync({ type: 'delete', index: indexName, primaryKey, id }, async () => {
        const client = Search.getClient();
        const index = client.index(indexName);
        try {
          await index.deleteDocument(id);
        } catch (error) {
          if (!isSearchDocumentMissingError(error)) throw error;
        }
      });
    }

    // ── Static Methods ──

    /**
     * Search the index for this model.
     *
     * @example
     * ```typescript
     * const results = await Post.search('hello world', { limit: 20 });
     * ```
     */
    static async search(
      query: string,
      options: SearchOptions = {}
    ): Promise<SearchResults> {
      const instance = new this() as SearchableMixin;
      const client = Search.getClient();
      const index = client.index(instance.getSearchableIndex());

      const searchParams: any = {};
      if (options.limit !== undefined) searchParams.limit = options.limit;
      if (options.offset !== undefined) searchParams.offset = options.offset;
      if (options.filter) searchParams.filter = options.filter;
      if (options.sort) searchParams.sort = options.sort;
      if (options.attributesToRetrieve) searchParams.attributesToRetrieve = options.attributesToRetrieve;
      if (options.attributesToHighlight) searchParams.attributesToHighlight = options.attributesToHighlight;
      if (options.facets) searchParams.facets = options.facets;

      return index.search(query, searchParams);
    }

    /**
     * Index all records of this model.
     * Fetches all records from the database and sends them to Meilisearch in batches.
     *
     * @param batchSize Number of documents to send per batch (default: 500)
     *
     * @example
     * ```typescript
     * await Post.makeAllSearchable();
     * await Post.makeAllSearchable(1000); // larger batches
     * ```
     */
    static async makeAllSearchable(batchSize: number = 500): Promise<{ indexed: number }> {
      if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) throw new Error('Invalid search batch size.');
      const instance = new this() as SearchableMixin;
      const client = Search.getClient();
      const index = client.index(instance.getSearchableIndex());

      let indexed = 0;
      const flush = async (docs: Record<string, any>[]) => {
        if (docs.length === 0) return;
        await index.addDocuments(docs, { primaryKey: instance.searchableAs() });
        indexed += docs.length;
      };
      const collect = async (records: any[]) => {
        const docs: Record<string, any>[] = [];
        for (const record of records) {
          if (record.shouldBeSearchable()) {
            const doc = record.toSearchableObject();
            doc[record.searchableAs()] = record.getSearchableId();
            docs.push(doc);
          }
        }
        await flush(docs);
      };

      const query = (this as any).query();
      await query.chunkById(batchSize, collect, (this as any).primaryKey ?? 'id');
      return { indexed };
    }

    /**
     * Remove all records of this model from the search index.
     *
     * @example
     * ```typescript
     * await Post.removeAllFromSearch();
     * ```
     */
    static async removeAllFromSearch(): Promise<void> {
      const instance = new this() as SearchableMixin;
      const client = Search.getClient();
      const index = client.index(instance.getSearchableIndex());
      await index.deleteAllDocuments();
    }

    /**
     * Configure the search index settings for this model.
     * Call once to set filterable/sortable attributes, ranking rules, etc.
     *
     * @example
     * ```typescript
     * await Post.configureSearchIndex({
     *   filterableAttributes: ['status', 'author_id', 'category'],
     *   sortableAttributes: ['created_at', 'title'],
     *   searchableAttributes: ['title', 'content', 'tags'],
     * });
     * ```
     */
    static async configureSearchIndex(settings: Record<string, any>): Promise<void> {
      const instance = new this() as SearchableMixin;
      const client = Search.getClient();
      const index = client.index(instance.getSearchableIndex());
      await index.updateSettings(settings);
    }

    /**
     * Get stats about this model's search index.
     */
    static async searchIndexStats(): Promise<any> {
      const instance = new this() as SearchableMixin;
      const client = Search.getClient();
      const index = client.index(instance.getSearchableIndex());
      return index.getStats();
    }
  }

  // Wrap persistence, not an external HTTP call, in the model's transaction.
  const origSave = SearchableMixin.prototype.save;
  if (origSave) {
    SearchableMixin.prototype.save = async function (...args: any[]) {
      const connection = args[0] ? args[0].getConnectionName() : (this.constructor as any).connection;
      return Search.persist(async () => {
        const result = await origSave.apply(this, args);
        if (!Search.isSyncingDisabled()) await this.searchable();
        return result;
      }, connection);
    };
  }
  const origCreate = (SearchableMixin as any).create;
  if (origCreate) {
    (SearchableMixin as any).create = async function (...args: any[]) {
      const connection = args[1]?.query ? args[1].query.getConnectionName() : this.connection;
      return Search.persist(async () => {
        const result = await origCreate.apply(this, args);
        if (!Search.isSyncingDisabled() && result) await result.searchable();
        return result;
      }, connection);
    };
  }
  for (const method of ['delete', 'forceDelete', 'restore'] as const) {
    const original = SearchableMixin.prototype[method];
    if (!original) continue;
    SearchableMixin.prototype[method] = async function (...args: any[]) {
      return Search.persist(async () => {
        const result = await original.apply(this, args);
        if (!Search.isSyncingDisabled() && result !== false) {
          if (method === 'restore') await this.searchable();
          else await this.unsearchable();
        }
        return result;
      }, (this.constructor as any).connection);
    };
  }
  return SearchableMixin as unknown as TBase & (new (...args: any[]) => SearchableInstance);
}
