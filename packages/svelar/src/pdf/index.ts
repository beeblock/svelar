/**
 * Svelar PDF Module
 *
 * Provides a fluent API for generating PDFs with swappable drivers.
 * Ships with two drivers out of the box:
 *
 * - **pdfkit** (default) — Pure JavaScript, zero external dependencies.
 *   Great for invoices, reports, tickets, and programmatic documents.
 *   Install: `npm install pdfkit`
 *
 * - **gotenberg** — Docker-based service using Chromium & LibreOffice.
 *   Great for pixel-perfect HTML→PDF, URL→PDF, and office document conversion.
 *   Requires a running Gotenberg container.
 *
 * Swap drivers at any time — the `PDF` facade API stays the same.
 *
 * @example
 * ```typescript
 * import { PDF } from '@beeblock/svelar/pdf';
 *
 * // PDFKit (default — no Docker needed)
 * PDF.configure({ driver: 'pdfkit' });
 * const buffer = await PDF.html('<h1>Hello</h1>').generate();
 *
 * // Gotenberg (Docker service)
 * PDF.configure({ driver: 'gotenberg', gotenberg: { url: 'http://localhost:3000' } });
 * const buffer = await PDF.html('<h1>Hello</h1>').generate();
 * ```
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// ── Types ──────────────────────────────────────────────────

export interface PdfMargins {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
}

export interface PdfPageSize {
  width?: string;
  height?: string;
}

export interface GotenbergConfig {
  /** Gotenberg API base URL (default: http://localhost:3000 or GOTENBERG_URL env) */
  url?: string;
  /** Request timeout in ms (default: 60000) */
  timeout?: number;
  /** Custom headers to send with every request */
  headers?: Record<string, string>;
  /** Default webhook URL for async generation */
  webhookUrl?: string;
  /** Default webhook error URL */
  webhookErrorUrl?: string;
}

export interface PdfKitConfig {
  /** Default page size (default: 'A4') */
  pageSize?: string;
  /** Default margins in points (72 points = 1 inch) */
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
  /** Whether to auto-add page numbers (default: false) */
  pageNumbers?: boolean;
  /** Default font (default: 'Helvetica') */
  font?: string;
  /** Default font size in points (default: 12) */
  fontSize?: number;
}

export interface PdfConfig {
  /** Which driver to use: 'pdfkit' (default) or 'gotenberg' */
  driver?: 'pdfkit' | 'gotenberg';
  /** PDFKit-specific options */
  pdfkit?: PdfKitConfig;
  /** Gotenberg-specific options */
  gotenberg?: GotenbergConfig;
}

export interface WebhookOptions {
  /** URL where the generated PDF will be POSTed on success */
  url: string;
  /** URL called if the conversion fails */
  errorUrl: string;
  /** HTTP method for the success callback (default: POST) */
  method?: 'POST' | 'PUT' | 'PATCH';
  /** HTTP method for the error callback (default: POST) */
  errorMethod?: 'POST' | 'PUT' | 'PATCH';
  /** Extra HTTP headers sent with the webhook callback */
  extraHeaders?: Record<string, string>;
}

export interface DownloadFromEntry {
  /** Remote URL to fetch the file from */
  url: string;
  /** Extra HTTP headers for fetching this specific URL */
  extraHttpHeaders?: Record<string, string>;
  /** Route to a specific form field: "embedded", "watermark", "stamp" */
  field?: 'embedded' | 'watermark' | 'stamp';
}

// ── Config ─────────────────────────────────────────────────

let _config: PdfConfig = { driver: 'pdfkit' };

function getDriver(): 'pdfkit' | 'gotenberg' {
  return _config.driver || 'pdfkit';
}

function getGotenbergConfig(): GotenbergConfig {
  return _config.gotenberg || {};
}

function getPdfKitConfig(): PdfKitConfig {
  return _config.pdfkit || {};
}

// ── Multipart Helper (Gotenberg) ───────────────────────────

class MultipartBuilder {
  private boundary = `----SvelarBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  private parts: Buffer[] = [];

  get contentType(): string {
    return `multipart/form-data; boundary=${this.boundary}`;
  }

  addField(name: string, value: string): this {
    const header = `--${this.boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`;
    this.parts.push(Buffer.from(header + value + '\r\n'));
    return this;
  }

  addFile(fieldName: string, filename: string, content: Buffer | string, contentType = 'application/octet-stream'): this {
    const buf = typeof content === 'string' ? Buffer.from(content) : content;
    const header = `--${this.boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
    this.parts.push(Buffer.concat([Buffer.from(header), buf, Buffer.from('\r\n')]));
    return this;
  }

  build(): Buffer {
    this.parts.push(Buffer.from(`--${this.boundary}--\r\n`));
    return Buffer.concat(this.parts);
  }
}

// ── PDFKit Engine ──────────────────────────────────────────

/** Parse a CSS-style margin string ('1in', '25mm', '2cm', '72pt', '96px') to PDF points (72 pt/inch). */
function parseMarginToPoints(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^([\d.]+)\s*(in|mm|cm|pt|px)?$/);
  if (!match) return undefined;

