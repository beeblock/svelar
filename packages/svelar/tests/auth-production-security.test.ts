import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeys, type ApiKeyRecord } from '../src/api-keys/index.js';
import { Audit } from '../src/audit/index.js';
import { AuthManager, type AuthenticatedVia, type AuthConfig, type AuthUser } from '../src/auth/Auth.js';
import { Connection } from '../src/database/Connection.js';
import { CreateRefreshTokensTable, CreateOtpCodesTable } from '../src/database/CoreMigrations.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Hash } from '../src/hashing/Hash.js';
import { createSvelarApp } from '../src/hooks/index.js';
import { Model } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { MemorySessionStore, type Session } from '../src/session/Session.js';
import { ApplicationContext } from '../src/support/Context.js';

const secret = 'fixture-only-auth-production-security-secret';
const credentials = { email: 'eligible@example.test', password: 'fixture-password' };

class Account extends Model {
  static table = 'auth_security_accounts';
  static timestamps = false;
  static fillable = ['email', 'password', 'disabled', 'locked', 'disabled_at', 'locked_until', 'email_verified_at'];
  static casts = { disabled: 'boolean', locked: 'boolean' } as const;
}

function manager(overrides: Partial<AuthConfig> = {}) {
  return new AuthManager({ guard: 'session', model: Account,
    jwt: { secret, refreshTokens: true },
    eligibility: { disabledColumn: 'disabled', lockedColumn: 'locked', requireVerifiedEmail: true },
    ...overrides,
  });
}

function sessionFor(id?: unknown) {
  const data = new Map<string, unknown>();
  if (id !== undefined) data.set('auth_user_id', id);
  return {
    get: vi.fn((key: string) => data.get(key)),
    set: vi.fn((key: string, value: unknown) => { data.set(key, value); }),
    forget: vi.fn((key: string) => { data.delete(key); }),
    startAuthentication: vi.fn(), endAuthentication: vi.fn(), regenerateId: vi.fn(),
    getActivityStatus: vi.fn(() => ({ expired: false })),
  };
}

let account: Account;
beforeEach(async () => {
  await Connection.disconnect();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
  await new Schema().createTable(Account.table, (table) => {
    table.increments('id'); table.string('email').unique(); table.string('password');
    table.boolean('disabled'); table.boolean('locked');
    table.timestamp('disabled_at').nullable(); table.timestamp('locked_until').nullable(); table.timestamp('email_verified_at').nullable();
  });
  await new CreateRefreshTokensTable().up();
  await new CreateOtpCodesTable().up();
  Hash.configure({ driver: 'scrypt', scryptCost: 1024 });
  ApiKeys.configure({ driver: 'memory' });
  Audit.configure({ driver: 'memory', enabled: true, exclude: [], redact: [], ignore: [] });
  ApplicationContext.clear();
  account = await Account.create({ email: credentials.email, password: await Hash.make(credentials.password),
    disabled: false, locked: false, disabled_at: null, locked_until: null, email_verified_at: new Date().toISOString() });
});

afterEach(async () => {
  vi.restoreAllMocks();
  Hash.configure({ driver: 'scrypt', scryptCost: 16384 });
  ApiKeys.configure({ driver: 'memory' });
  ApplicationContext.clear();
  await Connection.disconnect();
});

const deniedStates = [
  { attributes: { disabled: true }, reason: 'account_disabled' },
  { attributes: { locked: true }, reason: 'account_locked' },
  { attributes: { email_verified_at: null }, reason: 'email_unverified' },
] as const;

