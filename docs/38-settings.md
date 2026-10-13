# Settings Plugin

A persistent key-value settings store for Svelar/SvelteKit with scoped settings (global, per-user, per-team), type-safe getters, opt-in process-local caching, and pre-built UI form components. Inspired by Laravel's Spatie Settings package.

**Package:** `@beeblock/svelar-settings`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-settings
```

**Imports:**

```ts
// Plugin registration
import { SvelarSettingsPlugin } from '@beeblock/svelar-settings/server';

// Core API
import { Settings, SettingsStore, HasSettings, setSettingsStore } from '@beeblock/svelar-settings';

// Server-side
import { SettingsController } from '@beeblock/svelar-settings/server';

// UI components
import { SettingsForm, SettingsField } from '@beeblock/svelar-settings/ui';

// Types
import type {
  SettingType,
  GroupType,
  SettingRecord,
  SettingsPluginConfig,
  SettingsScope,
  SettingsRequestBody,
  SettingsFieldDefinition,
} from '@beeblock/svelar-settings';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import { SvelarSettingsPlugin } from '@beeblock/svelar-settings/server';

export const settingsPlugin = new SvelarSettingsPlugin({
  table: 'settings',
  cache: false,
  prefix: '/api',
});
```

### 2. Use Settings Anywhere

```ts
import { Settings } from '@beeblock/svelar-settings';

// Global settings
await Settings.set('site_name', 'My Awesome App');
await Settings.set('maintenance_mode', false);
await Settings.set('max_upload_size', 10);
await Settings.set('features', { darkMode: true, beta: false });

const siteName = await Settings.getString('site_name');
const maintenance = await Settings.getBoolean('maintenance_mode');
const maxSize = await Settings.getNumber('max_upload_size');
const features = await Settings.getJson('features');

// Check existence
const exists = await Settings.has('site_name'); // true

// Remove a setting
await Settings.forget('old_setting');

// Get all settings (optionally filtered by prefix)
const allSettings = await Settings.all();
const mailSettings = await Settings.all('mail_');
```

---

## Configuration

The `SvelarSettingsPlugin` constructor accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `table` | `string` | `'settings'` | Database table name |
| `cache` | `boolean` | `false` | Opt in to process-local caching; other processes are not invalidated |
| `cacheTtl` | `number` | none | Explicit positive TTL in seconds, required when caching is enabled |
| `prefix` | `string` | `'/api'` | API route prefix |

---

## Core API

### Settings Facade

The `Settings` object provides a global singleton for managing settings:

```ts
import { Settings } from '@beeblock/svelar-settings';

// Type-safe getters
await Settings.get<string>('key');              // Generic getter
await Settings.getString('key', 'default');     // String with default
await Settings.getNumber('key', 0);             // Number with default
await Settings.getBoolean('key', false);        // Boolean with default
await Settings.getJson<MyType>('key');           // JSON object

// Setters
await Settings.set('key', 'value');             // Auto-detects type
await Settings.setMany({                        // Set multiple at once
  'theme': 'dark',
  'locale': 'en',
  'notifications_enabled': true,
});

// Management
await Settings.has('key');                      // Check existence
await Settings.forget('key');                   // Delete a setting
await Settings.all();                           // Get all settings
await Settings.all('mail_');                    // Get settings by prefix

// Cache management
Settings.flushCache();                          // Clear the in-memory cache
```

### Scoped Settings

Settings can be scoped to users or teams:

```ts
// Per-user settings
const userSettings = Settings.forUser(userId);
await userSettings.set('theme', 'dark');
await userSettings.set('notifications', true);
const theme = await userSettings.getString('theme', 'light');

// Per-team settings
const teamSettings = Settings.forTeam(teamId);
await teamSettings.set('plan', 'pro');
const plan = await teamSettings.getString('plan');

// All settings for a scope
const allUserSettings = await userSettings.all();
```

### HasSettings Mixin

Add settings directly to any Model:

```ts
import { Model } from '@beeblock/svelar/orm';
import { HasSettings } from '@beeblock/svelar-settings';

class User extends HasSettings(Model, 'user') {
  static table = 'users';
}

const user = await User.find(1);

// Access scoped settings through the model
await user.settings().set('theme', 'dark');
await user.settings().set('language', 'en');

const theme = await user.settings().getString('theme', 'light');
const language = await user.settings().getString('language', 'en');

// Get all settings for this user
const all = await user.settings().all();
```

The second argument to `HasSettings` is the `GroupType` (`'user'` or `'team'`).

### SettingsStore

The underlying store that handles database operations and caching:

```ts
import { SettingsStore } from '@beeblock/svelar-settings';

const store = new SettingsStore({
  table: 'settings',
  cache: true,
  cacheTtl: 3600,
});

await store.get('global', null, 'key');
await store.set('user', 42, 'theme', 'dark');
await store.setMany('user', 42, { theme: 'dark', lang: 'en' });
await store.has('global', null, 'site_name');
await store.forget('global', null, 'old_key');
await store.all('user', 42, 'notification_');

