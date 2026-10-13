# DataTable Plugin

A full-featured DataTable plugin for Svelar/SvelteKit with sorting, searching, pagination, inline/modal/bubble/excel editing, export buttons, virtual scrolling, row grouping, and server-side processing out of the box.

**Package:** `@beeblock/svelar-datatable`

Requires Node.js 22.12 or newer, Svelar `^0.8.0` and Svelte 5. Excel export uses the optional ExcelJS peer. Keep backend capabilities, authentication, origin validation and CSRF enabled.

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-datatable
```

**Imports:**

```ts
// UI component
import { DataTable } from '@beeblock/svelar-datatable/ui';

// Types
import type { ColumnDef, EditorFieldDef, ButtonDef, DataTableClassNames } from '@beeblock/svelar-datatable';

// Stores (advanced usage)
import { DataTableStore, ServerDataTableStore } from '@beeblock/svelar-datatable';

// Server-side controller (API routes)
import { DataTableController } from '@beeblock/svelar-datatable/server';
```

---

## Quick Start

### Client-Side (Minimal)

Pass `columns` and `data` directly. All sorting, filtering, and pagination happen in the browser.

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { ColumnDef } from '@beeblock/svelar-datatable';

  const columns: ColumnDef[] = [
    { key: 'id', header: 'ID', type: 'number', sortable: true },
    { key: 'name', header: 'Name', searchable: true },
    { key: 'email', header: 'Email', searchable: true },
  ];

  const data = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
    { id: 3, name: 'Charlie', email: 'charlie@example.com' },
  ];
</script>

<DataTable {columns} {data} />
```

### Server-Side (Minimal)

Pass `serverUrl` to fetch data from your API. The component handles pagination, sorting, and search sync with the server automatically.

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { ColumnDef } from '@beeblock/svelar-datatable';

  const columns: ColumnDef[] = [
    { key: 'id', header: 'ID', type: 'number' },
    { key: 'name', header: 'Name', searchable: true },
    { key: 'email', header: 'Email', searchable: true },
  ];
</script>

<DataTable {columns} serverUrl="/api/users" />
```

---

## Column Definition (`ColumnDef`)

Each column is defined with a `ColumnDef` object. All properties except `key` and `header` are optional.

| Property | Type | Default | Description |
|---|---|---|---|
| `key` | `string` | required | The object property to display |
| `header` | `string` | required | Column header label |
| `type` | `ColumnType` | `'string'` | Data type for sorting/casting |
| `sortable` | `boolean` | `true` | Whether this column can be sorted |
| `searchable` | `boolean` | `true` | Whether global search includes this column |
| `filterable` | `boolean` | `false` | Whether per-column filtering is enabled |
| `visible` | `boolean` | `true` | Whether the column is initially visible |
| `width` | `string` | — | CSS width (e.g. `'200px'`, `'20%'`) |
| `minWidth` | `string` | — | CSS min-width |
| `maxWidth` | `string` | — | CSS max-width |
| `className` | `string` | — | CSS class applied to each cell in this column |
| `headerClassName` | `string` | — | CSS class applied to the header cell |
| `orderable` | `boolean` | `true` | Whether the server may order this column; interactive column dragging/resizing is not implemented |
| `defaultSort` | `'asc' \| 'desc'` | — | Apply a default sort when the table initializes |
| `footer` | `string \| ((rows) => string \| number)` | — | Static text or computed footer value |
| `editable` | `boolean` | `true` | Whether the cell is editable (inline/excel modes) |
| `editorField` | `EditorFieldDef` | — | Field definition for modal/bubble editor forms |

### Column Types

- `'string'` — default; sorted alphabetically via `localeCompare`
- `'number'` — sorted numerically; casts values to `Number`
- `'date'` — sorted by date timestamp
- `'boolean'` — sorted as `0`/`1`; excel mode accepts `'true'`/`'1'`
- `'html'` — renders raw HTML in the cell (use with caution)
- `'custom'` — use with the `customCell` snippet for full control

### Footer Functions

A column `footer` can be a string or a function that receives all filtered rows:

```ts
const columns: ColumnDef[] = [
  { key: 'name', header: 'Product' },
  {
    key: 'price',
    header: 'Price',
    type: 'number',
    footer: (rows) => {
      const total = rows.reduce((sum, r) => sum + (r.price ?? 0), 0);
      return `Total: $${total.toFixed(2)}`;
    },
  },
  {
    key: 'quantity',
    header: 'Qty',
    type: 'number',
    footer: (rows) => rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0),
  },
];
```

---

## Data Sources

### Client-Side

Pass a `data` array directly. All sorting, filtering, searching, and pagination are handled entirely in the browser.

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';

  let users = $state([
    { id: 1, name: 'Alice', role: 'Admin' },
    { id: 2, name: 'Bob', role: 'User' },
  ]);

  const columns = [
    { key: 'id', header: 'ID', type: 'number' as const },
    { key: 'name', header: 'Name' },
    { key: 'role', header: 'Role' },
  ];
</script>

<DataTable {columns} data={users} />
```

If the `data` prop changes reactively, the table re-renders with the new data.

### Server-Side

Pass `serverUrl` to fetch data from a remote endpoint. The component sends requests using the jQuery DataTables wire protocol, making it compatible with many existing server-side implementations.

```svelte
<DataTable
  {columns}
  serverUrl="/api/users"
  serverMethod="POST"
  perPage={25}
/>
```

**Props:**

- `serverUrl` — the endpoint URL
- `serverMethod` — `'GET'` (default) sends parameters as query strings; `'POST'` sends a JSON body
- `csrfCookieName` — cookie name to read the CSRF token from (default: `'XSRF-TOKEN'`)
- `csrfHeaderName` — header name to send the CSRF token as (default: `'X-CSRF-Token'`)

