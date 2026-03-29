/**
 * Svelar Resource (API Response Transformer)
 *
 * Laravel-inspired JsonResource for shaping API responses.
 * Controls exactly what data is exposed and how it's structured.
 *
 * The second generic `TShape` defines the API contract — the shape returned
 * by `toJSON()`. Export this type from your resource file and import it on
 * the frontend. Define once, use everywhere.
 *
 * @example
 * ```ts
 * // Define the contract once
 * export interface UserData {
 *   id: number;
 *   name: string;
 *   email: string;
 * }
 *
 * export class UserResource extends Resource<User, UserData> {
 *   toJSON(): UserData {
 *     return {
 *       id: this.data.id,
 *       name: this.data.name,
 *       email: this.data.email,
 *     };
 *   }
 * }
 *
 * // Frontend — import the same type
 * import type { UserData } from '$lib/modules/auth/UserResource';
 * const { data } = await apiFetchJson<{ data: UserData }>('/api/users/1');
 * ```
 */

// ── Utility Types ─────────────────────────────────────────

/**
 * Extract the output shape from a Resource class.
 *
 * @example
 * ```ts
 * type User = InferResource<UserResource>;
 * // { id: number; name: string; email: string; }
 * ```
 */
export type InferResource<R> = R extends Resource<any, infer TShape> ? TShape : never;

/**
 * Wrapped single resource response shape.
 *
 * @example
 * ```ts
 * type UserResponse = ResourceData<UserResource>;
 * // { data: { id: number; name: string; email: string; } }
 * ```
 */
export type ResourceData<R> = R extends Resource<any, infer TShape>
  ? { data: TShape; [key: string]: any }
  : never;

/**
 * Wrapped collection response shape with pagination metadata.
 *
 * @example
 * ```ts
 * type UsersResponse = ResourceCollection<UserResource>;
 * // { data: UserData[]; meta?: { total: number; page: number; ... } }
 * ```
 */
export type ResourceCollection<R> = R extends Resource<any, infer TShape>
  ? { data: TShape[]; meta?: Record<string, any>; [key: string]: any }
  : never;

// ── Resource Base Class ─────────────────────────────────────

export abstract class Resource<TModel = any, TShape extends Record<string, any> = Record<string, any>> {
  constructor(protected data: TModel) {}

  /**
   * Define the response shape. Override this in your resource class.
   * The return type should match TShape for full type safety.
   */
  abstract toJSON(): TShape;

  /**
   * Define top-level data included alongside the resource.
   * Override this to add roles, permissions, related context, etc.
   * Called automatically by make(), collection(), and paginate().
   *
   * Can be sync or async.
   */
  toWith(): Record<string, any> | Promise<Record<string, any>> {
    return {};
  }

  /**
   * Define metadata included under the "meta" key.
   * Override this to add counts, flags, or computed summaries.
   * Called automatically by make(), collection(), and paginate().
   *
   * Can be sync or async.
   */
  toAdditional(): Record<string, any> | Promise<Record<string, any>> {
    return {};
  }

  /**
   * Wrap a single item in a resource.
   */
  static make<TModel, TShape extends Record<string, any>, R extends Resource<TModel, TShape>>(
    this: new (data: TModel) => R,
    data: TModel
  ): ResourceResponse {
    const instance = new this(data);
    const response = new ResourceResponse(instance.toJSON());

    // Attach resource-level with/additional as deferred promises
    response._deferWith(instance.toWith());
    response._deferAdditional(instance.toAdditional());

    return response;
  }

  /**
   * Wrap an array of items in resources.
   */
  static collection<TModel, TShape extends Record<string, any>, R extends Resource<TModel, TShape>>(
    this: new (data: TModel) => R,
    items: TModel[]
  ): ResourceCollectionResponse {
    const ResourceClass = this;
    const instances = items.map((item) => new ResourceClass(item));
    const data = instances.map((inst) => inst.toJSON());
    const response = new ResourceCollectionResponse(data);

    if (instances.length > 0) {
      response._deferCollectionExtras(instances);
    }

    return response;
  }

  /**
   * Wrap a PaginationResult — transforms items and auto-includes pagination metadata.
   *
   * Accepts the result of `Model.query().paginate()` or `Repository.paginate()`.
   *
   * @example
   * ```ts
   * const result = await User.query().paginate(page, 20);
   * return UserResource.paginate(result).toResponse();
   * // { data: [...], meta: { total, page, per_page, last_page, has_more } }
   * ```
   */
  static paginate<TModel, TShape extends Record<string, any>, R extends Resource<TModel, TShape>>(
    this: new (data: TModel) => R,
    result: { data: TModel[]; total: number; page: number; perPage: number; lastPage: number; hasMore: boolean }
  ): ResourceCollectionResponse {
    const ResourceClass = this;
    const instances = result.data.map((item) => new ResourceClass(item));
    const data = instances.map((inst) => inst.toJSON());
    const response = new ResourceCollectionResponse(data).additional({
      total: result.total,
      page: result.page,
      per_page: result.perPage,
      last_page: result.lastPage,
      has_more: result.hasMore,
    });

    if (instances.length > 0) {
      response._deferCollectionExtras(instances);
    }

    return response;
  }
}

