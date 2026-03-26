/**
 * Svelar Gates & Policies
 *
 * Laravel-inspired authorization system with gates (closures),
 * policies (class-based), and response objects.
 *
 * @example
 * ```ts
 * import { Gate } from 'svelar/auth';
 *
 * // Define gates
 * Gate.define('edit-post', (user, post) => {
 *   return user.id === post.user_id;
 * });
 *
 * Gate.define('admin-access', (user) => {
 *   return user.role === 'admin';
 * });
 *
 * // Check authorization
 * if (Gate.allows('edit-post', user, post)) { ... }
 * if (Gate.denies('admin-access', user)) { throw ... }
 *
 * // Use policies
 * class PostPolicy extends Policy {
 *   viewAny(user: any) { return true; }
 *   view(user: any, post: any) { return true; }
 *   create(user: any) { return !!user; }
 *   update(user: any, post: any) { return user.id === post.user_id; }
 *   delete(user: any, post: any) {
 *     return user.id === post.user_id || user.role === 'admin';
 *   }
 * }
 *
 * Gate.policy('Post', new PostPolicy());
 *
 * // Check via policy
 * Gate.forUser(user).allows('update', post);
 * Gate.forUser(user).authorize('delete', post); // throws if denied
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export type GateCallback = (user: any, ...args: any[]) => boolean | GateResponse | Promise<boolean | GateResponse>;

export type BeforeCallback = (user: any, ability: string) => boolean | null | undefined | Promise<boolean | null | undefined>;

export type AfterCallback = (user: any, ability: string, result: boolean, ...args: any[]) => boolean | void | Promise<boolean | void>;

// ── Gate Response ──────────────────────────────────────────

export class GateResponse {
  constructor(
    public readonly allowed: boolean,
    public readonly message?: string,
    public readonly code?: number,
  ) {}

  static allow(message?: string): GateResponse {
    return new GateResponse(true, message);
  }

  static deny(message: string = 'This action is unauthorized.', code: number = 403): GateResponse {
    return new GateResponse(false, message, code);
  }

  toResponse(): Response {
    if (this.allowed) {
      return new Response(null, { status: 200 });
    }
    return new Response(
      JSON.stringify({ message: this.message }),
      { status: this.code ?? 403, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ── Authorization Error ────────────────────────────────────

export class AuthorizationError extends Error {
  public readonly statusCode: number;

  constructor(message: string = 'This action is unauthorized.', code: number = 403) {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = code;
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({ message: this.message }),
      { status: this.statusCode, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ── Policy Base Class ──────────────────────────────────────

export abstract class Policy {
  /**
   * Perform pre-checks before any ability is checked.
   * Return true to allow all, false to deny all, null to continue.
   */
  before?(user: any, ability: string): boolean | null | undefined | Promise<boolean | null | undefined>;

  // Standard CRUD abilities (override in subclass):
  viewAny?(user: any): boolean | GateResponse | Promise<boolean | GateResponse>;
  view?(user: any, model: any): boolean | GateResponse | Promise<boolean | GateResponse>;
  create?(user: any): boolean | GateResponse | Promise<boolean | GateResponse>;
  update?(user: any, model: any): boolean | GateResponse | Promise<boolean | GateResponse>;
  delete?(user: any, model: any): boolean | GateResponse | Promise<boolean | GateResponse>;
  restore?(user: any, model: any): boolean | GateResponse | Promise<boolean | GateResponse>;
  forceDelete?(user: any, model: any): boolean | GateResponse | Promise<boolean | GateResponse>;
}

// ── Gate Manager ───────────────────────────────────────────

class GateManager {
  private gates = new Map<string, GateCallback>();
  private policies = new Map<string, Policy>();
  private policyModelMap = new Map<string, string>();
  private beforeCallbacks: BeforeCallback[] = [];
  private afterCallbacks: AfterCallback[] = [];
  private superUserCallback?: (user: any) => boolean;

  /**
   * Define a gate
   */
  define(ability: string, callback: GateCallback): this {
    this.gates.set(ability, callback);
    return this;
  }

  /**
   * Register a policy for a model
   */
  policy(modelName: string, policy: Policy): this {
    this.policies.set(modelName, policy);
    return this;
  }

  /**
   * Register a "before" callback that runs before all gates/policies
   */
  before(callback: BeforeCallback): this {
    this.beforeCallbacks.push(callback);
    return this;
  }

  /**
   * Register an "after" callback that runs after all gates/policies
   */
  after(callback: AfterCallback): this {
    this.afterCallbacks.push(callback);
    return this;
  }

  /**
   * Define a super-user check.
   * If this returns true, all gates and policies allow.
   */
  defineSuperUser(callback: (user: any) => boolean): this {
    this.superUserCallback = callback;
    return this;
  }

  /**
   * Check if a user is allowed to perform an ability
   */
  async allows(ability: string, user: any, ...args: any[]): Promise<boolean> {
    const result = await this.check(ability, user, ...args);
    return result;
  }

  /**
   * Check if a user is denied from performing an ability
   */
  async denies(ability: string, user: any, ...args: any[]): Promise<boolean> {
    return !(await this.allows(ability, user, ...args));
  }

  /**
   * Check authorization, throw if denied
   */
  async authorize(ability: string, user: any, ...args: any[]): Promise<void> {
    const result = await this.inspect(ability, user, ...args);
    if (!result.allowed) {
      throw new AuthorizationError(result.message, result.code);
    }
  }