  const num = parseFloat(match[1]);
  const unit = match[2] || 'pt';

  switch (unit) {
    case 'in': return num * 72;
    case 'mm': return num * (72 / 25.4);
    case 'cm': return num * (72 / 2.54);
    case 'pt': return num;
    case 'px': return num * 0.75; // 96 DPI -> 72 pt/in
    default: return num;
  }
}

/** Simple HTML-to-PDFKit renderer. Handles basic tags for invoices/reports. */
async function renderHtmlToPdfKit(doc: any, html: string, config: PdfKitConfig): Promise<void> {
  const font = config.font || 'Helvetica';
  const fontSize = config.fontSize || 12;

  doc.font(font).fontSize(fontSize);

  // Strip full HTML document wrappers
  let body = html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) body = bodyMatch[1];

  // Remove <style>, <script>, <head> blocks
  body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');

  // Render line by line from simplified HTML
  const lines = body.split(/\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Headings
    const h1 = line.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1) {
      doc.fontSize(28).font(`${font}-Bold`).text(stripTags(h1[1]), { paragraphGap: 8 });
      doc.font(font).fontSize(fontSize);
      continue;
    }

    const h2 = line.match(/<h2[^>]*>(.*?)<\/h2>/i);
    if (h2) {
      doc.fontSize(22).font(`${font}-Bold`).text(stripTags(h2[1]), { paragraphGap: 6 });
      doc.font(font).fontSize(fontSize);
      continue;
    }

    const h3 = line.match(/<h3[^>]*>(.*?)<\/h3>/i);
    if (h3) {
      doc.fontSize(18).font(`${font}-Bold`).text(stripTags(h3[1]), { paragraphGap: 4 });
      doc.font(font).fontSize(fontSize);
      continue;
    }

    const h4 = line.match(/<h4[^>]*>(.*?)<\/h4>/i);
    if (h4) {
      doc.fontSize(15).font(`${font}-Bold`).text(stripTags(h4[1]), { paragraphGap: 3 });
      doc.font(font).fontSize(fontSize);
      continue;
    }

    // Horizontal rule
    if (/<hr\s*\/?>/i.test(line)) {
      doc.moveDown(0.5);
      const y = doc.y;
      doc.moveTo(doc.page.margins.left, y)
        .lineTo(doc.page.width - doc.page.margins.right, y)
        .stroke('#cccccc');
      doc.moveDown(0.5);
      continue;
    }

    // Line break
    if (/<br\s*\/?>/i.test(line)) {
      doc.moveDown(0.5);
      continue;
    }

    // List items
    const li = line.match(/<li[^>]*>(.*?)<\/li>/i);
    if (li) {
      doc.text(`  \u2022  ${stripTags(li[1])}`, { paragraphGap: 2 });
      continue;
    }

    // Paragraph or plain text
    const p = line.match(/<p[^>]*>(.*?)<\/p>/i);
    if (p) {
      doc.text(stripTags(p[1]), { paragraphGap: 4 });
      continue;
    }

    // Anything else: strip tags and render as text
    const text = stripTags(line);
    if (text) {
      doc.text(text, { paragraphGap: 2 });
    }
  }
}

