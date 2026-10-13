import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { getHeapStatistics } from 'node:v8';
import { Connection } from '../src/database/Connection.js';
import { Migration } from '../src/database/Migration.js';
import { Model } from '../src/orm/Model.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Search, Searchable } from '../src/search/index.js';
import { ApplicationContext } from '../src/support/Context.js';

const TABLE = 'large_keyset_records';
const PRIMARY_KEY = 'record_id';
const HIDDEN = 'private_value';
const EXCLUDED_DIVISOR = 11;
const origin = { actorId: 'large-reindex-worker', tenantId: 'source-context' };

class CreateLargeKeysetRecords extends Migration {
  async up() {
    await this.schema.createTable(TABLE, table => {
      table.increments(PRIMARY_KEY);
      table.string('title');
      table.text('payload');
      table.string(HIDDEN);
    });
  }
  async down() { await this.schema.dropTable(TABLE); }
}

class RecordBase extends Model {
  static table = TABLE;
  static primaryKey = PRIMARY_KEY;
  static timestamps = false;
  static hidden = [HIDDEN];
}
function integerId(value: unknown): number {
  assert.ok(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, 'Expected a numeric custom primary key.');
  return value;
}

export interface LargeKeysetOptions {
  directory: string;
  rows: number;
  seedBatchSize: number;
  batchSize: number;
  deleteVisitedPrefix: boolean;
}

