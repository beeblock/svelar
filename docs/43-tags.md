# Tags Plugin

A polymorphic tagging plugin for Svelar/SvelteKit with typed tags, automatic slug generation, tag merging, popularity ranking, and pre-built UI components for tag input, display, and management. Inspired by Spatie's Laravel Tags package.

**Package:** `@beeblock/svelar-tags`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-tags
```

**Imports:**

```ts
// Plugin registration
import { SvelarTagsPlugin } from '@beeblock/svelar-tags/server';

// Core API
import { Tag, TagService, HasTags, slugify, TAGS_MIGRATION_SQL } from '@beeblock/svelar-tags';

// Server-side (controller)
import { TagController } from '@beeblock/svelar-tags/server';

// UI components
import { TagInput, TagBadge, TagList } from '@beeblock/svelar-tags/ui';

// Types
import type { TagRecord, TagCreateOptions, TagWithCount, TagsPluginConfig, TagInputItem } from '@beeblock/svelar-tags';
import type { HasTagsInstance } from '@beeblock/svelar-tags';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import { SvelarTagsPlugin } from '@beeblock/svelar-tags/server';

export const tagsPlugin = new SvelarTagsPlugin({
  prefix: '/api',
  slugSeparator: '-',
});
```

### 2. Run the Migration

```ts
import { TAGS_MIGRATION_SQL } from '@beeblock/svelar-tags';

// Execute each statement
for (const sql of TAGS_MIGRATION_SQL.up) {
  await connection.raw(sql);
}
```

Or run the SQL directly:

```sql
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT,
  order_column INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(slug, type)
);

CREATE TABLE IF NOT EXISTS taggables (
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  taggable_type TEXT NOT NULL,
  taggable_id INTEGER NOT NULL,
  PRIMARY KEY(tag_id, taggable_type, taggable_id)
);

CREATE INDEX IF NOT EXISTS idx_taggables_type_id ON taggables(taggable_type, taggable_id);
CREATE INDEX IF NOT EXISTS idx_tags_slug_type ON tags(slug, type);
```

### 3. Add Tags to a Model

```ts
import { Model } from '@beeblock/svelar/orm';
import { HasTags } from '@beeblock/svelar-tags';

class Post extends HasTags(Model) {
  static table = 'posts';
}

const post = await Post.find(1);
await post.attachTags(['typescript', 'svelte', 'sveltekit']);
await post.syncTagsOfType('category', ['tutorial', 'guide']);
```

---

## Configuration

The `SvelarTagsPlugin` constructor accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | `'/api'` | API route prefix |
| `slugSeparator` | `string` | `'-'` | Character used to separate words in slugs |

---

## Core API

### Tag Class

Static methods for CRUD operations on the `tags` table:

```ts
import { Tag } from '@beeblock/svelar-tags';
```

| Method | Returns | Description |
|---|---|---|
| `Tag.findById(id)` | `Promise<TagRecord \| null>` | Find a tag by ID |
| `Tag.findByName(name, type?)` | `Promise<TagRecord \| null>` | Find by name (auto-slugified) |
| `Tag.findBySlug(slug, type?)` | `Promise<TagRecord \| null>` | Find by slug |
| `Tag.findOrCreate(name, type?)` | `Promise<TagRecord>` | Find existing or create new |
| `Tag.create(name, type?, orderColumn?)` | `Promise<TagRecord>` | Create a new tag |
| `Tag.all()` | `Promise<TagRecord[]>` | Get all tags ordered by order_column, name |
| `Tag.ofType(type)` | `Promise<TagRecord[]>` | Get all tags of a specific type |
| `Tag.update(id, data)` | `Promise<TagRecord \| null>` | Update a tag (name, type, order_column) |
| `Tag.delete(id)` | `Promise<void>` | Delete a tag by ID |
| `Tag.usageCount(id)` | `Promise<number>` | Count models using this tag |

### TagService

Higher-level operations beyond basic CRUD:

```ts
import { TagService } from '@beeblock/svelar-tags';
```

| Method | Returns | Description |
|---|---|---|
| `TagService.all()` | `Promise<TagRecord[]>` | Get all tags |
| `TagService.ofType(type)` | `Promise<TagRecord[]>` | Get tags of a type |
| `TagService.popular(limit?)` | `Promise<TagWithCount[]>` | Get most-used tags with `usage_count` |
| `TagService.rename(oldName, newName, type?)` | `Promise<TagRecord \| null>` | Rename a tag (updates slug) |
| `TagService.merge(sourceNames, targetName, type?)` | `Promise<TagRecord>` | Merge multiple tags into one (reassigns relationships) |
| `TagService.deleteUnused()` | `Promise<number>` | Delete tags not attached to any model |
| `TagService.search(query, type?, limit?)` | `Promise<TagRecord[]>` | Search tags by name (partial match, LIKE) |

**Tag merging example:**

```ts
// Merge 'js', 'javascript', 'ecmascript' into 'javascript'
const merged = await TagService.merge(
  ['js', 'ecmascript'],
  'javascript',
);
// All models previously tagged with 'js' or 'ecmascript' now have 'javascript'
```

### HasTags Mixin

Adds tagging methods to any Svelar Model:

```ts
import { Model } from '@beeblock/svelar/orm';
import { HasTags } from '@beeblock/svelar-tags';

