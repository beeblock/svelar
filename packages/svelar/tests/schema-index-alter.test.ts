import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connection, type DatabaseDriver } from '../src/database/Connection.js';
import { Schema, TableBuilder } from '../src/database/SchemaBuilder.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await Connection.disconnect();
});

describe('Schema index alterations', () => {
  it.each<DatabaseDriver>(['sqlite', 'postgres', 'mysql'])('emits named ordinary/unique indexes and portable drops for %s', async (driver) => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    const execute = vi.spyOn(Connection, 'raw').mockResolvedValue([]);
    const quote = (name: string) => driver === 'mysql' ? `\`${name}\`` : `"${name}"`;
    await new Schema().table('records', (table) => {
      table.dropUnique('idx_records_old');
      table.string('scope');
      table.index('scope', 'idx_records_scope');
      table.uniqueIndex(['scope', 'key'], 'idx_records_scoped_key');
    });
    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      `DROP INDEX ${quote('idx_records_old')}${driver === 'mysql' ? ` ON ${quote('records')}` : ''}`,
      `ALTER TABLE ${quote('records')} ADD COLUMN ${quote('scope')} VARCHAR(255) NOT NULL`,
      `CREATE INDEX ${quote('idx_records_scope')} ON ${quote('records')} (${quote('scope')})`,
      `CREATE UNIQUE INDEX ${quote('idx_records_scoped_key')} ON ${quote('records')} (${quote('scope')}, ${quote('key')})`,
    ]);
  });

  it.each<DatabaseDriver>(['sqlite', 'postgres', 'mysql'])('preflights all index identifiers before any %s DDL', async (driver) => {
    vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
    const execute = vi.spyOn(Connection, 'raw').mockResolvedValue([]);
    const invalid = [
      (table: TableBuilder) => table.index('scope', 'bad; DROP TABLE records'),
      (table: TableBuilder) => table.uniqueIndex('bad column', 'idx_scope'),
      (table: TableBuilder) => table.index([]),
      (table: TableBuilder) => table.dropIndex('bad index'),
    ];
    for (const add of invalid) {
      await expect(new Schema().table('records', (table) => { table.string('scope'); add(table); })).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it('adds/replaces uniqueness on an existing SQLite table without changing its rows', async () => {
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    const schema = new Schema();
    await schema.createTable('records', (table) => {
      table.increments('id'); table.string('scope'); table.string('key');
      table.uniqueIndex('key', 'idx_records_key');
    });
    await new QueryBuilder('records').insert({ scope: 'a', key: 'same' });
    await schema.table('records', (table) => {
      table.dropIndex('idx_records_key');
      table.uniqueIndex(['scope', 'key'], 'idx_records_scoped_key');
    });
    await new QueryBuilder('records').insert({ scope: 'b', key: 'same' });
    await expect(new QueryBuilder('records').insert({ scope: 'a', key: 'same' })).rejects.toThrow();
    expect(await new QueryBuilder('records').count()).toBe(2);
    await schema.table('records', (table) => { table.dropUnique('idx_records_scoped_key'); table.dropColumn('scope'); });
    expect(await new QueryBuilder('records').count()).toBe(2);
  });

  it('does not silently ignore index-removal instructions during table creation', () => {
    const builder = new TableBuilder();
    builder.string('key'); builder.dropIndex('idx_old');
    expect(() => builder.toSQL('records', 'sqlite')).toThrow('Schema.table');
  });
});
