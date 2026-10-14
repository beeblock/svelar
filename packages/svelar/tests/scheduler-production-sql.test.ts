import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { AddSchedulerSettingsPolicy } from '../src/database/core/00000000_000044_add_scheduler_settings_policy.js';
import { CreateSchedulerRuntimeTable } from '../src/database/core/00000000_000047_create_scheduler_runtime_table.js';
import { CreateSchedulerRequestsTable } from '../src/database/core/00000000_000048_create_scheduler_requests_table.js';
import { SchedulerLock } from '../src/scheduler/SchedulerLock.js';
import { SchedulerRuntimeStore } from '../src/scheduler/RuntimeStore.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('Production scheduler driver SQL contracts', () => {
  it.each(['sqlite', 'postgres', 'mysql'] as const)('emits each process heartbeat update column once and preserves caller values (%s)', async (driver) => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    const raw = vi.spyOn(Connection, 'raw').mockResolvedValue([]);
    await new SchedulerRuntimeStore({}, 'heartbeat-connection').process('worker-owner', {
      state: 'draining', heartbeat_at: 1234, started_at: 1200, failures: 2,
    });

    const [sql, values, connection] = raw.mock.calls[0];
    const updates = sql.split(/DO UPDATE SET |ON DUPLICATE KEY UPDATE /)[1];
    const assignments = [...updates.matchAll(/["`]([a-z_]+)["`] = /g)].map((match) => match[1]);
    expect(assignments).toEqual(['state', 'heartbeat_at', 'started_at', 'failures']);
    expect(values).toEqual(['process:worker-owner', 'process', null, null, 'draining', 1234, 1200, 2]);
    expect(connection).toBe('heartbeat-connection');
  });

  it.each(['sqlite', 'postgres', 'mysql'] as const)('keeps the other runtime store upsert update lists unique (%s)', async (driver) => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    const statements: string[] = [];
    vi.spyOn(Connection, 'raw').mockImplementation(async (sql: string) => { statements.push(sql); return []; });
    const store = new SchedulerRuntimeStore();
    await store.setSettings('probe', { enabled: false, timezone: 'UTC', missedRun: { policy: 'latest', windowMinutes: 2, maxRuns: 1 } });
    await store.ensureTask('probe');
    const inserts = statements.filter((sql) => sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(2);
    for (const sql of inserts) {
      const updates = sql.split(/DO UPDATE SET |ON DUPLICATE KEY UPDATE /)[1];
      const assignments = [...updates.matchAll(/["`]([a-z_]+)["`] = /g)].map((match) => match[1]);
      expect(assignments.length).toBeGreaterThan(0);
      expect(new Set(assignments).size).toBe(assignments.length);
    }
  });

  it.each(['sqlite', 'postgres', 'mysql'] as const)('emits focused policy/runtime/request migrations (%s)', async (driver) => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    const statements: string[] = [];
    vi.spyOn(Connection, 'raw').mockImplementation(async (sql: string) => { statements.push(sql); return []; });
    await new AddSchedulerSettingsPolicy().up();
    await new CreateSchedulerRuntimeTable().up();
    await new CreateSchedulerRequestsTable().up();
    const sql = statements.join('\n');
    expect(sql).toContain('scheduled_task_settings');
    expect(sql).toContain('tenant_id');
    expect(sql).toContain('missed_run_policy');
    expect(sql).toContain('scheduler_runtime');
    expect(sql).toContain('scheduler_requests');
    expect(sql).toContain('lease_until');
    expect(sql).toContain('idx_scheduler_requests_pending');
    expect(sql.toUpperCase()).toContain('PRIMARY KEY');
    expect(sql).not.toContain('CREATE TABLE scheduled_task_runs');
  });

  it.each(['sqlite', 'postgres', 'mysql'] as const)('does not treat matched mutation metadata as lock ownership (%s)', async (driver) => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    const inserts: string[] = [];
    vi.spyOn(Connection, 'raw').mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT')) {
        inserts.push(sql);
        return driver === 'mysql' ? { affectedRows: 1 } : driver === 'postgres' ? { rowCount: 1 } : { changes: 1 };
      }
      return [{ owner: 'another-process', expires_at: new Date(Date.now() + 60000).toISOString() }];
    });
    expect(await SchedulerLock.acquireLease(`foreign-${driver}`, 1)).toBeNull();
    expect(await SchedulerLock.acquire(`legacy-foreign-${driver}`, 1)).toBe(false);
    expect(inserts[0]).toContain(driver === 'mysql' ? 'ON DUPLICATE KEY UPDATE' : 'ON CONFLICT (task_key)');
    expect(inserts[0]).toContain('expires_at <= ?');
  });

  it('refuses request-table rollback while durable commands are pending', async () => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue('postgres');
    const raw = vi.spyOn(Connection, 'raw').mockResolvedValue([{ id: 'pending' }]);
    await expect(new CreateSchedulerRequestsTable().down()).rejects.toThrow('Drain or cancel');
    expect(raw.mock.calls.some(([sql]) => sql.startsWith('DROP'))).toBe(false);
  });
});
