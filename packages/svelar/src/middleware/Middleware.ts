/**
 * Svelar Middleware
 *
 * Laravel-inspired middleware system that integrates with SvelteKit hooks.
 *
 * @example
 * ```ts
 * class AuthMiddleware extends Middleware {
 *   async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
 *     const token = ctx.event.request.headers.get('authorization');
 *     if (!token) return new Response('Unauthorized', { status: 401 });
 *     ctx.event.locals.user = await verifyToken(token);
 *     return next();
 *   }
 * }
 * ```
 */

import { createHmac } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────

export interface MiddlewareContext {
  /** The SvelteKit RequestEvent */
  event: any;
  /** Route parameters */
  params: Record<string, any>;
  /** App.Locals */
  locals: Record<string, any>;
}

export type NextFunction = () => Promise<Response | void>;

export type MiddlewareHandler = (ctx: MiddlewareContext, next: NextFunction) => Promise<Response | void>;

// ── Base Middleware Class ───────────────────────────────────

export abstract class Middleware {
  /**
   * Handle the incoming request.
   * Call next() to pass the request to the next middleware.
   * Return a Response to short-circuit the pipeline.
   */
  abstract handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void>;
}

// ── Middleware Stack ────────────────────────────────────────

export class MiddlewareStack {
  private middleware: Array<Middleware | MiddlewareHandler> = [];
  private namedMiddleware = new Map<string, Middleware | MiddlewareHandler>();

  /**
   * Add middleware to the stack
   */
  use(middleware: Middleware | MiddlewareHandler | (new () => Middleware)): this {
    if (typeof middleware === 'function' && 'prototype' in middleware && typeof middleware.prototype?.handle === 'function') {
      // It's a class constructor — instantiate it
      this.middleware.push(new (middleware as new () => Middleware)());
    } else {
      this.middleware.push(middleware as Middleware | MiddlewareHandler);
    }
    return this;
  }

  /**
   * Register named middleware (for per-route usage)
   */
  register(name: string, middleware: Middleware | MiddlewareHandler | (new () => Middleware)): this {
    if (typeof middleware === 'function' && 'prototype' in middleware && typeof middleware.prototype?.handle === 'function') {
      this.namedMiddleware.set(name, new (middleware as new () => Middleware)());
    } else {
      this.namedMiddleware.set(name, middleware as Middleware | MiddlewareHandler);
    }
    return this;
  }

  /**
   * Get a named middleware
   */
  get(name: string): Middleware | MiddlewareHandler | undefined {
    return this.namedMiddleware.get(name);
  }

  /**
   * Execute the middleware stack
   */
  async execute(
    ctx: MiddlewareContext,
    finalHandler: () => Promise<Response | void>,
    additionalMiddleware?: string[]
  ): Promise<Response | void> {
    // Combine global middleware + named middleware for this route
    const stack: Array<Middleware | MiddlewareHandler> = [...this.middleware];

    if (additionalMiddleware) {
      for (const name of additionalMiddleware) {
        const mw = this.namedMiddleware.get(name);
        if (mw) stack.push(mw);
      }
    }

    // Build the chain from right to left
    let next: () => Promise<Response | void> = finalHandler;

    for (let i = stack.length - 1; i >= 0; i--) {
      const mw = stack[i];
      const currentNext = next;

      // Duck-type check: if it has a .handle() method, treat as Middleware instance
      // (instanceof fails across tsup bundle boundaries due to duplicate class copies)
      if (typeof (mw as Middleware).handle === 'function') {
        next = () => (mw as Middleware).handle(ctx, currentNext);
      } else {
        next = () => (mw as MiddlewareHandler)(ctx, currentNext);
      }
    }

    return next();
  }

  /**
   * Get the count of global middleware
   */
  count(): number {
    return this.middleware.length;
  }
}

// ── Built-in Middleware ─────────────────────────────────────

/** CORS Middleware */
export class CorsMiddleware extends Middleware {
  constructor(
    private options: {
      origin?: string | string[];
      methods?: string[];
      headers?: string[];
      credentials?: boolean;
      maxAge?: number;
    } = {}
  ) {
    super();
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const response = await next();

    // If there's no response to modify, bail
    if (!response) return;

    const origin = Array.isArray(this.options.origin)
      ? this.options.origin.join(', ')
      : this.options.origin ?? '*';

    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set(
      'Access-Control-Allow-Methods',
      (this.options.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']).join(', ')
    );
    response.headers.set(
      'Access-Control-Allow-Headers',
      (this.options.headers ?? ['Content-Type', 'Authorization']).join(', ')
    );

    if (this.options.credentials) {
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }

    if (this.options.maxAge) {
      response.headers.set('Access-Control-Max-Age', String(this.options.maxAge));
    }

    // Handle preflight
    if (ctx.event.request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: response.headers });
    }

