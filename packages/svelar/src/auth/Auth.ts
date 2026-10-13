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

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { assertSqlIdentifier, Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { Audit } from '../audit/index.js';
import {
  ApiKeyAccessDeniedError,
  ApiKeyRateLimitError,
  ApiKeys,
  type ApiKeyRecord,
  type ApiKeyValidationContext,
  type CreateKeyOptions,
} from '../api-keys/index.js';
import { AuthEligibilityError, evaluateAuthEligibility, type AuthAuthenticationMethod, type AuthEligibilityConfig, type AuthEligibilityResult } from './Eligibility.js';
import { authFailurePresentation, resolveAuthPresentation, type AuthFailureReason, type AuthPresentation, type AuthPresentationConfig } from './Presentation.js';

// ── Types ──────────────────────────────────────────────────

export type GuardType = 'session' | 'jwt' | 'token';
export type AuthenticatedVia = 'bearer' | 'session' | null;

export interface SessionLoginOptions {
  remember?: boolean;
}

export interface FederationLoginOptions extends SessionLoginOptions {
  providerId?: string;
}

export interface AuthLoginSession {
  set(key: string, value: unknown): void;
  regenerateId(): void;
  startAuthentication?(remember: boolean): void;
}

export interface AuthAuditEvent {
  readonly action: 'auth.login' | 'auth.passwordless' | 'auth.federation' | 'auth.refresh' | 'auth.bearer' | 'auth.logout' | 'auth.tokens.revoked';
  readonly method: AuthAuthenticationMethod | 'bearer';
  readonly outcome: 'allowed' | 'denied' | 'logged_out' | 'revoked';
  readonly subjectId: string | number | null;
  readonly reason?: AuthFailureReason;
  readonly providerId?: string;
  readonly purpose?: string;
  readonly affected?: number;
}

export interface AuthAuditConfig {
  enabled?: boolean;
  record?: (event: AuthAuditEvent) => void | Promise<void>;
}

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
  /** Application URL for generating email links */
  appUrl?: string;
  /** Application name for email templates */
  appName?: string;
  /** Password reset configuration */
  passwordResets?: PasswordResetConfig;
  /** Email verification configuration */
  emailVerification?: EmailVerificationConfig;
  /** OTP (one-time password) configuration */
  otp?: OtpConfig;
  /** Optional, application-owned account eligibility rules, checked for every authentication. */
  eligibility?: AuthEligibilityConfig;
  /** Public branding and explicitly configured federation providers. */
  presentation?: AuthPresentationConfig;
  /** Defaults to the configured Audit sink. False disables auth events; a recorder overrides the sink. */
  audit?: boolean | AuthAuditConfig;
}

export interface PasswordResetConfig {
  /** Table name (default: 'password_resets') */
  table?: string;
  /** Token lifetime in seconds (default: 3600 = 1 hour) */
  expiresIn?: number;
}

export interface EmailVerificationConfig {
  /** Table name (default: 'email_verifications') */
  table?: string;
  /** Token lifetime in seconds (default: 86400 = 24 hours) */
  expiresIn?: number;
  /** Column on user model storing verification timestamp (default: 'email_verified_at') */
  verifiedColumn?: string;
}

export interface OtpConfig {
  /** Table name (default: 'otp_codes') */
  table?: string;
  /** Code lifetime in seconds (default: 600 = 10 minutes) */
  expiresIn?: number;
  /** Code length (default: 6) */
  length?: number;
}

export interface JwtConfig {
  secret: string;
  expiresIn?: number; // seconds, default 3600
  algorithm?: 'HS256' | 'HS384' | 'HS512';
  issuer?: string;
  /** Enable refresh tokens (default: false) */
  refreshTokens?: boolean;
  /** Refresh token lifetime in seconds (default: 604800 = 7 days) */
  refreshExpiresIn?: number;
  /** Table storing refresh tokens (default: 'refresh_tokens') */
  refreshTable?: string;
}