The CSRF token is automatically read from the `XSRF-TOKEN` cookie and sent in the `X-CSRF-Token` header. This matches the Svelar CSRF convention out of the box. Override with `csrfCookieName` and `csrfHeaderName` if your backend uses different names.

Use `serverParams` when the page needs custom server filters. GET requests send these values as `filters[name]` query params; POST requests include them in the JSON body as `customFilters`.

```svelte
<script lang="ts">
  let priority = $state('');

  function serverParams() {
    return priority ? { priority } : {};
  }
</script>

<DataTable
  {columns}
  serverUrl="/api/datatable/cards"
  serverParams={serverParams}
  searchable
  sortable
/>
```

### Server-Side Route Handler

Create a controller instance and bind `handle('query')`; this read-only query uses the DataTables wire response (`draw`, `recordsTotal`, `recordsFiltered`, `data`), an explicit protocol exception to the normal `{ data, meta }` resource envelope. Restrict server-owned searchable/orderable columns and apply the host capability resolver before table access. GET lengths are clamped to 1-1000; POST JSON is validated with the same bounds. Invalid requests return 400 and database/index failures return a generic 500 without SQL, credentials or stack traces.

Use `DataTableController` from `@beeblock/svelar-datatable/server` to create an API route:

```ts
// src/routes/api/users/+server.ts
import { DataTableController } from '@beeblock/svelar-datatable/server';
import { User } from '$lib/models/User';

const ctrl = new DataTableController(User);

export const GET = ctrl.handle('query');
export const POST = ctrl.handle('query');
```

Server search is case-insensitive on PostgreSQL by using `ILIKE`. SQLite and MySQL use the driver's normal `LIKE` behavior.

### Server Filters

Register custom server filters with the `filters` option. Only named filters are applied, so UI-provided filter keys must be explicitly supported by the endpoint.

```ts
import { DataTableController } from '@beeblock/svelar-datatable/server';
import { Card } from '$lib/modules/boards/domain/models/Card.js';

const ctrl = new DataTableController(Card, {
  searchable: ['title', 'description', 'priority'],
  orderable: ['title', 'priority', 'updated_at'],
  filters: {
    priority: (query, value) => query.where('priority', value),
  },
});

export const GET = ctrl.handle('query');
```

For lower-level endpoints, add filters to `DataTableService` and apply them from the parsed request:

```ts
const service = new DataTableService(Card)
  .addFilter('priority', (query, value) => query.where('priority', value))
  .applyFilters(request.customFilters);
```

### Meilisearch Server Search

If the model uses Svelar's `Searchable` mixin, server-side global search can use Meilisearch.

```ts
const ctrl = new DataTableController(Card, {
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

`searchDriver: 'auto'` is the default. It tries Meilisearch for global search when the model exposes `search()` and the query has no database-only constraints. It uses database search for tenant or soft-delete guards, model global scopes, base queries, active scopes, per-column searches, computed columns, and custom filters without an index filter mapping. An unavailable index or missing mapping for active custom filters also falls back to database search. Use `searchDriver: 'database'` to force SQL search. Explicit `searchDriver: 'meilisearch'` fails when indexed search cannot preserve these constraints or the model does not expose `search()`.

Meilisearch mode returns indexed document fields from `model.search()`. Keep datatable columns in the model's searchable/displayed attributes, and mark filter/sort fields as filterable/sortable in the index settings.

### Extending and Customizing

The plugin is meant to stay a reusable table black box, but it exposes extension points instead of forcing app-specific forks.

**Frontend extension points:**

- `customCell` snippet for custom badges, links, menus, previews, or composed app UI
- `buttons` for export buttons and custom actions that receive selected rows and all rows
- `classNames` for Tailwind/shadcn styling without editing plugin CSS
- `bind:storeRef` for page-level controls such as external filters, refresh buttons, selected-row panels, or programmatic column visibility
- `editorField` and `editorMode` for inline, modal, bubble, or Excel-style editing

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { ButtonDef, ColumnDef } from '@beeblock/svelar-datatable';

  const columns: ColumnDef[] = [
    { key: 'title', header: 'Title' },
    { key: 'priority', header: 'Priority', type: 'custom' },
    { key: 'actions', header: 'Actions', type: 'custom', sortable: false, searchable: false },
  ];

  const buttons: ButtonDef[] = [
    {
      key: 'archive',
      label: 'Archive selected',
      disabled: (rows) => rows.length === 0,
      action: (rows) => archiveCards(rows),
    },
  ];
</script>

{#snippet customCell({ row, column, value })}
  {#if column.key === 'priority'}
    <span class="rounded border px-2 py-0.5 text-xs">{value}</span>
  {:else if column.key === 'actions'}
    <button type="button" onclick={() => openCard(row)}>Open</button>
  {:else}
    {value}
  {/if}
{/snippet}

<DataTable {columns} data={cards} {buttons} {customCell} selectable="multi" />
```

**Server extension points:**

- `filters` on `DataTableController` or `DataTableService.addFilter()` for app-specific server filters
- `baseQuery` for tenant/team/user scoping
- `scopes` for named reusable query constraints
- `computedColumns` for derived SQL columns
- `searchDriver`, `meilisearchFilter`, and `meilisearchSort` for Searchable/Meilisearch-backed server search

```ts
const ctrl = new DataTableController(Card, {
  baseQuery: (query) => query.where('board_id', board.id),
  searchable: ['title', 'description', 'priority'],
  orderable: ['title', 'priority', 'position', 'updated_at'],
  filters: {
    priority: (query, value) => query.where('priority', value),
    completed: (query, value) => query.where('completed', value === 'true'),
  },
  searchDriver: 'auto',
  meilisearchFilter: (filters) => {
    const clauses = [];
    if (filters.priority) clauses.push(`priority = "${filters.priority}"`);
    if (filters.completed) clauses.push(`completed = ${filters.completed === 'true'}`);
    return clauses.length ? clauses.join(' AND ') : undefined;
  },
});
```

