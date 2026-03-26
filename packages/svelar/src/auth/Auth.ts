/**
 * Svelar Auth
 *
 * Authentication system with guards, JWT support, and session-based auth.
 *
 * @example
 * ```ts
 * // Session-based auth
 * const auth = new AuthManager({ guard: 'session', model: User });
 * const user = await auth.attempt({ email: 'john@example.com', password: 'secret' });
 *
 * // JWT auth
 * const auth = new AuthManager({ guard: 'jwt', model: User, jwt: { secret: '...' } });
 * const { user, token } = await auth.attemptJwt({ email: '...', password: '...' });
 * ```
 */

import { createHmac, randomBytes } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────

export type GuardType = 'session' | 'jwt' | 'token';

export interface AuthConfig {
  guard: GuardType;
  /** The Model class to query users from */
  model: any;
  /** Column used for login identifier (default: 'email') */
  identifierColumn?: string;
  /** Column storing the hashed password (default: 'password') */
  passwordColumn?: string;
  /** JWT configuration */
  jwt?: JwtConfig;
  /** API token configuration */
  token?: TokenConfig;
}

export interface JwtConfig {
  secret: string;
  expiresIn?: number; // seconds, default 3600
  algorithm?: 'HS256' | 'HS384' | 'HS512';
  issuer?: string;
}

export interface TokenConfig {
  /** Table storing API tokens */
  table?: string;
  /** Header name for token (default: 'Authorization') */
  header?: string;
}

export interface AuthUser {
  getAttribute(key: string): any;
  [key: string]: any;
}

export interface JwtPayload {
  sub: string | number;
  iat: number;
  exp: number;
  iss?: string;
  [key: string]: any;
}

// ── JWT Helpers (zero-dependency) ──────────────────────────

function base64urlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

