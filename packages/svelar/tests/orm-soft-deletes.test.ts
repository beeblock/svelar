import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Model, SoftDeletes } from '../src/orm/index.js';

class SoftDeletePost extends SoftDeletes(Model) {
  static table = 'soft_delete_posts';
  static timestamps = false;
  static fillable = ['title', 'deleted_at'];
}

describe('ORM soft deletes', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-soft-deletes-'));
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: join(root, 'database.sqlite') },
      },
    });

    await new Schema().createTable('soft_delete_posts', (table) => {
      table.increments('id');
      table.string('title');
      table.softDeletes();
    });

    await new Schema().createTable('soft_delete_post_notes', (table) => {
      table.increments('id');
      table.integer('post_id');
      table.string('body');
      table.softDeletes();
    });
  });

  afterEach(async () => {
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });

  it('excludes soft-deleted models by default and can include trashed rows explicitly', async () => {
    const post = await SoftDeletePost.create({ title: 'Draft' });

    await post.delete();

    expect(post.trashed()).toBe(true);
    await expect(SoftDeletePost.count()).resolves.toBe(0);
    await expect(SoftDeletePost.withTrashed().count()).resolves.toBe(1);

    const trashed = await SoftDeletePost.onlyTrashed().firstOrFail();
    expect(trashed.getAttribute('title')).toBe('Draft');
    expect(trashed.trashed()).toBe(true);
  });

  it('restores soft-deleted models', async () => {
    const post = await SoftDeletePost.create({ title: 'Archived' });
    await post.delete();

    const trashed = await SoftDeletePost.onlyTrashed().firstOrFail();
    await trashed.restore();

    await expect(SoftDeletePost.count()).resolves.toBe(1);
    expect(trashed.trashed()).toBe(false);
  });

  it('supports query-level soft delete, restore, and force delete', async () => {
    await SoftDeletePost.create({ title: 'One' });
    await SoftDeletePost.create({ title: 'Two' });

    await SoftDeletePost.where('title', 'One').delete();

    await expect(SoftDeletePost.count()).resolves.toBe(1);
    await expect(SoftDeletePost.onlyTrashed().count()).resolves.toBe(1);

    await SoftDeletePost.onlyTrashed().where('title', 'One').restore();
    await expect(SoftDeletePost.count()).resolves.toBe(2);

    await SoftDeletePost.where('title', 'Two').delete();
    await SoftDeletePost.onlyTrashed().where('title', 'Two').forceDelete();

    await expect(SoftDeletePost.withTrashed().count()).resolves.toBe(1);
    await expect(SoftDeletePost.where('title', 'Two').first()).resolves.toBeNull();
  });

  it('applies soft-delete SQL scopes for model queries', () => {
    expect(SoftDeletePost.query().toSQL().sql).toBe(
      'SELECT * FROM "soft_delete_posts" WHERE "soft_delete_posts"."deleted_at" IS NULL'
    );
    expect(SoftDeletePost.withTrashed().toSQL().sql).toBe(
      'SELECT * FROM "soft_delete_posts"'
    );
    expect(SoftDeletePost.onlyTrashed().toSQL().sql).toBe(
      'SELECT * FROM "soft_delete_posts" WHERE "soft_delete_posts"."deleted_at" IS NOT NULL'
    );
  });

  it('qualifies the soft-delete scope when model queries join tables with deleted_at columns', async () => {
    const post = await SoftDeletePost.create({ title: 'Joined' });
    await Connection.raw(
      'INSERT INTO soft_delete_post_notes (post_id, body, deleted_at) VALUES (?, ?, ?)',
      [post.id, 'Note', null],
    );

    const rows = await SoftDeletePost.query()
      .select('soft_delete_posts.title', 'soft_delete_post_notes.body as note_body')
      .join('soft_delete_post_notes', 'soft_delete_posts.id', '=', 'soft_delete_post_notes.post_id')
      .get() as Array<SoftDeletePost & { note_body: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('title')).toBe('Joined');
    expect(rows[0].getAttribute('note_body')).toBe('Note');
    expect(
      SoftDeletePost.query()
        .join('soft_delete_post_notes', 'soft_delete_posts.id', '=', 'soft_delete_post_notes.post_id')
        .toSQL().sql,
    ).toContain('WHERE "soft_delete_posts"."deleted_at" IS NULL');
  });
});
