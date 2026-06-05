import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthManager } from '../src/auth/Auth.js';
import { Connection } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { EmailTemplates } from '../src/email-templates/index.js';
import { Hash } from '../src/hashing/Hash.js';
import { Mailer } from '../src/mail/index.js';
import { Model } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

const secret = 'auth-recovery-test-secret';

class RecoveryUser extends Model {
  static table = 'users';
  static timestamps = false;
}

function hashToken(token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

describe.sequential('Auth recovery tokens', () => {
  let root: string;
  let auth: AuthManager;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-auth-recovery-'));
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: join(root, 'database.sqlite') },
      },
    });

    await new Migrator().fresh(svelarCoreMigrations());
    await new Schema().createTable('users', (table) => {
      table.increments('id');
      table.string('email');
      table.string('name').nullable();
      table.string('password');
      table.timestamp('email_verified_at').nullable();
    });

    Hash.configure({ driver: 'scrypt', scryptCost: 16384 });
    EmailTemplates.configure({ driver: 'memory' });
    EmailTemplates.registerDefaults();
    Mailer.configure({
      default: 'null',
      mailers: {
        null: { driver: 'null' },
      },
    });

    await RecoveryUser.create({
      email: 'recovery@example.com',
      name: 'Recovery User',
      password: await Hash.make('old-secret'),
    });

    auth = new AuthManager({
      guard: 'jwt',
      model: RecoveryUser,
      jwt: {
        secret,
        expiresIn: 60,
        refreshTokens: true,
        refreshExpiresIn: 3600,
      },
    });
  });

  afterEach(async () => {
    await Connection.disconnect();
    EmailTemplates.configure({ driver: 'memory' });
    EmailTemplates.registerDefaults();
    Mailer.configure({
      default: 'null',
      mailers: {
        null: { driver: 'null' },
      },
    });
    await rm(root, { recursive: true, force: true });
  });

  it('resets passwords with scoped tokens and revokes active refresh tokens', async () => {
    const login = await auth.attemptJwt({ email: 'recovery@example.com', password: 'old-secret' });
    expect(login?.refreshToken).toBeTruthy();

    await new QueryBuilder('password_resets').insert({
      email: 'recovery@example.com',
      token: hashToken('reset-token'),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });

    await expect(auth.resetPassword('wrong-token', 'recovery@example.com', 'new-secret')).resolves.toBe(false);
    await expect(auth.attemptJwt({ email: 'recovery@example.com', password: 'old-secret' })).resolves.not.toBeNull();

    await expect(auth.resetPassword('reset-token', 'recovery@example.com', 'new-secret')).resolves.toBe(true);
    await expect(auth.attemptJwt({ email: 'recovery@example.com', password: 'old-secret' })).resolves.toBeNull();
    await expect(auth.attemptJwt({ email: 'recovery@example.com', password: 'new-secret' })).resolves.not.toBeNull();
    await expect(auth.refreshJwt(login!.refreshToken!)).resolves.toBeNull();

    const remaining = await new QueryBuilder('password_resets').where('email', 'recovery@example.com').get();
    expect(remaining).toHaveLength(0);
  });

  it('verifies email once with a scoped verification token', async () => {
    const user = await RecoveryUser.where('email', 'recovery@example.com').first();
    await new QueryBuilder('email_verifications').insert({
      user_id: user.getAttribute('id'),
      token: hashToken('verify-token'),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });

    await expect(auth.verifyEmail('wrong-token', user.getAttribute('id'))).resolves.toBe(false);
    await expect(auth.verifyEmail('verify-token', user.getAttribute('id'))).resolves.toBe(true);
    await expect(auth.verifyEmail('verify-token', user.getAttribute('id'))).resolves.toBe(false);

    const verified = await RecoveryUser.find(user.getAttribute('id'));
    expect(auth.isEmailVerified(verified)).toBe(true);
  });

  it('marks OTP codes as single use', async () => {
    await new QueryBuilder('otp_codes').insert({
      email: 'recovery@example.com',
      code: hashToken('123456'),
      purpose: 'login',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
      used_at: null,
    });

    await expect(auth.verifyOtp('recovery@example.com', '000000')).resolves.toBeNull();

    const user = await auth.verifyOtp('recovery@example.com', '123456');
    expect(user?.getAttribute('email')).toBe('recovery@example.com');
    await expect(auth.verifyOtp('recovery@example.com', '123456')).resolves.toBeNull();

    const row = await new QueryBuilder('otp_codes').where('email', 'recovery@example.com').first();
    expect(row.used_at).toBeTruthy();
  });

  it('rejects invalid OTP lengths before issuing codes', async () => {
    const invalid = new AuthManager({
      guard: 'session',
      model: RecoveryUser,
      jwt: { secret },
      otp: { length: 3 },
    });

    await expect(invalid.sendOtp('recovery@example.com')).rejects.toThrow('OTP length');
  });

  it('propagates auth email delivery failures for existing users', async () => {
    Mailer.configure({
      default: 'failing',
      mailers: {
        failing: {
          driver: 'custom',
          transport: {
            async send(message: any) {
              throw new Error(`mail delivery failed for ${message.subject}`);
            },
          },
        },
      },
    });

    const user = await RecoveryUser.where('email', 'recovery@example.com').first();

    await expect(auth.sendPasswordReset('missing@example.com')).resolves.toBe(false);
    await expect(auth.sendPasswordReset('recovery@example.com')).rejects.toThrow('mail delivery failed');
    await expect(auth.sendVerificationEmail(user)).rejects.toThrow('mail delivery failed');
    await expect(auth.sendOtp('recovery@example.com')).rejects.toThrow('mail delivery failed');
  });

  it('cleans expired recovery tokens and used OTP codes', async () => {
    const now = new Date();
    const expired = new Date(now.getTime() - 60_000).toISOString();
    const active = new Date(now.getTime() + 60_000).toISOString();

    await new QueryBuilder('password_resets').insertMany([
      { email: 'expired@example.com', token: hashToken('expired-reset'), expires_at: expired, created_at: now.toISOString() },
      { email: 'active@example.com', token: hashToken('active-reset'), expires_at: active, created_at: now.toISOString() },
    ]);
    await new QueryBuilder('email_verifications').insertMany([
      { user_id: 1, token: hashToken('expired-verify'), expires_at: expired, created_at: now.toISOString() },
      { user_id: 1, token: hashToken('active-verify'), expires_at: active, created_at: now.toISOString() },
    ]);
    await new QueryBuilder('otp_codes').insertMany([
      { email: 'expired@example.com', code: hashToken('111111'), purpose: 'login', expires_at: expired, created_at: now.toISOString(), used_at: null },
      { email: 'used@example.com', code: hashToken('222222'), purpose: 'login', expires_at: active, created_at: now.toISOString(), used_at: now.toISOString() },
      { email: 'active@example.com', code: hashToken('333333'), purpose: 'login', expires_at: active, created_at: now.toISOString(), used_at: null },
    ]);

    await expect(auth.cleanupExpiredTokens()).resolves.toEqual({
      passwordResets: 1,
      verifications: 1,
      otpCodes: 2,
    });

    await expect(new QueryBuilder('password_resets').get()).resolves.toHaveLength(1);
    await expect(new QueryBuilder('email_verifications').get()).resolves.toHaveLength(1);
    await expect(new QueryBuilder('otp_codes').get()).resolves.toHaveLength(1);
  });

  it('fails auth cleanup loudly when core token tables are missing', async () => {
    await new Schema().dropTable('password_resets');

    await expect(auth.cleanupExpiredTokens()).rejects.toThrow('password_resets');
  });
});
