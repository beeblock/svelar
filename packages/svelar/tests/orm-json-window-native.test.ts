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
  { driver: 'postgres', enabled: !!process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL },
  { driver: 'mysql', enabled: !!process.env.SVELAR_TEST_QUEUE_MYSQL_PORT && !!process.env.SVELAR_TEST_QUEUE_CLIENT },
] as const;

// Only the existing native runner's explicitly supplied owned services are used; never default app connections.
for (const testCase of nativeCases) it.skipIf(!testCase.enabled)(`${testCase.driver}: executes source-native JSON/window contracts with real tenant/global scopes`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'svelar-json-window-' + testCase.driver + '-'));
  try {
    if (testCase.driver === 'mysql') {
      const port = Number(process.env.SVELAR_TEST_QUEUE_MYSQL_PORT);
      expect(Number.isSafeInteger(port) && port > 0 && port <= 65535).toBe(true);
    }
    const outfile = join(root, 'orm.mjs');
    const client = testCase.driver === 'postgres' ? process.env.SVELAR_TEST_POSTGRES_CLIENT : process.env.SVELAR_TEST_QUEUE_CLIENT;
    const manifest = resolve(client ?? 'package.json');
    const require = createRequire(manifest);
    await symlink(join(dirname(manifest), 'node_modules'), join(root, 'node_modules'));
    const source = (name: string) => fileURLToPath(new URL('../src/' + name, import.meta.url));
    await build({
      stdin: { contents: `export { QueryBuilder, TenantModel } from ${JSON.stringify(source('orm/index.ts'))};
        export { Schema } from ${JSON.stringify(source('database/SchemaBuilder.ts'))};
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
      const table = 'json_window_' + randomUUID().replaceAll('-', '');
      const driver = ${JSON.stringify(testCase.driver)};
      const checks = [];
      Connection.configure({ default: 'proof', connections: {
        proof: driver === 'postgres' ? { driver, url: process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL, prepare: false }
          : { driver, host: '127.0.0.1', port: Number(process.env.SVELAR_TEST_QUEUE_MYSQL_PORT), user: 'root', password: 'queue-proof', database: 'queue_proof' },
      }});
      class CreateProofRecords extends Migration {
        async up() { await this.schema.createTable(table, (t) => {
          t.increments('id'); t.string('team_id'); t.integer('visible'); t.string('category'); t.integer('amount');
          t.jsonb('metadata'); t.jsonb('tags').nullable(); t.softDeletes();
        }); }
        async down() { await this.schema.dropTableIfExists(table); }
      }
      class Record extends TenantModel { static table = table; static timestamps = false; static softDeletes = true; }
      Record.addGlobalScope('visible', (query) => query.where('visible', 1));
      const migration = new CreateProofRecords(); let migrated = false;
      const ids = (records) => records.map((row) => Number(row.getAttribute('id')));
      try {
        await migration.up(); migrated = true;
        const rows = [
          { team_id: 'a', visible: 1, category: 'x', amount: 10, metadata: { ready: true, nested: { state: 'safe' } }, tags: ['one', 'two'], deleted_at: null },
          { team_id: 'a', visible: 1, category: 'x', amount: 20, metadata: { ready: false }, tags: ['two'], deleted_at: null },
          { team_id: 'a', visible: 0, category: 'x', amount: 100, metadata: { ready: true }, tags: [], deleted_at: null },
          { team_id: 'b', visible: 1, category: 'x', amount: 999, metadata: { ready: true }, tags: [], deleted_at: null },
          { team_id: 'a', visible: 1, category: 'y', amount: 30, metadata: { ready: true }, tags: [], deleted_at: null },
          { team_id: 'a', visible: 1, category: 'x', amount: 15, metadata: { nested: { ready: true } }, tags: { one: true }, deleted_at: null },
          { team_id: 'a', visible: 1, category: 'x', amount: 500, metadata: { ready: true }, tags: [], deleted_at: '2026-01-01' },
          { team_id: 'a', visible: 1, category: 'y', amount: 40, metadata: {}, tags: null, deleted_at: null },
        ];
        await new QueryBuilder(table).insertMany(rows.map((row) => ({ ...row, metadata: JSON.stringify(row.metadata), tags: row.tags === null ? null : JSON.stringify(row.tags) })));
        if (driver === 'postgres') {
        const raw = await Connection.raw('SELECT id FROM "' + table + '" WHERE metadata ? ? AND team_id = ? AND visible = ? AND deleted_at IS NULL AND amount > ? ORDER BY id', ['ready', 'a', 1, 5]);
        assert.deepEqual(raw.map((row) => Number(row.id)), [1, 2, 5]);
        checks.push('real-JSONB-question-mark-operator-with-key-and-filter-bindings');

        const scoped = Record.forTenant('a').whereJsonContainsKey('metadata', 'ready');
        assert.deepEqual(ids(await scoped.clone().orderBy('id').get()), [1, 2, 5]);
        assert.deepEqual(ids(await scoped.clone().whereJsonContains('metadata', { ready: true }).orderBy('id').get()), [1, 5]);
        assert.deepEqual(ids(await Record.forTenant('a').whereJsonContains('metadata', { nested: { state: 'safe' } }).get()), [1]);
        assert.deepEqual(ids(await Record.forTenant('a').whereJsonDoesntContain('metadata', { ready: false }).orderBy('id').get()), [1, 5, 6, 8]);
        assert.deepEqual(ids(await Record.forTenant('a').whereJsonDoesntContainKey('metadata', 'ready').orderBy('id').get()), [6, 8]);
        assert.deepEqual(ids(await Record.forTenant('a').whereJsonContainsKey('tags', 'one').orderBy('id').get()), [1, 6]);
        checks.push('native-JSONB-containment-negation-and-top-level-existence');
        } else {
          const query = Record.forTenant('a').where('amount', '>', 0); const before = query.toSQL();
          assert.throws(() => query.whereJsonContains('metadata', { ready: true }), /requires PostgreSQL/);
          assert.throws(() => query.whereJsonContainsKey('metadata', 'ready'), /requires PostgreSQL/);
          assert.throws(() => query.whereJsonDoesntContain('metadata', false), /requires PostgreSQL/);
          assert.throws(() => query.whereJsonDoesntContainKey('metadata', 'ready'), /requires PostgreSQL/);
          assert.deepEqual(query.toSQL(), before);
          checks.push('PostgreSQL-only-JSONB-rejected-before-mutation-on-real-MySQL-config');
        }

        assert.deepEqual(ids(await Record.forTenant('a').whereJsonLength('tags', 0).get()), [5]);
        assert.deepEqual(ids(await Record.forTenant('a').whereJsonLength('tags', '!=', 0).orderBy('id').get()), [1, 2]);
        assert.deepEqual(ids(await Record.forTenant('a').whereJsonLength('tags', 2).orWhereJsonLength('tags', 0).orderBy('id').get()), [1, 5]);
        checks.push('array-only-length-null-object-and-scoped-OR-boundaries');

        const query = Record.forTenant('a').select('id', 'category', 'amount')
          .selectRaw('? as marker', ['bound-marker'])
          .selectWindow('ordinal', { function: 'row_number', partitionBy: ['category'], orderBy: [{ column: 'amount' }, { column: 'id' }] })
          .selectWindow('running', { function: 'sum', column: 'amount', partitionBy: ['category'], orderBy: [{ column: 'amount' }, { column: 'id' }], frame: 'running' })
          .selectWindow('partition_count', { function: 'count', column: '*', partitionBy: ['category'] })
          .whereJsonLength('tags', '>=', 0).orderBy('id');
        if (driver === 'postgres') query.whereJsonContainsKey('metadata', 'ready');
        const before = query.toSQL(); const observed = await query.get();
        assert.deepEqual(observed.map((row) => ['id', 'ordinal', 'running', 'partition_count'].map((key) => Number(row.getAttribute(key)))), [[1, 1, 10, 2], [2, 2, 30, 2], [5, 1, 30, 1]]);
        assert(observed.every((row) => row.getAttribute('marker') === 'bound-marker'));
        assert.deepEqual(query.clone().toSQL(), before);
        const changed = query.clone().where('amount', '>', 10);
        assert.deepEqual(ids(await changed.get()), [2, 5]); assert.deepEqual(query.toSQL(), before);
        checks.push('windows-bindings-tenant-global-soft-delete-scopes-and-clones');

        const ranked = await Record.forTenant('a').select('id')
          .selectWindow('ranking', { function: 'rank', orderBy: [{ column: 'amount' }] })
          .selectWindow('dense', { function: 'dense_rank', orderBy: [{ column: 'amount' }] })
          .selectWindow('average', { function: 'avg', column: 'amount', partitionBy: ['category'] })
          .selectWindow('lowest', { function: 'min', column: 'amount', partitionBy: ['category'] })
          .selectWindow('highest', { function: 'max', column: 'amount', partitionBy: ['category'] }).orderBy('id').get();
        assert.deepEqual(ranked.map((row) => ['id', 'ranking', 'dense', 'average', 'lowest', 'highest'].map((key) => Number(row.getAttribute(key)))),
          [[1, 1, 1, 15, 10, 20], [2, 3, 3, 15, 10, 20], [5, 4, 4, 35, 30, 40], [6, 2, 2, 15, 10, 20], [8, 5, 5, 35, 30, 40]]);
        checks.push('all-allowlisted-ranking-and-aggregate-window-functions');

        if (driver === 'postgres') {
        const hostileKey = "ready' OR 1=1 -- ?";
        const hostile = Record.forTenant('a').whereJsonContainsKey('metadata', hostileKey);
        assert(!hostile.toSQL().sql.includes(hostileKey)); assert.deepEqual(ids(await hostile.get()), []);
        const immutable = { nested: { state: 'safe' } };
        const saved = Record.forTenant('a').whereJsonContains('metadata', immutable);
        immutable.nested.state = 'changed'; assert.deepEqual(ids(await saved.get()), [1]);
        checks.push('bound-hostile-keys-and-immutable-JSON-value-snapshots');
        }

        const original = query.toSQL(); const cycle = {}; cycle.self = cycle;
        assert.throws(() => query.whereJsonContains('metadata', cycle));
        assert.throws(() => query.selectWindow('unsafe.alias', { function: 'count', column: '*' }));
        assert.throws(() => query.selectWindow('result', { function: 'pg_sleep', column: 'amount' }));
        assert.throws(() => query.whereJsonLength('tags', '>= 0 OR 1=1', 0));
        assert.deepEqual(query.toSQL(), original);
        assert.equal(await new QueryBuilder(table).count(), 8);
        checks.push('invalid-input-preflight-retains-query-and-real-database-state');
      } finally {
        try { if (migrated) await migration.down(); }
        finally { await Connection.disconnect(); }
      }
      console.log('NATIVE_JSON_WINDOW_PROOF ' + JSON.stringify({ scope: 'source-native-not-installed-artifact', driver, node: process.version, checks, ownedTableRemoved: true }));
    `;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', proof], {
      env: process.env, timeout: 25000, maxBuffer: 1024 * 1024,
    }).catch((error) => { throw new Error(redactLogText(`Native ${testCase.driver} JSON/window proof failed.\n${error.stdout ?? ''}\n${error.stderr ?? ''}`)); });
    const receipts = result.stdout.split('\n').filter((line) => line.startsWith('NATIVE_JSON_WINDOW_PROOF '));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0].slice('NATIVE_JSON_WINDOW_PROOF '.length));
    expect(receipt.scope).toBe('source-native-not-installed-artifact');
    const expected = testCase.driver === 'postgres' ? 7 : 5;
    expect(receipt.driver).toBe(testCase.driver);
    expect(receipt.checks).toHaveLength(expected); expect(new Set(receipt.checks).size).toBe(expected);
    expect(receipt.ownedTableRemoved).toBe(true); expect(result.stderr).toBe('');
    console.log(receipts[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 35000);