// ── Response Wrappers ───────────────────────────────────────

export class ResourceResponse {
  private meta: Record<string, any> = {};
  private extra: Record<string, any> = {};
  private wrap = 'data';
  private statusCode = 200;
  private extraHeaders: Record<string, string> = {};
  private deferredWith: Promise<Record<string, any>> | Record<string, any> | null = null;
  private deferredAdditional: Promise<Record<string, any>> | Record<string, any> | null = null;

  constructor(private data: Record<string, any>) {}

  /** @internal — used by Resource.make() to attach toWith() */
  _deferWith(result: Record<string, any> | Promise<Record<string, any>>): void {
    this.deferredWith = result;
  }

  /** @internal — used by Resource.make() to attach toAdditional() */
  _deferAdditional(result: Record<string, any> | Promise<Record<string, any>>): void {
    this.deferredAdditional = result;
  }

  /**
   * Add metadata to the response (nested under "meta").
   */
  additional(meta: Record<string, any>): this {
    this.meta = { ...this.meta, ...meta };
    return this;
  }

  /**
   * Add top-level data alongside the resource.
   *
   * For data that should always be included, override `toWith()` in
   * the Resource class instead — then controllers don't need to repeat it.
   */
  with(data: Record<string, any>): this {
    this.extra = { ...this.extra, ...data };
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
  async toObject(): Promise<Record<string, any>> {
    // Resolve deferred resource-level extras
    if (this.deferredWith) {
      const resolved = await this.deferredWith;
      if (resolved && Object.keys(resolved).length > 0) {
        this.extra = { ...resolved, ...this.extra };
      }
    }
    if (this.deferredAdditional) {
      const resolved = await this.deferredAdditional;
      if (resolved && Object.keys(resolved).length > 0) {
        this.meta = { ...resolved, ...this.meta };
      }
    }

    const body: Record<string, any> = {};

    if (this.wrap) {
      body[this.wrap] = this.data;
    } else {
      Object.assign(body, this.data);
    }

    if (Object.keys(this.meta).length > 0) {
      body.meta = this.meta;
    }

    // Top-level extra data (roles, permissions, etc.)
    Object.assign(body, this.extra);

    return body;
  }

  /**
   * Convert to a Response object for SvelteKit handlers.
   */
  async toResponse(): Promise<Response> {
    const obj = await this.toObject();
    return new Response(JSON.stringify(obj, null, 2), {
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
  private extra: Record<string, any> = {};
  private wrap = 'data';
  private statusCode = 200;
  private extraHeaders: Record<string, string> = {};
  private deferredInstances: Resource[] | null = null;

  constructor(private items: Record<string, any>[]) {}

  /** @internal — used by Resource.collection()/paginate() */
  _deferCollectionExtras(instances: Resource[]): void {
    this.deferredInstances = instances;
  }

  /**
   * Add metadata (pagination, totals, etc.) — nested under "meta".
   */
  additional(meta: Record<string, any>): this {
    this.meta = { ...this.meta, ...meta };
    return this;
  }

  /**
   * Add top-level data alongside the collection.
   *
   * For data that should always be included, override `toWith()` in
   * the Resource class instead.
   */
  with(data: Record<string, any>): this {
    this.extra = { ...this.extra, ...data };
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
  async toObject(): Promise<Record<string, any>> {
    // Resolve resource-level toWith/toAdditional from the first instance
    // (collection-level extras are the same for all items — use the first)
    if (this.deferredInstances && this.deferredInstances.length > 0) {
      const first = this.deferredInstances[0];
      const withData = await first.toWith();
      if (withData && Object.keys(withData).length > 0) {
        this.extra = { ...withData, ...this.extra };
      }
      const additionalData = await first.toAdditional();
      if (additionalData && Object.keys(additionalData).length > 0) {
        this.meta = { ...additionalData, ...this.meta };
      }
    }

    const body: Record<string, any> = {};

    if (this.wrap) {
      body[this.wrap] = this.items;
    } else {
      return { items: this.items, ...this.meta, ...this.extra };
    }

    if (Object.keys(this.meta).length > 0) {
      body.meta = this.meta;
    }

    // Top-level extra data
    Object.assign(body, this.extra);

    return body;
  }

  /**
   * Convert to a Response object.
   */
  async toResponse(): Promise<Response> {
    const obj = await this.toObject();
    return new Response(JSON.stringify(obj, null, 2), {
      status: this.statusCode,
      headers: {
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
    });
  }
}
