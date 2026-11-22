import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { redactLogText } from '../src/logging/Redaction.js';

const nativeCases = [
  { driver: 'postgres', enabled: !!process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL && !!process.env.SVELAR_TEST_POSTGRES_CLIENT },
  { driver: 'mysql', enabled: !!process.env.SVELAR_TEST_QUEUE_MYSQL_PORT && !!process.env.SVELAR_TEST_QUEUE_CLIENT },
] as const;

// Opt in only with the certification runner's explicitly supplied owned services and installed clients.
for (const testCase of nativeCases) it.skipIf(!testCase.enabled)(`${testCase.driver}: native lateral, lean and membership bindings`, async () => {
  const root = await mkdtemp(join(tmpdir(), `svelar-query-performance-${testCase.driver}-`));
  try {
    const client = testCase.driver === 'postgres' ? process.env.SVELAR_TEST_POSTGRES_CLIENT : process.env.SVELAR_TEST_QUEUE_CLIENT;
    const manifest = resolve(client!);
    const require = createRequire(manifest);
    await symlink(join(dirname(manifest), 'node_modules'), join(root, 'node_modules'));
    const source = (name: string) => fileURLToPath(new URL('../src/' + name, import.meta.url));
    const outfile = join(root, 'proof.mjs');
    await build({
      stdin: { contents: `export { QueryBuilder, TenantModel } from ${JSON.stringify(source('orm/index.ts'))};
        export { Connection } from ${JSON.stringify(source('database/Connection.ts'))};
        export { Migration } from ${JSON.stringify(source('database/Migration.ts'))};`, resolveDir: resolve('.') },
      outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', keepNames: true,
      alias: testCase.driver === 'postgres' ? { postgres: require.resolve('postgres') }
        : { 'mysql2/promise': require.resolve('mysql2/promise'), 'drizzle-orm/mysql2': require.resolve('drizzle-orm/mysql2') },
      external: ['better-sqlite3', 'drizzle-orm/better-sqlite3', ...(testCase.driver === 'postgres' ? ['mysql2/promise', 'drizzle-orm/mysql2'] : ['postgres'])],
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      logLevel: 'silent',
    });
    const proof = `
      import assert from 'node:assert/strict';
      import { randomUUID } from 'node:crypto';
      import { Connection, Migration, QueryBuilder, TenantModel } from ${JSON.stringify(pathToFileURL(outfile).href)};
      const driver = ${JSON.stringify(testCase.driver)};
      const table = 'query_perf_' + randomUUID().replaceAll('-', '');
      const children = table + '_children';
      const port = Number(process.env.SVELAR_TEST_QUEUE_MYSQL_PORT);
      if (driver === 'mysql') assert(Number.isSafeInteger(port) && port > 0 && port <= 65535);
      Connection.configure({ default: 'proof', connections: { proof: driver === 'postgres'
        ? { driver, url: process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL, prepare: true }
        : { driver, host: '127.0.0.1', port, user: 'root', password: 'queue-proof', database: 'queue_proof' } } });
      class CreateRecords extends Migration {
        async up() { await this.schema.createTable(table, (t) => {
          t.increments(); t.string('team_id'); t.integer('visible'); t.string('label').nullable();
          t.uuid('public_id').nullable(); t.bigInteger('wide').nullable(); t.boolean('active');
          t.timestamp('happened_at').nullable(); t.softDeletes();
        }); }
        async down() { await this.schema.dropTableIfExists(table); }
      }
      class CreateChildren extends Migration {
        async up() { await this.schema.createTable(children, (t) => {
          t.increments(); t.integer('parent_id'); t.string('team_id'); t.integer('visible'); t.string('label'); t.softDeletes();
        }); }
        async down() { await this.schema.dropTableIfExists(children); }
      }
      let constructions = 0;
      class Record extends TenantModel {
        static table = table; static timestamps = false; static softDeletes = true;
        static casts = { active: { get() { throw new Error('lean cast unexpectedly ran'); }, set(value) { return value; } } };
        static hidden = ['public_id'];
        constructor() { super(); constructions++; }
      }
      class Child extends TenantModel { static table = children; static timestamps = false; static softDeletes = true; }
      Record.addGlobalScope('visible', (query) => query.where('visible', 1));
      Child.addGlobalScope('visible', (query) => query.where('visible', 1));
      const firstUuid = '019e8fe5-479d-7051-9f50-0fa3b90d5ae0';
      const secondUuid = '01a20307-cdce-7e50-9c5a-ee9e6cfdad2b';
      const instant = new Date('2026-01-01T12:00:00Z');
      const migration = new CreateRecords(); const childMigration = new CreateChildren();
      let migrated = false; let childMigrated = false;
      const ids = async (query) => (await query.orderBy('id').lean().get()).map((row) => Number(row.id));
      const checks = [];
      try {
        await migration.up(); migrated = true; await childMigration.up(); childMigrated = true;
        await new QueryBuilder(table).insertMany([
          { team_id: 'a', visible: 1, label: 'first', public_id: firstUuid, wide: '9007199254740993', active: true, happened_at: instant, deleted_at: null },
          { team_id: 'a', visible: 1, label: 'second', public_id: secondUuid, wide: '9007199254740994', active: false, happened_at: null, deleted_at: null },
          { team_id: 'a', visible: 1, label: null, public_id: null, wide: null, active: true, happened_at: null, deleted_at: null },
          { team_id: 'a', visible: 0, label: 'hidden', public_id: null, wide: null, active: true, happened_at: null, deleted_at: null },
          { team_id: 'a', visible: 1, label: 'deleted', public_id: null, wide: null, active: true, happened_at: null, deleted_at: instant },
          { team_id: 'b', visible: 1, label: 'foreign', public_id: null, wide: null, active: true, happened_at: null, deleted_at: null },
        ]);
        await new QueryBuilder(children).insertMany([
          { parent_id: 1, team_id: 'a', visible: 1, label: 'old', deleted_at: null },
          { parent_id: 1, team_id: 'a', visible: 1, label: 'latest', deleted_at: null },
          { parent_id: 1, team_id: 'a', visible: 0, label: 'hidden', deleted_at: null },
          { parent_id: 1, team_id: 'a', visible: 1, label: 'deleted', deleted_at: instant },
          { parent_id: 2, team_id: 'b', visible: 1, label: 'foreign', deleted_at: null },
        ]);
        assert.deepEqual(await ids(Record.forTenant('a').whereIn('id', [1, 2])), [1, 2]);
        assert.deepEqual(await ids(Record.forTenant('a').whereIn('id', [])), []);
        assert.deepEqual(await ids(Record.forTenant('a').whereNotIn('id', [])), [1, 2, 3]);
        assert.deepEqual(await ids(Record.forTenant('a').whereIn('label', ['first', null])), [1]);
        assert.deepEqual(await ids(Record.forTenant('a').whereNotIn('label', ['first', null])), []);
        assert.deepEqual(await ids(Record.forTenant('a').whereNotIn('label', ['first'])), [2]);
        assert.deepEqual(await ids(Record.forTenant('a').whereIn('label', [null])), []);
        assert.deepEqual(await ids(Record.forTenant('a').whereNotIn('label', [null])), []);
        assert.deepEqual(await ids(Record.forTenant('a').whereNotIn('label', [])), [1, 2, 3]);
        checks.push('membership-empty-null-positive-and-negative-semantics');

        const uuid = Record.forTenant('a').whereIn('public_id', [firstUuid, secondUuid]);
        assert.deepEqual(await ids(uuid), [1, 2]);
        assert.deepEqual(await ids(Record.forTenant('a').whereIn('wide', [9007199254740993n])), [1]);
        assert.deepEqual(await ids(Record.forTenant('a').whereIn('active', [true])), [1, 3]);
        assert.deepEqual(await ids(Record.forTenant('a').whereIn('happened_at', [instant])), [1]);
        const hostile = "first') OR 1=1 --";
        assert.deepEqual(await ids(Record.forTenant('a').whereIn('label', [hostile])), []);
        assert(!Record.forTenant('a').whereIn('label', [hostile]).toSQL().sql.includes(hostile));
        if (driver === 'postgres') {
          const sql = uuid.toSQL().sql;
          assert(sql.includes('= ANY(?)'));
          assert.equal(Record.forTenant('a').whereIn('public_id', []).orderBy('id').toSQL().sql, sql);
          assert.equal(Record.forTenant('a').whereIn('public_id', [firstUuid]).orderBy('id').toSQL().sql, sql);
          const binary = await Connection.raw("SELECT encode(item, 'hex') AS value FROM unnest(?::bytea[]) AS input(item)", [[Buffer.from([0, 255])]]);
          assert.equal(binary[0].value, '00ff');
          const json = await Connection.raw("SELECT item->>'label' AS value FROM unnest(?::jsonb[]) AS input(item)", [[{ label: 'quoted\\"comma,brace}' }]]);
          assert.equal(json[0].value, 'quoted\\"comma,brace}');
          const nested = await Connection.raw('SELECT ?::integer[][] AS value', [[[1, 2], [3, 4]]]);
          assert.deepEqual(nested[0].value, [[1, 2], [3, 4]]);
          await Connection.transaction(async () => {
            const prepared = new QueryBuilder(table).select('id').whereIn('public_id', [firstUuid]);
            assert.deepEqual((await prepared.get()).map((row) => Number(row.id)), [1]);
            assert.equal((await new QueryBuilder(table).select('id').whereIn('public_id', []).get()).length, 0);
            await Connection.transaction(async () => {
              const rows = await new QueryBuilder(table).select('id').whereIn('public_id', [firstUuid, secondUuid]).orderBy('id').get();
              assert.deepEqual(rows.map((row) => Number(row.id)), [1, 2]);
            });
            const statement = prepared.toSQL().sql.replace('?', '$1');
            const plans = await Connection.raw('SELECT statement FROM pg_prepared_statements WHERE statement = ?', [statement]);
            assert.equal(plans.length, 1, 'prepare:true must create one reusable array statement on the transaction connection');
          });
        }
        checks.push('native-array-OID-inference-UUID-bigint-boolean-timestamp-and-bound-hostile-text');

        const sub = Child.forTenant('a').select('label')
          .whereColumn(children + '.parent_id', table + '.id').orderBy('id', 'desc').limit(1);
        const before = sub.toSQL();
        const left = Record.forTenant('a').select(table + '.id', 'latest.label as child_label')
          .leftJoinLateral(sub, 'latest').orderBy(table + '.id').lean();
        assert.deepEqual((await left.get()).map((row) => [Number(row.id), row.child_label]), [[1, 'latest'], [2, null], [3, null]]);
        assert.deepEqual(left.clone().toSQL(), left.toSQL()); assert.deepEqual(sub.toSQL(), before);
        const cross = Record.forTenant('a').select(table + '.id', 'latest.label as child_label')
          .crossJoinLateral(sub, 'latest').orderBy(table + '.id').lean();
        assert.deepEqual((await cross.get()).map((row) => [Number(row.id), row.child_label]), [[1, 'latest']]);
        checks.push('left-and-cross-correlated-lateral-protect-parent-and-child-scopes');

        constructions = 0;
        const lean = Record.forTenant('a').where('id', 1).lean();
        const row = await lean.firstOrFail(); assert.equal(row.public_id, firstUuid); assert(!(row instanceof Record));
        assert.equal(constructions, 0);
        assert.equal((await lean.clone().paginate(1, 2)).total, 1);
        await assert.rejects(lean.clone().update({ visible: 0 }), /read-only/);
        assert.equal(constructions, 0);
        checks.push('lean-driver-rows-no-model-no-casts-no-hidden-filter-and-read-only');

        const cached = Record.forTenant('a').whereIn('id', [1, 2]);
        const one = cached.toSQL(); const two = cached.toSQL(); assert.deepEqual(two, one);
        const expectedBinding = driver === 'postgres' ? [1, 2] : 1;
        assert.deepEqual(two.bindings[2], expectedBinding);
        if (driver === 'postgres') two.bindings[2].push(6);
        assert.deepEqual(await ids(cached), [1, 2]);
        checks.push('cached-compilation-binds-fresh-values-with-tenant-and-global-scopes');
      } finally {
        try { if (childMigrated) await childMigration.down(); }
        finally { try { if (migrated) await migration.down(); } finally { await Connection.disconnect(); } }
      }
      console.log('NATIVE_QUERY_PERFORMANCE_PROOF ' + JSON.stringify({ driver, scope: 'source-native-not-installed-artifact', checks, ownedTablesRemoved: true }));
    `;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', proof], {
      env: process.env, timeout: 25000, maxBuffer: 1024 * 1024,
    }).catch((error) => { throw new Error(redactLogText(`Native ${testCase.driver} query performance proof failed.\n${error.stdout ?? ''}\n${error.stderr ?? ''}`)); });
    const receipts = result.stdout.split('\n').filter((line) => line.startsWith('NATIVE_QUERY_PERFORMANCE_PROOF '));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0].slice('NATIVE_QUERY_PERFORMANCE_PROOF '.length));
    expect(receipt.driver).toBe(testCase.driver);
    expect(receipt.checks).toHaveLength(5);
    expect(new Set(receipt.checks).size).toBe(5);
    expect(receipt.ownedTablesRemoved).toBe(true);
    expect(result.stderr).toBe('');
    console.log(receipts[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 35000);
