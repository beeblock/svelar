import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../src/database/Connection';
import { Schema } from '../src/database/SchemaBuilder';
import { Migrator } from '../src/database/Migration';
import { Mailer } from '../src/mail';
import { Model } from '../src/orm/Model';
import {
  Factory,
  actingAs,
  assertDatabaseCount,
  assertDatabaseHas,
  assertDatabaseMissing,
  createRequestEvent,
  fakeMailer,
  refreshDatabase,
} from '../src/testing';

class TestingUser extends Model {
  static table = 'testing_users';
  static timestamps = false;

  declare id: number;
  declare name: string;
  declare role: string;
}

class TestingUserFactory extends Factory<TestingUser> {
  model() {
    return TestingUser;
  }

  definition() {
    return {
      name: `User ${this.sequence}`,
      role: 'user',
    };
  }
}

let tempRoot: string | null = null;
let originalCwd: string;

async function configureDatabase(): Promise<void> {
  tempRoot = await mkdtemp(join(tmpdir(), 'svelar-testing-helpers-'));
  await Connection.disconnect();
  Connection.configure({
    default: 'sqlite',
    connections: {
      sqlite: { driver: 'sqlite', filename: join(tempRoot, 'database.sqlite') },
    },
  });
}

async function createUsersTable(): Promise<void> {
  await new Schema().createTable('testing_users', (table) => {
    table.increments('id');
    table.string('name');
    table.string('role');
  });
}