export interface TokenConfig {
  /** Token prefix for generated keys (default: ApiKeys config prefix, usually 'sk_') */
  prefix?: string;
  /** Default permissions for AuthManager.generateApiToken() */
  permissions?: string[];
  /** Default team for generated machine tokens */
  teamId?: string | number;
  /** Default rate limit for generated machine tokens */
  rateLimit?: CreateKeyOptions['rateLimit'];
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

export interface JwtTokenPair {
  user: AuthUser;
  token: string;
  expiresAt: Date;
  refreshToken?: string;
  refreshExpiresAt?: Date;
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

export function verifyJwt(token: string, secret: string, expectedAlgorithm: 'HS256' | 'HS384' | 'HS512' = 'HS256'): JwtPayload | null {
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
  if (!['HS256', 'HS384', 'HS512'].includes(headerObj.alg)) return null;
  if (headerObj.alg !== expectedAlgorithm) return null;

  // Verify signature
  const expected = createJwtSignature(header, payload, secret, headerObj.alg);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

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
  private currentApiKey: ApiKeyRecord | null = null;
  private lastFailure: AuthFailureReason | null = null;

  constructor(userConfig: AuthConfig) {
    this.config = {
      identifierColumn: 'email',
      passwordColumn: 'password',
      ...userConfig,
    };
  }

  /**
   * Create a request-local manager with the same configuration.
   *
   * AuthManager keeps the resolved user in memory for ergonomic `auth.user()`
   * calls. Middleware must use a fresh instance per request so user state never
   * leaks between concurrent requests.
   */
  fork(): AuthManager {
    return new AuthManager(this.config);
  }

  /**
   * Clear the in-memory resolved user.
   */
  clearUser(): void {
    this.currentUser = null;
    this.currentApiKey = null;
    this.lastFailure = null;
  }

  failureReason(): AuthFailureReason | null { return this.lastFailure; }

  hasJwtConfig(): boolean { return this.config.jwt !== undefined; }

  presentation(): AuthPresentation {
    return resolveAuthPresentation(this.config.presentation, this.config.appName ?? process.env.APP_NAME ?? 'Svelar');
  }

  federationProvider(providerId: string): AuthPresentation['providers'][number] | null {
    return this.presentation().providers.find((provider) => provider.id === providerId) ?? null;
  }

  async checkEligibility(user: AuthUser, method: AuthAuthenticationMethod = 'session'): Promise<AuthEligibilityResult> {
    return evaluateAuthEligibility(user, this.config.eligibility, method, this.config.emailVerification?.verifiedColumn);
  }

  private beginAuthentication(): void {
    this.clearUser();
    this.lastFailure = 'invalid_credentials';
  }

  private async accepts(user: AuthUser, method: AuthAuthenticationMethod): Promise<boolean> {
    try {
      const result = await this.checkEligibility(user, method);
      this.lastFailure = result.eligible ? null : result.reason;
      return result.eligible;
    } catch (error) {
      this.lastFailure = 'temporarily_unavailable';
      throw error;
    }
  }

  private startSession(user: AuthUser, session: AuthLoginSession | undefined, options: SessionLoginOptions = {}): void {
    if (options.remember !== undefined && typeof options.remember !== 'boolean') throw new TypeError('Remember-me must be a boolean.');
    if (options.remember && typeof session?.startAuthentication !== 'function') throw new Error('Remember-me requires a managed Session.');
    if (!session) return;
    session.startAuthentication?.(options.remember ?? false);
    session.set('auth_user_id', user.getAttribute('id'));
    session.regenerateId();
  }

  private subjectId(user: AuthUser | null | undefined): string | number | null {
    const id: unknown = user?.getAttribute('id');
    return typeof id === 'string' || typeof id === 'number' && Number.isSafeInteger(id) ? id : null;
  }

  private async recordAuthAudit(event: AuthAuditEvent): Promise<void> {
    const configured = this.config.audit;
    if (configured === false) return;
    if (configured !== undefined && configured !== true && (!configured || typeof configured !== 'object')) throw new TypeError('Invalid auth audit configuration.');
    const options = typeof configured === 'object' ? configured : undefined;
    if (options?.enabled !== undefined && typeof options.enabled !== 'boolean') throw new TypeError('Auth audit enabled must be a boolean.');
    if (options?.enabled === false) return;
    if (options?.record !== undefined && typeof options.record !== 'function') throw new TypeError('Auth audit record must be a function.');
    const owned = Object.freeze({ ...event });
    const write = async () => {
      if (options?.record) await options.record(owned);
      else await Audit.log({ userId: null, action: owned.action, modelType: 'Auth', modelId: owned.subjectId ?? 'anonymous',
        metadata: { method: owned.method, outcome: owned.outcome, targetUserId: owned.subjectId,
          ...(owned.reason === undefined ? {} : { reason: owned.reason }),
          ...(owned.providerId === undefined ? {} : { providerId: owned.providerId }),
          ...(owned.purpose === undefined ? {} : { purpose: owned.purpose }),
          ...(owned.affected === undefined ? {} : { affected: owned.affected }) } });
    };
    try {
      if (owned.outcome === 'allowed' && owned.subjectId !== null) {
        await ApplicationContext.run({ userId: owned.subjectId, actorId: owned.subjectId, actorType: 'user',
          apiKeyId: undefined, serviceAccountId: undefined, abilities: undefined }, write);
      } else await write();
    } catch (error) {
      this.lastFailure = 'temporarily_unavailable';
      throw error;
    }
  }

  private async recordAttempt(method: AuthAuthenticationMethod, outcome: 'allowed' | 'denied', user?: AuthUser | null,
    details: Pick<AuthAuditEvent, 'providerId' | 'purpose'> = {}): Promise<void> {
    const action = method === 'passwordless' ? 'auth.passwordless' : method === 'federation' ? 'auth.federation'
      : method === 'refresh' ? 'auth.refresh' : 'auth.login';
    await this.recordAuthAudit({ action, method, outcome, subjectId: this.subjectId(user),
      ...(outcome === 'denied' ? { reason: this.lastFailure ?? 'invalid_credentials' } : {}), ...details });
  }

  private async deniedAttempt(method: AuthAuthenticationMethod, user?: AuthUser | null,
    details: Pick<AuthAuditEvent, 'providerId' | 'purpose'> = {}): Promise<null> {
    await this.recordAttempt(method, 'denied', user, details);
    return null;
  }

  /** Used by credential middleware only after the complete Bearer verification path fails. */
  async auditBearerDenial(reason: AuthFailureReason): Promise<void> {
    await this.recordAuthAudit({ action: 'auth.bearer', method: 'bearer', outcome: 'denied', subjectId: null, reason });
  }

  /** Establish a verified federation login using fresh persisted account state. */
  async login(user: AuthUser, session?: AuthLoginSession, options: FederationLoginOptions = {}): Promise<AuthUser | null> {
    this.beginAuthentication();
    if (options.providerId !== undefined && this.federationProvider(options.providerId)?.available !== true) {
      this.lastFailure = 'provider_unavailable';
      return this.deniedAttempt('federation', null, { providerId: options.providerId });
    }
    const persisted = await this.config.model.find(user.getAttribute('id'));
    if (!persisted || !await this.accepts(persisted, 'federation')) return this.deniedAttempt('federation', persisted, { providerId: options.providerId });
    await this.recordAttempt('federation', 'allowed', persisted, { providerId: options.providerId });
    this.startSession(persisted, session, options);
    this.currentUser = persisted;
    return persisted;
  }

  /**
   * Attempt session-based login.
   * Returns the user on success, null on failure.
   */
  async attempt(
    credentials: Record<string, any>,
    session?: any,
    options: SessionLoginOptions = {},
  ): Promise<AuthUser | null> {
    this.beginAuthentication();
    if (options.remember !== undefined && typeof options.remember !== 'boolean') throw new Error('Remember-me must be a boolean.');
    if (options.remember && typeof session?.startAuthentication !== 'function') throw new Error('Remember-me requires a managed Session.');
    const { Hash } = await import('../hashing/Hash.js');

    const identifier = credentials[this.config.identifierColumn];
    const password = credentials[this.config.passwordColumn];

    if (!identifier || !password) {
      this.currentUser = null;
      return this.deniedAttempt('session');
    }

    // Find user by identifier
    const user = await this.config.model
      .where(this.config.identifierColumn, identifier)
      .first();

    if (!user) {
      this.currentUser = null;
      return this.deniedAttempt('session');
    }

    // Verify password
    const hashedPassword = user.getAttribute(this.config.passwordColumn);
    const valid = await Hash.verify(password, hashedPassword);

    if (!valid) {
      this.currentUser = null;
      return this.deniedAttempt('session', user);
    }

    if (!await this.accepts(user, 'session')) return this.deniedAttempt('session', user);
    await this.recordAttempt('session', 'allowed', user);
    this.startSession(user, session, options);

    this.currentUser = user;

    return user;
  }

  /**
   * Attempt JWT-based login.
   * Returns user + access token (+ refresh token if enabled) on success, null on failure.
   */
  async attemptJwt(
    credentials: Record<string, any>
  ): Promise<JwtTokenPair | null> {
    this.beginAuthentication();
    const { Hash } = await import('../hashing/Hash.js');

    if (!this.config.jwt) {
      throw new Error('JWT configuration required for JWT guard.');
    }

    const identifier = credentials[this.config.identifierColumn];
    const password = credentials[this.config.passwordColumn];

    if (!identifier || !password) {
      this.currentUser = null;
      return this.deniedAttempt('jwt');
    }

    const user = await this.config.model
      .where(this.config.identifierColumn, identifier)
      .first();

    if (!user) {
      this.currentUser = null;
      return this.deniedAttempt('jwt');
    }

    const hashedPassword = user.getAttribute(this.config.passwordColumn);
    const valid = await Hash.verify(password, hashedPassword);

    if (!valid) {
      this.currentUser = null;
      return this.deniedAttempt('jwt', user);
    }

    if (!await this.accepts(user, 'jwt')) return this.deniedAttempt('jwt', user);
    await this.recordAttempt('jwt', 'allowed', user);
    const pair = await this.issueTokenPair(user);
    this.currentUser = user;
    return pair;
  }

  /**
   * Issue an access token (and optionally a refresh token) for a user.
   */
  private async issueTokenPair(user: AuthUser): Promise<JwtTokenPair> {
    const jwt = this.config.jwt!;
    const expiresIn = jwt.expiresIn ?? 3600;
    const now = Math.floor(Date.now() / 1000);

    const payload: JwtPayload = {
      sub: user.getAttribute('id'),
      iat: now,
      exp: now + expiresIn,
      ...(jwt.issuer ? { iss: jwt.issuer } : {}),
    };

    const token = signJwt(payload, jwt.secret, jwt.algorithm);
    const expiresAt = new Date((now + expiresIn) * 1000);

    const result: JwtTokenPair = { user, token, expiresAt };

    // Issue refresh token if enabled
    if (jwt.refreshTokens) {
      const refreshExpiresIn = jwt.refreshExpiresIn ?? 604800; // 7 days
      const refreshToken = randomBytes(32).toString('base64url');
      const hashedRefresh = createHmac('sha256', jwt.secret).update(refreshToken).digest('hex');
      const refreshExpiresAt = new Date((now + refreshExpiresIn) * 1000);

      const table = this.tableName(jwt.refreshTable ?? 'refresh_tokens', 'Refresh token table name');

      await this.query(table).insert({
        user_id: user.getAttribute('id'),
        token: hashedRefresh,
        expires_at: refreshExpiresAt.toISOString(),
        created_at: new Date().toISOString(),
        revoked_at: null,
      });

      result.refreshToken = refreshToken;
      result.refreshExpiresAt = refreshExpiresAt;
    }

    return result;
  }

  /**
   * Exchange a refresh token for a new access token + refresh token pair.
   * The old refresh token is revoked (rotation).
   */
  async refreshJwt(refreshToken: string): Promise<JwtTokenPair | null> {
    this.beginAuthentication();
    if (!this.config.jwt) {
      throw new Error('JWT configuration required.');
    }
    if (!this.config.jwt.refreshTokens) {
      throw new Error('Refresh tokens are not enabled. Set jwt.refreshTokens = true.');
    }

    const jwt = this.config.jwt;
    const hashedRefresh = createHmac('sha256', jwt.secret).update(refreshToken).digest('hex');
    const table = this.tableName(jwt.refreshTable ?? 'refresh_tokens', 'Refresh token table name');

    // Find the refresh token
    const row = await this.query(table).where('token', hashedRefresh).first();
    if (!row) return this.deniedAttempt('refresh');

    // Check if revoked
    if (row.revoked_at) return this.deniedAttempt('refresh');

    // Check if expired
    if (new Date(row.expires_at) < new Date()) return this.deniedAttempt('refresh');

    // Revoke the old refresh token (rotation — each token is single-use)
    const revoked = await this.query(table)
      .where('token', hashedRefresh)
      .whereNull('revoked_at')
      .update({ revoked_at: new Date().toISOString() });
    if (revoked === 0) return this.deniedAttempt('refresh');

    // Resolve user and issue new pair
    const user = await this.config.model.find(row.user_id);
    if (!user || !await this.accepts(user, 'refresh')) return this.deniedAttempt('refresh', user);
    await this.recordAttempt('refresh', 'allowed', user);
    const pair = await this.issueTokenPair(user);
    this.currentUser = user;
    return pair;
  }

  /**
   * Revoke all refresh tokens for a user (e.g. on logout or password change).
   */
  async revokeRefreshTokens(userId: string | number): Promise<void> {
    if (!this.config.jwt?.refreshTokens) return;

    const table = this.tableName(this.config.jwt.refreshTable ?? 'refresh_tokens', 'Refresh token table name');

    await Connection.transaction(async () => {
      const affected = await this.query(table).where('user_id', userId).whereNull('revoked_at')
        .update({ revoked_at: new Date().toISOString() });
      await this.recordAuthAudit({ action: 'auth.tokens.revoked', method: 'refresh', outcome: 'revoked', subjectId: userId, affected });
    });
  }

  /**
   * Resolve user from a JWT token
   */
  async resolveFromToken(token: string): Promise<AuthUser | null> {
    this.beginAuthentication();
    if (!this.config.jwt) {
      throw new Error('JWT configuration required.');
    }

    const payload = verifyJwt(token, this.config.jwt.secret, this.config.jwt.algorithm ?? 'HS256');
    if (!payload) {
      this.currentUser = null;
      return null;
    }

    if (this.config.jwt.issuer && payload.iss !== this.config.jwt.issuer) {
      this.currentUser = null;
      return null;
    }

    const user = await this.config.model.find(payload.sub);
    if (!user || !await this.accepts(user, 'jwt')) return null;
    this.currentUser = user;
    return user;
  }

  /**
   * Resolve user from session
   */
  async resolveFromSession(session: any): Promise<AuthUser | null> {
    this.beginAuthentication();
    if (session.getActivityStatus?.()?.expired) { this.lastFailure = 'session_expired'; return null; }
    const userId = session.get('auth_user_id');
    if (!userId) {
      this.currentUser = null;
      return null;
    }

    const user = await this.config.model.find(userId);
    if (session.getActivityStatus?.()?.expired) { this.lastFailure = 'session_expired'; return null; }
    if (!user || !await this.accepts(user, 'session')) {
      session.forget('auth_user_id');
      session.forget('_svelar_remember');
      session.endAuthentication?.();
      session.regenerateId();
      return null;
    }
    this.currentUser = user;
    return user;
  }

  /**
   * Register a new user
   */
  async register(attributes: Record<string, any>): Promise<AuthUser> {
    this.beginAuthentication();
    const { Hash } = await import('../hashing/Hash.js');

    // Hash the password
    if (attributes[this.config.passwordColumn]) {
      attributes[this.config.passwordColumn] = await Hash.make(
        attributes[this.config.passwordColumn]
      );
    }

    const user = await this.config.model.create(attributes);
    if (await this.accepts(user, 'registration')) this.currentUser = user;
    return user;
  }

  /**
   * Logout
   */
  async logout(session?: any): Promise<void> {
    await this.recordAuthAudit({ action: 'auth.logout', method: 'session', outcome: 'logged_out', subjectId: this.subjectId(this.currentUser) });
    this.clearUser();
    if (session) {
      session.forget('auth_user_id');
      session.forget('_svelar_remember');
      session.endAuthentication?.();
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

  private tableName(name: string, label: string): string {
    return assertSqlIdentifier(name, label);
  }

  private query(table: string): QueryBuilder<any> {
    return new QueryBuilder(table);
  }

  /**
   * Generate an API token for a user
   */
  async generateApiToken(
    user: AuthUser,
    name: string = 'default',
    options: Omit<CreateKeyOptions, 'name' | 'userId'> = {},
  ): Promise<string> {
    const persisted = await this.config.model.find(user.getAttribute('id'));
    if (!persisted) throw new AuthEligibilityError('account_disabled');
    const eligibility = await this.checkEligibility(persisted, 'api_token');
    if (!eligibility.eligible) throw new AuthEligibilityError(eligibility.reason);
    const { plainTextKey } = await ApiKeys.create({
      ...options,
      userId: user.getAttribute('id'),
      name,
      teamId: options.teamId ?? this.config.token?.teamId,
      prefix: options.prefix ?? this.config.token?.prefix,
      permissions: options.permissions ?? this.config.token?.permissions,
      rateLimit: options.rateLimit ?? this.config.token?.rateLimit,
    });

    return plainTextKey;
  }

  /**
   * Resolve user from an API token
   */
  async resolveFromApiToken(plainToken: string, context: ApiKeyValidationContext = {}): Promise<AuthUser | null> {
    this.beginAuthentication();
    const record = await ApiKeys.validate(plainToken, context);
    if (!record) {
      this.currentUser = null;
      return null;
    }

    if (record.actorType === 'service_account' || record.userId == null) {
      this.currentApiKey = record;
      this.lastFailure = null;
      return null;
    }

    let user: AuthUser | null;
    try {
      user = await this.config.model.find(record.userId);
      if (user && await this.accepts(user, 'api_token')) {
        this.currentApiKey = record;
        this.currentUser = user;
        return user;
      }
    } catch (error) {
      this.currentApiKey = null;
      for (const key of ['teamId', 'tenantId', 'userId', 'actorId', 'actorType', 'apiKeyId', 'serviceAccountId', 'abilities']) ApplicationContext.set(key, undefined);
      throw error;
    }
    this.currentApiKey = null;
    for (const key of ['teamId', 'tenantId', 'userId', 'actorId', 'actorType', 'apiKeyId', 'serviceAccountId', 'abilities']) ApplicationContext.set(key, undefined);
    return null;
  }

  /**
   * Get the API key resolved for the current request, if Bearer auth used one.
   */
  apiKey(): ApiKeyRecord | null {
    return this.currentApiKey;
  }

  // ── Password Reset ──────────────────────────────────────

  /**
   * Send a password reset email.
   * Generates a token, stores its hash, and sends the password-reset email template.
   */
  async sendPasswordReset(email: string): Promise<boolean> {
    const user = await this.config.model
      .where(this.config.identifierColumn, email)
      .first();

    if (!user) return false; // Don't reveal if user exists

    const table = this.tableName(this.config.passwordResets?.table ?? 'password_resets', 'Password resets table name');
    const expiresIn = this.config.passwordResets?.expiresIn ?? 3600;

    // Delete any existing reset tokens for this email
    await this.query(table).where('email', email).delete();

    // Generate token
    const token = randomBytes(32).toString('base64url');
    const hashedToken = this.hashToken(token);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await this.query(table).insert({
      email,
      token: hashedToken,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

    // Send email
    const appUrl = this.config.appUrl ?? process.env.APP_URL ?? 'http://localhost:5173';
    const appName = this.config.appName ?? process.env.APP_NAME ?? 'Svelar';
    const resetUrl = `${appUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

    await this.sendAuthEmail('password-reset', email, {
      appName,
      'user.name': user.getAttribute('name') ?? email,
      resetUrl,
    });

    return true;
  }

  /**
   * Reset a user's password using a valid reset token.
   * Validates the token, updates the password, and revokes all refresh tokens.
   */
  async resetPassword(token: string, email: string, newPassword: string): Promise<boolean> {
    const { Hash } = await import('../hashing/Hash.js');
    const table = this.tableName(this.config.passwordResets?.table ?? 'password_resets', 'Password resets table name');

    const row = await this.findMatchingTokenRow(
      this.query(table).where('email', email),
      token,
      'token',
    );
    if (!row) return false;

    // Check if expired
    if (new Date(row.expires_at) < new Date()) {
      await this.query(table).where('email', email).delete();
      return false;
    }

    // Update password
    const user = await this.config.model
      .where(this.config.identifierColumn, email)
      .first();

    if (!user) return false;

    const hashedPassword = await Hash.make(newPassword);
    await this.config.model
      .where('id', user.getAttribute('id'))
      .update({ [this.config.passwordColumn]: hashedPassword });

    // Delete all reset tokens for this email
    await this.query(table).where('email', email).delete();

    // Revoke all refresh tokens
    await this.revokeRefreshTokens(user.getAttribute('id'));

    return true;
  }

  // ── Email Verification ──────────────────────────────────

  /**
   * Send an email verification link.
   * Generates a token, stores its hash, and sends the email-verification template.
   */
  async sendVerificationEmail(user: AuthUser): Promise<void> {
    const table = this.tableName(this.config.emailVerification?.table ?? 'email_verifications', 'Email verifications table name');
    const expiresIn = this.config.emailVerification?.expiresIn ?? 86400;
    const email = user.getAttribute(this.config.identifierColumn);

    // Delete existing tokens for this user
    await this.query(table).where('user_id', user.getAttribute('id')).delete();

    const token = randomBytes(32).toString('base64url');
    const hashedToken = this.hashToken(token);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await this.query(table).insert({
      user_id: user.getAttribute('id'),
      token: hashedToken,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

    const appUrl = this.config.appUrl ?? process.env.APP_URL ?? 'http://localhost:5173';
    const verifyUrl = `${appUrl}/verify-email?token=${token}&id=${user.getAttribute('id')}`;

    await this.sendAuthEmail('email-verification', email, {
      'user.name': user.getAttribute('name') ?? email,
      verifyUrl,
    });
  }

  /**
   * Verify an email address using a valid verification token.
   * Sets the email_verified_at column on the user.
   */
  async verifyEmail(token: string, userId: string | number): Promise<boolean> {
    const table = this.tableName(this.config.emailVerification?.table ?? 'email_verifications', 'Email verifications table name');
    const verifiedColumn = this.config.emailVerification?.verifiedColumn ?? 'email_verified_at';

    const row = await this.findMatchingTokenRow(
      this.query(table).where('user_id', userId),
      token,
      'token',
    );
    if (!row) return false;

    if (new Date(row.expires_at) < new Date()) {
      await this.query(table).where('user_id', userId).delete();
      return false;
    }

    // Mark email as verified
    await this.config.model
      .where('id', userId)
      .update({ [verifiedColumn]: new Date().toISOString() });

    // Delete all verification tokens for this user
    await this.query(table).where('user_id', userId).delete();

    return true;
  }

  /**
   * Check if a user has verified their email.
   */
  isEmailVerified(user: AuthUser): boolean {
    const verifiedColumn = this.config.emailVerification?.verifiedColumn ?? 'email_verified_at';
    return !!user.getAttribute(verifiedColumn);
  }

  // ── OTP (One-Time Password) ─────────────────────────────

  /**
   * Send an OTP code via email.
   * Generates a numeric code, stores its hash, and sends the otp-code email template.
   *
   * @param email - User email address
   * @param purpose - Purpose identifier (default: 'login')
   * @returns true if sent (user exists), false if user not found
   */
  async sendOtp(email: string, purpose: string = 'login'): Promise<boolean> {
    const user = await this.config.model
      .where(this.config.identifierColumn, email)
      .first();

    if (!user) return false;
    if (purpose === 'login' && !await this.accepts(user, 'passwordless')) return false;

    const table = this.tableName(this.config.otp?.table ?? 'otp_codes', 'OTP table name');
    const expiresIn = this.config.otp?.expiresIn ?? 600;
    const length = this.config.otp?.length ?? 6;

    // Delete expired/used codes for this email+purpose
    await this.query(table).where('email', email).where('purpose', purpose).delete();

    // Generate numeric code
    const code = this.generateOtpCode(length);
    const hashedCode = this.hashToken(code);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await this.query(table).insert({
      email,
      code: hashedCode,
      purpose,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
      used_at: null,
    });

    const appName = this.config.appName ?? process.env.APP_NAME ?? 'Svelar';
    const expiresMinutes = Math.ceil(expiresIn / 60);

    await this.sendAuthEmail('otp-code', email, {
      appName,
      'user.name': user.getAttribute('name') ?? email,
      code,
      purpose,
      expiresMinutes: String(expiresMinutes),
    });

    return true;
  }

  /**
   * Verify an OTP code without creating a session.
   * Returns the user if valid, null otherwise.
   */
  async verifyOtp(email: string, code: string, purpose: string = 'login'): Promise<AuthUser | null> {
    this.beginAuthentication();
    const table = this.tableName(this.config.otp?.table ?? 'otp_codes', 'OTP table name');

    const row = await this.findMatchingTokenRow(
      this.query(table)
        .where('email', email)
        .where('purpose', purpose)
        .whereNull('used_at'),
      code,
      'code',
    );
    if (!row) return this.deniedAttempt('passwordless', null, { purpose });

    if (new Date(row.expires_at) < new Date()) {
      await this.query(table).where('email', email).where('purpose', purpose).delete();
      return this.deniedAttempt('passwordless', null, { purpose });
    }

    // Mark as used
    const consumed = await this.query(table)
      .where('code', row.code)
      .where('email', email)
      .where('purpose', purpose)
      .whereNull('used_at')
      .update({ used_at: new Date().toISOString() });
    if (consumed === 0) return this.deniedAttempt('passwordless', null, { purpose });

    const user = await this.config.model
      .where(this.config.identifierColumn, email)
      .first();

    if (!user || !await this.accepts(user, 'passwordless')) return this.deniedAttempt('passwordless', user, { purpose });
    await this.recordAttempt('passwordless', 'allowed', user, { purpose });
    this.currentUser = user;
    return user;
  }

  /**
   * Verify OTP and create a session (OTP login).
   * Combines verifyOtp + session creation in one step.
   */
  async attemptOtp(
    email: string,
    code: string,
    session?: any,
    purpose: string = 'login'
  ): Promise<AuthUser | null> {
    const user = await this.verifyOtp(email, code, purpose);
    if (!user) return null;

    this.startSession(user, session);

    return user;
  }

  /**
   * Delete expired tokens from password_resets, email_verifications, and otp_codes tables.
   * Call this from a scheduled task (e.g., daily).
   */
  async cleanupExpiredTokens(): Promise<{ passwordResets: number; verifications: number; otpCodes: number }> {
    const now = new Date().toISOString();
    let passwordResets = 0;
    let verifications = 0;
    let otpCodes = 0;

    const prTable = this.tableName(this.config.passwordResets?.table ?? 'password_resets', 'Password resets table name');
    const evTable = this.tableName(this.config.emailVerification?.table ?? 'email_verifications', 'Email verifications table name');
    const otpTable = this.tableName(this.config.otp?.table ?? 'otp_codes', 'OTP table name');

    passwordResets = await this.query(prTable).where('expires_at', '<', now).delete();
    verifications = await this.query(evTable).where('expires_at', '<', now).delete();
    otpCodes = await this.query(otpTable).where('expires_at', '<', now).delete();
    otpCodes += await this.query(otpTable).whereNotNull('used_at').delete();

    return { passwordResets, verifications, otpCodes };
  }

  // ── Private Helpers ─────────────────────────────────────

  private hashToken(token: string): string {
    const secret = this.config.jwt?.secret ?? process.env.APP_KEY;
    if (!secret) throw new Error('APP_KEY is not set. Set it in your .env file or pass jwt.secret in auth config.');
    return createHmac('sha256', secret).update(token).digest('hex');
  }

  private async findMatchingTokenRow(query: QueryBuilder<any>, plainToken: string, column: string): Promise<any | null> {
    const candidateHash = this.hashToken(plainToken);
    const rows = await query.get();

    for (const row of rows) {
      if (this.hashesMatch(row[column], candidateHash)) {
        return row;
      }
    }

    return null;
  }

  private hashesMatch(storedHash: unknown, candidateHash: string): boolean {
    if (typeof storedHash !== 'string') return false;

    const stored = Buffer.from(storedHash, 'hex');
    const candidate = Buffer.from(candidateHash, 'hex');
    if (stored.length !== candidate.length || stored.length === 0) return false;

    return timingSafeEqual(stored, candidate);
  }

  private generateOtpCode(length: number): string {
    if (!Number.isInteger(length) || length < 4 || length > 12) {
      throw new Error('OTP length must be an integer between 4 and 12');
    }

    return Array.from({ length }, () => randomInt(0, 10).toString()).join('');
  }

  private async sendAuthEmail(templateName: string, to: string, vars: Record<string, any>): Promise<void> {
    const { EmailTemplates } = await import('../email-templates/index.js');
    const { Mailer } = await import('../mail/index.js');

    const rendered = await EmailTemplates.render(templateName, vars);
    await Mailer.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }
}

// ── Auth Middleware ─────────────────────────────────────────

import { Middleware, type MiddlewareContext, type NextFunction } from '../middleware/Middleware.js';
import { ApplicationContext } from '../support/Context.js';

/**
 * Authentication middleware that resolves the user from session or JWT.
 */
export class AuthenticateMiddleware extends Middleware {
  constructor(private authManager: AuthManager) {
    super();
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const authManager = typeof this.authManager.fork === 'function'
      ? this.authManager.fork()
      : this.authManager;
    if (typeof authManager.clearUser === 'function') {
      authManager.clearUser();
    }
    let user: AuthUser | null = null;
    let authenticatedVia: AuthenticatedVia = null;
    ctx.event.locals.authenticatedVia = null;
    ctx.locals.authenticatedVia = null;
    ctx.event.locals.user = null;
    ctx.event.locals.apiKey = null;
    ctx.event.locals.auth = authManager;
    ctx.locals.auth = authManager;
    ctx.locals.user = null;
    ctx.locals.apiKey = null;

    const authHeader = ctx.event.request.headers.get('authorization');
    const bearerSupplied = authHeader !== null && /^Bearer(?:\s|$)/i.test(authHeader);
    if (bearerSupplied) {
      const token = /^Bearer\s+(\S+)$/i.exec(authHeader)?.[1];
      if (token) {
        try {
          if (authManager.hasJwtConfig?.() !== false) user = await authManager.resolveFromToken(token);
          const rejected = authManager.failureReason?.();
          const eligibilityRejected = rejected != null && ['account_disabled', 'account_locked', 'email_unverified', 'temporarily_unavailable'].includes(rejected);
          if (!user && !eligibilityRejected) user = await authManager.resolveFromApiToken(token, { ip: ctx.event.getClientAddress?.() });
        } catch (error) {
          if (error instanceof ApiKeyRateLimitError) {
            await authManager.auditBearerDenial?.('rate_limited');
            return new Response(JSON.stringify({ message: error.message, reason: 'rate_limited' }), {
              status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(error.retryAfter) },
            });
          }
          if (error instanceof ApiKeyAccessDeniedError) {
            await authManager.auditBearerDenial?.('invalid_credentials');
            return new Response(JSON.stringify({ message: error.message }), {
              status: 403, headers: { 'Content-Type': 'application/json' },
            });
          }
          await authManager.auditBearerDenial?.('temporarily_unavailable');
          return new Response(JSON.stringify({ message: 'Authentication temporarily unavailable.', reason: 'temporarily_unavailable' }), {
            status: 503, headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      const verifiedApiKey = typeof authManager.apiKey === 'function' ? authManager.apiKey() : null;
      if (!user && !verifiedApiKey) {
        const failure = authFailurePresentation(authManager.failureReason?.() ?? 'invalid_credentials');
        await authManager.auditBearerDenial?.(failure.reason);
        return new Response(JSON.stringify({ message: 'Authentication denied.', reason: failure.reason }), {
          status: failure.status, headers: { 'Content-Type': 'application/json' },
        });
      }
      authenticatedVia = 'bearer';
    } else if (ctx.event.locals.session) {
      user = await authManager.resolveFromSession(ctx.event.locals.session);
      if (user) authenticatedVia = 'session';
    }

    const apiKey = typeof authManager.apiKey === 'function' ? authManager.apiKey() : null;
    ctx.event.locals.user = user;
    ctx.event.locals.apiKey = apiKey;
    ctx.event.locals.authenticatedVia = authenticatedVia;
    ctx.event.locals.auth = authManager;
    ctx.locals.auth = authManager;
    ctx.locals.user = user;
    ctx.locals.apiKey = apiKey;
    ctx.locals.authenticatedVia = authenticatedVia;
    const userId = user?.getAttribute?.('id') ?? user?.id;
    if (apiKey?.teamId != null) {
      ApplicationContext.set('teamId', apiKey.teamId);
      ApplicationContext.set('tenantId', apiKey.teamId);
    }
    if (apiKey?.actorId != null) {
      ApplicationContext.set('actorId', apiKey.actorId);
    }
    if (apiKey?.actorType) {
      ApplicationContext.set('actorType', apiKey.actorType);
    }
    if (apiKey?.id) {
      ApplicationContext.set('apiKeyId', apiKey.id);
    }
    if (apiKey?.serviceAccountId) {
      ApplicationContext.set('serviceAccountId', apiKey.serviceAccountId);
    }
    if (userId != null) {
      ApplicationContext.set('userId', userId);
      if (!apiKey?.actorId) {
        ApplicationContext.set('actorId', userId);
      }
    }

    return next();
  }
}

/**
 * Middleware that requires authentication — returns 401 JSON if not authenticated.
 * Best for API routes.
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

/**
 * Middleware that redirects unauthenticated users to a login page.
 * Best for page routes (dashboard, admin, etc.).
 *
 * @example
 * ```ts
 * // In +layout.server.ts to protect an entire route group:
 * import { guardAuth } from '@beeblock/svelar/auth';
 *
 * export const load = guardAuth();
 * // or with a custom redirect:
 * export const load = guardAuth('/signin');
 * ```
 */
export class RedirectIfNotAuthenticated extends Middleware {
  constructor(private redirectTo: string = '/login') {
    super();
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    if (!ctx.event.locals.user) {
      const url = new URL(this.redirectTo, ctx.event.url.origin);
      return new Response(null, {
        status: 302,
        headers: { Location: url.pathname },
      });
    }
    return next();
  }
}

/**
 * Convenience helper to create a SvelteKit load function that guards a route.
 * Use in `+layout.server.ts` to protect all pages under a route group.
 *
 * @example
 * ```ts
 * // src/routes/dashboard/+layout.server.ts
 * import { guardAuth } from '@beeblock/svelar/auth';
 * export const load = guardAuth();
 *
 * // src/routes/admin/+layout.server.ts — custom redirect
 * import { guardAuth } from '@beeblock/svelar/auth';
 * export const load = guardAuth('/login');
 *
 * // With role check
 * import { guardAuth } from '@beeblock/svelar/auth';
 * export const load = guardAuth('/dashboard', { role: 'admin' });
 * ```
 */
export function guardAuth(
  redirectTo = '/login',
  options?: { role?: string },
) {
  return async (event: { locals: Record<string, any> }) => {
    const user = event.locals.user;
    if (!user) {
      const { redirect } = await import('@sveltejs/kit');
      throw redirect(302, redirectTo);
    }
    if (options?.role && user.role !== options.role) {
      const { redirect } = await import('@sveltejs/kit');
      throw redirect(302, redirectTo);
    }
    return {};
  };
}
