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
import { Cache } from '../cache/index.js';

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
export interface CorsOptions {
  origin?: string | string[];
  methods?: string[];
  headers?: string[];
  /** Alias for methods, matching the public docs. */
  allowMethods?: string[];
  /** Alias for headers, matching the public docs. */
  allowHeaders?: string[];
  exposeHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export class CorsMiddleware extends Middleware {
  constructor(private options: CorsOptions = {}) {
    super();
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    if (ctx.event.request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: this.buildHeaders(ctx),
      });
    }

    const response = await next();

    // If there's no response to modify, bail
    if (!response) return;

    const headers = this.buildHeaders(ctx);
    headers.forEach((value, key) => {
      response.headers.set(key, value);
    });

    return response;
  }

  private buildHeaders(ctx: MiddlewareContext): Headers {
    const headers = new Headers();
    const origin = this.resolveOrigin(ctx);

    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      if (origin !== '*') {
        headers.set('Vary', 'Origin');
      }
    }

    headers.set(
      'Access-Control-Allow-Methods',
      (this.options.methods ?? this.options.allowMethods ?? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']).join(', ')
    );
    headers.set(
      'Access-Control-Allow-Headers',
      (this.options.headers ?? this.options.allowHeaders ?? ['Content-Type', 'Authorization']).join(', ')
    );

    if (this.options.exposeHeaders?.length) {
      headers.set('Access-Control-Expose-Headers', this.options.exposeHeaders.join(', '));
    }

    if (this.options.credentials) {
      headers.set('Access-Control-Allow-Credentials', 'true');
    }

    if (this.options.maxAge) {
      headers.set('Access-Control-Max-Age', String(this.options.maxAge));
    }

    return headers;
  }

  private resolveOrigin(ctx: MiddlewareContext): string | null {
    const requestOrigin = ctx.event.request.headers.get('origin');
    const configured = this.options.origin;

    if (configured === undefined || configured === '*') {
      return this.options.credentials && requestOrigin ? requestOrigin : '*';
    }

    if (Array.isArray(configured)) {
      if (configured.includes('*')) {
        return this.options.credentials && requestOrigin ? requestOrigin : '*';
      }
      if (requestOrigin && configured.includes(requestOrigin)) {
        return requestOrigin;
      }
      return null;
    }

    return configured;
  }
}

/** Rate Limiting Middleware */
export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
  /** Override the identity used for limiting. Defaults to client IP. */
  keyGenerator?: (ctx: MiddlewareContext) => string | Promise<string>;
  /** Override the 429 response. */
  handler?: (ctx: MiddlewareContext, retryAfter: number) => Response | Promise<Response>;
  /** Use Svelar cache for shared limits across app instances. Defaults to in-memory. */
  store?: 'memory' | 'cache';
  /** Cache store name when store is "cache". Defaults to the configured default cache store. */
  cacheStore?: string;
  /** Prefix for rate-limit keys. */
  prefix?: string;
}

export class RateLimitMiddleware extends Middleware {
  private requests = new Map<string, { count: number; resetAt: number }>();
  private maxRequests: number;
  private windowMs: number;
  private keyGenerator: (ctx: MiddlewareContext) => string | Promise<string>;
  private handler?: (ctx: MiddlewareContext, retryAfter: number) => Response | Promise<Response>;
  private store: 'memory' | 'cache';
  private cacheStore?: string;
  private prefix: string;

  constructor(options: RateLimitOptions = {}) {
    super();
    this.maxRequests = options.maxRequests ?? 60;
    this.windowMs = options.windowMs ?? 60_000;
    this.keyGenerator = options.keyGenerator ?? ((ctx) => this.defaultKey(ctx));
    this.handler = options.handler;
    this.store = options.store ?? 'memory';
    this.cacheStore = options.cacheStore;
    this.prefix = options.prefix ?? 'rate-limit';
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const key = await this.keyGenerator(ctx);
    const { count, resetAt } = this.store === 'cache'
      ? await this.hitCacheStore(key)
      : this.hitMemoryStore(key);

    if (count > this.maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      if (this.handler) {
        return this.handler(ctx, retryAfter);
      }

      return new Response(
        JSON.stringify({ error: 'Too many requests' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          },
        }
      );
    }

    return next();
  }

