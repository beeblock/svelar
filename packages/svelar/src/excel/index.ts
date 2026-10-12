/**
 * Svelar Excel
 *
 * Excel import/export with streaming support for large files.
 * Uses ExcelJS under the hood (requires `npm install exceljs`).
 *
 * @example
 * ```ts
 * import { Excel, Spreadsheet } from '@beeblock/svelar/excel';
 *
 * // Quick export from array of objects
 * const buffer = await Excel.export({
 *   sheets: [{
 *     name: 'Users',
 *     columns: [
 *       { header: 'Name', key: 'name', width: 30 },
 *       { header: 'Email', key: 'email', width: 40 },
 *       { header: 'Created', key: 'createdAt', width: 20 },
 *     ],
 *     rows: users,
 *   }],
 * });
 *
 * // Quick import
 * const rows = await Excel.import(buffer, { sheet: 'Users' });
 * // [{ name: 'John', email: 'john@example.com', createdAt: '2026-01-01' }, ...]
 *
 * // Streaming export (low memory for large datasets)
 * const buffer = await Excel.stream({
 *   sheets: [{
 *     name: 'Orders',
 *     columns: [
 *       { header: 'Order ID', key: 'id' },
 *       { header: 'Total', key: 'total' },
 *     ],
 *     rows: async function* () {
 *       let page = 1;
 *       while (true) {
 *         const batch = await Order.query().page(page, 1000);
 *         if (batch.length === 0) break;
 *         for (const order of batch) yield order;
 *         page++;
 *       }
 *     },
 *   }],
 * });
 *
 * // Streaming import (low memory)
 * await Excel.importStream(buffer, {
 *   sheet: 'Orders',
 *   onRow: async (row, index) => {
 *     await Order.create(row);
 *   },
 * });
 *
 * // Advanced: Spreadsheet builder
 * const spreadsheet = new Spreadsheet();
 * spreadsheet
 *   .sheet('Report')
 *   .columns([
 *     { header: 'Month', key: 'month', width: 15 },
 *     { header: 'Revenue', key: 'revenue', width: 15, style: { numFmt: '"$"#,##0.00' } },
 *   ])
 *   .addRows(data)
 *   .headerStyle({ font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } } })
 *   .autoFilter();
 *
 * const buffer = await spreadsheet.toBuffer();
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface ColumnDef {
  header: string;
  key: string;
  width?: number;
  style?: Record<string, any>;
}

export interface SheetDef {
  name: string;
  columns: ColumnDef[];
  rows: Record<string, any>[] | (() => AsyncIterable<Record<string, any>>);
}

export interface ExportOptions {
  sheets: SheetDef[];
  creator?: string;
}

export interface ImportOptions {
  /** Sheet name or 1-based index (default: 1) */
  sheet?: string | number;
  /** Map column headers to keys. If not provided, uses first row as headers. */
  headerRow?: number;
}

export interface ImportStreamOptions extends ImportOptions {
  onRow: (row: Record<string, any>, index: number) => void | Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────

async function getExcelJS(): Promise<any> {
  try {
    const mod = await import('exceljs');
    return (mod as any).default?.Workbook ? (mod as any).default : mod;
  } catch (error: any) {
    if (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('Excel support requires exceljs. Install: npm install exceljs');
    }
    throw error;
  }
}

function getSheetByOption(workbook: any, option?: string | number): any {
  if (!option) return workbook.worksheets[0];
  if (typeof option === 'number') return workbook.worksheets[option - 1];
  return workbook.getWorksheet(option);
}

function resolveCellValue(cell: any, sharedStrings?: readonly any[]): any {
  const value = cell.value;
  if (value && typeof value === 'object' && 'sharedString' in value) {
    const index = value.sharedString;
    if (!Number.isInteger(index) || index < 0 || sharedStrings?.[index] === undefined) {
      throw new Error('Unresolved Excel shared string');
    }
    cell.value = sharedStrings[index];
  }
  return cell.value;
}

function rowHeaders(row: any, sharedStrings?: readonly any[]): string[] {
  const headers: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
    const value = resolveCellValue(cell, sharedStrings);
    headers[colNumber - 1] = value == null ? `col${colNumber}` : cell.text;
  });
  return headers;
}

