import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { HasUlids, HasUuids, Model } from '../src/orm/index.js';
import { isUlid, isUuidv7 } from '../src/support/uuid.js';

class UuidPrimaryPost extends HasUuids(Model) {
  static table = 'uuid_primary_posts';
  static timestamps = false;
  static fillable = ['title'];
}

class UlidPrimaryPost extends HasUlids(Model) {
  static table = 'ulid_primary_posts';
  static timestamps = false;
  static fillable = ['title'];
}

class PublicUuidPost extends Model {
  static table = 'public_uuid_posts';
  static timestamps = false;
  static fillable = ['title', 'uuid'];
  static uniqueIds = ['uuid'];
  static uniqueIdType = 'uuid' as const;
}

class PublicUlidPost extends Model {
  static table = 'public_ulid_posts';
  static timestamps = false;
  static fillable = ['title', 'ulid'];
  static uniqueIds = ['ulid'];
  static uniqueIdType = 'ulid' as const;
}

describe('ORM unique IDs', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'svelar-unique-ids-'));
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: join(root, 'database.sqlite') },
      },
    });

    await new Schema().createTable('uuid_primary_posts', (table) => {
      table.uuid('id').primary();
      table.string('title');
    });

    await new Schema().createTable('ulid_primary_posts', (table) => {
      table.ulid('id').primary();
      table.string('title');
    });

    await new Schema().createTable('public_uuid_posts', (table) => {
      table.increments('id');
      table.uuid('uuid').unique();
      table.string('title');
    });

    await new Schema().createTable('public_ulid_posts', (table) => {
      table.increments('id');
      table.ulid('ulid').unique();
      table.string('title');
    });
  });

  afterEach(async () => {
    await Connection.disconnect();
    await rm(root, { recursive: true, force: true });
  });

  it('generates UUID v7 primary keys with HasUuids', async () => {
    const post = await UuidPrimaryPost.create({ title: 'Primary UUID' });
    const id = post.getAttribute('id');

    expect(isUuidv7(id)).toBe(true);

    const found = await UuidPrimaryPost.find(id);
    expect(found?.getAttribute('title')).toBe('Primary UUID');
  });

  it('generates ULID primary keys with HasUlids', async () => {
    const post = await UlidPrimaryPost.create({ title: 'Primary ULID' });
    const id = post.getAttribute('id');

    expect(isUlid(id)).toBe(true);

    const found = await UlidPrimaryPost.find(id);
    expect(found?.getAttribute('title')).toBe('Primary ULID');
  });

  it('generates secondary UUID v7 keys while keeping integer primary keys', async () => {
    const post = await PublicUuidPost.create({ title: 'Public UUID' });

    expect(post.getAttribute('id')).toBe(1);
    expect(isUuidv7(post.getAttribute('uuid'))).toBe(true);

    const found = await PublicUuidPost.where('uuid', post.getAttribute('uuid')).first();
    expect(found?.getAttribute('id')).toBe(1);
  });

  it('generates secondary ULID keys while keeping integer primary keys', async () => {
    const post = await PublicUlidPost.create({ title: 'Public ULID' });

    expect(post.getAttribute('id')).toBe(1);
    expect(isUlid(post.getAttribute('ulid'))).toBe(true);

    const found = await PublicUlidPost.where('ulid', post.getAttribute('ulid')).first();
    expect(found?.getAttribute('id')).toBe(1);
  });

  it('does not replace caller-provided public IDs', async () => {
    const uuid = '018f65d4-98fb-7a12-a12b-7c1190de8f37';
    const ulid = '01HX0000000000000000000000';

    const uuidPost = await PublicUuidPost.create({ title: 'Manual UUID', uuid });
    const ulidPost = await PublicUlidPost.create({ title: 'Manual ULID', ulid });

    expect(uuidPost.getAttribute('uuid')).toBe(uuid);
    expect(ulidPost.getAttribute('ulid')).toBe(ulid);
  });
});
