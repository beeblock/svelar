/**
 * Svelar HTTP Utilities
 *
 * Client-side: CSRF-aware fetch wrapper, automatic error toast handling.
 * Server-side: Fluent HTTP client for third-party API calls (Postmark, Stripe, etc.)
 *
 * @module @beeblock/svelar/http
 *
 * @example
 * ```ts
 * // Client-side (browser)
 * import { apiFetch } from '@beeblock/svelar/http';
 * const res = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({ title: 'Hello' }) });
 *
 * // Server-side (third-party APIs)
 * import { Http } from '@beeblock/svelar/http';
 * const response = await Http.withToken(POSTMARK_TOKEN)
 *   .baseUrl('https://api.postmarkapp.com')
 *   .post('/email', { From: 'hi@example.com', To: 'user@example.com', Subject: 'Hello' });
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface ApiFetchOptions extends RequestInit {
  /** Custom CSRF cookie name (default: 'XSRF-TOKEN') */
  csrfCookieName?: string;
  /** Custom CSRF header name (default: 'X-CSRF-Token') */
  csrfHeaderName?: string;
  /** Show toast on error responses (default: true) */
  showToast?: boolean;
  /** Custom error messages by status code */
  errorMessages?: Record<number, string>;
}

export interface ApiResponse<T = any> {
  data: T | null;
  error: ApiError | null;
  status: number;
  ok: boolean;
  response: Response;
}

export interface ApiError {
  message: string;
  status: number;
  errors?: Record<string, string[]>;
  details?: Record<string, any>;
}

// ── Default Messages ──────────────────────────────────────

const DEFAULT_ERROR_MESSAGES: Record<number, string> = {
  400: 'Invalid request. Please check your input.',
  401: 'Your session has expired. Please sign in again.',
  403: 'You don\'t have permission to do this.',
  404: 'The requested resource was not found.',
  405: 'This action is not allowed.',
  409: 'A conflict occurred. Please refresh and try again.',
  419: 'Page expired. Please refresh and try again.',
  422: 'The submitted data is invalid.',
  429: 'Too many requests. Please wait a moment.',
  500: 'Something went wrong on our end.',
  502: 'Service temporarily unavailable. Try again shortly.',
  503: 'Service is under maintenance. Try again shortly.',
  504: 'Request timed out. Please try again.',
};

// ── Toast Bridge ──────────────────────────────────────────
// Lazy import to avoid circular deps — toast is a UI module

let _toastFn: ((variant: string, title: string, opts?: any) => void) | null = null;

/**
 * Register the toast function from the UI layer.
 * Called automatically when <Toaster /> mounts.
 * Can also be called manually for custom toast implementations.
 */
export function registerToast(fn: (variant: string, title: string, opts?: any) => void) {
  _toastFn = fn;
}

function showToast(variant: 'success' | 'error' | 'warning' | 'info', title: string, description?: string) {
  if (_toastFn) {
    _toastFn(variant, title, { description });
  }
}

// ── CSRF-aware Fetch ──────────────────────────────────────

/**
 * CSRF-aware fetch wrapper with automatic error toast notifications.
 *
 * Features:
 * - Attaches CSRF token from cookies on mutation requests
 * - Shows toast notifications on error responses
 * - Handles network errors gracefully
 * - 401 responses can trigger redirect to login
 *
 * @example
 * ```ts
 * import { apiFetch } from '@beeblock/svelar/http';
 *
 * // POST with auto error toast
 * const res = await apiFetch('/api/posts', {
 *   method: 'POST',
 *   body: JSON.stringify({ title: 'Hello', body: 'World' }),
 * });
 *
 * // Disable toast for manual error handling
 * const res = await apiFetch('/api/users', { showToast: false });
 *
 * // Custom error message for specific status
 * const res = await apiFetch('/api/billing', {
 *   method: 'POST',
 *   errorMessages: { 402: 'Payment required. Please update your billing.' },
 * });
 * ```
 */