function rowToObject(row: any, headers: string[], sharedStrings?: readonly any[]): Record<string, any> {
  const obj: Record<string, any> = {};
  for (let i = 0; i < headers.length; i++) {
    const cell = row.getCell(i + 1);
    obj[headers[i]] = resolveCellValue(cell, sharedStrings);
  }
  return obj;
}

async function processLoadedWorkbookRows(
  workbook: any,
  options: ImportStreamOptions,
): Promise<void> {
  const targetSheet = options.sheet;
  const headerRowNum = options.headerRow ?? 1;
  const worksheet = getSheetByOption(workbook, targetSheet);
  if (!worksheet) throw new Error('Worksheet not found');

  const headers = rowHeaders(worksheet.getRow(headerRowNum));

  let rowIndex = 0;
  for (let rowNumber = headerRowNum + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    if (!row.hasValues) continue;
    await options.onRow(rowToObject(row, headers), rowIndex);
    rowIndex++;
  }
}

// ── Spreadsheet Builder ───────────────────────────────────

export class SheetBuilder {
  private _columns: ColumnDef[] = [];
  private _rows: Record<string, any>[] = [];
  private _headerStyle: Record<string, any> | null = null;
  private _autoFilter = false;
  private _frozenRows = 0;
  private _frozenCols = 0;

  constructor(
    private spreadsheet: Spreadsheet,
    public readonly name: string,
  ) {}

  columns(cols: ColumnDef[]): this {
    this._columns = cols;
    return this;
  }

  addRow(row: Record<string, any>): this {
    this._rows.push(row);
    return this;
  }

  addRows(rows: Record<string, any>[]): this {
    this._rows.push(...rows);
    return this;
  }

  headerStyle(style: Record<string, any>): this {
    this._headerStyle = style;
    return this;
  }

  autoFilter(): this {
    this._autoFilter = true;
    return this;
  }

  freeze(rows: number, cols = 0): this {
    this._frozenRows = rows;
    this._frozenCols = cols;
    return this;
  }

  /** Start a new sheet on the same spreadsheet */
  sheet(name: string): SheetBuilder {
    return this.spreadsheet.sheet(name);
  }

  /** Build to buffer */
  async toBuffer(): Promise<Buffer> {
    return this.spreadsheet.toBuffer();
  }

  /** @internal */
  _apply(worksheet: any): void {
    if (this._columns.length) {
      worksheet.columns = this._columns.map((c) => ({
        header: c.header,
        key: c.key,
        width: c.width,
        style: c.style,
      }));
    }

    for (const row of this._rows) {
      worksheet.addRow(row);
    }

    if (this._headerStyle && worksheet.rowCount > 0) {
      const headerRow = worksheet.getRow(1);
      for (const key of Object.keys(this._headerStyle)) {
        (headerRow as any)[key] = this._headerStyle[key];
      }
      headerRow.commit?.();
    }

    if (this._autoFilter && this._columns.length) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: this._columns.length },
      };
    }

    if (this._frozenRows > 0 || this._frozenCols > 0) {
      worksheet.views = [
        { state: 'frozen', xSplit: this._frozenCols, ySplit: this._frozenRows },
      ];
    }
  }
}

export class Spreadsheet {
  private sheets: SheetBuilder[] = [];
  private _creator = 'Svelar';

  creator(name: string): this {
    this._creator = name;
    return this;
  }

  sheet(name: string): SheetBuilder {
    const builder = new SheetBuilder(this, name);
    this.sheets.push(builder);
    return builder;
  }

  async toBuffer(): Promise<Buffer> {
    const ExcelJS = await getExcelJS();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = this._creator;
    workbook.created = new Date();

    for (const sheet of this.sheets) {
      const ws = workbook.addWorksheet(sheet.name);
      sheet._apply(ws);
    }

    return workbook.xlsx.writeBuffer() as Promise<Buffer>;
  }
}

// ── Excel Manager ─────────────────────────────────────────

class ExcelManager {
  /**
   * Export data to an Excel buffer.
   */
  async export(options: ExportOptions): Promise<Buffer> {
    const ExcelJS = await getExcelJS();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = options.creator ?? 'Svelar';
    workbook.created = new Date();

    for (const sheetDef of options.sheets) {
      const ws = workbook.addWorksheet(sheetDef.name);
      ws.columns = sheetDef.columns.map((c) => ({
        header: c.header,
        key: c.key,
        width: c.width,
        style: c.style,
      }));

      const rows = Array.isArray(sheetDef.rows) ? sheetDef.rows : null;
      if (rows) {
        for (const row of rows) {
          ws.addRow(row);
        }
      }
    }

    return workbook.xlsx.writeBuffer() as Promise<Buffer>;
  }

