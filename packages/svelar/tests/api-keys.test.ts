import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyRateLimitError, ApiKeys } from '../src/api-keys/index.js';
import { AuthManager, AuthenticateMiddleware } from '../src/auth/Auth.js';
import { Cache } from '../src/cache/index.js';
import { Connection } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import type { MiddlewareContext } from '../src/middleware/Middleware.js';
import { Model } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { ApplicationContext } from '../src/support/Context.js';

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
    Cache.configure({ default: 'memory', stores: { memory: { driver: 'memory' } } });
    await Cache.flush();
    ApplicationContext.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    ApiKeys.configure({ driver: 'memory', prefix: 'sk_' });
    await Cache.flush();
    ApplicationContext.clear();
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

    const noPermissions = await ApiKeys.create({
      name: 'No permissions',
      userId: user.getAttribute('id'),
    });
    await expect(ApiKeys.hasPermission(noPermissions.plainTextKey, 'posts:read')).resolves.toBe(false);

    const wildcard = await ApiKeys.create({
      name: 'Wildcard',
      userId: user.getAttribute('id'),
      permissions: ['*'],
    });
    await expect(ApiKeys.hasPermission(wildcard.plainTextKey, 'posts:write')).resolves.toBe(true);

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

  it.each(['database', 'memory'] as const)('restricts owner revocation without exposing foreign keys (%s)', async (driver) => {
    ApiKeys.configure({ driver, prefix: 'sk_test_' });
    const ownerId = user.getAttribute('id');
    const other = await User.create({ email: 'other@example.com', name: 'Other' });
    const key = await ApiKeys.create({ name: 'Owner key', userId: ownerId });

    await expect(ApiKeys.revokeForUser(key.record.id, other.getAttribute('id'))).resolves.toBe(false);
    await expect(ApiKeys.revokeForUser('missing-key', ownerId)).resolves.toBe(false);
    await expect(ApiKeys.validate(key.plainTextKey)).resolves.toMatchObject({ id: key.record.id });
    await expect(ApiKeys.revokeForUser(key.record.id, String(ownerId))).resolves.toBe(true);
    await expect(ApiKeys.validate(key.plainTextKey)).resolves.toBeNull();
    await expect(ApiKeys.revokeForUser(key.record.id, ownerId)).resolves.toBe(false);
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

  it.each(['snake', 'camel', 'folded'] as const)('normalizes PG BIGINT string timestamps without changing IDs (%s aliases)', async (alias) => {
    const fields = {
      createdAt: 'created_at', lastUsedAt: 'last_used_at', expiresAt: 'expires_at',
      revokedAt: 'revoked_at', disabledAt: 'disabled_at',
    };
    const timestamps = {
      createdAt: 1_700_000_000_000, lastUsedAt: 1_700_000_001_000, expiresAt: 1_700_000_100_000,
      revokedAt: 1_700_000_002_000, disabledAt: 1_700_000_003_000,
    };
    const row: Record<string, unknown> = { id: 'pg-key', user_id: '9007199254740993', name: 'PG key', key: 'hash', prefix: 'sk_' };
    for (const [field, column] of Object.entries(fields)) {
      row[alias === 'snake' ? column : alias === 'camel' ? field : field.toLowerCase()] = String(timestamps[field as keyof typeof timestamps]);
    }
    vi.spyOn(QueryBuilder.prototype, 'get').mockResolvedValueOnce([row]);
    const [record] = await ApiKeys.listForUser('9007199254740993');
    expect(record).toMatchObject({ id: 'pg-key', userId: '9007199254740993', ...timestamps });
    for (const field of Object.keys(timestamps)) expect(record[field as keyof typeof timestamps]).toBeTypeOf('number');
  });

  it('preserves zero timestamps, handles BIGINT values, and keeps nullable timestamps absent', async () => {
    vi.spyOn(QueryBuilder.prototype, 'get').mockResolvedValueOnce([{
      id: 'pg-key', user_id: root, name: 'PG key', key: 'hash', prefix: 'sk_',
      created_at: 0n, last_used_at: null, expires_at: 1_700_000_100_000n,
      revoked_at: null, disabled_at: null,
    }]);
    const [record] = await ApiKeys.listForUser(root);
    expect(record.createdAt).toBe(0);
    expect(record.expiresAt).toBe(1_700_000_100_000);
    expect(record.lastUsedAt).toBeUndefined();
    expect(record.revokedAt).toBeUndefined();
    expect(record.disabledAt).toBeUndefined();
  });

  it.each([NaN, Infinity, '', ' ', 'not-a-timestamp', true, '1.5', '1e3', '9007199254740993', 9_007_199_254_740_993n])(
    'rejects malformed or lossy database expiration %s', async (expiresAt) => {
      vi.spyOn(QueryBuilder.prototype, 'get').mockResolvedValueOnce([{
        id: 'pg-key', user_id: root, name: 'PG key', key: 'hash', prefix: 'sk_',
        created_at: '1700000000000', expires_at: expiresAt,
      }]);
      await expect(ApiKeys.listForUser(root)).rejects.toThrow('Invalid API key expires_at timestamp.');
    },
  );

  it('rejects database records with a missing required creation timestamp', async () => {
    vi.spyOn(QueryBuilder.prototype, 'get').mockResolvedValueOnce([{
      id: 'pg-key', user_id: root, name: 'PG key', key: 'hash', prefix: 'sk_', created_at: null,
    }]);
    await expect(ApiKeys.listForUser(root)).rejects.toThrow('Missing API key created_at timestamp.');
  });

  it('preserves exact numeric expiry and disabled state when rotation reads PG-shaped string timestamps', async () => {
    const original = await ApiKeys.createServiceAccount({
      name: 'PG rotation', userId: root, teamId: 'pg-team', serviceAccountId: 'pg-service', expiresIn: 3600,
    });
    await ApiKeys.disable(original.record.id);
    const stored = await new QueryBuilder('api_keys').where('id', original.record.id).first();
    const first = QueryBuilder.prototype.first;
    const spy = vi.spyOn(QueryBuilder.prototype, 'first').mockImplementation(async function (this: QueryBuilder) {
      const row = await first.call(this);
      if (!row) return row;
      return Object.fromEntries(Object.entries(row).map(([column, value]) => [
        column, column.endsWith('_at') && value != null ? String(value) : value,
      ]));
    });
    const rotated = await ApiKeys.rotate(original.record.id);
    expect(rotated!.record.expiresAt).toBe(original.record.expiresAt);
    expect(rotated!.record.disabledAt).toBe(Number(stored.disabled_at));
    expect(rotated!.record.createdAt).toBeTypeOf('number');
    await expect(ApiKeys.validate(rotated!.plainTextKey)).resolves.toBeNull();
    spy.mockRestore();
    const replacement = await new QueryBuilder('api_keys').where('id', rotated!.record.id).first();
    expect(replacement.expires_at).toBe(original.record.expiresAt);
    expect(replacement.disabled_at).toBe(stored.disabled_at);
  });

  it('rolls back rotation if a stored timestamp cannot be safely normalized', async () => {
    const original = await ApiKeys.create({ name: 'Malformed PG row', userId: root, expiresIn: 3600 });
    const first = QueryBuilder.prototype.first;
    const spy = vi.spyOn(QueryBuilder.prototype, 'first').mockImplementationOnce(async function (this: QueryBuilder) {
      return { ...await first.call(this), expires_at: 'invalid-expiry' };
    });
    await expect(ApiKeys.rotate(original.record.id)).rejects.toThrow('Invalid API key expires_at timestamp.');
    spy.mockRestore();
    expect(await new QueryBuilder('api_keys').count()).toBe(1);
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.toMatchObject({ id: original.record.id });
  });

  it.each(['expires_at', 'disabled_at'] as const)('does not discard a zero-valued database security timestamp during validation or rotation (%s)', async (column) => {
    const original = await ApiKeys.create({ name: 'Epoch control', userId: root });
    await new QueryBuilder('api_keys').where('id', original.record.id).update({ [column]: 0 });
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.toBeNull();
    const rotated = await ApiKeys.rotate(original.record.id);
    expect(rotated!.record[column === 'expires_at' ? 'expiresAt' : 'disabledAt']).toBe(0);
    await expect(ApiKeys.validate(rotated!.plainTextKey)).resolves.toBeNull();
  });

  it.each(['database', 'memory'] as const)('treats epoch-zero revocation as present across validation and controls (%s)', async (driver) => {
    ApiKeys.configure({ driver });
    const original = await ApiKeys.create({ name: 'Epoch revocation', userId: root });
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const rotated = await ApiKeys.rotate(original.record.id);
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.toBeNull();
    await expect(ApiKeys.rotate(original.record.id)).resolves.toBeNull();
    await expect(ApiKeys.enable(original.record.id)).resolves.toBe(false);
    await expect(ApiKeys.disable(original.record.id)).resolves.toBe(false);
    await expect(ApiKeys.revokeForUser(original.record.id, root)).resolves.toBe(false);
    expect(await ApiKeys.listForUser(root)).toEqual([expect.objectContaining({ id: rotated!.record.id })]);
  });

  it.each(['database', 'memory'] as const)('preserves absolute expiry and every service account control during rotation (%s)', async (driver) => {
    ApiKeys.configure({ driver, prefix: 'sk_test_' });
    const original = await ApiKeys.createServiceAccount({
      name: 'ERP', userId: root, teamId: 'team-rotation', actorId: 'erp-actor',
      serviceAccountId: 'erp-account', prefix: 'erp_', expiresIn: 3600,
      permissions: ['orders:sync'], allowedIps: ['10.0.0.10'],
      rateLimit: { limit: 2, window: 60 }, metadata: { provider: 'erp' },
    });
    await ApiKeys.validate(original.plainTextKey, { ip: '10.0.0.10' });
    ApiKeys.configure({ driver, prefix: 'different_' });
    const rotated = await ApiKeys.rotate(original.record.id);
    expect(rotated).not.toBeNull();
    expect(rotated!.record).toMatchObject({
      userId: root, teamId: 'team-rotation', actorType: 'service_account', actorId: 'erp-actor',
      serviceAccountId: 'erp-account', prefix: 'erp_', expiresAt: original.record.expiresAt,
      permissions: ['orders:sync'], allowedIps: ['10.0.0.10'],
      rateLimit: { limit: 2, window: 60 }, metadata: { provider: 'erp' },
    });
    expect(rotated!.record.id).not.toBe(original.record.id);
    expect(rotated!.record.key).not.toBe(rotated!.plainTextKey);
    expect(rotated!.record.lastUsedAt).toBeUndefined();
    expect(rotated!.record.lastUsedIp).toBeUndefined();
    expect(rotated!.plainTextKey).toMatch(/^erp_/);
    await expect(ApiKeys.validate(original.plainTextKey, { ip: '10.0.0.10' })).resolves.toBeNull();
    const deniedIp = ApiKeys.validate(rotated!.plainTextKey, { ip: '10.0.0.11' });
    await expect(deniedIp).rejects.toMatchObject({ name: 'ApiKeyAccessDeniedError' });
    await expect(ApiKeys.validate(rotated!.plainTextKey, { ip: '10.0.0.10' })).resolves.toMatchObject({
      id: rotated!.record.id, expiresAt: original.record.expiresAt,
    });
    const deniedQuota = ApiKeys.validate(rotated!.plainTextKey, { ip: '10.0.0.10' });
    await expect(deniedQuota).rejects.toBeInstanceOf(ApiKeyRateLimitError);
    await expect(ApiKeys.validate(rotated!.plainTextKey, {
      ip: '10.0.0.10', now: original.record.expiresAt! + 1,
    })).resolves.toBeNull();
  });

  it.each(['database', 'memory'] as const)('rotates a disabled key without re-enabling it (%s)', async (driver) => {
    ApiKeys.configure({ driver, prefix: 'sk_test_' });
    const original = await ApiKeys.create({ name: 'Disabled rotation', userId: root, expiresIn: 3600 });
    await ApiKeys.disable(original.record.id);
    const [disabled] = await ApiKeys.listForUser(root);
    expect(disabled.disabledAt).toBeTypeOf('number');
    const rotated = await ApiKeys.rotate(original.record.id);
    expect(rotated!.record.disabledAt).toBe(disabled.disabledAt);
    expect(rotated!.record.expiresAt).toBe(disabled.expiresAt);
    expect(await ApiKeys.listForUser(root)).toEqual([expect.objectContaining({
      id: rotated!.record.id, disabledAt: disabled.disabledAt, expiresAt: disabled.expiresAt,
    })]);
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.toBeNull();
    await expect(ApiKeys.validate(rotated!.plainTextKey)).resolves.toBeNull();
  });

  it.each(['database', 'memory'] as const)('does not revive expired keys during rotation (%s)', async (driver) => {
    ApiKeys.configure({ driver, prefix: 'sk_test_' });
    const original = await ApiKeys.create({ name: 'Expired rotation', userId: root, expiresIn: -1 });
    const rotated = await ApiKeys.rotate(original.record.id);
    expect(rotated!.record.expiresAt).toBe(original.record.expiresAt);
    await expect(ApiKeys.validate(rotated!.plainTextKey)).resolves.toBeNull();
  });

  it.each(['database', 'memory'] as const)('allows exactly one concurrent rotation and rejects missing or revoked keys (%s)', async (driver) => {
    ApiKeys.configure({ driver, prefix: 'sk_test_' });
    const original = await ApiKeys.create({ name: 'Concurrent rotation', userId: root });
    const results = await Promise.all(Array.from({ length: 8 }, () => ApiKeys.rotate(original.record.id)));
    const winners = results.filter((result) => result !== null);
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(7);
    expect(winners[0]!.record.expiresAt).toBeUndefined();
    expect(await ApiKeys.listForUser(root)).toEqual([expect.objectContaining({ id: winners[0]!.record.id })]);
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.toBeNull();
    await expect(ApiKeys.validate(winners[0]!.plainTextKey)).resolves.not.toBeNull();
    await expect(ApiKeys.rotate(original.record.id)).resolves.toBeNull();
    await expect(ApiKeys.rotate('missing-rotation-key')).resolves.toBeNull();
    if (driver === 'database') expect(await new QueryBuilder('api_keys').count()).toBe(2);
  });

  it.each(['database', 'memory'] as const)('keeps the old key usable after generation failure and permits a later rotation (%s)', async (driver) => {
    ApiKeys.configure({ driver, prefix: 'sk_test_' });
    const original = await ApiKeys.create({ name: 'Generation failure', userId: root });
    ApiKeys.configure({ driver, hashAlgorithm: 'invalid-rotation-hash' });
    await expect(ApiKeys.rotate(original.record.id)).rejects.toThrow();
    ApiKeys.configure({ driver, prefix: 'sk_test_' });
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.toMatchObject({ id: original.record.id });
    const keys = await ApiKeys.listForUser(root);
    expect(keys).toEqual([expect.objectContaining({ id: original.record.id })]);
    expect(keys[0].revokedAt).toBeUndefined();
    if (driver === 'database') expect(await new QueryBuilder('api_keys').count()).toBe(1);
    await expect(ApiKeys.rotate(original.record.id)).resolves.not.toBeNull();
  });

  it.each([false, true])('rolls back revocation and replacement creation when insertion fails (after write: %s)', async (afterWrite) => {
    const original = await ApiKeys.create({ name: 'Insert failure', userId: root });
    const insert = QueryBuilder.prototype.insert;
    const failure = new Error('replacement insert failed');
    const spy = vi.spyOn(QueryBuilder.prototype, 'insert').mockImplementationOnce(async function (this: QueryBuilder, data) {
      if (afterWrite) await insert.call(this, data);
      throw failure;
    });
    await expect(ApiKeys.rotate(original.record.id)).rejects.toBe(failure);
    spy.mockRestore();
    expect(await new QueryBuilder('api_keys').count()).toBe(1);
    const stored = await new QueryBuilder('api_keys').where('id', original.record.id).first();
    expect(stored.revoked_at).toBeNull();
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.not.toBeNull();
    await expect(ApiKeys.rotate(original.record.id)).resolves.not.toBeNull();
  });

  it.each([false, true])('rolls back a failed revocation without creating an orphan key (after write: %s)', async (afterWrite) => {
    const original = await ApiKeys.create({ name: 'Revoke failure', userId: root });
    const update = QueryBuilder.prototype.update;
    const failure = new Error('old key revocation failed');
    const insert = vi.spyOn(QueryBuilder.prototype, 'insert');
    const spy = vi.spyOn(QueryBuilder.prototype, 'update').mockImplementationOnce(async function (this: QueryBuilder, data) {
      if (afterWrite) await update.call(this, data);
      throw failure;
    });
    await expect(ApiKeys.rotate(original.record.id)).rejects.toBe(failure);
    expect(insert).not.toHaveBeenCalled();
    spy.mockRestore();
    insert.mockRestore();
    expect(await new QueryBuilder('api_keys').count()).toBe(1);
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.not.toBeNull();
    await expect(ApiKeys.rotate(original.record.id)).resolves.not.toBeNull();
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

  it('creates tenant-bound service account keys and applies audit context', async () => {
    const { record, plainTextKey } = await ApiKeys.createServiceAccount({
      name: 'ERP sync',
      teamId: 'team-1',
      permissions: ['orders:sync'],
      allowedIps: ['10.0.0.10'],
      rateLimit: { limit: 2, window: 60 },
      metadata: { provider: 'erp' },
    });

    expect(record.userId).toBeUndefined();
    expect(record.actorType).toBe('service_account');
    expect(record.teamId).toBe('team-1');
    expect(record.serviceAccountId).toBeTruthy();

    await expect(ApiKeys.validate(plainTextKey, { ip: '10.0.0.11' })).rejects.toMatchObject({
      name: 'ApiKeyAccessDeniedError',
    });

    await expect(ApiKeys.validate(plainTextKey, { ip: '10.0.0.10' })).resolves.toMatchObject({
      id: record.id,
      teamId: 'team-1',
      actorType: 'service_account',
      permissions: ['orders:sync'],
      allowedIps: ['10.0.0.10'],
      rateLimit: { limit: 2, window: 60 },
    });

    expect(ApplicationContext.snapshot()).toMatchObject({
      teamId: 'team-1',
      tenantId: 'team-1',
      actorType: 'service_account',
      apiKeyId: record.id,
      serviceAccountId: record.serviceAccountId,
    });

    const used = await new QueryBuilder('api_keys').where('id', record.id).first();
    expect(used.last_used_ip).toBe('10.0.0.10');
  });

  it('enforces API key rate limits and disabled state', async () => {
    const { record, plainTextKey } = await ApiKeys.create({
      name: 'Limited',
      userId: user.getAttribute('id'),
      rateLimit: { limit: 1, window: 60 },
    });

    await expect(ApiKeys.validate(plainTextKey, { ip: '127.0.0.1' })).resolves.toMatchObject({
      id: record.id,
    });
    await expect(ApiKeys.validate(plainTextKey, { ip: '127.0.0.1' })).rejects.toBeInstanceOf(ApiKeyRateLimitError);

    const disabled = await ApiKeys.create({
      name: 'Disabled',
      userId: user.getAttribute('id'),
    });
    await expect(ApiKeys.disable(disabled.record.id)).resolves.toBe(true);
    await expect(ApiKeys.validate(disabled.plainTextKey)).resolves.toBeNull();
    await expect(ApiKeys.enable(disabled.record.id)).resolves.toBe(true);
    await expect(ApiKeys.validate(disabled.plainTextKey)).resolves.toMatchObject({
      id: disabled.record.id,
    });
  });

  it('sets api key locals and returns 429 when bearer key quota is exceeded', async () => {
    const { record, plainTextKey } = await ApiKeys.create({
      name: 'Middleware limited',
      userId: user.getAttribute('id'),
      teamId: 'team-2',
      rateLimit: { limit: 1, window: 60 },
    });
    const auth = new AuthManager({ guard: 'session', model: User });
    const middleware = new AuthenticateMiddleware(auth);

    const makeCtx = () => ({
      event: {
        getClientAddress: () => '127.0.0.1',
        request: {
          headers: {
            get: (name: string) => name.toLowerCase() === 'authorization' ? `Bearer ${plainTextKey}` : null,
          },
        },
        locals: {},
      },
      params: {},
      locals: {},
    }) as MiddlewareContext;

    const first = makeCtx();
    let nextCalled = false;
    await middleware.handle(first, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(first.event.locals.apiKey).toMatchObject({ id: record.id, teamId: 'team-2' });
    expect(ApplicationContext.snapshot()).toMatchObject({
      teamId: 'team-2',
      tenantId: 'team-2',
      apiKeyId: record.id,
    });

    const second = makeCtx();
    const response = await middleware.handle(second, async () => {
      throw new Error('should not call next');
    });
    expect(response).toMatchObject({ status: 429 });
    expect(response?.headers.get('Retry-After')).toBeTruthy();
  });
});
