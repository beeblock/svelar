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
import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { ApiKeys } from '../api-keys/index.js';

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
   * Returns user + access token (+ refresh token if enabled) on success, null on failure.
   */
  async attemptJwt(
    credentials: Record<string, any>
  ): Promise<JwtTokenPair | null> {
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

    return this.issueTokenPair(user);
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
    if (!row) return null;

    // Check if revoked
    if (row.revoked_at) return null;

    // Check if expired
    if (new Date(row.expires_at) < new Date()) return null;

    // Revoke the old refresh token (rotation — each token is single-use)
    await this.query(table).where('token', hashedRefresh).update({ revoked_at: new Date().toISOString() });

    // Resolve user and issue new pair
    const user = await this.config.model.find(row.user_id);
    if (!user) return null;

    this.currentUser = user;
    return this.issueTokenPair(user);
  }

  /**
   * Revoke all refresh tokens for a user (e.g. on logout or password change).
   */
  async revokeRefreshTokens(userId: string | number): Promise<void> {
    if (!this.config.jwt?.refreshTokens) return;

    const table = this.tableName(this.config.jwt.refreshTable ?? 'refresh_tokens', 'Refresh token table name');

    await this.query(table)
      .where('user_id', userId)
      .whereNull('revoked_at')
      .update({ revoked_at: new Date().toISOString() });
  }

  /**
   * Resolve user from a JWT token
   */
  async resolveFromToken(token: string): Promise<AuthUser | null> {
    if (!this.config.jwt) {
      throw new Error('JWT configuration required.');
    }

    const payload = verifyJwt(token, this.config.jwt.secret, this.config.jwt.algorithm ?? 'HS256');
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

  private tableName(name: string, label: string): string {
    return assertSqlIdentifier(name, label);
  }

  private query(table: string): QueryBuilder<any> {
    return new QueryBuilder(table);
  }

  /**
   * Generate an API token for a user
   */
  async generateApiToken(user: AuthUser, name: string = 'default'): Promise<string> {
    const { plainTextKey } = await ApiKeys.create({
      userId: user.getAttribute('id'),
      name,
      prefix: this.config.token?.prefix,
      permissions: this.config.token?.permissions,
    });

    return plainTextKey;
  }

  /**
   * Resolve user from an API token
   */
  async resolveFromApiToken(plainToken: string): Promise<AuthUser | null> {
    const record = await ApiKeys.validate(plainToken);
    if (!record) return null;

    const user = await this.config.model.find(record.userId);
    if (user) this.currentUser = user;
    return user;
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
    const table = this.tableName(this.config.otp?.table ?? 'otp_codes', 'OTP table name');

    const row = await this.findMatchingTokenRow(
      this.query(table)
        .where('email', email)
        .where('purpose', purpose)
        .whereNull('used_at'),
      code,
      'code',
    );
    if (!row) return null;

    if (new Date(row.expires_at) < new Date()) {
      await this.query(table).where('email', email).where('purpose', purpose).delete();
      return null;
    }

    // Mark as used
    await this.query(table)
      .where('code', row.code)
      .where('email', email)
      .where('purpose', purpose)
      .update({ used_at: new Date().toISOString() });

    const user = await this.config.model
      .where(this.config.identifierColumn, email)
      .first();

    if (user) this.currentUser = user;
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

    if (session) {
      session.set('auth_user_id', user.getAttribute('id'));
      session.regenerateId();
    }

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

        // Try JWT first, then fall back to opaque API tokens. resolveFromToken()
        // returns null for malformed/non-JWT tokens, so fallback cannot live only in catch.
        try {
          user = await this.authManager.resolveFromToken(token);
        } catch {
          // JWT is not configured or failed unexpectedly. Try API token below.
        }

        if (!user) {
          try {
            user = await this.authManager.resolveFromApiToken(token);
          } catch {
            // Token table may not exist or token auth may not be configured.
          }
        }
      }
    }

    ctx.event.locals.user = user;
    ctx.event.locals.auth = this.authManager;

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
