# Tags Plugin

A polymorphic tagging plugin for Svelar/SvelteKit with typed tags, automatic slug generation, tag merging, popularity ranking, and pre-built UI components for tag input, display, and management. Inspired by Spatie's Laravel Tags package.

**Package:** `@beeblock/svelar-tags`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-tags
```

**Imports:**

```ts
// Server-only plugin registration
import SvelarTagsPlugin from '@beeblock/svelar-tags/plugin';

// Server-only models, service, mixin, controller, and gate names
import { Tag, TagService, HasTags, TagController, tagAbilities } from '@beeblock/svelar-tags/server';

// Public utility and shared validation contracts
import { slugify } from '@beeblock/svelar-tags';
import { tagCreateSchema, tagRelationSyncSchema, tagTargetSchema } from '@beeblock/svelar-tags/schemas';

// UI components
import { TagInput, TagBadge, TagList } from '@beeblock/svelar-tags/ui';

// Types
import type { TagRecord, TaggableId, TagCreateOptions, TagWithCount, TagsPluginConfig, TagInputItem } from '@beeblock/svelar-tags';
import type { HasTagsInstance } from '@beeblock/svelar-tags';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import SvelarTagsPlugin from '@beeblock/svelar-tags/plugin';

export const tagsPlugin = new SvelarTagsPlugin({
  prefix: '/api',
  slugSeparator: '-',
});
```

Pass this instance to your application's plugin manager with `plugins.use(tagsPlugin)`, or enable the plugin through your configured plugin bootstrap. The public package barrel contains utilities and types; `Tag`, `TagService`, `HasTags`, controllers, and the plugin class belong in server-only code. The named `SvelarTagsPlugin` export also remains available from `/server`.

### 2. Run the Migration

```bash
npx svelar plugin:publish @beeblock/svelar-tags
npx svelar migrate
```

The plugin publishes separate Svelar `Migration` classes to `src/lib/database/migrations/00000000_000101_create_tags_table.ts` and `00000000_000102_create_taggables_table.ts`. Run them through Svelar's migrator; table creation does not belong in routes, services, or application bootstrap. MySQL requires the collation described in [Migration SQL](#migration-sql).

### 3. Add Tags to a Model

```ts
import { Model } from '@beeblock/svelar/orm';
import { HasTags } from '@beeblock/svelar-tags/server';

class Post extends HasTags(Model) {
  static table = 'posts';
}

