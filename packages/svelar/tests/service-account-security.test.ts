import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ApiKeys, ApiKeyAccessDeniedError, ApiKeyRateLimitError, type CreateServiceAccountOptions } from '../src/api-keys/index.js';
import { Audit } from '../src/audit/index.js';
import { Cache } from '../src/cache/index.js';
import { Connection } from '../src/database/Connection.js';
import { CreateApiKeysTable, AddServiceAccountFieldsToApiKeysTable, CreateAuditLogsTable } from '../src/database/CoreMigrations.js';
import { AddApiKeyRotationState } from '../src/database/core/00000000_000045_add_api_key_rotation_state.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { ApplicationContext } from '../src/support/Context.js';

type Ability = 'orders:read' | 'orders:sync';

beforeEach(async () => {
  await Connection.disconnect();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
  await new CreateApiKeysTable().up();
  await new AddServiceAccountFieldsToApiKeysTable().up();
  await new AddApiKeyRotationState().up();
  await new CreateAuditLogsTable().up();
  Audit.configure({ driver: 'database', table: 'audit_logs', enabled: true, exclude: [], redact: [], ignore: [] });
  Cache.configure({ default: 'memory', stores: { memory: { driver: 'memory' } } });
  await Cache.flush();
  ApplicationContext.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  ApiKeys.configure({ driver: 'memory' });
  Audit.configure({ driver: 'memory', table: 'audit_logs', enabled: true, exclude: [], redact: [], ignore: [] });
  ApplicationContext.clear();
  await Connection.disconnect();
});

