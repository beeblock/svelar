# Full-Text Search (Meilisearch)

Svelar provides a `Searchable` mixin that integrates your ORM models with [Meilisearch](https://www.meilisearch.com/) for fast, typo-tolerant full-text search. Indexes stay in sync automatically as you create, update, and delete records.

---

## Installation

```bash
npm install meilisearch
```

You need a running Meilisearch instance. For Docker setups, use:

```bash
npx svelar make:docker --meilisearch
```

Or run Meilisearch standalone:

```bash
docker run -d -p 7700:7700 -v meili_data:/meili_data \
  -e MEILI_MASTER_KEY=your-master-key \
  getmeili/meilisearch:v1.13
```

---

## Configuration

Configure the search client in your `src/app.ts`:

```typescript
import { Search } from '@beeblock/svelar/search';

Search.configure({
  host: process.env.MEILISEARCH_HOST ?? 'http://localhost:7700',
  apiKey: process.env.MEILISEARCH_KEY,
  indexPrefix: 'myapp', // optional — prefixes all index names
});
```

Add these to your `.env`:

```bash
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_KEY=your-master-key
```

---

## Making Models Searchable

Add the `Searchable` mixin to any model:

```typescript
import { Model } from '@beeblock/svelar/orm';
import { Searchable } from '@beeblock/svelar/search';

class Post extends Searchable(Model) {
  static table = 'posts';
}
```

That's it. Every time a `Post` is created, updated, or deleted, the search index updates automatically.

Search auto-sync is part of the model write path. If Meilisearch is misconfigured, unavailable, or rejects an indexing request, the create/update/delete operation fails instead of silently drifting out of sync. Removing a document that is already missing from the index is treated as a successful no-op.

### With HasRoles

Mixins compose — stack them:

```typescript
import { HasRoles } from '@beeblock/svelar/permissions';

class User extends Searchable(HasRoles(Model)) {
  static table = 'users';
}
```

---

## Customizing Indexed Data

By default, all model attributes are indexed. Override `toSearchableObject()` to control what gets sent to Meilisearch:

```typescript
class Post extends Searchable(Model) {
  static table = 'posts';

  toSearchableObject() {
    return {
      id: this.getAttribute('id'),
      title: this.getAttribute('title'),
      content: this.getAttribute('content'),
      author_name: this.getAttribute('author_name'),
      tags: this.getAttribute('tags'),
      published_at: this.getAttribute('published_at'),
    };
  }
}
```

### Conditional Indexing

Override `shouldBeSearchable()` to exclude certain records from the index:

```typescript
class Post extends Searchable(Model) {
  static table = 'posts';

  shouldBeSearchable(): boolean {
    return this.getAttribute('status') === 'published';
  }
}
```

Draft posts won't be indexed. If a published post is changed to draft, it gets removed from the index automatically.

### Custom Index Name

By default the table name is used. Override `getSearchableIndex()`:

```typescript
class Post extends Searchable(Model) {
  static table = 'posts';

  getSearchableIndex(): string {
    return 'blog_posts';
  }
}
```

---

## Searching

```typescript
// Basic search
const results = await Post.search('hello world');
console.log(results.hits);          // Array of matching documents
console.log(results.estimatedTotalHits); // Total count

// With options
const results = await Post.search('sveltekit', {
  limit: 20,
  offset: 0,
  filter: 'status = published',
  sort: ['created_at:desc'],
  attributesToRetrieve: ['id', 'title', 'content'],
  attributesToHighlight: ['title', 'content'],
});

// Access highlighted results
for (const hit of results.hits) {
  console.log(hit._formatted?.title); // <em>SvelteKit</em> is great
}
```

### Search Options

| Option | Type | Description |
|--------|------|-------------|
| `limit` | `number` | Max results to return (default: 20) |
| `offset` | `number` | Number of results to skip |
| `filter` | `string \| string[]` | Filter expression (requires filterable attributes) |
| `sort` | `string[]` | Sort by attributes (requires sortable attributes) |
| `attributesToRetrieve` | `string[]` | Fields to include in results |
| `attributesToHighlight` | `string[]` | Fields to highlight matches in |
| `facets` | `string[]` | Faceted search attributes |

### Using Search Results with Models

Search returns raw documents. To hydrate them into model instances:

```typescript
const results = await Post.search('hello');
const ids = results.hits.map(hit => hit.id);

// Load full models from database
const posts = await Post.query().whereIn('id', ids).get();
```

---

## Configuring Index Settings

Set filterable, sortable, and searchable attributes. Run this once (e.g., in a seeder or migration):

```typescript
await Post.configureSearchIndex({
  searchableAttributes: ['title', 'content', 'tags'],
  filterableAttributes: ['status', 'author_id', 'category', 'published_at'],
  sortableAttributes: ['created_at', 'title', 'published_at'],
  displayedAttributes: ['id', 'title', 'content', 'author_name', 'created_at'],
});
```

You can also create a project CLI command for this. In a DDD project, put it in `src/lib/shared/commands`; in a flat project, use `src/lib/commands`.

```typescript
// src/lib/shared/commands/SetupSearchCommand.ts
import { Command } from '@beeblock/svelar/cli';
import { Post } from '../../modules/posts/Post.js';

export default class SetupSearchCommand extends Command {
  name = 'search:setup';
  description = 'Configure Meilisearch indexes';
  flags = [];

  async handle(): Promise<void> {
    await this.bootstrap();

    await Post.configureSearchIndex({
      searchableAttributes: ['title', 'content', 'tags'],
      filterableAttributes: ['status', 'category'],
      sortableAttributes: ['created_at'],
    });

    this.success('Search indexes configured!');
  }
}
```

```bash
npx svelar search:setup
```

---

## Bulk Indexing

### Index All Records

```typescript
// Index all posts
const result = await Post.makeAllSearchable();
console.log(`Indexed ${result.indexed} posts`);

// Custom batch size (default: 500)
await Post.makeAllSearchable(1000);
```

### Remove All from Index

```typescript
await Post.removeAllFromSearch();
```

### Index Stats

```typescript
const stats = await Post.searchIndexStats();
console.log(stats.numberOfDocuments);
```

---

## Skipping Index Sync

When doing bulk operations (seeding, imports, migrations), you don't want every individual save to trigger an index update. Use `Search.withoutSyncing()`:

```typescript
import { Search } from '@beeblock/svelar/search';

// No index updates during this block
await Search.withoutSyncing(async () => {
  for (const row of csvData) {
    await Post.create({
      title: row.title,
      content: row.content,
      status: 'published',
    });
  }
});

// Re-index everything in one batch after the import
await Post.makeAllSearchable();
```

### Common Scenarios for Skipping Sync

**Database seeders:**

```typescript
// src/lib/database/seeders/PostSeeder.ts
import { Search } from '@beeblock/svelar/search';
import { Post } from '../../modules/posts/Post.js';

export default class PostSeeder {
  async run() {
    await Search.withoutSyncing(async () => {
      await Post.create({ title: 'First Post', content: '...', status: 'published' });
      await Post.create({ title: 'Second Post', content: '...', status: 'published' });
      // ... hundreds of records
    });

    // One batch sync at the end
    await Post.makeAllSearchable();
  }
}
```

**Bulk status updates:**

```typescript
await Search.withoutSyncing(async () => {
  // Archive old posts — skip individual index updates
  const oldPosts = await Post.query()
    .where('created_at', '<', '2025-01-01')
    .get();

  for (const post of oldPosts) {
    post.setAttribute('status', 'archived');
    await post.save();
  }
});

// Re-index to remove archived posts (shouldBeSearchable returns false for archived)
await Post.makeAllSearchable();
```

**Data migrations:**

```typescript
await Search.withoutSyncing(async () => {
  const posts = await Post.query().get();
  for (const post of posts) {
    // Normalize data without triggering search updates
    post.setAttribute('title', post.getAttribute('title').trim());
    await post.save();
  }
});

await Post.makeAllSearchable();
```

---

## Manual Index Control

You can manually control indexing on individual instances:

```typescript
const post = await Post.find(1);

// Manually add to index
await post.searchable();

// Manually remove from index
await post.unsearchable();
```

---

## Health Check

```typescript
const health = await Search.health();
console.log(health.status); // 'available'
```

---

## API Route Example

A search endpoint for your frontend:

```typescript
// src/routes/api/search/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { Post } from '$lib/modules/posts/Post.js';

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q') ?? '';
  const page = parseInt(url.searchParams.get('page') ?? '1');
  const limit = 20;

  if (!query.trim()) {
    return json({ hits: [], total: 0 });
  }

  const results = await Post.search(query, {
    limit,
    offset: (page - 1) * limit,
    filter: 'status = published',
    attributesToHighlight: ['title', 'content'],
  });

  return json({
    hits: results.hits,
    total: results.estimatedTotalHits ?? 0,
    page,
    limit,
  });
};
```

---

## Full Example

```typescript
// src/lib/modules/posts/Post.ts
import { Model } from '@beeblock/svelar/orm';
import { Searchable } from '@beeblock/svelar/search';

export class Post extends Searchable(Model) {
  static table = 'posts';

  // Only index published posts
  shouldBeSearchable(): boolean {
    return this.getAttribute('status') === 'published';
  }

  // Control which fields get indexed
  toSearchableObject() {
    return {
      id: this.getAttribute('id'),
      title: this.getAttribute('title'),
      content: this.getAttribute('content'),
      category: this.getAttribute('category'),
      tags: this.getAttribute('tags'),
      author_name: this.getAttribute('author_name'),
      published_at: this.getAttribute('published_at'),
    };
  }
}
```

```typescript
// src/app.ts
import { Search } from '@beeblock/svelar/search';

Search.configure({
  host: process.env.MEILISEARCH_HOST ?? 'http://localhost:7700',
  apiKey: process.env.MEILISEARCH_KEY,
});
```

```typescript
// Usage
const post = await Post.create({
  title: 'Getting Started with Svelar',
  content: 'Build SvelteKit apps the Laravel way...',
  status: 'published',
  category: 'tutorial',
});
// Automatically indexed in Meilisearch

const results = await Post.search('svelar tutorial');
// [{ id: 1, title: 'Getting Started with Svelar', ... }]

post.setAttribute('status', 'draft');
await post.save();
// Automatically removed from index (shouldBeSearchable returns false)
```
