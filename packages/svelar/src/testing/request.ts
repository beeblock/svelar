/**
 * createRequestEvent — Build a mock SvelteKit RequestEvent for testing.
 *
 * This allows testing server-side handlers (load functions, API endpoints,
 * controllers) without a running server.
 */

export interface RequestEventOptions {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, string>;
  locals?: Record<string, any>;
  cookies?: Record<string, string>;
}

/**
 * Create a mock SvelteKit RequestEvent suitable for passing to
 * server handlers, controllers, and middleware.
 */
export function createRequestEvent(options: RequestEventOptions = {}): any {
  const {
    method = 'GET',
    url = 'http://localhost:5173/',
    headers = {},
    body,
    params = {},
    locals = {},
    cookies = {},
  } = options;

  const parsedUrl = new URL(url, 'http://localhost:5173');

  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );

  // Build the Request object
  const requestInit: RequestInit = { method, headers: headers as any };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    requestInit.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!headerMap.has('content-type')) {
      headerMap.set('content-type', 'application/json');
    }
  }

  const request = new Request(parsedUrl.href, requestInit);

  // Cookie jar with get/set/delete/getAll/serialize
  const cookieJar = new Map<string, string>(Object.entries(cookies));

  const event: any = {
    request,
    url: parsedUrl,
    params,
    locals: { ...locals },
    route: { id: parsedUrl.pathname },
    isDataRequest: false,
    isSubRequest: false,
    platform: {},
    cookies: {
      get: (name: string) => cookieJar.get(name),
      getAll: () =>
        Array.from(cookieJar.entries()).map(([name, value]) => ({ name, value })),
      set: (name: string, value: string) => {
        cookieJar.set(name, value);
      },
      delete: (name: string) => {
        cookieJar.delete(name);
      },
      serialize: (name: string, value: string) => `${name}=${value}`,
    },
    fetch: globalThis.fetch,
    getClientAddress: () => '127.0.0.1',
    setHeaders: () => {},
  };

  return event;
}