  private defaultKey(ctx: MiddlewareContext): string {
    return (
      ctx.event.request.headers.get('x-forwarded-for') ??
      ctx.event.getClientAddress?.() ??
      'unknown'
    );
  }

  private hitMemoryStore(key: string): { count: number; resetAt: number } {
    const now = Date.now();
    const entry = this.requests.get(key);

    if (entry && now < entry.resetAt) {
      entry.count++;
      return entry;
    }

    const fresh = { count: 1, resetAt: now + this.windowMs };
    this.requests.set(key, fresh);
    return fresh;
  }

  private async hitCacheStore(key: string): Promise<{ count: number; resetAt: number }> {
    const store = Cache.store(this.cacheStore);
    const cacheKey = `${this.prefix}:${key}`;
    const now = Date.now();
    let entry = await store.get<{ count: number; resetAt: number }>(cacheKey);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 1, resetAt: now + this.windowMs };
    } else {
      entry = { count: entry.count + 1, resetAt: entry.resetAt };
    }

    const ttl = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    await store.put(cacheKey, entry, ttl);
    return entry;
  }
}

/** Logging Middleware */
export interface LoggingOptions {
  level?: 'debug' | 'info' | 'warn' | 'error';
  format?: string;
}

export class LoggingMiddleware extends Middleware {
  private level: 'debug' | 'info' | 'warn' | 'error';
  private format: string;

