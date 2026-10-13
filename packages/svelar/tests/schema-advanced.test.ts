import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Connection, type DatabaseDriver } from '../src/database/Connection.js';
import { Schema, TableBuilder, type SchemaExpression, type IndexOptions, type ColumnChangeOptions } from '../src/database/SchemaBuilder.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

afterEach(async () => { vi.restoreAllMocks(); await Connection.disconnect(); });

function mockDriver(driver: DatabaseDriver) {
  vi.spyOn(Connection, 'getDriver').mockReturnValue(driver);
  return vi.spyOn(Connection, 'raw').mockResolvedValue([]);
}

describe('Advanced schema indexes', () => {
  it.each(['sqlite', 'postgres', 'mysql'] as DatabaseDriver[])('supports large text payload storage on %s', async (driver) => {
    const raw = mockDriver(driver);
    await new Schema().createTable('payloads', (table) => { table.longText('raw_body'); });
    expect(raw.mock.calls[0][0]).toContain(driver === 'mysql' ? 'LONGTEXT' : 'TEXT');
    if (driver !== 'mysql') expect(raw.mock.calls[0][0]).not.toContain('LONGTEXT');
  });

  it('compiles a concurrent unique expression/partial/covering index without value bindings', async () => {
    const raw = mockDriver('postgres');
    await new Schema().table('records', (table) => {
      table.uniqueIndex([Schema.expression('lower("email")'), 'team_id'], 'idx_active_email', {
        where: Schema.expression('"deleted_at" IS NULL AND "amount" >= 0'),
        include: ['created_at', 'title'], concurrently: true,
      });
    });
    expect(raw).toHaveBeenCalledExactlyOnceWith(
      'CREATE UNIQUE INDEX CONCURRENTLY "idx_active_email" ON "records" ((lower("email")), "team_id") INCLUDE ("created_at", "title") WHERE ("deleted_at" IS NULL AND "amount" >= 0)', [], undefined,
    );
  });

  it('preserves trusted PostgreSQL JSONB question-mark operators without binding substitution', async () => {
    const raw = mockDriver('postgres');
    await new Schema().table('records', (table) => table.index('metadata', 'idx_metadata_ready', { where: Schema.expression('"metadata" ? \'ready\'') }));
    expect(raw.mock.calls[0]).toEqual(['CREATE INDEX "idx_metadata_ready" ON "records" ("metadata") WHERE ("metadata" ? \'ready\')', [], undefined]);
  });

  it.each(['sqlite', 'mysql'] as DatabaseDriver[])('rejects PostgreSQL-only index features before any %s DDL', async (driver) => {
    const raw = mockDriver(driver);
    const mutations = [
      (table: TableBuilder) => table.index(Schema.expression('lower(email)'), 'idx_expression'),
      (table: TableBuilder) => table.index('email', 'idx_partial', { where: Schema.expression('deleted_at IS NULL') }),
      (table: TableBuilder) => table.index('email', 'idx_cover', { include: ['title'] }),
      (table: TableBuilder) => table.index('email', 'idx_concurrent', { concurrently: true }),
      (table: TableBuilder) => table.dropIndex('idx_old', { concurrently: true }),
    ];
    for (const mutation of mutations) {
      await expect(new Schema().table('records', (table) => { table.string('added'); mutation(table); })).rejects.toThrow('PostgreSQL');
      expect(raw).not.toHaveBeenCalled();
    }
  });

  it('preflights names, INCLUDE identifiers, trusted expressions and unknown options', async () => {
    const raw = mockDriver('postgres');
    const mutations = [
      (table: TableBuilder) => table.index(Schema.expression('lower(email)')),
      (table: TableBuilder) => table.index('lower(email)', 'idx_raw'),
      (table: TableBuilder) => table.index('email', 'idx;DROP'),
      (table: TableBuilder) => table.index('email', 'idx_include', { include: ['title;DROP'] }),
      (table: TableBuilder) => table.index('email', 'idx_include', { include: [] }),
      (table: TableBuilder) => table.index('email', 'idx_forged', { where: { sql: '1=1' } as any }),
      (table: TableBuilder) => table.index('email', 'idx_raw', { where: '1=1' as any }),
      (table: TableBuilder) => table.index('email', 'idx_option', { ignored: 'SQL' } as any),
      (table: TableBuilder) => table.index('email', 'idx_boolean', { concurrently: 'yes' } as any),
    ];
    for (const mutation of mutations) {
      await expect(new Schema().createTable('records', (table) => { table.string('email'); mutation(table); })).rejects.toThrow();
      expect(raw).not.toHaveBeenCalled();
    }
  });

  it('rejects concurrent create and drop operations in the selected active transaction before earlier DDL', async () => {
    const raw = mockDriver('postgres');
    const active = vi.spyOn(Connection, 'inTransaction').mockReturnValue(true);
    const schema = new Schema('analytics');
    await expect(schema.createTable('records', (table) => { table.string('email'); table.index('email', 'idx_email', { concurrently: true }); })).rejects.toThrow('active transaction');
    await expect(schema.table('records', (table) => { table.string('added'); table.dropIndex('idx_email', { concurrently: true }); })).rejects.toThrow('active transaction');
    expect(active).toHaveBeenCalledWith('analytics'); expect(raw).not.toHaveBeenCalled();
    active.mockReturnValue(false);
    await schema.table('records', (table) => table.dropUnique('idx_email', { concurrently: true }));
    expect(raw).toHaveBeenCalledExactlyOnceWith('DROP INDEX CONCURRENTLY "idx_email"', [], 'analytics');
  });

  it('permits ordinary indexes inside active transactions', async () => {
    const raw = mockDriver('postgres'); vi.spyOn(Connection, 'inTransaction').mockReturnValue(true);
    await new Schema().table('records', (table) => table.index('email'));
    expect(raw.mock.calls[0][0]).toBe('CREATE INDEX "idx_records_email" ON "records" ("email")');
  });

  it('copies option lists rather than allowing later mutation to rewrite an index', () => {
    const include = ['title']; const columns = ['email']; const builder = new TableBuilder();
    builder.index(columns, 'idx_email', { include }); include.push('bad;SQL'); columns.push('bad;SQL');
    expect(builder.toIndexSQL('records', 'postgres')).toEqual(['CREATE INDEX "idx_email" ON "records" ("email") INCLUDE ("title")']);
  });
});

