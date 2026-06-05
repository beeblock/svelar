import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Excel, Spreadsheet } from '../src/excel';

describe('Excel', () => {
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
});
