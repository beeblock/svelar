# Excel Import/Export

Import and export Excel files with streaming support for large datasets. Included in scaffolded projects (`npx svelar new`) — works out of the box.

### Quick Export

```typescript
import { Excel } from '@beeblock/svelar/excel';

const buffer = await Excel.export({
  sheets: [{
    name: 'Users',
    columns: [
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Email', key: 'email', width: 40 },
      { header: 'Role', key: 'role', width: 15 },
    ],
    rows: users,
  }],
});

// Return as download in a SvelteKit endpoint
return new Response(buffer, {
  headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="users.xlsx"',
  },
});
```

### Quick Import

```typescript
import { Excel } from '@beeblock/svelar/excel';

// From uploaded file buffer
const rows = await Excel.import(buffer, { sheet: 'Users' });
// [{ name: 'John', email: 'john@example.com', role: 'admin' }, ...]

for (const row of rows) {
  await User.create(row);
}
```

### Streaming Export (Low Memory)

For large datasets, use async generators to avoid loading everything into memory:

```typescript
const buffer = await Excel.stream({
  sheets: [{
    name: 'Orders',
    columns: [
      { header: 'Order ID', key: 'id' },
      { header: 'Total', key: 'total' },
    ],
    rows: async function* () {
      let page = 1;
      while (true) {
        const batch = await Order.query().page(page, 1000);
        if (batch.length === 0) break;
        for (const order of batch) yield order;
        page++;
      }
    },
  }],
});
```

### Streaming Import (Low Memory)

Process rows one at a time without loading the entire file:

```typescript
await Excel.importStream(buffer, {
  sheet: 'Orders',
  onRow: async (row, index) => {
    await Order.create(row);
  },
});
```

### Spreadsheet Builder

For advanced formatting, headers, auto-filters, and frozen panes:

```typescript
import { Spreadsheet } from '@beeblock/svelar/excel';

const spreadsheet = new Spreadsheet();
spreadsheet
  .sheet('Report')
  .columns([
    { header: 'Month', key: 'month', width: 15 },
    { header: 'Revenue', key: 'revenue', width: 15, style: { numFmt: '"$"#,##0.00' } },
  ])
  .addRows(data)
  .headerStyle({ font: { bold: true } })
  .autoFilter()
  .freeze(1);

const buffer = await spreadsheet.toBuffer();
```
