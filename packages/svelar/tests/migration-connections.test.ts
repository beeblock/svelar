import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Migration, Migrator, type MigrationFile } from '../src/database/Migration.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

beforeEach(() => {
  Connection.configure({ default: 'main', connections: {
    main: { driver: 'sqlite', filename: ':memory:' },
    reports: { driver: 'sqlite', filename: ':memory:' },
  } });
});
afterEach(async () => { await Connection.disconnect(); });

class CreateRecords extends Migration {
  async up() {
    await this.schema.createTable('records', (table) => { table.increments(); table.string('label'); });
    await new QueryBuilder('records').insert({ label: 'migration seed' });
  }
  async down() { await new Schema().dropTable('records'); }
}
const files = (): MigrationFile[] => [{ name: 'create_records', timestamp: '1', path: 'test', migration: new CreateRecords() }];

describe('Named migration connection isolation', () => {
  it('runs schema and queries on the selected database and rolls it back there', async () => {
    const migrator = new Migrator('reports');
    expect(await migrator.run(files())).toEqual(['create_records']);
    expect(await new Schema('main').hasTable('records')).toBe(false);
    expect(await new Schema('main').hasTable('migrations')).toBe(false);
    expect(await new QueryBuilder('records', undefined, 'reports').pluck('label')).toEqual(['migration seed']);
    expect(await migrator.rollback(files())).toEqual(['create_records']);
    expect(await new Schema('reports').hasTable('records')).toBe(false);
    expect(await new Schema('main').hasTable('records')).toBe(false);
  });

  it('keeps concurrent scopes, nested overrides and explicit names separate', async () => {
    let resume!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { resume = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const one = Connection.usingConnection('reports', async () => {
      await new Schema().createTable('only_reports', (table) => { table.increments(); });
      entered(); await waiting;
      expect(await new Schema().hasTable('only_main')).toBe(false);
      expect(await new Schema('main').hasTable('only_main')).toBe(true);
      await Connection.usingConnection('main', async () => {
        expect(await new Schema().hasTable('only_main')).toBe(true);
      });
      expect(await new Schema().hasTable('only_reports')).toBe(true);
    });
    await ready;
    await new Schema().createTable('only_main', (table) => { table.increments(); });
    resume(); await one;
    expect(await new Schema().hasTable('only_reports')).toBe(false);
  });

  it('uses the scoped database for implicit transactions and callbacks', async () => {
    await Connection.usingConnection('reports', async () => {
      await new Schema().createTable('records', (table) => { table.increments(); table.string('label'); });
      await Connection.transaction(async () => {
        expect(Connection.inTransaction()).toBe(true);
        expect(Connection.inTransaction('main')).toBe(false);
        await new QueryBuilder('records').insert({ label: 'scoped' });
        await Connection.afterCommit(async () => {
          expect(await new QueryBuilder('records').count()).toBe(1);
        });
      });
    });
    expect(await new Schema('main').hasTable('records')).toBe(false);
  });

  it('restores the implicit connection on failure and rejects unknown connections early', async () => {
    await expect(Connection.usingConnection('reports', async () => { throw new Error('failed migration'); })).rejects.toThrow('failed migration');
    await new Schema().createTable('on_main', (table) => { table.increments(); });
    expect(await new Schema('reports').hasTable('on_main')).toBe(false);
    expect(() => Connection.usingConnection('missing', () => {})).toThrow('not defined');
  });
});
