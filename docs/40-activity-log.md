# Activity Log Plugin

A Spatie-inspired activity log plugin for Svelar/SvelteKit that records user actions, tracks model changes, and provides a timeline feed with filtering, pagination, and pre-built UI components.

**Package:** `@beeblock/svelar-activity-log`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-activity-log
```

**Imports:**

```ts
// Dedicated server-only plugin registration
import SvelarActivityLogPlugin from '@beeblock/svelar-activity-log/plugin';

// Core API
import { Activity, ActivityLogger, activity, ActivityService, LogsActivity, setCauserResolver, getCauserResolver } from '@beeblock/svelar-activity-log/server';

// Server-side (controller)
import { ActivityController } from '@beeblock/svelar-activity-log/server';

// UI components
import { ActivityFeed, ActivityItem, ActivityFilters } from '@beeblock/svelar-activity-log/ui';

// Types
import type { ActivityRecord, ActivityData, ChangeProperties, ActivityFilterOptions, PaginatedActivities, ActivityLogPluginConfig, ActivityFeedItem, ActivityLogClassNames, LogsActivityConfig, ModelIdentifier, ActivityIdentifiable } from '@beeblock/svelar-activity-log';
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

```bash
npx svelar plugin:publish @beeblock/svelar-activity-log
npx svelar migrate
```

The plugin publishes `create_activity_log_table.ts`, which creates the table and indexes through Svelar migrations. `ActivityService.getMigrationSQL()` is not part of the current API. Do not create this table from a route, service, or application bootstrap.

`subject_id` and `causer_id` are nullable `VARCHAR(255)` polymorphic references. Accept `string | number` inputs; storage and resources return canonical strings. UUIDs, ULIDs, custom primary keys, case, trailing spaces, and leading zeros retain their identity. A numeric `1` becomes `'1'`, while `'001'` remains distinct. The activity row's own `id` remains numeric. MySQL queries compare both morph type and ID exactly with parameterized binary predicates.

These revised initial migrations belong to the unpublished alpha package. An existing installation must add a reviewed application migration that converts its old numeric morph columns and preserves its indexes and data. Polymorphic references do not add a host-user foreign key. Any application-owned foreign key must match its referenced primary key's actual database type, size, signedness, and collation; changing a column to `VARCHAR` does not make it compatible with a `BIGINT` or native UUID key.

### 3. Log an Activity

```ts
import { activity } from '@beeblock/svelar-activity-log/server';

await activity()
  .causedBy(user)
  .performedOn(post)
  .withProperties({ ip: '192.168.1.1' })
  .log('updated');
```

---

## Configuration

The `SvelarActivityLogPlugin` constructor registers these defaults under the `activity-log` configuration key:

| Option | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | `'/api'` | Route-prefix configuration metadata; bind the actual route in the application |
| `defaultLogName` | `string` | `'default'` | Configuration default; choose the runtime name with `activity(name)` |
| `defaultCauserType` | `string` | `'users'` | Configuration default; use `causedBy(id, type)` or `causerType(type)` |
| `cleanupDays` | `number` | `90` | Retention metadata; pass days to the cleanup request/service |
| `logOnlyDirty` | `boolean` | `true` | Set `static logOnlyDirty` on the mixed model to control tracking |

---

The logger, cleanup controller, and model mixin do not automatically read these configuration overrides. Pass the corresponding arguments or model settings explicitly. Publishing creates a migration; it does not bind routes or schedule retention cleanup.

## Core API

### ActivityLogger (Fluent Builder)

The primary way to log activities. Create one via the `activity()` factory function:

```ts
import { activity } from '@beeblock/svelar-activity-log/server';

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
| `causedBy(causer, type?)` | `this` | Set who performed the action (model instance or `string \| number` ID) |
| `performedOn(subject)` | `this` | Set what was acted upon (model instance or `{ type, id }`) |
| `onSubject(type, id)` | `this` | Set the subject by type string and ID directly |
| `withProperties(props)` | `this` | Attach arbitrary key-value metadata (merged with existing) |
| `causerType(type)` | `this` | Override the causer type string |
| `useLog(name)` | `this` | Override the log name |
| `log(description)` | `Promise<Activity>` | Persist the activity to the database |

### Activity Class

A Svelar ORM model with JSON-cast properties and a consistent resource representation:

```ts
const entry = await activity().causedBy(user).log('created');

entry.id;             // number
entry.logName;        // string
entry.description;    // string
entry.subjectType;    // string | null
entry.subjectId;      // string | null
entry.causerType;     // string
entry.causerId;       // string | null
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
import { ActivityService } from '@beeblock/svelar-activity-log/server';

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

The logger and mixin read a model key with `model.getAttribute(model.constructor.primaryKey)`. Passing a real model also infers its table as the morph type, including custom primary-key names. `setCauserResolver` accepts a real model or `{ id: string | number, type?: string }`.

Automatically logs `created`, `updated`, and `deleted` events on any Model:

```ts
import { Model } from '@beeblock/svelar/orm';
import { LogsActivity } from '@beeblock/svelar-activity-log/server';

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

Register one resolver at application setup and read the actor from request-scoped context. Do not replace a global resolver with a closure over each request's user.

```ts
// This wrapper runs after the application's Svelar authentication middleware.
import { ApplicationContext } from '@beeblock/svelar/support';
import { setCauserResolver } from '@beeblock/svelar-activity-log/server';