### `DataTableServiceOptions`

Pass options to the `DataTableController` constructor or construct a `DataTableService` directly for advanced use:

```ts
import { DataTableController } from '@beeblock/svelar-datatable/server';
import { User } from '$lib/models/User';

const ctrl = new DataTableController(User, {
  // Only these columns are searchable
  searchable: ['name', 'email'],
  // Only these columns can be sorted
  orderable: ['name', 'email', 'created_at'],
  // Base query applied to every request (e.g. scoping to active users)
  baseQuery: (query) => query.where('active', true),
  // Named scopes you can activate
  scopes: {
    admins: (query) => query.where('role', 'admin'),
    recent: (query) => query.where('created_at', '>', '2025-01-01'),
  },
  // Computed columns added as SQL expressions
  computedColumns: {
    full_name: "first_name || ' ' || last_name",
  },
});

export const GET = ctrl.handle('query');
export const POST = ctrl.handle('query');
```

### Advanced: `DataTableService` API

For full control, use `DataTableService` directly:

```ts
import { DataTableService } from '@beeblock/svelar-datatable/server';
import { parseDataTableRequest } from '@beeblock/svelar-datatable/server';
import { User } from '$lib/models/User';

export async function GET(event) {
  const request = parseDataTableRequest(event.url.searchParams);

  const service = new DataTableService(User);
  service
    .searchable(['name', 'email'])
    .orderable(['name', 'created_at'])
    .setBaseQuery((q) => q.where('active', true))
    .addFilter('role', (q, value) => q.where('role', value))
    .applyFilters(request.customFilters)
    .addScope('admins', (q) => q.where('role', 'admin'))
    .applyScope('admins')
    .addComputedColumn('full_name', "first_name || ' ' || last_name");

  const response = await service.process(request);
  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

---

## Features

### Sorting

Enabled by default. Click a column header to sort ascending, click again for descending, click a third time to remove the sort. Hold **Shift** and click another header for multi-column sorting.

```svelte
<DataTable
  {columns}
  {data}
  sortable={true}
  onSort={(sort) => {
    console.log('Current sort state:', sort);
  }}
/>
```

Disable sorting on a specific column:

```ts
{ key: 'actions', header: 'Actions', sortable: false }
```

### Searching

A global search input appears in the toolbar when `searchable` is enabled (default: `true`). It filters across all columns where `searchable` is not `false`.

```svelte
<DataTable
  {columns}
  {data}
  searchable={true}
  searchDebounceMs={300}
/>
```

Exclude a column from global search:

```ts
{ key: 'avatar', header: 'Avatar', searchable: false }
```

### Pagination

Enabled by default. Control the number of rows per page and the available options.

```svelte
<DataTable
  {columns}
  {data}
  paginate={true}
  perPage={25}
  perPageOptions={[10, 25, 50, 100]}
  onPageChange={(page, perPage) => {
    console.log(`Page ${page}, showing ${perPage} rows`);
  }}
/>
```

Pagination works identically for both client-side and server-side modes — the server automatically receives `start` and `length` parameters.

### Selection

Enable row selection with the `selectable` prop. Supports single selection, multi-selection, and Shift+click range selection.

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { DataTableStore } from '@beeblock/svelar-datatable';

  let store: DataTableStore | undefined = $state();

  function handleSelect(selectedRows: any[]) {
    console.log('Selected:', selectedRows);
  }

  function getSelection() {
    if (store) {
      const rows = store.getSelectedRows();
      console.log('Currently selected:', rows);
    }
  }
</script>

<DataTable
  {columns}
  {data}
  selectable="multi"
  onSelect={handleSelect}
  bind:storeRef={store}
/>
<button onclick={getSelection}>Get Selected</button>
```

**Selection modes:**

- `"none"` — no selection (default)
- `"single"` — only one row at a time
- `"multi"` — multiple rows; Shift+click for range selection

### Row Grouping

Group rows by a column value. Grouped rows display a styled header row for each group.

```svelte
<DataTable {columns} {data} groupBy="department" />
```

### Virtual Scroll

For large datasets (5000+ rows), enable virtual scrolling to only render visible rows in the DOM. Best used with `paginate={false}`.

```svelte
<DataTable
  {columns}
  {data}
  virtualScroll={true}
  virtualRowHeight={48}
  paginate={false}
/>
```

### Row Expand

Show expandable detail rows beneath each row. Provide an `expandContent` snippet for custom content.

```svelte
<DataTable {columns} {data} expandable={true}>
  {#snippet expandContent({ row })}
    <div style="padding: 1rem;">
      <h4>Details for {row.name}</h4>
      <p>Email: {row.email}</p>
      <p>Created: {row.created_at}</p>
    </div>
  {/snippet}
</DataTable>
```

### Custom Cell Rendering

Use the `customCell` snippet to render any column with custom markup. The snippet receives `{ row, column, value }`.

```svelte
<DataTable {columns} {data}>
  {#snippet customCell({ row, column, value })}
    {#if column.key === 'status'}
      <span
        class="badge"
        style:background={value === 'active' ? '#22c55e' : '#ef4444'}
        style:color="white"
        style:padding="0.125rem 0.5rem"
        style:border-radius="9999px"
        style:font-size="0.75rem"
      >
        {value}
      </span>
    {:else if column.key === 'price'}
      <span>${Number(value).toFixed(2)}</span>
    {:else}
      {value}
    {/if}
  {/snippet}
</DataTable>
```

For columns that use the `customCell` snippet, set `type: 'custom'` to avoid default rendering:

```ts
{ key: 'status', header: 'Status', type: 'custom' }
```

### Row Appearance

Control row styling with several props:

```svelte
<DataTable
  {columns}
  {data}
  striped={true}
  hover={true}
  compact={false}
  bordered={false}
  rowId="id"
  rowClass={(row, index) => {
    if (row.status === 'urgent') return 'row-urgent';
    return '';
  }}
/>
```

