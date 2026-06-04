# Activity Log Plugin

A Spatie-inspired activity log plugin for Svelar/SvelteKit that records user actions, tracks model changes, and provides a timeline feed with filtering, pagination, and pre-built UI components.

**Package:** `@beeblock/svelar-activity-log`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-activity-log
```

**Imports:**

```ts
// Plugin registration
import { SvelarActivityLogPlugin } from '@beeblock/svelar-activity-log/server';

// Core API
import { Activity, ActivityLogger, activity, ActivityService, LogsActivity, setCauserResolver, getCauserResolver } from '@beeblock/svelar-activity-log';

// Server-side (controller)
import { ActivityController } from '@beeblock/svelar-activity-log/server';

// UI components
import { ActivityFeed, ActivityItem, ActivityFilters } from '@beeblock/svelar-activity-log/ui';

// Types
import type { ActivityRecord, ActivityData, ChangeProperties, ActivityFilterOptions, PaginatedActivities, ActivityLogPluginConfig, ActivityFeedItem, ActivityLogClassNames, LogsActivityConfig } from '@beeblock/svelar-activity-log';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import { SvelarActivityLogPlugin } from '@beeblock/svelar-activity-log/server';

export const activityLogPlugin = new SvelarActivityLogPlugin({
  prefix: '/api',
  defaultLogName: 'default',
  defaultCauserType: 'users',
  cleanupDays: 90,
  logOnlyDirty: true,
});
```

### 2. Run the Migration

```sql
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_name TEXT DEFAULT 'default',
  description TEXT NOT NULL,
  subject_type TEXT,
  subject_id INTEGER,
  causer_type TEXT DEFAULT 'users',
  causer_id INTEGER,
  properties TEXT DEFAULT '{}',
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_log_subject ON activity_log(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_causer ON activity_log(causer_type, causer_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_name ON activity_log(log_name);
```

You can also retrieve this SQL programmatically:

```ts
import { ActivityService } from '@beeblock/svelar-activity-log';

const sql = ActivityService.getMigrationSQL();
```

### 3. Log an Activity

```ts
import { activity } from '@beeblock/svelar-activity-log';

await activity()
  .causedBy(user)
  .performedOn(post)
  .withProperties({ ip: '192.168.1.1' })
  .log('updated');
```

---

## Configuration

The `SvelarActivityLogPlugin` constructor accepts the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | `'/api'` | API route prefix |
| `defaultLogName` | `string` | `'default'` | Default log name for entries |
| `defaultCauserType` | `string` | `'users'` | Default causer type string |
| `cleanupDays` | `number` | `90` | Delete activities older than N days during cleanup |
| `logOnlyDirty` | `boolean` | `true` | Only log attributes that actually changed |

---

## Core API

### ActivityLogger (Fluent Builder)

The primary way to log activities. Create one via the `activity()` factory function:

```ts
import { activity } from '@beeblock/svelar-activity-log';

// Basic usage
await activity().log('user signed in');

// Full fluent API
await activity('billing')
  .causedBy(user)           // or .causedBy(userId, 'admins')
  .performedOn(invoice)     // or .onSubject('invoices', 42)
  .withProperties({ amount: 99.99, currency: 'USD' })
  .causerType('admins')
  .useLog('billing')
  .log('invoice paid');
```

| Method | Returns | Description |
|---|---|---|
| `causedBy(causer, type?)` | `this` | Set who performed the action (model instance or numeric ID) |
| `performedOn(subject)` | `this` | Set what was acted upon (model instance or `{ type, id }`) |
| `onSubject(type, id)` | `this` | Set the subject by type string and ID directly |
| `withProperties(props)` | `this` | Attach arbitrary key-value metadata (merged with existing) |
| `causerType(type)` | `this` | Override the causer type string |
| `useLog(name)` | `this` | Override the log name |
| `log(description)` | `Promise<Activity>` | Persist the activity to the database |

### Activity Class

Wraps a database row into a structured, read-only object:

```ts
const entry = await activity().causedBy(user).log('created');

entry.id;             // number
entry.logName;        // string
entry.description;    // string
entry.subjectType;    // string | null
entry.subjectId;      // number | null
entry.causerType;     // string
entry.causerId;       // number | null
entry.properties;     // Record<string, any>
entry.createdAt;      // string (ISO)
```

**Instance methods:**

| Method | Returns | Description |
|---|---|---|
| `getChanges()` | `ChangeProperties` | Get `{ old, new }` change tracking data |
| `hasChanges()` | `boolean` | Check if this activity has old/new change data |
| `getProperty(key, fallback?)` | `any` | Get a specific property value |
| `toData()` | `ActivityData` | Convert to a plain serializable object |
| `toJSON()` | `ActivityData` | Alias for `toData()` |

**Static methods:**

| Method | Returns | Description |
|---|---|---|
| `Activity.fromRecord(record)` | `Activity` | Create from a database row |
| `Activity.fromRecords(records)` | `Activity[]` | Create multiple from database rows |

### ActivityService

Static service class for querying and managing activity logs:

```ts
import { ActivityService } from '@beeblock/svelar-activity-log';

// Fluent query builder
const activities = await ActivityService.query()
  .logName('billing')
  .forSubject('invoices', 42)
  .causedBy(1)
  .withDescription('paid')
  .since('2026-01-01')
  .until('2026-12-31')
  .latest()     // newest first (default)
  .limit(10)
  .get();

// Paginated results
const page = await ActivityService.query()
  .forSubject('posts')
  .paginate(1, 15);
// => { data: ActivityData[], total, page, perPage, lastPage, hasMore }

// Count matching activities
const count = await ActivityService.query()
  .logName('auth')
  .count();
```

**Convenience methods:**

| Method | Returns | Description |
|---|---|---|
| `ActivityService.query()` | `ActivityQueryBuilder` | Start a new fluent query |
| `ActivityService.forSubject(type, id, limit?)` | `Promise<Activity[]>` | Get activities for a subject |
| `ActivityService.forCauser(causerId, limit?)` | `Promise<Activity[]>` | Get activities by a causer |
| `ActivityService.latest(limit?)` | `Promise<Activity[]>` | Get the latest N activities (default 20) |
| `ActivityService.cleanOlderThan(days)` | `Promise<number>` | Delete old activities, returns count deleted |
| `ActivityService.deleteForSubject(type, id)` | `Promise<void>` | Delete all activities for a subject |
| `ActivityService.getMigrationSQL()` | `string` | Get the migration SQL |

**Query builder methods:**

| Method | Description |
|---|---|
| `.logName(name)` | Filter by log name |
| `.forSubject(type, id?)` | Filter by subject type and optionally ID |
| `.causedBy(causerId, causerType?)` | Filter by causer |
| `.withDescription(description)` | Filter by exact description match |
| `.since(date)` | Filter from a date (Date or ISO string) |
| `.until(date)` | Filter until a date |
| `.limit(n)` | Limit number of results |
| `.latest()` | Sort newest first (default) |
| `.oldest()` | Sort oldest first |
| `.get()` | Execute and return `Activity[]` |
| `.paginate(page, perPage)` | Execute and return `PaginatedActivities` |
| `.count()` | Execute and return count |

### LogsActivity Mixin

Automatically logs `created`, `updated`, and `deleted` events on any Model:

```ts
import { Model } from '@beeblock/svelar/orm';
import { LogsActivity } from '@beeblock/svelar-activity-log';

class Post extends LogsActivity(Model) {
  static table = 'posts';
  static fillable = ['title', 'content', 'published'];

  // Which attributes to track (empty = all fillable)
  static logAttributes: string[] = ['title', 'content', 'published'];

  // Activity log name (defaults to table name)
  static logName = 'posts';

  // Only log attributes that actually changed (default: true)
  static logOnlyDirty = true;

  // Attributes to exclude from logging (hidden fields are also excluded)
  static logExcept: string[] = [];
}
```

When a model with `LogsActivity` is created, updated, or deleted, an activity log entry is automatically inserted with the tracked attribute changes in the `properties` field:

- **Created**: `{ new: { title: '...', content: '...' } }`
- **Updated**: `{ old: { title: 'Old' }, new: { title: 'New' } }`
- **Deleted**: `{ old: { title: '...', content: '...' } }`

**Static methods on the mixed model:**

| Method | Description |
|---|---|
| `Post.disableLogging()` | Temporarily disable automatic logging |
| `Post.enableLogging()` | Re-enable automatic logging |
| `Post.withoutLogging(fn)` | Run an async callback with logging disabled |

### Causer Resolver

Set a global causer resolver so `LogsActivity` automatically knows who performed the action:

```ts
// In hooks.server.ts
import { setCauserResolver } from '@beeblock/svelar-activity-log';

setCauserResolver(() => {
  // Return the current authenticated user
  const user = getCurrentUser();
  return user ? { id: user.id, type: 'users' } : null;
});
```

---

## Server-Side

### ActivityController

Handles activity feed API routes with filtering and pagination:

```ts
// src/routes/api/activities/+server.ts
import { ActivityController } from '@beeblock/svelar-activity-log/server';

// Supports both GET (query params) and POST (JSON body)
export const GET = async (event) => ActivityController.handle(event);
export const POST = async (event) => ActivityController.handle(event);
```

```ts
// src/routes/api/activities/cleanup/+server.ts
import { ActivityController } from '@beeblock/svelar-activity-log/server';

export const POST = async (event) => ActivityController.handleCleanup(event);
```

**Query parameters / body fields:**

| Parameter | Type | Description |
|---|---|---|
| `log_name` | `string` | Filter by log name |
| `subject_type` | `string` | Filter by subject type |
| `subject_id` | `number` | Filter by subject ID |
| `causer_type` | `string` | Filter by causer type |
| `causer_id` | `number` | Filter by causer ID |
| `description` | `string` | Filter by description |
| `since` | `string` | Filter from date (ISO) |
| `until` | `string` | Filter until date (ISO) |
| `page` | `number` | Page number (default: 1) |
| `per_page` | `number` | Items per page (default: 15, max: 100) |
| `sort` | `'asc' \| 'desc'` | Sort direction |

---

## UI Components

### ActivityFeed

A timeline feed that displays activity entries with icons, relative timestamps, and expandable change details:

```svelte
<script lang="ts">
  import { ActivityFeed } from '@beeblock/svelar-activity-log/ui';
  import type { ActivityData, ActivityFilterOptions } from '@beeblock/svelar-activity-log';

  interface Props {
    data: { activities: ActivityData[] };
  }
  let { data }: Props = $props();
  let activities = $state(data.activities);
</script>

<ActivityFeed
  {activities}
  showFilters={true}
  showSubject={true}
  showCauser={true}
  showProperties={true}
  logNames={['default', 'auth', 'billing']}
  subjectTypes={['posts', 'users']}
  emptyText="No activity yet"
  hasMore={false}
  loading={false}
  onFilter={(filters) => console.log('Filter:', filters)}
  onLoadMore={() => console.log('Load more')}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `activities` | `ActivityData[]` | required | Array of activity data objects |
| `showFilters` | `boolean` | `false` | Show the filter panel |
| `showSubject` | `boolean` | `true` | Show subject type/ID in each entry |
| `showCauser` | `boolean` | `true` | Show causer type/ID in each entry |
| `showProperties` | `boolean` | `true` | Show properties and change details |
| `logNames` | `string[]` | `[]` | Available log names for the filter dropdown |
| `subjectTypes` | `string[]` | `[]` | Available subject types for the filter dropdown |
| `emptyText` | `string` | `'No activity yet'` | Text shown when there are no activities |
| `classNames` | `ActivityLogClassNames` | `{}` | CSS class overrides |
| `onFilter` | `(filters) => void` | `undefined` | Callback when filters are applied |
| `onLoadMore` | `() => void` | `undefined` | Callback for "Load more" button |
| `hasMore` | `boolean` | `false` | Whether more entries can be loaded |
| `loading` | `boolean` | `false` | Show loading spinner |

### ActivityItem

A single timeline entry with icon, description, causer, subject, and expandable change table:

```svelte
<script lang="ts">
  import { ActivityItem } from '@beeblock/svelar-activity-log/ui';
</script>

<ActivityItem
  activity={feedItem}
  showSubject={true}
  showCauser={true}
  showProperties={true}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `activity` | `ActivityFeedItem` | required | The activity feed item to display |
| `showSubject` | `boolean` | `true` | Show subject info |
| `showCauser` | `boolean` | `true` | Show causer info |
| `showProperties` | `boolean` | `true` | Show properties/changes |
| `classNames` | `ActivityLogClassNames` | `{}` | CSS class overrides |

### ActivityFilters

A filter panel with inputs for log name, subject type, causer ID, description, and date range:

```svelte
<script lang="ts">
  import { ActivityFilters } from '@beeblock/svelar-activity-log/ui';
</script>

<ActivityFilters
  onFilter={(filters) => console.log(filters)}
  logNames={['default', 'auth']}
  subjectTypes={['posts', 'users']}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `onFilter` | `(filters) => void` | required | Callback when filters are applied or cleared |
| `logNames` | `string[]` | `[]` | Log names for the dropdown (shows text input if empty) |
| `subjectTypes` | `string[]` | `[]` | Subject types for the dropdown |
| `classNames` | `ActivityLogClassNames` | `{}` | CSS class overrides |

---

## Full Working Example

```ts
// src/lib/models/Post.ts
import { Model } from '@beeblock/svelar/orm';
import { LogsActivity } from '@beeblock/svelar-activity-log';

export class Post extends LogsActivity(Model) {
  static table = 'posts';
  static fillable = ['title', 'content', 'published'];
  static logAttributes = ['title', 'content', 'published'];
  static logName = 'posts';
}
```

```ts
// src/hooks.server.ts
import { setCauserResolver } from '@beeblock/svelar-activity-log';

setCauserResolver(() => {
  // Your logic to get the current user
  return currentUser ? { id: currentUser.id, type: 'users' } : null;
});
```

```ts
// src/routes/api/activities/+server.ts
import { ActivityController } from '@beeblock/svelar-activity-log/server';

export const GET = async (event) => ActivityController.handle(event);
export const POST = async (event) => ActivityController.handle(event);
```

```ts
// src/routes/api/activities/cleanup/+server.ts
import { ActivityController } from '@beeblock/svelar-activity-log/server';

export const POST = async (event) => ActivityController.handleCleanup(event);
```

```ts
// src/routes/admin/activity/+page.server.ts
import { ActivityService } from '@beeblock/svelar-activity-log';

export async function load() {
  const result = await ActivityService.query()
    .latest()
    .paginate(1, 20);

  return { activities: result.data, total: result.total, hasMore: result.hasMore };
}
```

```svelte
<!-- src/routes/admin/activity/+page.svelte -->
<script lang="ts">
  import { ActivityFeed } from '@beeblock/svelar-activity-log/ui';
  import { apiFetch } from '@beeblock/svelar/http';
  import type { ActivityData, ActivityFilterOptions } from '@beeblock/svelar-activity-log';

  interface Props {
    data: { activities: ActivityData[]; total: number; hasMore: boolean };
  }
  let { data }: Props = $props();
  let activities = $state(data.activities);
  let hasMore = $state(data.hasMore);
  let page = $state(1);
  let loading = $state(false);

  async function handleFilter(filters: ActivityFilterOptions) {
    loading = true;
    const res = await apiFetch('/api/activities', {
      method: 'POST',
      body: JSON.stringify({ ...filters, page: 1, per_page: 20 }),
    });
    const result = await res.json();
    activities = result.data;
    hasMore = result.hasMore;
    page = 1;
    loading = false;
  }

  async function handleLoadMore() {
    loading = true;
    page += 1;
    const res = await apiFetch(`/api/activities?page=${page}&per_page=20`);
    const result = await res.json();
    activities = [...activities, ...result.data];
    hasMore = result.hasMore;
    loading = false;
  }
</script>

<h1>Activity Log</h1>

<ActivityFeed
  {activities}
  showFilters={true}
  logNames={['default', 'auth', 'posts', 'billing']}
  subjectTypes={['posts', 'users', 'invoices']}
  onFilter={handleFilter}
  onLoadMore={handleLoadMore}
  {hasMore}
  {loading}
/>
```
