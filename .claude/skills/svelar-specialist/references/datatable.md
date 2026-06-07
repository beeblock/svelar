# DataTable Plugin

Full docs: https://svelar.dev/docs/datatable

Separate package: `@beeblock/svelar-datatable`

## Table of Contents
- [Install](#install)
- [Import Paths](#import-paths)
- [Client-Side Quick Start](#client-side-quick-start)
- [Server-Side Quick Start](#server-side-quick-start)
- [All Props](#all-props)
- [Column Definition](#column-definition)
- [Editor Modes](#editor-modes)
- [Editor Field Definition](#editor-field-definition)
- [Buttons & Export](#buttons--export)
- [Tailwind Customization](#tailwind-customization)
- [Virtual Scroll](#virtual-scroll)
- [Row Grouping & Column Filters](#row-grouping--column-filters)
- [Custom Cells & Row Customization](#custom-cells--row-customization)
- [Store API](#store-api)
- [Server Controller & Service](#server-controller--service)
- [Wire Protocol](#wire-protocol)

## Install

```bash
npm install @beeblock/svelar-datatable
```

Peer dependencies: `@beeblock/svelar >= 0.4.0`, `svelte ^5.0.0`

## Import Paths

```typescript
// UI component (Svelte source -- not compiled)
import { DataTable } from '@beeblock/svelar-datatable/ui';

// Types
import type {
  ColumnDef, EditorFieldDef, ButtonDef, DataTableClassNames,
  DataTableConfig, DataTableState, ExportFormat, SelectionMode,
  EditorMode, ColumnType, FilterOperator, FieldType,
} from '@beeblock/svelar-datatable';

// Stores (client-side state management)
import { DataTableStore, ServerDataTableStore } from '@beeblock/svelar-datatable';

// Server controller (API routes)
import { DataTableController, DataTableService } from '@beeblock/svelar-datatable/server';
```

## Client-Side Quick Start

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { ColumnDef } from '@beeblock/svelar-datatable';

  interface User {
    id: number;
    name: string;
    email: string;
  }

  const columns: ColumnDef<User>[] = [
    { key: 'id', header: 'ID', type: 'number', sortable: true },
    { key: 'name', header: 'Name', sortable: true, searchable: true },
    { key: 'email', header: 'Email', sortable: true, searchable: true },
  ];

  const data: User[] = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ];
</script>

<DataTable {data} {columns} sortable searchable paginate perPage={10} />
```

## Server-Side Quick Start

```svelte
<!-- Frontend -->
<DataTable
  serverUrl="/api/datatable/users"
  columns={columns}
  sortable
  searchable
  paginate
  perPage={25}
/>
```

```typescript
// src/routes/api/datatable/users/+server.ts
import { DataTableController } from '@beeblock/svelar-datatable/server';
import { User } from '$lib/models/User';

const dt = new DataTableController(User);
export const GET = dt.handle();
```

## All Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `T[]` | — | Client-side data array |
| `serverUrl` | `string` | — | Server endpoint URL |
| `serverMethod` | `'GET' \| 'POST'` | `'GET'` | Request method for server mode |
| `serverParams` | `Record<string, any> \| (() => Record<string, any>)` | — | Extra server filters sent as `filters[name]` on GET or `customFilters` on POST |
| `columns` | `ColumnDef<T>[]` | **required** | Column definitions |
| `sortable` | `boolean` | `true` | Enable sorting |
| `searchable` | `boolean` | `true` | Enable global search |
| `paginate` | `boolean` | `true` | Enable pagination (set `false` for virtual scroll) |
| `selectable` | `SelectionMode` | `'none'` | `'none' \| 'single' \| 'multi'` |
| `perPage` | `number` | `15` | Rows per page |
| `perPageOptions` | `number[]` | `[10,15,25,50,100]` | Per-page dropdown options |
| `searchDebounceMs` | `number` | `300` | Search debounce delay |
| `stateSaveKey` | `string` | — | localStorage key for state persistence |
| `rowId` | `string \| ((row: T) => string \| number)` | `'id'` | Row identity |
| `rowClass` | `string \| ((row: T, index: number) => string)` | — | Dynamic row CSS classes |
| `buttons` | `(ButtonDef \| ExportFormat)[]` | — | Toolbar buttons/export |
| `editorMode` | `EditorMode` | — | `'modal' \| 'bubble' \| 'inline' \| 'excel'` |
| `editorFields` | `EditorFieldDef[]` | — | Form fields for modal/bubble editors |
| `virtualScroll` | `boolean` | `false` | Enable virtual scrolling |
| `virtualRowHeight` | `number` | `48` | Row height in px for virtual scroll |
| `groupBy` | `string` | — | Group rows by column key |
| `expandable` | `boolean` | `false` | Enable expandable detail rows |
| `responsive` | `boolean` | `true` | Horizontal scroll on small screens |
| `compact` | `boolean` | `false` | Reduced padding |
| `striped` | `boolean` | `true` | Alternating row colors |
| `hover` | `boolean` | `true` | Row hover effect |
| `bordered` | `boolean` | `false` | Cell borders |
| `unstyled` | `boolean` | `false` | Disable all built-in CSS |
| `classNames` | `DataTableClassNames` | `{}` | Tailwind class overrides (39 keys) |
| `emptyText` | `string` | `'No data available'` | Empty state text |
| `loadingText` | `string` | `'Loading...'` | Loading state text |
| `storeRef` | `DataTableStore` | — | Bindable store for external control (`bind:storeRef`) |
| `customCell` | `Snippet` | — | Custom cell renderer snippet |
| `expandContent` | `Snippet` | — | Expandable row content snippet |

**Callbacks:**

| Callback | Signature |
|----------|-----------|
| `onSort` | `(sort: SortState[]) => void` |
| `onFilter` | `(filters: FilterState[]) => void` |
| `onPageChange` | `(page: number, perPage: number) => void` |
| `onSelect` | `(selectedRows: T[]) => void` |
| `onRowClick` | `(row: T, event: MouseEvent) => void` |
| `onEdit` | `(row: T, data: Record<string, any>) => void \| Promise<void>` |
| `onCellEdit` | `(row: T, columnKey: string, newValue: any, oldValue: any) => void \| Promise<void>` |
| `onCreate` | `(data: Record<string, any>) => void \| Promise<void>` |
| `onDelete` | `(rows: T[]) => void \| Promise<void>` |

## Column Definition

```typescript
interface ColumnDef<T = any> {
  key: string;              // data property key
  header: string;           // display header text
  type?: ColumnType;        // 'string' | 'number' | 'date' | 'boolean' | 'html' | 'custom'
  sortable?: boolean;       // enable sorting
  searchable?: boolean;     // include in global search
  filterable?: boolean;     // column-level filtering
  visible?: boolean;        // initially visible (default: true)
  editable?: boolean;       // allow editing
  width?: string;           // e.g. '60px'
  minWidth?: string;
  maxWidth?: string;
  className?: string;       // td CSS class
  headerClassName?: string; // th CSS class
  orderable?: boolean;      // allow column reorder
  defaultSort?: 'asc' | 'desc';
  footer?: string | ((rows: T[]) => string | number);  // footer aggregation
  editorField?: EditorFieldDef;  // inline editor config
}
```

## Editor Modes

```svelte
<!-- Modal: form dialog -->
<DataTable editorMode="modal" editorFields={fields} onEdit={save} onCreate={create} />

<!-- Bubble: popover anchored to selected row -->
<DataTable editorMode="bubble" editorFields={fields} onEdit={save} />

<!-- Inline: double-click a cell to edit in-place -->
<DataTable editorMode="inline" onCellEdit={saveCellEdit} />

<!-- Excel: spreadsheet-style navigation, Enter/type to edit, arrow keys to move -->
<DataTable editorMode="excel" onCellEdit={saveCellEdit} />
```

Modal and bubble use `editorFields` + `onEdit`/`onCreate`. Inline and excel use `onCellEdit`.
For server-side Excel mode, `onCellEdit` must call a normal Svelar write route and throw on failure so the cell can be reverted.

## Editor Field Definition

```typescript
interface EditorFieldDef {
  name: string;           // maps to data key
  type: FieldType;        // 'text' | 'textarea' | 'number' | 'select' | 'multi-select' | 'checkbox' | 'radio' | 'date' | 'datetime' | 'upload' | 'hidden' | 'readonly'
  label: string;
  placeholder?: string;
  options?: { label: string; value: any }[];  // for select/radio
  defaultValue?: any;
  required?: boolean;
  disabled?: boolean;
  multiple?: boolean;     // for multi-select
  className?: string;
  dependsOn?: string;     // conditional: show when field has value
  dependsOnValue?: any;   // conditional: show when field equals this
  showWhen?: (formData: Record<string, any>) => boolean;  // custom visibility
}
```

## Buttons & Export

```svelte
<!-- Simple export buttons -->
<DataTable buttons={['csv', 'clipboard', 'print']} />

<!-- Custom buttons with actions -->
<DataTable buttons={[
  'csv',
  {
    key: 'archive',
    label: 'Archive',
    variant: 'destructive',
    action: (selectedRows) => archiveUsers(selectedRows),
    disabled: (selectedRows) => selectedRows.length === 0,
  },
]} />
```

Export formats: `'csv' | 'excel' | 'pdf' | 'clipboard' | 'print'`
Excel requires `exceljs`, PDF requires additional setup.

## Tailwind Customization

Set `striped={false}` and `hover={false}` to disable built-in CSS, then use `classNames` with `!important` modifier:

```svelte
<DataTable
  {data}
  {columns}
  striped={false}
  hover={false}
  classNames={{
    container: '!bg-slate-900 !border-slate-800',
    toolbar: '!bg-slate-900',
    searchInput: '!bg-slate-800 !text-slate-200 !border-slate-700',
    thead: '!bg-slate-950',
    th: '!bg-slate-950 !text-slate-400 !tracking-widest !border-b-slate-800',
    tbody: '!bg-slate-900',
    tr: 'hover:!bg-slate-800 !transition-colors',
    trSelected: '!bg-emerald-500/10',
    trEven: '!bg-white/[0.02]',
    td: '!text-slate-300 !border-b-slate-800',
    tfoot: '!bg-slate-950',
    tf: '!text-emerald-400 !font-semibold !border-t-slate-800',
    pagination: '!border-t-slate-800 !text-slate-400 !bg-slate-900',
    pageButton: '!bg-slate-800 !text-slate-400 !border-slate-700',
    perPageSelect: '!bg-slate-800 !text-slate-200 !border-slate-700',
  }}
/>
```

**All 39 classNames keys:** `container`, `toolbar`, `toolbarLeft`, `toolbarRight`, `searchInput`, `table`, `thead`, `th`, `thSortable`, `tbody`, `tr`, `trSelected`, `trEven`, `td`, `tfoot`, `tf`, `pagination`, `paginationInfo`, `paginationControls`, `pageButton`, `pageButtonActive`, `perPageSelect`, `btn`, `btnCreate`, `btnEdit`, `btnDelete`, `editorModal`, `editorBackdrop`, `editorField`, `editorInput`, `editorLabel`, `loading`, `empty`, `error`

**CSS variables** (alternative to Tailwind): `--sdt-primary`, `--sdt-bg`, `--sdt-text`, `--sdt-text-muted`, `--sdt-border`, `--sdt-head-bg`, `--sdt-hover`, `--sdt-row-hover`, `--sdt-row-selected`, `--sdt-row-stripe`, `--sdt-cell-padding`

## Virtual Scroll

Render 10,000+ rows efficiently. Only visible DOM nodes are created.

```svelte
<DataTable
  data={bigData}
  {columns}
  paginate={false}
  virtualScroll
  virtualRowHeight={42}
/>
```

`paginate` must be `false` for virtual scroll (all rows in one scrollable view).

## Row Grouping & Column Filters

```svelte
<DataTable data={users} columns={columns} groupBy="role" />
```

Programmatic column filters via store:

```typescript
let store: DataTableStore | undefined = $state();

function filterByRole(role: string) {
  store?.setColumnFilter('role', role, '=');
}

// Clear filter
store?.setColumnFilter('role', '', '=');
```

```svelte
<DataTable {data} {columns} bind:storeRef={store} />
```

## Custom Cells & Row Customization

```svelte
{#snippet customCell({ row, column, value }: { row: any; column: any; value: any })}
  {#if column.key === 'status'}
    <span class="badge {value === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
      {value}
    </span>
  {:else}
    {value}
  {/if}
{/snippet}

<DataTable
  {data}
  {columns}
  customCell={customCell}
  rowId={(row: User) => `user-${row.id}`}
  rowClass={(row: User, _i: number) => row.salary > 100000 ? 'bg-amber-50' : ''}
  expandable
/>

<!-- Expandable row content -->
{#snippet expandContent({ row }: { row: any })}
  <div class="p-4">Details for {row.name}</div>
{/snippet}

<DataTable {data} {columns} expandable expandContent={expandContent} />
```

## Store API

Access the store via `bind:storeRef`:

```svelte
<script lang="ts">
  import type { DataTableStore } from '@beeblock/svelar-datatable';
  let store: DataTableStore | undefined = $state();
</script>

<DataTable {data} {columns} bind:storeRef={store} />
```

**Key methods:**

| Method | Description |
|--------|-------------|
| `subscribe(fn)` | Subscribe to state changes, returns unsubscribe fn |
| `getState()` | Get current `DataTableState` |
| `setData(rows)` | Replace data |
| `toggleSort(column, multiSort?)` | Toggle sort on column |
| `setGlobalSearch(search)` | Set search query |
| `setColumnFilter(column, value, operator)` | Set per-column filter |
| `setPage(page)` | Navigate to page |
| `setPerPage(perPage)` | Change rows per page |
| `toggleColumnVisibility(column)` | Show/hide column |
| `reorderColumns(order)` | Reorder columns by key array |
| `toggleSelect(rowId)` | Toggle row selection |
| `selectAll()` / `deselectAll()` | Select/deselect all |
| `selectRange(fromId, toId)` | Range selection (Shift+click) |
| `getSelectedRows()` | Get selected row data |
| `openEditor(rowId, column, mode)` | Open editor programmatically |
| `closeEditor()` | Close editor |
| `resetState()` | Reset all state |

**ServerDataTableStore** extends DataTableStore with:
- `initialFetch()` — fetch data from server
- `destroy()` — cleanup (abort fetch, clear timers)
- Auto-debounces search/sort/filter requests (300ms)

## Server Controller & Service

### Simple Usage

```typescript
// src/routes/api/datatable/users/+server.ts
import { DataTableController } from '@beeblock/svelar-datatable/server';
import { User } from '$lib/models/User';

const dt = new DataTableController(User);
export const GET = dt.handle();
```

Server search is case-insensitive on PostgreSQL (`ILIKE`) and uses each driver's normal `LIKE` behavior on SQLite/MySQL.

### Server Filters

Use `serverParams` on the component and matching `filters` on `DataTableController`.

```svelte
<script lang="ts">
  let priority = $state('');
  function serverParams() {
    return priority ? { priority } : {};
  }
</script>

<DataTable
  serverUrl="/api/datatable/cards"
  columns={columns}
  serverParams={serverParams}
  searchable
  sortable
/>
```

```typescript
const dt = new DataTableController(Card, {
  searchable: ['title', 'description', 'priority'],
  orderable: ['title', 'priority', 'updated_at'],
  filters: {
    priority: (query, value) => query.where('priority', value),
  },
});
```

### Meilisearch Server Search

If the model uses Svelar `Searchable`, global server search can use Meilisearch:

```typescript
const dt = new DataTableController(Card, {
  searchDriver: 'auto',
  filters: {
    priority: (query, value) => query.where('priority', value),
  },
  meilisearchFilter: (filters) => {
    if (!filters.priority) return undefined;
    return `priority = "${String(filters.priority).replaceAll('"', '\\"')}"`;
  },
});
```

`searchDriver: 'auto'` is the default: use Meilisearch when the model exposes `search()` and fall back to database search if Meilisearch is unavailable. Use `'database'` to force SQL or `'meilisearch'` to fail instead of falling back. Meilisearch mode returns indexed document fields, so keep table columns in the searchable/displayed attributes and configure filterable/sortable index settings.

### Extending and Customizing

Do not fork the plugin for app-specific UI. Use these extension points:

- `customCell` snippet for custom badges, links, row menus, previews, and action cells.
- `buttons` for custom toolbar actions; actions receive selected rows and all rows.
- `classNames` for Tailwind/shadcn styling.
- `bind:storeRef` for external page controls, refresh buttons, selected-row panels, and programmatic column visibility.
- `serverParams` plus server `filters` for app-specific server filters.
- `baseQuery`, `scopes`, `computedColumns`, `searchDriver`, `meilisearchFilter`, and `meilisearchSort` for server behavior.

```svelte
{#snippet customCell({ row, column, value })}
  {#if column.key === 'actions'}
    <button type="button" onclick={() => openCard(row)}>Open</button>
  {:else}
    {value}
  {/if}
{/snippet}

<DataTable
  {columns}
  data={cards}
  selectable="multi"
  buttons={[{
    key: 'archive',
    label: 'Archive selected',
    disabled: (rows) => rows.length === 0,
    action: (rows) => archiveCards(rows),
  }]}
  {customCell}
/>
```

### Server-Side Excel Editing

Dogfood server-side Excel editing through the same Svelar architecture used elsewhere: route -> FormRequest -> DTO -> action -> service -> policy/resource. Use action buttons in the same table to prove selection and bulk actions.

```svelte
<script lang="ts">
  import { apiFetchJson } from '@beeblock/svelar/http';
  import type { ButtonDef, ExportFormat } from '@beeblock/svelar-datatable';

  async function saveCell(row, columnKey, newValue) {
    const response = await apiFetchJson(`/api/datatable/cards/${row.public_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ column: columnKey, value: newValue }),
    });
    if (!response.ok) throw new Error(response.error?.message ?? 'Failed to update row');
  }

  const buttons: (ButtonDef | ExportFormat)[] = [
    'csv',
    {
      key: 'mark-urgent',
      label: 'Mark urgent',
      disabled: (rows) => rows.length === 0,
      action: (rows) => Promise.all(rows.map((row) => saveCell(row, 'priority', 'urgent'))),
    },
  ];
</script>

<DataTable
  serverUrl="/api/datatable/cards"
  {columns}
  selectable="multi"
  editorMode="excel"
  onCellEdit={saveCell}
  {buttons}
/>
```

### Advanced: DataTableService

```typescript
import { DataTableService } from '@beeblock/svelar-datatable/server';
import { User } from '$lib/models/User';
import type { RequestEvent } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

export async function GET(event: RequestEvent) {
  const request = DataTableRequest.fromEvent(event);

  const service = new DataTableService(User)
    .searchable(['name', 'email'])        // whitelist searchable columns
    .orderable(['name', 'email', 'created_at'])  // whitelist sortable columns
    .setBaseQuery((q) => q.where('active', 1))   // base WHERE
    .addComputedColumn('full_name', "first_name || ' ' || last_name")
    .addFilter('role', (q, value) => q.where('role', value))
    .applyFilters(request.customFilters)
    .addScope('admins', (q) => q.where('role', 'admin'));

  // Optionally apply scope
  if (event.url.searchParams.get('adminsOnly')) {
    service.applyScope('admins');
  }

  const result = await service.process(request);
  return json(result);
}
```

## Wire Protocol

Compatible with jQuery DataTables server-side protocol.

**Request** (GET query params or POST JSON body):
- `draw` — sequence counter (echo back in response)
- `start` — pagination offset
- `length` — rows per page
- `search[value]` — global search term
- `order[0][column]`, `order[0][dir]` — sort spec (column index + direction)
- `columns[N][data]`, `columns[N][searchable]`, `columns[N][orderable]` — per-column metadata

**Response** (JSON):
```json
{
  "draw": 1,
  "recordsTotal": 100,
  "recordsFiltered": 25,
  "data": [...]
}
```
