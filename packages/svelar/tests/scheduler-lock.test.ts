import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { SchedulerLock } from '../src/scheduler/SchedulerLock.js';

describe('SchedulerLock', () => {
  it('acquires and releases database-backed locks through the query builder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-lock-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      await new Migrator().fresh(svelarCoreMigrations());

      await expect(SchedulerLock.acquire('billing-digest')).resolves.toBe(true);

      const rows = await Connection.raw(
        'SELECT owner FROM scheduler_locks WHERE task_key = ?',
        ['billing-digest'],
      );
      expect(rows[0]?.owner).toBe(SchedulerLock.getOwnerId());

      await SchedulerLock.release('billing-digest');
      await expect(SchedulerLock.acquire('billing-digest')).resolves.toBe(true);
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });
});