/** Strip HTML tags and decode common entities */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Create a PDFKit document and return it as a Buffer */
async function pdfkitGenerate(
  callback: (doc: any) => Promise<void>,
  options: {
    margins?: PdfMargins;
    pageSize?: PdfPageSize;
    landscape?: boolean;
    headerHtml?: string;
    footerHtml?: string;
  } = {},
): Promise<Buffer> {
  let PDFDocument: any;
  try {
    PDFDocument = (await import('pdfkit')).default;
  } catch {
    throw new Error(
      'PDFKit is not installed. Install it with: npm install pdfkit\n' +
      'Or switch to the Gotenberg driver: PDF.configure({ driver: \'gotenberg\' })'
    );
  }

  const config = getPdfKitConfig();

  // Build PDFKit options
  const docOpts: any = {
    bufferPages: true, // needed for page number injection
  };

  // Page size
  if (options.landscape) docOpts.layout = 'landscape';

  if (options.pageSize?.width && options.pageSize?.height) {
    docOpts.size = [
      parseMarginToPoints(options.pageSize.width) || 595.28,
      parseMarginToPoints(options.pageSize.height) || 841.89,
    ];
  } else {
    docOpts.size = config.pageSize || 'A4';
  }

  // Margins
  const top = parseMarginToPoints(options.margins?.top) ?? config.margins?.top ?? 72;
  const bottom = parseMarginToPoints(options.margins?.bottom) ?? config.margins?.bottom ?? 72;
  const left = parseMarginToPoints(options.margins?.left) ?? config.margins?.left ?? 72;
  const right = parseMarginToPoints(options.margins?.right) ?? config.margins?.right ?? 72;
  docOpts.margins = { top, bottom, left, right };

  const doc = new PDFDocument(docOpts);
  const chunks: Buffer[] = [];

  // Collect output
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // Run the callback to populate the document
  await callback(doc);

  // Add page numbers if configured
  if (config.pageNumbers) {
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(9).font('Helvetica')
        .text(
          `Page ${i + 1} of ${pageCount}`,
          0,
          doc.page.height - docOpts.margins.bottom + 20,
          { align: 'center', width: doc.page.width },
        );
    }
  }

  // Finalize
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// ── Base Builder ───────────────────────────────────────────

abstract class PdfBuilder {
  protected _margins: PdfMargins = {};
  protected _pageSize: PdfPageSize = {};
  protected _landscape = false;
  protected _scale: number | undefined;
  protected _headerHtml: string | undefined;
  protected _footerHtml: string | undefined;
  protected _printBackground = true;
  protected _preferCssPageSize = false;
  protected _waitDelay: string | undefined;
  protected _waitExpression: string | undefined;
  protected _extraHeaders: Record<string, string> = {};
  protected _pdfFormat: string | undefined;
  protected _metadata: Record<string, string> = {};
  protected _webhook: WebhookOptions | undefined;
  protected _downloadFrom: DownloadFromEntry[] = [];

  /** Set page margins (e.g. '1in', '25mm', '2cm') */
  margins(m: PdfMargins): this {
    this._margins = m;
    return this;
  }

  /** Set custom page dimensions */
  pageSize(size: PdfPageSize): this {
    this._pageSize = size;
    return this;
  }

  /** Use landscape orientation */
  landscape(value = true): this {
    this._landscape = value;
    return this;
  }

  /** Scale factor (0.1 to 2.0) */
  scale(value: number): this {
    this._scale = value;
    return this;
  }

  /** Add a header to every page (HTML string) */
  header(html: string): this {
    this._headerHtml = html;
    return this;
  }

  /** Add a footer to every page (HTML string) */
  footer(html: string): this {
    this._footerHtml = html;
    return this;
  }

  /** Print background graphics (default: true) */
  printBackground(value = true): this {
    this._printBackground = value;
    return this;
  }

  /** Prefer CSS @page size over paperWidth/paperHeight */
  preferCssPageSize(value = true): this {
    this._preferCssPageSize = value;
    return this;
  }

  /** Wait for a duration before conversion (e.g. '5s', '1000ms') */
  waitDelay(duration: string): this {
    this._waitDelay = duration;
    return this;
  }

  /** Wait until a JS expression evaluates to true */
  waitForExpression(expression: string): this {
    this._waitExpression = expression;
    return this;
  }

  /** Set PDF/A format (e.g. 'PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b') */
  pdfFormat(format: string): this {
    this._pdfFormat = format;
    return this;
  }

  /** Set PDF metadata */
  meta(key: string, value: string): this {
    this._metadata[key] = value;
    return this;
  }

  /**
   * Enable async webhook mode. Gotenberg will return 204 immediately
   * and POST the resulting PDF to your webhook URL when done.
   * Only available with the Gotenberg driver.
   */
  webhook(options: WebhookOptions): this {
    this._webhook = options;
    return this;
  }

  /**
   * Add remote files for Gotenberg to fetch (instead of uploading them).
   * Only available with the Gotenberg driver.
   */
  downloadFrom(entries: DownloadFromEntry[]): this {
    this._downloadFrom = entries;
    return this;
  }