store.flushCache();
```

### Setting Types

Values are automatically serialized with type detection:

| Type | Example | Stored As |
|---|---|---|
| `'string'` | `'hello'` | `"hello"` |
| `'number'` | `42` | `42` |
| `'boolean'` | `true` | `true` |
| `'json'` | `{ a: 1 }` | `{"a":1}` |

---

## Server-Side

### SettingsController

Handles read-only GET and JSON POST mutations through a FormRequest, DTO and ORM-backed store.

HTTP access is denied by default. Configure a server `authorize(event, access)` callback that returns literal `true` only after checking current trusted identity, credential capability ceilings, team membership/platform authority, the exact scope and every requested key. Register and seed `screen.settings.view`, `action.settings.update` and `action.settings.delete` in the host application's permission manifest/catalog. Tenant grants must never authorize global/platform settings. The callback receives the action, capability, immutable scope and key list, plus the exact prefix for an `all` request; authorizing `all` permits every key under that prefix or the entire scope when no prefix is supplied.

The callback belongs to the host application's access resolver; the plugin cannot infer membership, platform ownership or which settings contain secrets. `access.groupId` is canonical text or `null`; compare it with the canonical trusted entity ID, preserving opaque ID case. The shared schema normalizes numeric IDs before authorization and DTO construction. Reads use GET (`get`, `has`, `all`); mutations use JSON POST (`set`, `setMany`, `forget`). GET writes, mixed query/body mutations, invalid scopes and unknown payload fields are rejected. Core origin and CSRF middleware remain enabled; browser POSTs must send the Svelar CSRF token. A caller-supplied bearer header alone does not bypass protection.

Successful responses use `{ data, meta }`, for example `{ data: { settings: { theme: 'dark' } }, meta: {} }`. Failures include a safe message in `meta.message`; validation errors are in `meta.errors`. Unexpected database/authorization errors return a generic 500 message. The shared basic JSON settings schema is exported from `@beeblock/svelar-settings/schema` and is used by the FormRequest and UI; key-specific business validation remains host-owned.



```ts
// src/routes/api/settings/+server.ts
import { SettingsController } from '@beeblock/svelar-settings/server';

export const GET = async (event) => SettingsController.handle(event);
export const POST = async (event) => SettingsController.handle(event);
```

**GET parameters:**

| Parameter | Type | Description |
|---|---|---|
| `action` | `string` | Read-only `get`, `has`, `all`; mutations require POST |
| `key` | `string` | Setting key |
| `group_type` | `string` | `global`, `user`, `team` |
| `group_id` | `string` | Canonical scope ID (required for user/team); JSON POST also accepts positive safe integers |
| `prefix` | `string` | Filter prefix (for `all` action) |

**POST body:**

```json
{
  "action": "set",
  "key": "theme",
  "value": "dark",
  "group_type": "user",
  "group_id": 42
}
```

```json
{
  "action": "setMany",
  "entries": {
    "theme": "dark",
    "language": "en"
  },
  "group_type": "user",
  "group_id": 42
}
```

---

## UI Components

### SettingsForm

Renders a complete settings form from field definitions:

```svelte
<script lang="ts">
  import { SettingsForm } from '@beeblock/svelar-settings/ui';
  import type { SettingsFieldDefinition } from '@beeblock/svelar-settings';

  const fields: SettingsFieldDefinition[] = [
    {
      key: 'site_name',
      label: 'Site Name',
      type: 'text',
      placeholder: 'Enter site name',
      required: true,
    },
    {
      key: 'maintenance_mode',
      label: 'Maintenance Mode',
      type: 'toggle',
      description: 'Temporarily disable the site for maintenance.',
    },
    {
      key: 'max_upload_size',
      label: 'Max Upload Size (MB)',
      type: 'number',
      defaultValue: 10,
    },
    {
      key: 'theme',
      label: 'Default Theme',
      type: 'select',
      options: [
        { label: 'Light', value: 'light' },
        { label: 'Dark', value: 'dark' },
      ],
    },
    {
      key: 'welcome_message',
      label: 'Welcome Message',
      type: 'textarea',
    },
  ];
</script>

<SettingsForm
  {fields}
  apiUrl="/api/settings"
  groupType="global"
  onSave={() => console.log('Settings saved!')}
/>
```

### SettingsField

Individual settings field component:

```svelte
<script lang="ts">
  import { SettingsField } from '@beeblock/svelar-settings/ui';
</script>

<SettingsField
  key="site_name"
  label="Site Name"
  type="text"
  value="My App"
  onChange={(value) => console.log('Changed:', value)}