**Props:**

- `striped` — alternating row background (default: `true`)
- `hover` — highlight rows on hover (default: `true`)
- `compact` — reduced cell padding (default: `false`)
- `bordered` — borders around every cell (default: `false`)
- `rowId` — string key (e.g. `'id'`) or function `(row) => string | number` to uniquely identify each row
- `rowClass` — static CSS class string or function `(row, index) => string`

### Unstyled Mode

The `unstyled` prop omits the standard container, table-wrapper and table class names. Child components retain scoped styles. Customize supported surfaces with `classNames` and editor inputs with `EditorFieldDef.className`.

```svelte
<DataTable
  {columns}
  {data}
  unstyled={true}
  classNames={{
    container: 'bg-white rounded-lg border border-gray-200',
    toolbar: 'flex items-center justify-between p-4',
    searchInput: 'border rounded px-3 py-1.5 text-sm',
    table: 'w-full',
    thead: 'bg-gray-50',
    th: 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase',
    tbody: '',
    tr: 'border-b border-gray-100',
    trSelected: 'bg-blue-50',
    td: 'px-4 py-3 text-sm text-gray-700',
    pagination: 'flex items-center justify-between px-4 py-3',
    pageButton: 'px-3 py-1 rounded text-sm',
    btnCreate: 'bg-blue-500 text-white hover:bg-blue-600',
    btnEdit: 'bg-yellow-500 text-white hover:bg-yellow-600',
    btnDelete: 'bg-red-500 text-white hover:bg-red-600',
    editorModal: 'fixed inset-0 z-50 flex items-center justify-center',
    editorBackdrop: 'fixed inset-0 bg-black/50',
    error: 'bg-red-50 text-red-600 px-4 py-2 text-sm',
  }}
/>
```

### Column Reordering

Reorder columns programmatically via the store:

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { DataTableStore } from '@beeblock/svelar-datatable';

  let store: DataTableStore | undefined = $state();

  function reorder() {
    store?.reorderColumns(['email', 'name', 'id']);
  }
</script>

<DataTable {columns} {data} bind:storeRef={store} />
<button onclick={reorder}>Reorder Columns</button>
```

### Column Visibility

Toggle column visibility via the store or the built-in column toggle dropdown in the toolbar.

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { DataTableStore } from '@beeblock/svelar-datatable';

  let store: DataTableStore | undefined = $state();

  // Toggle a single column
  function toggleEmail() {
    store?.toggleColumnVisibility('email');
  }

  // Set all at once
  function showOnlyNameAndId() {
    store?.setColumnVisibility({ id: true, name: true, email: false });
  }
</script>

<DataTable {columns} {data} bind:storeRef={store} />
```

### State Persistence

Save and restore sort, filters, search, page, column visibility, and column order to `localStorage`:

```svelte
<DataTable
  {columns}
  {data}
  stateSaveKey="users-table-state"
/>
```

The state is automatically saved on every change and restored when the component mounts with the same key.

### Export Buttons

Add export and action buttons to the toolbar.

```svelte
<DataTable
  {columns}
  {data}
  buttons={['csv', 'clipboard', 'print']}
/>
```

Built-in export formats: `'csv'`, `'clipboard'`, `'print'`, `'excel'`, `'pdf'`.

For custom buttons, use `ButtonDef` objects:

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { ButtonDef } from '@beeblock/svelar-datatable';

  const buttons: (ButtonDef | string)[] = [
    'csv',
    'clipboard',
    {
      key: 'archive',
      label: 'Archive Selected',
      variant: 'destructive',
      disabled: (selectedRows) => selectedRows.length === 0,
      action: async (selectedRows) => {
        await fetch('/api/users/archive', {
          method: 'POST',
          body: JSON.stringify({ ids: selectedRows.map((r) => r.id) }),
        });
      },
    },
  ];
</script>

<DataTable {columns} {data} selectable="multi" {buttons} />
```

**`ButtonDef` interface:**

| Property | Type | Description |
|---|---|---|
| `key` | `string` | Unique identifier |
| `label` | `string` | Button text |
| `icon` | `Component` | Optional Svelte icon component |
| `action` | `string \| ((selectedRows, allData) => void \| Promise<void>)` | Click handler or built-in action name |
| `variant` | `'default' \| 'destructive' \| 'outline' \| 'secondary' \| 'ghost'` | Visual style |
| `disabled` | `boolean \| ((selectedRows) => boolean)` | Static or dynamic disabled state |
| `collection` | `ButtonDef[]` | Nested dropdown buttons |

---

## Editor Modes

### Modal Editor (`editorMode="modal"`)

Opens a full-form modal dialog for creating, editing, and deleting records.

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { ColumnDef, EditorFieldDef } from '@beeblock/svelar-datatable';

  const columns: ColumnDef[] = [
    { key: 'id', header: 'ID', type: 'number', editable: false },
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'role', header: 'Role' },
  ];

  const editorFields: EditorFieldDef[] = [
    { name: 'name', type: 'text', label: 'Name', required: true, placeholder: 'Full name' },
    { name: 'email', type: 'text', label: 'Email', required: true, placeholder: 'user@example.com' },
    {
      name: 'role',
      type: 'select',
      label: 'Role',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editor', value: 'editor' },
        { label: 'Viewer', value: 'viewer' },
      ],
    },
  ];

  let data = $state([
    { id: 1, name: 'Alice', email: 'alice@example.com', role: 'admin' },
    { id: 2, name: 'Bob', email: 'bob@example.com', role: 'viewer' },
  ]);

  async function handleCreate(formData: Record<string, any>) {
    const res = await fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify(formData),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const body = await res.json();
      // Throw errors to show validation messages in the editor
      throw { errors: body.errors };
    }
    const user = await res.json();
    data = [...data, user];
  }

  async function handleEdit(row: any, formData: Record<string, any>) {
    const res = await fetch(`/api/users/${row.id}`, {
      method: 'PUT',
      body: JSON.stringify(formData),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const body = await res.json();
      throw { errors: body.errors };
    }
    const updated = await res.json();
    data = data.map((u) => (u.id === row.id ? updated : u));
  }

  async function handleDelete(rows: any[]) {
    const ids = rows.map((r) => r.id);
    await fetch('/api/users', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
    data = data.filter((u) => !ids.includes(u.id));
  }
</script>

<DataTable
  {columns}
  {data}
  editorMode="modal"
  {editorFields}
  onCreate={handleCreate}
  onEdit={handleEdit}
  onDelete={handleDelete}
  selectable="multi"
/>
```