setCauserResolver(() => ApplicationContext.get('activityCauser') ?? null);

export async function handle({ event, resolve }) {
  return ApplicationContext.run(
    { activityCauser: event.locals.auth?.user() ?? null },
    () => resolve(event),
  );
}
```

Automatic logs follow instance lifecycle hooks. Hidden fields and `logExcept` are excluded. `withoutLogging` suppresses only its async operation, while `disableLogging` changes the model's shared setting.

---

## Server-Side

### ActivityController

Handles activity feed API routes with filtering and pagination. Authentication must populate the current user first. Configure the application policies/permissions behind both `activity-log.view` and `activity-log.cleanup` Gate abilities; missing or denied abilities fail closed. Register literal capability manifests and seed their catalogs/profiles when access is user-configurable. Protect the host page/controller with its reviewed capability scope as well.

Generic plugin endpoints reject bearer credentials, so a credential ceiling cannot inherit browser-user authority. POST requests require CSRF. Reads validate the shared filter schema; cleanup uses `CleanupActivitiesRequest` → `CleanupActivitiesDTO` → `CleanupActivitiesAction` → ORM service. Successful reads return `{ data: ActivityData[], meta: { total, page, perPage, lastPage, hasMore } }`; cleanup returns `{ data: { deleted }, meta: {} }`.

Keep route files thin:

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
| `subject_id` | `string \| number` | Exact canonical subject ID; requires `subject_type` |
| `causer_type` | `string` | Exact causer type; requires `causer_id` |
| `causer_id` | `string \| number` | Exact canonical causer ID |
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
  let activities = $derived(data.activities);
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
import { LogsActivity } from '@beeblock/svelar-activity-log/server';

export class Post extends LogsActivity(Model) {
  static table = 'posts';
  static fillable = ['title', 'content', 'published'];
  static logAttributes = ['title', 'content', 'published'];
  static logName = 'posts';
}
```

```ts
// src/hooks.server.ts
import { ApplicationContext } from '@beeblock/svelar/support';
import { setCauserResolver } from '@beeblock/svelar-activity-log/server';

setCauserResolver(() => ApplicationContext.get('activityCauser') ?? null);

// Run this wrapper after authentication has populated event.locals.auth.
export async function handle({ event, resolve }) {
  return ApplicationContext.run(
    { activityCauser: event.locals.auth?.user() ?? null },
    () => resolve(event),
  );
}
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
import { error } from '@sveltejs/kit';
import { ActivityController } from '@beeblock/svelar-activity-log/server';

// Host page authorization and the controller's activity-log.view Gate both apply.
export async function load(event) {
  const response = await ActivityController.handle(event);
  const result = await response.json();
  if (!response.ok) error(response.status, result.meta?.message ?? 'Unable to load activity.');
  return { activities: result.data, total: result.meta.total, hasMore: result.meta.hasMore };
}
```

```svelte
<!-- src/routes/admin/activity/+page.svelte -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { ActivityFeed } from '@beeblock/svelar-activity-log/ui';
  import { apiFetch } from '@beeblock/svelar/http';
  import type { ActivityData, ActivityFilterOptions } from '@beeblock/svelar-activity-log';

  interface Props {
    data: { activities: ActivityData[]; total: number; hasMore: boolean };
  }
  let { data }: Props = $props();
  let activities = $state(untrack(() => data.activities));
  let hasMore = $state(untrack(() => data.hasMore));
  let page = $state(1);
  let loading = $state(false);

  let errorMessage = $state('');
  let currentFilters = $state<ActivityFilterOptions>({});

  async function fetchPage(filters: ActivityFilterOptions, nextPage: number) {
    const res = await apiFetch('/api/activities', {
      method: 'POST', showToast: false,
      body: JSON.stringify({
        log_name: filters.logName, subject_type: filters.subjectType,
        subject_id: filters.subjectId, causer_type: filters.causerType,
        causer_id: filters.causerId, description: filters.description,
        since: filters.since, until: filters.until, sort: filters.sortDirection,
        page: nextPage, per_page: 20,
      }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.meta?.message ?? 'Unable to load activity.');
    return result;
  }

  async function handleFilter(filters: ActivityFilterOptions) {
    if (loading) return;
    loading = true; errorMessage = '';
    try {
      const result = await fetchPage(filters, 1);
      currentFilters = filters; activities = result.data;
      hasMore = result.meta.hasMore; page = 1;
    } catch (error) { errorMessage = error instanceof Error ? error.message : 'Unable to load activity.'; }
    finally { loading = false; }
  }

  async function handleLoadMore() {
    if (loading || !hasMore) return;
    loading = true; errorMessage = '';
    try {
      const result = await fetchPage(currentFilters, page + 1);
      activities = [...activities, ...result.data];
      hasMore = result.meta.hasMore; page += 1;
    } catch (error) { errorMessage = error instanceof Error ? error.message : 'Unable to load activity.'; }
    finally { loading = false; }
  }
</script>

<h1>Activity Log</h1>
{#if errorMessage}<p role='alert'>{errorMessage}</p>{/if}

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
