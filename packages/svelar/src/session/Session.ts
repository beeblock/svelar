/**
 * Svelar Session Manager
 *
 * Server-side session management with pluggable stores.
 * Supports cookie-based sessions with in-memory, file, or database backing stores.
 *
 * @example
 * ```ts
 * // In hooks.server.ts
 * import { SessionMiddleware, MemorySessionStore } from '@beeblock/svelar/session';
 *
 * export const handle = createSvelarHooks({
 *   middleware: [
 *     new SessionMiddleware({ store: new MemorySessionStore() }),
 *   ],
 * });
 *
 * // In a controller or +server.ts
 * event.locals.session.get('user_id');
 * event.locals.session.set('flash_message', 'Login successful');
 * ```
 */

import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === code;
}

// ── Types ──────────────────────────────────────────────────

export interface SessionData {
  [key: string]: any;
}

export interface SessionStore {
  /** Read session data by ID */
  read(id: string): Promise<SessionData | null>;
  /** Write session data */
  write(id: string, data: SessionData, ttl: number): Promise<void>;
  /** Destroy a session */
  destroy(id: string): Promise<void>;
  /** Garbage collect expired sessions */
  gc?(maxLifetime: number): Promise<void>;
}

export interface SessionConfig {
  /** Session cookie name */
  cookieName?: string;
  /** Session lifetime in seconds (default: 7200 = 2 hours) */
  lifetime?: number;
  /** Secret for signing session IDs */
  secret?: string;
  /** Cookie path */
  path?: string;
  /** Cookie domain */
  domain?: string;
  /** Secure cookie (HTTPS only) */
  secure?: boolean;
  /** HttpOnly cookie */
  httpOnly?: boolean;
  /** SameSite policy */
  sameSite?: 'strict' | 'lax' | 'none';
  /** Session store implementation */
  store: SessionStore;
}

// ── Session Instance ───────────────────────────────────────

export class Session {
  private data: SessionData = {};
  private dirty = false;
  private flashData: Record<string, any> = {};
  private previousFlashData: Record<string, any> = {};
  private invalidatedIds: string[] = [];

  constructor(
    public readonly id: string,
    initialData?: SessionData
  ) {
    if (initialData) {
      this.data = { ...initialData };
      // Separate flash data
      if (this.data._flash) {
        this.previousFlashData = this.data._flash;
        delete this.data._flash;
      }
    }
  }

  /**
   * Get a session value
   */
  get<T = any>(key: string, defaultValue?: T): T {
    // Check current flash data first
    if (key in this.flashData) {
      return this.flashData[key] as T;
    }
    // Check previous flash data
    if (key in this.previousFlashData) {
      return this.previousFlashData[key] as T;
    }
    // Check regular data
    if (key in this.data) {
      return this.data[key] as T;
    }
    return defaultValue as T;
  }

  /**
   * Set a session value
   */
  set(key: string, value: any): void {
    this.data[key] = value;
    this.dirty = true;
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    return key in this.data || key in this.flashData || key in this.previousFlashData;
  }

  /**
   * Remove a session value
   */
  forget(key: string): void {
    delete this.data[key];
    this.dirty = true;
  }

  /**
   * Clear all session data
   */
  flush(): void {
    this.data = {};
    this.dirty = true;
  }

  /**
   * Flash data — available only on the next request
   */
  flash(key: string, value: any): void {
    this.flashData[key] = value;
    this.dirty = true;
  }

  /**
   * Get all session data
   */
  all(): SessionData {
    return { ...this.data, ...this.previousFlashData, ...this.flashData };
  }

  /**
   * Check if session has been modified
   */
  isDirty(): boolean {
    return this.dirty || Object.keys(this.flashData).length > 0;
  }

  /**
   * Get data to persist (including flash for next request)
   * @internal
   */
  toPersist(): SessionData {
    const data = { ...this.data };
    if (Object.keys(this.flashData).length > 0) {
      data._flash = this.flashData;
    }
    return data;
  }

  /**
   * Regenerate session ID (prevents session fixation)
   * @internal Returns new ID
   */
  regenerateId(): string {
    const oldId = this.id;
    const newId = Session.generateId();
    (this as any).id = newId;
    this.dirty = true;
    this.invalidatedIds.push(oldId);

    // Mark old session ID as invalid in any stores that wrote it
    const store = sessionIdToStore.get(oldId);
    if (store instanceof MemorySessionStore) {
      store.markOldSessionId(oldId);
    }
    sessionIdToStore.delete(oldId);

    return newId;
  }

  /**
   * Return and clear IDs invalidated during this request.
   * @internal
   */
  consumeInvalidatedIds(): string[] {
    const ids = this.invalidatedIds;
    this.invalidatedIds = [];
    return ids;
  }