describe.each(['memory', 'database'] as const)('Service account security (%s)', (driver) => {
  let tenantId: string;
  beforeEach(() => { tenantId = randomUUID(); ApiKeys.configure({ driver, prefix: 'test_' }); });

  it('preserves typed abilities, normalizes a mandatory identity, and returns owned record snapshots', async () => {
    const options: CreateServiceAccountOptions<Ability> = {
      name: 'ERP', teamId: tenantId, abilities: ['orders:read', 'orders:sync'], metadata: { source: 'ERP' },
    };
    const key = await ApiKeys.createServiceAccount<Ability>(options);
    expectTypeOf(key.record.abilities).toEqualTypeOf<Ability[] | undefined>();
    expectTypeOf<Parameters<typeof ApiKeys.hasAbility<Ability>>[1]>().toEqualTypeOf<Ability>();
    expect(key.record.actorId).toBe(key.record.serviceAccountId);
    key.record.permissions?.push('orders:read');
    key.record.allowedIps?.push('192.0.2.99');
    const validated = await ApiKeys.validate(key.plainTextKey);
    expect(validated?.permissions).toEqual(['orders:read', 'orders:sync']);
    expect(validated?.allowedIps).toEqual([]);
    expect(ApplicationContext.get('teamId')).toBe(tenantId);
    expect(ApplicationContext.get('actorType')).toBe('service_account');
  });

  it.each([undefined, null, '', ' ', NaN, Infinity, 1.5])('rejects missing or forged tenant %s', async (value) => {
    const options = { name: 'Invalid', teamId: tenantId };
    Reflect.set(options, 'teamId', value);
    await expect(ApiKeys.createServiceAccount(options)).rejects.toThrow();
  });

  it('rejects runtime object identities, conflicting ability sources, and malformed security controls', async () => {
    const options = { name: 'Invalid', teamId: tenantId };
    Reflect.set(options, 'teamId', { toString: () => tenantId });
    await expect(ApiKeys.createServiceAccount(options)).rejects.toThrow();
    await expect(ApiKeys.createServiceAccount({ name: 'Conflict', teamId: tenantId, abilities: ['read'], permissions: ['write'] })).rejects.toThrow('must agree');
    await expect(ApiKeys.createServiceAccount({ name: 'IP', teamId: tenantId, allowedIps: ['spoofed'] })).rejects.toThrow('exact IP');
    await expect(ApiKeys.createServiceAccount({ name: 'Quota', teamId: tenantId, rateLimit: { limit: 0, window: 60 } })).rejects.toThrow('rate limit');
    await expect(ApiKeys.createServiceAccount({ name: 'Actor', teamId: tenantId, actorId: '' })).rejects.toThrow('actorId');
  });

  it('fails closed on IP and tenant mismatch, clears stale credential authority, and preserves last use', async () => {
    const key = await ApiKeys.createServiceAccount({ name: 'Restricted', teamId: tenantId, allowedIps: ['192.0.2.1'], abilities: ['orders:read'] });
    await ApiKeys.validate(key.plainTextKey, { ip: '192.0.2.1', tenantId });
    expect(ApplicationContext.get('apiKeyId')).toBe(key.record.id);
    await expect(ApiKeys.validate(key.plainTextKey, { ip: '192.0.2.2' })).rejects.toBeInstanceOf(ApiKeyAccessDeniedError);
    expect(ApplicationContext.get('apiKeyId')).toBeUndefined();
    expect(ApplicationContext.get('tenantId')).toBeUndefined();
    await expect(ApiKeys.validate(key.plainTextKey, { ip: '192.0.2.1', tenantId: 'other' })).rejects.toBeInstanceOf(ApiKeyAccessDeniedError);
    const validated = await ApiKeys.validate(key.plainTextKey, { ip: '192.0.2.1', tenantId, userAgent: 'ERP/1', correlationId: 'request-1' });
    expect(validated).toMatchObject({ lastUsedAt: expect.any(Number), lastUsedIp: '192.0.2.1' });
    expect(ApplicationContext.snapshot()).toMatchObject({ ipAddress: '192.0.2.1', userAgent: 'ERP/1', correlationId: 'request-1' });
    if (driver === 'database') expect(await new QueryBuilder('api_keys').where('id', key.record.id).first()).toMatchObject({ last_used_ip: '192.0.2.1', last_used_at: validated?.lastUsedAt });
  });

  it('rejects forged/mutated policy records and actor, tenant, or platform context mismatches', async () => {
    const key = await ApiKeys.createServiceAccount({ name: 'Policy', teamId: tenantId, userId: 'sponsor', abilities: ['orders:read'] });
    const record = await ApiKeys.validate(key.plainTextKey);
    expect(record).not.toBeNull();
    if (!record) throw new Error('Expected authenticated key');
    const context = ApplicationContext.snapshot();
    expect(context.userId).toBeUndefined();
    expect(ApiKeys.hasAbility(record, 'orders:read')).toBe(true);
    expect(ApiKeys.hasAbility({ ...record }, 'orders:read', context)).toBe(false);
    record.permissions?.push('*');
    expect(ApiKeys.hasAbility(record, 'platform:admin', context)).toBe(false);
    expect(ApiKeys.hasAbility(record, 'orders:read', { ...context, actorId: 'forged' })).toBe(false);
    expect(ApiKeys.hasAbility(record, 'orders:read', { ...context, tenantId: 'other' })).toBe(false);
    expect(ApiKeys.hasAbility(record, 'orders:read', { ...context, platform: true })).toBe(false);
    expect(ApiKeys.hasAbility(record, 'orders:read', {})).toBe(false);
  });

  it('isolates concurrent authenticated callbacks and restores the surrounding actor/tenant', async () => {
    const one = await ApiKeys.createServiceAccount({ name: 'One', teamId: tenantId, abilities: ['read'] });
    const two = await ApiKeys.createServiceAccount({ name: 'Two', teamId: 'second-tenant', abilities: ['read'] });
    await ApplicationContext.runIsolated({ teamId: 'outer', userId: 77 }, async () => {
      const values = await Promise.all([one, two].map((key) => ApiKeys.runWithKey(key.plainTextKey, {}, async (record) => {
        await Promise.resolve();
        expect(ApiKeys.hasAbility(record, 'read')).toBe(true);
        return ApplicationContext.get('tenantId');
      })));
      expect(values).toEqual([tenantId, 'second-tenant']);
      expect(ApplicationContext.snapshot()).toMatchObject({ teamId: 'outer', userId: 77 });
      let called = false;
      expect(await ApiKeys.runWithKey('invalid-key', {}, () => { called = true; })).toBeNull();
      expect(called).toBe(false);
    });
  });

  it('invalidates previously authenticated policy snapshots after committed security changes', async () => {
    const key = await ApiKeys.createServiceAccount({ name: 'Policy retirement', teamId: tenantId, abilities: ['read'] });
    const record = await ApiKeys.validate(key.plainTextKey);
    if (!record) throw new Error('Expected authenticated key');
    const context = ApplicationContext.snapshot();
    expect(ApiKeys.hasAbility(record, 'read', context)).toBe(true);
    await ApiKeys.disable(key.record.id);
    expect(ApiKeys.hasAbility(record, 'read', context)).toBe(false);
    await ApiKeys.enable(key.record.id);
    expect(ApiKeys.hasAbility(record, 'read', context)).toBe(false);
    const refreshed = await ApiKeys.validate(key.plainTextKey);
    if (!refreshed) throw new Error('Expected revalidated key');
    expect(ApiKeys.hasAbility(refreshed, 'read')).toBe(true);
    await ApiKeys.revoke(key.record.id);
    expect(ApiKeys.hasAbility(refreshed, 'read')).toBe(false);
  });

  it('publishes exactly one overlapping replacement and retires the original at the exact deadline', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const original = await ApiKeys.createServiceAccount({ name: 'Rotate', teamId: tenantId, abilities: ['read'], expiresIn: 120 });
    const results = await Promise.all(Array.from({ length: 8 }, () => ApiKeys.rotate(original.record.id, { overlapSeconds: 30 })));
    const winners = results.filter((value) => value !== null);
    expect(winners).toHaveLength(1);
    const replacement = winners[0];
    if (!replacement) throw new Error('Expected rotation winner');
    expect(replacement.record).toMatchObject({ expiresAt: original.record.expiresAt, rotationId: original.record.id, teamId: tenantId });
    await expect(ApiKeys.validate(original.plainTextKey, { now: now + 29999 })).resolves.not.toBeNull();
    await expect(ApiKeys.validate(original.plainTextKey, { now: now + 30000 })).resolves.toBeNull();
    await expect(ApiKeys.validate(replacement.plainTextKey, { now: now + 30000 })).resolves.not.toBeNull();
    await expect(ApiKeys.rotate(original.record.id, { overlapSeconds: 999 })).resolves.toBeNull();
    expect(await Audit.query({ action: 'api_key.rotated', modelId: original.record.id })).toHaveLength(1);
  });

  it('caps overlap by absolute expiry and does not reset the quota budget across generations', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const original = await ApiKeys.createServiceAccount({ name: 'Limited', teamId: tenantId, expiresIn: 10, rateLimit: { limit: 2, window: 60 } });
    await ApiKeys.validate(original.plainTextKey);
    const replacement = await ApiKeys.rotate(original.record.id, { overlapSeconds: 60 });
    if (!replacement) throw new Error('Expected replacement');
    await ApiKeys.validate(replacement.plainTextKey);
    await expect(ApiKeys.validate(original.plainTextKey)).rejects.toBeInstanceOf(ApiKeyRateLimitError);
    await expect(ApiKeys.validate(original.plainTextKey, { now: now + 10000 })).resolves.toBeNull();
    await expect(ApiKeys.validate(replacement.plainTextKey, { now: now + 10000 })).resolves.toBeNull();
  });

  it('disables, enables, and revokes the entire rotation lineage with an audit trail and no secret logging', async () => {
    const original = await ApiKeys.createServiceAccount({ name: 'Kill switch', teamId: tenantId });
    const replacement = await ApiKeys.rotate(original.record.id, { overlapSeconds: 60 });
    if (!replacement) throw new Error('Expected replacement');
    await ApplicationContext.runIsolated({ userId: 77, actorId: 77, actorType: 'user', tenantId, teamId: tenantId, ipAddress: '192.0.2.9' }, async () => {
      await expect(ApiKeys.disable(replacement.record.id)).resolves.toBe(true);
      await expect(ApiKeys.disable(replacement.record.id)).resolves.toBe(false);
      await expect(ApiKeys.enable(replacement.record.id)).resolves.toBe(true);
      await expect(ApiKeys.revoke(replacement.record.id)).resolves.toBe(true);
    });
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.toBeNull();
    await expect(ApiKeys.validate(replacement.plainTextKey)).resolves.toBeNull();
    await expect(ApiKeys.enable(replacement.record.id)).resolves.toBe(false);
    const trail = await Audit.query({ modelType: 'ApiKey', limit: 20 });
    expect(trail.map((entry) => entry.action).sort()).toEqual(['api_key.created', 'api_key.rotated', 'api_key.disabled', 'api_key.enabled', 'api_key.revoked'].sort());
    expect(trail.find((entry) => entry.action === 'api_key.revoked')).toMatchObject({ userId: '77', ipAddress: '192.0.2.9', metadata: { actorId: 77, targetTenantId: tenantId } });
    const serialized = JSON.stringify(trail);
    for (const secret of [original.plainTextKey, original.record.key, replacement.plainTextKey, replacement.record.key]) expect(serialized).not.toContain(secret);
  });

  it('does not clear restrictions or disabled state when rotating a disabled credential', async () => {
    const original = await ApiKeys.createServiceAccount({ name: 'Disabled', teamId: tenantId, expiresIn: 60, allowedIps: ['192.0.2.1'], abilities: ['read'] });
    await ApiKeys.disable(original.record.id);
    const replacement = await ApiKeys.rotate(original.record.id, { overlapSeconds: 60 });
    expect(replacement?.record).toMatchObject({ disabledAt: expect.any(Number), expiresAt: original.record.expiresAt, allowedIps: ['192.0.2.1'], permissions: ['read'] });
    await expect(ApiKeys.validate(original.plainTextKey, { ip: '192.0.2.1' })).resolves.toBeNull();
    if (replacement) await expect(ApiKeys.validate(replacement.plainTextKey, { ip: '192.0.2.1' })).resolves.toBeNull();
  });
});