describe('Named checks and column changes', () => {
  it.each(['sqlite', 'postgres', 'mysql'] as DatabaseDriver[])('creates named checks on %s using trusted expressions', (driver) => {
    const table = new TableBuilder(); table.integer('amount'); table.check('amount_nonnegative', Schema.expression('amount >= 0'));
    expect(table.toSQL('records', driver)[0]).toContain(`${driver === 'mysql' ? 'CONSTRAINT `amount_nonnegative`' : 'CONSTRAINT "amount_nonnegative"'} CHECK (amount >= 0)`);
  });

  it.each(['postgres', 'mysql'] as DatabaseDriver[])('adds and removes named checks with the correct %s syntax', async (driver) => {
    const raw = mockDriver(driver); const quote = driver === 'mysql' ? '`' : '"';
    await new Schema().table('records', (table) => { table.dropCheck('old_check'); table.check('new_check', Schema.expression('amount > 0')); });
    expect(raw.mock.calls.map(([sql]) => sql)).toEqual([
      `ALTER TABLE ${quote}records${quote} DROP ${driver === 'mysql' ? 'CHECK' : 'CONSTRAINT'} ${quote}old_check${quote}`,
      `ALTER TABLE ${quote}records${quote} ADD CONSTRAINT ${quote}new_check${quote} CHECK (amount > 0)`,
    ]);
    expect(raw.mock.calls.every(([, values]) => values?.length === 0)).toBe(true);
  });

  it('rejects SQLite check alterations and column changes without changing earlier columns', async () => {
    const raw = mockDriver('sqlite');
    for (const mutation of [
      (table: TableBuilder) => table.check('amount_check', Schema.expression('amount > 0')),
      (table: TableBuilder) => table.dropCheck('amount_check'),
      (table: TableBuilder) => table.string('title', 300).nullable().change(),
      (table: TableBuilder) => table.alterColumn('title').default('New'),
    ]) {
      await expect(new Schema().table('records', (table) => { table.string('added'); mutation(table); })).rejects.toThrow('explicit table rebuild');
      expect(raw).not.toHaveBeenCalled();
    }
  });

  it('changes PostgreSQL type/nullability/default together and drops incompatible old defaults before USING', async () => {
    const raw = mockDriver('postgres');
    await new Schema().table('records', (table) => {
      table.integer('count').nullable().default(7).change({ using: Schema.expression('"count"::integer') });
      table.alterColumn('title').notNullable().dropDefault();
    });
    expect(raw.mock.calls.map(([sql]) => sql)).toEqual([
      'ALTER TABLE "records" ALTER COLUMN "count" DROP DEFAULT, ALTER COLUMN "count" TYPE INTEGER USING ("count"::integer), ALTER COLUMN "count" DROP NOT NULL, ALTER COLUMN "count" SET DEFAULT 7',
      'ALTER TABLE "records" ALTER COLUMN "title" DROP DEFAULT, ALTER COLUMN "title" SET NOT NULL',
    ]);
  });

  it('preserves unspecified PostgreSQL modifiers and supports explicit nullable/default-only changes', async () => {
    const raw = mockDriver('postgres');
    await new Schema().table('records', (table) => {
      table.string('title', 500).change();
      table.alterColumn('description').nullable();
      table.alterColumn('status').default("waiting's turn");
    });
    expect(raw.mock.calls.map(([sql]) => sql)).toEqual([
      'ALTER TABLE "records" ALTER COLUMN "title" TYPE VARCHAR(500)',
      'ALTER TABLE "records" ALTER COLUMN "description" DROP NOT NULL',
      'ALTER TABLE "records" ALTER COLUMN "status" SET DEFAULT \'waiting\'\'s turn\'',
    ]);
  });

  it('supports safe MySQL default-only changes and explicit complete MODIFY definitions', async () => {
    const raw = mockDriver('mysql');
    await new Schema().table('records', (table) => {
      table.alterColumn('status').default('pending'); table.alterColumn('title').dropDefault();
      table.bigInteger('amount').unsigned().notNullable().default(0).change({ replaceDefinition: true });
      table.string('description', 300).nullable().dropDefault().change({ replaceDefinition: true });
    });
    expect(raw.mock.calls.map(([sql]) => sql)).toEqual([
      "ALTER TABLE `records` ALTER COLUMN `status` SET DEFAULT 'pending'", 'ALTER TABLE `records` ALTER COLUMN `title` DROP DEFAULT',
      'ALTER TABLE `records` MODIFY COLUMN `amount` BIGINT UNSIGNED NOT NULL DEFAULT 0',
      'ALTER TABLE `records` MODIFY COLUMN `description` VARCHAR(300)',
    ]);
  });

  it('rejects unsafe or unsupported changes before any DDL', async () => {
    const raw = mockDriver('postgres');
    const mutations = [
      (table: TableBuilder) => table.alterColumn('count'),
      (table: TableBuilder) => table.alterColumn('count').change({ using: Schema.expression('count::int') }),
      (table: TableBuilder) => table.integer('count').change({ replaceDefinition: true }),
      (table: TableBuilder) => table.integer('count').unique().change(),
      (table: TableBuilder) => table.integer('count').unsigned().change(),
      (table: TableBuilder) => { const column = table.integer('count'); column.references('id', 'parents'); column.change(); },
      (table: TableBuilder) => table.integer('count').change({ using: 'count::int' as any }),
      (table: TableBuilder) => table.integer('count').change({ ignored: true } as any),
      (table: TableBuilder) => table.string('title;DROP').change(),
    ];
    for (const mutation of mutations) {
      await expect(new Schema().table('records', (table) => { table.string('added'); mutation(table); })).rejects.toThrow();
      expect(raw).not.toHaveBeenCalled();
    }
    vi.mocked(Connection.getDriver).mockReturnValue('mysql');
    for (const mutation of [
      (table: TableBuilder) => table.integer('count').change(),
      (table: TableBuilder) => table.alterColumn('count').nullable(),
      (table: TableBuilder) => table.integer('count').nullable().change({ replaceDefinition: true }),
      (table: TableBuilder) => table.integer('count').nullable().dropDefault().change({ using: Schema.expression('count::int'), replaceDefinition: true }),
    ]) {
      await expect(new Schema().table('records', (table) => { table.string('added'); mutation(table); })).rejects.toThrow();
      expect(raw).not.toHaveBeenCalled();
    }
  });

  it('rejects alter instructions during creation rather than silently ignoring them', () => {
    for (const mutation of [
      (table: TableBuilder) => table.integer('count').change(), (table: TableBuilder) => table.dropCheck('old_check'),
      (table: TableBuilder) => table.dropColumn('old'), (table: TableBuilder) => table.renameColumn('old', 'new'),
      (table: TableBuilder) => table.string('title').dropDefault(),
    ]) {
      const table = new TableBuilder(); mutation(table); expect(() => table.toSQL('records', 'postgres')).toThrow();
    }
  });

  it('actually enforces named SQLite creation checks and preserves ordinary alterations/data', async () => {
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    const schema = new Schema();
    const sentinel = "literal\\'; DROP TABLE records; --";
    await schema.createTable('records', (table) => {
      table.increments('id'); table.integer('amount').default(0); table.string('title').default(sentinel);
      table.check('amount_nonnegative', Schema.expression('amount >= 0'));
    });
    await new QueryBuilder('records').insert({ amount: 1 });
    await expect(new QueryBuilder('records').insert({ amount: -1 })).rejects.toThrow('amount_nonnegative');
    await schema.table('records', (table) => { table.string('description').nullable(); table.index('amount'); table.renameColumn('title', 'name'); });
    expect((await new QueryBuilder('records').firstOrFail()).name).toBe(sentinel);
    expect(await schema.hasTable('records')).toBe(true);
  });
});

