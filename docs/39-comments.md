# Comments Plugin

A polymorphic commenting system for Svelar/SvelteKit with nested replies, reactions, @mentions, formatting, pagination, and pre-built UI components. Attach comments to any model with the `HasComments` mixin.

**Package:** `@beeblock/svelar-comments`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-comments
```

**Imports:**

```ts
// Plugin registration
import { SvelarCommentsPlugin } from '@beeblock/svelar-comments/server';

// Core API
import {
  CommentService,
  HasComments,
  configureCommentService,
  parseMentions,
  parseMentionsWithPositions,
  parseFormattedBody,
  formatRelativeTime,
  COMMENTS_MIGRATION_SQL,
  REACTION_TYPES,
} from '@beeblock/svelar-comments';

// Server-side
import { CommentController } from '@beeblock/svelar-comments/server';

// UI components
import { CommentSection, CommentItem, CommentForm, CommentReactions } from '@beeblock/svelar-comments/ui';

// Types
import type {
  CommentRecord,
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
// src/lib/plugins.ts
import { SvelarCommentsPlugin } from '@beeblock/svelar-comments/server';

export const commentsPlugin = new SvelarCommentsPlugin({
  maxDepth: 3,
  maxBodyLength: 10000,
  minBodyLength: 1,
  allowReactions: true,
  reactionTypes: ['like', 'love', 'laugh', 'sad', 'angry'],
  userTable: 'users',
  userColumns: ['id', 'name', 'email'],
});
```

### 2. Add to Your Model

```ts
import { Model } from '@beeblock/svelar/orm';
import { HasComments } from '@beeblock/svelar-comments';

class Post extends HasComments(Model) {
  static table = 'posts';
}

// Add a comment
const post = await Post.find(1);
const comment = await post.addComment({
  body: 'Great post! @alice have you seen this?',
  userId: currentUser.id,
});

// Reply to a comment
await post.addComment({
  body: 'Thanks! I agree.',
  userId: currentUser.id,
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
| `userColumns` | `string[]` | `['id', 'name', 'email']` | Columns to fetch for user info |

---

## Core API

### CommentService

The main service for comment operations:

```ts
import { CommentService } from '@beeblock/svelar-comments';

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
const comment = await service.findById(commentId);

// Get comments for a model
const result = await service.getForModel('posts', 1, {
  page: 1,
  perPage: 20,
  sort: 'newest',
  withReplies: true,
  withUser: true,
  withReactions: true,
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
// => '1d ago'
```

**Supported formatting:**
- `**bold**` renders as `<strong>bold</strong>`
- `*italic*` renders as `<em>italic</em>`
- `[text](url)` renders as a clickable link
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

export const GET = async (event) => CommentController.handle(event);
export const POST = async (event) => CommentController.handle(event);
export const PUT = async (event) => CommentController.handle(event);
export const DELETE = async (event) => CommentController.handle(event);
```

**API routes (handled automatically by `CommentController.handle()`):**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/comments?commentable_type=posts&commentable_id=1` | List comments |
| `POST` | `/api/comments` | Create a comment |
| `PUT` | `/api/comments/:id` | Update a comment |
| `DELETE` | `/api/comments/:id` | Delete a comment |
| `POST` | `/api/comments/:id/reactions` | Toggle a reaction |
| `DELETE` | `/api/comments/:id/reactions` | Remove a reaction |
| `GET` | `/api/comments/:id/reactions` | Get reactions |
| `GET` | `/api/comments/count?commentable_type=posts&commentable_id=1` | Count comments |

**Query parameters for listing:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | `number` | `1` | Page number |
| `per_page` | `number` | `20` | Items per page |
| `sort` | `'newest' \| 'oldest'` | `'newest'` | Sort order |
| `with_replies` | `'true' \| 'false'` | `'true'` | Include nested replies |
| `with_user` | `'true' \| 'false'` | `'false'` | Include user data |
| `with_reactions` | `'true' \| 'false'` | `'false'` | Include reaction counts |

**Create comment body:**

```json
{
  "commentable_type": "posts",
  "commentable_id": 1,
  "user_id": 42,
  "body": "This is a comment!",
  "parent_id": null
}
```

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
  onReply={(parentId, body) => { /* handle reply */ }}
  onEdit={(commentId, body) => { /* handle edit */ }}
  onDelete={(commentId) => { /* handle delete */ }}
/>
```

### CommentForm

Comment input form with @mention support:

```svelte
<script lang="ts">
  import { CommentForm } from '@beeblock/svelar-comments/ui';
</script>

<CommentForm
  onSubmit={(body) => { /* handle submit */ }}
  placeholder="Write a comment..."
/>
```

### CommentReactions

Reaction buttons for a comment:

```svelte
<script lang="ts">
  import { CommentReactions } from '@beeblock/svelar-comments/ui';
</script>

<CommentReactions
  commentId={1}
  reactions={{ like: 5, love: 2 }}
  userReactions={['like']}
  onReact={(commentId, type) => { /* toggle reaction */ }}
/>
```

---

## Migration SQL

```sql
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commentable_type TEXT NOT NULL,
  commentable_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  parent_id INTEGER,
  body TEXT NOT NULL,
  is_edited INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_commentable
  ON comments (commentable_type, commentable_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_user
  ON comments (user_id);

CREATE TABLE IF NOT EXISTS comment_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT,
  UNIQUE(comment_id, user_id, type)
);

CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment
  ON comment_reactions (comment_id);
```

You can also access this SQL programmatically:

```ts
import { COMMENTS_MIGRATION_SQL } from '@beeblock/svelar-comments';

// COMMENTS_MIGRATION_SQL.up   — array of CREATE statements
// COMMENTS_MIGRATION_SQL.down — array of DROP statements
```

---

## Full Working Example

```ts
// src/routes/api/comments/[...path]/+server.ts
import { CommentController } from '@beeblock/svelar-comments/server';

export const GET = async (event) => CommentController.handle(event);
export const POST = async (event) => CommentController.handle(event);
export const PUT = async (event) => CommentController.handle(event);
export const DELETE = async (event) => CommentController.handle(event);
```

```svelte
<!-- src/routes/posts/[id]/+page.svelte -->
<script lang="ts">
  import { CommentSection } from '@beeblock/svelar-comments/ui';

  interface Props {
    data: { post: any; currentUserId: number };
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
