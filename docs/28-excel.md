# Excel Import/Export

Import and export Excel files with streaming support for large datasets. Excel support is optional: install `exceljs` in apps that use this feature.

```bash
npm install exceljs
```

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

You can also import the facade from the root package:

```typescript
import { Excel } from '@beeblock/svelar';
```

### Quick Import

```typescript
import { Excel } from '@beeblock/svelar/excel';

// From uploaded file buffer
const rows = await Excel.import(buffer, { sheet: 'Users' });
// Keys match the worksheet headers, such as Name, Email, and Role.

for (const row of rows) {
  await User.create(row);
}
```

Header names use ExcelJS cell text, including rich-text and hyperlink labels. Cached shared-string references are resolved before rows are delivered; unresolved references are never converted into `[object Object]` keys. Imported data-cell values retain their ExcelJS types.

### Streaming Export (Low Memory)

For large datasets, use async generators to avoid loading everything into memory:

Rows are constructed incrementally, but `Excel.stream()` still returns the completed XLSX as a `Buffer`; it is not a streaming HTTP response.

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

Pass a file path to use the streaming reader:

```typescript
await Excel.importStream(uploadedFilePath, {
  sheet: 'Orders',
  onRow: async (row, index) => {
    await Order.create(row);
  },
});
```

Buffer input is supported but loads the workbook before invoking callbacks. File input normally uses the streaming reader; if parsing or shared-string resolution fails before any callback begins, Svelar may load the workbook as a compatibility fallback. This fallback is not a low-memory path.

Callbacks receive contiguous zero-based indexes for nonempty data rows. `headerRow` is a physical, one-based worksheet row number, even when preceding or intermediate rows are blank. A missing requested worksheet rejects the import.

If a callback throws, or the reader fails after callbacks have begun, the import rejects without replaying earlier rows. Previously committed side effects are not rolled back automatically: use transactions or idempotent application actions when required, and do not blindly retry a partially completed import.

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
