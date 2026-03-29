/**
 * Svelar Response Classes
 *
 * Laravel-inspired dedicated response objects for SvelteKit route handlers.
 * These provide a fluent, testable API for building HTTP responses outside
 * of controllers.
 *
 * @example
 * ```ts
 * import { JsonResponse, RedirectResponse } from '@beeblock/svelar/routing';
 *
 * return new JsonResponse({ name: 'John' });
 * return new JsonResponse({ message: 'Created' }, 201);
 * return JsonResponse.success({ id: 1 });
 * return JsonResponse.error('Not found', 404);
 * return new RedirectResponse('/login');
 * return new DownloadResponse(buffer, 'report.pdf');
 * return new StreamedResponse(readableStream, 'text/event-stream');
 * ```
 */

// ── JsonResponse ──────────────────────────────────────────

export class JsonResponse {
  private statusCode: number;
  private body: any;
  private extraHeaders: Record<string, string> = {};

  constructor(data: any = null, status: number = 200, headers: Record<string, string> = {}) {
    this.body = data;
    this.statusCode = status;
    this.extraHeaders = headers;
  }

  /**
   * Set response headers (fluent).
   */
  header(name: string, value: string): this {
    this.extraHeaders[name] = value;
    return this;
  }

  /**
   * Set multiple headers (fluent).
   */
  headers(headers: Record<string, string>): this {
    Object.assign(this.extraHeaders, headers);
    return this;
  }

  /**
   * Set the status code (fluent).
   */
  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  /**
   * Convert to a Response object.
   */
  toResponse(): Response {
    return new Response(JSON.stringify(this.body, null, 2), {
      status: this.statusCode,
      headers: {
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
    });
  }

  // ── Static Factories ──────────────────────────────────────

  /** 200 with data */
  static success(data: any, headers?: Record<string, string>): Response {
    return new JsonResponse(data, 200, headers).toResponse();
  }

  /** 201 Created */
  static created(data: any, headers?: Record<string, string>): Response {
    return new JsonResponse(data, 201, headers).toResponse();
  }

  /** Error response with message */
  static error(message: string, status: number = 500, errors?: Record<string, string[]>): Response {
    const body: any = { message };
    if (errors) body.errors = errors;
    return new JsonResponse(body, status).toResponse();
  }

  /** 422 Validation Error */
  static validationError(errors: Record<string, string[]>, message: string = 'Validation failed'): Response {
    return new JsonResponse({ message, errors }, 422).toResponse();
  }

  /** 204 No Content */
  static noContent(): Response {
    return new Response(null, { status: 204 });
  }
}

// ── RedirectResponse ──────────────────────────────────────

export class RedirectResponse {
  private statusCode: number;
  private url: string;
  private extraHeaders: Record<string, string> = {};

  constructor(url: string, status: number = 302) {
    this.url = url;
    this.statusCode = status;
  }

  /**
   * Set additional headers.
   */
  header(name: string, value: string): this {
    this.extraHeaders[name] = value;
    return this;
  }

  /**
   * Convert to a Response object.
   */
  toResponse(): Response {
    return new Response(null, {
      status: this.statusCode,
      headers: {
        Location: this.url,
        ...this.extraHeaders,
      },
    });
  }

  // ── Static Factories ──────────────────────────────────────

  /** 302 Temporary redirect */
  static to(url: string): Response {
    return new RedirectResponse(url, 302).toResponse();
  }

  /** 301 Permanent redirect */
  static permanent(url: string): Response {
    return new RedirectResponse(url, 301).toResponse();
  }

  /** 307 Temporary redirect (preserves method) */
  static temporary(url: string): Response {
    return new RedirectResponse(url, 307).toResponse();
  }