  /**
   * Streaming export for large datasets.
   * Rows can be provided as an async generator to keep memory low.
   */
  async stream(options: ExportOptions): Promise<Buffer> {
    const ExcelJS = await getExcelJS();
    const { PassThrough } = await import('stream');

    const passthrough = new PassThrough();
    const chunks: Buffer[] = [];
    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: passthrough,
      useStyles: true,
      useSharedStrings: true,
    });

    workbook.creator = options.creator ?? 'Svelar';

    for (const sheetDef of options.sheets) {
      const ws = workbook.addWorksheet(sheetDef.name);
      ws.columns = sheetDef.columns.map((c) => ({
        header: c.header,
        key: c.key,
        width: c.width,
        style: c.style,
      }));

      if (Array.isArray(sheetDef.rows)) {
        for (const row of sheetDef.rows) {
          ws.addRow(row).commit();
        }
      } else {
        const iterable = sheetDef.rows();
        for await (const row of iterable) {
          ws.addRow(row).commit();
        }
      }

      ws.commit();
    }

    await workbook.commit();

    return Buffer.concat(chunks);
  }

  /**
   * Import an Excel file into an array of objects.
   * Uses the first row as headers by default.
   */
  async import(
    input: Buffer | string,
    options: ImportOptions = {},
  ): Promise<Record<string, any>[]> {
    const ExcelJS = await getExcelJS();
    const workbook = new ExcelJS.Workbook();

    if (typeof input === 'string') {
      await workbook.xlsx.readFile(input);
    } else {
      await workbook.xlsx.load(input);
    }

    const worksheet = getSheetByOption(workbook, options.sheet);
    if (!worksheet) throw new Error('Worksheet not found');

    const headerRowNum = options.headerRow ?? 1;
    const headers = rowHeaders(worksheet.getRow(headerRowNum));

    const rows: Record<string, any>[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
      if (rowNumber <= headerRowNum) return;
      rows.push(rowToObject(row, headers));
    });

    return rows;
  }

  /**
   * Streaming import for large files.
   * Processes rows one at a time without loading the entire file into memory.
   */
  async importStream(
    input: Buffer | string,
    options: ImportStreamOptions,
  ): Promise<void> {
    const ExcelJS = await getExcelJS();
    const targetSheet = options.sheet;
    const headerRowNum = options.headerRow ?? 1;

    if (Buffer.isBuffer(input)) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(input);
      await processLoadedWorkbookRows(workbook, options);
      return;
    }

    let stream: any;
    if (typeof input === 'string') {
      const fs = await import('fs');
      stream = fs.createReadStream(input);
    } else {
      throw new Error('Unsupported Excel import stream input');
    }

    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(stream, { sharedStrings: 'cache' });
    let deliveryStarted = false;

    try {
      for await (const worksheetReader of workbookReader) {
        // Skip sheets that don't match
        if (targetSheet) {
          if (typeof targetSheet === 'string' && worksheetReader.name !== targetSheet) continue;
          if (typeof targetSheet === 'number' && Number(worksheetReader.id) !== targetSheet) continue;
        }

        let headers: string[] | undefined;
        let rowIndex = 0;
        for await (const row of worksheetReader) {
          if (row.number === headerRowNum) {
            headers = rowHeaders(row, workbookReader.sharedStrings);
            continue;
          }
          if (row.number <= headerRowNum || !row.hasValues) continue;
          if (!headers) throw new Error('Excel header row not found');

          const obj = rowToObject(row, headers, workbookReader.sharedStrings);
          deliveryStarted = true;
          await options.onRow(obj, rowIndex++);
        }

        // Only process the first matching sheet
        return;
      }
      throw new Error('Worksheet not found');
    } catch (error) {
      // Retrying after user code ran could duplicate committed side effects.
      if (deliveryStarted) throw error;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(input);
      await processLoadedWorkbookRows(workbook, options);
    } finally {
      stream.destroy();
    }
  }

  /**
   * Create a Spreadsheet builder for advanced use cases.
   */
  create(): Spreadsheet {
    return new Spreadsheet();
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global Excel singleton
 */
export const Excel = singleton('svelar.excel', () => new ExcelManager());
