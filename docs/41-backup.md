# Backup Plugin

A database backup plugin for Svelar/SvelteKit with support for SQLite, PostgreSQL, and MySQL, multiple storage destinations (local and S3), automatic cleanup strategies, health checks, and a pre-built admin UI for managing backups.

**Package:** `@beeblock/svelar-backup`

**Install:**

```bash
npm install @beeblock/svelar-backup
```

**Imports:**

```ts
// Plugin registration
import { SvelarBackupPlugin } from '@beeblock/svelar-backup/server';

// Core API
import { Backup, BackupService, BackupHistory } from '@beeblock/svelar-backup';

// Dumpers
import { SqliteDumper, PostgresDumper, MysqlDumper } from '@beeblock/svelar-backup';

// Destinations
import { LocalDestination, S3Destination } from '@beeblock/svelar-backup';

// Cleanup
import { DefaultCleanup } from '@beeblock/svelar-backup';

// Server-side (controller, scheduled task)
import { BackupController, BackupTask } from '@beeblock/svelar-backup/server';

// UI components
import { BackupManager, BackupStatus } from '@beeblock/svelar-backup/ui';

// Types
import type { BackupConfig, BackupResult, BackupRecord, HealthCheckResult, CleanupResult, CleanupConfig, DatabaseConfig, DestinationConfig } from '@beeblock/svelar-backup';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import { SvelarBackupPlugin } from '@beeblock/svelar-backup/server';

export const backupPlugin = new SvelarBackupPlugin({
  prefix: '/api/admin',
  defaults: {
    database: { driver: 'sqlite', filename: 'database.db' },
    destinations: [{ driver: 'local', path: 'storage/backups' }],
    compression: true,
    maxBackupSize: 500,
  },
});
```

### 2. Configure and Initialize

```ts
// src/lib/backup.ts
import { Backup } from '@beeblock/svelar-backup';
import Database from 'better-sqlite3';

const db = new Database('database.db');

Backup.configure({
  database: { driver: 'sqlite', filename: 'database.db' },
  destinations: [{ driver: 'local', path: 'storage/backups' }],
  cleanup: {
    keepDailyBackupsForDays: 7,
    keepWeeklyBackupsForWeeks: 4,
    keepMonthlyBackupsForMonths: 6,
  },
  notifications: { onSuccess: true, onFailure: true },
  compression: true,
  maxBackupSize: 500,
  db,
});
```

### 3. Run a Backup

```ts
const results = await Backup.run();
// results: BackupResult[] -- one per destination
```

---

## Configuration

The `SvelarBackupPlugin` constructor accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | `'/api/admin'` | API route prefix for backup endpoints |
| `defaults` | `Partial<BackupConfig>` | see below | Default backup configuration |

**BackupConfig options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `database.driver` | `'sqlite' \| 'postgres' \| 'mysql'` | `'sqlite'` | Database driver |
| `database.filename` | `string` | `'database.db'` | SQLite database file path |
| `database.host` | `string` | `undefined` | Postgres/MySQL host |
| `database.port` | `number` | `undefined` | Postgres/MySQL port |
| `database.database` | `string` | `undefined` | Postgres/MySQL database name |
| `database.username` | `string` | `undefined` | Postgres/MySQL username |
| `database.password` | `string` | `undefined` | Postgres/MySQL password |
| `destinations` | `DestinationConfig[]` | `[{ driver: 'local', path: 'storage/backups' }]` | Backup storage destinations |
| `cleanup.keepDailyBackupsForDays` | `number` | `7` | Keep daily backups for N days |
| `cleanup.keepWeeklyBackupsForWeeks` | `number` | `4` | Keep weekly backups for N weeks |
| `cleanup.keepMonthlyBackupsForMonths` | `number` | `6` | Keep monthly backups for N months |
| `notifications.onSuccess` | `boolean` | `true` | Notify on successful backup |
| `notifications.onFailure` | `boolean` | `true` | Notify on failed backup |
| `compression` | `boolean` | `true` | Compress backup files with gzip |
| `maxBackupSize` | `number` | `500` | Max backup size in MB (warning only) |

**Destination configurations:**

