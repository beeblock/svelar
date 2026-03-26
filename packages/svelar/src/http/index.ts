/**
 * Svelar HTTP Utilities
 *
 * CSRF-aware fetch wrapper and HTTP helpers for client-side API calls.
 *
 * @module svelar/http
 */

// ── Types ──────────────────────────────────────────────────

export interface ApiFetchOptions extends RequestInit {
  /** Custom CSRF cookie name (default: 'XSRF-TOKEN') */
  csrfCookieName?: string;
  /** Custom CSRF header name (default: 'X-CSRF-Token') */
  csrfHeaderName?: string;
}

// ── CSRF-aware Fetch ──────────────────────────────────────

/**
 * CSRF-aware fetch wrapper.
 * Reads the XSRF-TOKEN cookie and attaches it as X-CSRF-Token header
 * on every mutation request (POST, PUT, PATCH, DELETE).
 *
 * @example
 * ```ts
 * import { apiFetch } from 'svelar/http';
 *
 * const res = await apiFetch('/api/posts', {
 *   method: 'POST',
 *   body: JSON.stringify({ title: 'Hello', body: 'World' }),
 * });
 * ```
 */
export async function apiFetch(url: string, options: ApiFetchOptions = {}): Promise<Response> {
  const {
    csrfCookieName = 'XSRF-TOKEN',
    csrfHeaderName = 'X-CSRF-Token',
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

  return fetch(url, { ...fetchOptions, headers });
}

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
