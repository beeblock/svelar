/**
 * CSRF-aware fetch wrapper.
 * Reads the XSRF-TOKEN cookie and attaches it as X-CSRF-Token header
 * on every mutation request (POST, PUT, PATCH, DELETE).
 */
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  // Attach CSRF token for mutation requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = getCsrfToken();
    if (token) {
      headers.set('X-CSRF-Token', token);
    }
  }

  // Default to JSON content type if body is a string
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, { ...options, headers });
}

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}