  static generateId(): string {
    return randomBytes(32).toString('hex');
  }
}

// ── Memory Store ───────────────────────────────────────────

// Global registry to track which store wrote which session ID
const sessionIdToStore = new Map<string, MemorySessionStore>();

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, { data: SessionData; expiresAt: number }>();
  private oldSessionIds = new Set<string>();

  async read(id: string): Promise<SessionData | null> {
    // Return null if this is an old/regenerated session ID
    if (this.oldSessionIds.has(id)) {
      return null;
    }
    const entry = this.sessions.get(id);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(id);
      return null;
    }
    return entry.data;
  }

  async write(id: string, data: SessionData, ttl: number): Promise<void> {
    this.sessions.set(id, {
      data,
      expiresAt: Date.now() + ttl * 1000,
    });
    // Register this store as the writer of this session ID
    sessionIdToStore.set(id, this);
  }

  async destroy(id: string): Promise<void> {
    this.sessions.delete(id);
    sessionIdToStore.delete(id);
  }

  async gc(maxLifetime: number): Promise<void> {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now > entry.expiresAt) {
        this.sessions.delete(id);
        sessionIdToStore.delete(id);
      }
    }
  }

  /**
   * Mark a session ID as old/invalidated (used when a session is regenerated)
   * @internal
   */
  markOldSessionId(id: string): void {
    this.oldSessionIds.add(id);
    this.sessions.delete(id);
  }
}

// ── Database Store ─────────────────────────────────────────

export class DatabaseSessionStore implements SessionStore {
  constructor(
    private tableName: string = 'sessions',
    private connectionName?: string
  ) {
    this.tableName = assertSqlIdentifier(tableName, 'Sessions table name');
  }

  private query(): QueryBuilder<any> {
    return new QueryBuilder(this.tableName, undefined, this.connectionName);
  }

  async read(id: string): Promise<SessionData | null> {
    const row = await this.query().select('payload', 'expires_at').where('id', id).first();
    if (!row) return null;

    if (new Date(row.expires_at) < new Date()) {
      await this.destroy(id);
      return null;
    }

    try {
      return JSON.parse(row.payload);
    } catch {
      await this.destroy(id);
      return null;
    }
  }

  async write(id: string, data: SessionData, ttl: number): Promise<void> {
    const payload = JSON.stringify(data);
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    await this.query().upsert(
      { id, payload, expires_at: expiresAt },
      'id',
      ['payload', 'expires_at'],
    );
  }

  async destroy(id: string): Promise<void> {
    await this.query().where('id', id).delete();
  }

  async gc(maxLifetime: number): Promise<void> {
    await this.query().where('expires_at', '<', new Date().toISOString()).delete();
  }
}

