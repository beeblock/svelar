import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Audit } from '../src/audit/index.js';
import { AuthManager, type AuthAuditEvent, type AuthConfig } from '../src/auth/Auth.js';
import { Connection } from '../src/database/Connection.js';
import { CreateAuditLogsTable, CreateOtpCodesTable, CreateRefreshTokensTable } from '../src/database/CoreMigrations.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Hash } from '../src/hashing/Hash.js';
import { Model } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { ApplicationContext } from '../src/support/Context.js';

const secret = 'fixture-only-auth-attempt-audit-secret';
const credentials = { email: 'audit-auth@example.test', password: 'private-password' };
class Account extends Model {
  static table = 'auth_audit_accounts';
  static timestamps = false;
  static fillable = ['email', 'password', 'disabled_at', 'email_verified_at'];
}
let account: Account;

function auth(overrides: Partial<AuthConfig> = {}) {
  return new AuthManager({ guard: 'session', model: Account, jwt: { secret, refreshTokens: true },
    eligibility: { disabledAtColumn: 'disabled_at', requireVerifiedEmail: true }, ...overrides });
}
function session() {
  const values = new Map<string, unknown>();
  return { get: (key: string) => values.get(key), set: vi.fn((key: string, value: unknown) => { values.set(key, value); }),
    forget: vi.fn((key: string) => { values.delete(key); }), regenerateId: vi.fn(), startAuthentication: vi.fn(), endAuthentication: vi.fn() };
}

beforeEach(async () => {
  await Connection.disconnect();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
  await new Schema().createTable(Account.table, (table) => {
    table.increments('id'); table.string('email'); table.string('password');
    table.timestamp('disabled_at').nullable(); table.timestamp('email_verified_at').nullable();
  });
  await new CreateAuditLogsTable().up();
  await new CreateOtpCodesTable().up();
  await new CreateRefreshTokensTable().up();
  Hash.configure({ driver: 'scrypt', scryptCost: 1024 });
  Audit.configure({ driver: 'database', table: 'audit_logs', enabled: true, exclude: [], redact: [], ignore: [] });
  ApplicationContext.clear();
  account = await Account.create({ ...credentials, password: await Hash.make(credentials.password), disabled_at: null, email_verified_at: new Date().toISOString() });
});
afterEach(async () => {
  vi.restoreAllMocks();
  Audit.configure({ driver: 'memory', table: 'audit_logs', enabled: true, exclude: [], redact: [], ignore: [] });
  Hash.configure({ driver: 'scrypt', scryptCost: 16384 });
  ApplicationContext.clear();
  await Connection.disconnect();
});

