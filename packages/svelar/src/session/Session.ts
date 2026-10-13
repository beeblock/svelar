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
import { singleton } from '../support/singleton.js';
import { isSessionActivityRequest, isSessionExpiredError, sessionActivityStatus, sessionTimingKeys, SessionExpiredError, type SessionActivityPolicy, type SessionActivityStatus } from './Activity.js';

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
  /** Atomically replace an existing, unexpired payload. False means missing or concurrently changed. */
  compareAndSwap?(id: string, expected: SessionData, data: SessionData, ttl: number): Promise<boolean>;
}

export interface SessionConfig {
  /** Session cookie name */
  cookieName?: string;
  /** Session lifetime in seconds (default: 7200 = 2 hours) */
  lifetime?: number;
  /** Idle timeout in seconds; defaults to lifetime when activity policy is enabled. */
  idleLifetime?: number;
  /** Absolute lifetime in seconds. When exceeded, the session is destroyed even if active. */
  absoluteLifetime?: number;
  /** Extend the store TTL only for real user activity instead of polling/SSE. */
  touchOnActivity?: boolean;
  /** Minimum seconds between activity touches (default: 300 = 5 minutes) */
  touchThrottle?: number;
  warningBefore?: number;
  /** Persistent login idle lifetime. Remember-me is unavailable unless explicitly configured. */
  rememberLifetime?: number;
  rememberAbsoluteLifetime?: number;
  expireOnClose?: boolean;
  /** Trusted server-side classification for relevant data loads. SSE is always excluded. */
  activity?: (ctx: MiddlewareContext) => boolean;
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

const sessions = singleton('svelar.session.instances', () => new WeakSet<object>());

export function isSession(value: unknown): value is Session {
  return typeof value === 'object' && value !== null && sessions.has(value);
}

export class Session {
  private data: SessionData = {};
  private dirty = false;
  private flashData: Record<string, any> = {};
  private previousFlashData: Record<string, any> = {};
  private invalidatedIds: string[] = [];
  private changedKeys = new Set<string>();
  private flushed = false;
  private activityPolicy?: SessionActivityPolicy;
  private renewActivity?: () => Promise<SessionActivityStatus>;
  private activityOverride?: boolean;
  private renewed = false;

  constructor(
    public readonly id: string,
    initialData?: SessionData
  ) {
    sessions.add(this);
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
    this.changedKeys.add(key);
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
    this.changedKeys.add(key);
  }