const post = await Post.findOrFail(1);
await post.attachTags(['typescript', 'svelte', 'sveltekit']);
await post.syncTagsOfType('category', ['tutorial', 'guide']);
```

---

## Configuration

The `SvelarTagsPlugin` constructor accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | `'/api'` | Local absolute API prefix; controls registered routes and the published collection route path |
| `slugSeparator` | `'-'` | `'-'` | Stored tag slugs use a canonical hyphen; other constructor values are rejected |

---

## Core API

### Tag Class

`Tag` extends Svelar `Model`. Its helpers persist through the ORM and return model instances:

```ts
import { Tag } from '@beeblock/svelar-tags/server';
```

| Method | Returns | Description |
|---|---|---|
| `Tag.findById(id)` | `Promise<Tag \| null>` | Find a numeric tag ID |
| `Tag.findByName(name, type?)` | `Promise<Tag \| null>` | Find by name (auto-slugified) |
| `Tag.findBySlug(slug, type?)` | `Promise<Tag \| null>` | Find by slug |
| `Tag.findOrCreate(name, type?)` | `Promise<Tag>` | Find existing or create new |
| `Tag.create(attributes)` | `Promise<Tag>` | Create from `{ name, type?, order_column? }` |
| `Tag.create(name, type?, orderColumn?)` | `Promise<Tag>` | Retained string-based creation helper |
| `Tag.all()` | `Promise<Tag[]>` | Get model instances; use `TagService.all()` for ordered records |
| `Tag.ofType(type)` | `Promise<Tag[]>` | Get model instances ordered by order_column, name |
| `Tag.update(id, data)` | `Promise<Tag \| null>` | Update a tag (name, type, order_column) |
| `Tag.delete(id)` | `Promise<void>` | Delete a tag by ID |
| `Tag.usageCount(id)` | `Promise<number>` | Count models using this tag |

### TagService

Higher-level operations beyond basic CRUD:

```ts
import { TagService } from '@beeblock/svelar-tags/server';
```

| Method | Returns | Description |
|---|---|---|
| `TagService.all()` | `Promise<TagRecord[]>` | Get tags ordered by order_column, name |
| `TagService.ofType(type)` | `Promise<TagRecord[]>` | Get tags of a type |
| `TagService.popular(limit?)` | `Promise<TagWithCount[]>` | Get most-used tags with `usage_count` |
| `TagService.rename(oldName, newName, type?)` | `Promise<TagRecord \| null>` | Rename a tag (updates slug) |
| `TagService.merge(sourceNames, targetName, type?)` | `Promise<TagRecord>` | Merge multiple tags into one (reassigns relationships) |
| `TagService.deleteUnused()` | `Promise<number>` | Delete tags not attached to any model |
| `TagService.search(query, type?, limit?)` | `Promise<TagRecord[]>` | Search tags by name (partial match, LIKE) |

`TagService.attach(taggableType, taggableId, names, type?)`, `detach(...)`, and `sync(...)` provide the same relationship operations used by `HasTags`. `taggableId` accepts `string | number`; the service does not authorize a host model for its caller. Use it behind your authorized FormRequest/DTO/action flow. Attach, sync, and merge run in transactions, and persistence failures propagate instead of being treated as duplicate attachments.

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
import { HasTags } from '@beeblock/svelar-tags/server';

class Article extends HasTags(Model) {
  static table = 'articles';
}
```

The mixin reads the host key with `getAttribute(ctor.primaryKey)`. It supports safe integer, UUID, ULID, and other non-empty string keys up to 255 characters, including custom primary-key column names. Numbers are stored as canonical decimal strings in `taggables.taggable_id`; string keys retain their case, leading zeros, Unicode, and significant spaces. Tag row IDs and `taggables.tag_id` remain numeric. Do not convert a UUID, ULID, or numeric-looking string key with `Number()`.

For a generated UUID on a custom key column:

```ts
import { Model, HasUuids } from '@beeblock/svelar/orm';
import { HasTags } from '@beeblock/svelar-tags/server';

class UuidArticle extends HasTags(HasUuids(Model)) {
  static table = 'articles';
  static primaryKey = 'article_uuid';
  static uniqueIds = ['article_uuid'];
  static fillable = ['article_uuid', 'title'];
}

// The app's migration declares article_uuid as its UUID primary key.
const article = await UuidArticle.findOrFail(articleUuid);
await article.attachTag('svelte');
```

`HasUlids` follows the same pattern with an app-owned ULID column. A missing, fractional, or unsafe numeric key is rejected before tags are created.

**Instance methods:**

| Method | Returns | Description |
|---|---|---|
| `attachTag(name, type?)` | `Promise<void>` | Attach a single tag (creates if needed) |
| `attachTags(names, type?)` | `Promise<void>` | Attach multiple tags |
| `detachTag(name, type?)` | `Promise<void>` | Detach a single tag |
| `detachTags(names, type?)` | `Promise<void>` | Detach multiple tags |
| `syncTags(names, type?)` | `Promise<void>` | Replace all tags, or only the supplied type; `[]` clears that selection |
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

Without a type argument, these query helpers match untyped tags. Duplicate normalized names do not increase the requirement for `withAllTags`; an empty list matches no models for `withAnyTags` and leaves the model query unchanged for `withAllTags` and `withoutTags`.

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

