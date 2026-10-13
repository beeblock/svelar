# Comments Plugin

A polymorphic commenting system for Svelar/SvelteKit with nested replies, reactions, @mentions, formatting, pagination, and pre-built UI components. Attach comments to any model with the `HasComments` mixin.

**Package:** `@beeblock/svelar-comments`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-comments
```

**Imports:**

```ts
// Server-only plugin registration
import SvelarCommentsPlugin from '@beeblock/svelar-comments/plugin';

// Server API
import {
  CommentService,
  HasComments,
  configureCommentService,
  CommentController,
} from '@beeblock/svelar-comments/server';

// Client-safe text helpers
import {
  parseMentions,
  parseMentionsWithPositions,
  parseFormattedBody,
  formatRelativeTime,
  REACTION_TYPES,
} from '@beeblock/svelar-comments';

// UI components
import { CommentSection, CommentItem, CommentForm, CommentReactions } from '@beeblock/svelar-comments/ui';

// Types
import type {
  CommentRecord,
  CommentableKey,
  CommentUserKey,
  CommentWithReplies,
  ReactionType,
  GetCommentsOptions,
  PaginatedComments,
  CommentsPluginConfig,
  CommentClassNames,
} from '@beeblock/svelar-comments';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins/comments.server.ts
import SvelarCommentsPlugin from '@beeblock/svelar-comments/plugin';
import { CommentService, configureCommentService } from '@beeblock/svelar-comments/server';
import type { CommentsPluginConfig } from '@beeblock/svelar-comments/types';
import { authorizeComments } from '$lib/plugins/comments-access.server';

export const commentsOptions: CommentsPluginConfig = {
  maxDepth: 3,
  maxBodyLength: 10000,
  minBodyLength: 1,
  allowReactions: true,
  reactionTypes: ['like', 'love', 'laugh', 'sad', 'angry'],
  userTable: 'users',
  userColumns: ['id', 'name'],
  userPrimaryKey: 'id',
  authorize: authorizeComments,
};

export const commentsPlugin = new SvelarCommentsPlugin(commentsOptions);
configureCommentService(new CommentService(commentsOptions));
```

Register `commentsPlugin` through your application's plugin bootstrap. `authorizeComments` is an application-owned callback: implement the endpoint capability checks and the policies for the model being commented on before enabling the routes. Its contract is described below. Configure the shared service in the common server bootstrap so the mixin uses the same limits, connection, and user lookup settings as the HTTP controller.

### 2. Add to Your Model

```ts
import { Model } from '@beeblock/svelar/orm';
import { HasComments } from '@beeblock/svelar-comments/server';

class Post extends HasComments(Model) {
  static table = 'posts';
}

// Add a comment
const post = await Post.findOrFail(1);
const userId = currentUser.getAttribute((currentUser.constructor as typeof Model).primaryKey);
const comment = await post.addComment({
  body: 'Great post! @alice have you seen this?',
  userId,
});

// Reply to a comment
await post.addComment({
  body: 'Thanks! I agree.',
  userId,
  parentId: comment.id,
});

// Get comments with pagination
const result = await post.comments({
  page: 1,
  perPage: 20,
  sort: 'newest',
  withReplies: true,
  withUser: true,
  withReactions: true,
});

