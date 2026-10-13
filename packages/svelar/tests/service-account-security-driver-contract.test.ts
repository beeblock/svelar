import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeys } from '../src/api-keys/index.js';
import { Audit } from '../src/audit/index.js';
import { Connection } from '../src/database/Connection.js';
import { ApplicationContext } from '../src/support/Context.js';

describe.each(['postgres', 'mysql'] as const)('API key ORM SQL contract (%s, no live server)', (driver) => {
  const quote = (name: string) => driver === 'mysql' ? `\`${name}\`` : `"${name}"`;
  const affected = (count: number) => driver === 'mysql' ? { affectedRows: count } : { count };
  let row: ReturnType<typeof fixture>;

  function fixture() {
    const id = randomUUID();
    return {
      id, rotation_id: id, user_id: '', team_id: 'tenant-contract',
      actor_type: 'service_account', actor_id: 'erp', service_account_id: 'erp',
      name: 'Driver contract', key: 'stored-hash', prefix: 'test_',
      created_at: String(Date.now()), expires_at: String(Date.now() + 60000),
      last_used_at: '0', last_used_ip: null, revoked_at: null, disabled_at: null,
      rotated_at: null, overlap_until: null, permissions: '["read"]',
      allowed_ips: '["192.0.2.1"]', rate_limit: '{"limit":10,"window":60}', metadata: '{"source":"ERP"}',
    };
  }

  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    vi.spyOn(Connection, 'transaction').mockImplementation(async <T>(callback: () => Promise<T>): Promise<T> => callback());
    ApiKeys.configure({ driver: 'database' });
    Audit.configure({ driver: 'memory', enabled: true, exclude: [], redact: [], ignore: [] });
    ApplicationContext.clear();
    row = fixture();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    ApiKeys.configure({ driver: 'memory' });
    ApplicationContext.clear();
    await Connection.disconnect();
  });

  it('locks the lineage root and conditionally claims retirement before inserting a bound replacement', async () => {
    const raw = vi.spyOn(Connection, 'raw').mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT')) return [{ ...row }];
      return affected(1);
    });
    const rotated = await ApiKeys.rotate(row.id, { overlapSeconds: 20 });
    expect(rotated?.record).toMatchObject({
      rotationId: row.id, expiresAt: Number(row.expires_at), teamId: row.team_id,
      actorId: row.actor_id, serviceAccountId: row.service_account_id,
      permissions: ['read'], allowedIps: ['192.0.2.1'], rateLimit: { limit: 10, window: 60 }, metadata: { source: 'ERP' },
    });
    const calls = raw.mock.calls;
    const lock = calls.find(([sql]) => sql.endsWith('FOR UPDATE'));
    expect(lock?.[0]).toContain(`WHERE ${quote('id')} = ?`);
    expect(lock?.[1]).toEqual([row.id]);
    const claim = calls.find(([sql]) => sql.startsWith('UPDATE'));
    expect(claim?.[0]).toContain(`${quote('revoked_at')} IS NULL AND ${quote('rotated_at')} IS NULL`);
    expect(claim?.[1]).toEqual([expect.any(Number), expect.any(Number), expect.any(Number), row.id]);
    const insert = calls.find(([sql]) => sql.startsWith('INSERT'));
    expect(insert?.[0]).toContain(quote('rotation_id'));
    expect(insert?.[0]).not.toContain(row.id);
    expect(insert?.[1]).toContain(row.id);
    expect(calls.indexOf(claim!)).toBeLessThan(calls.indexOf(insert!));
    expect(await Audit.query({ action: 'api_key.rotated', modelId: row.id })).toHaveLength(1);
  });

  it('does not publish a replacement or audit after a zero-row conditional claim', async () => {
    const raw = vi.spyOn(Connection, 'raw').mockImplementation(async (sql) => sql.startsWith('SELECT') ? [{ ...row }] : affected(0));
    expect(await ApiKeys.rotate(row.id, { overlapSeconds: 20 })).toBeNull();
    expect(raw.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    expect(await Audit.query({ action: 'api_key.rotated', modelId: row.id })).toEqual([]);
  });

  it('propagates storage failures instead of treating them as a lost rotation race', async () => {
    const failure = new Error('driver storage unavailable');
    vi.spyOn(Connection, 'raw').mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT')) return [{ ...row }];
      throw failure;
    });
    await expect(ApiKeys.rotate(row.id, { overlapSeconds: 20 })).rejects.toBe(failure);
    expect(await Audit.query({ action: 'api_key.rotated', modelId: row.id })).toEqual([]);
  });

  it('aggregates audit statistics in three bounded queries and normalizes BIGINT count results', async () => {
    Audit.configure({ driver: 'database' });
    const raw = vi.spyOn(Connection, 'raw').mockImplementation(async (sql) => {
      if (!sql.includes('GROUP BY')) return [{ aggregate: '12' }];
      if (sql.includes(`GROUP BY ${quote('action')}`)) return [{ action: 'created', total: '12' }];
      return [{ model_type: 'ApiKey', total: '12' }];
    });
    expect(await Audit.getStats()).toEqual({ total: 12, byAction: { created: 12 }, byModel: { ApiKey: 12 } });
    expect(raw).toHaveBeenCalledTimes(3);
    expect(raw.mock.calls.every(([sql]) => sql.includes('COUNT(*)'))).toBe(true);
  });
});
