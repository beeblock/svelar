import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Audit, auditable } from '../src/audit';
import { Connection } from '../src/database/Connection';
import { CreateAuditLogsTable } from '../src/database/CoreMigrations';

let tempRoot: string | null = null;
let sequence = 0;

function action(name: string): string {
  sequence += 1;
  return `test.${Date.now()}.${sequence}.${name}`;
}

async function useDatabaseAudit(): Promise<void> {
  tempRoot = await mkdtemp(join(tmpdir(), 'svelar-audit-'));
  await Connection.disconnect();
  Connection.configure({
    default: 'sqlite',
    connections: {
      sqlite: { driver: 'sqlite', filename: join(tempRoot, 'database.sqlite') },
    },
  });
  await new CreateAuditLogsTable().up();
  Audit.configure({ driver: 'database', enabled: true });
}

describe('Audit', () => {
  beforeEach(async () => {
    tempRoot = null;
    await Connection.disconnect();
    Audit.configure({ driver: 'memory', enabled: true });
  });

  afterEach(async () => {
    Audit.configure({ driver: 'memory', enabled: true });
    await Connection.disconnect();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    vi.restoreAllMocks();
  });

  it('records and queries memory audit entries with normalized ids, pagination, and stats', async () => {
    const created = action('created');
    const updated = action('updated');

    await Audit.log({
      userId: 42,
      action: created,
      modelType: 'User',
      modelId: 100,
      newValues: { email: 'admin@svelar.dev' },
      metadata: { source: 'test' },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    await Audit.log({
      userId: '42',
      action: updated,
      modelType: 'User',
      modelId: '100',
      oldValues: { role: 'user' },
      newValues: { role: 'admin' },
    });

    await expect(Audit.byUser('42')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: updated, modelId: '100' }),
        expect.objectContaining({ action: created, modelId: 100 }),
      ]),
    );
    await expect(Audit.forModel('User', '100')).resolves.toHaveLength(2);
    await expect(Audit.query({ userId: 42, limit: 1, offset: 1 })).resolves.toHaveLength(1);

    const stats = await Audit.getStats();
    expect(stats.byAction[created]).toBe(1);
    expect(stats.byAction[updated]).toBe(1);
    expect(stats.byModel.User).toBeGreaterThanOrEqual(2);
  });

  it('honors disabled and excluded audit configuration', async () => {
    const skipped = action('skipped');

    Audit.configure({ driver: 'memory', enabled: false });
    await Audit.log({ userId: 1, action: skipped, modelType: 'User', modelId: 1 });
    expect(await Audit.query({ action: skipped })).toHaveLength(0);

    Audit.configure({ driver: 'memory', enabled: true, exclude: ['Secret'] });
    await Audit.log({ userId: 1, action: skipped, modelType: 'Secret', modelId: 1 });
    expect(await Audit.query({ action: skipped })).toHaveLength(0);
  });

  it('writes audit entries to the log driver', async () => {
    const logged = action('logged');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    Audit.configure({ driver: 'log', enabled: true });
    await Audit.log({ userId: null, action: logged, modelType: 'Report', modelId: 'r1' });

    expect(spy).toHaveBeenCalledWith('[Audit]', expect.stringContaining(logged));
  });

  it('persists and filters database audit entries', async () => {
    await useDatabaseAudit();
    const created = action('database-created');
    const deleted = action('database-deleted');

    await Audit.log({
      userId: 7,
      action: created,
      modelType: 'Post',
      modelId: 99,
      newValues: { title: 'Hello' },
      metadata: { module: 'blog' },
    });
    await Audit.log({
      userId: 8,
      action: deleted,
      modelType: 'Post',
      modelId: 100,
    });

    await expect(Audit.query({ userId: '7', action: created })).resolves.toEqual([
      expect.objectContaining({
        userId: '7',
        action: created,
        modelType: 'Post',
        modelId: '99',
        newValues: { title: 'Hello' },
        metadata: { module: 'blog' },
      }),
    ]);
    await expect(Audit.forModel('Post', 100)).resolves.toEqual([
      expect.objectContaining({ action: deleted }),
    ]);
    await expect(Audit.getStats()).resolves.toMatchObject({
      byAction: { [created]: 1, [deleted]: 1 },
      byModel: { Post: 2 },
      total: 2,
    });
  });

  it('rejects unsafe audit table names', async () => {
    await useDatabaseAudit();
    Audit.configure({ driver: 'database', table: 'audit_logs; DROP TABLE users', enabled: true });

    await expect(Audit.query({})).rejects.toThrow('Audit table name');
  });

  it('wraps create, update, and delete methods with auditable hooks', async () => {
    const baseAction = action('auditable');

    class AuditPost {
      static async create(data: any) {
        return { id: data.id, ...data };
      }

      static async update(id: any, data: any) {
        return { id, ...data };
      }

      static async delete(id: any) {
        return { deleted: id };
      }
    }

    Audit.configure({ driver: 'memory', enabled: true });
    auditable(AuditPost);

    const created = await (AuditPost as any).create({ id: `${baseAction}-1`, title: 'Created' });
    const updated = await (AuditPost as any).update(`${baseAction}-1`, { title: 'Updated' });
    const deleted = await (AuditPost as any).delete(`${baseAction}-1`);

    expect(created.title).toBe('Created');
    expect(updated.title).toBe('Updated');
    expect(deleted.deleted).toBe(`${baseAction}-1`);

    await expect(Audit.forModel('AuditPost', `${baseAction}-1`)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'created', newValues: { id: `${baseAction}-1`, title: 'Created' } }),
        expect.objectContaining({ action: 'updated', newValues: { title: 'Updated' } }),
        expect.objectContaining({ action: 'deleted' }),
      ]),
    );
  });
});