export async function runLargeKeysetProof(options: LargeKeysetOptions) {
  assert.ok(Number.isSafeInteger(options.rows) && options.rows >= 1 && options.rows <= 1_100_000);
  assert.ok(Number.isSafeInteger(options.seedBatchSize) && options.seedBatchSize >= 1 && options.seedBatchSize <= 1000);
  assert.ok(Number.isSafeInteger(options.batchSize) && options.batchSize >= 1 && options.batchSize <= 500);
  assert.ok(process.execArgv.includes('--max-old-space-size=128'));
  assert.ok(process.execArgv.includes('--max-semi-space-size=8'));
  const gc = globalThis.gc;
  assert.equal(typeof gc, 'function', 'Run the isolated fixture with --expose-gc.');
  assert.ok(gc);

  const startedAt = performance.now();
  const memory = { samples: 0, peakRssBytes: 0, peakHeapUsedBytes: 0, heapLimitBytes: getHeapStatistics().heap_size_limit };
  const sample = () => {
    const observation = process.memoryUsage();
    memory.samples++;
    memory.peakRssBytes = Math.max(memory.peakRssBytes, observation.rss);
    memory.peakHeapUsedBytes = Math.max(memory.peakHeapUsedBytes, observation.heapUsed);
  };
  const timer = setInterval(sample, 10);
  timer.unref();
  const databaseFile = join(options.directory, 'large-keyset.sqlite');
  const migration = new CreateLargeKeysetRecords();
  const originalClient = Search.getClient;
  const originalRaw = Connection.raw;
  let migrated = false;
  let guardActive = false;
  let guardControl = false;
  let lastFetchedId: number | null = null;
  const source = { seedBatches: 0, maxSeedBatch: 0, pages: 0, rowsRead: 0, maxPageRows: 0, unboundedReadsRejected: 0, offsetReads: 0 };
  const target = { documents: 0, batches: 0, maxBatch: 0, inFlight: 0, maxInFlight: 0, idChecksum: 0 };
  let modelsVisited = 0;
  let nextExpectedId = 1;
  let deletedRows = 0;
  let contextRestored = false;
  class LargeRecord extends Searchable(RecordBase) {
    shouldBeSearchable() {
      assert.equal(ApplicationContext.get('actorId'), origin.actorId);
      modelsVisited++;
      return integerId(this.getAttribute(PRIMARY_KEY)) % EXCLUDED_DIVISOR !== 0;
    }
  }
  try {
    // Observe ORM-produced SQL, not hand-written CRUD. Refuse an all-row allocation before the native driver runs it.
    Connection.raw = async function (sql: string, bindings: unknown[] = [], connectionName?: string) {
      const read = guardActive && sql.trimStart().startsWith('SELECT');
      if (read) {
        const expected = LargeRecord.query().orderBy(PRIMARY_KEY, 'asc').limit(options.batchSize);
        if (lastFetchedId !== null) expected.where(PRIMARY_KEY, '>', lastFetchedId);
        if (guardControl) source.unboundedReadsRejected++;
        assert.deepEqual({ sql, bindings }, expected.toSQL(), 'Expected a finite keyset query, never an all-row or OFFSET read.');
        source.pages++;
      }
      const result: unknown = await originalRaw.call(Connection, sql, bindings, connectionName);
      if (read) {
        assert.ok(Array.isArray(result));
        assert.ok(result.length <= options.batchSize, 'Native source page exceeds its bound.');
        source.rowsRead += result.length;
        source.maxPageRows = Math.max(source.maxPageRows, result.length);
        if (result.length) lastFetchedId = integerId(result[result.length - 1][PRIMARY_KEY]);
      }
      sample();
      return result;
    };
    Connection.configure({ default: 'large', connections: { large: { driver: 'sqlite', filename: databaseFile } } });
    await migration.up(); migrated = true;
    const seedStartedAt = performance.now();
    for (let start = 1; start <= options.rows; start += options.seedBatchSize) {
      const length = Math.min(options.seedBatchSize, options.rows - start + 1);
      const records = Array.from({ length }, (_, offset) => {
        const id = start + offset;
        return { record_id: id, title: 'Record ' + id, payload: 'payload-' + id + '-' + 'x'.repeat(192), private_value: 'fixture-hidden-value' };
      });
      await LargeRecord.query().upsert(records, [PRIMARY_KEY], []);
      source.seedBatches++; source.maxSeedBatch = Math.max(source.maxSeedBatch, length);
    }
    const seededRows = await LargeRecord.query().count();
    assert.equal(seededRows, options.rows);
    const seedMs = performance.now() - seedStartedAt;
    Search.configure({ host: 'http://bounded-capture.invalid', indexPrefix: 'large-proof' });
    Search.getClient = () => ({ index: (name: string) => {
      assert.equal(name, 'large-proof_' + TABLE);
      return { addDocuments: async (documents: readonly Record<string, unknown>[], settings: { primaryKey: string }) => {
        assert.equal(settings.primaryKey, PRIMARY_KEY);
        assert.ok(documents.length > 0 && documents.length <= options.batchSize);
        target.inFlight++; target.maxInFlight = Math.max(target.maxInFlight, target.inFlight);
        try {
          for (const document of documents) {
            while (nextExpectedId % EXCLUDED_DIVISOR === 0) nextExpectedId++;
            const id = integerId(document[PRIMARY_KEY]);
            assert.equal(id, nextExpectedId++, 'Missing, duplicated or out-of-order document during keyset reindex.');
            assert.equal(document.title, 'Record ' + id);
            assert.equal(typeof document.payload, 'string');
            assert.ok(!Object.hasOwn(document, HIDDEN), 'Hidden model storage escaped its searchable projection.');
            target.idChecksum += id;
          }
          target.documents += documents.length; target.batches++; target.maxBatch = Math.max(target.maxBatch, documents.length);
          if (options.deleteVisitedPrefix && target.batches === 1) {
            const cursor = lastFetchedId;
            assert.ok(cursor);
            deletedRows = await ApplicationContext.runIsolated({ actorId: 'prefix-deleter', tenantId: 'other-context' }, () =>
              new QueryBuilder(TABLE).where(PRIMARY_KEY, '<=', cursor).delete());
            assert.equal(deletedRows, cursor);
            contextRestored = ApplicationContext.get('actorId') === origin.actorId;
            assert.ok(contextRestored, 'Deletion context leaked into indexing.');
          }
          // Async capture makes lack of await/backpressure observable without retaining document batches.
          await setImmediate();
          sample();
          return { taskUid: target.batches };
        } finally { target.inFlight--; }
      } };
    } });
    gc(); sample();
    const heapBeforeIndex = process.memoryUsage().heapUsed;
    guardActive = true; guardControl = true;
    await assert.rejects(LargeRecord.all(), /finite keyset query/);
    assert.equal(source.rowsRead, 0); guardControl = false;
    const indexStartedAt = performance.now();
    const result = await ApplicationContext.runIsolated(origin, () => LargeRecord.makeAllSearchable(options.batchSize));
    guardActive = false;
    const indexMs = performance.now() - indexStartedAt;
    const excluded = Math.floor(options.rows / EXCLUDED_DIVISOR);
    const expectedDocuments = options.rows - excluded;
    const expectedChecksum = options.rows * (options.rows + 1) / 2 - EXCLUDED_DIVISOR * excluded * (excluded + 1) / 2;
    assert.equal(result.indexed, expectedDocuments);
    assert.equal(target.documents, expectedDocuments);
    assert.equal(target.idChecksum, expectedChecksum);
    assert.equal(source.rowsRead, options.rows);
    assert.equal(modelsVisited, options.rows);
    assert.equal(target.maxInFlight, 1);
    assert.equal(target.inFlight, 0);
    const rowsRemaining = await LargeRecord.query().count();
    assert.equal(rowsRemaining, options.rows - deletedRows);
    gc(); sample();
    const heapAfterIndex = process.memoryUsage().heapUsed;
    // maxRSS is the OS high-water mark (KiB), supplementing the periodic and per-batch observations.
    memory.peakRssBytes = Math.max(memory.peakRssBytes, process.resourceUsage().maxRSS * 1024);
    assert.ok(memory.peakRssBytes < 320 * 1024 * 1024, 'Isolated fixture exceeded its 320 MiB RSS budget.');
    assert.ok(heapAfterIndex - heapBeforeIndex < 24 * 1024 * 1024, 'Reindex retained dataset-sized JavaScript state.');
    return {
      passed: true, proof: 'sqlite-source-and-searchable-driver-contract', actualMeilisearch: false,
      seededRows, expectedDocuments, indexed: result.indexed, excludedRows: excluded, rowsRemaining, deletedRows,
      customPrimaryKey: PRIMARY_KEY, hiddenFieldWithheld: true, contextRestored,
      source, target, memory: { ...memory, oldSpaceLimitMiB: 128, semiSpaceLimitMiB: 8, heapBeforeIndex, heapAfterIndex,
        retainedHeapGrowthBytes: heapAfterIndex - heapBeforeIndex },
      durations: { seedMs, indexMs, totalMs: performance.now() - startedAt },
    };
  } finally {
    clearInterval(timer); Search.getClient = originalClient; Connection.raw = originalRaw; ApplicationContext.clear();
    try { if (migrated) await migration.down(); }
    finally { await Connection.disconnect(); }
  }
}