`TagController` extends Svelar `Controller`; its instance handlers run shared-schema FormRequests, DTOs, actions/services, ORM persistence, and resources. Static compatibility methods remain available. The following bindings are the controller layer; add your application's reviewed capability guard in the route or hook layer as described below.

```ts
// src/routes/api/tags/+server.ts
import { TagController } from '@beeblock/svelar-tags/server';

const controller = new TagController();
export const GET = controller.handle('index');
export const POST = controller.handle('store');
```

```ts
// src/routes/api/tags/[id]/+server.ts
import { TagController } from '@beeblock/svelar-tags/server';

const controller = new TagController();
export const GET = controller.handle('show');
export const PUT = controller.handle('update');
export const PATCH = controller.handle('update');
export const DELETE = controller.handle('destroy');
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
| `PATCH` | `/api/tags/:id` | `update` | Partially update a tag |
| `DELETE` | `/api/tags/:id` | `destroy` | Delete a tag |
| `GET` | `/api/tags/popular` | `popular` | Get popular tags (query param: `limit`) |
| `POST` | `/api/tags/merge` | `merge` | Merge tags (`{ sources: string[], target: string, type? }`) |
| `DELETE` | `/api/tags/unused` | `deleteUnused` | Delete unused tags |
| `POST` | `/api/tags/attach` | `attach` | Attach tags (`{ tags, type?, taggable_type, taggable_id }`) |
| `POST` | `/api/tags/detach` | `detach` | Detach tags (same body as attach) |
| `POST` | `/api/tags/sync` | `sync` | Sync tags (same body as attach) |

The `:id` routes refer to numeric **tag** IDs. Relationship request bodies use `taggable_type: string` and `taggable_id: string | number` for the host model. Attach/detach require 1–100 tag names; sync accepts 0–100, so `{ tags: [], taggable_type, taggable_id }` can clear a model's tags. Names must produce a non-empty slug and fit 255 characters; a tag update must contain at least one supported field. HTTP `limit` is an integer from 1 to 100, with defaults of 100 for the list and 10 for popularity.

Success responses use resource envelopes such as `{ data: tag }`, `{ data: tags, meta: { total, limit }, total }`, and `{ data: { message } }` for relationship operations. Validation errors return 422 with field errors, duplicate create/update returns 409, and internal error details are not sent to the browser.

**Application authorization and CSRF:**

The app must establish the authenticated user and register its literal capability manifest, route bindings, and seeded catalogs/profiles. The plugin does not grant capabilities or seed roles. Define the action-specific Gate abilities below, including host policy/ownership checks for relationship targets; absent grants fail closed.

| Controller methods | Gate ability | Subject supplied to the gate |
|---|---|---|
| `index`, `popular` | `tags.viewAny` | No model |
| `show` | `tags.view` | Persisted `Tag` model |
| `store` | `tags.create` | No model |
| `update` | `tags.update` | Persisted `Tag` model |
| `destroy` | `tags.delete` | Persisted `Tag` model |
| `merge` | `tags.merge` | No model |
| `deleteUnused` | `tags.deleteUnused` | No model |
| `attach`, `detach`, `sync` | `tags.attach`, `tags.detach`, `tags.sync` | Exact `{ taggable_type, taggable_id }` target |

Gate callbacks also receive the request event after the subject. Catalog operations act on the plugin's tag catalog; decide their visibility and management access in the host app. A relationship gate must allow only known host types, resolve the host using its actual primary key, and authorize that model. For example, in your server bootstrap after defining your post policy/gate:

```ts
import { Gate } from '@beeblock/svelar/auth';
import { tagAbilities } from '@beeblock/svelar-tags/server';
import { tagTargetSchema } from '@beeblock/svelar-tags/schemas';
import { Post } from '$lib/models/Post.js';

