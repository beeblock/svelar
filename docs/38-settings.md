# Settings Plugin

A persistent key-value settings store for Svelar/SvelteKit with scoped settings (global, per-user, per-team), type-safe getters, in-memory caching, and pre-built UI form components. Inspired by Laravel's Spatie Settings package.

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
  cache: true,
  cacheTtl: 3600,
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
| `cache` | `boolean` | `true` | Enable in-memory caching |
| `cacheTtl` | `number` | `3600` | Cache TTL in seconds |
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
import { Model } from '@beeblock/svelar/database';
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

Handles GET and POST requests for settings CRUD:

```ts
// src/routes/api/settings/+server.ts
import { SettingsController } from '@beeblock/svelar-settings/server';

export const GET = async (event) => SettingsController.handle(event);
export const POST = async (event) => SettingsController.handle(event);
```

**GET parameters:**

| Parameter | Type | Description |
|---|---|---|
| `action` | `string` | `get`, `set`, `setMany`, `has`, `forget`, `all` |
| `key` | `string` | Setting key |
| `group_type` | `string` | `global`, `user`, `team` |
| `group_id` | `number` | Scope ID (required for user/team) |
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

## Migration SQL

```sql
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_type TEXT NOT NULL DEFAULT 'global',
  group_id INTEGER,
  key TEXT NOT NULL,
  value TEXT,
  type TEXT NOT NULL DEFAULT 'string',
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(group_type, group_id, key)
);
```

You can also get this SQL programmatically:

```ts
const sql = SvelarSettingsPlugin.migrationSql();
// or
const sql = Settings.migrationSql('custom_settings_table');
```

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

  interface Props {
    data: { settings: Record<string, unknown> };
  }
  let { data }: Props = $props();

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

```ts
// src/routes/admin/settings/+page.server.ts
import { Settings } from '@beeblock/svelar-settings';

export async function load() {
  const settings = await Settings.all();
  return { settings };
}
```