// Get total comment count
const count = await post.commentsCount();
```

The mixin reads the resource key with `getAttribute(ModelClass.primaryKey)`, so integer, UUID, ULID, and custom primary-key column names work. For example, a model with `static primaryKey = 'post_uuid'` uses that attribute without converting it to a number. The authenticated user in this server example is a resolved Svelar `Model`; string user keys also require the storage configuration below.

### Identifier Contract

`commentableId` accepts `string | number`. The polymorphic `commentable_id` column stores a canonical string of at most 255 characters: numeric `1` becomes `'1'`, while UUIDs, ULIDs, case, and trailing spaces remain intact. `'1'` and `'01'` identify different resources. Resource types and keys are compared exactly, including under MySQL's usual case-insensitive collations.

Numeric inputs must be positive safe integers; string keys must be nonblank and at most 255 characters.

`userId` accepts `string | number` subject to the configured user-key storage. Comment and reaction row IDs, `comment_id`, and `parent_id` remain positive numeric internal IDs. A reply's parent must belong to the same resource and stay within `maxDepth`.

---

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | `'/api'` | API route prefix |
| `maxDepth` | `number` | `3` | Maximum nesting depth for replies |
| `maxBodyLength` | `number` | `10000` | Maximum comment body length |
| `minBodyLength` | `number` | `1` | Minimum comment body length |
| `allowReactions` | `boolean` | `true` | Enable comment reactions |
| `reactionTypes` | `ReactionType[]` | `['like', 'love', 'laugh', 'sad', 'angry']` | Allowed reaction types |
| `userTable` | `string` | `'users'` | Table name for user lookups |
| `userColumns` | `string[]` | Primary-key column and `'name'` | Explicit public columns to fetch for user info; defaults to `['id', 'name']` |
| `userPrimaryKey` | `string` | `'id'` | Host-user key column used for projections |
| `userKeyType` | `'integer' \| 'string'` | Value of `COMMENTS_USER_KEY_TYPE`, otherwise `'integer'` | Must match the environment setting and both migrated `user_id` columns |
| `connection` | `string` | Core default connection | Named Svelar ORM connection |
| `authorize` | Callback | Unset: HTTP access denied | Application capability and resource policy checks |

### User-Key Storage

The default is integer storage for **both** `comments.user_id` and `comment_reactions.user_id`:

```dotenv
# .env and .env.example
COMMENTS_USER_KEY_TYPE=integer
```

For a host user model with a UUID, ULID, or other string primary key, configure the environment before running the published migrations:

```dotenv
COMMENTS_USER_KEY_TYPE=string
```

Use matching runtime options. For a user model mapped to `accounts.account_uuid`, for example:

```ts
const stringUserOptions: CommentsPluginConfig = {
  ...commentsOptions,
  userKeyType: 'string',
  userTable: 'accounts',
  userPrimaryKey: 'account_uuid',
  userColumns: ['account_uuid', 'name'],
};
```

Pass the same options to the plugin, controller, and shared `CommentService`. String mode publishes `VARCHAR(255)` user-key columns and preserves string actor keys. An explicit `userKeyType` that disagrees with `COMMENTS_USER_KEY_TYPE` fails configuration. With integer storage, a UUID/ULID actor key fails validation before a write; changing `userPrimaryKey` alone does not enable string storage.

Existing installations need a focused application migration converting **both** user-key columns before switching storage mode. Changing the environment does not alter existing tables. Existing integer `commentable_id` columns also need an application migration to the canonical string representation.

The published migrations add no foreign key to the host user table. If your application adds one, review the actual host primary-key SQL type, size, signedness, character set, and collation, and migrate both referencing columns accordingly. A `VARCHAR` column cannot blindly reference a native PostgreSQL `UUID` or an integer/`BIGINT` key; an unsigned MySQL key also needs compatible referencing columns. The user-key option controls the published storage templates and does not create or reconcile host-user foreign keys.

---

## Core API

### CommentService

The main service for comment operations:

```ts
import { CommentService } from '@beeblock/svelar-comments/server';

const service = new CommentService(config);

// Create a comment
const comment = await service.create({
  commentableType: 'posts',
  commentableId: 1,
  userId: 42,
  body: 'Hello world!',
  parentId: null,        // null for top-level, comment ID for reply
});

// Update a comment
const updated = await service.update(commentId, { body: 'Updated text' });

// Delete a comment (and all replies)
await service.delete(commentId);

// Find by ID
const found = await service.findById(commentId);

// Get comments for a model
const result = await service.getForModel('posts', 1, {
  page: 1,
  perPage: 20,
  sort: 'newest',
  withReplies: true,
  withUser: true,
  withReactions: true,
  viewerUserId: userId,  // trusted actor; adds each comment's userReactions
});

// Get replies for a comment
const replies = await service.getReplies(commentId, {
  withUser: true,
  withReactions: true,
});

// Count
const total = await service.countForModel('posts', 1);
const topLevel = await service.countTopLevel('posts', 1);
```

`CommentService` and `HasComments` are trusted server APIs. Application actions must authorize direct calls and obtain `userId` from the resolved user. For HTTP requests, use `CommentController` so request bodies cannot choose the actor. `getForModel()` returns a flat `PaginatedComments` result (`data`, `total`, `page`, `perPage`, `lastPage`); HTTP listing responses put the pagination fields under `meta`.

### Reactions

```ts
// Toggle a reaction (adds if not present, removes if present)
await service.react(commentId, userId, 'like');

// Remove a specific reaction
await service.unreact(commentId, userId, 'like');

// Get reaction summary for a comment
const summary = await service.getReactions(commentId);
// => { like: 5, love: 2 }

// Get current user's reactions
const userReactions = await service.getUserReactions(commentId, userId);
// => ['like']
```

### Text Processing Helpers

```ts
import {
  parseMentions,
  parseMentionsWithPositions,
  parseFormattedBody,
  formatRelativeTime,
} from '@beeblock/svelar-comments';

