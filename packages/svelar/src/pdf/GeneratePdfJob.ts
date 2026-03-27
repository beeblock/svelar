/**
 * GeneratePdfJob — Queue job for async PDF generation
 *
 * Dispatches PDF generation to a background worker instead of blocking
 * the request. Works with any Svelar queue driver (sync, memory, database).
 *
 * @example
 * ```ts
 * import { Queue } from 'svelar/queue';
 * import { GeneratePdfJob } from 'svelar/pdf/GeneratePdfJob';
 *
 * // Register once in src/app.ts
 * Queue.register(GeneratePdfJob);
 *
 * // Dispatch from a controller
 * await Queue.dispatch(new GeneratePdfJob({
 *   type: 'html',
 *   content: '<h1>Invoice</h1><p>Total: $99</p>',
 *   outputPath: 'storage/invoices/inv-001.pdf',
 *   options: { margins: { top: '1in', bottom: '1in' } },
 * }));
 *
 * // With webhook (fires and forgets to Gotenberg)
 * await Queue.dispatch(new GeneratePdfJob({
 *   type: 'url',
 *   content: 'https://example.com/report',
 *   webhook: {
 *     url: 'https://myapp.com/api/pdf/webhook',
 *     errorUrl: 'https://myapp.com/api/pdf/webhook-error',
 *   },
 * }));
 * ```
 */

// Lazy-import to avoid circular dependency when module is loaded
// but queue/pdf aren't both used.

export interface PdfJobPayload {
  /** Type of conversion */
  type: 'html' | 'url' | 'markdown' | 'office';
  /** The HTML string, URL, markdown string, or file path */
  content: string;
  /** Optional file path to save the result (sync mode) */
  outputPath?: string;
  /** PDF options */
  options?: {
    margins?: { top?: string; bottom?: string; left?: string; right?: string };
    landscape?: boolean;
    scale?: number;
    headerHtml?: string;
    footerHtml?: string;
    printBackground?: boolean;
    waitDelay?: string;
    waitForExpression?: string;
    pdfFormat?: string;
    pageSize?: { width?: string; height?: string };
  };
  /** Webhook options for async Gotenberg processing */
  webhook?: {
    url: string;
    errorUrl: string;
    method?: 'POST' | 'PUT' | 'PATCH';
    extraHeaders?: Record<string, string>;
  };
  /** Callback event name to broadcast on completion (optional) */
  broadcastEvent?: string;
  /** Broadcast channel for completion notification (optional) */
  broadcastChannel?: string;
  /** Arbitrary metadata to pass through to webhook/broadcast */
  meta?: Record<string, any>;
}

// We need to get the Job class, but import it lazily to avoid forcing
// the queue module to load at parse time.
let _JobClass: any = null;

async function getJobClass(): Promise<any> {
  if (_JobClass) return _JobClass;
  const mod = await import('../queue/index.js');
  _JobClass = mod.Job;
  return _JobClass;
}

/**
 * A queue job that generates a PDF using the Svelar PDF module.
 *
 * Supports sync generation (with file storage) and async webhook mode.
 * Optionally broadcasts a completion event so the client can react.
 */
export class GeneratePdfJob {
  /** Queue job name for serialization */
  static readonly jobName = 'GeneratePdfJob';

  /** Max retry attempts */
  maxAttempts = 3;

  /** Retry delay in seconds */
  retryDelay = 30;

  /** Queue name */
  queue = 'default';

  constructor(public payload: PdfJobPayload) {}

  async handle(): Promise<void> {
    const { PDF } = await import('./index.js');

    const { type, content, outputPath, options, webhook, broadcastEvent, broadcastChannel, meta } = this.payload;

    // Build the appropriate PDF builder
    let builder: any;
    switch (type) {
      case 'html':
        builder = PDF.html(content);
        break;
      case 'url':
        builder = PDF.url(content);
        break;
      case 'markdown':
        builder = PDF.markdown(content);
        break;
      case 'office':
        builder = PDF.office(content);
        break;
      default:
        throw new Error(`Unknown PDF type: ${type}`);
    }

    // Apply options
    if (options) {
      if (options.margins) builder.margins(options.margins);
      if (options.landscape) builder.landscape();
      if (options.scale) builder.scale(options.scale);
      if (options.headerHtml) builder.header(options.headerHtml);
      if (options.footerHtml) builder.footer(options.footerHtml);
      if (options.printBackground !== undefined) builder.printBackground(options.printBackground);
      if (options.waitDelay) builder.waitDelay(options.waitDelay);
      if (options.waitForExpression) builder.waitForExpression(options.waitForExpression);
      if (options.pdfFormat) builder.pdfFormat(options.pdfFormat);
      if (options.pageSize) builder.pageSize(options.pageSize);
    }

    // Webhook mode: fire and forget
    if (webhook) {
      builder.webhook({
        url: webhook.url,
        errorUrl: webhook.errorUrl,
        method: webhook.method,
        extraHeaders: {
          ...(webhook.extraHeaders ?? {}),
          // Pass through job metadata in the webhook headers
          ...(meta ? { 'X-Svelar-Pdf-Meta': JSON.stringify(meta) } : {}),
        },
      });
      await builder.generateAsync();
      return;
    }

    // Sync mode: generate and store
    if (outputPath) {
      await builder.store(outputPath);
    } else {
      await builder.generate();
    }

    // Optional: broadcast a completion event
    if (broadcastEvent && broadcastChannel) {
      try {
        const { Broadcast } = await import('../broadcasting/index.js');
        await Broadcast.to(broadcastChannel).send(broadcastEvent, {
          outputPath,
          meta,
          completedAt: new Date().toISOString(),
        });
      } catch {
        // Broadcasting is optional — don't fail the job if it's not configured
      }
    }
  }

  failed(error: Error): void {
    console.error(`[GeneratePdfJob] Failed:`, error.message, this.payload);
  }

  /** Serialize for database queue driver */
  serialize(): Record<string, any> {
    return { payload: this.payload };
  }

  /** Restore from database queue driver */
  restore(data: Record<string, any>): void {
    this.payload = data.payload;
  }
}