```ts
// Local
{ driver: 'local', path: 'storage/backups' }

// S3
{
  driver: 's3',
  bucket: 'my-backups',
  prefix: 'db/',
  region: 'us-east-1',
  endpoint: 'https://s3.amazonaws.com',
  accessKeyId: '...',
  secretAccessKey: '...',
}
```

---

## Core API

### Backup Facade

The `Backup` object is a singleton facade for all backup operations:

```ts
import { Backup } from '@beeblock/svelar-backup';
```

| Method | Returns | Description |
|---|---|---|
| `Backup.configure(config)` | `void` | Set configuration (pass `db` to also initialize the service) |
| `Backup.setDatabase(db)` | `void` | Set the database instance (better-sqlite3 or compatible) |
| `Backup.run()` | `Promise<BackupResult[]>` | Execute a backup to all configured destinations |
| `Backup.list()` | `Promise<BackupRecord[]>` | List all backup records |
| `Backup.download(nameOrId)` | `Promise<Buffer>` | Download a backup file by name or ID |
| `Backup.deleteBackup(id)` | `Promise<void>` | Delete a backup by ID (file + record) |
| `Backup.cleanup()` | `Promise<CleanupResult>` | Run cleanup strategy, returns `{ deletedCount, freedBytes }` |
| `Backup.health()` | `Promise<HealthCheckResult>` | Health check: last backup age, count, total size |
| `Backup.getConfig()` | `BackupConfig` | Get current configuration |
| `Backup.getService()` | `BackupService` | Get the underlying service instance |

### BackupResult

Returned by `Backup.run()` for each destination:

```ts
interface BackupResult {
  success: boolean;
  path: string;          // file path at destination
  size: number;          // bytes
  duration: number;      // milliseconds
  destination: string;   // 'local' or 's3'
  error?: string;        // error message if failed
}
```

### HealthCheckResult

Returned by `Backup.health()`:

```ts
interface HealthCheckResult {
  healthy: boolean;          // false if last backup > 25 hours old
  lastBackup: Date | null;   // timestamp of last successful backup
  lastBackupAge: string;     // human-readable age (e.g. '3 hours ago')
  backupCount: number;       // total number of backup records
  totalSize: string;         // formatted total size (e.g. '45.2 MB')
}
```

### BackupHistory

Manages backup records in the database. Used internally by `BackupService`:

```ts
const history = Backup.getService().getHistory();

history.all();                   // BackupRecord[]
history.findById(1);             // BackupRecord | undefined
history.latest();                // most recent completed backup
history.count();                 // total count
history.totalSize();             // total bytes of completed backups
history.allByDisk('local');      // records for a specific disk
history.countByStatus('failed'); // count by status
```

### Dumpers

Abstract `Dumper` base class with implementations for each database driver:

- `SqliteDumper` -- copies the SQLite file
- `PostgresDumper` -- runs `pg_dump`
- `MysqlDumper` -- runs `mysqldump`

Each dumper implements:

```ts
abstract dump(outputPath: string): Promise<DumpResult>;
// DumpResult: { filePath: string; size: number }
```

### Destinations

Abstract `Destination` base class with implementations:

- `LocalDestination` -- stores backups on the local filesystem
- `S3Destination` -- stores backups in an S3-compatible bucket

Each destination implements:

```ts
abstract store(sourceFilePath: string, destinationName: string): Promise<StoredFile>;
abstract list(): Promise<StoredFile[]>;
abstract download(fileName: string): Promise<Buffer>;
abstract delete(fileName: string): Promise<void>;
abstract exists(fileName: string): Promise<boolean>;
```

---

## Server-Side

### BackupController

Provides static methods for API route handlers. The `handle()` method auto-dispatches based on HTTP method and path:

```ts
// src/routes/api/admin/backups/[...path]/+server.ts
import { BackupController } from '@beeblock/svelar-backup/server';

export const GET = async (event) => BackupController.handle(event);
export const POST = async (event) => BackupController.handle(event);
export const DELETE = async (event) => BackupController.handle(event);
```

**Available routes (dispatched by `handle()`):**