Gate.define(tagAbilities.sync, async (user, target, event) => {
  const parsed = tagTargetSchema.safeParse(target);
  if (!parsed.success || parsed.data.taggable_type !== Post.tableName) return false;
  const post = await Post.find(parsed.data.taggable_id);
  return post !== null && await Gate.allows('posts.update', user, post, event);
});
```

Bind the functional capability through your app-owned authorizer and trusted principal resolver. These imports represent application code that must be configured and seeded, not exports supplied by the tags package:

```ts
// src/routes/api/tags/sync/+server.ts
import { TagController } from '@beeblock/svelar-tags/server';
import { capabilities, resolvePrincipal } from '$lib/shared/authorization.js';

const controller = new TagController();
export const POST = capabilities.guardEndpoint(
  'posts.tags.update',
  controller.handle('sync'),
  resolvePrincipal,
);
```

Use equivalent capability bindings for other exposed routes, including routes registered by the plugin. The controller rejects anonymous requests with 401 and requests marked `authenticatedVia === 'bearer'` with 403. Bearer support requires a separate app-owned endpoint with verified credential ceilings and the same validated, policy-checked service flow; a capability wrapper does not enable bearer access to this controller.

Session mutations require the default `XSRF-TOKEN` cookie and `X-CSRF-Token` header (or the `_csrf` field); a missing/mismatched token returns 419. Svelar's same-origin `apiFetch`/`apiFetchJson` helpers attach the browser token. Keep the app's authentication, origin, and CSRF protections enabled.

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
| `label` | `string` | `'Tags'` | Accessible combobox label |
| `class` | `string` | `''` | CSS class override |

`value` can also use `bind:value`. The `label` prop defaults to `'Tags'` and labels the combobox. Suggestion requests are cancelled when superseded or closed, loading/failure feedback is shown inline, and Tab keeps normal focus navigation. Inline creation adds a temporary item with a negative tag ID; persist tag names through the authorized server flow before treating it as a stored tag. These temporary IDs are unrelated to host `taggable_id` values.

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

The supported installation path uses the two published Svelar migrations. `TAGS_MIGRATION_SQL` remains exported for legacy SQLite compatibility; it is not a PostgreSQL/MySQL migration contract and should not be executed from runtime code.

| Table/column | Stored contract |
|---|---|
| `tags.id` | Numeric primary key |
| `tags.type` | Nullable tag category |
| `tags.type_key` | Hidden normalized category key (`''` for null), unique with `slug` so untyped tags cannot duplicate a slug |
| `taggables.tag_id` | Numeric foreign key matching `tags.id`, with cascade deletion |
| `taggables.taggable_type` | Exact host type, `VARCHAR(255)` |
| `taggables.taggable_id` | Canonical host key text, `VARCHAR(255)` |

The relationship primary key is `(tag_id, taggable_type, taggable_id)`. Both morph fields preserve exact case and significant spaces. Query helpers compare the host's native key to stored text using dialect-specific casts; normal reads and writes use the Svelar ORM.

**MySQL compatibility:** The migration checks for `utf8mb4_0900_bin` before creating `taggables`, then sets both `taggable_type` and `taggable_id` to that UTF-8, binary, NO PAD collation. Reads/deletes and query scopes use exact binary comparisons too. MySQL 5 and MariaDB are rejected rather than silently aliasing case-distinct or trailing-space-distinct identities. App-owned string host key columns must also support their intended Unicode/case/space contract; the plugin does not alter host tables or database defaults.

**Existing alpha installs:** These revised files are fresh-install migrations. An app that already ran an older migration needs new, reviewed app-owned migrations; republishing an edited file does not rerun an applied migration. Preserve existing tag relationships while converting morph keys to text, add/backfill `type_key`, resolve duplicate untyped slugs before adding uniqueness, and apply exact MySQL collations to both morph columns. Match every numeric `tag_id` foreign key to the actual `tags.id` width and signedness: an older `increments()`/`INT UNSIGNED` primary key cannot use a `BIGINT UNSIGNED` foreign key. Host primary keys keep their app-owned integer/UUID/ULID definitions; `taggable_id` is polymorphic text, not a numeric foreign key to every host table. Verify the migration and application authorization with the app's real database before upgrading.

---

## Full Working Example

```ts
// src/lib/models/Post.ts
import { Model } from '@beeblock/svelar/orm';
import { HasTags } from '@beeblock/svelar-tags/server';

