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

// Use only the native runner's explicitly supplied services and clients, never an app's default database.
for (const testCase of nativeCases) it.skipIf(!testCase.enabled)(`${testCase.driver}: native log bulk ingestion, scoped idempotency and bounded pruning`, async () => {
  const root = await mkdtemp(join(tmpdir(), `svelar-log-bulk-native-${testCase.driver}-`));
  try {
    const client = testCase.driver === 'postgres' ? process.env.SVELAR_TEST_POSTGRES_CLIENT : process.env.SVELAR_TEST_QUEUE_CLIENT;
    const manifest = resolve(client!);
    const require = createRequire(manifest);
    await symlink(join(dirname(manifest), 'node_modules'), join(root, 'node_modules'));
    const source = (name: string) => fileURLToPath(new URL('../src/' + name, import.meta.url));
    const outfile = join(root, 'logging.mjs');
    await build({
      stdin: { contents: `export { LogViewerService } from ${JSON.stringify(source('logging/LogViewer.ts'))};
        export { Connection } from ${JSON.stringify(source('database/Connection.ts'))};
        export { QueryBuilder } from ${JSON.stringify(source('orm/QueryBuilder.ts'))};
        export { Migration } from ${JSON.stringify(source('database/Migration.ts'))};
        export { Schema } from ${JSON.stringify(source('database/SchemaBuilder.ts'))};`, resolveDir: resolve('.') },
      outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', keepNames: true,
      alias: testCase.driver === 'postgres' ? { postgres: require.resolve('postgres') }
        : { 'mysql2/promise': require.resolve('mysql2/promise'), 'drizzle-orm/mysql2': require.resolve('drizzle-orm/mysql2') },
      external: ['better-sqlite3', 'drizzle-orm/better-sqlite3', ...(testCase.driver === 'postgres' ? ['mysql2/promise', 'drizzle-orm/mysql2'] : ['postgres'])],
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      logLevel: 'silent',
    });
    const proof = String.raw`
      import assert from 'node:assert/strict';
      import { randomUUID } from 'node:crypto';
      import { Connection, LogViewerService, Migration, QueryBuilder, Schema } from ${JSON.stringify(pathToFileURL(outfile).href)};
      const driver = ${JSON.stringify(testCase.driver)};
      const table = 'log_bulk_' + randomUUID().replaceAll('-', '');
      const uniqueIndex = 'uq_' + table + '_idempotency';
      const port = Number(process.env.SVELAR_TEST_QUEUE_MYSQL_PORT);
      if (driver === 'mysql') assert(Number.isSafeInteger(port) && port > 0 && port <= 65535);
      const config = driver === 'postgres'
        ? { driver, url: process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL, prepare: false }
        : { driver, host: '127.0.0.1', port, user: 'root', password: 'queue-proof', database: 'queue_proof', timezone: 'Z' };
      Connection.configure({ default: 'proof', connections: { proof: config, peer: { ...config } } });
      class CreateProofLogs extends Migration {
        async up() {
          await this.schema.createTable(table, (t) => {
            t.increments('id'); t.timestamp('recorded_at'); t.string('level', 16); t.string('channel');
            t.text('message'); t.text('context'); t.string('correlation_id').nullable(); t.string('tenant_id').nullable();
            t.index('recorded_at'); t.index(['level', 'id']); t.index(['correlation_id', 'id']); t.index(['tenant_id', 'id']);
          });
        }
        async down() { await this.schema.dropTableIfExists(table); }
      }
      class AddProofIdempotency extends Migration {
        async up() {
          await this.schema.table(table, (t) => {
            t.string('idempotency_key', 64).nullable(); t.uniqueIndex('idempotency_key', uniqueIndex);
          });
        }
        async down() {
          await this.schema.table(table, (t) => { t.dropUnique(uniqueIndex); t.dropColumn('idempotency_key'); });
        }
      }
      function ownedViewer(options = {}, connection = 'proof') {
        const viewer = new LogViewerService();
        viewer.configure({ driver: 'database', connection, retentionSeconds: 60, ...options });
        // Isolate only the table resolver; execute the original public write/query/prune methods unchanged.
        Object.defineProperty(viewer, 'table', { value: () => new QueryBuilder(table, undefined, connection) });
        return viewer;
      }
      const originalRaw = Connection.raw;
      const statements = [];
      Connection.raw = async function(sql, bindings = [], connection) {
        assert(!/\bsvelar_logs\b/i.test(sql), 'Native proof must never touch the canonical log table');
        statements.push({ sql, bindings: bindings.length, connection });
        return originalRaw.call(Connection, sql, bindings, connection);
      };
      async function observe(operation) {
        const start = statements.length;
        const result = await operation();
        return { result, statements: statements.slice(start) };
      }
      function assertBulk(observed, rows, columns) {
        assert.equal(observed.result, undefined);
        assert.equal(observed.statements.length, 1, 'Bulk writes must not SELECT/COUNT or insert per entry');
        const statement = observed.statements[0];
        assert.match(statement.sql, /^INSERT INTO /);
        assert.equal(statement.bindings, rows * columns);
        const values = statement.sql.split(/\bVALUES\b/)[1].split(/\bON (?:CONFLICT|DUPLICATE)\b/)[0];
        assert.equal((values.match(/\(/g) ?? []).length, rows, 'All rows must use one VALUES list');
      }
      function assertPrune(observed, deleted, batches, batchSize) {
        assert.equal(observed.result, deleted);
        assert.equal(observed.statements.length, batches);
        for (const statement of observed.statements) {
          const sql = statement.sql.replaceAll('"', '').replaceAll(String.fromCharCode(96), '');
          assert.match(sql, /^DELETE FROM /);
          assert(sql.includes('id IN (SELECT id FROM (SELECT id FROM ' + table));
          assert(sql.includes('recorded_at < ? ORDER BY recorded_at ASC LIMIT ' + batchSize + ')'));
          assert(sql.includes('AS svelar_log_prune_batch)'));
          assert.equal(statement.bindings, 1);
          assert.equal(statement.connection, 'proof');
        }
      }
      const now = new Date('2026-11-22T12:00:00.000Z');
      const cutoff = new Date(now.getTime() - 60000);
      const entry = (message, context = {}, channel = 'audit', timestamp = now.toISOString()) => ({ timestamp, level: 'info', channel, message, context });
      const migration = new CreateProofLogs();
      const schema = new Schema('proof');
      let migrationAttempted = false;
      let ownedTableRemoved = false;
      const checks = [];
      try {
        assert.equal(await schema.hasTable(table), false);
        migrationAttempted = true;
        await migration.up();
        const viewer = ownedViewer();
        const batch = Array.from({ length: 4 }, (_, index) => entry('bulk-' + index + ' token=hidden', {
          tenantId: 'bulk-tenant', correlationId: 'bulk-correlation', nested: { password: 'hidden' },
        }));
        const legacy = await observe(() => viewer.addEntries(batch));
        assertBulk(legacy, 4, 7);
        assert(!legacy.statements[0].sql.includes('idempotency_key'));
        const stored = await viewer.query({ tenantId: 'bulk-tenant', correlationId: 'bulk-correlation' });
        assert.equal(stored.length, 4);
        assert(!JSON.stringify(stored).includes('hidden'));
        assert(stored.every((row) => row.context.nested.password === '[REDACTED]'));
        const empty = await observe(() => viewer.addEntries([]));
        assert.equal(empty.result, undefined); assert.equal(empty.statements.length, 0);
        checks.push('legacy-schema-one-multirow-insert-no-per-row-select-count-and-redaction');

        await viewer.clear();
        const idempotent = ownedViewer({ idempotency: { contextKey: 'eventId' } });
        await assert.rejects(idempotent.addEntry(entry('migration required', { eventId: 'missing-migration' })),
          (error) => error.code === (driver === 'postgres' ? '42703' : 'ER_BAD_FIELD_ERROR'));
        assert.deepEqual(await viewer.query(), []);
        await new AddProofIdempotency().up();
        checks.push('missing-idempotency-column-rejects-without-fallback-before-additive-migration');

        const original = entry('original', { tenantId: 1, eventId: 'same-event' });
        const otherTenant = entry('other tenant', { tenantId: 2, eventId: 'same-event' });
        const otherChannel = entry('other channel', { tenantId: 1, eventId: 'same-event' }, 'worker');
        const noTenant = entry('null tenant', { eventId: 'same-event' });
        const stringNullTenant = entry('string null tenant', { tenantId: 'null', eventId: 'same-event' });
        assertBulk(await observe(() => idempotent.addEntries([
          original, { ...original, message: 'same-batch duplicate' }, otherTenant, otherChannel, noTenant, stringNullTenant,
        ])), 6, 8);
        const peer = ownedViewer({ idempotency: { contextKey: 'eventId' } }, 'peer');
        assertBulk(await observe(() => peer.addEntries([
          entry('numeric/string tenant retry', { tenantId: '1', eventId: 'same-event' }),
          { ...otherTenant, message: 'tenant retry' }, { ...otherChannel, message: 'channel retry' },
          entry('null tenant retry', { tenantId: null, eventId: 'same-event' }), stringNullTenant,
          entry('absent key'), entry('absent key'),
        ])), 7, 8);
        const deduplicated = await viewer.query();
        assert.equal(deduplicated.length, 7);
        assert.deepEqual(deduplicated.slice(0, 5).map((row) => row.message),
          ['original', 'other tenant', 'other channel', 'null tenant', 'string null tenant']);
        assert.deepEqual(deduplicated.slice(0, 5).map((row) => [row.channel, row.context.tenantId ?? null]),
          [['audit', 1], ['audit', 2], ['worker', 1], ['audit', null], ['audit', 'null']]);
        const keys = await new QueryBuilder(table, undefined, 'proof').select('idempotency_key').orderBy('id').get();
        assert(keys.slice(0, 5).every((row) => /^[a-f0-9]{64}$/.test(row.idempotency_key)));
        assert(keys.slice(5).every((row) => row.idempotency_key === null));
        checks.push('idempotency-within-and-across-batches-channel-tenant-null-and-absent-key-boundaries');

        assert.notEqual(await Connection.rawClient('proof'), await Connection.rawClient('peer'));
        const race = await observe(() => Promise.all([
          idempotent.addEntry(entry('race winner a', { tenantId: 'race-tenant', eventId: 'race-event' })),
          peer.addEntry(entry('race winner b', { tenantId: 'race-tenant', eventId: 'race-event' })),
        ]));
        assert.deepEqual(race.result, [undefined, undefined]);
        assert.equal(race.statements.length, 2);
        assert(race.statements.every((statement) => /^INSERT INTO /.test(statement.sql)));
        const winners = await viewer.query({ tenantId: 'race-tenant' });
        assert.equal(winners.length, 1);
        assert(['race winner a', 'race winner b'].includes(winners[0].message));
        checks.push('independent-native-connections-concurrent-idempotency-one-winner');

        await viewer.clear();
        const retention = ownedViewer({ pruneBatchSize: 2, pruneMaxBatches: 2 });
        // Whole-second fixtures match MySQL TIMESTAMP precision while proving strict cutoff equality.
        const expired = Array.from({ length: 7 }, (_, index) => entry('expired-' + index, {}, 'retention',
          new Date(cutoff.getTime() - (index + 1) * 1000).toISOString()));
        await retention.addEntries([...expired, entry('boundary', {}, 'retention', cutoff.toISOString()), entry('recent')]);
        const before = await retention.query();
        assert.equal(before.length, 9, 'Configure/write must not silently prune');
        assertPrune(await observe(() => retention.prune(now)), 4, 2, 2);
        const afterFirst = await retention.query();
        assert.equal(before.length - afterFirst.length, 4);
        assert.equal(afterFirst.filter((row) => row.message.startsWith('expired-')).length, 3);
        assertPrune(await observe(() => retention.prune(now, { batchSize: 1, maxBatches: 2 })), 2, 2, 1);
        assert.equal((await retention.query()).length, 3);
        assertPrune(await observe(() => retention.prune(now, { batchSize: 2, maxBatches: 10 })), 1, 1, 2);
        assertPrune(await observe(() => retention.prune(now)), 0, 1, 2);
        const retained = await retention.query();
        assert.deepEqual(retained.map((row) => row.message), ['boundary', 'recent']);
        assert.equal(retained[0].timestamp, cutoff.toISOString());
        checks.push('bounded-prune-exact-deleted-counts-per-call-overrides-and-strict-cutoff');

        await retention.addEntry(entry('rollback expired', {}, 'retention', expired[0].timestamp));
        const rollback = new Error('intentional retention rollback');
        await assert.rejects(Connection.transaction(async () => {
          assert.equal(await retention.prune(now, { batchSize: 1, maxBatches: 1 }), 1);
          throw rollback;
        }, 'proof'), (error) => error === rollback);
        assert.equal((await peer.query()).filter((row) => row.message === 'rollback expired').length, 1);
        assert.equal(statements.filter((statement) => /\bCOUNT\s*\(/i.test(statement.sql)).length, 0);
        checks.push('prune-rollback-visible-from-independent-connection-and-zero-count-queries');
      } finally {
        try {
          if (migrationAttempted) {
            await migration.down();
            ownedTableRemoved = !await schema.hasTable(table);
            assert.equal(ownedTableRemoved, true);
          }
        } finally { Connection.raw = originalRaw; await Connection.disconnect(); }
      }
      console.log('NATIVE_LOG_BULK_PRUNE_PROOF ' + JSON.stringify({
        scope: 'source-native-not-installed-artifact', driver, checks, ownedTableRemoved,
        countQueries: statements.filter((statement) => /\bCOUNT\s*\(/i.test(statement.sql)).length,
      }));
    `;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', proof], {
      env: { ...process.env, TZ: 'UTC' }, timeout: 25000, maxBuffer: 1024 * 1024,
    }).catch((error) => { throw new Error(redactLogText(`Native ${testCase.driver} log bulk/prune proof failed.\n${error.stdout ?? ''}\n${error.stderr ?? ''}`)); });
    const receipts = result.stdout.split('\n').filter((line) => line.startsWith('NATIVE_LOG_BULK_PRUNE_PROOF '));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0].slice('NATIVE_LOG_BULK_PRUNE_PROOF '.length));
    expect(receipt).toMatchObject({ scope: 'source-native-not-installed-artifact', driver: testCase.driver, ownedTableRemoved: true, countQueries: 0 });
    expect(receipt.checks).toHaveLength(6);
    expect(new Set(receipt.checks).size).toBe(6);
    expect(result.stderr).toBe('');
    console.log(receipts[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 35000);