describe('Schema trust and literal boundaries', () => {
  it('rejects raw/forged check expressions, invalid names and unsafe type dimensions', async () => {
    const raw = mockDriver('postgres');
    for (const mutation of [
      (table: TableBuilder) => table.check('ck', 'amount >= 0' as any),
      (table: TableBuilder) => table.check('bad;constraint', Schema.expression('amount >= 0')),
      (table: TableBuilder) => table.integer('count').build().type = 'INTEGER); DROP TABLE records; --',
      (table: TableBuilder) => table.string('title', '10);DROP' as any),
      (table: TableBuilder) => table.decimal('amount', -1, 2),
      (table: TableBuilder) => table.decimal('amount', 3, 4),
      (table: TableBuilder) => table.integer('id').references('id', 'parents').onDelete('CASCADE; DROP TABLE records' as any),
    ]) {
      await expect(new Schema().createTable('records', (table) => { table.increments('key'); mutation(table); })).rejects.toThrow();
      expect(raw).not.toHaveBeenCalled();
    }
  });

  it('rejects stateful objects masquerading as identifiers before SQL execution', async () => {
    const raw = mockDriver('postgres'); let calls = 0;
    const fake = { toString() { return ++calls === 1 ? 'title' : 'title"; DROP TABLE records; --'; } };
    await expect(new Schema().table('records', (table) => table.index('title', fake as any))).rejects.toThrow('identifiers must be strings');
    expect(raw).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined, {}, { sql: 'NOW()' }])('rejects invalid default %j without creating a table', async (value) => {
    const raw = mockDriver('postgres');
    await expect(new Schema().createTable('records', (table) => table.string('title').default(value as any))).rejects.toThrow();
    expect(raw).not.toHaveBeenCalled();
  });

  it('renders literal defaults safely while keeping legacy time expressions and explicit SQL', () => {
    const builder = new TableBuilder(); builder.string('title').default("literal\\';DROP"); builder.timestamp('created').default('CURRENT_TIMESTAMP');
    builder.integer('amount').default(Schema.expression('1 + 2'));
    expect(builder.toSQL('records', 'postgres')[0]).toContain("DEFAULT E'literal\\\\'';DROP'");
    expect(builder.toSQL('records', 'mysql')[0]).toContain(`DEFAULT _utf8mb4 X'${Buffer.from("literal\\';DROP").toString('hex')}'`);
    expect(builder.toSQL('records', 'sqlite')[0]).toContain("DEFAULT 'literal\\'';DROP'");
    expect(builder.toSQL('records', 'postgres')[0]).toContain('DEFAULT CURRENT_TIMESTAMP');
    expect(builder.toSQL('records', 'postgres')[0]).toContain('DEFAULT (1 + 2)');
    expect(() => Schema.expression('')).toThrow(); expect(() => Schema.expression('a\0b')).toThrow();
    expect(Object.isFrozen(Schema.expression('1'))).toBe(true);
  });

  it('quotes MySQL enum values and rejects SQL-mode-dependent backslash literals', () => {
    const table = new TableBuilder(); table.enum('status', ['CURRENT_TIMESTAMP', "waiting's turn"]);
    expect(table.toSQL('records', 'mysql')[0]).toContain("ENUM('CURRENT_TIMESTAMP','waiting''s turn')");
    const backslash = new TableBuilder(); backslash.enum('status', ["value\\';DROP"]);
    expect(() => backslash.toSQL('records', 'mysql')).toThrow('reviewed raw migration');
  });

  it('provides opaque expression types and typed index/change options', () => {
    expectTypeOf(Schema.expression('amount > 0')).toEqualTypeOf<SchemaExpression>();
    const index: IndexOptions = { where: Schema.expression('amount > 0'), include: ['title'], concurrently: true };
    const change: ColumnChangeOptions = { using: Schema.expression('count::integer') };
    expect(index.concurrently).toBe(true); expect(change.using).toBeDefined();
    const compileOnly = () => {
      // @ts-expect-error Runtime strings are not trusted expressions.
      const unsafe: IndexOptions = { where: 'amount > 0' };
      // @ts-expect-error A fabricated object cannot satisfy the expression's private brand.
      const forged: SchemaExpression = {};
      return [unsafe, forged];
    };
    expect(typeof compileOnly).toBe('function');
  });

  it('rejects async definition callbacks instead of silently omitting definitions after await', async () => {
    const raw = mockDriver('postgres');
    for (const method of ['createTable', 'table'] as const) {
      await expect(new Schema()[method]('records', async (table) => {
        table.string('title'); await Promise.resolve(); table.index('title', 'idx_title', { concurrently: true });
      })).rejects.toThrow('callbacks must be synchronous');
      expect(raw).not.toHaveBeenCalled();
    }
  });
});