// ── File Store ──────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export class FileSessionStore implements SessionStore {
  private dir: string;

  constructor(directory?: string) {
    this.dir = directory ?? join(process.cwd(), 'storage', 'sessions');
  }

  private filePath(id: string): string {
    // Sanitize ID to prevent directory traversal
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
    return join(this.dir, `${safeId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async read(id: string): Promise<SessionData | null> {
    try {
      const raw = await fs.readFile(this.filePath(id), 'utf-8');
      const entry = JSON.parse(raw);
      if (new Date(entry.expiresAt) < new Date()) {
        await this.destroy(id);
        return null;
      }
      return entry.data;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null;
      if (error instanceof SyntaxError) {
        await this.destroy(id);
        return null;
      }
      throw error;
    }
  }

  async write(id: string, data: SessionData, ttl: number): Promise<void> {
    await this.ensureDir();
    const entry = {
      data,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
    await fs.writeFile(this.filePath(id), JSON.stringify(entry), 'utf-8');
  }

  async destroy(id: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(id));
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error;
    }
  }

  async gc(_maxLifetime: number): Promise<void> {
    try {
      const files = await fs.readdir(this.dir);
      const now = new Date();
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(join(this.dir, file), 'utf-8');
          const entry = JSON.parse(raw);
          if (new Date(entry.expiresAt) < now) {
            await fs.unlink(join(this.dir, file));
          }
        } catch (error) {
          if (isNodeError(error, 'ENOENT')) continue;
          if (!(error instanceof SyntaxError)) throw error;
          try {
            await fs.unlink(join(this.dir, file));
          } catch (unlinkError) {
            if (!isNodeError(unlinkError, 'ENOENT')) throw unlinkError;
          }
        }
      }
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error;
    }
  }
}

// ── Redis Store ─────────────────────────────────────────────

export class RedisSessionStore implements SessionStore {
  private redis: any;
  private prefix: string;

  constructor(options?: { client?: any; prefix?: string; url?: string }) {
    this.prefix = options?.prefix ?? 'svelar_session:';

    if (options?.client) {
      this.redis = options.client;
    } else {
      // Lazy-connect: store config and connect on first use
      this._url = options?.url;
    }
  }

  private _url?: string;
  private _connecting?: Promise<any>;

  private async getClient(): Promise<any> {
    if (this.redis) return this.redis;

    if (!this._connecting) {
      this._connecting = (async () => {
        try {
          const { default: Redis } = await import('ioredis' as string);
          this.redis = this._url ? new Redis(this._url) : new Redis();
          return this.redis;
        } catch {
          throw new Error(
            'RedisSessionStore requires "ioredis" package. Install it: npm install ioredis'
          );
        }
      })();
    }

    return this._connecting;
  }

  async read(id: string): Promise<SessionData | null> {
    const client = await this.getClient();
    const raw = await client.get(this.prefix + id);
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      await client.del(this.prefix + id);
      return null;
    }
  }

  async write(id: string, data: SessionData, ttl: number): Promise<void> {
    const client = await this.getClient();
    await client.set(this.prefix + id, JSON.stringify(data), 'EX', ttl);
  }

  async destroy(id: string): Promise<void> {
    const client = await this.getClient();
    await client.del(this.prefix + id);
  }

  async gc(_maxLifetime: number): Promise<void> {
    // Redis handles expiration natively via TTL — no gc needed
  }
}

// ── Session Middleware ──────────────────────────────────────

import { Middleware, type MiddlewareContext, type NextFunction } from '../middleware/Middleware.js';

export class SessionMiddleware extends Middleware {
  private config: Required<Omit<SessionConfig, 'store'>> & { store: SessionStore };

  constructor(userConfig: SessionConfig) {
    super();
    this.config = {
      cookieName: 'svelar_session',
      lifetime: 7200,
      secret: '',
      path: '/',
      domain: '',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      ...userConfig,
    };
    if (!this.config.secret) {
      throw new Error('APP_KEY is not set. Set it in your environment or pass `secret` to createSvelarApp() — e.g. secret: process.env.APP_KEY.');
    }
  }

  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    // Read session ID from cookie
    const cookieHeader = ctx.event.request.headers.get('cookie') ?? '';
    let sessionId = this.getSessionIdFromCookie(cookieHeader);
    let sessionData: SessionData | null = null;

    if (sessionId) {
      // Verify signature
      const verified = this.verifySignedId(sessionId);
      if (verified) {
        sessionData = await this.config.store.read(verified);
        sessionId = verified;
      } else {
        sessionId = null;
      }
    }

    if (!sessionId) {
      sessionId = Session.generateId();
    }

    // Create session instance
    const session = new Session(sessionId, sessionData ?? {});
    ctx.event.locals.session = session;
    ctx.locals.session = session;

    // Execute next middleware / handler
    const response = await next();

    for (const invalidatedId of session.consumeInvalidatedIds()) {
      await this.config.store.destroy(invalidatedId);
    }

    // Persist session if modified
    if (session.isDirty()) {
      await this.config.store.write(session.id, session.toPersist(), this.config.lifetime);
    }

    // Set session cookie on response
    if (response instanceof Response) {
      const signedId = this.signId(session.id);
      const cookieValue = this.buildCookieString(signedId);
      response.headers.append('Set-Cookie', cookieValue);
    }

    return response;
  }

  private getSessionIdFromCookie(cookieHeader: string): string | null {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      const [name, ...valueParts] = cookie.split('=');
      if (name === this.config.cookieName) {
        return decodeURIComponent(valueParts.join('='));
      }
    }
    return null;
  }

  private signId(id: string): string {
    const sig = createHmac('sha256', this.config.secret).update(id).digest('base64url');
    return `${id}.${sig}`;
  }

  private verifySignedId(signedId: string): string | null {
    const dotIndex = signedId.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const id = signedId.slice(0, dotIndex);
    const sig = signedId.slice(dotIndex + 1);

    const expected = createHmac('sha256', this.config.secret).update(id).digest('base64url');

    if (sig.length !== expected.length) return null;

    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;

    try {
      if (timingSafeEqual(a, b)) return id;
    } catch {
      // Different lengths
    }
    return null;
  }

  private buildCookieString(value: string): string {
    const parts = [`${this.config.cookieName}=${encodeURIComponent(value)}`];
    parts.push(`Path=${this.config.path}`);
    parts.push(`Max-Age=${this.config.lifetime}`);
    if (this.config.domain) parts.push(`Domain=${this.config.domain}`);
    if (this.config.secure) parts.push('Secure');
    if (this.config.httpOnly) parts.push('HttpOnly');
    parts.push(`SameSite=${this.config.sameSite}`);
    return parts.join('; ');
  }
}