export class Post extends HasTags(Model) {
  static table = 'posts';
  static fillable = ['title', 'content', 'slug'];
}
```

```ts
// src/routes/api/tags/+server.ts
import { TagController } from '@beeblock/svelar-tags/server';

const controller = new TagController();
export const GET = controller.handle('index');
export const POST = controller.handle('store');
```

```ts
// src/routes/api/tags/[id]/+server.ts
import { TagController } from '@beeblock/svelar-tags/server';

const controller = new TagController();
export const GET = controller.handle('show');
export const PUT = controller.handle('update');
export const DELETE = controller.handle('destroy');
```

```ts
// src/routes/posts/[id]/+page.server.ts
import { error } from '@sveltejs/kit';
import { Gate } from '@beeblock/svelar/auth';
import { Post } from '$lib/models/Post.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const user = event.locals.user;
  if (!user) error(401, 'Unauthenticated');
  const post = await Post.findOrFail(event.params.id);
  if (!await Gate.allows('posts.view', user, post, event)) error(403, 'Forbidden');
  const tags = await post.tags();
  return {
    post: post.toJSON(), tags,
    taggableType: Post.tableName,
    taggableId: post._taggableId,
  };
};
```

The page sends writes to the capability-bound `/api/tags/sync` controller route shown above. Define the `posts.view` and `posts.update` policy/gates and the tag catalog gates in your app bootstrap, and bind the page route to its reviewed capability. For generated Superforms, import the same `/schemas` contracts used by the plugin FormRequests.

```svelte
<!-- src/routes/posts/[id]/+page.svelte -->
<script lang="ts">
  import { TagInput, TagList } from '@beeblock/svelar-tags/ui';
  import { apiFetchJson } from '@beeblock/svelar/http';
  import { untrack } from 'svelte';
  import type { TagInputItem, TaggableId } from '@beeblock/svelar-tags';

  interface Props {
    data: { post: { title: string }; tags: TagInputItem[]; taggableType: string; taggableId: TaggableId };
  }
  let { data }: Props = $props();

  let selectedTags = $state<TagInputItem[]>(
    untrack(() => data.tags.map((t) => ({ id: t.id, name: t.name, slug: t.slug, type: t.type })))
  );
  let saving = $state(false);
  let feedback = $state('');
  let fieldErrors = $state<Record<string, string[]>>({});

  async function saveTags() {
    if (saving) return;
    saving = true;
    const result = await apiFetchJson<{ data: { message: string } }>('/api/tags/sync', {
      method: 'POST', showToast: false,
      body: JSON.stringify({
        tags: selectedTags.map((tag) => tag.name),
        taggable_type: data.taggableType,
        taggable_id: data.taggableId,
      }),
    });
    fieldErrors = result.error?.errors ?? {};
    feedback = result.ok ? 'Tags saved.' : (result.error?.message ?? 'Unable to save tags.');
    saving = false;
  }
</script>

<h1>{data.post.title}</h1>

<h3>Tags</h3>
<fieldset disabled={saving}>
  <legend>Edit tags</legend>
  <TagInput
    value={selectedTags}
    onchange={(tags) => { selectedTags = tags; }}
    suggestUrl="/api/tags"
    allowCreate={true}
    placeholder="Add tags..."
  />
  {#each Object.values(fieldErrors).flat() as message}
    <p>{message}</p>
  {/each}
  <button type="button" onclick={saveTags}>{saving ? 'Saving…' : 'Save tags'}</button>
</fieldset>
<p role="status">{feedback}</p>

<h3>Current Tags</h3>
<TagList tags={selectedTags} />
```