  /**
   * Generate the PDF asynchronously via webhook (Gotenberg only).
   */
  async generateAsync(): Promise<void> {
    if (getDriver() !== 'gotenberg') {
      throw new Error('generateAsync() is only available with the Gotenberg driver.');
    }
    const gc = getGotenbergConfig();
    if (!this._webhook && !gc.webhookUrl) {
      throw new Error(
        'Webhook not configured. Call .webhook({ url, errorUrl }) or set webhookUrl in PDF.configure().'
      );
    }
    await this.generate();
  }

  /** Apply common Chromium form fields to the multipart builder */
  protected applyChromiumFields(form: MultipartBuilder): void {
    if (this._margins.top) form.addField('marginTop', this._margins.top);
    if (this._margins.bottom) form.addField('marginBottom', this._margins.bottom);
    if (this._margins.left) form.addField('marginLeft', this._margins.left);
    if (this._margins.right) form.addField('marginRight', this._margins.right);
    if (this._pageSize.width) form.addField('paperWidth', this._pageSize.width);
    if (this._pageSize.height) form.addField('paperHeight', this._pageSize.height);
    if (this._landscape) form.addField('landscape', 'true');
    if (this._scale !== undefined) form.addField('scale', String(this._scale));
    if (this._printBackground) form.addField('printBackground', 'true');
    if (this._preferCssPageSize) form.addField('preferCssPageSize', 'true');
    if (this._waitDelay) form.addField('waitDelay', this._waitDelay);
    if (this._waitExpression) form.addField('waitForExpression', this._waitExpression);
    if (this._pdfFormat) form.addField('pdfa', this._pdfFormat);

    for (const [key, value] of Object.entries(this._metadata)) {
      form.addField(`metadata[${key}]`, value);
    }

    if (this._downloadFrom.length > 0) {
      form.addField('downloadFrom', JSON.stringify(this._downloadFrom));
    }
  }

  /** Build webhook headers for the HTTP request */
  protected getWebhookHeaders(): Record<string, string> {
    const gc = getGotenbergConfig();
    const webhook = this._webhook ?? (
      gc.webhookUrl ? {
        url: gc.webhookUrl,
        errorUrl: gc.webhookErrorUrl ?? gc.webhookUrl,
      } : undefined
    );
    if (!webhook) return {};

    const headers: Record<string, string> = {
      'Gotenberg-Webhook-Url': webhook.url,
      'Gotenberg-Webhook-Error-Url': webhook.errorUrl,
    };
    if (webhook.method) headers['Gotenberg-Webhook-Method'] = webhook.method;
    if (webhook.errorMethod) headers['Gotenberg-Webhook-Error-Method'] = webhook.errorMethod;
    if (webhook.extraHeaders) {
      headers['Gotenberg-Webhook-Extra-Http-Headers'] = JSON.stringify(webhook.extraHeaders);
    }
    return headers;
  }

  /** Whether this builder is configured for async webhook mode */
  protected get isAsync(): boolean {
    const gc = getGotenbergConfig();
    return !!(this._webhook || gc.webhookUrl);
  }

  /**
   * Generate the PDF and save it to a file path.
   * Returns the Buffer for further processing.
   */
  async store(filePath: string): Promise<Buffer> {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    const buffer = await this.generate();
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, buffer);
    return buffer;
  }

  /** Generate the PDF and return a Buffer */
  abstract generate(): Promise<Buffer>;
}

// ── HTML → PDF ─────────────────────────────────────────────

class HtmlPdfBuilder extends PdfBuilder {
  constructor(private htmlContent: string) {
    super();
  }

  async generate(): Promise<Buffer> {
    if (getDriver() === 'pdfkit') {
      return pdfkitGenerate(
        async (doc) => {
          await renderHtmlToPdfKit(doc, this.htmlContent, getPdfKitConfig());
        },
        {
          margins: this._margins,
          pageSize: this._pageSize,
          landscape: this._landscape,
          headerHtml: this._headerHtml,
          footerHtml: this._footerHtml,
        },
      );
    }

    // Gotenberg driver
    const form = new MultipartBuilder();
    form.addFile('files', 'index.html', this.htmlContent, 'text/html');

    if (this._headerHtml) {
      form.addFile('files', 'header.html', this._headerHtml, 'text/html');
    }
    if (this._footerHtml) {
      form.addFile('files', 'footer.html', this._footerHtml, 'text/html');
    }

    this.applyChromiumFields(form);
    return sendToGotenberg('/forms/chromium/convert/html', form, this.getWebhookHeaders());
  }
}

// ── URL → PDF ──────────────────────────────────────────────

class UrlPdfBuilder extends PdfBuilder {
  constructor(private targetUrl: string) {
    super();
  }