// Extract @mentions
const mentions = parseMentions('Hey @alice and @bob!');
// => ['alice', 'bob']

// Extract mentions with positions
const detailed = parseMentionsWithPositions('Hello @alice!');
// => [{ username: 'alice', startIndex: 6, endIndex: 12 }]

// Parse formatting (bold, italic, links, mentions, newlines)
const html = parseFormattedBody('**Bold** and *italic* with @user');
// => '<strong>Bold</strong> and <em>italic</em> with <span class="comment-mention">@user</span>'

// Relative time formatting
const relTime = formatRelativeTime('2026-03-31T10:00:00Z');
// Relative to the current time, for example '1d ago'
```

**Supported formatting:**

- `**bold**` renders as `<strong>bold</strong>`
- `*italic*` renders as `<em>italic</em>`
- `[text](https://example.com)` renders as a clickable link; links use HTTP or HTTPS
- Bare URLs are auto-linked
- `@username` renders as highlighted mentions
- Newlines convert to `<br>`

---

## Server-Side

### CommentController

Handles all comment API routes. Can be used as a static handler or as instances:

```ts
// src/routes/api/comments/[...path]/+server.ts
import { CommentController } from '@beeblock/svelar-comments/server';
import { commentsOptions } from '$lib/plugins/comments.server';
import type { RequestHandler } from './$types';

const handle: RequestHandler = (event) => CommentController.handle(event, commentsOptions);
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
```

### Authorization and Request Safety

The controller requires a resolved authenticated user and an `authorize` callback. The callback receives `(event, action, target?)`, where `action` is `list`, `create`, `update`, `delete`, `react`, `reactions`, or `count`. It first runs without a target to check the endpoint capability before body parsing, then runs with a resource target or existing comment to apply the host model policy. Return `true` only after the relevant checks succeed. Register literal application capabilities and synchronize their catalog/profile assignments through a seeder; the plugin cannot infer permission to read or comment on an arbitrary host model.

Missing or denying callbacks fail closed. Authentication, resource policies, author ownership for edits/deletes, shared-schema FormRequests, DTO/actions, ORM persistence, and CSRF remain enforced. The controller derives the actor from request-local auth (or trusted `locals.user`) using the user model's configured primary key. A caller-supplied `user_id` is ignored. UI `currentUserId` controls presentation and supplies no server authority.

Generic comments endpoints deny bearer/API-key access, including an `Authorization` header, even when an owner policy would otherwise allow it: they do not establish a credential capability ceiling. Cookie-authenticated mutations must pass Svelar CSRF validation. `CommentSection` attaches the token using core HTTP helpers, including with a custom `fetchFn`; custom standalone UI callbacks should use the CSRF-aware `apiFetch` helper.

The published route templates read the host callback from `event.locals.commentsAuthorize`. Set it in your server bootstrap/hooks, or bind the controller explicitly with the shared options shown above. Routes remain thin delegates to the controller. When using published routes with custom user-key/lookup options, bind those options explicitly as well; the templates only forward the authorization callback.

**API routes (handled automatically by `CommentController.handle()`):**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/comments?commentable_type=posts&commentable_id=1` | List comments |
| `POST` | `/api/comments` | Create a comment |
| `PUT` | `/api/comments/:id` | Update a comment |
| `PATCH` | `/api/comments/:id` | Update a comment |
| `DELETE` | `/api/comments/:id` | Delete a comment |
| `POST` | `/api/comments/:id/reactions` | Toggle a reaction |
| `DELETE` | `/api/comments/:id/reactions` | Remove a reaction |
| `GET` | `/api/comments/:id/reactions` | Get reactions |
| `GET` | `/api/comments/count?commentable_type=posts&commentable_id=1` | Count comments |

**Query parameters for listing:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | `number` | `1` | Page number |
| `per_page` | `number` | `20` | Items per page, from 1 to 100 |
| `sort` | `'newest' \| 'oldest'` | `'newest'` | Sort order |
| `with_replies` | `'true' \| 'false'` | `'true'` | Include nested replies |
| `with_user` | `'true' \| 'false'` | `'false'` | Include user data |
| `with_reactions` | `'true' \| 'false'` | `'false'` | Include reaction counts |

**Create comment body:**

```json
{
  "commentable_type": "posts",
  "commentable_id": 1,
  "body": "This is a comment!",
  "parent_id": null
}
```

`commentable_id` may also be a UUID, ULID, or another string key. `parent_id` is always a numeric comment row ID or `null`. Successful create/update responses wrap a `CommentRecord` in `{ data }`; listing returns `{ data: CommentWithReplies[], meta: { total, page, perPage, lastPage } }`. Reactions and counts also use `{ data }` envelopes. Ordinary validation failures include field errors with status 422.

---

## UI Components

### CommentSection

Complete comment section with form, list, pagination, and reactions:

```svelte
<script lang="ts">
  import { CommentSection } from '@beeblock/svelar-comments/ui';
</script>

<CommentSection
  commentableType="posts"
  commentableId={1}
  currentUserId={42}
  apiUrl="/api/comments"
/>
```

### CommentItem

Single comment with replies, edit/delete actions, and reactions:

```svelte
<script lang="ts">
  import { CommentItem } from '@beeblock/svelar-comments/ui';
</script>

<CommentItem
  comment={commentData}
  currentUserId={42}
  onreply={(parentId, body) => { /* handle reply */ }}
  onedit={(commentId, body) => { /* handle edit */ }}
  ondelete={(commentId) => { /* handle delete */ }}
/>
```

### CommentForm

Comment input form with shared-schema validation and inline error feedback:

```svelte
<script lang="ts">
  import { CommentForm } from '@beeblock/svelar-comments/ui';
</script>

<CommentForm
  onsubmit={(body) => { /* handle submit */ }}
  placeholder="Write a comment..."
/>
```

Use `initialBody` to prefill an edit and `maxLength` to match the configured body limit. Mentions can be entered as ordinary text and are highlighted by `CommentItem`.

### CommentReactions

Reaction buttons for a comment:

```svelte
<script lang="ts">
  import { CommentReactions } from '@beeblock/svelar-comments/ui';
</script>

<CommentReactions
  reactions={{ like: 5, love: 2 }}
  userReactions={['like']}
  onreact={(type) => { /* toggle this comment's reaction */ }}
/>
```

---

## Migrations

The plugin publishes two Svelar `Migration` classes under `src/lib/database/migrations`: `20261013000000_create_comments_table.ts` and `20261013000001_create_comment_reactions_table.ts`.

```bash
npx svelar plugin:publish @beeblock/svelar-comments
npx svelar migrate
```

`comments` stores the polymorphic type/key, actor, numeric parent, body, edit flag, and timestamps. `comment_reactions` references the numeric comment ID and has a unique `(comment_id, user_id, type)` index. Parent and reaction foreign keys cascade on deletion. Internal referencing keys match the unsigned MySQL incrementing comment key.

Both migrations use the core schema builder; services never create tables at runtime. The former SQLite SQL constant, `COMMENTS_MIGRATION_SQL`, is no longer exported.

### MySQL String Identity

MySQL migrations require `utf8mb4_0900_bin`, the MySQL 8 binary **NO PAD** collation, for polymorphic strings and string user keys. Availability is checked in `INFORMATION_SCHEMA.COLLATIONS` before creating the affected table; an unsupported older MySQL/MariaDB server fails with a descriptive error before table creation. The migrations use a narrow MySQL DDL exception because the schema builder has no column-collation modifier.

The NO PAD collation preserves unique reaction actor keys such as `'Case'`, `'case'`, and `'Case '`. `utf8mb4_bin` is PAD SPACE and cannot substitute for that uniqueness contract. Reads also retain indexed ORM equality and add bound `BINARY` predicates for exact resource type/key, string user projection, and reaction-actor comparison. Author ownership compares the full canonical key without case folding or trimming.

Older engines require application-owned migrations that provide equivalent exact case and trailing-space semantics. Existing tables also require explicit migration of their string-key columns and indexes; enabling the plugin does not retrofit their collation.

---

## Full Working Example

```ts
// src/routes/api/comments/[...path]/+server.ts
import { CommentController } from '@beeblock/svelar-comments/server';
import { commentsOptions } from '$lib/plugins/comments.server';
import type { RequestHandler } from './$types';

const handle: RequestHandler = (event) => CommentController.handle(event, commentsOptions);
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
```

```svelte
<!-- src/routes/posts/[id]/+page.svelte -->
<script lang="ts">
  import { CommentSection } from '@beeblock/svelar-comments/ui';
  import type { CommentableKey, CommentUserKey } from '@beeblock/svelar-comments/types';

  interface Props {
    data: { post: { id: CommentableKey; title: string; content: string }; currentUserId: CommentUserKey | null };
  }
  let { data }: Props = $props();
</script>

<article>
  <h1>{data.post.title}</h1>
  <div>{@html data.post.content}</div>
</article>

<CommentSection
  commentableType="posts"
  commentableId={data.post.id}
  currentUserId={data.currentUserId}
  apiUrl="/api/comments"
/>
```
