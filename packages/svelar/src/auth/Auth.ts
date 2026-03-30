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

      const { Connection } = await import('../database/Connection.js');
      const table = jwt.refreshTable ?? 'refresh_tokens';

      await Connection.raw(
        `INSERT INTO ${table} (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)`,
        [user.getAttribute('id'), hashedRefresh, refreshExpiresAt.toISOString(), new Date().toISOString()]
      );

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
    const { Connection } = await import('../database/Connection.js');
    const table = jwt.refreshTable ?? 'refresh_tokens';

    // Find the refresh token
    const rows = await Connection.raw(
      `SELECT user_id, expires_at, revoked_at FROM ${table} WHERE token = ?`,
      [hashedRefresh]
    );

    if (rows.length === 0) return null;

    const row = rows[0];

    // Check if revoked
    if (row.revoked_at) return null;

    // Check if expired
    if (new Date(row.expires_at) < new Date()) return null;

    // Revoke the old refresh token (rotation — each token is single-use)
    await Connection.raw(
      `UPDATE ${table} SET revoked_at = ? WHERE token = ?`,
      [new Date().toISOString(), hashedRefresh]
    );

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

    const { Connection } = await import('../database/Connection.js');
    const table = this.config.jwt.refreshTable ?? 'refresh_tokens';

    await Connection.raw(
      `UPDATE ${table} SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
      [new Date().toISOString(), userId]
    );
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

  // ── Password Reset ──────────────────────────────────────

  /**
   * Send a password reset email.
   * Generates a token, stores its hash, and sends the password-reset email template.
   * Auto-creates the password_resets table if it doesn't exist.
   */
  async sendPasswordReset(email: string): Promise<boolean> {
    const user = await this.config.model
      .where(this.config.identifierColumn, email)
      .first();

    if (!user) return false; // Don't reveal if user exists

    const { Connection } = await import('../database/Connection.js');
    const table = this.config.passwordResets?.table ?? 'password_resets';
    const expiresIn = this.config.passwordResets?.expiresIn ?? 3600;

    await this.ensureTable(table, `
      CREATE TABLE IF NOT EXISTS ${table} (
        email TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    // Delete any existing reset tokens for this email
    await Connection.raw(`DELETE FROM ${table} WHERE email = ?`, [email]);

    // Generate token
    const token = randomBytes(32).toString('base64url');
    const hashedToken = this.hashToken(token);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await Connection.raw(
      `INSERT INTO ${table} (email, token, expires_at, created_at) VALUES (?, ?, ?, ?)`,
      [email, hashedToken, expiresAt, new Date().toISOString()]
    );

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
    const { Connection } = await import('../database/Connection.js');
    const { Hash } = await import('../hashing/Hash.js');
    const table = this.config.passwordResets?.table ?? 'password_resets';

    const hashedToken = this.hashToken(token);

    const rows = await Connection.raw(
      `SELECT email, expires_at FROM ${table} WHERE token = ? AND email = ?`,
      [hashedToken, email]
    );

    if (rows.length === 0) return false;

    const row = rows[0];

    // Check if expired
    if (new Date(row.expires_at) < new Date()) {
      await Connection.raw(`DELETE FROM ${table} WHERE email = ?`, [email]);
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
    await Connection.raw(`DELETE FROM ${table} WHERE email = ?`, [email]);

    // Revoke all refresh tokens
    await this.revokeRefreshTokens(user.getAttribute('id'));

    return true;
  }

  // ── Email Verification ──────────────────────────────────

  /**
   * Send an email verification link.
   * Generates a token, stores its hash, and sends the email-verification template.
   * Auto-creates the email_verifications table if it doesn't exist.
   */
  async sendVerificationEmail(user: AuthUser): Promise<void> {
    const { Connection } = await import('../database/Connection.js');
    const table = this.config.emailVerification?.table ?? 'email_verifications';
    const expiresIn = this.config.emailVerification?.expiresIn ?? 86400;
    const email = user.getAttribute(this.config.identifierColumn);

    await this.ensureTable(table, `
      CREATE TABLE IF NOT EXISTS ${table} (
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    // Delete existing tokens for this user
    await Connection.raw(`DELETE FROM ${table} WHERE user_id = ?`, [user.getAttribute('id')]);

    const token = randomBytes(32).toString('base64url');
    const hashedToken = this.hashToken(token);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await Connection.raw(
      `INSERT INTO ${table} (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)`,
      [user.getAttribute('id'), hashedToken, expiresAt, new Date().toISOString()]
    );

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
    const { Connection } = await import('../database/Connection.js');
    const table = this.config.emailVerification?.table ?? 'email_verifications';
    const verifiedColumn = this.config.emailVerification?.verifiedColumn ?? 'email_verified_at';

    const hashedToken = this.hashToken(token);

    const rows = await Connection.raw(
      `SELECT user_id, expires_at FROM ${table} WHERE token = ? AND user_id = ?`,
      [hashedToken, userId]
    );

    if (rows.length === 0) return false;

    if (new Date(rows[0].expires_at) < new Date()) {
      await Connection.raw(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
      return false;
    }

    // Mark email as verified
    await this.config.model
      .where('id', userId)
      .update({ [verifiedColumn]: new Date().toISOString() });

    // Delete all verification tokens for this user
    await Connection.raw(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);

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
   * Auto-creates the otp_codes table if it doesn't exist.
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

    const { Connection } = await import('../database/Connection.js');
    const table = this.config.otp?.table ?? 'otp_codes';
    const expiresIn = this.config.otp?.expiresIn ?? 600;
    const length = this.config.otp?.length ?? 6;

    await this.ensureTable(table, `
      CREATE TABLE IF NOT EXISTS ${table} (
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'login',
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      )
    `);

    // Delete expired/used codes for this email+purpose
    await Connection.raw(
      `DELETE FROM ${table} WHERE email = ? AND purpose = ?`,
      [email, purpose]
    );

    // Generate numeric code
    const code = this.generateOtpCode(length);
    const hashedCode = this.hashToken(code);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await Connection.raw(
      `INSERT INTO ${table} (email, code, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
      [email, hashedCode, purpose, expiresAt, new Date().toISOString()]
    );

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
    const { Connection } = await import('../database/Connection.js');
    const table = this.config.otp?.table ?? 'otp_codes';

    const hashedCode = this.hashToken(code);

    const rows = await Connection.raw(
      `SELECT email, expires_at, used_at FROM ${table} WHERE code = ? AND email = ? AND purpose = ? AND used_at IS NULL`,
      [hashedCode, email, purpose]
    );

    if (rows.length === 0) return null;

    if (new Date(rows[0].expires_at) < new Date()) {
      await Connection.raw(
        `DELETE FROM ${table} WHERE email = ? AND purpose = ?`,
        [email, purpose]
      );
      return null;
    }

    // Mark as used
    await Connection.raw(
      `UPDATE ${table} SET used_at = ? WHERE code = ? AND email = ? AND purpose = ?`,
      [new Date().toISOString(), hashedCode, email, purpose]
    );

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
    const { Connection } = await import('../database/Connection.js');
    const now = new Date().toISOString();
    let passwordResets = 0;
    let verifications = 0;
    let otpCodes = 0;

    const prTable = this.config.passwordResets?.table ?? 'password_resets';
    const evTable = this.config.emailVerification?.table ?? 'email_verifications';
    const otpTable = this.config.otp?.table ?? 'otp_codes';

    try {
      const pr = await Connection.raw(`DELETE FROM ${prTable} WHERE expires_at < ?`, [now]);
      passwordResets = pr?.changes ?? 0;
    } catch { /* table may not exist */ }

    try {
      const ev = await Connection.raw(`DELETE FROM ${evTable} WHERE expires_at < ?`, [now]);
      verifications = ev?.changes ?? 0;
    } catch { /* table may not exist */ }

    try {
      const otp = await Connection.raw(`DELETE FROM ${otpTable} WHERE expires_at < ? OR used_at IS NOT NULL`, [now]);
      otpCodes = otp?.changes ?? 0;
    } catch { /* table may not exist */ }

    return { passwordResets, verifications, otpCodes };
  }

  // ── Private Helpers ─────────────────────────────────────

  private hashToken(token: string): string {
    const secret = this.config.jwt?.secret ?? process.env.APP_KEY ?? 'svelar-change-me';
    return createHmac('sha256', secret).update(token).digest('hex');
  }

  private generateOtpCode(length: number): string {
    const digits = randomBytes(length);
    return Array.from(digits).map(b => (b % 10).toString()).join('');
  }

  private tablesEnsured = new Set<string>();

  private async ensureTable(table: string, sql: string): Promise<void> {
    if (this.tablesEnsured.has(table)) return;
    const { Connection } = await import('../database/Connection.js');
    await Connection.raw(sql);
    this.tablesEnsured.add(table);
  }

  private async sendAuthEmail(templateName: string, to: string, vars: Record<string, any>): Promise<void> {
    try {
      const { EmailTemplates } = await import('../email-templates/index.js');
      const { Mailer } = await import('../mail/index.js');

      const rendered = await EmailTemplates.render(templateName, vars);
      await Mailer.send({
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    } catch (err: any) {
      // Log but don't throw — the token is still created, user can request again
      console.error(`[Auth] Failed to send ${templateName} email to ${to}:`, err.message);
    }
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
 * import { guardAuth } from 'svelar/auth';
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
 * import { guardAuth } from 'svelar/auth';
 * export const load = guardAuth();
 *
 * // src/routes/admin/+layout.server.ts — custom redirect
 * import { guardAuth } from 'svelar/auth';
 * export const load = guardAuth('/login');
 *
 * // With role check
 * import { guardAuth } from 'svelar/auth';
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