  async generate(): Promise<Buffer> {
    if (getDriver() === 'pdfkit') {
      // PDFKit can't render a URL — fetch HTML first, then render
      const response = await fetch(this.targetUrl, { headers: this._extraHeaders });
      if (!response.ok) throw new Error(`Failed to fetch ${this.targetUrl}: ${response.status}`);
      const html = await response.text();
      return pdfkitGenerate(
        async (doc) => {
          await renderHtmlToPdfKit(doc, html, getPdfKitConfig());
        },
        {
          margins: this._margins,
          pageSize: this._pageSize,
          landscape: this._landscape,
        },
      );
    }

    // Gotenberg driver
    const form = new MultipartBuilder();
    form.addField('url', this.targetUrl);

    if (this._headerHtml) {
      form.addFile('files', 'header.html', this._headerHtml, 'text/html');
    }
    if (this._footerHtml) {
      form.addFile('files', 'footer.html', this._footerHtml, 'text/html');
    }

    for (const [key, value] of Object.entries(this._extraHeaders)) {
      form.addField(`extraHttpHeaders[${key}]`, value);
    }

    this.applyChromiumFields(form);
    return sendToGotenberg('/forms/chromium/convert/url', form, this.getWebhookHeaders());
  }

  /** Add extra HTTP headers for the URL request */
  httpHeaders(headers: Record<string, string>): this {
    this._extraHeaders = { ...this._extraHeaders, ...headers };
    return this;
  }
}

// ── Markdown → PDF ─────────────────────────────────────────

class MarkdownPdfBuilder extends PdfBuilder {
  private wrapperHtml: string;

  constructor(private markdownContent: string, wrapperHtml?: string) {
    super();
    this.wrapperHtml = wrapperHtml ?? `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body>{{ toHTML "file.md" }}</body></html>`;
  }

  async generate(): Promise<Buffer> {
    if (getDriver() === 'pdfkit') {
      // Simple markdown-to-PDF via PDFKit: render as basic formatted text
      return pdfkitGenerate(
        async (doc) => {
          const config = getPdfKitConfig();
          const font = config.font || 'Helvetica';
          const fontSize = config.fontSize || 12;
          doc.font(font).fontSize(fontSize);

          const lines = this.markdownContent.split('\n');
          for (const line of lines) {
            // Headings
            if (line.startsWith('### ')) {
              doc.fontSize(16).font(`${font}-Bold`).text(line.slice(4), { paragraphGap: 3 });
              doc.font(font).fontSize(fontSize);
            } else if (line.startsWith('## ')) {
              doc.fontSize(20).font(`${font}-Bold`).text(line.slice(3), { paragraphGap: 5 });
              doc.font(font).fontSize(fontSize);
            } else if (line.startsWith('# ')) {
              doc.fontSize(26).font(`${font}-Bold`).text(line.slice(2), { paragraphGap: 7 });
              doc.font(font).fontSize(fontSize);
            } else if (line.startsWith('- ') || line.startsWith('* ')) {
              doc.text(`  \u2022  ${line.slice(2)}`, { paragraphGap: 2 });
            } else if (line.startsWith('---') || line.startsWith('***')) {
              doc.moveDown(0.5);
              const y = doc.y;
              doc.moveTo(doc.page.margins.left, y)
                .lineTo(doc.page.width - doc.page.margins.right, y)
                .stroke('#cccccc');
              doc.moveDown(0.5);
            } else if (line.trim() === '') {
              doc.moveDown(0.5);
            } else {
              // Handle inline bold/italic
              let text = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
              doc.text(text, { paragraphGap: 2 });
            }
          }
        },
        {
          margins: this._margins,
          pageSize: this._pageSize,
          landscape: this._landscape,
        },
      );
    }

    // Gotenberg driver
    const form = new MultipartBuilder();
    form.addFile('files', 'index.html', this.wrapperHtml, 'text/html');
    form.addFile('files', 'file.md', this.markdownContent, 'text/markdown');

    if (this._headerHtml) {
      form.addFile('files', 'header.html', this._headerHtml, 'text/html');
    }
    if (this._footerHtml) {
      form.addFile('files', 'footer.html', this._footerHtml, 'text/html');
    }

    this.applyChromiumFields(form);
    return sendToGotenberg('/forms/chromium/convert/markdown', form, this.getWebhookHeaders());
  }
}

// ── Office → PDF (Gotenberg-only, LibreOffice) ─────────────

class OfficePdfBuilder extends PdfBuilder {
  private filePaths: string[] = [];
  private fileBuffers: Array<{ name: string; buffer: Buffer }> = [];

