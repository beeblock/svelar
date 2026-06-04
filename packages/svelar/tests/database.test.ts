import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection, normalizeDatabaseDriver } from '../src/database/Connection';
import { Migration, Migrator } from '../src/database/Migration';

class NoopMigration extends Migration {
  async up(): Promise<void> {}
  async down(): Promise<void> {}
}

describe('Database configuration', () => {
  it('normalizes legacy driver aliases to canonical driver names', () => {
    expect(normalizeDatabaseDriver('postgresql')).toBe('postgres');
    expect(normalizeDatabaseDriver('mysql2')).toBe('mysql');
    expect(normalizeDatabaseDriver('sqlite')).toBe('sqlite');
  });

  it('allows default connection names that are not driver names', async () => {
    await Connection.disconnect();
    Connection.configure({
      default: 'analytics',
      connections: {
        analytics: { driver: 'sqlite', filename: ':memory:' },
      },
    });

    expect(Connection.getDriver()).toBe('sqlite');
    await Connection.disconnect();
  });

  it('tracks migrations in a configurable table', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-migrations-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      const migrator = new Migrator({ table: 'custom_migrations' });
      await migrator.run([
        {
          name: '00000001_noop',
          timestamp: '00000001',
          path: 'tests/noop',
          migration: new NoopMigration(),
        },
      ]);

      const rows = await Connection.raw(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        ['custom_migrations'],
      );
      expect(rows).toHaveLength(1);
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });
});
