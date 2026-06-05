import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection, normalizeDatabaseBindings, normalizeDatabaseDriver } from '../src/database/Connection';
import { Migration, Migrator } from '../src/database/Migration';
import { Schema, TableBuilder } from '../src/database/SchemaBuilder';
import { CreateApiKeysTable, CreateAuditLogsTable, CreateEmailTemplatesTable } from '../src/database/CoreMigrations';

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

  it('normalizes driver-specific database bindings', () => {
    const iso = '2026-06-04T15:22:57.588Z';
    const date = new Date(iso);

    expect(normalizeDatabaseBindings([true, date], 'sqlite')).toEqual([1, iso]);
    expect(normalizeDatabaseBindings([iso, date], 'mysql')).toEqual([
      '2026-06-04 15:22:57',
      '2026-06-04 15:22:57',
    ]);
    expect(normalizeDatabaseBindings([iso], 'postgres')).toEqual([iso]);
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

  it('creates the migrations table before reporting migration status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-migration-status-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      const migrator = new Migrator();
      await expect(migrator.status([
        {
          name: '00000001_noop',
          timestamp: '00000001',
          path: 'tests/noop',
          migration: new NoopMigration(),
        },
      ])).resolves.toEqual([
        { name: '00000001_noop', ran: false, batch: null },
      ]);
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('propagates migration tracking query failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-migration-tracking-failure-'));
    const filename = join(root, 'database.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });

      const migrator = new Migrator();
      await migrator.ensureMigrationsTable();

      const originalRaw = Connection.raw.bind(Connection);
      Connection.raw = (async (sql: string, bindings?: any[], connectionName?: string) => {
        if (sql.includes('SELECT migration FROM migrations')) {
          throw new Error('migration tracking table is unreadable');
        }
        return originalRaw(sql, bindings, connectionName);
      }) as typeof Connection.raw;

      try {
        await expect(migrator.getRanMigrations()).rejects.toThrow('migration tracking table is unreadable');
      } finally {
        Connection.raw = originalRaw;
      }
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports Laravel-style schema.table column changes', async () => {
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: ':memory:' },
      },
    });

    try {
      const schema = new Schema();
      await schema.createTable('users', (table) => {
        table.increments('id');
        table.string('name');
      });

      await schema.table('users', (table) => {
        table.string('phone').nullable();
        table.renameColumn('name', 'full_name');
      });

      let columns = await Connection.raw('PRAGMA table_info("users")');
      expect(columns.map((column: any) => column.name)).toEqual(['id', 'full_name', 'phone']);

      await schema.table('users', (table) => {
        table.dropColumn('phone');
      });

      columns = await Connection.raw('PRAGMA table_info("users")');
      expect(columns.map((column: any) => column.name)).toEqual(['id', 'full_name']);
    } finally {
      await Connection.disconnect();
    }
  });

  it('rejects invalid schema identifiers', async () => {
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: ':memory:' },
      },
    });

    try {
      const schema = new Schema();
      await expect(schema.dropTable('users; DROP TABLE users')).rejects.toThrow('Table name contains invalid characters');
    } finally {
      await Connection.disconnect();
    }
  });

  it('renders SQL expression defaults without quoting them', () => {
    const table = new TableBuilder();
    table.timestamp('ran_at').default('CURRENT_TIMESTAMP');
    table.string('status').default("waiting's turn");
    table.softDeletes();

    const postgres = table.toSQL('migrations', 'postgres')[0];
    expect(postgres).toContain('"ran_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(postgres).toContain('"status" VARCHAR(255) NOT NULL DEFAULT \'waiting\'\'s turn\'');
    expect(postgres).toContain('"deleted_at" TIMESTAMP');

    const mysql = table.toSQL('migrations', 'mysql')[0];
    expect(mysql).toContain('`ran_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(mysql).toContain('`status` VARCHAR(255) NOT NULL DEFAULT \'waiting\'\'s turn\'');
    expect(mysql).toContain('`deleted_at` DATETIME');
  });

  it('renders Laravel-style id and foreignId columns with compatible MySQL types', () => {
    const users = new TableBuilder();
    users.id();

    const posts = new TableBuilder();
    posts.id();
    posts.foreignId('user_id').references('id', 'users').onDelete('cascade');

    expect(users.toSQL('users', 'mysql')[0]).toContain('`id` BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT');
    expect(posts.toSQL('posts', 'mysql')[0]).toContain('`user_id` BIGINT UNSIGNED NOT NULL');
    expect(posts.toSQL('posts', 'mysql')[0]).toContain(
      'FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE'
    );
  });

  it('uses bigint for core millisecond epoch columns on strict databases', async () => {
    const statements: string[] = [];
    await Connection.disconnect();
    Connection.configure({
      default: 'postgres',
      connections: {
        postgres: { driver: 'postgres', host: 'localhost', database: 'svelar_test' },
      },
    });

    const originalRaw = Connection.raw.bind(Connection);
    Connection.raw = (async (sql: string) => {
      statements.push(sql);
      return [];
    }) as typeof Connection.raw;

    try {
      await new CreateApiKeysTable().up();
      await new CreateAuditLogsTable().up();
      await new CreateEmailTemplatesTable().up();

      expect(statements.join('\n')).toContain('"created_at" BIGINT NOT NULL');
      expect(statements.join('\n')).toContain('"timestamp" BIGINT NOT NULL');
      expect(statements.join('\n')).not.toContain('"created_at" INTEGER NOT NULL');
    } finally {
      Connection.raw = originalRaw;
      await Connection.disconnect();
    }
  });
});