export async function apiFetch(url: string, options: ApiFetchOptions = {}): Promise<Response> {
  const {
    csrfCookieName = 'XSRF-TOKEN',
    csrfHeaderName = 'X-CSRF-Token',
    showToast: shouldToast = true,
    errorMessages = {},
    ...fetchOptions
  } = options;

  const method = (fetchOptions.method || 'GET').toUpperCase();
  const headers = new Headers(fetchOptions.headers);

  // Attach CSRF token for mutation requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = getCsrfToken(csrfCookieName);
    if (token) {
      headers.set(csrfHeaderName, token);
    }
  }

  // Default to JSON content type if body is a string
  if (fetchOptions.body && typeof fetchOptions.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Accept JSON
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  try {
    const response = await fetch(url, { ...fetchOptions, headers });

    // Show toast on error responses
    if (!response.ok && shouldToast) {
      await handleErrorResponse(response, { ...DEFAULT_ERROR_MESSAGES, ...errorMessages });
    }

    return response;
  } catch (err) {
    // Network error
    if (shouldToast) {
      showToast('error', 'Network Error', 'Unable to connect. Check your internet connection.');
    }
    throw err;
  }
}

/**
 * Typed JSON fetch — returns parsed data or error, never throws.
 *
 * @example
 * ```ts
 * import { apiFetchJson } from '@beeblock/svelar/http';
 *
 * const { data, error, ok } = await apiFetchJson<User[]>('/api/users');
 * if (ok) {
 *   console.log(data); // User[]
 * } else {
 *   console.log(error); // ApiError
 * }
 * ```
 */
export async function apiFetchJson<T = any>(url: string, options: ApiFetchOptions = {}): Promise<ApiResponse<T>> {
  try {
    const response = await apiFetch(url, options);

    let data: T | null = null;
    let error: ApiError | null = null;

    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const json = await response.json();

      if (response.ok) {
        data = json as T;
      } else {
        error = {
          message: json.message ?? DEFAULT_ERROR_MESSAGES[response.status] ?? 'An error occurred',
          status: response.status,
          errors: json.errors,
          details: json,
        };
      }
    } else if (response.ok) {
      // Non-JSON successful response
      data = (await response.text()) as any;
    } else {
      error = {
        message: DEFAULT_ERROR_MESSAGES[response.status] ?? `Error ${response.status}`,
        status: response.status,
      };
    }

    return { data, error, status: response.status, ok: response.ok, response };
  } catch (err: any) {
    return {
      data: null,
      error: { message: err.message ?? 'Network error', status: 0 },
      status: 0,
      ok: false,
      response: new Response(null, { status: 0 }),
    };
  }
}

// ── Error Response Handler ────────────────────────────────