    return response;
  }
}

/** Rate Limiting Middleware */
export class RateLimitMiddleware extends Middleware {
  private requests = new Map<string, { count: number; resetAt: number }>();
  private maxRequests: number;
  private windowMs: number;

  constructor(options: { maxRequests?: number; windowMs?: number } = {}) {
    super();
    this.maxRequests = options.maxRequests ?? 60;
    this.windowMs = options.windowMs ?? 60_000;
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const ip =
      ctx.event.request.headers.get('x-forwarded-for') ??
      ctx.event.getClientAddress?.() ??
      'unknown';

    const now = Date.now();
    const entry = this.requests.get(ip);

    if (entry && now < entry.resetAt) {
      if (entry.count >= this.maxRequests) {
        return new Response(
          JSON.stringify({ error: 'Too many requests' }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)),
            },
          }
        );
      }
      entry.count++;
    } else {
      this.requests.set(ip, { count: 1, resetAt: now + this.windowMs });
    }

    return next();
  }
}

/** Logging Middleware */
export class LoggingMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const start = Date.now();
    const method = ctx.event.request.method;
    const url = ctx.event.url.pathname;

    const response = await next();

    const duration = Date.now() - start;
    const status = response instanceof Response ? response.status : 200;
    console.log(`[${new Date().toISOString()}] ${method} ${url} → ${status} (${duration}ms)`);

    return response;
  }
}

// ── Security Middleware ──────────────────────────────────────

/**
 * CSRF Protection Middleware (Double-submit cookie pattern)
 *
 * Generates a random CSRF token, sets it as a cookie, and validates
 * that mutation requests (POST, PUT, PATCH, DELETE) include the token
 * in either the `X-CSRF-Token` header or a `_csrf` body field.
 *
 * Safe methods (GET, HEAD, OPTIONS) and API requests with Bearer tokens
 * are exempt since they are not vulnerable to CSRF.
 */
export class CsrfMiddleware extends Middleware {
  private cookieName: string;
  private headerName: string;
  private fieldName: string;
  private excludePaths: string[];
  private onlyPaths: string[] | null;

  constructor(
    options: {
      cookieName?: string;
      headerName?: string;
      fieldName?: string;
      excludePaths?: string[];
      /** If set, CSRF validation only applies to requests matching these path prefixes */
      onlyPaths?: string[];
    } = {}
  ) {
    super();
    this.cookieName = options.cookieName ?? 'XSRF-TOKEN';
    this.headerName = options.headerName ?? 'X-CSRF-Token';
    this.fieldName = options.fieldName ?? '_csrf';
    this.excludePaths = options.excludePaths ?? [];
    this.onlyPaths = options.onlyPaths ?? null;
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const { event } = ctx;
    const method = event.request.method.toUpperCase();

    // Safe methods don't need CSRF validation
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return this.setTokenAndContinue(ctx, next);
    }

    // Requests with Bearer token (API calls) are exempt — they're not CSRF-vulnerable
    const authHeader = event.request.headers.get('authorization') ?? '';
    if (authHeader.startsWith('Bearer ')) {
      return next();
    }

    // Only enforce CSRF on specific paths (if configured)
    const pathname = event.url.pathname;
    if (this.onlyPaths && !this.onlyPaths.some((p) => pathname.startsWith(p))) {
      return this.setTokenAndContinue(ctx, next);
    }

    // Excluded paths (e.g. webhooks)
    if (this.excludePaths.some((p) => pathname.startsWith(p))) {
      return next();
    }

    // Validate CSRF token
    const cookieToken = this.getCookieToken(event);
    const submittedToken =
      event.request.headers.get(this.headerName) ??
      (await this.getBodyToken(event));

