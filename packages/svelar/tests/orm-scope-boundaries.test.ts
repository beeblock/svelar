import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Model, SoftDeletes, TenantModel } from '../src/orm/index.js';
import { Teams } from '../src/teams/index.js';

class ScopedRecord extends SoftDeletes(TenantModel) {
  static table = 'scoped_records';
  static timestamps = false;
  static fillable = ['slug', 'title', 'status'];
}

class PlainRecord extends Model {
  static table = 'scoped_records';
  static timestamps = false;
  static fillable = ['slug', 'title', 'status'];
}

describe('ORM predicate boundaries', () => {
  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    await new Schema().createTable('scoped_records', (table) => {
      table.increments('id');
      table.string('team_id').nullable();
      table.string('slug').unique();
      table.string('title');
      table.string('status');
      table.softDeletes();
      table.uniqueIndex(['team_id', 'slug']);
    });
    Teams.configure({ driver: 'memory' });
    await Teams.runWithTeam('a', async () => {
      await ScopedRecord.create({ slug: 'a-first', title: 'First', status: 'todo' });
      await ScopedRecord.create({ slug: 'a-second', title: 'Second', status: 'doing' });
      const deleted = await ScopedRecord.create({ slug: 'a-deleted', title: 'Deleted', status: 'doing' });
      await deleted.delete();
    });
    await Teams.runWithTeam('b', () => ScopedRecord.create({ slug: 'b-only', title: 'Foreign', status: 'doing' }));
  });

  afterEach(async () => {
    Teams.clearCurrentTeam();
    ScopedRecord.removeObservers();
    PlainRecord.removeObservers();
    await Connection.disconnect();
  });

  it.each(['fluent', 'raw'] as const)('keeps %s OR predicates inside tenant and soft-delete scopes', async (mode) => {
    await Teams.runWithTeam('a', async () => {
      const query = ScopedRecord.query();
      if (mode === 'fluent') query.where('status', 'todo').orWhere('status', 'doing');
      else query.whereRaw('status = ? OR status = ?', ['todo', 'doing']);
      expect((await query.orderBy('id').get()).map((row) => row.getAttribute('slug'))).toEqual(['a-first', 'a-second']);
    });
  });

  it('scopes bulk OR updates and deletes to active rows in the current tenant', async () => {
    await Teams.runWithTeam('a', async () => {
      const query = ScopedRecord.where('status', 'todo').orWhere('status', 'doing');
      expect(await query.clone().update({ title: 'Own' })).toBe(2);
      expect(await query.clone().delete()).toBe(2);
    });
    const rows = await ScopedRecord.withoutTenantScope().withTrashed().orderBy('id').get();
    expect(rows.map((row) => row.getAttribute('title'))).toEqual(['Own', 'Own', 'Deleted', 'Foreign']);
    expect(rows[3].getAttribute('deleted_at')).toBeNull();
  });

  it('groups existing OR filters before adding helper search criteria and primary keys', async () => {
    const query = PlainRecord.where('status', 'todo').orWhere('status', 'doing');
    const original = query.toSQL();
    const match = await query.firstOrCreate({ slug: 'a-second' }, { title: 'Ignored' });
    expect(match.getAttribute('slug')).toBe('a-second');
    await query.updateOrCreate({ slug: 'a-second' }, { title: 'Only this record' });
    expect(query.toSQL()).toEqual(original);
    expect((await PlainRecord.orderBy('id').get()).map((row) => row.getAttribute('title')))
      .toEqual(['First', 'Only this record', 'Deleted', 'Foreign']);
  });

  it('does not find a foreign or trashed match through helper OR predicates', async () => {
    await Teams.runWithTeam('a', async () => {
      const query = ScopedRecord.where('status', 'todo').orWhere('status', 'doing');
      await expect(query.firstOrCreate({ slug: 'b-only' }, { title: 'Attempt', status: 'todo' })).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
      await expect(query.firstOrCreate({ slug: 'a-deleted' }, { title: 'Attempt', status: 'todo' })).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
    });
    expect((await ScopedRecord.withoutTenantScope().withTrashed().get()).map((row) => row.getAttribute('title')))
      .toEqual(['First', 'Second', 'Deleted', 'Foreign']);
  });

  it('rejects cross-tenant writes through direct model query builders', async () => {
    await Teams.runWithTeam('a', async () => {
      await expect(ScopedRecord.query().insert({ team_id: 'b', slug: 'forged', title: 'Bad', status: 'todo' })).rejects.toThrow('different tenant');
      await expect(ScopedRecord.query().update({ team_id: 'b' })).rejects.toThrow('different tenant');
    });
  });

  it('keeps captured query ownership when the ambient tenant changes before insertion', async () => {
    const query = await Teams.runWithTeam('a', async () => ScopedRecord.query());
    const model = await Teams.runWithTeam('b', () => query.firstOrCreate({ slug: 'captured' }, { title: 'Captured', status: 'todo' }));
    expect(model.getAttribute('team_id')).toBe('a');
    expect((await ScopedRecord.withoutTenantScope().where('slug', 'captured').first())?.getAttribute('team_id')).toBe('a');
  });

  it('requires tenant-qualified upsert identity and never updates a conflicting foreign row', async () => {
    await Teams.runWithTeam('a', async () => {
      await expect(ScopedRecord.withTrashed().upsert({ slug: 'b-only', title: 'Attack', status: 'doing' }, ['slug'], ['title']))
        .rejects.toThrow('conflict columns');
      await expect(ScopedRecord.withTrashed().upsert({ slug: 'b-only', title: 'Attack', status: 'doing' }, ['team_id', 'slug'], ['title']))
        .rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
      await ScopedRecord.withTrashed().upsert({ slug: 'a-first', title: 'Own update', status: 'todo' }, ['team_id', 'slug'], ['title']);
    });
    expect((await ScopedRecord.withoutTenantScope().where('slug', 'b-only').first())?.getAttribute('title')).toBe('Foreign');
    expect((await ScopedRecord.withoutTenantScope().where('slug', 'a-first').first())?.getAttribute('title')).toBe('Own update');
  });

  it('preserves explicit forTenant ownership on helpers and bulk writes without ambient context', async () => {
    const created = await ScopedRecord.forTenant('a').firstOrCreate({ slug: 'explicit' }, { title: 'Explicit', status: 'todo' });
    expect(created.getAttribute('team_id')).toBe('a');
    await expect(ScopedRecord.forTenant('a').withTrashed().upsert({ team_id: 'a', slug: 'b-only', title: 'Attack', status: 'doing' }, ['slug'], ['title']))
      .rejects.toThrow('conflict columns');
    await expect(ScopedRecord.forTenant('a').updateOrCreate({ slug: 'a-first' }, { team_id: 'b' }))
      .rejects.toThrow('different tenant');
    expect((await ScopedRecord.withoutTenantScope().where('slug', 'b-only').first())?.getAttribute('title')).toBe('Foreign');
  });

  it('rejects bulk row and soft-delete filters rather than silently discarding them', async () => {
    await Teams.runWithTeam('a', async () => {
      const row = { slug: 'a-first', title: 'Bulk', status: 'todo' };
      await expect(ScopedRecord.query().upsert(row, ['team_id', 'slug'], ['title'])).rejects.toThrow('row filters or soft-delete scopes');
      await expect(ScopedRecord.withTrashed().where('status', 'doing').upsert(row, ['team_id', 'slug'], ['title']))
        .rejects.toThrow('row filters or soft-delete scopes');
    });
  });
});