async function handleErrorResponse(response: Response, messages: Record<number, string>) {
  let serverMessage = '';

  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = await response.clone().json();
      serverMessage = body.message ?? '';

      // Validation errors — show field-level details
      if (response.status === 422 && body.errors) {
        const fieldErrors = Object.entries(body.errors as Record<string, string[]>)
          .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`)
          .slice(0, 3)
          .join('\n');
        showToast('warning', messages[422] ?? 'Validation Error', fieldErrors);
        return;
      }
    }
  } catch {
    // Can't parse body — use default message
  }

  const title = serverMessage || messages[response.status] || `Error ${response.status}`;
  const variant = response.status >= 500 ? 'error' : response.status === 429 ? 'warning' : 'error';

  // 401 — special handling: suggest re-login
  if (response.status === 401) {
    showToast('warning', title, 'Please sign in to continue.');
    return;
  }

  showToast(variant, title);
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Extract a cookie value by name from document.cookie.
 */
export function getCsrfToken(cookieName = 'XSRF-TOKEN'): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Fetch wrapper that signs requests with HMAC-SHA256.
 * Use with SignatureMiddleware on the server.
 *
 * @example
 * ```ts
 * import { signedFetch } from '@beeblock/svelar/http';
 *
 * const res = await signedFetch('/api/webhooks', {
 *   method: 'POST',
 *   body: JSON.stringify({ event: 'order.created' }),
 *   signingSecret: 'your-shared-secret',
 * });
 * ```
 */
export async function signedFetch(
  url: string,
  options: ApiFetchOptions & {
    signingSecret: string;
    signatureHeader?: string;
    timestampHeader?: string;
  }
): Promise<Response> {
  const {
    signingSecret,
    signatureHeader = 'X-Signature',
    timestampHeader = 'X-Timestamp',
    ...fetchOptions
  } = options;

  const method = (fetchOptions.method || 'GET').toUpperCase();
  const body = typeof fetchOptions.body === 'string' ? fetchOptions.body : '';
  const timestamp = Math.floor(Date.now() / 1000);

  // Parse the path from the URL
  const parsed = new URL(url, 'http://localhost');
  const path = parsed.pathname + parsed.search;

  // Compute HMAC-SHA256 signature
  const payload = `${timestamp}.${method}.${path}.${body}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(signingSecret);
  const msgData = encoder.encode(payload);

  // Use Web Crypto API (works in browser and Node.js)
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const signature = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');

  const headers = new Headers(fetchOptions.headers);
  headers.set(signatureHeader, signature);
  headers.set(timestampHeader, String(timestamp));

  return apiFetch(url, { ...fetchOptions, headers, method });
}

/**
 * Build a URL with query parameters.
 *
 * @example
 * ```ts
 * buildUrl('/api/posts', { page: 1, per_page: 10 });
 * // => '/api/posts?page=1&per_page=10'
 * ```
 */
export function buildUrl(base: string, params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params) return base;
  const url = new URL(base, 'http://localhost');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.pathname + url.search;
}

// ── Server-Side HTTP Client ─────────────────────────────────

export interface HttpClientResponse<T = any> {
  data: T;
  status: number;
  headers: Headers;
  ok: boolean;
}

