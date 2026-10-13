import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeys } from '../src/api-keys/index.js';
import { Audit } from '../src/audit/index.js';
import { AuthenticateMiddleware, AuthManager, signJwt, verifyJwt, type AuthAuditEvent, type AuthConfig } from '../src/auth/Auth.js';
import { Connection } from '../src/database/Connection.js';
import { Schema, type TableBuilder } from '../src/database/SchemaBuilder.js';
import { EmailTemplates } from '../src/email-templates/index.js';
import { Hash } from '../src/hashing/Hash.js';
import { Mailer } from '../src/mail/index.js';
import type { MiddlewareContext } from '../src/middleware/Middleware.js';
import { HasUlids, HasUuids, Model } from '../src/orm/index.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { ApplicationContext } from '../src/support/Context.js';
import { isUlid, isUuidv7 } from '../src/support/uuid.js';

const secret = 'fixture-only-auth-primary-key-secret';
const credentials = { email: 'primary@example.test', password: 'fixture-password' };
const customKey = 'account/+?&id=other#% identity';
const invalidIdentities: unknown[] = [undefined, null, '', '   ', false, {}, [], NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1];

class IntegerAccount extends Model {
  static table = 'auth_pk_integer_accounts';
  static timestamps = false;
  static fillable = ['id', 'user_uuid', 'user_ulid', 'account_number', 'account_key', 'email', 'name', 'password', 'disabled', 'locked', 'email_verified_at'];
  static casts = { disabled: 'boolean', locked: 'boolean' } as const;
}

class UuidAccount extends HasUuids(IntegerAccount) {
  static table = 'auth_pk_uuid_accounts';
  static primaryKey = 'user_uuid';
  static uniqueIds = ['user_uuid'];
}

class UlidAccount extends HasUlids(IntegerAccount) {
  static table = 'auth_pk_ulid_accounts';
  static primaryKey = 'user_ulid';
  static uniqueIds = ['user_ulid'];
}

class CustomAccount extends IntegerAccount {
  static table = 'auth_pk_custom_accounts';
  static primaryKey = 'account_key';
  static incrementing = false;
}

class NamedIntegerAccount extends IntegerAccount {
  static table = 'auth_pk_named_integer_accounts';
  static primaryKey = 'account_number';
}

const fixtures = [
  { label: 'integer id', Account: IntegerAccount, kind: 'integer' },
  { label: 'UUIDv7 user_uuid', Account: UuidAccount, kind: 'uuid' },
  { label: 'ULID user_ulid', Account: UlidAccount, kind: 'ulid' },
  { label: 'custom string account_key', Account: CustomAccount, kind: 'string' },
  { label: 'integer account_number', Account: NamedIntegerAccount, kind: 'integer' },
] as const;

function identityColumn(table: TableBuilder, name: string, kind: typeof fixtures[number]['kind']) {
  if (kind === 'integer') return table.integer(name);
  if (kind === 'uuid') return table.uuid(name);
  if (kind === 'ulid') return table.ulid(name);
  return table.string(name);
}

function sessionFor(id?: unknown) {
  const data = new Map<string, unknown>();
  if (id !== undefined) data.set('auth_user_id', id);
  return {
    get: vi.fn((key: string) => data.get(key)),
    set: vi.fn((key: string, value: unknown) => { data.set(key, value); }),
    forget: vi.fn((key: string) => { data.delete(key); }),
    startAuthentication: vi.fn(), endAuthentication: vi.fn(), regenerateId: vi.fn(),
  };
}

