import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { AddSchedulerSettingsPolicy } from '../src/database/core/00000000_000044_add_scheduler_settings_policy.js';
import { CreateSchedulerRuntimeTable } from '../src/database/core/00000000_000047_create_scheduler_runtime_table.js';
import { CreateSchedulerRequestsTable } from '../src/database/core/00000000_000048_create_scheduler_requests_table.js';
import { SchedulerLock } from '../src/scheduler/SchedulerLock.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('Production scheduler driver SQL contracts', () => {
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