  constructor(filePathOrBuffer?: string | Buffer, filename?: string) {
    super();
    if (typeof filePathOrBuffer === 'string') {
      this.filePaths.push(filePathOrBuffer);
    } else if (Buffer.isBuffer(filePathOrBuffer) && filename) {
      this.fileBuffers.push({ name: filename, buffer: filePathOrBuffer });
    }
  }

  /** Add another file to convert (for merging multiple office docs) */
  addFile(pathOrBuffer: string | Buffer, filename?: string): this {
    if (typeof pathOrBuffer === 'string') {
      this.filePaths.push(pathOrBuffer);
    } else if (Buffer.isBuffer(pathOrBuffer) && filename) {
      this.fileBuffers.push({ name: filename, buffer: pathOrBuffer });
    }
    return this;
  }

  async generate(): Promise<Buffer> {
    if (getDriver() === 'pdfkit') {
      throw new Error(
        'Office document conversion requires the Gotenberg driver.\n' +
        'Switch with: PDF.configure({ driver: \'gotenberg\', gotenberg: { url: \'http://localhost:3000\' } })'
      );
    }

    const form = new MultipartBuilder();

    for (const filePath of this.filePaths) {
      const content = readFileSync(filePath);
      form.addFile('files', basename(filePath), content);
    }

    for (const { name, buffer } of this.fileBuffers) {
      form.addFile('files', name, buffer);
    }

    if (this._landscape) form.addField('landscape', 'true');
    if (this._pdfFormat) form.addField('pdfa', this._pdfFormat);

    if (this._downloadFrom.length > 0) {
      form.addField('downloadFrom', JSON.stringify(this._downloadFrom));
    }

    return sendToGotenberg('/forms/libreoffice/convert', form, this.getWebhookHeaders());
  }
}

// ── Merge Builder ──────────────────────────────────────────

class MergePdfBuilder extends PdfBuilder {
  private htmlFiles: Array<{ name: string; content: string }> = [];
  private pdfBuffers: Array<{ name: string; buffer: Buffer }> = [];

  /** Add an HTML page to the merge */
  addHtml(content: string, filename = `page${this.htmlFiles.length + 1}.html`): this {
    this.htmlFiles.push({ name: filename, content });
    return this;
  }

  /** Add an existing PDF buffer to merge */
  addPdf(buffer: Buffer, filename = `doc${this.pdfBuffers.length + 1}.pdf`): this {
    this.pdfBuffers.push({ name: filename, buffer });
    return this;
  }

  /** Add an existing PDF file to merge */
  addPdfFile(path: string): this {
    const buffer = readFileSync(path);
    this.pdfBuffers.push({ name: basename(path), buffer });
    return this;
  }

  async generate(): Promise<Buffer> {
    if (getDriver() === 'pdfkit') {
      throw new Error(
        'PDF merging requires the Gotenberg driver.\n' +
        'Switch with: PDF.configure({ driver: \'gotenberg\', gotenberg: { url: \'http://localhost:3000\' } })'
      );
    }

    // If we only have PDFs, use the merge endpoint
    if (this.htmlFiles.length === 0 && this.pdfBuffers.length > 0) {
      const form = new MultipartBuilder();
      for (const { name, buffer } of this.pdfBuffers) {
        form.addFile('files', name, buffer, 'application/pdf');
      }
      return sendToGotenberg('/forms/pdfengines/merge', form, this.getWebhookHeaders());
    }

    // If we have HTML, convert first then merge
    if (this.htmlFiles.length > 0 && this.pdfBuffers.length === 0) {
      const form = new MultipartBuilder();
      for (const { name, content } of this.htmlFiles) {
        form.addFile('files', name, content, 'text/html');
      }
      this.applyChromiumFields(form);
      return sendToGotenberg('/forms/chromium/convert/html', form, this.getWebhookHeaders());
    }

    // Mixed: convert HTML files to PDFs first, then merge all
    const convertedPdfs: Buffer[] = [];
    for (const { content } of this.htmlFiles) {
      const pdf = await new HtmlPdfBuilder(content).generate();
      convertedPdfs.push(pdf);
    }

    const form = new MultipartBuilder();
    let idx = 0;
    for (const pdf of convertedPdfs) {
      form.addFile('files', `converted_${idx++}.pdf`, pdf, 'application/pdf');
    }
    for (const { name, buffer } of this.pdfBuffers) {
      form.addFile('files', name, buffer, 'application/pdf');
    }
    return sendToGotenberg('/forms/pdfengines/merge', form, this.getWebhookHeaders());
  }
}