### Bubble Editor (`editorMode="bubble"`)

A floating popover form that anchors to the selected row. Provides the same form fields as the modal editor but in a compact popover. Click the backdrop to close.

```svelte
<DataTable
  {columns}
  {data}
  editorMode="bubble"
  {editorFields}
  onCreate={handleCreate}
  onEdit={handleEdit}
  onDelete={handleDelete}
/>
```

Uses the same `editorFields`, `onCreate`, `onEdit`, and `onDelete` callbacks as the modal editor.

### Inline Editor (`editorMode="inline"`)

Double-click any editable cell to edit its value in place. Press **Enter** to save, **Escape** to cancel. Blurring the input also saves.

The New and Edit buttons in the toolbar fall back to a modal form using the `editorFields` configuration.

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';

  const columns = [
    { key: 'id', header: 'ID', type: 'number' as const, editable: false },
    { key: 'name', header: 'Name', editable: true },
    { key: 'price', header: 'Price', type: 'number' as const, editable: true },
  ];

  let data = $state([
    { id: 1, name: 'Widget', price: 9.99 },
    { id: 2, name: 'Gadget', price: 19.99 },
  ]);

  async function handleCellEdit(row: any, columnKey: string, newValue: any, oldValue: any) {
    await fetch(`/api/products/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [columnKey]: newValue }),
      headers: { 'Content-Type': 'application/json' },
    });
  }
</script>

<DataTable
  {columns}
  {data}
  editorMode="inline"
  onCellEdit={handleCellEdit}
/>
```

### Excel Mode (`editorMode="excel"`)

Spreadsheet-style navigation and editing. Click a cell to focus it, press **Enter** or start typing to edit, use **Arrow keys** to navigate, **Tab** to move right, and **Escape** to cancel.

When navigating past the last row on a page, the table automatically moves to the next page (and vice versa for the first row).

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';

  const columns = [
    { key: 'id', header: 'ID', type: 'number' as const, editable: false },
    { key: 'name', header: 'Name', editable: true },
    { key: 'quantity', header: 'Qty', type: 'number' as const, editable: true },
    { key: 'price', header: 'Price', type: 'number' as const, editable: true },
  ];

  let data = $state([
    { id: 1, name: 'Widget', quantity: 10, price: 9.99 },
    { id: 2, name: 'Gadget', quantity: 5, price: 19.99 },
    { id: 3, name: 'Doohickey', quantity: 8, price: 14.99 },
  ]);

  async function handleCellEdit(row: any, columnKey: string, newValue: any, oldValue: any) {
    // For server-side mode, if this throws, the cell value is automatically reverted
    const res = await fetch(`/api/products/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [columnKey]: newValue }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to save');
  }
</script>

<DataTable
  {columns}
  {data}
  editorMode="excel"
  onCellEdit={handleCellEdit}
  perPage={50}
/>
```

For server-side Excel mode, keep edits on the same Svelar backend flow as the rest of the app: API route -> controller -> shared-schema FormRequest -> DTO -> action/service -> repository/model -> resource. Enforce current capabilities and model policies before persistence. Throw from `onCellEdit` when the API rejects the change so the table keeps the previous cell value.

```svelte
<script lang="ts">
  import { apiFetchJson } from '@beeblock/svelar/http';
  import type { ButtonDef, ExportFormat } from '@beeblock/svelar-datatable';

  async function saveCell(row, columnKey, newValue) {
    const response = await apiFetchJson(`/api/datatable/cards/${row.public_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ column: columnKey, value: newValue }),
    });

    if (!response.ok) {
      throw new Error(response.error?.message ?? 'Failed to update row');
    }
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

**Excel mode keyboard shortcuts:**

| Key | Action |
|---|---|
| Click | Focus cell |
| Enter | Start editing / confirm edit |
| Escape | Cancel editing |
| Arrow keys | Navigate between cells |
| Tab | Move to next editable cell |
| Type any character | Start editing with that character |

---

## `EditorFieldDef`

Each field in the editor form (modal or bubble) is defined with an `EditorFieldDef`:

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Form field name (matches column key) |
| `type` | `FieldType` | Input type |
| `label` | `string` | Display label |
| `placeholder` | `string` | Input placeholder text |
| `options` | `{ label: string; value: any }[]` | Options for select, multi-select, radio fields |
| `multiple` | `boolean` | Allow multiple selections (multi-select) |
| `required` | `boolean` | Mark field as required |
| `disabled` | `boolean` | Disable the field |
| `className` | `string` | CSS class for the field wrapper |
| `dependsOn` | `string` | Name of another field this depends on |
| `dependsOnValue` | `any` | Only show when the depended field has this value |
| `showWhen` | `(formData) => boolean` | Dynamic visibility function |
| `defaultValue` | `any` | Default value for new records |

**Available field types:**

`'text'`, `'textarea'`, `'number'`, `'select'`, `'multi-select'`, `'checkbox'`, `'radio'`, `'date'`, `'datetime'`, `'upload'`, `'hidden'`, `'readonly'`

### Conditional Fields

```ts
const editorFields: EditorFieldDef[] = [
  {
    name: 'type',
    type: 'select',
    label: 'Account Type',
    options: [
      { label: 'Individual', value: 'individual' },
      { label: 'Company', value: 'company' },
    ],
  },
  {
    name: 'company_name',
    type: 'text',
    label: 'Company Name',
    // Only show when type is 'company'
    dependsOn: 'type',
    dependsOnValue: 'company',
  },
  {
    name: 'tax_id',
    type: 'text',
    label: 'Tax ID',
    // Or use showWhen for more complex logic
    showWhen: (formData) => formData.type === 'company' && formData.country === 'US',
  },
];
```

---

## Callbacks Reference

| Callback | Signature | Used by |
|---|---|---|
| `onSort` | `(sort: SortState[]) => void` | All modes |
| `onFilter` | `(filters: FilterState[]) => void` | All modes |
| `onPageChange` | `(page: number, perPage: number) => void` | All modes |
| `onSelect` | `(selectedRows: T[]) => void` | All modes with selection |
| `onRowClick` | `(row: T, event: MouseEvent) => void` | All modes |
| `onEdit` | `(row: T, data: Record<string, any>) => void \| Promise<void>` | Modal, bubble editors |
| `onCreate` | `(data: Record<string, any>) => void \| Promise<void>` | Modal, bubble editors |
| `onDelete` | `(rows: T[]) => void \| Promise<void>` | Modal, bubble editors |
| `onCellEdit` | `(row: T, columnKey: string, newValue: any, oldValue: any) => void \| Promise<void>` | Inline, excel editors |

For `onEdit` and `onCreate`, throw an object with `errors` to display validation messages:

```ts
async function handleEdit(row, formData) {
  const res = await fetch(`/api/users/${row.id}`, {
    method: 'PUT',
    body: JSON.stringify(formData),
  });
  if (!res.ok) {
    const body = await res.json();
    throw { errors: body.errors };
    // e.g. { errors: { email: 'Email is already taken' } }
  }
}
```

---

## Store API (`DataTableStore`)

Access the store via `bind:storeRef`:

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { DataTableStore } from '@beeblock/svelar-datatable';

  let store: DataTableStore | undefined = $state();
</script>

<DataTable {columns} {data} bind:storeRef={store} />
```

### Data

| Method | Description |
|---|---|
| `setData(rows: T[])` | Replace all rows (client-side only) |
| `getState(): DataTableState` | Get the full current state snapshot |
| `subscribe(listener: () => void): () => void` | Subscribe to state changes; returns unsubscribe function |
| `setLoading(loading: boolean)` | Set loading state |
| `setError(error: string \| null)` | Set or clear error message |
| `resetState()` | Clear sort, filters, search, selection; reset page to 1 |

### Sort and Filter

| Method | Description |
|---|---|
| `setSort(sort: SortState[])` | Set sort state directly |
| `toggleSort(column: string, multiSort?: boolean)` | Toggle sort on a column; pass `true` for multi-sort |
| `setGlobalSearch(search: string)` | Set global search term |
| `setFilters(filters: FilterState[])` | Replace all filters |
| `setColumnFilter(column, value, operator?)` | Set or clear a single column filter |

### Pagination

| Method | Description |
|---|---|
| `setPage(page: number)` | Navigate to a page (clamped to valid range) |
| `setPerPage(perPage: number)` | Change rows per page; resets to page 1 |

### Selection

| Method | Description |
|---|---|
| `toggleSelect(rowId)` | Toggle a row's selection |
| `selectSingle(rowId)` | Select only this row |
| `selectAll()` | Select all filtered rows |
| `deselectAll()` | Clear all selections |
| `selectRange(fromId, toId)` | Select a range of rows between two IDs |
| `getSelectedRows(): T[]` | Get currently selected row objects |

### Editor

| Method | Description |
|---|---|
| `openEditor(rowId, column, mode)` | Open editor for a row (or `null` for create) |
| `closeEditor()` | Close the editor |
| `setFormField(name, value)` | Update a form field value |
| `setValidationErrors(errors)` | Set validation error messages |

### Excel Mode

| Method | Description |
|---|---|
| `focusCell(rowIndex, columnKey)` | Focus a specific cell |
| `startCellEdit()` | Enter edit mode on the focused cell |
| `commitCellEdit()` | Save the current cell edit; returns change object or `null` |
| `cancelCellEdit()` | Cancel the current cell edit |
| `clearExcelFocus()` | Remove all excel focus/edit state |
| `navigateCell(direction)` | Move focus; returns `'page-next'`, `'page-prev'`, or `null` |

### Column

| Method | Description |
|---|---|
| `toggleColumnVisibility(key)` | Toggle a column's visibility |
| `setColumnVisibility(record)` | Set visibility for multiple columns at once |
| `reorderColumns(columnOrder: string[])` | Set column order |
| `getVisibleColumns(): ColumnDef[]` | Get currently visible columns in order |

---

## `ServerDataTableStore`

Extends `DataTableStore` for server-side data fetching. Created automatically when you pass `serverUrl` to the `DataTable` component. You generally do not need to instantiate it directly.

**Key differences from `DataTableStore`:**

- `setSort`, `setGlobalSearch`, `setFilters`, `setPage`, `setPerPage` all trigger a server fetch instead of local recomputation
- Sort/search/filter changes are debounced (300ms) to avoid excessive requests
- Page changes are immediate (no debounce)
- Concurrent requests are automatically aborted (only the latest response is applied)

**Additional methods:**

| Method | Description |
|---|---|
| `initialFetch()` | Perform the first data fetch (called automatically on mount) |
| `destroy()` | Abort pending requests and clean up timers |

---

## CSS Customization

### CSS Variables

Override the built-in styles with CSS custom properties:

```css
:root {
  --sdt-bg: #ffffff;
  --sdt-border: #e5e7eb;
  --sdt-primary: #3b82f6;
  --sdt-text: #111827;
  --sdt-text-muted: #6b7280;
  --sdt-hover: #f9fafb;
  --sdt-cell-padding: 0.75rem 1rem;
  --sdt-font: inherit;
  --sdt-row-stripe: rgba(0, 0, 0, 0.02);
  --sdt-row-hover: #f9fafb;
}
```

### `classNames` Prop

The component uses these 26 `classNames` hooks: `container`, `toolbar`, `toolbarLeft`, `toolbarRight`, `searchInput`, `table` (the scroll wrapper), `thead`, `th`, `tbody`, `tr`, `trSelected`, `trEven`, `td`, `tfoot`, `tf`, `pagination`, `paginationInfo`, `paginationControls`, `pageButton`, `perPageSelect`, `btnCreate`, `btnEdit`, `btnDelete`, `editorModal`, `editorBackdrop`, and `error`.

The type also declares `thSortable`, `pageButtonActive`, `btn`, `editorField`, `editorInput`, `editorLabel`, `loading`, and `empty`; the current components do not consume those keys. Active page buttons use the `sdt-page-active` class. Editor inputs accept `EditorFieldDef.className`.

The complete `DataTableClassNames` type is:

```ts
interface DataTableClassNames {
  container?: string;
  toolbar?: string;
  toolbarLeft?: string;
  toolbarRight?: string;
  searchInput?: string;
  table?: string;
  thead?: string;
  th?: string;
  thSortable?: string;
  tbody?: string;
  tr?: string;
  trSelected?: string;
  trEven?: string;
  td?: string;
  tfoot?: string;
  tf?: string;
  pagination?: string;
  paginationInfo?: string;
  paginationControls?: string;
  pageButton?: string;
  pageButtonActive?: string;
  perPageSelect?: string;
  btn?: string;
  btnCreate?: string;
  btnEdit?: string;
  btnDelete?: string;
  editorModal?: string;
  editorBackdrop?: string;
  editorField?: string;
  editorInput?: string;
  editorLabel?: string;
  loading?: string;
  empty?: string;
  error?: string;
}
```

### Tailwind Dark Theme Example

Style the supported surfaces with Tailwind utility classes via the `classNames` prop:

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { ColumnDef } from '@beeblock/svelar-datatable';

  const columns: ColumnDef[] = [
    { key: 'id', header: '#', type: 'number', sortable: true, width: '50px' },
    { key: 'name', header: 'Full Name', sortable: true, searchable: true },
    { key: 'email', header: 'Email', sortable: true, searchable: true },
    { key: 'role', header: 'Role', sortable: true },
    { key: 'status', header: 'Status', sortable: true },
    {
      key: 'salary', header: 'Salary', type: 'number', sortable: true,
      footer: (rows) => `Total: $${rows.reduce((sum, r) => sum + r.salary, 0).toLocaleString()}`
    },
  ];

  const data = [
    { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin', status: 'Active', salary: 95000 },
    { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'Editor', status: 'Active', salary: 72000 },
    { id: 3, name: 'Charlie Brown', email: 'charlie@example.com', role: 'Viewer', status: 'Inactive', salary: 55000 },
  ];
</script>

{#snippet customCell({ row, column, value }: { row: any; column: any; value: any })}
  {#if column.key === 'status'}
    <span class="inline-flex items-center gap-1 text-xs font-semibold uppercase
      {value === 'Active' ? 'text-emerald-400' : 'text-red-400'}">
      <span class="w-1.5 h-1.5 rounded-full
        {value === 'Active' ? 'bg-emerald-400' : 'bg-red-400'}"></span>
      {value}
    </span>
  {:else if column.key === 'role'}
    <span class="px-2 py-0.5 rounded text-xs font-medium
      {value === 'Admin'
        ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
        : value === 'Editor'
          ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/30'
          : 'bg-gray-500/20 text-gray-400 ring-1 ring-gray-500/30'}">
      {value}
    </span>
  {:else if column.key === 'salary'}
    <span class="font-mono text-emerald-300">${value?.toLocaleString()}</span>
  {:else}
    {value}
  {/if}
{/snippet}

<div class="rounded-xl overflow-hidden shadow-2xl">
  <DataTable
    {data}
    {columns}
    sortable
    searchable
    paginate
    selectable="multi"
    perPage={10}
    striped={false}
    hover={false}
    {customCell}
    buttons={['csv', 'clipboard']}
    classNames={{
      container: '!bg-slate-900 !border-slate-800 font-sans',
      toolbar: '!bg-slate-900',
      searchInput: '!bg-slate-800 !text-slate-200 !border-slate-700 focus:!border-emerald-500 focus:!shadow-[0_0_0_2px_rgba(16,185,129,0.2)] placeholder:!text-slate-500',
      thead: '!bg-slate-950',
      th: '!bg-slate-950 !text-slate-400 !uppercase !text-[0.6875rem] !tracking-widest !font-semibold !border-b-slate-800',
      tbody: '!bg-slate-900',
      tr: 'hover:!bg-slate-800 !transition-colors',
      trSelected: '!bg-emerald-500/10',
      trEven: '!bg-white/[0.02]',
      td: '!text-slate-300 !border-b-slate-800',
      tfoot: '!bg-slate-950',
      tf: '!text-emerald-400 !font-semibold !border-t-slate-800',
      pagination: '!border-t-slate-800 !text-slate-400 !bg-slate-900',
      pageButton: '!bg-slate-800 !text-slate-400 !border-slate-700 hover:!bg-slate-700 hover:!text-slate-200',
      perPageSelect: '!bg-slate-800 !text-slate-200 !border-slate-700',
      btnCreate: '!bg-emerald-500 !text-white !border-transparent hover:!bg-emerald-600',
      btnEdit: '!bg-slate-800 !text-slate-200 !border-slate-700 hover:!bg-slate-700',
      btnDelete: '!bg-red-500 !text-white !border-transparent hover:!bg-red-600',
      editorModal: '!bg-slate-900 !border-slate-800',
      editorBackdrop: '!bg-black/60',
    }}
  />
</div>
```

Key points:
- **`striped={false}` and `hover={false}`** — omit the table's hover/stripe modifier classes
- **`!` (important modifier)** — needed to override built-in `var(--sdt-*)` styles
- **Tailwind utility classes** — this example styles the supported `classNames` surfaces
- Supported hooks cover toolbar, search, headers, rows, cells, footer, pagination, create/edit/delete buttons and modal surfaces

---

## Complete Example

A full-featured example combining client-side data, modal editing, custom cells, export buttons, selection, state persistence, and more:

```svelte
<script lang="ts">
  import { DataTable } from '@beeblock/svelar-datatable/ui';
  import type { ColumnDef, EditorFieldDef, ButtonDef, DataTableStore } from '@beeblock/svelar-datatable';

  let store: DataTableStore | undefined = $state();

  const columns: ColumnDef[] = [
    { key: 'id', header: 'ID', type: 'number', editable: false, width: '60px' },
    { key: 'name', header: 'Name', searchable: true },
    { key: 'email', header: 'Email', searchable: true },
    {
      key: 'role',
      header: 'Role',
      type: 'custom',
      filterable: true,
    },
    {
      key: 'status',
      header: 'Status',
      type: 'custom',
    },
    {
      key: 'salary',
      header: 'Salary',
      type: 'number',
      footer: (rows) => {
        const total = rows.reduce((sum, r) => sum + (r.salary ?? 0), 0);
        return `Total: $${total.toLocaleString()}`;
      },
    },
    { key: 'created_at', header: 'Joined', type: 'date', sortable: true },
  ];

  const editorFields: EditorFieldDef[] = [
    { name: 'name', type: 'text', label: 'Full Name', required: true },
    { name: 'email', type: 'text', label: 'Email', required: true },
    {
      name: 'role',
      type: 'select',
      label: 'Role',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editor', value: 'editor' },
        { label: 'Viewer', value: 'viewer' },
      ],
    },
    {
      name: 'status',
      type: 'select',
      label: 'Status',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
      ],
      defaultValue: 'active',
    },
    { name: 'salary', type: 'number', label: 'Salary' },
    { name: 'notes', type: 'textarea', label: 'Notes', placeholder: 'Optional notes...' },
  ];

  const buttons: (ButtonDef | string)[] = [
    'csv',
    'clipboard',
    'print',
    {
      key: 'deactivate',
      label: 'Deactivate Selected',
      variant: 'destructive',
      disabled: (selected) => selected.length === 0,
      action: async (selected) => {
        const ids = selected.map((r) => r.id);
        data = data.map((u) => ids.includes(u.id) ? { ...u, status: 'inactive' } : u);
        store?.deselectAll();
      },
    },
  ];

  let data = $state([
    { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'admin', status: 'active', salary: 95000, created_at: '2024-01-15' },
    { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'editor', status: 'active', salary: 72000, created_at: '2024-03-20' },
    { id: 3, name: 'Charlie Brown', email: 'charlie@example.com', role: 'viewer', status: 'inactive', salary: 55000, created_at: '2024-06-01' },
    { id: 4, name: 'Diana Prince', email: 'diana@example.com', role: 'admin', status: 'active', salary: 110000, created_at: '2023-11-10' },
    { id: 5, name: 'Eve Wilson', email: 'eve@example.com', role: 'editor', status: 'active', salary: 68000, created_at: '2025-01-05' },
  ]);

  let nextId = $state(6);

  async function handleCreate(formData: Record<string, any>) {
    const newUser = { ...formData, id: nextId++ };
    data = [...data, newUser];
  }

  async function handleEdit(row: any, formData: Record<string, any>) {
    data = data.map((u) => (u.id === row.id ? { ...u, ...formData } : u));
  }

  async function handleDelete(rows: any[]) {
    const ids = rows.map((r) => r.id);
    data = data.filter((u) => !ids.includes(u.id));
  }
</script>

<DataTable
  {columns}
  {data}
  bind:storeRef={store}
  sortable={true}
  searchable={true}
  paginate={true}
  perPage={10}
  perPageOptions={[5, 10, 25, 50]}
  selectable="multi"
  editorMode="modal"
  {editorFields}
  onCreate={handleCreate}
  onEdit={handleEdit}
  onDelete={handleDelete}
  {buttons}
  stateSaveKey="demo-users-table"
  striped={true}
  hover={true}
  expandable={true}
>
  {#snippet customCell({ row, column, value })}
    {#if column.key === 'role'}
      <span style="
        background: {value === 'admin' ? '#dbeafe' : value === 'editor' ? '#fef3c7' : '#e5e7eb'};
        color: {value === 'admin' ? '#1d4ed8' : value === 'editor' ? '#92400e' : '#374151'};
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.75rem;
        font-weight: 500;
      ">
        {value}
      </span>
    {:else if column.key === 'status'}
      <span style="
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.8125rem;
        color: {value === 'active' ? '#16a34a' : '#dc2626'};
      ">
        <span style="
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 9999px;
          background: {value === 'active' ? '#22c55e' : '#ef4444'};
        "></span>
        {value}
      </span>
    {:else}
      {value}
    {/if}
  {/snippet}

  {#snippet expandContent({ row })}
    <div style="padding: 1rem 2rem; background: #f9fafb;">
      <p><strong>Notes:</strong> {row.notes ?? 'No additional notes.'}</p>
      <p><strong>Email:</strong> {row.email}</p>
      <p><strong>Joined:</strong> {row.created_at}</p>
    </div>
  {/snippet}
</DataTable>
```