  constructor(options: LoggingOptions = {}) {
    super();
    this.level = options.level ?? 'info';
    this.format = options.format ?? '[{timestamp}] {method} {path} → {status} ({duration}ms)';
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const start = Date.now();
    const method = ctx.event.request.method;
    const path = ctx.event.url.pathname;

    const response = await next();

    const duration = Date.now() - start;
    const status = response instanceof Response ? response.status : 200;
    const message = this.format
      .replaceAll('{timestamp}', new Date().toISOString())
      .replaceAll('{method}', method)
      .replaceAll('{path}', path)
      .replaceAll('{status}', String(status))
      .replaceAll('{duration}', String(duration));

    console[this.level](message);

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
export interface CsrfOptions {
  cookieName?: string;
  headerName?: string;
  fieldName?: string;
  /** Random token byte length before hex encoding (default: 32 bytes = 64 hex chars). */
  tokenLength?: number;
  excludePaths?: string[];
  /** If set, CSRF validation only applies to requests matching these path prefixes */
  onlyPaths?: string[];
}

export class CsrfMiddleware extends Middleware {
  private cookieName: string;
  private headerName: string;
  private fieldName: string;
  private tokenLength: number;
  private excludePaths: string[];
  private onlyPaths: string[] | null;

  constructor(options: CsrfOptions = {}) {
    super();
    this.cookieName = options.cookieName ?? 'XSRF-TOKEN';
    this.headerName = options.headerName ?? 'X-CSRF-Token';
    this.fieldName = options.fieldName ?? '_csrf';
    this.tokenLength = options.tokenLength ?? 32;
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
    const escaped = this.cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = cookies.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
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
    const bytes = new Uint8Array(this.tokenLength);
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
export interface ThrottleOptions {
  /** Max attempts before blocking (default: 5) */
  maxAttempts?: number;
  /** Decay period in minutes (default: 1) */
  decayMinutes?: number;
  /** Override the identity used for throttling. Defaults to client IP + path. */
  keyGenerator?: (ctx: MiddlewareContext) => string | Promise<string>;
  /** Use Svelar cache for shared throttles across app instances. Defaults to in-memory. */
  store?: 'memory' | 'cache';
  /** Cache store name when store is "cache". Defaults to the configured default cache store. */
  cacheStore?: string;
  /** Prefix for throttle keys. */
  prefix?: string;
}

export class ThrottleMiddleware extends Middleware {
  private attempts = new Map<string, { count: number; blockedUntil: number; resetAt: number }>();
  private maxAttempts: number;
  private decayMinutes: number;
  private keyGenerator: (ctx: MiddlewareContext) => string | Promise<string>;
  private store: 'memory' | 'cache';
  private cacheStore?: string;
  private prefix: string;

  constructor(options: ThrottleOptions = {}) {
    super();
    this.maxAttempts = options.maxAttempts ?? 5;
    this.decayMinutes = options.decayMinutes ?? 1;
    this.keyGenerator = options.keyGenerator ?? ((ctx) => this.defaultKey(ctx));
    this.store = options.store ?? 'memory';
    this.cacheStore = options.cacheStore;
    this.prefix = options.prefix ?? 'throttle';
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const block = await this.check(ctx);
    if (block.blocked) {
      return this.blockedResponse(block.retryAfter);
    }

    const response = await next();

    if (this.isFailure(response)) {
      await this.hit(ctx);
    }

    return response;
  }

  async check(ctx: MiddlewareContext): Promise<{ blocked: boolean; retryAfter: number }> {
    const now = Date.now();
    const key = await this.keyGenerator(ctx);
    const entry = await this.getEntry(key);

    if (entry) {
      if (now < entry.blockedUntil) {
        return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
      }

      if (entry.count >= this.maxAttempts) {
        entry.blockedUntil = now + this.decayMinutes * 60_000;
        entry.count = 0;
        await this.putEntry(key, entry);
        return { blocked: true, retryAfter: this.decayMinutes * 60 };
      }
    }

    return { blocked: false, retryAfter: 0 };
  }

  async hit(ctx: MiddlewareContext): Promise<void> {
    const now = Date.now();
    const key = await this.keyGenerator(ctx);
    const current = (await this.getEntry(key)) ?? { count: 0, blockedUntil: 0, resetAt: now + this.decayMinutes * 60_000 };
    current.count++;
    current.resetAt = current.resetAt || now + this.decayMinutes * 60_000;
    await this.putEntry(key, current);

    // Clean up old entries periodically
    if (this.store === 'memory' && this.attempts.size > 10000) {
      for (const [k, v] of this.attempts) {
        if (now > v.blockedUntil + this.decayMinutes * 60_000 * 2) {
          this.attempts.delete(k);
        }
      }
    }
  }

  async clear(ctx: MiddlewareContext): Promise<void> {
    const key = await this.keyGenerator(ctx);
    await this.forgetEntry(key);
  }

  private blockedResponse(retryAfter: number): Response {
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

  private isFailure(response: any): boolean {
    const status = response instanceof Response ? response.status : response?.status;
    return typeof status === 'number' && status >= 400 && status < 500;
  }

  private defaultKey(ctx: MiddlewareContext): string {
    const ip =
      ctx.event.request.headers.get('x-forwarded-for') ??
      ctx.event.getClientAddress?.() ??
      'unknown';
    return `${ip}:${ctx.event.url.pathname}`;
  }

  private cacheKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private async getEntry(key: string): Promise<{ count: number; blockedUntil: number; resetAt: number } | undefined> {
    const now = Date.now();
    let entry: { count: number; blockedUntil: number; resetAt: number } | undefined;

    if (this.store === 'cache') {
      entry = (await Cache.store(this.cacheStore).get<{ count: number; blockedUntil: number; resetAt: number }>(this.cacheKey(key))) ?? undefined;
    } else {
      entry = this.attempts.get(key);
    }

    if (entry && now >= entry.resetAt && now >= entry.blockedUntil) {
      await this.forgetEntry(key);
      return undefined;
    }

    return entry;
  }

  private async putEntry(key: string, entry: { count: number; blockedUntil: number; resetAt: number }): Promise<void> {
    if (this.store === 'cache') {
      const ttl = Math.max(
        1,
        Math.ceil((Math.max(entry.blockedUntil, entry.resetAt) - Date.now()) / 1000),
      );
      await Cache.store(this.cacheStore).put(this.cacheKey(key), entry, ttl);
      return;
    }

    this.attempts.set(key, entry);
  }

  private async forgetEntry(key: string): Promise<void> {
    if (this.store === 'cache') {
      await Cache.store(this.cacheStore).forget(this.cacheKey(key));
      return;
    }

    this.attempts.delete(key);
  }
}