/>
```

**SettingsFieldDefinition:**

| Property | Type | Description |
|---|---|---|
| `key` | `string` | Setting key |
| `label` | `string` | Display label |
| `type` | `'text' \| 'number' \| 'toggle' \| 'select' \| 'textarea' \| 'json'` | Field type |
| `description` | `string` | Help text below the field |
| `placeholder` | `string` | Input placeholder |
| `options` | `{ label: string; value: string }[]` | Options for select fields |
| `defaultValue` | `unknown` | Default value |
| `required` | `boolean` | Whether the field is required |
| `disabled` | `boolean` | Whether the field is disabled |

---

## Migrations And Identity

Publish and run both migrations before using the store. `group_id` is nullable `VARCHAR(255)`; non-null `scope_key` and `key_hash` form the unique `(group_type, scope_key, key_hash)` identity. Global/null scopes use the text sentinel `'0'`; user/team scopes use the server's lowercase SHA-256 hash of the canonical entity ID. `key_hash` hashes the exact setting name. These identities keep case- and accent-distinct IDs and keys separate even under case-insensitive database collations. The original entity ID and setting name remain text; hashes provide persistence identity, and authorization still belongs to the host.

Pass IDs from trusted models or access resolvers. Positive safe integer `1` and string `'1'` share an identity. UUIDs, ULIDs, custom primary keys and other opaque strings are preserved verbatim, including punctuation and Unicode, up to 255 UTF-16 code units. Empty strings, whitespace, control/format characters, lone surrogates, reserved prototype names and ambiguous numeric spellings such as `'007'`, `'1e2'` or `'+1'` are rejected. Valid 26-character ULIDs preserve leading zeroes. Setting names also reject reserved prototype names, control characters and lone surrogates.

Writes use ORM upsert, preserve the original `created_at`, and update the stored value/type. `setMany` runs in a transaction, including any surrounding transaction; a later failure rolls back the entire batch.

### Upgrading an existing settings table

Back up the table and stop settings writes from all web, worker and scheduler processes. Publish `normalize_settings_scope.ts` and run `npx svelar migrate` before restarting with the new package. The create migration preserves a pre-existing legacy table even if its creation was never tracked by core. The normalize migration converts legacy numeric entity IDs to canonical text, backfills both hashes, replaces the known plaintext identity indexes and creates the hashed unique index. Create rollback only drops tables bearing its fresh-schema check, so it preserves a pre-existing legacy table. The store never alters the database at runtime.

The migration validates every existing scope, key and duplicate before changing schema or records. It retains the lowest-ID row only when duplicate stored `value` and `type` are byte-identical. Conflicting values/types, invalid scopes/keys or a nullable pre-existing `scope_key` stop migration without selecting an authoritative value. Resolve those records explicitly using the ORM, then rerun.

SQLite rebuilds the known settings table through public Schema operations and 250-row ORM copy batches inside a transaction. It preserves retained row IDs, serialized values/types, timestamps, column defaults/nullability and a deleted-ID AUTOINCREMENT high-water mark. Unknown/generated columns, custom primary keys/types/collations/checks/indexes, dependent triggers/views and inbound or outbound foreign keys stop the rebuild before DDL; create a reviewed custom migration to preserve such application-owned objects. PostgreSQL uses explicit text casts and transactional schema/data changes. PostgreSQL/MySQL also reject unknown unique indexes rather than retaining a competing plaintext identity or silently dropping an application constraint.

MySQL DDL commits implicitly, so the column, transactional backfill and unique-index phases can be resumed; keep writers stopped until every phase completes. Upgrade rollback removes the hash identity columns/index and keeps entity IDs as text; it cannot reconstruct removed duplicate rows or previous plaintext uniqueness. Restore the backup when the old schema or row identities are required. On a fresh table, the create migration owns the normalized schema and rollback drops that table.

## Cache Consistency

Database reads are fresh by default. Process-local caching is suitable only when the application explicitly accepts stale cross-process reads. Enable it with `new SvelarSettingsPlugin({ cache: true, cacheTtl: 30 })`; there is no implicit TTL or distributed invalidation. `flushCache()` clears only the current process. Transaction reads bypass the cache, and writes invalidate local entries only after the outer transaction commits.

---

## Full Working Example

```ts
// src/routes/api/settings/+server.ts
import { SettingsController } from '@beeblock/svelar-settings/server';

export const GET = async (event) => SettingsController.handle(event);
export const POST = async (event) => SettingsController.handle(event);
```

```svelte
<!-- src/routes/admin/settings/+page.svelte -->
<script lang="ts">
  import { SettingsForm } from '@beeblock/svelar-settings/ui';
  import type { SettingsFieldDefinition } from '@beeblock/svelar-settings';

  const fields: SettingsFieldDefinition[] = [
    { key: 'site_name', label: 'Site Name', type: 'text', required: true },
    { key: 'site_description', label: 'Site Description', type: 'textarea' },
    { key: 'maintenance_mode', label: 'Maintenance Mode', type: 'toggle' },
    { key: 'items_per_page', label: 'Items Per Page', type: 'number', defaultValue: 20 },
    {
      key: 'default_locale',
      label: 'Default Language',
      type: 'select',
      options: [
        { label: 'English', value: 'en' },
        { label: 'Portuguese', value: 'pt' },
        { label: 'Spanish', value: 'es' },
      ],
    },
  ];
</script>

<h1>Application Settings</h1>

<SettingsForm
  {fields}
  apiUrl="/api/settings"
  groupType="global"
  onSave={() => console.log('Settings saved!')}
/>
```

The host must authorize `screen.settings.view` before rendering this page and configure the plugin's `authorize` callback before serving requests. The form reads and writes through that guarded API; do not expose an unguarded `Settings.all()` page loader.