function createJwtSignature(header: string, payload: string, secret: string, algo: string): string {
  const hmacAlgo = algo === 'HS384' ? 'sha384' : algo === 'HS512' ? 'sha512' : 'sha256';
  return createHmac(hmacAlgo, secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
}

export function signJwt(payload: JwtPayload, secret: string, algorithm: string = 'HS256'): string {
  const header = base64urlEncode(JSON.stringify({ alg: algorithm, typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(payload));
  const signature = createJwtSignature(header, body, secret, algorithm);
  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  // Decode header to get algorithm
  let headerObj: { alg: string };
  try {
    headerObj = JSON.parse(base64urlDecode(header));
  } catch {
    return null;
  }

  // Verify signature
  const expected = createJwtSignature(header, payload, secret, headerObj.alg);
  if (signature !== expected) return null;

  // Decode and validate payload
  try {
    const data = JSON.parse(base64urlDecode(payload)) as JwtPayload;

    // Check expiration
    if (data.exp && Date.now() / 1000 > data.exp) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

// ── Auth Manager ───────────────────────────────────────────

export class AuthManager {
  private config: Required<Pick<AuthConfig, 'guard' | 'model' | 'identifierColumn' | 'passwordColumn'>> & AuthConfig;
  private currentUser: AuthUser | null = null;

  constructor(userConfig: AuthConfig) {
    this.config = {
      identifierColumn: 'email',
      passwordColumn: 'password',
      ...userConfig,
    };
  }

  /**
   * Attempt session-based login.
   * Returns the user on success, null on failure.
   */
  async attempt(
    credentials: Record<string, any>,
    session?: any
  ): Promise<AuthUser | null> {
    const { Hash } = await import('../hashing/Hash.js');

    const identifier = credentials[this.config.identifierColumn];
    const password = credentials[this.config.passwordColumn];

    if (!identifier || !password) return null;

    // Find user by identifier
    const user = await this.config.model
      .where(this.config.identifierColumn, identifier)
      .first();

    if (!user) return null;

    // Verify password
    const hashedPassword = user.getAttribute(this.config.passwordColumn);
    const valid = await Hash.verify(password, hashedPassword);

    if (!valid) return null;

    this.currentUser = user;

    // Store in session if provided
    if (session) {
      session.set('auth_user_id', user.getAttribute('id'));
      session.regenerateId(); // Prevent session fixation
    }

    return user;
  }

  /**
   * Attempt JWT-based login.
   * Returns user + token on success, null on failure.
   */
  async attemptJwt(
    credentials: Record<string, any>
  ): Promise<{ user: AuthUser; token: string; expiresAt: Date } | null> {
    const { Hash } = await import('../hashing/Hash.js');

    if (!this.config.jwt) {
      throw new Error('JWT configuration required for JWT guard.');
    }

    const identifier = credentials[this.config.identifierColumn];
    const password = credentials[this.config.passwordColumn];

    if (!identifier || !password) return null;

    const user = await this.config.model
      .where(this.config.identifierColumn, identifier)
      .first();

    if (!user) return null;

    const hashedPassword = user.getAttribute(this.config.passwordColumn);
    const valid = await Hash.verify(password, hashedPassword);

    if (!valid) return null;

    this.currentUser = user;

    const expiresIn = this.config.jwt.expiresIn ?? 3600;
    const now = Math.floor(Date.now() / 1000);

    const payload: JwtPayload = {
      sub: user.getAttribute('id'),
      iat: now,
      exp: now + expiresIn,
      ...(this.config.jwt.issuer ? { iss: this.config.jwt.issuer } : {}),
    };

    const token = signJwt(payload, this.config.jwt.secret, this.config.jwt.algorithm);
    const expiresAt = new Date((now + expiresIn) * 1000);

    return { user, token, expiresAt };
  }

  /**
   * Resolve user from a JWT token
   */
  async resolveFromToken(token: string): Promise<AuthUser | null> {
    if (!this.config.jwt) {
      throw new Error('JWT configuration required.');
    }

    const payload = verifyJwt(token, this.config.jwt.secret);
    if (!payload) return null;

    const user = await this.config.model.find(payload.sub);
    if (user) this.currentUser = user;
    return user;
  }

  /**
   * Resolve user from session
   */
  async resolveFromSession(session: any): Promise<AuthUser | null> {
    const userId = session.get('auth_user_id');
    if (!userId) return null;

    const user = await this.config.model.find(userId);
    if (user) this.currentUser = user;
    return user;
  }

  /**
   * Register a new user
   */
  async register(attributes: Record<string, any>): Promise<AuthUser> {
    const { Hash } = await import('../hashing/Hash.js');

    // Hash the password
    if (attributes[this.config.passwordColumn]) {
      attributes[this.config.passwordColumn] = await Hash.make(
        attributes[this.config.passwordColumn]
      );
    }

    const user = await this.config.model.create(attributes);
    this.currentUser = user;
    return user;
  }

  /**
   * Logout
   */
  async logout(session?: any): Promise<void> {
    this.currentUser = null;
    if (session) {
      session.forget('auth_user_id');
      session.regenerateId();
    }
  }

  /**
   * Get the currently authenticated user
   */
  user(): AuthUser | null {
    return this.currentUser;
  }

  /**
   * Check if a user is authenticated
   */
  check(): boolean {
    return this.currentUser !== null;
  }

  /**
   * Get the authenticated user's ID
   */
  id(): any {
    return this.currentUser?.getAttribute('id') ?? null;
  }

  /**
   * Generate an API token for a user
   */
  async generateApiToken(user: AuthUser, name: string = 'default'): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const hashedToken = createHmac('sha256', this.config.jwt?.secret ?? process.env.APP_KEY ?? 'svelar-change-me').update(token).digest('hex');

    const { Connection } = await import('../database/Connection.js');
    const table = this.config.token?.table ?? 'personal_access_tokens';

    await Connection.raw(
      `INSERT INTO ${table} (user_id, name, token, created_at) VALUES (?, ?, ?, ?)`,
      [user.getAttribute('id'), name, hashedToken, new Date().toISOString()]
    );

    return token;
  }

  /**
   * Resolve user from an API token
   */
  async resolveFromApiToken(plainToken: string): Promise<AuthUser | null> {
    const { Connection } = await import('../database/Connection.js');
    const table = this.config.token?.table ?? 'personal_access_tokens';

    const hashedToken = createHmac('sha256', this.config.jwt?.secret ?? process.env.APP_KEY ?? 'svelar-change-me').update(plainToken).digest('hex');

    const rows = await Connection.raw(
      `SELECT user_id FROM ${table} WHERE token = ?`,
      [hashedToken]
    );

    if (rows.length === 0) return null;

    const user = await this.config.model.find(rows[0].user_id);
    if (user) this.currentUser = user;
    return user;
  }
}

// ── Auth Middleware ─────────────────────────────────────────

import { Middleware, type MiddlewareContext, type NextFunction } from '../middleware/Middleware.js';

/**
 * Authentication middleware that resolves the user from session or JWT.
 */
export class AuthenticateMiddleware extends Middleware {
  constructor(private authManager: AuthManager) {
    super();
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    let user: AuthUser | null = null;

    // Try session auth first
    if (ctx.event.locals.session) {
      user = await this.authManager.resolveFromSession(ctx.event.locals.session);
    }

    // Try JWT/Bearer token
    if (!user) {
      const authHeader = ctx.event.request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);

        // Try JWT
        try {
          user = await this.authManager.resolveFromToken(token);
        } catch {
          // Not JWT, try API token
          user = await this.authManager.resolveFromApiToken(token);
        }
      }
    }

    ctx.event.locals.user = user;
    ctx.event.locals.auth = this.authManager;

    return next();
  }
}

/**
 * Middleware that requires authentication — returns 401 if not authenticated.
 */
export class RequireAuthMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    if (!ctx.event.locals.user) {
      return new Response(
        JSON.stringify({ message: 'Unauthenticated' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return next();
  }
}