export interface HttpClientConfig {
  baseUrl?: string;
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export class HttpClient {
  private _baseUrl = '';
  private _headers: Record<string, string> = {};
  private _timeout = 30_000;
  private _retries = 0;
  private _retryDelay = 1000;
  private _query: Record<string, string> = {};

  constructor(config?: HttpClientConfig) {
    if (config?.baseUrl) this._baseUrl = config.baseUrl;
    if (config?.headers) this._headers = { ...config.headers };
    if (config?.timeout) this._timeout = config.timeout;
    if (config?.retries) this._retries = config.retries;
    if (config?.retryDelay) this._retryDelay = config.retryDelay;
  }

  private clone(): HttpClient {
    const c = new HttpClient();
    c._baseUrl = this._baseUrl;
    c._headers = { ...this._headers };
    c._timeout = this._timeout;
    c._retries = this._retries;
    c._retryDelay = this._retryDelay;
    c._query = { ...this._query };
    return c;
  }

  baseUrl(url: string): HttpClient {
    const c = this.clone();
    c._baseUrl = url;
    return c;
  }

  withHeaders(headers: Record<string, string>): HttpClient {
    const c = this.clone();
    c._headers = { ...c._headers, ...headers };
    return c;
  }

  withToken(token: string, type: 'Bearer' | string = 'Bearer'): HttpClient {
    return this.withHeaders({ Authorization: `${type} ${token}` });
  }

  withBasicAuth(username: string, password: string): HttpClient {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    return this.withHeaders({ Authorization: `Basic ${encoded}` });
  }

  accept(contentType: string): HttpClient {
    return this.withHeaders({ Accept: contentType });
  }

  contentType(type: string): HttpClient {
    return this.withHeaders({ 'Content-Type': type });
  }

  timeout(ms: number): HttpClient {
    const c = this.clone();
    c._timeout = ms;
    return c;
  }

  retry(times: number, delayMs = 1000): HttpClient {
    const c = this.clone();
    c._retries = times;
    c._retryDelay = delayMs;
    return c;
  }

  query(params: Record<string, string | number | boolean | undefined | null>): HttpClient {
    const c = this.clone();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        c._query[key] = String(value);
      }
    }
    return c;
  }

  async get<T = any>(path: string): Promise<HttpClientResponse<T>> {
    return this.request<T>('GET', path);
  }

  async post<T = any>(path: string, body?: unknown): Promise<HttpClientResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  async put<T = any>(path: string, body?: unknown): Promise<HttpClientResponse<T>> {
    return this.request<T>('PUT', path, body);
  }

  async patch<T = any>(path: string, body?: unknown): Promise<HttpClientResponse<T>> {
    return this.request<T>('PATCH', path, body);
  }

  async delete<T = any>(path: string, body?: unknown): Promise<HttpClientResponse<T>> {
    return this.request<T>('DELETE', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<HttpClientResponse<T>> {
    const url = this.buildFullUrl(path);
    const headers: Record<string, string> = { ...this._headers };

    let fetchBody: string | undefined;
    if (body !== undefined) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      fetchBody = typeof body === 'string' ? body : JSON.stringify(body);
    }

    if (!headers['Accept']) {
      headers['Accept'] = 'application/json';
    }

    let lastError: Error | null = null;
    const maxAttempts = 1 + this._retries;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, this._retryDelay * attempt));
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this._timeout);

        const response = await fetch(url, {
          method,
          headers,
          body: fetchBody,
          signal: controller.signal,
        });

        clearTimeout(timer);

        // Don't retry client errors (4xx)
        if (!response.ok && response.status < 500 && attempt < maxAttempts - 1) {
          // Still return — client errors aren't retryable
        }

        // Retry server errors (5xx)
        if (!response.ok && response.status >= 500 && attempt < maxAttempts - 1) {
          lastError = new HttpRequestError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            await response.text(),
          );
          continue;
        }

        const contentType = response.headers.get('content-type') ?? '';
        let data: T;

        if (contentType.includes('application/json')) {
          data = await response.json() as T;
        } else {
          data = await response.text() as T;
        }

        if (!response.ok) {
          throw new HttpRequestError(
            `HTTP ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
            response.status,
            data,
          );
        }

        return { data, status: response.status, headers: response.headers, ok: true };
      } catch (err: any) {
        if (err instanceof HttpRequestError) throw err;
        lastError = err;
        if (err.name === 'AbortError') {
          lastError = new HttpRequestError('Request timed out', 0, null);
        }
        if (attempt >= maxAttempts - 1) break;
      }
    }

    throw lastError ?? new Error('HTTP request failed');
  }

  private buildFullUrl(path: string): string {
    let url = this._baseUrl ? `${this._baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}` : path;
    const queryEntries = Object.entries(this._query);
    if (queryEntries.length > 0) {
      const parsed = new URL(url);
      for (const [k, v] of queryEntries) {
        parsed.searchParams.set(k, v);
      }
      url = parsed.toString();
    }
    return url;
  }
}

export class HttpRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: any,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

/**
 * Server-side HTTP client factory.
 * Returns a new HttpClient instance for making authenticated API calls to third-party services.
 *
 * @example
 * ```ts
 * import { Http } from '@beeblock/svelar/http';
 *
 * // Postmark
 * const res = await Http.withToken(POSTMARK_TOKEN, 'X-Postmark-Server-Token')
 *   .baseUrl('https://api.postmarkapp.com')
 *   .post('/email', { From: 'hi@example.com', To: 'user@example.com' });
 *
 * // Stripe
 * const res = await Http.withToken(STRIPE_SECRET)
 *   .baseUrl('https://api.stripe.com/v1')
 *   .contentType('application/x-www-form-urlencoded')
 *   .post('/customers', 'email=user@example.com');
 *
 * // Custom header auth
 * const res = await Http.withHeaders({ 'X-API-Key': API_KEY })
 *   .baseUrl('https://api.mailchimp.com/3.0')
 *   .retry(3)
 *   .get('/lists');
 * ```
 */
export const Http = new HttpClient();
