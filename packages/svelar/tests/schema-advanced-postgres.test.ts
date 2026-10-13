import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

// Opt-in only: this proof must never connect to a developer's default database.
it.skipIf(!process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL)('executes advanced schema contracts through native Node ESM and real PostgreSQL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'svelar-schema-postgres-'));
  try {
    const outfile = join(root, 'schema.mjs');
    const require = createRequire(process.env.SVELAR_TEST_POSTGRES_CLIENT ?? resolve('package.json'));
    const schema = fileURLToPath(new URL('../src/database/SchemaBuilder.ts', import.meta.url));
    const connection = fileURLToPath(new URL('../src/database/Connection.ts', import.meta.url));
    await build({
      stdin: { contents: `export { Schema } from ${JSON.stringify(schema)}; export { Connection } from ${JSON.stringify(connection)};`, resolveDir: resolve('.') },
      outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', keepNames: true,
      alias: { postgres: require.resolve('postgres') }, external: ['better-sqlite3', 'mysql2/promise', 'drizzle-orm/mysql2', 'drizzle-orm/better-sqlite3'],
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      logLevel: 'silent',
    });
    const proof = `
      import assert from 'node:assert/strict';
      import { randomUUID } from 'node:crypto';
      import { Schema, Connection } from ${JSON.stringify(pathToFileURL(outfile).href)};
      const table = 'adv_' + randomUUID().replaceAll('-', '');
      const blocked = 'blocked_' + randomUUID().replaceAll('-', '');
      const check = 'ck_' + table;
      const index = 'idx_' + table;
      const jsonIndex = 'json_' + table;
      const otherIndex = 'other_' + table;
      const schema = new Schema('proof');
      Connection.configure({ default: 'proof', connections: {
        proof: { driver: 'postgres', url: process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL, prepare: false },
        other: { driver: 'postgres', url: process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL, prepare: false },
      }});
      try {
        await schema.createTable(table, (t) => {
          t.increments('id'); t.string('email'); t.integer('amount').default(0);
          t.string('count').default('3'); t.text('label').nullable();
          t.timestamp('created_at').default('CURRENT_TIMESTAMP'); t.timestamp('deleted_at').nullable();
          t.jsonb('metadata').nullable(); t.check(check, Schema.expression('"amount" >= 0'));
        });
        await Connection.raw('INSERT INTO "' + table + '" (email, amount, metadata) VALUES (?, ?, ?)', ['Alpha@example.com', 1, JSON.stringify({ ready: true })]);
        await assert.rejects(Connection.raw('INSERT INTO "' + table + '" (email, amount) VALUES (?, ?)', ['negative@example.com', -1]), (e) => e.code === '23514');
        await schema.table(table, (t) => t.uniqueIndex(Schema.expression('lower("email")'), index, {
          where: Schema.expression('"deleted_at" IS NULL'), include: ['created_at'], concurrently: true,
        }));
        const definitions = await Connection.raw('SELECT indexdef FROM pg_indexes WHERE indexname = ?', [index]);
        assert.match(definitions[0].indexdef, /UNIQUE INDEX/); assert.match(definitions[0].indexdef, /lower/);
        assert.match(definitions[0].indexdef, /INCLUDE/); assert.match(definitions[0].indexdef, /WHERE/);
        const validity = await Connection.raw('SELECT indisvalid FROM pg_index JOIN pg_class ON pg_class.oid = indexrelid WHERE relname = ?', [index]);
        assert.equal(validity[0].indisvalid, true);
        await assert.rejects(Connection.raw('INSERT INTO "' + table + '" (email) VALUES (?)', ['alpha@example.com']), (e) => e.code === '23505');
        await Connection.raw('INSERT INTO "' + table + '" (email, deleted_at) VALUES (?, ?)', ['alpha@example.com', '2026-01-01']);
        await schema.table(table, (t) => t.index('metadata', jsonIndex, { where: Schema.expression(${JSON.stringify('"metadata" ? \'ready\'')}) }));
        await assert.rejects(Connection.raw('CREATE INDEX "bound_' + table + '" ON "' + table + '" (amount) WHERE amount > ?', [0]), /parameter|syntax/i);
        console.log('PASS native expression/partial/INCLUDE/concurrent indexes, CHECK enforcement, JSONB operator, and no DDL bind placeholders');

        await Connection.transaction(async () => {
          assert.equal(Connection.inTransaction('proof'), true); assert.equal(Connection.inTransaction('other'), false);
          await assert.rejects(schema.table(table, (t) => { t.string('must_not_exist'); t.index('amount', 'blocked_' + table, { concurrently: true }); }), /active transaction/);
          await assert.rejects(schema.table(table, (t) => t.dropIndex(index, { concurrently: true })), /active transaction/);
          await assert.rejects(schema.createTable(blocked, (t) => { t.integer('amount'); t.index('amount', 'idx_' + blocked, { concurrently: true }); }), /active transaction/);
          // Run before acquiring a snapshot on proof: PostgreSQL concurrent builds can wait for older snapshots.
          await new Schema('other').table(table, (t) => t.index('amount', otherIndex, { concurrently: true }));
          assert.equal(await schema.hasTable(blocked), false);
          const missing = await Connection.raw('SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?', [table, 'must_not_exist']);
          assert.equal(missing.length, 0);
          assert.equal((await Connection.raw('SELECT 1 AS healthy'))[0].healthy, 1);
        }, 'proof');
        console.log('PASS active transaction preflight, no earlier DDL, original transaction health, and named connection isolation');

        await schema.table(table, (t) => {
          t.integer('count').nullable().default(7).change({ using: Schema.expression('"count"::integer') });
          t.alterColumn('amount').nullable().dropDefault(); t.string('email', 500).change();
        });
        const columns = await Connection.raw('SELECT column_name, data_type, is_nullable, column_default, character_maximum_length FROM information_schema.columns WHERE table_name = ?', [table]);
        const count = columns.find((c) => c.column_name === 'count');
        assert.equal(count.data_type, 'integer'); assert.equal(count.is_nullable, 'YES'); assert.match(count.column_default, /7/);
        const amount = columns.find((c) => c.column_name === 'amount'); assert.equal(amount.is_nullable, 'YES'); assert.equal(amount.column_default, null);
        const email = columns.find((c) => c.column_name === 'email'); assert.equal(email.character_maximum_length, 500); assert.equal(email.is_nullable, 'NO');
        assert.equal((await Connection.raw('SELECT "count" FROM "' + table + '" ORDER BY id LIMIT 1'))[0].count, 3);
        const sentinel = ${JSON.stringify("literal\\'; DROP TABLE records; --")};
        await schema.table(table, (t) => t.alterColumn('label').default(sentinel));
        await Connection.raw('INSERT INTO "' + table + '" (email) VALUES (?)', ['default@example.com']);
        const defaults = await Connection.raw('SELECT label, "count" FROM "' + table + '" WHERE email = ?', ['default@example.com']);
        assert.equal(defaults[0].label, sentinel); assert.equal(defaults[0].count, 7);
        await assert.rejects(schema.table(table, (t) => t.bigInteger('amount').notNullable().default(9).change()), (e) => e.code === '23502');
        const unchanged = (await Connection.raw('SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = ? AND column_name = ?', [table, 'amount']))[0];
        assert.equal(unchanged.data_type, 'integer'); assert.equal(unchanged.is_nullable, 'YES'); assert.equal(unchanged.column_default, null);
        await Connection.raw('UPDATE "' + table + '" SET amount = ? WHERE amount IS NULL', [1]);
        await schema.table(table, (t) => t.alterColumn('amount').notNullable().default(2));
        assert.equal((await Connection.raw('SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?', [table, 'amount']))[0].is_nullable, 'NO');
        console.log('PASS USING type conversions, preservation of unspecified modifiers, nullable/default changes, and safe default literal round-trip');

        await Connection.raw('UPDATE "' + table + '" SET amount = ? WHERE amount = ?', [1, 0]);
        await schema.table(table, (t) => { t.dropCheck(check); t.check(check, Schema.expression('amount >= 1')); });
        await assert.rejects(Connection.raw('INSERT INTO "' + table + '" (email, amount) VALUES (?, ?)', ['too-small@example.com', 0]), (e) => e.code === '23514');
        await schema.table(table, (t) => t.dropCheck(check));
        await Connection.raw('INSERT INTO "' + table + '" (email, amount) VALUES (?, ?)', ['allowed@example.com', -1]);
        await schema.table(table, (t) => { t.dropIndex(index, { concurrently: true }); t.dropIndex(jsonIndex); t.dropIndex(otherIndex, { concurrently: true }); });
        assert.equal((await Connection.raw('SELECT indexname FROM pg_indexes WHERE indexname = ?', [index])).length, 0);
        console.log('PASS named CHECK replacement/removal and concurrent index cleanup');
      } finally {
        await schema.dropTableIfExists(blocked); await schema.dropTableIfExists(table); await Connection.disconnect();
      }
    `;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', proof], {
      env: process.env, timeout: 25000, maxBuffer: 1024 * 1024,
    }).catch((error) => { throw new Error(`Native PostgreSQL proof failed.\n${error.stdout ?? ''}\n${error.stderr ?? ''}`); });
    expect(result.stdout.match(/^PASS /gm)).toHaveLength(4);
    expect(result.stderr).toBe('');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 35000);
