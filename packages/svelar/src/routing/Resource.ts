/**
 * Svelar Resource (API Response Transformer)
 *
 * Laravel-inspired JsonResource for shaping API responses.
 * Controls exactly what data is exposed and how it's structured.
 *
 * @example
 * ```ts
 * class UserResource extends Resource<User> {
 *   toJSON() {
 *     return {
 *       id: this.data.id,
 *       name: this.data.name,
 *       email: this.data.email,
 *       created_at: this.data.created_at,
 *     };
 *   }
 * }
 *
 * // Single resource
 * return UserResource.make(user);
 * // { data: { id: 1, name: "John", ... } }
 *
 * // Collection
 * return UserResource.collection(users);
 * // { data: [{ id: 1, ... }, { id: 2, ... }] }
 *
 * // With metadata
 * return UserResource.collection(users).additional({ total: 100, page: 1 });
 * // { data: [...], meta: { total: 100, page: 1 } }
 * ```
 */

// ── Resource Base Class ─────────────────────────────────────

export abstract class Resource<T = any> {
  constructor(protected data: T) {}

  /**
   * Define the response shape. Override this in your resource class.
   */
  abstract toJSON(): Record<string, any>;

  /**
   * Wrap a single item in a resource.
   */
  static make<T, R extends Resource<T>>(
    this: new (data: T) => R,
    data: T
  ): ResourceResponse {
    const instance = new this(data);
    return new ResourceResponse(instance.toJSON());
  }

  /**
   * Wrap an array of items in resources.
   */
  static collection<T, R extends Resource<T>>(
    this: new (data: T) => R,
    items: T[]
  ): ResourceCollectionResponse {
    const data = items.map((item) => new this(item).toJSON());
    return new ResourceCollectionResponse(data);
  }
}

// ── Response Wrappers ───────────────────────────────────────

export class ResourceResponse {
  private meta: Record<string, any> = {};
  private wrap = 'data';
  private statusCode = 200;
  private extraHeaders: Record<string, string> = {};

  constructor(private data: Record<string, any>) {}

  /**
   * Add metadata to the response.
   */
  additional(meta: Record<string, any>): this {
    this.meta = { ...this.meta, ...meta };
    return this;
  }

  /**
   * Change the wrapping key (default: "data"). Use null to unwrap.
   */
  wrapper(key: string | null): this {
    this.wrap = key ?? '';
    return this;
  }

  /**
   * Set the HTTP status code.
   */
  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  /**
   * Add response headers.
   */
  headers(headers: Record<string, string>): this {
    this.extraHeaders = { ...this.extraHeaders, ...headers };
    return this;
  }

  /**
   * Build the plain object (for serialization or testing).
   */
  toObject(): Record<string, any> {
    const body: Record<string, any> = {};

    if (this.wrap) {
      body[this.wrap] = this.data;
    } else {
      Object.assign(body, this.data);
    }

    if (Object.keys(this.meta).length > 0) {
      body.meta = this.meta;
    }

    return body;
  }

  /**
   * Convert to a Response object for SvelteKit handlers.
   */
  toResponse(): Response {
    return new Response(JSON.stringify(this.toObject(), null, 2), {
      status: this.statusCode,
      headers: {
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
    });
  }
}

export class ResourceCollectionResponse {
  private meta: Record<string, any> = {};
  private wrap = 'data';
  private statusCode = 200;
  private extraHeaders: Record<string, string> = {};

  constructor(private items: Record<string, any>[]) {}

  /**
   * Add metadata (pagination, totals, etc.)
   */
  additional(meta: Record<string, any>): this {
    this.meta = { ...this.meta, ...meta };
    return this;
  }

  /**
   * Change the wrapping key.
   */
  wrapper(key: string | null): this {
    this.wrap = key ?? '';
    return this;
  }

  /**
   * Set HTTP status code.
   */
  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  /**
   * Add response headers.
   */
  headers(headers: Record<string, string>): this {
    this.extraHeaders = { ...this.extraHeaders, ...headers };
    return this;
  }

  /**
   * Build the plain object.
   */
  toObject(): Record<string, any> {
    const body: Record<string, any> = {};

    if (this.wrap) {
      body[this.wrap] = this.items;
    } else {
      return { items: this.items, ...this.meta };
    }

    if (Object.keys(this.meta).length > 0) {
      body.meta = this.meta;
    }

    return body;
  }

  /**
   * Convert to a Response object.
   */
  toResponse(): Response {
    return new Response(JSON.stringify(this.toObject(), null, 2), {
      status: this.statusCode,
      headers: {
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
    });
  }
}
