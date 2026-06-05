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
}

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
  private syncingDisabled = false;

  configure(config: SearchConfig): void {
    this.config = config;
    this.client = null; // Reset client on reconfigure
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
    const prefix = this.config?.indexPrefix ?? '';
    return prefix ? `${prefix}_${baseName}` : baseName;
  }

  isSyncingDisabled(): boolean {
    return this.syncingDisabled;
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
    this.syncingDisabled = true;
    try {
      return await callback();
    } finally {
      this.syncingDisabled = false;
    }
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
      return (this as any).id ?? (this as any).getAttribute?.('id');
    }

    /**
     * The name of the primary key field in the search index.
     */
    searchableAs(): string {
      return 'id';
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
      const attrs = (this as any).attributes ?? (this as any).toJSON?.() ?? {};
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

      const client = Search.getClient();
      const index = client.index(this.getSearchableIndex());
      const doc = this.toSearchableObject();
      doc[this.searchableAs()] = this.getSearchableId();

      await index.addDocuments([doc], { primaryKey: this.searchableAs() });
    }

    /**
     * Remove this model instance from the search index.
     */
    async unsearchable(): Promise<void> {
      const client = Search.getClient();
      const index = client.index(this.getSearchableIndex());

      try {
        await index.deleteDocument(this.getSearchableId());
      } catch (error) {
        if (!isSearchDocumentMissingError(error)) throw error;
      }
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
      const instance = new this() as SearchableMixin;
      const client = Search.getClient();
      const index = client.index(instance.getSearchableIndex());

      // Get all records
      const records: any[] = await (this as any).query().get();
      const docs: Record<string, any>[] = [];

      for (const record of records) {
        if (record.shouldBeSearchable()) {
          const doc = record.toSearchableObject();
          doc[record.searchableAs()] = record.getSearchableId();
          docs.push(doc);
        }
      }

      // Send in batches
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        await index.addDocuments(batch, { primaryKey: instance.searchableAs() });
      }

      return { indexed: docs.length };
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

  // Register model hooks for auto-syncing
  // These fire after create/update/delete to keep the index in sync.
  const origBoot = (Base as any).boot;

  (SearchableMixin as any)._searchableBooted = false;

  // Override save/delete to add search syncing
  const origSave = SearchableMixin.prototype.save;
  if (origSave) {
    SearchableMixin.prototype.save = async function (...args: any[]) {
      const result = await origSave.apply(this, args);
      if (!Search.isSyncingDisabled()) {
        await this.searchable();
      }
      return result;
    };
  }

  const origCreate = (SearchableMixin as any).create;
  if (origCreate) {
    (SearchableMixin as any).create = async function (data: any) {
      const result = await origCreate.call(this, data);
      if (!Search.isSyncingDisabled() && result) {
        await result.searchable();
      }
      return result;
    };
  }

  const origDelete = SearchableMixin.prototype.delete;
  if (origDelete) {
    SearchableMixin.prototype.delete = async function (...args: any[]) {
      const id = this.getSearchableId();
      const indexName = this.getSearchableIndex();
      const result = await origDelete.apply(this, args);
      if (!Search.isSyncingDisabled()) {
        try {
          const client = Search.getClient();
          const index = client.index(indexName);
          await index.deleteDocument(id);
        } catch (error) {
          if (!isSearchDocumentMissingError(error)) throw error;
        }
      }
      return result;
    };
  }

  return SearchableMixin as unknown as TBase & (new (...args: any[]) => SearchableInstance);
}