  /** Redirect back using Referer header, with a fallback URL */
  static back(request: Request, fallback: string = '/'): Response {
    const referer = request.headers.get('referer') ?? fallback;
    return new RedirectResponse(referer, 302).toResponse();
  }
}

// ── DownloadResponse ──────────────────────────────────────

export class DownloadResponse {
  private statusCode = 200;
  private body: BodyInit;
  private filename: string;
  private contentType: string;
  private extraHeaders: Record<string, string> = {};

  constructor(body: BodyInit, filename: string, contentType?: string) {
    this.body = body;
    this.filename = filename;
    this.contentType = contentType ?? this.inferContentType(filename);
  }

  /**
   * Set additional headers.
   */
  header(name: string, value: string): this {
    this.extraHeaders[name] = value;
    return this;
  }

  /**
   * Set the status code.
   */
  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  /**
   * Convert to a Response object with Content-Disposition: attachment.
   */
  toResponse(): Response {
    return new Response(this.body, {
      status: this.statusCode,
      headers: {
        'Content-Type': this.contentType,
        'Content-Disposition': `attachment; filename="${this.filename}"`,
        ...this.extraHeaders,
      },
    });
  }

  // ── Static Factories ──────────────────────────────────────

  /** Download from a string or buffer */
  static make(body: BodyInit, filename: string, contentType?: string): Response {
    return new DownloadResponse(body, filename, contentType).toResponse();
  }

  /** Download JSON as a file */
  static json(data: any, filename: string = 'data.json'): Response {
    const body = JSON.stringify(data, null, 2);
    return new DownloadResponse(body, filename, 'application/json').toResponse();
  }

  /** Download CSV */
  static csv(content: string, filename: string = 'export.csv'): Response {
    return new DownloadResponse(content, filename, 'text/csv; charset=utf-8').toResponse();
  }

  private inferContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      json: 'application/json',
      csv: 'text/csv',
      txt: 'text/plain',
      pdf: 'application/pdf',
      zip: 'application/zip',
      xml: 'application/xml',
      html: 'text/html',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return types[ext ?? ''] ?? 'application/octet-stream';
  }
}

// ── StreamedResponse ──────────────────────────────────────

export class StreamedResponse {
  private statusCode = 200;
  private body: ReadableStream | BodyInit;
  private contentType: string;
  private extraHeaders: Record<string, string> = {};

  constructor(body: ReadableStream | BodyInit, contentType: string = 'text/event-stream') {
    this.body = body;
    this.contentType = contentType;
  }

  /**
   * Set additional headers.
   */
  header(name: string, value: string): this {
    this.extraHeaders[name] = value;
    return this;
  }

  /**
   * Set the status code.
   */
  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  /**
   * Convert to a Response object.
   */
  toResponse(): Response {
    return new Response(this.body as BodyInit, {
      status: this.statusCode,
      headers: {
        'Content-Type': this.contentType,
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...this.extraHeaders,
      },
    });
  }

  // ── Static Factories ──────────────────────────────────────

  /**
   * Create an SSE (Server-Sent Events) stream from a generator function.
   *
   * @example
   * ```ts
   * return StreamedResponse.sse(async function* () {
   *   yield { event: 'update', data: { count: 1 } };
   *   yield { data: 'plain text message' };
   * });
   * ```
   */
  static sse(
    generator: () => AsyncGenerator<{ event?: string; data: any; id?: string }, void, unknown>
  ): Response {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of generator()) {
            let message = '';
            if (chunk.id) message += `id: ${chunk.id}\n`;
            if (chunk.event) message += `event: ${chunk.event}\n`;
            const data = typeof chunk.data === 'string' ? chunk.data : JSON.stringify(chunk.data);
            message += `data: ${data}\n\n`;
            controller.enqueue(encoder.encode(message));
          }
        } catch (err) {
          // Stream aborted or error — close
        } finally {
          controller.close();
        }
      },
    });

    return new StreamedResponse(stream, 'text/event-stream').toResponse();
  }

  /** Create a simple text stream */
  static text(body: ReadableStream): Response {
    return new StreamedResponse(body, 'text/plain').toResponse();
  }
}