class Article extends HasTags(Model) {
  static table = 'articles';
}
```

**Instance methods:**

| Method | Returns | Description |
|---|---|---|
| `attachTag(name, type?)` | `Promise<void>` | Attach a single tag (creates if needed) |
| `attachTags(names, type?)` | `Promise<void>` | Attach multiple tags |
| `detachTag(name, type?)` | `Promise<void>` | Detach a single tag |
| `detachTags(names, type?)` | `Promise<void>` | Detach multiple tags |
| `syncTags(names, type?)` | `Promise<void>` | Replace all tags with the given list |
| `syncTagsOfType(type, names)` | `Promise<void>` | Replace only tags of a specific type |
| `tags()` | `Promise<TagRecord[]>` | Get all tags for this model |
| `tagsOfType(type)` | `Promise<TagRecord[]>` | Get tags of a specific type |
| `hasTag(name, type?)` | `Promise<boolean>` | Check if model has a specific tag |
| `hasAnyTags(names, type?)` | `Promise<boolean>` | Check if model has any of the given tags |
| `hasAllTags(names, type?)` | `Promise<boolean>` | Check if model has all of the given tags |

**Static query methods (filter models by tags):**

```ts
// Get posts that have any of these tags
const posts = await Post.withAnyTags(['svelte', 'typescript']).get();

// Get posts that have ALL of these tags
const posts = await Post.withAllTags(['svelte', 'typescript']).get();

// Get posts that do NOT have any of these tags
const posts = await Post.withoutTags(['draft', 'archived']).get();

// With tag type filter
const posts = await Post.withAnyTags(['tutorial'], 'category').get();
```

### TagRecord

```ts
interface TagRecord {
  id: number;
  name: string;
  slug: string;
  type: string | null;
  order_column: number;
  created_at: string | null;
  updated_at: string | null;
}
```

---

## Server-Side

### TagController

Provides static methods for full tag CRUD and management API routes:

```ts
// src/routes/api/tags/+server.ts
import { TagController } from '@beeblock/svelar-tags/server';

export const GET = async (event) => TagController.index(event);
export const POST = async (event) => TagController.store(event);
```

```ts
// src/routes/api/tags/[id]/+server.ts
import { TagController } from '@beeblock/svelar-tags/server';

