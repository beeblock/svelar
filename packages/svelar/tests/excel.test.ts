import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Excel, Spreadsheet } from '../src/excel';

async function withWorkbookFile(buffer: Buffer, run: (file: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'svelar-excel-reader-'));
  try {
    const file = join(directory, 'report.xlsx');
    await writeFile(file, buffer);
    await run(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function mockReader(worksheet: ExcelJS.Worksheet, rowNumbers: number[], sharedStrings?: any[], failure?: Error): void {
  vi.spyOn(ExcelJS.stream.xlsx, 'WorkbookReader').mockImplementation(function () {
    return {
      sharedStrings,
      async *[Symbol.asyncIterator]() {
        yield {
          name: worksheet.name,
          id: '1',
          async *[Symbol.asyncIterator]() {
            for (const number of rowNumbers) yield worksheet.getRow(number);
            if (failure) throw failure;
          },
        };
      },
    };
  } as any);
}

describe('Excel', () => {
  afterEach(() => vi.restoreAllMocks());
  it('exports and imports array-backed worksheets', async () => {
    const buffer = await Excel.export({
      creator: 'Svelar Tests',
      sheets: [
        {
          name: 'Users',
          columns: [
            { header: 'Name', key: 'name', width: 30 },
            { header: 'Email', key: 'email', width: 40 },
            { header: 'Role', key: 'role', width: 15 },
          ],
          rows: [
            { name: 'Admin', email: 'admin@svelar.dev', role: 'admin' },
            { name: 'Demo', email: 'demo@svelar.dev', role: 'user' },
          ],
        },
      ],
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);

    await expect(Excel.import(buffer, { sheet: 'Users' })).resolves.toEqual([
      { Name: 'Admin', Email: 'admin@svelar.dev', Role: 'admin' },
      { Name: 'Demo', Email: 'demo@svelar.dev', Role: 'user' },
    ]);
  });

  it('imports workbooks from files and supports 1-based sheet selection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-excel-'));
    const file = join(root, 'report.xlsx');

    try {
      const buffer = await Excel.export({
        sheets: [
          {
            name: 'Ignored',
            columns: [{ header: 'Name', key: 'name' }],
            rows: [{ name: 'Ignored' }],
          },
          {
            name: 'Orders',
            columns: [
              { header: 'Order ID', key: 'id' },
              { header: 'Total', key: 'total' },
            ],
            rows: [{ id: 1001, total: 49.95 }],
          },
        ],
      });
      await writeFile(file, buffer);

      await expect(Excel.import(file, { sheet: 2 })).resolves.toEqual([
        { 'Order ID': 1001, Total: 49.95 },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('streams async rows into an importable workbook', async () => {
    async function* rows() {
      yield { id: 1, total: 10 };
      yield { id: 2, total: 20 };
      yield { id: 3, total: 30 };
    }

    const buffer = await Excel.stream({
      sheets: [
        {
          name: 'Orders',
          columns: [
            { header: 'ID', key: 'id' },
            { header: 'Total', key: 'total' },
          ],
          rows,
        },
      ],
    });

    await expect(Excel.import(buffer, { sheet: 'Orders' })).resolves.toEqual([
      { ID: 1, Total: 10 },
      { ID: 2, Total: 20 },
      { ID: 3, Total: 30 },
    ]);
  });

  it('streams imported rows to a callback without loading all rows in userland', async () => {
    const buffer = await Excel.export({
      sheets: [
        {
          name: 'Events',
          columns: [
            { header: 'Name', key: 'name' },
            { header: 'Count', key: 'count' },
          ],
          rows: [
            { name: 'created', count: 1 },
            { name: 'updated', count: 2 },
          ],
        },
      ],
    });

    const seen: Array<{ row: Record<string, any>; index: number }> = [];
    await Excel.importStream(buffer, {
      sheet: 'Events',
      onRow: async (row, index) => {
        seen.push({ row, index });
      },
    });

    expect(seen).toEqual([
      { row: { Name: 'created', Count: 1 }, index: 0 },
      { row: { Name: 'updated', Count: 2 }, index: 1 },
    ]);
  });

  it('streams imported rows from a file path through the low-memory reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-excel-stream-'));
    const file = join(root, 'events.xlsx');

    try {
      const buffer = await Excel.export({
        sheets: [
          {
            name: 'Events',
            columns: [
              { header: 'Name', key: 'name' },
              { header: 'Count', key: 'count' },
            ],
            rows: [
              { name: 'created', count: 1 },
              { name: 'updated', count: 2 },
            ],
          },
        ],
      });
      await writeFile(file, buffer);

      const seen: Array<Record<string, any>> = [];
      await Excel.importStream(file, {
        sheet: 'Events',
        onRow: async (row) => {
          seen.push(row);
        },
      });

      expect(seen).toEqual([
        { Name: 'created', Count: 1 },
        { Name: 'updated', Count: 2 },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('builds formatted spreadsheets with chained sheet builders', async () => {
    const buffer = await new Spreadsheet()
      .creator('Svelar')
      .sheet('Report')
      .columns([
        { header: 'Month', key: 'month', width: 15 },
        { header: 'Revenue', key: 'revenue', width: 15, style: { numFmt: '"$"#,##0.00' } },
      ])
      .addRows([
        { month: 'January', revenue: 1000 },
        { month: 'February', revenue: 2000 },
      ])
      .headerStyle({ font: { bold: true } })
      .autoFilter()
      .freeze(1)
      .sheet('Summary')
      .columns([{ header: 'Metric', key: 'metric' }])
      .addRow({ metric: 'Revenue' })
      .toBuffer();

    expect(buffer.length).toBeGreaterThan(1000);
    await expect(Excel.import(buffer, { sheet: 'Report' })).resolves.toEqual([
      { Month: 'January', Revenue: 1000 },
      { Month: 'February', Revenue: 2000 },
    ]);
    await expect(Excel.import(buffer, { sheet: 'Summary' })).resolves.toEqual([
      { Metric: 'Revenue' },
    ]);
  });

  it('throws when the requested worksheet is missing', async () => {
    const buffer = await Excel.export({
      sheets: [
        {
          name: 'Users',
          columns: [{ header: 'Name', key: 'name' }],
          rows: [{ name: 'Admin' }],
        },
      ],
    });

    await expect(Excel.import(buffer, { sheet: 'Missing' })).rejects.toThrow('Worksheet not found');
  });

  it.each(['buffer', 'file'] as const)('decodes rich-text and hyperlink headers from a %s', async (mode) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');
    sheet.addRow([{ richText: [{ text: 'Full ' }, { text: 'Name' }] }, { text: 'Email', hyperlink: 'https://example.test' }]);
    sheet.addRow(['Ada', 'ada@example.test']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const expected = [{ 'Full Name': 'Ada', Email: 'ada@example.test' }];
    await withWorkbookFile(buffer, async (file) => {
      const input = mode === 'buffer' ? buffer : file;
      expect(await Excel.import(input)).toEqual(expected);
      const rows: Record<string, any>[] = [];
      await Excel.importStream(input, { onRow: (row) => { rows.push(row); } });
      expect(rows).toEqual(expected);
    });
  });

  it('resolves cached shared strings including index zero without falling back', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');
    sheet.addRow([{ sharedString: 0 }, { sharedString: 1 }]);
    sheet.addRow([{ sharedString: 2 }, 10]);
    mockReader(sheet, [1, 2], ['Name', { richText: [{ text: 'To' }, { text: 'tal' }] }, 'Ada']);
    const readFile = vi.spyOn(Object.getPrototypeOf(workbook.xlsx), 'readFile');
    const buffer = await Excel.export({ sheets: [{ name: 'Report', columns: [{ header: 'Name', key: 'name' }], rows: [{ name: 'Ada' }] }] });
    await withWorkbookFile(buffer, async (file) => {
      const rows: Record<string, any>[] = [];
      await Excel.importStream(file, { sheet: 1, onRow: (row) => { rows.push(row); } });
      expect(rows).toEqual([{ Name: 'Ada', Total: 10 }]);
      expect(readFile).not.toHaveBeenCalled();
    });
  });

  it('round-trips shared-string streaming exports through both import paths', async () => {
    const buffer = await Excel.stream({
      sheets: [{ name: 'Report', columns: [{ header: 'Name', key: 'name' }, { header: 'Total', key: 'total' }], rows: [{ name: 'Ada', total: 10 }, { name: 'Demo', total: 20 }] }],
    });
    const expected = [{ Name: 'Ada', Total: 10 }, { Name: 'Demo', Total: 20 }];
    await withWorkbookFile(buffer, async (file) => {
      for (const input of [buffer, file]) {
        expect(await Excel.import(input)).toEqual(expected);
        const rows: Record<string, any>[] = [];
        await Excel.importStream(input, { onRow: (row) => { rows.push(row); } });
        expect(rows).toEqual(expected);
      }
    });
  });

  it('uses physical header row numbers and contiguous callback indexes for sparse sheets', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');
    sheet.getRow(2).values = ['Name'];
    sheet.getRow(4).values = ['Ada'];
    sheet.getRow(6).values = ['Demo'];
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    mockReader(sheet, [2, 4, 6]);
    const readFile = vi.spyOn(Object.getPrototypeOf(workbook.xlsx), 'readFile');
    await withWorkbookFile(buffer, async (file) => {
      const rows: Array<{ row: Record<string, any>; index: number }> = [];
      await Excel.importStream(file, { headerRow: 2, onRow: (row, index) => { rows.push({ row, index }); } });
      expect(rows).toEqual([{ row: { Name: 'Ada' }, index: 0 }, { row: { Name: 'Demo' }, index: 1 }]);
      expect(readFile).not.toHaveBeenCalled();
    });
  });

  it.each(['callback', 'reader'] as const)('never replays delivered rows after a %s failure', async (mode) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');
    sheet.addRows([['Name'], ['Ada'], ['Demo']]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const failure = new Error('Import failed after side effects');
    mockReader(sheet, mode === 'reader' ? [1, 2] : [1, 2, 3], undefined, mode === 'reader' ? failure : undefined);
    const readFile = vi.spyOn(Object.getPrototypeOf(workbook.xlsx), 'readFile');
    await withWorkbookFile(buffer, async (file) => {
      const rows: Record<string, any>[] = [];
      await expect(Excel.importStream(file, {
        onRow: (row) => {
          rows.push(row);
          if (mode === 'callback') throw failure;
        },
      })).rejects.toBe(failure);
      expect(rows).toEqual([{ Name: 'Ada' }]);
      expect(readFile).not.toHaveBeenCalled();
    });
  });

  it('allows a reader fallback only before any callback has run', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');
    sheet.addRows([['Name'], ['Ada'], ['Demo']]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    mockReader(sheet, [], undefined, new Error('Reader failed before rows'));
    const readFile = vi.spyOn(Object.getPrototypeOf(workbook.xlsx), 'readFile');
    await withWorkbookFile(buffer, async (file) => {
      const rows: Record<string, any>[] = [];
      await Excel.importStream(file, { onRow: (row) => { rows.push(row); } });
      expect(rows).toEqual([{ Name: 'Ada' }, { Name: 'Demo' }]);
      expect(readFile).toHaveBeenCalledTimes(1);
    });
  });

  it.each(['buffer', 'file'] as const)('rejects missing sheets during %s callback imports', async (mode) => {
    const buffer = await Excel.export({ sheets: [{ name: 'Report', columns: [{ header: 'Name', key: 'name' }], rows: [{ name: 'Ada' }] }] });
    await withWorkbookFile(buffer, async (file) => {
      const callback = vi.fn();
      await expect(Excel.importStream(mode === 'buffer' ? buffer : file, { sheet: 'Missing', onRow: callback })).rejects.toThrow('Worksheet not found');
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