  /**
   * Clear all session data
   */
  flush(): void {
    this.data = {};
    this.dirty = true;
    this.flushed = true;
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

  getActivityStatus(): SessionActivityStatus | null {
    return this.activityPolicy ? sessionActivityStatus(this.data, this.activityPolicy) : null;
  }

  /** Explicit user intent; callers must authenticate and validate CSRF before invoking this. */
  async renew(): Promise<SessionActivityStatus> {
    if (!this.renewActivity || !this.get('auth_user_id')) throw new SessionExpiredError();
    const status = await this.renewActivity();
    this.renewed = true;
    return status;
  }

  /** Mark a trusted relevant data load, or exclude a status/polling endpoint from activity. */
  markActivity(activity = true): void { this.activityOverride = activity; }

  startAuthentication(remember = false): void {
    if (remember && !this.activityPolicy?.rememberLifetime) throw new Error('Remember-me requires a configured rememberLifetime.');
    this.set('_svelar_remember', remember);
    if (this.activityPolicy) this.adoptActivityData(this.newTimingData());
  }

  /** @internal Reset anonymous timing when leaving a longer remembered policy. */
  endAuthentication(): void { if (this.activityPolicy) this.adoptActivityData(this.newTimingData()); }

  /** @internal */
  bindActivity(policy: SessionActivityPolicy, renew: () => Promise<SessionActivityStatus>): void {
    this.activityPolicy = policy;
    this.renewActivity = renew;
  }

  /** @internal */
  activityRequested(): boolean | undefined { return this.activityOverride; }

  /** @internal */
  wasRenewed(): boolean { return this.renewed; }

  /** @internal Preserve concurrent application changes without replaying stale authentication data. */
  mergeChanges(current: SessionData): SessionData {
    const result: SessionData = this.flushed ? {} : { ...current };
    for (const key of this.changedKeys) {
      if (sessionTimingKeys.includes(key as typeof sessionTimingKeys[number])) continue;
      if (key in this.data) result[key] = this.data[key];
      else delete result[key];
    }
    if (Object.keys(this.flashData).length) result._flash = this.flashData;
    else if (this.previousFlashData && Object.keys(this.previousFlashData).length) delete result._flash;
    for (const key of sessionTimingKeys) result[key] = current[key];
    return result;
  }

  /** @internal */
  adoptActivityData(data: SessionData): void {
    for (const key of sessionTimingKeys) this.data[key] = data[key];
  }

  /** @internal */
  newTimingData(): SessionData {
    const now = Date.now();
    return { _svelar_created_at: now, _svelar_last_activity_at: now, _svelar_last_touched_at: now };
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
    if (Date.now() >= entry.expiresAt) {
      this.sessions.delete(id);
      return null;
    }
    return structuredClone(entry.data);
  }

  async write(id: string, data: SessionData, ttl: number): Promise<void> {
    this.sessions.set(id, {
      data: structuredClone(data),
      expiresAt: Date.now() + ttl * 1000,
    });
    // Register this store as the writer of this session ID
    sessionIdToStore.set(id, this);
  }

  async destroy(id: string): Promise<void> {
    this.sessions.delete(id);
    sessionIdToStore.delete(id);
  }

  async compareAndSwap(id: string, expected: SessionData, data: SessionData, ttl: number): Promise<boolean> {
    const entry = this.sessions.get(id);
    if (!entry || this.oldSessionIds.has(id) || Date.now() >= entry.expiresAt || JSON.stringify(entry.data) !== JSON.stringify(expected)) return false;
    await this.write(id, data, ttl);
    return true;
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

    if (new Date(row.expires_at) <= new Date()) {
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

  async compareAndSwap(id: string, expected: SessionData, data: SessionData, ttl: number): Promise<boolean> {
    return (await this.query().where('id', id).where('payload', JSON.stringify(expected))
      .where('expires_at', '>', new Date().toISOString())
      .update({ payload: JSON.stringify(data), expires_at: new Date(Date.now() + ttl * 1000).toISOString() })) > 0;
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
      if (new Date(entry.expiresAt) <= new Date()) {
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
    await this.withLock(id, () => this.writeUnlocked(id, data, ttl));
  }

  private async writeUnlocked(id: string, data: SessionData, ttl: number): Promise<void> {
    const entry = {
      data,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
    const temporary = `${this.filePath(id)}.${Session.generateId()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(entry), 'utf-8');
      await fs.rename(temporary, this.filePath(id));
    } finally {
      await fs.unlink(temporary).catch((error) => { if (!isNodeError(error, 'ENOENT')) throw error; });
    }
  }

  async destroy(id: string): Promise<void> {
    await this.withLock(id, async () => {
      try { await fs.unlink(this.filePath(id)); }
      catch (error) { if (!isNodeError(error, 'ENOENT')) throw error; }
    });
  }

  async compareAndSwap(id: string, expected: SessionData, data: SessionData, ttl: number): Promise<boolean> {
    return this.withLock(id, async () => {
      let raw: string;
      try { raw = await fs.readFile(this.filePath(id), 'utf-8'); }
      catch (error) { if (isNodeError(error, 'ENOENT')) return false; throw error; }
      const entry = JSON.parse(raw);
      if (new Date(entry.expiresAt) <= new Date() || JSON.stringify(entry.data) !== JSON.stringify(expected)) return false;
      await this.writeUnlocked(id, data, ttl);
      return true;
    });
  }

  private async withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    await this.ensureDir();
    const lockPath = `${this.filePath(id)}.lock`;
    for (let attempt = 0; attempt < 100; attempt++) {
      let lock;
      try { lock = await fs.open(lockPath, 'wx'); }
      catch (error) {
        if (!isNodeError(error, 'EEXIST')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }
      try { return await work(); }
      finally { await lock.close(); await fs.unlink(lockPath); }
    }
    throw new Error('Session file is locked. Refusing an unsafe concurrent write.');
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

  async compareAndSwap(id: string, expected: SessionData, data: SessionData, ttl: number): Promise<boolean> {
    const client = await this.getClient();
    const script = "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1";
    return Number(await client.eval(script, 1, this.prefix + id, JSON.stringify(expected), JSON.stringify(data), Math.max(1, Math.ceil(ttl)))) === 1;
  }

  async gc(_maxLifetime: number): Promise<void> {
    // Redis handles expiration natively via TTL — no gc needed
  }
}

// ── Session Middleware ──────────────────────────────────────

import { Middleware, type MiddlewareContext, type NextFunction } from '../middleware/Middleware.js';

export class SessionMiddleware extends Middleware {
  private config: SessionConfig & Required<Pick<SessionConfig, 'cookieName' | 'lifetime' | 'touchOnActivity' | 'touchThrottle' | 'warningBefore' | 'secret' | 'path' | 'domain' | 'secure' | 'httpOnly' | 'sameSite' | 'expireOnClose'>>;
  private policy?: SessionActivityPolicy;

  constructor(userConfig: SessionConfig) {
    super();
    const configured = Object.fromEntries(Object.entries(userConfig).filter(([, value]) => value !== undefined)) as SessionConfig;
    this.config = {
      cookieName: 'svelar_session',
      lifetime: 7200,
      absoluteLifetime: undefined,
      touchOnActivity: false,
      touchThrottle: 300,
      warningBefore: 60,
      expireOnClose: false,
      secret: '',
      path: '/',
      domain: '',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      ...configured,
    };
    if (!this.config.secret) {
      throw new Error('APP_KEY is not set. Set it in your environment or pass `secret` to createSvelarApp() — e.g. secret: process.env.APP_KEY.');
    }
    if (this.config.rememberLifetime !== undefined && !this.config.httpOnly) throw new Error('Remember-me requires an HttpOnly session cookie.');
    if (this.config.sameSite === 'none' && !this.config.secure) throw new Error('SameSite=None session cookies require Secure.');
    for (const key of ['lifetime', 'idleLifetime', 'absoluteLifetime', 'rememberLifetime', 'rememberAbsoluteLifetime', 'touchThrottle', 'warningBefore'] as const) {
      const value = this.config[key];
      if (value !== undefined && (!Number.isFinite(value) || (key === 'touchThrottle' || key === 'warningBefore' ? value < 0 : value <= 0))) {
        throw new Error(`Invalid session ${key}.`);
      }
    }
    if (userConfig.idleLifetime !== undefined || userConfig.absoluteLifetime !== undefined || userConfig.touchOnActivity || userConfig.rememberLifetime !== undefined) {
      if (!this.config.store.compareAndSwap) throw new Error('Session activity policy requires a store with compareAndSwap().');
      this.policy = {
        idleLifetime: this.config.idleLifetime ?? this.config.lifetime,
        absoluteLifetime: this.config.absoluteLifetime,
        touchThrottle: this.config.touchThrottle,
        warningBefore: this.config.warningBefore,
        rememberLifetime: this.config.rememberLifetime,
        rememberAbsoluteLifetime: this.config.rememberAbsoluteLifetime ?? this.config.absoluteLifetime ?? this.config.rememberLifetime,
      };
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
        if (sessionData && this.policy && sessionActivityStatus(sessionData, this.policy).expired) {
          ctx.event.locals.sessionExpiredReason = sessionActivityStatus(sessionData, this.policy).reason;
          await this.config.store.destroy(verified);
          sessionData = null;
          sessionId = null;
        }
        if (!sessionData) sessionId = null;
      } else {
        sessionId = null;
      }
    }

    if (!sessionId) {
      sessionId = Session.generateId();
    }

    // Create session instance
    const session = new Session(sessionId, sessionData ?? {});
    if (this.policy) {
      if (!sessionData) session.adoptActivityData(session.newTimingData());
      session.bindActivity(this.policy, () => this.persistManaged(session, true));
    }
    ctx.event.locals.session = session;
    ctx.locals.session = session;

    // Execute next middleware / handler
    const response = await next();

    for (const invalidatedId of session.consumeInvalidatedIds()) {
      await this.config.store.destroy(invalidatedId);
    }

    let cookieLifetime = this.config.lifetime;
    let wrote = session.wasRenewed();
    if (wrote) cookieLifetime = session.getActivityStatus()!.remainingSeconds;
    if (this.policy) {
      const stream = ctx.event.request.headers.get('accept')?.toLowerCase().includes('text/event-stream');
      const requested = session.activityRequested() ?? this.config.activity?.(ctx) ?? isSessionActivityRequest(ctx.event.request);
      const activity = !stream && requested && (this.config.touchOnActivity || session.activityRequested() === true)
        && (!(response instanceof Response) || response.status < 400);
      try {
        if (session.getActivityStatus()!.expired) {
          const current = sessionData && session.id === sessionId ? await this.config.store.read(session.id) : null;
          if (!current || current.auth_user_id !== session.get('auth_user_id') || sessionActivityStatus(current, this.policy).expired) {
            throw new SessionExpiredError();
          }
          session.adoptActivityData(current);
        }
        if (!sessionData || session.id !== sessionId) {
          if (session.isDirty()) {
            const status = session.getActivityStatus()!;
            if (status.expired) throw new SessionExpiredError();
            cookieLifetime = status.remainingSeconds;
            await this.config.store.write(session.id, session.toPersist(), cookieLifetime);
            wrote = true;
          }
        } else if (session.isDirty() || activity) {
          const status = await this.persistManaged(session, false, activity);
          cookieLifetime = status.remainingSeconds;
          wrote = session.isDirty() || status.lastActivityAt > Number(sessionData._svelar_last_activity_at);
        }
      } catch (error) {
        if (!isSessionExpiredError(error)) throw error;
        ctx.event.locals.user = null;
        ctx.event.locals.auth?.clearUser?.();
        const expired = Response.json({ data: null, meta: { code: 'SESSION_EXPIRED', message: error.message } }, { status: 401 });
        expired.headers.set('Cache-Control', 'no-store');
        expired.headers.append('Set-Cookie', this.buildCookieString('', 0));
        return expired;
      }
    } else if (session.isDirty()) {
      this.ensureSessionTimestamps(session, sessionData);
      await this.config.store.write(session.id, session.toPersist(), this.config.lifetime);
      wrote = true;
    }

    // Set session cookie on response
    if (response instanceof Response && (!this.policy || wrote)) {
      const signedId = this.signId(session.id);
      const persistent = session.has('_svelar_remember') ? session.get('_svelar_remember') === true : !this.config.expireOnClose;
      const cookieValue = this.buildCookieString(signedId, persistent ? cookieLifetime : undefined);
      response.headers.append('Set-Cookie', cookieValue);
    }

    return response;
  }

  private getSessionIdFromCookie(cookieHeader: string): string | null {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      const [name, ...valueParts] = cookie.split('=');
      if (name === this.config.cookieName) {
        try { return decodeURIComponent(valueParts.join('=')); }
        catch { return null; }
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

  private buildCookieString(value: string, lifetime?: number): string {
    const parts = [`${this.config.cookieName}=${encodeURIComponent(value)}`];
    parts.push(`Path=${this.config.path}`);
    if (lifetime !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(lifetime))}`);
    if (this.config.domain) parts.push(`Domain=${this.config.domain}`);
    if (this.config.secure) parts.push('Secure');
    if (this.config.httpOnly) parts.push('HttpOnly');
    parts.push(`SameSite=${this.config.sameSite}`);
    return parts.join('; ');
  }

  private ensureSessionTimestamps(session: Session, existingData: SessionData | null): void {
    if (existingData) return;
    const now = Date.now();
    session.set('_svelar_created_at', now);
    session.set('_svelar_last_activity_at', now);
    session.set('_svelar_last_touched_at', now);
  }

  private async persistManaged(session: Session, renew: boolean, activity = false): Promise<SessionActivityStatus> {
    const policy = this.policy!;
    for (let attempt = 0; attempt < 16; attempt++) {
      const current = await this.config.store.read(session.id);
      if (!current) throw new SessionExpiredError();
      const now = Date.now();
      const status = sessionActivityStatus(current, policy, now);
      if (status.expired) { await this.config.store.destroy(session.id); throw new SessionExpiredError(); }
      if (current.auth_user_id !== session.get('auth_user_id')) throw new SessionExpiredError();
      const throttle = Math.min(policy.touchThrottle, (status.remembered ? policy.rememberLifetime ?? policy.idleLifetime : policy.idleLifetime) / 2);
      const touch = (renew && status.lastActivityAt < now) || (activity && now - Number(current._svelar_last_touched_at ?? current._svelar_last_activity_at) >= throttle * 1000);
      if (!session.isDirty() && !touch) { session.adoptActivityData(current); return status; }
      const data = session.mergeChanges(current);
      if (touch) { data._svelar_last_activity_at = now; data._svelar_last_touched_at = now; }
      const next = sessionActivityStatus(data, policy, now);
      if (next.expired) throw new SessionExpiredError();
      if (await this.config.store.compareAndSwap!(session.id, current, data, next.remainingSeconds)) {
        session.adoptActivityData(data);
        const committed = sessionActivityStatus(data, policy);
        if (committed.expired) { await this.config.store.destroy(session.id); throw new SessionExpiredError(); }
        return committed;
      }
    }
    throw new Error('Concurrent session update could not be persisted safely.');
  }
}