describe('Configured account eligibility on real SQLite', () => {
  it.each(deniedStates)('denies password and JWT issuance for $reason without session writes', async ({ attributes, reason }) => {
    await account.update(attributes);
    const auth = manager();
    const session = sessionFor();
    expect(await auth.attempt(credentials, session)).toBeNull();
    expect(auth.failureReason()).toBe(reason);
    expect(session.set).not.toHaveBeenCalled();
    expect(session.regenerateId).not.toHaveBeenCalled();
    expect(await auth.attemptJwt(credentials)).toBeNull();
    expect(auth.failureReason()).toBe(reason);
    expect(auth.check()).toBe(false);
    expect(await new QueryBuilder('refresh_tokens').count()).toBe(0);
  });

  it('does not disclose account eligibility before proving the password', async () => {
    await account.update({ disabled: true });
    const auth = manager();
    expect(await auth.attempt({ ...credentials, password: 'incorrect' })).toBeNull();
    expect(auth.failureReason()).toBe('invalid_credentials');
    expect(await auth.attemptJwt({ ...credentials, password: 'incorrect' })).toBeNull();
    expect(auth.failureReason()).toBe('invalid_credentials');
  });

  it.each(deniedStates)('rechecks sessions, including direct social auth_user_id writes, for $reason', async ({ attributes, reason }) => {
    const auth = manager();
    const existing = sessionFor(account.getAttribute('id'));
    expect(await auth.resolveFromSession(existing)).not.toBeNull();
    await account.update(attributes);
    expect(await auth.resolveFromSession(existing)).toBeNull();
    expect(auth.failureReason()).toBe(reason);
    expect(existing.get('auth_user_id')).toBeUndefined();
    expect(existing.endAuthentication).toHaveBeenCalledOnce();
    expect(existing.regenerateId).toHaveBeenCalledOnce();
    const forged = sessionFor(account.getAttribute('id'));
    expect(await auth.resolveFromSession(forged)).toBeNull();
    expect(forged.get('auth_user_id')).toBeUndefined();
    expect(auth.check()).toBe(false);
  });

  it.each(deniedStates)('rechecks access and refresh tokens after $reason changes', async ({ attributes, reason }) => {
    const auth = manager();
    const issued = await auth.attemptJwt(credentials);
    if (!issued?.refreshToken) throw new Error('Expected refresh credential');
    await account.update(attributes);
    expect(await auth.resolveFromToken(issued.token)).toBeNull();
    expect(auth.failureReason()).toBe(reason);
    expect(await auth.refreshJwt(issued.refreshToken)).toBeNull();
    expect(auth.failureReason()).toBe(reason);
    expect(auth.user()).toBeNull();
    expect(await new QueryBuilder('refresh_tokens').count()).toBe(1);
  });

  it.each(deniedStates)('denies passwordless login for $reason and does not revive the consumed code', async ({ attributes, reason }) => {
    await new QueryBuilder('otp_codes').insert({ email: credentials.email,
      code: createHmac('sha256', secret).update('123456').digest('hex'), purpose: 'login',
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString(), used_at: null });
    await account.update(attributes);
    const auth = manager();
    const session = sessionFor();
    expect(await auth.attemptOtp(credentials.email, '123456', session)).toBeNull();
    expect(auth.failureReason()).toBe(reason);
    expect(session.set).not.toHaveBeenCalled();
    expect(session.regenerateId).not.toHaveBeenCalled();
    await account.update({ disabled: false, locked: false, email_verified_at: new Date().toISOString() });
    expect(await auth.attemptOtp(credentials.email, '123456', session)).toBeNull();
    expect(auth.user()).toBeNull();
  });

  it('allows only one concurrent OTP capture and clears stale authenticated state on invalid credentials', async () => {
    await new QueryBuilder('otp_codes').insert({ email: credentials.email,
      code: createHmac('sha256', secret).update('123456').digest('hex'), purpose: 'login',
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString(), used_at: null });
    const results = await Promise.all(Array.from({ length: 8 }, () => manager().verifyOtp(credentials.email, '123456')));
    expect(results.filter(Boolean)).toHaveLength(1);
    const auth = manager();
    expect(await auth.attempt(credentials)).not.toBeNull();
    expect(await auth.verifyOtp(credentials.email, 'incorrect')).toBeNull();
    expect(auth.check()).toBe(false);
    expect(await auth.attemptJwt(credentials)).not.toBeNull();
    expect(await auth.refreshJwt('incorrect')).toBeNull();
    expect(auth.check()).toBe(false);
  });

  it('uses fresh persisted state for federation login rather than trusting a stale model', async () => {
    const stale = await Account.find(account.getAttribute('id'));
    if (!stale) throw new Error('Expected account');
    await account.update({ disabled: true });
    const auth = manager();
    const session = sessionFor();
    expect(await auth.login(stale, session)).toBeNull();
    expect(session.set).not.toHaveBeenCalled();
    await account.update({ disabled: false });
    expect(await auth.login(stale, session, { remember: true })).not.toBeNull();
    expect(session.startAuthentication).toHaveBeenCalledWith(true);
    expect(session.get('auth_user_id')).toBe(account.getAttribute('id'));
    expect(session.regenerateId).toHaveBeenCalledOnce();
  });

  it('denies unavailable/unconfigured federation providers without establishing a session', async () => {
    const auth = manager({ presentation: { providers: [
      { id: 'enterprise', label: 'SSO', protocol: 'oidc', loginUrl: '/auth/enterprise/redirect', configured: true, available: false },
      { id: 'unconfigured', label: 'SSO', protocol: 'saml', loginUrl: '/auth/unconfigured/redirect', configured: false },
      { id: 'available', label: 'SSO', protocol: 'oauth2', loginUrl: '/auth/available/redirect', configured: true },
    ] } });
    const session = sessionFor();
    for (const providerId of ['enterprise', 'unconfigured', 'unknown']) {
      expect(await auth.login(account, session, { providerId })).toBeNull();
      expect(auth.failureReason()).toBe('provider_unavailable');
      expect(session.set).not.toHaveBeenCalled();
    }
    expect(await auth.login(account, session, { providerId: 'available' })).not.toBeNull();
    expect(session.regenerateId).toHaveBeenCalledOnce();
  });

  it('keeps opt-in rules backwards-compatible and fails closed when configured fields are missing', async () => {
    await account.update({ disabled: true, email_verified_at: null });
    expect(await manager({ eligibility: undefined }).attempt(credentials)).not.toBeNull();
    const auth = manager({ eligibility: { disabledColumn: 'nonexistent_column' } });
    expect(await auth.attempt(credentials)).toBeNull();
    expect(auth.failureReason()).toBe('temporarily_unavailable');
  });

  it('supports timestamp disable/lock columns and an asynchronous application-owned rule', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const auth = manager({ eligibility: { disabledAtColumn: 'disabled_at', lockedUntilColumn: 'locked_until',
      check: async (_user, { method }) => method === 'federation' ? { eligible: false, reason: 'account_locked' } : { eligible: true } } });
    await account.update({ locked_until: new Date(now + 1000).toISOString() });
    expect(await auth.attempt(credentials)).toBeNull();
    expect(auth.failureReason()).toBe('account_locked');
    vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
    expect(await auth.attempt(credentials)).not.toBeNull();
    expect(await auth.login(account)).toBeNull();
    await account.update({ disabled_at: new Date(now).toISOString() });
    expect(await auth.attempt(credentials)).toBeNull();
    expect(auth.failureReason()).toBe('account_disabled');
  });

  it('never authenticates a newly registered account before required verification', async () => {
    const auth = manager();
    const registered = await auth.register({ email: 'new@example.test', password: 'fixture-password', disabled: false, locked: false });
    expect(registered.getAttribute('id')).toBeTruthy();
    expect(auth.user()).toBeNull();
    expect(auth.failureReason()).toBe('email_unverified');
  });

  it('rejects disabled user API tokens and never impersonates a service-account sponsor', async () => {
    const userKey = await ApiKeys.create({ name: 'User key', userId: account.getAttribute('id') });
    await account.update({ disabled: true });
    const auth = manager();
    expect(await auth.resolveFromApiToken(userKey.plainTextKey)).toBeNull();
    expect(auth.apiKey()).toBeNull();
    expect(ApplicationContext.get('userId')).toBeUndefined();
    const machine = await ApiKeys.createServiceAccount({ name: 'Machine', teamId: randomUUID(), userId: account.getAttribute('id') });
    expect(await auth.resolveFromApiToken(machine.plainTextKey)).toBeNull();
    expect(auth.apiKey()?.id).toBe(machine.record.id);
    expect(ApplicationContext.get('userId')).toBeUndefined();
    expect(ApplicationContext.get('actorType')).toBe('service_account');
  });

  it('does not retain credential authority when account lookup or a configured eligibility rule fails', async () => {
    const token = await ApiKeys.create({ name: 'User key', userId: account.getAttribute('id'), teamId: 'tenant' });
    const failure = new Error('account store unavailable');
    vi.spyOn(Account, 'find').mockRejectedValueOnce(failure);
    const auth = manager();
    await expect(auth.resolveFromApiToken(token.plainTextKey)).rejects.toBe(failure);
    expect(auth.apiKey()).toBeNull();
    expect(ApplicationContext.get('apiKeyId')).toBeUndefined();
    expect(ApplicationContext.get('tenantId')).toBeUndefined();
    const failing = manager({ eligibility: { check: async () => { throw failure; } } });
    await expect(failing.resolveFromApiToken(token.plainTextKey)).rejects.toBe(failure);
    expect(failing.failureReason()).toBe('temporarily_unavailable');
    expect(failing.apiKey()).toBeNull();
    expect(ApplicationContext.get('userId')).toBeUndefined();
  });
});

