import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connection, type DatabaseDriver } from '../src/database/Connection.js';
import { QueryBuilder, TenantModel } from '../src/orm/index.js';
import { ApplicationContext } from '../src/support/Context.js';

class UpsertRecord extends TenantModel { static table = 'records'; }

function configure(driver: DatabaseDriver): void {
  Connection.configure({ default: 'main', connections: { main: { driver, filename: ':memory:' } } });
}

afterEach(() => { vi.restoreAllMocks(); ApplicationContext.clear(); });

describe('Upsert write boundaries', () => {
  it.each(['sqlite', 'postgres', 'mysql'] as const)('guards every %s conflict update by tenant ownership', async (driver) => {
    configure(driver);
    const raw = vi.spyOn(Connection, 'raw').mockResolvedValue([]);
    await UpsertRecord.forTenant('a').upsert([
      { slug: 'first', title: 'First' }, { slug: 'second', title: 'Second' },
    ], ['team_id', 'slug'], ['title']);
    const [sql, bindings] = raw.mock.calls[0];
    expect(bindings).toEqual(['first', 'First', 'a', 'second', 'Second', 'a']);
    if (driver === 'mysql') expect(sql).toContain('`title` = IF(`team_id` = VALUES(`team_id`), VALUES(`title`), `title`)');
    else expect(sql).toContain(`WHERE "records"."team_id" = ${driver === 'postgres' ? 'EXCLUDED' : 'excluded'}."team_id"`);
  });

  it.each(['sqlite', 'postgres', 'mysql'] as const)('rejects mismatched explicit raw tenant values on %s before SQL', async (driver) => {
    configure(driver);
    const raw = vi.spyOn(Connection, 'raw');
    await expect(new QueryBuilder('records').forTenant('a').upsert({ team_id: 'b', slug: 'foreign' }, ['team_id', 'slug']))
      .rejects.toThrow('different tenant');
    expect(raw).not.toHaveBeenCalled();
  });

  it('rejects heterogeneous rows and empty conflict lists before SQL', async () => {
    configure('sqlite');
    const raw = vi.spyOn(Connection, 'raw');
    await expect(new QueryBuilder('records').upsert([{ slug: 'one', title: 'One' }, { slug: 'two' }], ['slug']))
      .rejects.toThrow('same columns');
    await expect(new QueryBuilder('records').upsert({ slug: 'one' }, []))
      .rejects.toThrow('conflict column');
    expect(raw).not.toHaveBeenCalled();
  });

  it('does not suppress non-duplicate MySQL errors when no columns should be updated', async () => {
    configure('mysql');
    const original = Object.assign(new Error('Required value missing'), { code: 'ER_BAD_NULL_ERROR' });
    const raw = vi.spyOn(Connection, 'raw').mockRejectedValue(original);
    await expect(new QueryBuilder('records').upsert({ slug: 'one' }, ['slug'], [])).rejects.toBe(original);
    expect(raw.mock.calls[0][0]).not.toContain('INSERT IGNORE');
    expect(raw.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE `slug` = `slug`');
  });
});