export const GET = async (event) => TagController.show(event, Number(event.params.id));
export const PUT = async (event) => TagController.update(event, Number(event.params.id));
export const DELETE = async (event) => TagController.destroy(event, Number(event.params.id));
```

```ts
// src/routes/api/tags/popular/+server.ts
export const GET = async (event) => TagController.popular(event);

// src/routes/api/tags/merge/+server.ts
export const POST = async (event) => TagController.merge(event);

// src/routes/api/tags/unused/+server.ts
export const DELETE = async (event) => TagController.deleteUnused(event);

// src/routes/api/tags/attach/+server.ts
export const POST = async (event) => TagController.attach(event);

// src/routes/api/tags/detach/+server.ts
export const POST = async (event) => TagController.detach(event);

// src/routes/api/tags/sync/+server.ts
export const POST = async (event) => TagController.sync(event);
```

**API endpoints:**

| Method | Route | Handler | Description |
|---|---|---|---|
| `GET` | `/api/tags` | `index` | List tags (query params: `type`, `search`, `limit`) |
| `GET` | `/api/tags/:id` | `show` | Get a single tag with usage count |
| `POST` | `/api/tags` | `store` | Create a tag (`{ name, type?, order_column? }`) |
| `PUT` | `/api/tags/:id` | `update` | Update a tag |
| `DELETE` | `/api/tags/:id` | `destroy` | Delete a tag |
| `GET` | `/api/tags/popular` | `popular` | Get popular tags (query param: `limit`) |
| `POST` | `/api/tags/merge` | `merge` | Merge tags (`{ sources: string[], target: string, type? }`) |
| `DELETE` | `/api/tags/unused` | `deleteUnused` | Delete unused tags |
| `POST` | `/api/tags/attach` | `attach` | Attach tags (`{ tags, type?, taggable_type, taggable_id }`) |
| `POST` | `/api/tags/detach` | `detach` | Detach tags (same body as attach) |
| `POST` | `/api/tags/sync` | `sync` | Sync tags (same body as attach) |

---

## UI Components

### TagInput

An autocomplete tag input with suggestions, keyboard navigation, and inline tag creation:

```svelte
<script lang="ts">
  import { TagInput } from '@beeblock/svelar-tags/ui';
  import type { TagInputItem } from '@beeblock/svelar-tags';

  let selectedTags = $state<TagInputItem[]>([]);
</script>

<TagInput
  value={selectedTags}
  onchange={(tags) => selectedTags = tags}
  suggestUrl="/api/tags"
  allowCreate={true}
  tagType="category"
  placeholder="Add a tag..."
  max={10}
  debounceMs={250}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `TagInputItem[]` | `[]` | Currently selected tags |
| `onchange` | `(tags) => void` | `undefined` | Callback when tags change |
| `suggestUrl` | `string` | `'/api/tags'` | URL to fetch suggestions (GET, expects `{ data: TagInputItem[] }`) |
| `suggestions` | `TagInputItem[]` | `undefined` | Static list of suggestions (overrides `suggestUrl`) |
| `allowCreate` | `boolean` | `true` | Allow creating new tags inline |
| `tagType` | `string \| null` | `null` | Tag type for newly created tags |
| `placeholder` | `string` | `'Add a tag...'` | Input placeholder text |
| `max` | `number` | `0` | Max tags allowed (0 = unlimited) |
| `debounceMs` | `number` | `250` | Debounce delay for search in ms |
| `class` | `string` | `''` | CSS class override |

### TagBadge

A single tag badge with optional remove button:

```svelte
<script lang="ts">
  import { TagBadge } from '@beeblock/svelar-tags/ui';
</script>

<TagBadge
  name="svelte"
  type="framework"
  removable={true}
  onremove={() => console.log('removed')}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Tag name to display |
| `type` | `string \| null` | `null` | Tag type (adds a type badge and CSS modifier) |
| `removable` | `boolean` | `false` | Show remove button |
| `onremove` | `() => void` | `undefined` | Callback when remove is clicked |
| `class` | `string` | `''` | CSS class override |

### TagList

Display a list of tags as badges:

```svelte
<script lang="ts">
  import { TagList } from '@beeblock/svelar-tags/ui';
  import type { TagInputItem } from '@beeblock/svelar-tags';

  let tags: TagInputItem[] = [
    { id: 1, name: 'svelte', slug: 'svelte', type: null },
    { id: 2, name: 'typescript', slug: 'typescript', type: null },
  ];