describe.each(fixtures)('Auth primary keys on real SQLite: $label', ({ Account, kind }) => {
  const tables = {
    refresh: `${Account.table}_refresh`, resets: `${Account.table}_resets`,
    verification: `${Account.table}_verification`, otp: `${Account.table}_otp`, api: `${Account.table}_api`,
  };
  let account: Model;
  let other: Model;
  let userId: string | number;
  let otherId: string | number;
  let audit: AuthAuditEvent[];

  function manager(overrides: Partial<AuthConfig> = {}) {
    return new AuthManager({ guard: 'session', model: Account, appUrl: 'https://auth.example.test',
      jwt: { secret, refreshTokens: true, refreshTable: tables.refresh },
      passwordResets: { table: tables.resets }, emailVerification: { table: tables.verification }, otp: { table: tables.otp },
      eligibility: { disabledColumn: 'disabled', lockedColumn: 'locked', requireVerifiedEmail: true },
      audit: { record: (event) => { audit.push(event); } }, ...overrides,
    });
  }

  function attributes(email: string, key = customKey) {
    return { email, name: 'Persisted account', disabled: false, locked: false, email_verified_at: new Date().toISOString(),
      ...(kind === 'string' ? { account_key: key } : {}),
      ...(Account.primaryKey !== 'id' ? { id: 'untrusted-shadow-id' } : {}) };
  }

  function query(table: string) { return new QueryBuilder(table); }

  async function fresh(id: string | number = userId) {
    const user = await Account.find(id);
    if (!user) throw new Error('Expected persisted account');
    return user;
  }

  function renderedVars(template: string) {
    const call = [...vi.mocked(EmailTemplates.render).mock.calls].reverse().find(([name]) => name === template);
    if (!call) throw new Error(`Expected ${template} email`);
    return call[1];
  }

  async function middleware(auth: AuthManager, session?: ReturnType<typeof sessionFor>, token?: string) {
    const ctx: MiddlewareContext = { params: {}, locals: {}, event: {
      request: new Request('https://auth.example.test/private', { headers: token ? { authorization: `Bearer ${token}` } : {} }),
      locals: { session }, getClientAddress: () => '192.0.2.1',
    } };
    const next = vi.fn(async () => {
      expect(ApplicationContext.get('userId')).toBe(userId);
      expect(String(ApplicationContext.get('actorId'))).toBe(String(userId));
      return new Response('ok');
    });
    await ApplicationContext.runIsolated({}, async () => {
      const response = await new AuthenticateMiddleware(auth).handle(ctx, next);
      expect(response?.status).toBe(200);
    });
    expect(next).toHaveBeenCalledOnce();
    expect(ctx.locals.auth.id()).toBe(userId);
    expect(ctx.event.locals.authenticatedVia).toBe(token ? 'bearer' : 'session');
    expect(ctx.event.locals.user.getAttribute(Account.primaryKey)).toBe(userId);
    expect(auth.check()).toBe(false);
  }

  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    ApplicationContext.clear();
    Hash.configure({ driver: 'scrypt', scryptCost: 1024 });
    Audit.configure({ driver: 'memory', enabled: true, exclude: [], redact: [], ignore: [] });
    EmailTemplates.configure({ driver: 'memory' });
    EmailTemplates.registerDefaults();
    Mailer.configure({ default: 'null', mailers: { null: { driver: 'null' } } });
    vi.spyOn(EmailTemplates, 'render');
    vi.spyOn(Mailer, 'send');
    audit = [];

    // These isolated app-owned schemas match the host key, not the core integer-user migrations.
    const schema = new Schema();
    await schema.createTable(Account.table, (table) => {
      if (kind === 'integer') table.increments(Account.primaryKey);
      else identityColumn(table, Account.primaryKey, kind).primary();
      if (Account.primaryKey !== 'id') table.string('id');
      table.string('email').unique(); table.string('name'); table.string('password');
      table.boolean('disabled'); table.boolean('locked'); table.timestamp('email_verified_at').nullable();
    });
    await schema.createTable(tables.refresh, (table) => {
      table.increments('id');
      identityColumn(table, 'user_id', kind).nullable().references(Account.primaryKey, Account.table);
      table.string('token').unique(); table.timestamp('expires_at'); table.timestamp('created_at'); table.timestamp('revoked_at').nullable();
    });
    await schema.createTable(tables.verification, (table) => {
      table.increments('id');
      identityColumn(table, 'user_id', kind).references(Account.primaryKey, Account.table);
      table.string('token'); table.timestamp('expires_at'); table.timestamp('created_at');
    });
    await schema.createTable(tables.resets, (table) => {
      table.increments('id'); table.string('email'); table.string('token'); table.timestamp('expires_at'); table.timestamp('created_at');
    });
    await schema.createTable(tables.otp, (table) => {
      table.increments('id'); table.string('email'); table.string('code'); table.string('purpose');
      table.timestamp('expires_at'); table.timestamp('created_at'); table.timestamp('used_at').nullable();
    });
    await schema.createTable(tables.api, (table) => {
      table.string('id').primary();
      identityColumn(table, 'user_id', kind).references(Account.primaryKey, Account.table);
      for (const name of ['team_id', 'actor_type', 'actor_id', 'service_account_id', 'last_used_ip', 'rotation_id']) table.string(name).nullable();
      table.string('name'); table.string('key').unique(); table.string('prefix');
      for (const name of ['permissions', 'allowed_ips', 'rate_limit', 'metadata']) table.text(name).nullable();
      for (const name of ['last_used_at', 'expires_at', 'revoked_at', 'disabled_at', 'rotated_at', 'overlap_until']) table.bigInteger(name).nullable();
      table.bigInteger('created_at');
    });
    ApiKeys.configure({ driver: 'database', table: tables.api });

    const password = await Hash.make(credentials.password);
    account = await Account.create({ ...attributes(credentials.email), password });
    other = await Account.create({ ...attributes('other@example.test', 'other-account'), password });
    userId = account.getAttribute(Account.primaryKey);
    otherId = other.getAttribute(Account.primaryKey);
    if (Account.primaryKey !== 'id') await account.update({ id: String(otherId) });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    ApiKeys.configure({ driver: 'memory' });
    Audit.configure({ driver: 'memory' });
    Hash.configure({ driver: 'scrypt', scryptCost: 16384 });
    EmailTemplates.configure({ driver: 'memory' });
    EmailTemplates.registerDefaults();
    Mailer.configure({ default: 'null', mailers: { null: { driver: 'null' } } });
    ApplicationContext.clear();
    await Connection.disconnect();
  });

  it('registers and authenticates the actual host key, including remembered sessions and audit subjects', async () => {
    if (kind === 'uuid') expect(isUuidv7(String(userId))).toBe(true);
    if (kind === 'ulid') expect(isUlid(String(userId))).toBe(true);
    const auth = manager();
    const session = sessionFor();
    expect((await auth.attempt(credentials, session, { remember: true }))?.getAttribute(Account.primaryKey)).toBe(userId);
    expect(session.set).toHaveBeenCalledWith('auth_user_id', userId);
    expect(session.startAuthentication).toHaveBeenCalledWith(true);
    expect(session.regenerateId).toHaveBeenCalledOnce();
    expect(auth.id()).toBe(userId);
    expect(await auth.resolveFromSession(session)).not.toBeNull();
    expect(audit).toEqual([expect.objectContaining({ action: 'auth.login', outcome: 'allowed', subjectId: userId })]);
    await auth.logout(session);
    expect(auth.id()).toBeNull();
    expect(session.get('auth_user_id')).toBeUndefined();
    expect(audit.at(-1)).toMatchObject({ action: 'auth.logout', subjectId: userId });

    const registered = await auth.register({ ...attributes('new@example.test', 'new-account'), password: credentials.password });
    const registeredId = registered.getAttribute(Account.primaryKey);
    expect(auth.id()).toBe(registeredId);
    expect((await fresh(registeredId)).getAttribute('email')).toBe('new@example.test');
    if (kind === 'uuid') expect(isUuidv7(registeredId)).toBe(true);
    if (kind === 'ulid') expect(isUlid(registeredId)).toBe(true);
  });

  it('uses the configured model key, not a caller constructor or a shadow id, for fresh federation and API keys', async () => {
    const stale = await fresh();
    class CallerAccount extends IntegerAccount { static primaryKey = 'caller_controlled_key'; }
    const caller = new CallerAccount(stale.toJSON());
    caller.setAttribute('caller_controlled_key', otherId);
    caller.setAttribute('name', 'Untrusted caller name');
    const auth = manager();
    const session = sessionFor();
    expect((await auth.login(caller, session))?.getAttribute('name')).toBe('Persisted account');
    expect(session.get('auth_user_id')).toBe(userId);
    expect(auth.id()).toBe(userId);
    expect(audit.at(-1)).toMatchObject({ action: 'auth.federation', outcome: 'allowed', subjectId: userId });
    const token = await auth.generateApiToken(caller, 'Primary key token');
    const row = await query(tables.api).first();
    expect(row.user_id).toBe(userId);
    expect(String(row.actor_id)).toBe(String(userId));
    expect((await auth.resolveFromApiToken(token))?.getAttribute(Account.primaryKey)).toBe(userId);
    expect(auth.id()).toBe(userId);
    expect(await auth.resolveFromApiToken('invalid-key')).toBeNull();
    expect(auth.apiKey()).toBeNull();
    expect(auth.check()).toBe(false);
  });

  it('issues, resolves, rotates and selectively revokes JWTs with the host key', async () => {
    const auth = manager();
    const pair = await auth.attemptJwt(credentials);
    expect(pair?.refreshToken).toBeTruthy();
    expect(verifyJwt(pair!.token, secret)?.sub).toBe(userId);
    expect((await query(tables.refresh).first()).user_id).toBe(userId);
    expect((await auth.resolveFromToken(pair!.token))?.getAttribute(Account.primaryKey)).toBe(userId);
    const rotated = await auth.refreshJwt(pair!.refreshToken!);
    expect(verifyJwt(rotated!.token, secret)?.sub).toBe(userId);
    expect(rotated?.refreshToken).not.toBe(pair!.refreshToken);
    expect(audit.at(-1)).toMatchObject({ action: 'auth.refresh', outcome: 'allowed', subjectId: userId });
    expect(await auth.refreshJwt(pair!.refreshToken!)).toBeNull();
    const foreign = await manager().attemptJwt({ ...credentials, email: 'other@example.test' });
    await auth.revokeRefreshTokens(userId);
    expect(await auth.refreshJwt(rotated!.refreshToken!)).toBeNull();
    expect((await auth.refreshJwt(foreign!.refreshToken!))?.user.getAttribute(Account.primaryKey)).toBe(otherId);
    expect(await auth.resolveFromToken('invalid-jwt')).toBeNull();
    expect(auth.id()).toBeNull();
  });

  it('resets only the host-key account and revokes only its refresh credentials', async () => {
    const auth = manager();
    const pair = await auth.attemptJwt(credentials);
    const foreign = await manager().attemptJwt({ ...credentials, email: 'other@example.test' });
    const otherPassword = other.getAttribute('password');
    expect(await auth.sendPasswordReset('missing@example.test')).toBe(false);
    expect(await auth.sendPasswordReset(credentials.email)).toBe(true);
    const token = new URL(renderedVars('password-reset').resetUrl).searchParams.get('token')!;
    expect(await auth.resetPassword('wrong', credentials.email, 'new-password')).toBe(false);
    expect(await auth.resetPassword(token, 'other@example.test', 'new-password')).toBe(false);
    expect(await auth.resetPassword(token, credentials.email, 'new-password')).toBe(true);
    expect(await Hash.verify('new-password', (await fresh()).getAttribute('password'))).toBe(true);
    expect((await fresh(otherId)).getAttribute('password')).toBe(otherPassword);
    expect(await auth.resetPassword(token, credentials.email, 'again')).toBe(false);
    expect(await auth.attempt(credentials)).toBeNull();
    expect(await auth.attempt({ ...credentials, password: 'new-password' })).not.toBeNull();
    expect(await auth.refreshJwt(pair!.refreshToken!)).toBeNull();
    expect(await manager().refreshJwt(foreign!.refreshToken!)).not.toBeNull();
    expect(await query(tables.resets).count()).toBe(0);
  });

  it('sends fresh verification identity and recipient data, encodes the URL id, and updates only the host key', async () => {
    const auth = manager();
    const stale = await fresh();
    await account.update({ email: 'fresh@example.test', name: 'Fresh name', email_verified_at: null });
    await other.update({ email_verified_at: null });
    await auth.sendVerificationEmail(stale);
    const vars = renderedVars('email-verification');
    const url = new URL(vars.verifyUrl);
    expect(url.searchParams.get('id')).toBe(String(userId));
    expect([...url.searchParams.keys()]).toEqual(['token', 'id']);
    expect(url.hash).toBe('');
    expect(vars['user.name']).toBe('Fresh name');
    expect(Mailer.send).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'fresh@example.test' }));
    expect((await query(tables.verification).first()).user_id).toBe(userId);
    const token = url.searchParams.get('token')!;
    expect(await auth.verifyEmail('wrong', userId)).toBe(false);
    expect(await auth.verifyEmail(token, otherId)).toBe(false);
    expect(await auth.verifyEmail(token, userId)).toBe(true);
    expect(auth.isEmailVerified(await fresh())).toBe(true);
    expect(auth.isEmailVerified(await fresh(otherId))).toBe(false);
    expect(await auth.verifyEmail(token, userId)).toBe(false);
    expect(await query(tables.verification).count()).toBe(0);
  });

  it('supports OTP issuance, verification and single-use sessions using the host key', async () => {
    const auth = manager();
    expect(await auth.sendOtp('missing@example.test')).toBe(false);
    expect(await auth.sendOtp(credentials.email)).toBe(true);
    const code = renderedVars('otp-code').code;
    const session = sessionFor();
    expect(await auth.attemptOtp(credentials.email, 'incorrect', session)).toBeNull();
    expect(await auth.verifyOtp(credentials.email, code, 'different-purpose')).toBeNull();
    expect(session.set).not.toHaveBeenCalled();
    expect((await auth.attemptOtp(credentials.email, code, session))?.getAttribute(Account.primaryKey)).toBe(userId);
    expect(auth.id()).toBe(userId);
    expect(session.get('auth_user_id')).toBe(userId);
    expect(audit.at(-1)).toMatchObject({ action: 'auth.passwordless', outcome: 'allowed', subjectId: userId });
    expect(await auth.verifyOtp(credentials.email, code)).toBeNull();
    expect(auth.check()).toBe(false);
    expect(session.regenerateId).toHaveBeenCalledOnce();
  });

  it('binds session, JWT and database API-key middleware context to the host key', async () => {
    await middleware(manager(), sessionFor(userId));
    const pair = await manager().attemptJwt(credentials);
    await middleware(manager(), undefined, pair!.token);
    const token = await manager().generateApiToken(account);
    await middleware(manager(), undefined, token);
  });

  it('records the real audit sink subject and actor from the host key, not ambient identity', async () => {
    await ApplicationContext.runIsolated({ userId: 'untrusted-ambient', actorId: 'untrusted-ambient' }, async () => {
      expect(await manager({ audit: true }).attempt(credentials)).not.toBeNull();
      const events = await Audit.query({ action: 'auth.login' });
      expect(events[0]).toMatchObject({ userId, modelId: userId,
        metadata: { targetUserId: userId, actorId: userId, outcome: 'allowed' } });
      expect(ApplicationContext.get('userId')).toBe('untrusted-ambient');
    });
  });

  it('keeps registration anonymous when an ORM adapter returns a missing identity after persistence', async () => {
    class MissingRegistrationIdentity extends Account {
      static async create<T extends Model>(this: new () => T, input: Record<string, any>): Promise<T> {
        const created = await super.create<T>(input);
        created.setAttribute(Account.primaryKey, undefined);
        return created;
      }
    }
    const auth = manager({ model: MissingRegistrationIdentity });
    await auth.register({ ...attributes('missing-identity@example.test', 'missing-registration'), password: credentials.password });
    const persisted = await Account.where('email', 'missing-identity@example.test').first();
    expect(persisted?.getAttribute(Account.primaryKey)).toBeTruthy();
    expect(auth.id()).toBeNull();
    expect(auth.check()).toBe(false);
    expect(auth.failureReason()).toBe('invalid_credentials');
    expect(audit.some((event) => event.outcome === 'allowed')).toBe(false);
  });

  it.each([
    { state: { disabled: true }, reason: 'account_disabled' },
    { state: { locked: true }, reason: 'account_locked' },
    { state: { email_verified_at: null }, reason: 'email_unverified' },
  ])('rechecks persisted $reason on every credential path without issuing new authority', async ({ state, reason }) => {
    const auth = manager();
    const stale = await fresh();
    const pair = await auth.attemptJwt(credentials);
    const token = await auth.generateApiToken(stale);
    expect(await auth.sendOtp(credentials.email)).toBe(true);
    const code = renderedVars('otp-code').code;
    await account.update(state);
    audit = [];
    const session = sessionFor();
    expect(await auth.attempt(credentials, session)).toBeNull();
    expect(await auth.attemptJwt(credentials)).toBeNull();
    expect(await auth.login(stale, session)).toBeNull();
    expect(await auth.attemptOtp(credentials.email, code, session)).toBeNull();
    expect(await auth.sendOtp(credentials.email)).toBe(false);
    expect(session.set).not.toHaveBeenCalled();
    expect(session.startAuthentication).not.toHaveBeenCalled();
    expect(session.regenerateId).not.toHaveBeenCalled();
    for (const event of audit) expect(event).toMatchObject({ outcome: 'denied', subjectId: userId, reason });
    await expect(auth.generateApiToken(stale)).rejects.toMatchObject({ reason });
    expect(await auth.resolveFromToken(pair!.token)).toBeNull();
    expect(auth.failureReason()).toBe(reason);
    expect(await auth.refreshJwt(pair!.refreshToken!)).toBeNull();
    expect(auth.failureReason()).toBe(reason);
    const existing = sessionFor(userId);
    expect(await auth.resolveFromSession(existing)).toBeNull();
    expect(existing.get('auth_user_id')).toBeUndefined();
    await ApplicationContext.runIsolated({}, async () => {
      expect(await auth.resolveFromApiToken(token)).toBeNull();
      expect(ApplicationContext.get('userId')).toBeUndefined();
      expect(ApplicationContext.get('actorId')).toBeUndefined();
    });
    expect(auth.failureReason()).toBe(reason);
    expect(auth.id()).toBeNull();
    expect(auth.apiKey()).toBeNull();
    expect(await query(tables.api).count()).toBe(1);
    expect(await query(tables.refresh).count()).toBe(1);
    expect(audit.some((event) => event.outcome === 'allowed')).toBe(false);
    const registered = await auth.register({ ...attributes('blocked-new@example.test', 'blocked-new'), ...state, password: credentials.password });
    expect(registered.getAttribute(Account.primaryKey)).toBeTruthy();
    expect(auth.check()).toBe(false);
  });

  it('rejects wrong passwords with the canonical audit subject and no session or token writes', async () => {
    const auth = manager();
    const session = sessionFor();
    expect(await auth.attempt({ ...credentials, password: 'wrong' }, session)).toBeNull();
    expect(await auth.attemptJwt({ ...credentials, password: 'wrong' })).toBeNull();
    expect(auth.failureReason()).toBe('invalid_credentials');
    expect(audit).toHaveLength(2);
    for (const event of audit) expect(event).toMatchObject({ outcome: 'denied', subjectId: userId });
    expect(session.set).not.toHaveBeenCalled();
    expect(await query(tables.refresh).count()).toBe(0);
  });

  it('rejects invalid incoming identities before any ORM find or authority issuance', async () => {
    const auth = manager();
    const find = vi.spyOn(Account, 'find');
    for (const invalid of invalidIdentities) {
      const caller = new Account();
      if (Account.primaryKey !== 'id') caller.setAttribute('id', otherId);
      caller.setAttribute(Account.primaryKey, invalid);
      const session = sessionFor();
      expect(await auth.login(caller, session)).toBeNull();
      await expect(auth.generateApiToken(caller)).rejects.toThrow();
      await expect(auth.sendVerificationEmail(caller)).rejects.toThrow();
      expect(await auth.resolveFromSession(sessionFor(invalid))).toBeNull();
      const now = Math.floor(Date.now() / 1000);
      expect(await auth.resolveFromToken(signJwt({ sub: invalid as string, iat: now, exp: now + 60 }, secret))).toBeNull();
      expect(await auth.verifyEmail('unused', invalid as string)).toBe(false);
      await expect(auth.revokeRefreshTokens(invalid as string)).rejects.toThrow();
      expect(session.set).not.toHaveBeenCalled();
      expect(session.regenerateId).not.toHaveBeenCalled();
      expect(auth.id()).toBeNull();
    }
    expect(find).not.toHaveBeenCalled();
    for (const event of audit) expect(event).toMatchObject({ outcome: 'denied', subjectId: null });
    expect(await query(tables.refresh).count()).toBe(0);
    expect(await query(tables.verification).count()).toBe(0);
    expect(await query(tables.api).count()).toBe(0);
    expect(Mailer.send).not.toHaveBeenCalled();
  });

  it('fails closed when real ORM projections omit the primary key, even with a shadow id', async () => {
    class ProjectedAccount extends Account {
      static query<T extends Model>(this: new () => T): QueryBuilder<T> {
        const columns = ['email', 'password', 'disabled', 'locked', 'email_verified_at'];
        if (Account.primaryKey !== 'id') columns.push('id');
        return super.query<T>().select(...columns);
      }
    }
    const issuer = manager();
    const pair = await issuer.attemptJwt(credentials);
    const apiToken = await issuer.generateApiToken(account);
    await issuer.sendPasswordReset(credentials.email);
    const resetToken = new URL(renderedVars('password-reset').resetUrl).searchParams.get('token')!;
    await issuer.sendOtp(credentials.email);
    const code = renderedVars('otp-code').code;
    audit = [];
    const auth = manager({ model: ProjectedAccount });
    const session = sessionFor();
    expect(await auth.attempt(credentials, session)).toBeNull();
    expect(await auth.attemptJwt(credentials)).toBeNull();
    expect(await auth.login(account, session)).toBeNull();
    expect(await auth.attemptOtp(credentials.email, code, session)).toBeNull();
    expect(await auth.resolveFromSession(sessionFor(userId))).toBeNull();
    expect(await auth.resolveFromToken(pair!.token)).toBeNull();
    expect(await auth.refreshJwt(pair!.refreshToken!)).toBeNull();
    await ApplicationContext.runIsolated({}, async () => {
      expect(await auth.resolveFromApiToken(apiToken)).toBeNull();
      expect(auth.apiKey()).toBeNull();
      expect(ApplicationContext.get('userId')).toBeUndefined();
      expect(ApplicationContext.get('actorId')).toBeUndefined();
    });
    expect(await auth.resetPassword(resetToken, credentials.email, 'must-not-change')).toBe(false);
    expect((await fresh()).getAttribute('password')).toBe(account.getAttribute('password'));
    expect(await auth.sendPasswordReset(credentials.email)).toBe(false);
    expect(await auth.sendOtp(credentials.email)).toBe(false);
    await expect(auth.generateApiToken(account)).rejects.toThrow('primary key');
    await expect(auth.sendVerificationEmail(account)).rejects.toThrow('primary key');
    expect(auth.failureReason()).toBe('invalid_credentials');
    expect(auth.check()).toBe(false);
    expect(session.set).not.toHaveBeenCalled();
    expect(session.startAuthentication).not.toHaveBeenCalled();
    expect(session.regenerateId).not.toHaveBeenCalled();
    expect(audit).toHaveLength(5);
    for (const event of audit) expect(event).toMatchObject({ outcome: 'denied', subjectId: null });
    expect(await query(tables.refresh).count()).toBe(1);
    expect(await query(tables.api).count()).toBe(1);
  });

  it('never uses a shadow id when the supplied canonical key has no persisted account', async () => {
    const caller = await fresh();
    caller.setAttribute(Account.primaryKey, kind === 'integer' ? 99999 : 'missing-host-primary-key');
    if (Account.primaryKey !== 'id') caller.setAttribute('id', otherId);
    const auth = manager();
    const session = sessionFor();
    expect(await auth.login(caller, session)).toBeNull();
    await expect(auth.generateApiToken(caller)).rejects.toThrow('account_disabled');
    await expect(auth.sendVerificationEmail(caller)).rejects.toThrow('account_disabled');
    expect(session.set).not.toHaveBeenCalled();
    expect(auth.check()).toBe(false);
    expect(audit).toEqual([expect.objectContaining({ outcome: 'denied', subjectId: null })]);
    expect(await query(tables.verification).count()).toBe(0);
    expect(await query(tables.api).count()).toBe(0);
  });

  it('denies a corrupted refresh identity without find(undefined) or an allowed audit', async () => {
    const auth = manager();
    const pair = await auth.attemptJwt(credentials);
    await query(tables.refresh).update({ user_id: null });
    const find = vi.spyOn(Account, 'find');
    audit = [];
    expect(await auth.refreshJwt(pair!.refreshToken!)).toBeNull();
    expect(find).not.toHaveBeenCalled();
    expect(audit).toEqual([expect.objectContaining({ outcome: 'denied', subjectId: null })]);
    expect(auth.check()).toBe(false);
    expect(await query(tables.refresh).count()).toBe(1);
  });

  it('rejects expired reset, verification and OTP credentials without changing another account', async () => {
    const auth = manager();
    const password = account.getAttribute('password');
    await auth.sendPasswordReset(credentials.email);
    const reset = new URL(renderedVars('password-reset').resetUrl).searchParams.get('token')!;
    await auth.sendVerificationEmail(account);
    const verification = new URL(renderedVars('email-verification').verifyUrl).searchParams.get('token')!;
    await auth.sendOtp(credentials.email);
    const code = renderedVars('otp-code').code;
    const expired = new Date(Date.now() - 60000).toISOString();
    for (const table of [tables.resets, tables.verification, tables.otp]) await query(table).update({ expires_at: expired });
    expect(await auth.resetPassword(reset, credentials.email, 'must-not-change')).toBe(false);
    expect(await auth.verifyEmail(verification, userId)).toBe(false);
    expect(await auth.verifyOtp(credentials.email, code)).toBeNull();
    expect((await fresh()).getAttribute('password')).toBe(password);
    expect(auth.check()).toBe(false);
  });
});

describe('Legacy fake models without primaryKey metadata', () => {
  it('keeps the id fallback for existing adapters', async () => {
    const user = { getAttribute: (key: string) => key === 'id' ? 42 : null };
    const find = vi.fn(async () => user);
    const auth = new AuthManager({ guard: 'session', model: { find }, audit: false });
    const session = sessionFor();
    expect(await auth.login(user, session)).toBe(user);
    expect(find).toHaveBeenCalledWith(42);
    expect(session.get('auth_user_id')).toBe(42);
    expect(auth.id()).toBe(42);
  });
});