// ── Screenshot Builder (Gotenberg-only) ────────────────────

class ScreenshotBuilder {
  private _format: 'png' | 'jpeg' | 'webp' = 'png';
  private _quality = 100;
  private _width = 1920;
  private _height = 1080;
  private _clipSelector: string | undefined;

  constructor(
    private mode: 'html' | 'url',
    private content: string,
  ) {}

  format(fmt: 'png' | 'jpeg' | 'webp'): this {
    this._format = fmt;
    return this;
  }

  quality(q: number): this {
    this._quality = q;
    return this;
  }

  viewport(width: number, height: number): this {
    this._width = width;
    this._height = height;
    return this;
  }

  clip(selector: string): this {
    this._clipSelector = selector;
    return this;
  }

  async generate(): Promise<Buffer> {
    if (getDriver() === 'pdfkit') {
      throw new Error(
        'Screenshots require the Gotenberg driver.\n' +
        'Switch with: PDF.configure({ driver: \'gotenberg\', gotenberg: { url: \'http://localhost:3000\' } })'
      );
    }

    const form = new MultipartBuilder();

    if (this.mode === 'html') {
      form.addFile('files', 'index.html', this.content, 'text/html');
    } else {
      form.addField('url', this.content);
    }

    form.addField('format', this._format);
    form.addField('quality', String(this._quality));
    form.addField('width', String(this._width));
    form.addField('height', String(this._height));

    if (this._clipSelector) {
      form.addField('clipSelector', this._clipSelector);
    }

    const endpoint = this.mode === 'html'
      ? '/forms/chromium/screenshot/html'
      : '/forms/chromium/screenshot/url';

    return sendToGotenberg(endpoint, form);
  }
}

// ── PDFKit Document Builder ────────────────────────────────

/**
 * Programmatic PDF builder using PDFKit directly.
 * Use this for full control over the document layout (tables, images, etc.)
 * without going through HTML conversion.
 *
 * @example
 * ```ts
 * const buffer = await PDF.create()
 *   .margins({ top: '1in', bottom: '1in' })
 *   .build(async (doc) => {
 *     doc.fontSize(24).text('Invoice #1234', { align: 'center' });
 *     doc.moveDown();
 *     doc.fontSize(12).text('Total: $99.00');
 *     doc.addPage();
 *     doc.text('Page 2 content');
 *   });
 * ```
 */
class PdfKitDocumentBuilder {
  private _margins: PdfMargins = {};
  private _pageSize: PdfPageSize = {};
  private _landscape = false;

  margins(m: PdfMargins): this {
    this._margins = m;
    return this;
  }

  pageSize(size: PdfPageSize): this {
    this._pageSize = size;
    return this;
  }

  landscape(value = true): this {
    this._landscape = value;
    return this;
  }

  /**
   * Build the PDF by providing a callback that receives the raw PDFKit document.
   * Call any PDFKit method on `doc` — text, images, vectors, tables, etc.
   */
  async build(callback: (doc: any) => Promise<void> | void): Promise<Buffer> {
    return pdfkitGenerate(
      async (doc) => { await callback(doc); },
      {
        margins: this._margins,
        pageSize: this._pageSize,
        landscape: this._landscape,
      },
    );
  }

  /** Build and save to file in one call */
  async store(filePath: string, callback: (doc: any) => Promise<void> | void): Promise<Buffer> {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    const buffer = await this.build(callback);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, buffer);
    return buffer;
  }
}

// ── Gotenberg HTTP Transport ───────────────────────────────

function getGotenbergBaseUrl(): string {
  const gc = getGotenbergConfig();
  return gc.url ?? process.env.GOTENBERG_URL ?? 'http://localhost:3000';
}