</script>

<TagList
  {tags}
  removable={true}
  onremove={(tag) => console.log('Remove:', tag.name)}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `tags` | `TagInputItem[]` | required | Array of tags to display |
| `removable` | `boolean` | `false` | Show remove buttons on each badge |
| `onremove` | `(tag) => void` | `undefined` | Callback when a tag is removed |
| `class` | `string` | `''` | CSS class override |

---

## Migration SQL

The plugin requires two tables: `tags` and `taggables`. Use the exported `TAGS_MIGRATION_SQL` constant:

```ts
import { TAGS_MIGRATION_SQL } from '@beeblock/svelar-tags';

// Up migration
for (const sql of TAGS_MIGRATION_SQL.up) {
  await connection.raw(sql);
}

// Down migration (rollback)
for (const sql of TAGS_MIGRATION_SQL.down) {
  await connection.raw(sql);
}
```

---

## Full Working Example

```ts
// src/lib/models/Post.ts
import { Model } from '@beeblock/svelar/orm';
import { HasTags } from '@beeblock/svelar-tags';

export class Post extends HasTags(Model) {
  static table = 'posts';
  static fillable = ['title', 'content', 'slug'];
}
```

```ts
// src/routes/api/tags/+server.ts
import { TagController } from '@beeblock/svelar-tags/server';

export const GET = async (event) => TagController.index(event);
export const POST = async (event) => TagController.store(event);
```

```ts
// src/routes/api/tags/[id]/+server.ts
import { TagController } from '@beeblock/svelar-tags/server';

export const GET = async (event) => TagController.show(event, Number(event.params.id));
export const PUT = async (event) => TagController.update(event, Number(event.params.id));
export const DELETE = async (event) => TagController.destroy(event, Number(event.params.id));
```

```ts
// src/routes/posts/[id]/+page.server.ts
import { Post } from '$lib/models/Post';

export async function load({ params }) {
  const post = await Post.findOrFail(Number(params.id));
  const tags = await post.tags();
  return { post: post.toJSON(), tags };
}

export const actions = {
  updateTags: async ({ request, params }) => {
    const formData = await request.formData();
    const tagNames = JSON.parse(formData.get('tags') as string);

    const post = await Post.findOrFail(Number(params.id));
    await post.syncTags(tagNames);

    return { success: true };
  },
};
```

```svelte
<!-- src/routes/posts/[id]/+page.svelte -->
<script lang="ts">
  import { TagInput, TagList } from '@beeblock/svelar-tags/ui';
  import type { TagInputItem } from '@beeblock/svelar-tags';

  interface Props {
    data: { post: any; tags: any[] };
  }
  let { data }: Props = $props();

  let selectedTags = $state<TagInputItem[]>(
    data.tags.map((t) => ({ id: t.id, name: t.name, slug: t.slug, type: t.type }))
  );

  async function saveTags() {
    const form = new FormData();
    form.set('tags', JSON.stringify(selectedTags.map((t) => t.name)));
    await fetch(`/posts/${data.post.id}?/updateTags`, {
      method: 'POST',
      body: form,
    });
  }
</script>

<h1>{data.post.title}</h1>

<h3>Tags</h3>
<TagInput
  value={selectedTags}
  onchange={(tags) => { selectedTags = tags; saveTags(); }}
  suggestUrl="/api/tags?search="
  allowCreate={true}
  placeholder="Add tags..."
/>

<h3>Current Tags</h3>
<TagList tags={selectedTags} />
```
