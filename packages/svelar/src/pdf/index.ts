/**
 * Svelar PDF Module
 *
 * Provides a fluent API for generating PDFs via Gotenberg — a Docker-based
 * document conversion service. Supports HTML → PDF, URL → PDF, Markdown → PDF,
 * and Office document → PDF conversions via Chromium and LibreOffice engines.
 *
 * @example
 * ```typescript
 * import { PDF } from 'svelar/pdf';
 *
 * // HTML to PDF
 * const buffer = await PDF.html('<h1>Hello</h1>').generate();
 *
 * // URL to PDF with options
 * const buffer = await PDF.url('https://example.com')
 *   .landscape()
 *   .margins({ top: '1in', bottom: '1in' })
 *   .generate();
 *
 * // From a .docx, .xlsx, .pptx, etc.
 * const buffer = await PDF.office('/path/to/document.docx').generate();
 *
 * // Multiple HTML files merged into one PDF
 * const buffer = await PDF.merge()
 *   .addHtml('<h1>Page 1</h1>', 'page1.html')
 *   .addHtml('<h2>Page 2</h2>', 'page2.html')
 *   .generate();
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

// ── Multipart Helper ───────────────────────────────────────

/** Simple multipart/form-data builder (no external deps) */
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
   *
   * @example
   * ```ts
   * await PDF.html(content)
   *   .webhook({
   *     url: 'https://myapp.com/api/pdf/webhook',
   *     errorUrl: 'https://myapp.com/api/pdf/webhook-error',
   *     extraHeaders: { 'Authorization': 'Bearer secret' },
   *   })
   *   .generateAsync();
   * ```
   */
  webhook(options: WebhookOptions): this {
    this._webhook = options;
    return this;
  }

  /**
   * Add remote files for Gotenberg to fetch (instead of uploading them).
   * Gotenberg downloads the file from the URL before processing.
   * The remote server MUST return a Content-Disposition header with a filename.
   *
   * @example
   * ```ts
   * await PDF.office()
   *   .downloadFrom([
   *     { url: 'https://s3.example.com/report.docx' },
   *     { url: 'https://cdn.example.com/appendix.xlsx', extraHttpHeaders: { 'X-Api-Key': '...' } },
   *   ])
   *   .generate();
   * ```
   */
  downloadFrom(entries: DownloadFromEntry[]): this {
    this._downloadFrom = entries;
    return this;
  }

  /**
   * Generate the PDF asynchronously via webhook.
   * Gotenberg returns 204 immediately and posts the result to your webhook URL.
   * Requires `.webhook()` to be called first (or a default webhookUrl in config).
   */
  async generateAsync(): Promise<void> {
    if (!this._webhook && !_config.webhookUrl) {
      throw new Error(
        'Webhook not configured. Call .webhook({ url, errorUrl }) or set webhookUrl in PDF.configure().'
      );
    }
    // generateAsync delegates to the same generate() but the transport layer
    // detects the webhook headers and expects 204.
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
    const webhook = this._webhook ?? (
      _config.webhookUrl ? {
        url: _config.webhookUrl,
        errorUrl: _config.webhookErrorUrl ?? _config.webhookUrl,
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
    return !!(this._webhook || _config.webhookUrl);
  }

  /**
   * Generate the PDF and save it to a file path.
   * Returns the Buffer for further processing.
   *
   * @example
   * ```ts
   * const buffer = await PDF.html(content).store('storage/reports/invoice.pdf');
   * ```
   */
  async store(filePath: string): Promise<Buffer> {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    const buffer = await this.generate();
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, buffer);
    return buffer;
  }

  /** Generate the PDF and return a Buffer (sync), or fire-and-forget via webhook (async) */
  abstract generate(): Promise<Buffer>;
}

// ── HTML → PDF ─────────────────────────────────────────────

class HtmlPdfBuilder extends PdfBuilder {
  constructor(private htmlContent: string) {
    super();
  }

  async generate(): Promise<Buffer> {
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

// ── Office → PDF (LibreOffice) ─────────────────────────────

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

// ── Screenshot Builder ─────────────────────────────────────

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

// ── HTTP Transport ─────────────────────────────────────────

let _config: GotenbergConfig = {};

function getBaseUrl(): string {
  return _config.url ?? process.env.GOTENBERG_URL ?? 'http://localhost:3000';
}

async function sendToGotenberg(
  endpoint: string,
  form: MultipartBuilder,
  webhookHeaders?: Record<string, string>,
): Promise<Buffer> {
  const url = `${getBaseUrl()}${endpoint}`;
  const body = form.build();
  const timeout = _config.timeout ?? 60_000;
  const isAsync = webhookHeaders && Object.keys(webhookHeaders).length > 0;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': form.contentType,
        ...(_config.headers ?? {}),
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
      return Buffer.alloc(0); // No content — result sent to webhook
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

async function checkHealth(): Promise<{ status: string; details?: any }> {
  const url = `${getBaseUrl()}/health`;
  try {
    const response = await fetch(url);
    const data = await response.json() as any;
    return { status: response.ok ? 'up' : 'down', details: data };
  } catch (err: any) {
    return { status: 'unreachable', details: err.message };
  }
}

// ── Public API (Singleton Facade) ──────────────────────────

export const PDF = {
  /** Configure the Gotenberg connection */
  configure(config: GotenbergConfig): void {
    _config = { ..._config, ...config };
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

  /** Convert office documents (docx, xlsx, pptx, odt, etc.) to PDF */
  office(pathOrBuffer: string | Buffer, filename?: string): OfficePdfBuilder {
    return new OfficePdfBuilder(pathOrBuffer, filename);
  },

  /** Merge multiple PDFs or HTML pages into one PDF */
  merge(): MergePdfBuilder {
    return new MergePdfBuilder();
  },

  /** Take a screenshot of HTML content */
  screenshotHtml(content: string): ScreenshotBuilder {
    return new ScreenshotBuilder('html', content);
  },

  /** Take a screenshot of a URL */
  screenshotUrl(targetUrl: string): ScreenshotBuilder {
    return new ScreenshotBuilder('url', targetUrl);
  },

  /** Check if Gotenberg is healthy and reachable */
  health: checkHealth,

  /**
   * Dispatch PDF generation as a background queue job.
   * The job runs in a worker process, keeping your request fast.
   *
   * @example
   * ```ts
   * // Generate in background, save to disk
   * await PDF.dispatch({
   *   type: 'html',
   *   content: invoiceHtml,
   *   outputPath: `storage/invoices/inv-${id}.pdf`,
   *   broadcastEvent: 'PdfReady',
   *   broadcastChannel: `private-user.${userId}`,
   * });
   *
   * // Generate in background with Gotenberg webhook
   * await PDF.dispatch({
   *   type: 'url',
   *   content: 'https://example.com/report',
   *   webhook: {
   *     url: 'https://myapp.com/api/pdf/webhook',
   *     errorUrl: 'https://myapp.com/api/pdf/webhook-error',
   *   },
   * });
   * ```
   */
  async dispatch(payload: import('./GeneratePdfJob.js').PdfJobPayload): Promise<void> {
    const { GeneratePdfJob } = await import('./GeneratePdfJob.js');
    const { Queue } = await import('../queue/index.js');
    await Queue.dispatch(new GeneratePdfJob(payload) as any);
  },
};

// Re-export types and builders
export type { HtmlPdfBuilder, UrlPdfBuilder, MarkdownPdfBuilder, OfficePdfBuilder, MergePdfBuilder, ScreenshotBuilder };
export { GeneratePdfJob } from './GeneratePdfJob.js';
export type { PdfJobPayload } from './GeneratePdfJob.js';
