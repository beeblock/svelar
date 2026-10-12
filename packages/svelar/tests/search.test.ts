import { afterEach, describe, expect, it, vi } from 'vitest';
import { Search, Searchable } from '../src/search/index.js';

class SearchTestModel {
  static table = 'search_test_models';
  static saved: any[] = [];
  attributes: Record<string, any>;

  constructor(attributes: Record<string, any> = {}) {
    this.attributes = attributes;
  }

  getAttribute(key: string): any {
    return this.attributes[key];
  }

  async save(): Promise<this> {
    SearchTestModel.saved.push(this.attributes);
    return this;
  }

  async delete(): Promise<boolean> {
    return true;
  }

  static async create(data: Record<string, any>): Promise<any> {
    return new this(data);
  }
}

const SearchableSearchTestModel = Searchable(SearchTestModel);

function configureSearchClient(index: Record<string, any>): void {
  Search.configure({ host: 'http://meilisearch.test' });
  (Search as any).client = {
    index() {
      return index;
    },
  };
}

describe('Searchable', () => {
  afterEach(() => {
    Search.configure({ host: 'http://meilisearch.test' });
    (Search as any).client = null;
    vi.restoreAllMocks();
  });

  it('propagates search indexing failures during create', async () => {
    configureSearchClient({
      async addDocuments() {
        throw new Error('meilisearch indexing failed');
      },
    });

    await expect(SearchableSearchTestModel.create({ id: 1, title: 'Broken' })).rejects.toThrow(
      'meilisearch indexing failed'
    );
  });

  it('propagates search indexing failures during save', async () => {
    configureSearchClient({
      async addDocuments() {
        throw new Error('meilisearch save indexing failed');
      },
    });

    const model = new SearchableSearchTestModel({ id: 2, title: 'Broken save' });

    await expect(model.save()).rejects.toThrow('meilisearch save indexing failed');
  });

  it('propagates search removal failures during delete', async () => {
    configureSearchClient({
      async deleteDocument() {
        throw new Error('meilisearch delete failed');
      },
    });

    const model = new SearchableSearchTestModel({ id: 3, title: 'Broken delete' });

    await expect(model.delete()).rejects.toThrow('meilisearch delete failed');
  });

  it('ignores document-not-found errors during search removal', async () => {
    const deleted: Array<string | number> = [];
    configureSearchClient({
      async deleteDocument(id: string | number) {
        deleted.push(id);
        const error: any = new Error('document not found');
        error.status = 404;
        throw error;
      },
    });

    const model = new SearchableSearchTestModel({ id: 4, title: 'Already gone' });

    await expect(model.unsearchable()).resolves.toBeUndefined();
    await expect(model.delete()).resolves.toBe(true);
    expect(deleted).toEqual([4, 4]);
  });

  it('skips auto-sync inside Search.withoutSyncing', async () => {
    const indexed: any[] = [];
    configureSearchClient({
      async addDocuments(docs: any[]) {
        indexed.push(...docs);
      },
    });

    await Search.withoutSyncing(async () => {
      await SearchableSearchTestModel.create({ id: 5, title: 'Bulk import' });
    });

    expect(indexed).toEqual([]);
  });

  it('keeps Search.withoutSyncing isolated between concurrent async flows', async () => {
    const indexed: any[] = [];
    configureSearchClient({
      async addDocuments(docs: any[]) {
        indexed.push(...docs);
      },
    });

    await Promise.all([
      Search.withoutSyncing(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await SearchableSearchTestModel.create({ id: 6, title: 'Bulk import' });
      }),
      SearchableSearchTestModel.create({ id: 7, title: 'Visible write' }),
    ]);

    expect(indexed).toEqual([{ id: 7, title: 'Visible write' }]);
  });

  it('can fail open for automatic indexing errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Search.configure({ host: 'http://meilisearch.test', syncMode: 'fail-open' });
    (Search as any).client = {
      index() {
        return {
          async addDocuments() {
            throw new Error('meilisearch unavailable');
          },
        };
      },
    };

    await expect(SearchableSearchTestModel.create({ id: 8, title: 'Saved anyway' })).resolves.toBeInstanceOf(
      SearchableSearchTestModel
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('meilisearch unavailable'));
  });

  it('normalizes index prefixes without duplicate separators', () => {
    Search.configure({ host: 'http://meilisearch.test', indexPrefix: 'tenant_' });
    const model = new SearchableSearchTestModel();

    expect(model.getSearchableIndex()).toBe('tenant_search_test_models');
  });

  it('streams makeAllSearchable through chunk-capable queries', async () => {
    const batches: any[][] = [];

    class ChunkedModel {
      static table = 'chunked_models';
      attributes: Record<string, any>;

      constructor(attributes: Record<string, any> = {}) {
        this.attributes = attributes;
      }

      getAttribute(key: string): any {
        return this.attributes[key];
      }

      static query() {
        const ModelClass = this as any;
        return {
          async chunk(_size: number, callback: (records: any[]) => Promise<void>) {
            await callback([new ModelClass({ id: 1, title: 'One' }), new ModelClass({ id: 2, title: 'Two' })]);
            await callback([new ModelClass({ id: 3, title: 'Three' })]);
          },
        };
      }
    }

    const SearchableChunkedModel = Searchable(ChunkedModel);
    configureSearchClient({
      async addDocuments(docs: any[]) {
        batches.push(docs);
      },
    });

    await expect(SearchableChunkedModel.makeAllSearchable(2)).resolves.toEqual({ indexed: 3 });
    expect(batches).toEqual([
      [
        { id: 1, title: 'One' },
        { id: 2, title: 'Two' },
      ],
      [{ id: 3, title: 'Three' }],
    ]);
  });
});
