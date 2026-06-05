import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiKeys } from '../src/api-keys/index.js';
import { AuthManager, AuthenticateMiddleware } from '../src/auth/Auth.js';
import { Connection } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import type { MiddlewareContext } from '../src/middleware/Middleware.js';
import { Model } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

class User extends Model {
  static table = 'users';
  static timestamps = false;
}

describe.sequential('ApiKeys', () => {
  let root: string;
  let user: User;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-api-keys-'));
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
    });

    user = await User.create({ email: 'admin@example.com', name: 'Admin' });
    ApiKeys.configure({ driver: 'database', prefix: 'sk_test_' });
  });

  afterEach(async () => {
    ApiKeys.configure({ driver: 'memory', prefix: 'sk_' });
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });

  it('creates hashed database keys and validates permissions, usage, expiry, and revocation', async () => {
    const { record, plainTextKey } = await ApiKeys.create({
      name: 'Production',
      userId: user.getAttribute('id'),
      permissions: ['posts:read'],
      metadata: { environment: 'production' },
      expiresIn: 3600,
    });

    expect(plainTextKey).toMatch(/^sk_test_/);
    expect(record.key).not.toBe(plainTextKey);

    const rows = await new QueryBuilder('api_keys').where('id', record.id).get();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).not.toBe(plainTextKey);
    expect(rows[0].permissions).toBe(JSON.stringify(['posts:read']));

    await expect(ApiKeys.validate(plainTextKey)).resolves.toMatchObject({
      id: record.id,
      userId: String(user.getAttribute('id')),
      permissions: ['posts:read'],
      metadata: { environment: 'production' },
    });

    const used = await new QueryBuilder('api_keys').where('id', record.id).first();
    expect(used.last_used_at).toBeTypeOf('number');

    await expect(ApiKeys.hasPermission(plainTextKey, 'posts:read')).resolves.toBe(true);
    await expect(ApiKeys.hasPermission(plainTextKey, 'posts:write')).resolves.toBe(false);

    await expect(ApiKeys.revoke(record.id)).resolves.toBe(true);
    await expect(ApiKeys.validate(plainTextKey)).resolves.toBeNull();
    await expect(ApiKeys.revoke(record.id)).resolves.toBe(false);

    const expired = await ApiKeys.create({
      name: 'Expired',
      userId: user.getAttribute('id'),
      expiresIn: -1,
    });
    await expect(ApiKeys.validate(expired.plainTextKey)).resolves.toBeNull();
  });

  it('rotates keys and keeps only active keys visible for the user', async () => {
    const original = await ApiKeys.create({
      name: 'Deploy',
      userId: user.getAttribute('id'),
      permissions: ['deploy'],
    });

    const rotated = await ApiKeys.rotate(original.record.id);
    expect(rotated).not.toBeNull();
    expect(rotated!.plainTextKey).toMatch(/^sk_test_/);
    expect(rotated!.record.permissions).toEqual(['deploy']);

    await expect(ApiKeys.validate(original.plainTextKey)).resolves.toBeNull();
    await expect(ApiKeys.validate(rotated!.plainTextKey)).resolves.toMatchObject({
      id: rotated!.record.id,
    });

    const active = await ApiKeys.listForUser(user.getAttribute('id'));
    expect(active.map((key) => key.id)).toEqual([rotated!.record.id]);
  });

  it('uses ApiKeys for AuthManager API token generation and middleware fallback', async () => {
    const auth = new AuthManager({
      guard: 'session',
      model: User,
      token: { prefix: 'sk_auth_', permissions: ['integrations:read'] },
    });
    const token = await auth.generateApiToken(user, 'Integration');

    expect(token).toMatch(/^sk_auth_/);
    const resolved = await auth.resolveFromApiToken(token);
    expect(resolved?.getAttribute('email')).toBe('admin@example.com');
    await expect(ApiKeys.hasPermission(token, 'integrations:read')).resolves.toBe(true);

    const middleware = new AuthenticateMiddleware(auth);
    const ctx = {
      event: {
        request: {
          headers: {
            get: (name: string) => name.toLowerCase() === 'authorization' ? `Bearer ${token}` : null,
          },
        },
        locals: {},
      },
      params: {},
      locals: {},
    } as MiddlewareContext;

    let nextCalled = false;
    await middleware.handle(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.event.locals.user?.getAttribute('email')).toBe('admin@example.com');
  });
});