| Method | Route Pattern | Handler | Description |
|---|---|---|---|
| `GET` | `/backups` | `list()` | List all backups |
| `POST` | `/backups/run` | `run()` | Trigger a backup |
| `GET` | `/backups/:id/download` | `download(id)` | Download a backup file |
| `DELETE` | `/backups/:id` | `delete(id)` | Delete a backup |
| `POST` | `/backups/cleanup` | `cleanup()` | Run cleanup |
| `GET` | `/backups/health` | `health()` | Health check (returns 503 if unhealthy) |

### BackupTask

A `ScheduledTask`-compatible class for automated backups. Extend it in your scheduler directory:

```ts
// src/lib/scheduler/DailyBackup.ts
import { BackupTask } from '@beeblock/svelar-backup/server';

export default class DailyBackup extends BackupTask {
  name = 'backup:daily';

  schedule() {
    return this.dailyAt('02:00');
  }
}
```

The `handle()` method runs the backup to all destinations, logs results, and automatically runs cleanup afterward.

---

## UI Components

### BackupManager

A full admin panel for managing backups with health status, backup trigger, cleanup, download, and delete:

```svelte
<script lang="ts">
  import { BackupManager } from '@beeblock/svelar-backup/ui';
</script>

<BackupManager
  apiBase="/api/admin/backups"
  csrfCookieName="XSRF-TOKEN"
  csrfHeaderName="X-CSRF-Token"
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `apiBase` | `string` | `'/api/admin/backups'` | Base URL for backup API endpoints |
| `csrfCookieName` | `string` | `'XSRF-TOKEN'` | CSRF cookie name |
| `csrfHeaderName` | `string` | `'X-CSRF-Token'` | CSRF header name |

Features:
- Health status badge (Healthy/Unhealthy)
- Summary cards (last backup age, total count, total size)
- "Run Backup" and "Cleanup" buttons
- Table with name, disk, size, duration, status, created date
- Download and delete actions per backup

### BackupStatus

A compact health status badge:

```svelte
<script lang="ts">
  import { BackupStatus } from '@beeblock/svelar-backup/ui';
</script>

<BackupStatus healthy={true} lastBackupAge="2 hours ago" size="md" />
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `healthy` | `boolean` | `false` | Whether the backup system is healthy |
| `lastBackupAge` | `string` | `'never'` | Human-readable age of last backup |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Badge size variant |

---

## Migration SQL

The `backups` table is created automatically by `BackupHistory.ensureTable()` when you call `Backup.configure()`. The SQL is:

```sql
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  disk TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',
  error TEXT,
  duration INTEGER,
  created_at TEXT
);
```

---

## Full Working Example

```ts
// src/lib/backup.ts
import { Backup } from '@beeblock/svelar-backup';
import Database from 'better-sqlite3';

const db = new Database('database.db');

Backup.configure({
  database: { driver: 'sqlite', filename: 'database.db' },
  destinations: [
    { driver: 'local', path: 'storage/backups' },
    {
      driver: 's3',
      bucket: 'my-app-backups',
      prefix: 'daily/',
      region: 'us-east-1',
    },
  ],
  cleanup: {
    keepDailyBackupsForDays: 7,
    keepWeeklyBackupsForWeeks: 4,
    keepMonthlyBackupsForMonths: 6,
  },
  notifications: { onSuccess: true, onFailure: true },
  compression: true,
  maxBackupSize: 500,
  db,
});
```

```ts
// src/routes/api/admin/backups/[...path]/+server.ts
import { BackupController } from '@beeblock/svelar-backup/server';

export const GET = async (event) => BackupController.handle(event);
export const POST = async (event) => BackupController.handle(event);
export const DELETE = async (event) => BackupController.handle(event);
```

```ts
// src/lib/scheduler/DailyBackup.ts
import { BackupTask } from '@beeblock/svelar-backup/server';

export default class DailyBackup extends BackupTask {
  name = 'backup:daily';

  schedule() {
    return this.dailyAt('02:00');
  }
}
```

```svelte
<!-- src/routes/admin/backups/+page.svelte -->
<script lang="ts">
  import { BackupManager } from '@beeblock/svelar-backup/ui';
</script>

<h1>Database Backups</h1>

<BackupManager apiBase="/api/admin/backups" />
```
