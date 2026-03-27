/**
 * Svelar HTTP Utilities
 *
 * CSRF-aware fetch wrapper, automatic error toast handling, and HTTP helpers.
 *
 * @module svelar/http
 *
 * @example
 * ```ts
 * import { apiFetch } from 'svelar/http';
 *
 * // Basic usage — errors auto-show as toasts
 * const res = await apiFetch('/api/posts', {
 *   method: 'POST',
 *   body: JSON.stringify({ title: 'Hello' }),
 * });
 *
 * // Disable auto-toast for manual handling
 * const res = await apiFetch('/api/posts', { showToast: false });
 *
 * // Typed JSON response
 * const { data, error } = await apiFetchJson<Post[]>('/api/posts');
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
 * import { apiFetch } from 'svelar/http';
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
 * import { apiFetchJson } from 'svelar/http';
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