describe('testing helpers', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = null;
    Factory.resetSequence();
    await configureDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    await Connection.disconnect();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('creates mock request events with JSON body headers, locals, params, cookies, and auth users', async () => {
    const user = { id: 1, email: 'admin@svelar.dev' };
    const event = createRequestEvent({
      method: 'POST',
      url: '/api/posts?draft=true',
      body: { title: 'Hello' },
      params: { id: 'post-1' },
      locals: { traceId: 'abc' },
      cookies: { session_id: 'session-1' },
    });

    expect(event.url.pathname).toBe('/api/posts');
    expect(event.url.searchParams.get('draft')).toBe('true');
    expect(event.params).toEqual({ id: 'post-1' });
    expect(event.locals.traceId).toBe('abc');
    expect(event.cookies.get('session_id')).toBe('session-1');
    expect(event.request.headers.get('Content-Type')).toBe('application/json');
    await expect(event.request.json()).resolves.toEqual({ title: 'Hello' });

    const authed = actingAs(user, event);
    expect(authed.locals.user).toBe(user);

    const fresh = actingAs(user, { method: 'GET', url: '/api/me' });
    expect(fresh.locals.user).toBe(user);
    expect(fresh.url.pathname).toBe('/api/me');
  });

  it('makes and creates model instances from factories with resettable sequences', async () => {
    await createUsersTable();
    const factory = new TestingUserFactory();

    const made = factory.make({ role: 'admin' });
    expect(made).toBeInstanceOf(TestingUser);
    expect(made.name).toBe('User 1');
    expect(made.role).toBe('admin');

    const many = factory.makeMany(2);
    expect(many.map((user) => user.name)).toEqual(['User 2', 'User 3']);

    Factory.resetSequence();
    const created = await factory.create({ role: 'editor' });
    expect(created.id).toBe(1);
    expect(created.name).toBe('User 1');

    const createdMany = await factory.createMany(2, { role: 'member' });
    expect(createdMany.map((user) => user.id)).toEqual([2, 3]);
    await assertDatabaseCount('testing_users', 3);
    await assertDatabaseHas('testing_users', { name: 'User 1', role: 'editor' });
  });

  it('asserts database presence, absence, and filtered counts with descriptive failures', async () => {
    await createUsersTable();
    await Connection.raw('INSERT INTO "testing_users" ("name", "role") VALUES (?, ?)', ['Admin', 'admin']);
    await Connection.raw('INSERT INTO "testing_users" ("name", "role") VALUES (?, ?)', ['Demo', 'user']);

    await expect(assertDatabaseHas('testing_users', { name: 'Admin' })).resolves.toBeUndefined();
    await expect(assertDatabaseMissing('testing_users', { name: 'Missing' })).resolves.toBeUndefined();
    await expect(assertDatabaseCount('testing_users', 1, { role: 'admin' })).resolves.toBeUndefined();
    await expect(assertDatabaseCount('testing_users', 2)).resolves.toBeUndefined();

    await expect(assertDatabaseHas('testing_users', { name: 'Missing' })).rejects.toThrow(
      'assertDatabaseHas failed',
    );
    await expect(assertDatabaseMissing('testing_users', { name: 'Admin' })).rejects.toThrow(
      'assertDatabaseMissing failed',
    );
    await expect(assertDatabaseCount('testing_users', 3)).rejects.toThrow(
      'assertDatabaseCount failed',
    );
  });

  it('refreshes the database from configured migration files and custom migration table', async () => {
    const root = tempRoot!;
    const migrationsDir = join(root, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(
      join(migrationsDir, '00000001_create_widgets_table.ts'),
      `import { Migration } from '${join(originalCwd, 'src/database/Migration.ts')}';

export default class CreateWidgetsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('widgets', (table) => {
      table.increments('id');
      table.string('name');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('widgets');
  }
}
`,
    );
    await writeFile(
      join(root, 'svelar.database.json'),
      JSON.stringify({
        migrations: {
          path: 'migrations',
          table: 'test_migrations',
        },
      }),
    );

    process.chdir(root);
    await refreshDatabase();
    await Connection.raw('INSERT INTO "widgets" ("name") VALUES (?)', ['first']);
    await assertDatabaseHas('widgets', { name: 'first' });

    await refreshDatabase({ migrationsPath: 'migrations', migrationsTable: 'custom_migrations' });
    await assertDatabaseMissing('widgets', { name: 'first' });
    await assertDatabaseHas('custom_migrations', { migration: '00000001_create_widgets_table' });
  });

  it('fakes mail delivery with assertions for tests', async () => {
    const mail = fakeMailer({
      from: { name: 'Svelar Tests', address: 'tests@svelar.dev' },
    });

    await Mailer.send({
      to: ['admin@svelar.dev', 'ops@svelar.dev'],
      subject: 'Release candidate',
      text: 'Ready',
      tags: { flow: 'release' },
    });

    expect(mail.count()).toBe(1);
    expect(mail.sent()[0].message.from).toEqual({ name: 'Svelar Tests', address: 'tests@svelar.dev' });
    expect(mail.sent()[0].result.messageId).toBe('fake-1');
    expect(() => mail.assertSent((record) => record.message.subject === 'Release candidate')).not.toThrow();
    expect(() => mail.assertNotSent((record) => record.message.subject === 'Unexpected')).not.toThrow();
    expect(() => mail.assertNothingSent()).toThrow('Expected no mail');

    mail.reset();
    expect(mail.count()).toBe(0);
    expect(() => mail.assertNothingSent()).not.toThrow();
  });

  it('does not destroy existing tables when a test migration fails to import', async () => {
    await createUsersTable();
    const root = await mkdtemp(join(tmpdir(), 'svelar-broken-test-migrations-'));
    try {
      await mkdir(join(root, 'migrations'));
      await writeFile(join(root, 'migrations', 'broken.mjs.js'), "throw new Error('broken migration');");
      process.chdir(root);
      await expect(refreshDatabase({ migrationsPath: 'migrations' })).rejects.toThrow('reset was not performed');
      expect(await new Schema().hasTable('testing_users')).toBe(true);
    } finally { process.chdir(originalCwd); await rm(root, { recursive: true, force: true }); }
  });

  it('fails closed for malformed migration configuration before database reset', async () => {
    await createUsersTable();
    const root = await mkdtemp(join(tmpdir(), 'svelar-invalid-test-config-'));
    try {
      await writeFile(join(root, 'svelar.database.json'), '{invalid'); process.chdir(root);
      await expect(refreshDatabase()).rejects.toThrow('Invalid svelar.database.json');
      expect(await new Schema().hasTable('testing_users')).toBe(true);
    } finally { process.chdir(originalCwd); await rm(root, { recursive: true, force: true }); }
  });

  it.each(['postgres', 'mysql'] as const)('requires explicit acknowledgement before resetting a %s database', async (driver) => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-native-test-ack-'));
    try {
      await mkdir(join(root, 'migrations')); process.chdir(root);
      vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
      const fresh = vi.spyOn(Migrator.prototype, 'fresh').mockResolvedValue({ dropped: [], migrated: [] });
      await expect(refreshDatabase({ migrationsPath: 'migrations' })).rejects.toThrow('allowDestructiveDatabase');
      expect(fresh).not.toHaveBeenCalled();
      await refreshDatabase({ migrationsPath: 'migrations', allowDestructiveDatabase: true });
      expect(fresh).toHaveBeenCalledOnce();
    } finally { process.chdir(originalCwd); await rm(root, { recursive: true, force: true }); }
  });
});