interface RequestLocals {
  session?: Session;
  auth?: AuthManager;
  user?: AuthUser | null;
  apiKey?: ApiKeyRecord | null;
  authenticatedVia?: AuthenticatedVia;
}

function requestEvent(method: string, pathname: string, headers: Record<string, string> = {}) {
  const url = new URL(pathname, 'http://localhost');
  const locals: RequestLocals = {};
  return { request: new Request(url, { method, headers }), url, locals, params: {}, getClientAddress: () => '192.0.2.1' };
}

describe('Verified Bearer authority through the real core hook stack', () => {
  async function runtime() {
    const auth = manager();
    const app = createSvelarApp({ auth, secret, sessionStore: new MemorySessionStore(), rateLimit: 1000 });
    const loginEvent = requestEvent('GET', '/login');
    const response = await app.handle({ event: loginEvent, resolve: async () => {
      expect(await loginEvent.locals.auth?.attempt(credentials, loginEvent.locals.session)).not.toBeNull();
      return new Response('signed in');
    } });
    const cookie = response.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
    expect(cookie).toContain('svelar_session=');
    return { app, auth, cookie };
  }

  it('does not fall back to a valid session when an attacker supplies a bogus Bearer header', async () => {
    const { app, cookie } = await runtime();
    const event = requestEvent('POST', '/api/mutation', { cookie, authorization: 'Bearer bogus', origin: 'https://attacker.invalid' });
    event.locals.authenticatedVia = 'bearer';
    const resolve = vi.fn(async () => new Response('must not mutate'));
    const session = vi.spyOn(AuthManager.prototype, 'resolveFromSession');
    const response = await app.handle({ event, resolve });
    expect(response.status).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
    expect(event.locals.authenticatedVia).toBeNull();
    expect(event.locals.user).toBeNull();
    expect(event.locals.apiKey).toBeNull();
  });

  it('marks verified JWT auth and gives the Bearer identity precedence over the cookie', async () => {
    const { app, auth, cookie } = await runtime();
    const other = await Account.create({ email: 'other@example.test', password: await Hash.make(credentials.password),
      disabled: false, locked: false, email_verified_at: new Date().toISOString() });
    const jwt = await auth.attemptJwt({ ...credentials, email: other.getAttribute('email') });
    if (!jwt) throw new Error('Expected JWT');
    const event = requestEvent('POST', '/api/mutation', { cookie, authorization: `Bearer ${jwt.token}`, origin: 'https://client.invalid' });
    const response = await app.handle({ event, resolve: async () => new Response('authorized mutation') });
    expect(response.status).toBe(200);
    expect(event.locals.authenticatedVia).toBe('bearer');
    expect(event.locals.user?.getAttribute('id')).toBe(other.getAttribute('id'));
  });

  it('requires CSRF for session auth and rejects cross-origin requests despite a matching CSRF token', async () => {
    const { app, cookie } = await runtime();
    const event = requestEvent('POST', '/api/mutation', { cookie, origin: 'http://localhost' });
    const resolve = vi.fn(async () => new Response('mutation'));
    expect((await app.handle({ event, resolve })).status).toBe(419);
    expect(event.locals.authenticatedVia).toBe('session');
    expect(resolve).not.toHaveBeenCalled();
    const csrf = /(?:^|;\s*)XSRF-TOKEN=([^;]+)/.exec(cookie)?.[1];
    if (!csrf) throw new Error('Expected CSRF cookie');
    const foreign = requestEvent('POST', '/api/mutation', { cookie, origin: 'https://attacker.invalid', 'x-csrf-token': csrf });
    expect((await app.handle({ event: foreign, resolve })).status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
    const local = requestEvent('POST', '/api/mutation', { cookie, origin: 'http://localhost', 'x-csrf-token': csrf });
    expect((await app.handle({ event: local, resolve })).status).toBe(200);
    expect(local.locals.authenticatedVia).toBe('session');
  });

  it('marks a verified machine key without manufacturing a session user, and denies revoked keys', async () => {
    const { app, cookie } = await runtime();
    const key = await ApiKeys.createServiceAccount({ name: 'Agent', teamId: randomUUID(), userId: account.getAttribute('id') });
    const event = requestEvent('POST', '/api/mutation', { cookie, authorization: `Bearer ${key.plainTextKey}` });
    const resolve = vi.fn(async () => new Response('machine mutation'));
    expect((await app.handle({ event, resolve })).status).toBe(200);
    expect(event.locals.authenticatedVia).toBe('bearer');
    expect(event.locals.user).toBeNull();
    expect(event.locals.apiKey?.id).toBe(key.record.id);
    await ApiKeys.revoke(key.record.id);
    const revoked = requestEvent('POST', '/api/mutation', { cookie, authorization: `Bearer ${key.plainTextKey}` });
    expect((await app.handle({ event: revoked, resolve })).status).toBe(401);
    expect(revoked.locals.authenticatedVia).toBeNull();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('never grants the Bearer marker to a cryptographically valid JWT for an ineligible account', async () => {
    const { app, auth, cookie } = await runtime();
    const jwt = await auth.attemptJwt(credentials);
    if (!jwt) throw new Error('Expected JWT');
    await account.update({ disabled: true });
    const event = requestEvent('POST', '/api/mutation', { cookie, authorization: `Bearer ${jwt.token}` });
    const resolve = vi.fn(async () => new Response('must not mutate'));
    expect((await app.handle({ event, resolve })).status).toBe(403);
    expect(event.locals.authenticatedVia).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
});
