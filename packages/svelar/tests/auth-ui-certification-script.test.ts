import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { CreateSessionsTable, CreateOtpCodesTable, CreatePasswordResetsTable, CreateEmailVerificationsTable } from '../src/database/CoreMigrations.js';
import { Hash } from '../src/hashing/Hash.js';
import { Model } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { DatabaseSessionStore } from '../src/session/Session.js';
import { sessionActivityStatus } from '../src/session/Activity.js';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';

const harness = await import(new URL('../../../scripts/auth-ui-certification.mjs', import.meta.url).href);

class FixtureUser extends Model {
  static table = 'users';
  static timestamps = false;
  static fillable = ['name', 'email', 'password', 'role'];
}

describe('Executable auth UI harness options and cleanup', () => {
  it('expects the current safe AuthService OTP denial message rather than the page fallback', () => {
    expect(harness.authUiMessages.invalidOtp).toBe('Invalid or expired code');
    expect(NewCommandTemplates.authService()).toContain(`this.denied('${harness.authUiMessages.invalidOtp}')`);
  });

  it('requires explicit external read-only mode instead of mutating a shared server', () => {
    expect(() => harness.parseOptions(['--app-dir', '/fixture', '--no-server', '--base-url', 'http://127.0.0.1:5798'])).toThrow('read-only');
    const options = harness.parseOptions(['--app-dir', '/fixture', '--no-server', '--base-url', 'http://127.0.0.1:5798', '--phase', 'baseline']);
    expect(options).toMatchObject({ phase: 'baseline', noServer: true, baseUrl: 'http://127.0.0.1:5798' });
  });

  it.each([
    ['--app-dir'], ['--app-dir', '/fixture', '--port', '80'], ['--app-dir', '/fixture', '--port', '5897.5'],
    ['--app-dir', '/fixture', '--base-url', 'http://localhost:5897'], ['--app-dir', '/fixture', '--phase', 'maybe'],
    ['--app-dir', '/fixture', '--no-server', '--phase', 'baseline'], ['--unknown'],
  ])('rejects unsafe or incomplete options %j', (args) => {
    expect(() => harness.parseOptions(args)).toThrow();
  });

  it('does not stop an existing listener on port collision', async () => {
    const server = createServer();
    await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    try {
      await expect(harness.assertPortAvailable(address.port)).rejects.toThrow('no existing process was stopped');
      expect(server.listening).toBe(true);
    } finally { await new Promise<void>((accept) => server.close(() => accept())); }
    await expect(harness.assertPortAvailable(address.port)).resolves.toBeUndefined();
  });

  it('writes a failed, incomplete report and leaves an occupied server alive', async () => {
    const server = createServer();
    await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const directory = await mkdtemp(join(tmpdir(), 'auth-ui-report-test-'));
    try {
      const report = await harness.runCertification({ appDir: '/not-an-app', baseUrl: `http://127.0.0.1:${address.port}`, port: address.port, phase: 'full', noServer: false, reportDir: directory });
      expect(report).toMatchObject({ passed: false, complete: false, checks: [] });
      expect(report.failures.join(' ')).toContain('no existing process was stopped');
      expect(JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))).toMatchObject({ passed: false, complete: false });
      expect(server.listening).toBe(true);
    } finally {
      await new Promise<void>((accept) => server.close(() => accept()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('paces initial concurrent requests rather than retrying or resetting a server quota', async () => {
    const delays: number[] = [];
    const pace = harness.createRequestPacer(1800, { now: () => 10000, sleep: async (delay: number) => { delays.push(delay); } });
    await Promise.all([pace(), pace(), pace(), pace()]);
    expect(delays).toEqual([1800, 3600, 5400]);
  });

  it('keeps warning renewal inside the warning window with slack for both paced tabs', () => {
    const timing = harness.fixtureRenewalTiming;
    expect(timing.remainingSeconds).toBe(Math.floor(harness.fixturePolicy.warning * 0.75));
    expect(timing.remainingSeconds).toBeGreaterThan(0);
    expect(timing.remainingSeconds).toBeLessThan(harness.fixturePolicy.warning);
    expect(harness.fixturePolicy.warning).toBeLessThan(harness.fixturePolicy.idle);
    expect(timing.remainingSeconds * 1000).toBeGreaterThan(timing.pacedRequestSlots * timing.intervalMs + timing.processingSlackMs);
    expect(timing.pacedRequestSlots).toBeGreaterThanOrEqual(12);
    expect(timing.processingSlackMs).toBeGreaterThanOrEqual(10000);
  });

  it('requires successful renewal with a live extended idle deadline and an unchanged absolute cap', async () => {
    const before = { expiresAt: 1000, absoluteExpiresAt: 5000 };
    const data = { expired: false, canRenew: true, expiresAt: 4000, absoluteExpiresAt: 5000 };
    await expect(harness.assertSessionRenewal({ status: () => 200, json: async () => ({ data }) }, before)).resolves.toEqual(data);
  });

  it.each([401, 419, 429, 500])('rejects HTTP %i renewal before trying to consume its denial body', async (status) => {
    let readBody = false;
    await expect(harness.assertSessionRenewal({ status: () => status, json: async () => { readBody = true; return {}; } }, { expiresAt: 1000, absoluteExpiresAt: 5000 })).rejects.toThrow('must succeed');
    expect(readBody).toBe(false);
  });

  it.each([
    { data: null },
    { data: { expired: true, canRenew: true, expiresAt: 4000, absoluteExpiresAt: 5000 } },
    { data: { expired: false, canRenew: false, expiresAt: 4000, absoluteExpiresAt: 5000 } },
    { data: { expired: false, canRenew: true, expiresAt: 1000, absoluteExpiresAt: 5000 } },
    { data: { expired: false, canRenew: true, expiresAt: 4000, absoluteExpiresAt: 6000 } },
  ])('rejects invalid renewal state or changed absolute caps: %j', async (body) => {
    await expect(harness.assertSessionRenewal({ status: () => 200, json: async () => body }, { expiresAt: 1000, absoluteExpiresAt: 5000 })).rejects.toThrow();
  });

  it('cleans up both success and failure and preserves dual failures', async () => {
    let cleanups = 0;
    expect(await harness.withCleanup(async () => 42, async () => { cleanups++; })).toBe(42);
    await expect(harness.withCleanup(async () => { throw new Error('browser failure'); }, async () => { cleanups++; })).rejects.toThrow('browser failure');
    try {
      await harness.withCleanup(async () => { throw new Error('startup failure'); }, async () => { cleanups++; throw new Error('cleanup failure'); });
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError)) throw error;
      expect(error.errors.map((entry) => entry.message)).toEqual(['startup failure', 'cleanup failure']);
    }
    expect(cleanups).toBe(3);
  });

  it('snapshots exact source/config bytes and detects edits without modifying files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'auth-ui-snapshot-test-'));
    try {
      await mkdir(join(directory, 'src'));
      await mkdir(join(directory, 'config'));
      await writeFile(join(directory, 'src/custom.ts'), '// user customization\r\n');
      await writeFile(join(directory, 'config/auth.js'), 'export default {};\n');
      await writeFile(join(directory, '.env'), 'APP_KEY=fixture-only\r\n');
      const before = await harness.sourceSnapshot(directory);
      expect(await harness.sourceSnapshot(directory)).toEqual(before);
      expect(await readFile(join(directory, '.env'), 'utf8')).toBe('APP_KEY=fixture-only\r\n');
      await writeFile(join(directory, 'src/custom.ts'), '// changed\n');
      expect(await harness.sourceSnapshot(directory)).not.toEqual(before);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('redacts owned credentials from diagnostic output', () => {
    const state = harness.fixtureIdentity('fixture-unique-123');
    const value = harness.redactSecrets(`${state.password} ${state.accounts.eligible.email}`, state);
    expect(value).not.toContain(state.password);
    expect(value).not.toContain(state.accounts.eligible.email);
  });

  it('permits normal browser-session cookies but enforces persistent remember and absolute deadlines', () => {
    expect(() => harness.assertCookieDeadline({ expires: -1 }, { remembered: false, expiresAt: 10000 })).not.toThrow();
    expect(() => harness.assertCookieDeadline({ expires: -1 }, { remembered: true, expiresAt: 10000 })).toThrow('persistent');
    expect(() => harness.assertCookieDeadline({ expires: 10 }, { remembered: true, expiresAt: 10000 })).not.toThrow();
    expect(() => harness.assertCookieDeadline({ expires: 13 }, { remembered: true, expiresAt: 10000 })).toThrow('exceeded');
  });

  it('isolates real SQLite data and customized config without changing original source or env bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'auth-ui-isolation-test-'));
    let fixture;
    try {
      await mkdir(join(directory, 'src'));
      await mkdir(join(directory, 'build'));
      await mkdir(join(directory, 'config'));
      await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
      await writeFile(join(directory, 'build/index.js'), '// compiled app fixture\n');
      await writeFile(join(directory, 'src/app.ts'), '// retain user customization\r\n');
      await writeFile(join(directory, 'config/auth.js'), 'export default { customization: "preserved", brand: { name: "Original" }, helper: () => 42 };\n');
      await writeFile(join(directory, '.env'), 'DB_DRIVER=sqlite\r\nDB_PATH=original.sqlite\r\nAPP_KEY=fixture-only-secret\r\nMAIL_DRIVER=smtp\r\n');
      await symlink(fileURLToPath(new URL('../../../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir');
      await Connection.disconnect();
      Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: join(directory, 'original.sqlite') } } });
      await new Schema().createTable('isolation_records', (table) => { table.increments('id'); table.string('value'); });
      await new QueryBuilder('isolation_records').insert({ value: 'original' });
      await Connection.disconnect();
      const originalDatabase = await readFile(join(directory, 'original.sqlite'));
      const snapshot = await harness.sourceSnapshot(directory);
      expect(await harness.installationProvenance(directory)).toMatchObject({ authEntrySha256: expect.stringMatching(/^[a-f0-9]{64}$/), buildEntrySha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      const options = harness.parseOptions(['--app-dir', directory]);
      fixture = await harness.prepareIsolatedApp(options, harness.fixtureIdentity('isolation-owned-123'));
      const auth = (await import(pathToFileURL(join(fixture.appDir, 'config/auth.js')).href)).default;
      expect(auth.customization).toBe('preserved');
      expect(auth.helper()).toBe(42);
      expect(auth.brand.title).toBe('Fixture Identity');
      expect(auth.providers.filter((provider: { configured: boolean; available: boolean }) => provider.configured && provider.available)).toHaveLength(1);
      expect(fixture.env.MAIL_DRIVER).toBe('null');
      expect(fixture.env.DB_PATH).not.toBe(join(directory, 'original.sqlite'));
      Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: fixture.env.DB_PATH } } });
      expect(await new QueryBuilder('isolation_records').count()).toBe(1);
      await new QueryBuilder('isolation_records').insert({ value: 'private' });
      await Connection.disconnect();
      Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: join(directory, 'original.sqlite') } } });
      expect(await new QueryBuilder('isolation_records').count()).toBe(1);
      await Connection.disconnect();
      expect(await harness.sourceSnapshot(directory)).toEqual(snapshot);
      expect(await readFile(join(directory, 'original.sqlite'))).toEqual(originalDatabase);
    } finally {
      await Connection.disconnect();
      if (fixture) await rm(fixture.parent, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('Auth UI fixture operations on real SQLite through ORM', () => {
  const dependencies = { Connection, User: FixtureUser, QueryBuilder, Hash, DatabaseSessionStore };
  let state: ReturnType<typeof harness.fixtureIdentity>;
  let unrelated: FixtureUser;

  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    await new Schema().createTable('users', (table) => {
      table.increments('id'); table.string('name'); table.string('email').unique(); table.string('password'); table.string('role');
      table.timestamp('disabled_at').nullable(); table.timestamp('locked_until').nullable(); table.timestamp('email_verified_at').nullable();
    });
    await new CreateSessionsTable().up();
    await new CreateOtpCodesTable().up();
    await new CreatePasswordResetsTable().up();
    await new CreateEmailVerificationsTable().up();
    Hash.configure({ driver: 'scrypt', scryptCost: 1024 });
    unrelated = await FixtureUser.create({ name: 'Existing seed user', email: 'seed@example.test', password: 'keep-exactly', role: 'admin' });
    state = harness.fixtureIdentity('owned-run-123456');
  });

  afterEach(async () => {
    Hash.configure({ driver: 'scrypt', scryptCost: 16384 });
    await Connection.disconnect();
  });

  it('creates five owned account states with a real password hash and preserves seed data', async () => {
    const result = await harness.fixtureRecords(dependencies, 'create', state);
    expect(await FixtureUser.count()).toBe(6);
    for (const [kind, account] of Object.entries(result.accounts)) {
      if (!account || typeof account !== 'object' || !('id' in account)) throw new Error('Missing account');
      const user = await FixtureUser.find(account.id);
      if (!user) throw new Error('Missing user');
      expect(await Hash.verify(state.password, user.getAttribute('password'))).toBe(true);
      expect(user.getAttribute('disabled_at') !== null).toBe(kind === 'disabled');
      expect(user.getAttribute('locked_until') !== null).toBe(kind === 'locked');
      expect(user.getAttribute('email_verified_at') === null).toBe(kind === 'unverified');
    }
    expect((await FixtureUser.find(unrelated.getAttribute('id')))?.getAttribute('password')).toBe('keep-exactly');
  });

  it('rejects forged fixture email before database mutations', async () => {
    state.accounts.eligible.email = unrelated.getAttribute('email');
    await expect(harness.fixtureRecords(dependencies, 'create', state)).rejects.toThrow('not owned');
    expect(await FixtureUser.count()).toBe(1);
  });

  it('rolls back the entire fixture on a late account collision', async () => {
    await FixtureUser.create({ name: 'Collision', email: state.accounts.unverified.email, password: 'untouched', role: 'user' });
    await expect(harness.fixtureRecords(dependencies, 'create', state)).rejects.toThrow('already exists');
    expect(await FixtureUser.count()).toBe(2);
    expect(await FixtureUser.where('email', state.accounts.eligible.email).first()).toBeNull();
  });

  it('adjusts only an owned persisted session for real warning/absolute boundary tests', async () => {
    await harness.fixtureRecords(dependencies, 'create', state);
    const store = new DatabaseSessionStore();
    const id = 'owned-session-1234567890';
    const createdAt = Date.now() - 60000;
    await store.write(id, { auth_user_id: state.accounts.eligible.id, _svelar_remember: true, _svelar_created_at: createdAt, custom: 'preserved' }, 1000);
    const warning = await harness.fixtureRecords(dependencies, 'session-warning', state, { sessionId: id });
    const payload = await store.read(id);
    expect(payload?.custom).toBe('preserved');
    expect(payload?._svelar_created_at).toBe(warning.createdAt);
    expect(warning.createdAt).toBeLessThan(createdAt);
    expect(warning.createdAt).toBe(Number(payload?._svelar_last_activity_at));
    expect(warning.absoluteExpiresAt).toBe(warning.createdAt + harness.fixturePolicy.rememberAbsolute * 1000);
    expect(warning.absoluteExpiresAt).toBeLessThanOrEqual(createdAt + harness.fixturePolicy.rememberAbsolute * 1000);
    const remaining = Number(payload?._svelar_last_activity_at) + harness.fixturePolicy.remember * 1000 - Date.now();
    expect(remaining).toBeGreaterThan(harness.fixtureRenewalTiming.remainingSeconds * 1000 - 1000);
    expect(remaining).toBeLessThanOrEqual(harness.fixtureRenewalTiming.remainingSeconds * 1000);
    expect(remaining).toBeLessThan(harness.fixturePolicy.warning * 1000);
    expect(remaining).toBeGreaterThan(harness.fixtureRenewalTiming.pacedRequestSlots * harness.fixtureRenewalTiming.intervalMs + harness.fixtureRenewalTiming.processingSlackMs);
    expect(sessionActivityStatus(payload!, { idleLifetime: harness.fixturePolicy.idle, absoluteLifetime: harness.fixturePolicy.absolute,
      rememberLifetime: harness.fixturePolicy.remember, rememberAbsoluteLifetime: harness.fixturePolicy.rememberAbsolute,
      warningBefore: harness.fixturePolicy.warning, touchThrottle: 0 })).toMatchObject({ expired: false, reason: null, canRenew: true });
    const cap = await harness.fixtureRecords(dependencies, 'session-absolute', state, { sessionId: id });
    expect(cap.absoluteExpiresAt - Date.now()).toBeGreaterThan(40000);
    expect(cap.absoluteExpiresAt - Date.now()).toBeLessThanOrEqual(45000);
  });

  it.each([false, true])('preserves an already-aged absolute cap and produces a valid warning, remembered=%s', async (remembered) => {
    await harness.fixtureRecords(dependencies, 'create', state);
    const store = new DatabaseSessionStore();
    const id = 'aged-session-1234567890';
    const createdAt = Date.now() - 400000;
    await store.write(id, { auth_user_id: state.accounts.eligible.id, _svelar_remember: remembered, _svelar_created_at: createdAt }, 1000);
    const warning = await harness.fixtureRecords(dependencies, 'session-warning', state, { sessionId: id });
    const payload = await store.read(id);
    const policy = { idleLifetime: harness.fixturePolicy.idle, absoluteLifetime: harness.fixturePolicy.absolute,
      rememberLifetime: harness.fixturePolicy.remember, rememberAbsoluteLifetime: harness.fixturePolicy.rememberAbsolute,
      warningBefore: harness.fixturePolicy.warning, touchThrottle: 0 };
    const status = sessionActivityStatus(payload!, policy);
    expect(warning.createdAt).toBe(createdAt);
    expect(warning.absoluteExpiresAt).toBe(createdAt + (remembered ? policy.rememberAbsoluteLifetime : policy.absoluteLifetime) * 1000);
    expect(status).toMatchObject({ createdAt, expired: false, reason: null, canRenew: true, remembered });
    expect(status.warningAt).toBeLessThan(status.serverTime);
    expect(status.remainingSeconds).toBeGreaterThan(40);
    expect(status.remainingSeconds).toBeLessThanOrEqual(harness.fixtureRenewalTiming.remainingSeconds);
  });

  it('refuses malformed, foreign and expired session identifiers', async () => {
    await harness.fixtureRecords(dependencies, 'create', state);
    const store = new DatabaseSessionStore();
    await store.write('foreign-session-1234567890', { auth_user_id: unrelated.getAttribute('id'), custom: 'keep' }, 1000);
    await expect(harness.fixtureRecords(dependencies, 'session-warning', state, { sessionId: 'foreign-session-1234567890' })).rejects.toThrow('foreign or expired');
    await expect(harness.fixtureRecords(dependencies, 'session-warning', state, { sessionId: '../escape' })).rejects.toThrow('Invalid session');
    await expect(harness.fixtureRecords(dependencies, 'session-warning', state, { sessionId: 'missing-session-1234567890' })).rejects.toThrow('foreign or expired');
    expect(await store.read('foreign-session-1234567890')).toEqual({ auth_user_id: unrelated.getAttribute('id'), custom: 'keep' });
  });

  it('seeds an owned OTP hash via ORM without retaining the plain code or touching unrelated codes', async () => {
    await harness.fixtureRecords(dependencies, 'create', state);
    const expiresAt = new Date(Date.now() + 10000).toISOString();
    await new QueryBuilder('otp_codes').insert({ email: unrelated.getAttribute('email'), code: 'keep-hash', purpose: 'login', expires_at: expiresAt, created_at: new Date().toISOString(), used_at: null });
    await harness.fixtureRecords({ ...dependencies, tokenSecret: 'fixture-only-hmac-secret' }, 'otp-fixture', state, { code: '123456' });
    const owned = await new QueryBuilder('otp_codes').where('email', state.accounts.eligible.email).first();
    expect(owned?.code).toMatch(/^[a-f0-9]{64}$/);
    expect(owned?.code).not.toBe('123456');
    expect((await new QueryBuilder('otp_codes').where('email', unrelated.getAttribute('email')).first())?.code).toBe('keep-hash');
    await expect(harness.fixtureRecords({ ...dependencies, tokenSecret: 'fixture-only-hmac-secret' }, 'otp-fixture', state, { code: '../unsafe' })).rejects.toThrow('Invalid fixture OTP');
  });

  it('cleans owned users/tokens idempotently and leaves unrelated users/tokens byte-equivalent', async () => {
    await harness.fixtureRecords(dependencies, 'create', state);
    for (const email of [state.accounts.eligible.email, unrelated.getAttribute('email')]) {
      await new QueryBuilder('password_resets').insert({ email, token: 'fixture-hash', expires_at: new Date(Date.now() + 10000).toISOString(), created_at: new Date().toISOString() });
    }
    await unrelated.refresh();
    const original = unrelated.toJSON();
    await harness.fixtureRecords(dependencies, 'cleanup', state);
    await harness.fixtureRecords(dependencies, 'cleanup', state);
    expect(await FixtureUser.count()).toBe(1);
    expect((await FixtureUser.find(unrelated.getAttribute('id')))?.toJSON()).toEqual(original);
    expect(await new QueryBuilder('password_resets').count()).toBe(1);
    expect((await new QueryBuilder('password_resets').first())?.email).toBe(unrelated.getAttribute('email'));
  });

  it('refuses cleanup of a replaced identity and rolls back prior deletions', async () => {
    await harness.fixtureRecords(dependencies, 'create', state);
    state.accounts.disabled.id = unrelated.getAttribute('id');
    await expect(harness.fixtureRecords(dependencies, 'cleanup', state)).rejects.toThrow('replacement account');
    expect(await FixtureUser.count()).toBe(6);
  });
});