    if (!cookieToken || !submittedToken || !this.timingSafeEqual(cookieToken, submittedToken)) {
      return new Response(
        JSON.stringify({ message: 'CSRF token mismatch' }),
        {
          status: 419,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return next();
  }

  private async setTokenAndContinue(
    ctx: MiddlewareContext,
    next: NextFunction
  ): Promise<Response | void> {
    const response = await next();
    if (!(response instanceof Response)) return response;

    // Always (re-)set the cookie without HttpOnly so client JS can read it.
    // This also repairs cookies previously set with the invalid `HttpOnly=false` attribute.
    const existing = this.getCookieToken(ctx.event);
    const token = existing || this.generateToken();
    response.headers.append(
      'Set-Cookie',
      `${this.cookieName}=${token}; Path=/; SameSite=Lax`
    );
    return response;
  }

  private getCookieToken(event: any): string | null {
    const cookies = event.request.headers.get('cookie') ?? '';
    const match = cookies.match(new RegExp(`${this.cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  private async getBodyToken(event: any): Promise<string | null> {
    try {
      const ct = event.request.headers.get('content-type') ?? '';
      if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
        const clone = event.request.clone();
        const formData = await clone.formData();
        return formData.get(this.fieldName) as string | null;
      }
      if (ct.includes('application/json')) {
        const clone = event.request.clone();
        const body = await clone.json();
        return body[this.fieldName] ?? null;
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  private generateToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const encoder = new TextEncoder();
    const bufA = encoder.encode(a);
    const bufB = encoder.encode(b);
    let result = 0;
    for (let i = 0; i < bufA.length; i++) {
      result |= bufA[i] ^ bufB[i];
    }
    return result === 0;
  }
}

/**
 * Origin Validation Middleware
 *
 * Blocks mutation requests (POST, PUT, PATCH, DELETE) where the Origin header
 * doesn't match the application's own origin. Prevents cross-origin API abuse.
 *
 * SvelteKit's own CSRF check validates Origin on form submissions, but this
 * extends the protection to fetch/XHR API calls as well.
 */
export class OriginMiddleware extends Middleware {
  private allowedOrigins: Set<string>;

  constructor(
    options: {
      /** Extra allowed origins beyond the app's own (e.g. for mobile apps or partner APIs) */
      allowedOrigins?: string[];
    } = {}
  ) {
    super();
    this.allowedOrigins = new Set(options.allowedOrigins ?? []);
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const { event } = ctx;
    const method = event.request.method.toUpperCase();

    // Safe methods are fine
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next();
    }

    // API calls with Bearer tokens are exempt (not browser-initiated)
    const authHeader = event.request.headers.get('authorization') ?? '';
    if (authHeader.startsWith('Bearer ')) {
      return next();
    }

    const origin = event.request.headers.get('origin');

    // No Origin header — could be same-origin (some browsers omit it) or a server-to-server call
    // Fall through and let other middleware (CSRF) handle it
    if (!origin) {
      return next();
    }

    // Check against the app's own origin
    const appOrigin = event.url.origin;
    if (origin === appOrigin || this.allowedOrigins.has(origin)) {
      return next();
    }

    return new Response(
      JSON.stringify({ message: 'Cross-origin request blocked' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * API Signature Verification Middleware
 *
 * Verifies that incoming API requests are signed with an HMAC signature.
 * This provides an extra layer of security beyond Bearer tokens — even if
 * a token is stolen, requests can't be forged without the signing secret.
 *
 * Clients sign requests by computing:
 *   HMAC-SHA256(secret, timestamp + method + path + body)
 *
 * And sending the signature + timestamp in headers:
 *   X-Signature: <hex digest>
 *   X-Timestamp: <unix seconds>
 *
 * The middleware rejects requests with:
 * - Missing signature or timestamp headers
 * - Timestamp older than the tolerance window (prevents replay attacks)
 * - Invalid HMAC signature
 *
 * @example
 * ```ts
 * new SignatureMiddleware({
 *   secret: process.env.API_SIGNING_SECRET,
 *   tolerance: 300,  // 5 minutes
 * })
 * ```
 */
export class SignatureMiddleware extends Middleware {
  private secret: string;
  private tolerance: number;
  private signatureHeader: string;
  private timestampHeader: string;
  private onlyPaths: string[] | null;

  constructor(
    options: {
      /** The shared signing secret */
      secret: string;
      /** Max age of a request in seconds (default: 300 = 5 minutes) */
      tolerance?: number;
      /** Header name for the signature (default: 'X-Signature') */
      signatureHeader?: string;
      /** Header name for the timestamp (default: 'X-Timestamp') */
      timestampHeader?: string;
      /** If set, only enforce signature on these path prefixes */
      onlyPaths?: string[];
    }
  ) {
    super();
    this.secret = options.secret;
    this.tolerance = options.tolerance ?? 300;
    this.signatureHeader = options.signatureHeader ?? 'X-Signature';
    this.timestampHeader = options.timestampHeader ?? 'X-Timestamp';
    this.onlyPaths = options.onlyPaths ?? null;
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const { event } = ctx;

    // Only enforce on matching paths (if configured)
    if (this.onlyPaths) {
      const pathname = event.url.pathname;
      if (!this.onlyPaths.some((p: string) => pathname.startsWith(p))) {
        return next();
      }
    }

    const signature = event.request.headers.get(this.signatureHeader);
    const timestamp = event.request.headers.get(this.timestampHeader);

    if (!signature || !timestamp) {
      return new Response(
        JSON.stringify({ message: 'Missing request signature' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check timestamp to prevent replay attacks
    const requestTime = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(requestTime) || Math.abs(now - requestTime) > this.tolerance) {
      return new Response(
        JSON.stringify({ message: 'Request signature expired' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Read body (clone request so downstream can still read it)
    const clone = event.request.clone();
    const body = await clone.text();

    // Compute expected signature: HMAC-SHA256(secret, timestamp.method.path.body)
    const { createHmac } = await import('node:crypto');
    const method = event.request.method.toUpperCase();
    const path = event.url.pathname + event.url.search;
    const payload = `${timestamp}.${method}.${path}.${body}`;
    const expected = createHmac('sha256', this.secret).update(payload).digest('hex');

    // Timing-safe comparison
    if (signature.length !== expected.length || !this.timingSafeCompare(signature, expected)) {
      return new Response(
        JSON.stringify({ message: 'Invalid request signature' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return next();
  }

  private timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const encoder = new TextEncoder();
    const bufA = encoder.encode(a);
    const bufB = encoder.encode(b);
    let result = 0;
    for (let i = 0; i < bufA.length; i++) {
      result |= bufA[i] ^ bufB[i];
    }
    return result === 0;
  }

  /**
   * Helper to generate a signature on the client side.
   * Can be used in Node.js clients or exported for documentation.
   */
  static sign(
    secret: string,
    method: string,
    path: string,
    body: string,
    timestamp?: number
  ): { signature: string; timestamp: number } {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const payload = `${ts}.${method.toUpperCase()}.${path}.${body}`;
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    return { signature, timestamp: ts };
  }
}

/**
 * Throttle Middleware — stricter per-route rate limiting
 *
 * Unlike the global RateLimitMiddleware, this is designed for specific
 * sensitive routes (login, register, password reset) with lower thresholds.
 */
export class ThrottleMiddleware extends Middleware {
  private attempts = new Map<string, { count: number; blockedUntil: number }>();
  private maxAttempts: number;
  private decayMinutes: number;

  constructor(
    options: {
      /** Max attempts before blocking (default: 5) */
      maxAttempts?: number;
      /** Decay period in minutes (default: 1) */
      decayMinutes?: number;
    } = {}
  ) {
    super();
    this.maxAttempts = options.maxAttempts ?? 5;
    this.decayMinutes = options.decayMinutes ?? 1;
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const ip =
      ctx.event.request.headers.get('x-forwarded-for') ??
      ctx.event.getClientAddress?.() ??
      'unknown';
    const key = `${ip}:${ctx.event.url.pathname}`;
    const now = Date.now();
    const entry = this.attempts.get(key);

    if (entry) {
      if (now < entry.blockedUntil) {
        const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
        return new Response(
          JSON.stringify({
            message: 'Too many attempts. Please try again later.',
            retry_after: retryAfter,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(retryAfter),
            },
          }
        );
      }

      if (entry.count >= this.maxAttempts) {
        entry.blockedUntil = now + this.decayMinutes * 60_000;
        entry.count = 0;
        const retryAfter = this.decayMinutes * 60;
        return new Response(
          JSON.stringify({
            message: 'Too many attempts. Please try again later.',
            retry_after: retryAfter,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(retryAfter),
            },
          }
        );
      }
    }

    const response = await next();

    // Only count failed attempts (4xx responses)
    if (response instanceof Response && response.status >= 400 && response.status < 500) {
      const current = this.attempts.get(key) ?? { count: 0, blockedUntil: 0 };
      current.count++;
      this.attempts.set(key, current);

      // Clean up old entries periodically
      if (this.attempts.size > 10000) {
        for (const [k, v] of this.attempts) {
          if (now > v.blockedUntil + this.decayMinutes * 60_000 * 2) {
            this.attempts.delete(k);
          }
        }
      }
    }

    return response;
  }
}