describe('API key transaction and migration safety', () => {
  beforeEach(() => { ApiKeys.configure({ driver: 'database' }); });

  it('rolls back rotation and its audit when replacement insertion fails after writing', async () => {
    const original = await ApiKeys.createServiceAccount({ name: 'Rollback', teamId: 'tenant' });
    const insert = QueryBuilder.prototype.insert;
    const failure = new Error('replacement write failed');
    const spy = vi.spyOn(QueryBuilder.prototype, 'insert').mockImplementationOnce(async function (this: QueryBuilder, data) {
      await insert.call(this, data);
      throw failure;
    });
    await expect(ApiKeys.rotate(original.record.id, { overlapSeconds: 60 })).rejects.toBe(failure);
    spy.mockRestore();
    expect(await new QueryBuilder('api_keys').count()).toBe(1);
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.not.toBeNull();
    expect(await Audit.query({ action: 'api_key.rotated' })).toHaveLength(0);
  });

  it('rolls back security mutations when persistent audit insertion fails', async () => {
    const original = await ApiKeys.createServiceAccount({ name: 'Audited', teamId: 'tenant', abilities: ['read'] });
    const authenticated = await ApiKeys.validate(original.plainTextKey);
    if (!authenticated) throw new Error('Expected authenticated key');
    const context = ApplicationContext.snapshot();
    Audit.configure({ driver: 'database', table: 'missing_audit_table' });
    await expect(ApiKeys.disable(original.record.id)).rejects.toThrow();
    expect(ApiKeys.hasAbility(authenticated, 'read', context)).toBe(true);
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.not.toBeNull();
    await expect(ApiKeys.revoke(original.record.id)).rejects.toThrow();
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.not.toBeNull();
  });

  it('preserves legacy rows and refuses migration rollback while overlap remains live', async () => {
    const original = await ApiKeys.createServiceAccount({ name: 'Migration', teamId: 'tenant' });
    const before = await new QueryBuilder('api_keys').where('id', original.record.id).first();
    const migration = new AddApiKeyRotationState();
    await migration.down();
    await migration.up();
    expect(await new QueryBuilder('api_keys').where('id', original.record.id).first()).toEqual(before);
    await ApiKeys.rotate(original.record.id, { overlapSeconds: 60 });
    await expect(migration.down()).rejects.toThrow('overlap window');
    expect(await new QueryBuilder('api_keys').count()).toBe(2);
  });

  it('fails closed for corrupted persisted service-account identity and ability fields', async () => {
    const original = await ApiKeys.createServiceAccount({ name: 'Corrupted', teamId: 'tenant', abilities: ['read'] });
    await new QueryBuilder('api_keys').where('id', original.record.id).update({ team_id: null });
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.toBeNull();
    await new QueryBuilder('api_keys').where('id', original.record.id).update({ team_id: 'tenant', permissions: '"*"' });
    await expect(ApiKeys.validate(original.plainTextKey)).resolves.toBeNull();
    expect(ApplicationContext.get('actorId')).toBeUndefined();
  });
});