describe('Explicit authentication attempt auditing', () => {
  it('uses the configured Audit sink by default, records denials and identity context, and excludes credentials', async () => {
    const manager = auth();
    const browser = session();
    await ApplicationContext.runIsolated({ tenantId: 'tenant', teamId: 'tenant', ipAddress: '192.0.2.1', userAgent: 'Audit test', correlationId: 'request-auth' }, async () => {
      expect(await manager.attempt({ ...credentials, password: 'private-wrong-password' }, browser)).toBeNull();
      expect(await manager.attempt({ ...credentials, email: 'private-unknown@example.test' }, browser)).toBeNull();
      expect(await manager.attempt(credentials, browser)).not.toBeNull();
    });
    const events = await Audit.query({ modelType: 'Auth' });
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.action === 'auth.login')).toBe(true);
    expect(events.filter((event) => event.metadata?.outcome === 'denied')).toHaveLength(2);
    expect(events.find((event) => event.metadata?.outcome === 'allowed')).toMatchObject({
      userId: String(account.getAttribute('id')), modelId: String(account.getAttribute('id')), ipAddress: '192.0.2.1', userAgent: 'Audit test',
      metadata: { actorId: account.getAttribute('id'), actorType: 'user', tenantId: 'tenant', correlationId: 'request-auth', method: 'session' },
    });
    const encoded = JSON.stringify(events);
    for (const value of [credentials.email, credentials.password, 'private-wrong-password', 'private-unknown@example.test', account.getAttribute('password')]) expect(encoded).not.toContain(value);
  });

  it('does not audit routine session or JWT resolution', async () => {
    const manager = auth();
    const browser = session();
    await manager.attempt(credentials, browser);
    const pair = await manager.attemptJwt(credentials);
    if (!pair) throw new Error('Expected JWT pair');
    const before = await new QueryBuilder('audit_logs').count();
    for (let i = 0; i < 5; i++) {
      expect(await manager.resolveFromSession(browser)).not.toBeNull();
      expect(await manager.resolveFromToken(pair.token)).not.toBeNull();
    }
    expect(await new QueryBuilder('audit_logs').count()).toBe(before);
    expect(JSON.stringify(await Audit.query({ modelType: 'Auth' }))).not.toContain(pair.token);
  });

  it('audits account-status denials only on explicit attempts, without cookie-resolution spam', async () => {
    const manager = auth();
    const browser = session();
    await manager.attempt(credentials, browser);
    await account.update({ disabled_at: new Date().toISOString() });
    expect(await manager.resolveFromSession(browser)).toBeNull();
    expect(await new QueryBuilder('audit_logs').count()).toBe(1);
    expect(await manager.attempt(credentials)).toBeNull();
    expect((await Audit.query({ action: 'auth.login' })).find((event) => event.metadata?.outcome === 'denied')).toMatchObject({
      metadata: { reason: 'account_disabled', method: 'session' },
    });
  });

  it('records federation and passwordless attempts exactly once, without exposing OTPs or provider secrets', async () => {
    const manager = auth({ presentation: { providers: [{ id: 'sso', label: 'SSO', protocol: 'oidc', loginUrl: '/auth/sso/redirect', configured: true, available: false }] } });
    expect(await manager.login(account, undefined, { providerId: 'sso' })).toBeNull();
    expect(await manager.login(account)).not.toBeNull();
    await new QueryBuilder('otp_codes').insert({ email: credentials.email, code: createHmac('sha256', secret).update('654321').digest('hex'),
      purpose: 'login', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString(), used_at: null });
    expect(await manager.attemptOtp(credentials.email, '654321', session())).not.toBeNull();
    expect(await manager.attemptOtp(credentials.email, '654321', session())).toBeNull();
    const federation = await Audit.query({ action: 'auth.federation' });
    expect(federation).toHaveLength(2);
    expect(federation.find((event) => event.metadata?.outcome === 'denied')).toMatchObject({ metadata: { reason: 'provider_unavailable', providerId: 'sso' } });
    const passwordless = await Audit.query({ action: 'auth.passwordless' });
    expect(passwordless).toHaveLength(2);
    expect(passwordless.filter((event) => event.metadata?.outcome === 'allowed')).toHaveLength(1);
    expect(JSON.stringify(passwordless)).not.toContain('654321');
    expect(JSON.stringify(passwordless)).not.toContain(secret);
  });

  it('audits refresh, authorized token revocation and logout without recording token values', async () => {
    const manager = auth();
    const pair = await manager.attemptJwt(credentials);
    if (!pair?.refreshToken) throw new Error('Expected refresh token');
    const rotated = await manager.refreshJwt(pair.refreshToken);
    if (!rotated?.refreshToken) throw new Error('Expected replacement token');
    await ApplicationContext.runIsolated({ actorType: 'user', actorId: 77, userId: 77, correlationId: 'operator-revoke' }, async () => {
      await manager.revokeRefreshTokens(account.getAttribute('id'));
      await manager.logout(session());
    });
    const events = await Audit.query({ modelType: 'Auth' });
    expect(events.map((event) => event.action).sort()).toEqual(['auth.login', 'auth.refresh', 'auth.tokens.revoked', 'auth.logout'].sort());
    expect(events.find((event) => event.action === 'auth.tokens.revoked')).toMatchObject({
      userId: '77', metadata: { affected: 1, actorId: 77, correlationId: 'operator-revoke', targetUserId: account.getAttribute('id') },
    });
    expect(manager.check()).toBe(false);
    const serialized = JSON.stringify(events);
    for (const value of [pair.token, pair.refreshToken, rotated.token, rotated.refreshToken]) expect(serialized).not.toContain(value);
  });

  it('supports explicit opt-out, the global Audit toggle, and an awaited typed immutable recorder', async () => {
    await auth({ audit: false }).attempt(credentials);
    expect(await new QueryBuilder('audit_logs').count()).toBe(0);
    Audit.configure({ enabled: false });
    await auth().attempt(credentials);
    expect(await new QueryBuilder('audit_logs').count()).toBe(0);
    const seen: AuthAuditEvent[] = [];
    const manager = auth({ audit: { record: async (event) => { await Promise.resolve(); expect(Object.isFrozen(event)).toBe(true); seen.push(event); } } });
    await manager.attempt(credentials);
    expect(seen).toEqual([{ action: 'auth.login', method: 'session', outcome: 'allowed', subjectId: account.getAttribute('id') }]);
    expect(await new QueryBuilder('audit_logs').count()).toBe(0);
  });

  it('does not grant a session or JWT if a required audit write fails', async () => {
    Audit.configure({ driver: 'database', table: 'missing_auth_audit_table' });
    const manager = auth();
    const browser = session();
    await expect(manager.attempt(credentials, browser)).rejects.toThrow();
    expect(manager.failureReason()).toBe('temporarily_unavailable');
    expect(browser.set).not.toHaveBeenCalled();
    expect(manager.check()).toBe(false);
    await expect(manager.attemptJwt(credentials)).rejects.toThrow();
    expect(await new QueryBuilder('refresh_tokens').count()).toBe(0);
  });

  it('rolls back refresh-token revocation if its persistent audit write fails', async () => {
    const manager = auth();
    const pair = await manager.attemptJwt(credentials);
    if (!pair?.refreshToken) throw new Error('Expected refresh token');
    Audit.configure({ driver: 'database', table: 'missing_auth_audit_table' });
    await expect(manager.revokeRefreshTokens(account.getAttribute('id'))).rejects.toThrow();
    expect((await new QueryBuilder('refresh_tokens').first()).revoked_at).toBeNull();
  });
});