  /**
   * Inspect an ability check, returning a GateResponse
   */
  async inspect(ability: string, user: any, ...args: any[]): Promise<GateResponse> {
    if (!user) {
      return GateResponse.deny('Unauthenticated.', 401);
    }

    // Super user check
    if (this.superUserCallback && this.superUserCallback(user)) {
      return GateResponse.allow();
    }

    // Before callbacks
    for (const before of this.beforeCallbacks) {
      const beforeResult = await before(user, ability);
      if (beforeResult === true) return GateResponse.allow();
      if (beforeResult === false) return GateResponse.deny();
    }

    // Try policy first
    const policyResult = await this.checkPolicy(ability, user, ...args);
    if (policyResult !== null) {
      return policyResult;
    }

    // Try gate
    const gate = this.gates.get(ability);
    if (gate) {
      const gateResult = await gate(user, ...args);
      if (gateResult instanceof GateResponse) return gateResult;
      return gateResult ? GateResponse.allow() : GateResponse.deny();
    }

    // No gate or policy found
    return GateResponse.deny(`No gate or policy defined for ability "${ability}".`);
  }

  /**
   * Create a scoped gate checker for a specific user
   */
  forUser(user: any): UserGate {
    return new UserGate(this, user);
  }

  /**
   * Check if a gate or policy is defined for an ability
   */
  has(ability: string): boolean {
    if (this.gates.has(ability)) return true;
    // Check if any policy has this method
    for (const policy of this.policies.values()) {
      if (typeof (policy as any)[ability] === 'function') return true;
    }
    return false;
  }

  /**
   * Get the policy for a model (by class name or instance)
   */
  getPolicyFor(model: any): Policy | undefined {
    const name = typeof model === 'string'
      ? model
      : model?.constructor?.name ?? String(model);
    return this.policies.get(name);
  }

  // ── Private ──

  private async check(ability: string, user: any, ...args: any[]): Promise<boolean> {
    const response = await this.inspect(ability, user, ...args);
    let result = response.allowed;

    // After callbacks
    for (const after of this.afterCallbacks) {
      const afterResult = await after(user, ability, result, ...args);
      if (typeof afterResult === 'boolean') {
        result = afterResult;
      }
    }

    return result;
  }

  private async checkPolicy(ability: string, user: any, ...args: any[]): Promise<GateResponse | null> {
    // Determine which policy to use based on the first argument's type
    let policy: Policy | undefined;

    if (args.length > 0 && args[0]) {
      const modelName = args[0]?.constructor?.name;
      if (modelName) {
        policy = this.policies.get(modelName);
      }
    }

    // If no policy found from model, check all policies for this method
    if (!policy) {
      for (const p of this.policies.values()) {
        if (typeof (p as any)[ability] === 'function') {
          policy = p;
          break;
        }
      }
    }

    if (!policy) return null;

    // Run policy's before hook
    if (policy.before) {
      const beforeResult = await policy.before(user, ability);
      if (beforeResult === true) return GateResponse.allow();
      if (beforeResult === false) return GateResponse.deny();
    }

    // Run the ability method
    const method = (policy as any)[ability];
    if (typeof method !== 'function') return null;

    const result = await method.call(policy, user, ...args);
    if (result instanceof GateResponse) return result;
    return result ? GateResponse.allow() : GateResponse.deny();
  }
}

// ── User-scoped Gate ───────────────────────────────────────

export class UserGate {
  constructor(
    private gate: GateManager,
    private user: any,
  ) {}

  async allows(ability: string, ...args: any[]): Promise<boolean> {
    return this.gate.allows(ability, this.user, ...args);
  }

  async denies(ability: string, ...args: any[]): Promise<boolean> {
    return this.gate.denies(ability, this.user, ...args);
  }

  async authorize(ability: string, ...args: any[]): Promise<void> {
    return this.gate.authorize(ability, this.user, ...args);
  }

  async inspect(ability: string, ...args: any[]): Promise<GateResponse> {
    return this.gate.inspect(ability, this.user, ...args);
  }

  /**
   * Check multiple abilities at once
   */
  async any(abilities: string[], ...args: any[]): Promise<boolean> {
    for (const ability of abilities) {
      if (await this.allows(ability, ...args)) return true;
    }
    return false;
  }

  /**
   * Check that ALL abilities are allowed
   */
  async all(abilities: string[], ...args: any[]): Promise<boolean> {
    for (const ability of abilities) {
      if (await this.denies(ability, ...args)) return false;
    }
    return true;
  }
}

// ── Gate Middleware ─────────────────────────────────────────

import { Middleware, type MiddlewareContext, type NextFunction } from '../middleware/Middleware.js';

/**
 * Middleware that checks gate authorization.
 *
 * @example
 * ```ts
 * // In a controller:
 * this.middleware(new GateMiddleware('edit-post'), { only: ['update', 'destroy'] });
 * ```
 */
export class GateMiddleware extends Middleware {
  constructor(
    private ability: string,
    private modelResolver?: (ctx: MiddlewareContext) => any,
  ) {
    super();
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const user = ctx.event.locals.user;
    if (!user) {
      return new Response(
        JSON.stringify({ message: 'Unauthenticated' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const model = this.modelResolver ? this.modelResolver(ctx) : undefined;
    const args = model ? [model] : [];

    try {
      await Gate.authorize(this.ability, user, ...args);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toResponse();
      }
      throw error;
    }

    return next();
  }
}

// ── Global Gate Singleton ──────────────────────────────────

import { singleton } from '../support/singleton.js';

export const Gate = singleton('svelar.gate', () => new GateManager());