async function sendToGotenberg(
  endpoint: string,
  form: MultipartBuilder,
  webhookHeaders?: Record<string, string>,
): Promise<Buffer> {
  const url = `${getGotenbergBaseUrl()}${endpoint}`;
  const body = form.build();
  const gc = getGotenbergConfig();
  const timeout = gc.timeout ?? 60_000;
  const isAsync = webhookHeaders && Object.keys(webhookHeaders).length > 0;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': form.contentType,
        ...(gc.headers ?? {}),
        ...(webhookHeaders ?? {}),
      },
      body: new Uint8Array(body),
      signal: controller.signal,
    });

    // Async webhook mode: Gotenberg returns 204 No Content
    if (isAsync) {
      if (response.status !== 204 && !response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Gotenberg webhook error ${response.status}: ${text || response.statusText}`);
      }
      return Buffer.alloc(0);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Gotenberg error ${response.status}: ${text || response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

// ── Health Check ───────────────────────────────────────────

async function checkHealth(): Promise<{ status: string; driver: string; details?: any }> {
  const driver = getDriver();

  if (driver === 'pdfkit') {
    try {
      await import('pdfkit');
      return { status: 'up', driver: 'pdfkit', details: { installed: true } };
    } catch {
      return { status: 'down', driver: 'pdfkit', details: { installed: false, fix: 'npm install pdfkit' } };
    }
  }

  const url = `${getGotenbergBaseUrl()}/health`;
  try {
    const response = await fetch(url);
    const data = await response.json() as any;
    return { status: response.ok ? 'up' : 'down', driver: 'gotenberg', details: data };
  } catch (err: any) {
    return { status: 'unreachable', driver: 'gotenberg', details: err.message };
  }
}

// ── Public API (Singleton Facade) ──────────────────────────

export const PDF = {
  /**
   * Configure the PDF module.
   *
   * @example
   * ```ts
   * // PDFKit (default — no Docker)
   * PDF.configure({ driver: 'pdfkit' });
   *
   * // PDFKit with custom defaults
   * PDF.configure({
   *   driver: 'pdfkit',
   *   pdfkit: { pageSize: 'Letter', font: 'Helvetica', fontSize: 11, pageNumbers: true },
   * });
   *
   * // Gotenberg (Docker service)
   * PDF.configure({
   *   driver: 'gotenberg',
   *   gotenberg: { url: 'http://localhost:3000', timeout: 60000 },
   * });
   * ```
   */
  configure(config: PdfConfig): void {
    _config = { ..._config, ...config };
  },

  /** Get the current driver name */
  get driver(): string {
    return getDriver();
  },

  /** Convert HTML string to PDF */
  html(content: string): HtmlPdfBuilder {
    return new HtmlPdfBuilder(content);
  },

  /** Convert a URL to PDF */
  url(targetUrl: string): UrlPdfBuilder {
    return new UrlPdfBuilder(targetUrl);
  },

  /** Convert Markdown to PDF */
  markdown(content: string, wrapperHtml?: string): MarkdownPdfBuilder {
    return new MarkdownPdfBuilder(content, wrapperHtml);
  },

  /** Convert office documents (docx, xlsx, pptx, odt, etc.) to PDF. Requires Gotenberg driver. */
  office(pathOrBuffer: string | Buffer, filename?: string): OfficePdfBuilder {
    return new OfficePdfBuilder(pathOrBuffer, filename);
  },

  /** Merge multiple PDFs or HTML pages into one PDF. Requires Gotenberg driver. */
  merge(): MergePdfBuilder {
    return new MergePdfBuilder();
  },

  /**
   * Create a programmatic PDF using the raw PDFKit API.
   * Available regardless of the configured driver.
   *
   * @example
   * ```ts
   * const buffer = await PDF.create()
   *   .margins({ top: '1in', bottom: '1in' })
   *   .build(async (doc) => {
   *     doc.fontSize(24).text('Invoice #1234', { align: 'center' });
   *     doc.moveDown();
   *     doc.fontSize(12).text('Total: $99.00');
   *   });
   * ```
   */
  create(): PdfKitDocumentBuilder {
    return new PdfKitDocumentBuilder();
  },

  /** Take a screenshot of HTML content. Requires Gotenberg driver. */
  screenshotHtml(content: string): ScreenshotBuilder {
    return new ScreenshotBuilder('html', content);
  },

  /** Take a screenshot of a URL. Requires Gotenberg driver. */
  screenshotUrl(targetUrl: string): ScreenshotBuilder {
    return new ScreenshotBuilder('url', targetUrl);
  },

  /** Check if the configured driver is healthy and available */
  health: checkHealth,

  /**
   * Dispatch PDF generation as a background queue job.
   */
  async dispatch(payload: import('./GeneratePdfJob.js').PdfJobPayload): Promise<void> {
    const { GeneratePdfJob } = await import('./GeneratePdfJob.js');
    const { Queue } = await import('../queue/index.js');
    await Queue.dispatch(new GeneratePdfJob(payload) as any);
  },
};

// Re-export types and builders
export type { HtmlPdfBuilder, UrlPdfBuilder, MarkdownPdfBuilder, OfficePdfBuilder, MergePdfBuilder, ScreenshotBuilder, PdfKitDocumentBuilder };
export { GeneratePdfJob } from './GeneratePdfJob.js';
export type { PdfJobPayload } from './GeneratePdfJob.js';
