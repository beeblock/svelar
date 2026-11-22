import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { redactLogText } from '../src/logging/Redaction.js';

const support = fileURLToPath(new URL('./scheduler-native-support.ts', import.meta.url));

it('keeps transport timers live while scheduler timers are deterministic and distinguishes lock reads from mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'svelar-scheduler-clock-'));
  try {
    const outfile = join(root, 'clock.mjs');
    await build({ entryPoints: [support], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
    const proof = `
      import assert from 'node:assert/strict';
      import timers, { setTimeout as transportTimeout } from 'node:timers';
      import { setTimeout as promiseTimeout } from 'node:timers/promises';
      import { schedulerClock, setTimeout as schedulerTimeout, setInterval as schedulerInterval,
        clearInterval as clearSchedulerInterval, isSchedulerLeaseMutation } from ${JSON.stringify(pathToFileURL(outfile).href)};
      const realNow = Date.now();
      const at = new Date('2026-10-14T12:00:01Z');
      let callbacks = 0;
      try {
        schedulerClock.enable(at);
        assert.equal(Date.now(), at.getTime());
        schedulerTimeout(() => { callbacks++; }, 0);
        // postgres.js reconnect() uses a zero-delay transport timeout. It must complete without ticking the scheduler.
        await new Promise(resolve => globalThis.setTimeout(resolve, 0));
        await new Promise(resolve => transportTimeout(resolve, 0));
        await new Promise(resolve => timers.setTimeout(resolve, 0));
        await promiseTimeout(0);
        assert.equal(callbacks, 0);
        schedulerClock.tick(0);
        assert.equal(callbacks, 1);
        const interval = schedulerInterval(() => { callbacks++; }, 5000);
        schedulerClock.tick(5000);
        assert.equal(callbacks, 2);
        clearSchedulerInterval(interval);
        schedulerClock.tick(5000);
        assert.equal(callbacks, 2);
        assert.equal(Date.now(), at.getTime() + 10000);
      } finally { schedulerClock.reset(); }
      assert(Date.now() >= realNow);
      for (const quote of ['"', String.fromCharCode(96), '']) {
        const lock = quote + 'scheduler_locks' + quote;
        assert(isSchedulerLeaseMutation('INSERT INTO ' + lock + ' (task_key) VALUES (?)'));
        assert(isSchedulerLeaseMutation('UPDATE ' + lock + ' SET expires_at = ?'));
        assert(isSchedulerLeaseMutation('DELETE FROM ' + lock + ' WHERE task_key = ?'));
        assert(!isSchedulerLeaseMutation('SELECT task_key FROM ' + lock));
        assert(!isSchedulerLeaseMutation('UPDATE ' + quote + 'scheduler_runtime' + quote + ' SET last_checked_at = ? WHERE NOT EXISTS (SELECT task_key FROM ' + lock + ' WHERE expires_at > ?)'));
      }
      console.log('SCHEDULER_NATIVE_CLOCK_PROOF passed');
    `;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', proof], { timeout: 5000 });
    expect(result.stdout).toContain('SCHEDULER_NATIVE_CLOCK_PROOF passed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Explicit acknowledgement permits only a newly-created, randomly named database on owned loopback services.
const acknowledged = process.env.SVELAR_TEST_SCHEDULER_DATABASE_CREATE === '1';
const cases = [
  { driver: 'sqlite', client: fileURLToPath(new URL('../../../package.json', import.meta.url)), address: 'local-memory' },
  { driver: 'postgres', client: process.env.SVELAR_TEST_POSTGRES_CLIENT ?? process.env.SVELAR_TEST_QUEUE_CLIENT,
    address: process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL ?? process.env.SVELAR_TEST_QUEUE_PG_PORT },
  { driver: 'mysql', client: process.env.SVELAR_TEST_QUEUE_CLIENT, address: process.env.SVELAR_TEST_QUEUE_MYSQL_PORT },
] as const;

for (const testCase of cases) it.skipIf(testCase.driver !== 'sqlite' && (!acknowledged || !testCase.client || !testCase.address))(`${testCase.driver}: native scheduler heartbeat, request and cursor query regressions`, async () => {
  const root = await mkdtemp(join(tmpdir(), `svelar-scheduler-native-${testCase.driver}-`));
  try {
    const manifest = resolve(testCase.client!);
    const require = createRequire(manifest);
    await symlink(join(dirname(manifest), 'node_modules'), join(root, 'node_modules'));
    const source = (name: string) => fileURLToPath(new URL('../src/' + name, import.meta.url));
    const migrations = [
      ['CreateSchedulerLocksTable', '00000000_000024_create_scheduler_locks_table'],
      ['CreateScheduledTaskRunsTable', '00000000_000025_create_scheduled_task_runs_table'],
      ['CreateScheduledTaskSettingsTable', '00000000_000028_create_scheduled_task_settings_table'],
      ['AddSchedulerSettingsPolicy', '00000000_000044_add_scheduler_settings_policy'],
      ['CreateSchedulerRuntimeTable', '00000000_000047_create_scheduler_runtime_table'],
      ['CreateSchedulerRequestsTable', '00000000_000048_create_scheduler_requests_table'],
    ];
    const outfile = join(root, 'scheduler.mjs');
    await build({
      stdin: { resolveDir: resolve('.'), contents: `
        export { Connection } from ${JSON.stringify(source('database/Connection.ts'))};
        export { QueryBuilder } from ${JSON.stringify(source('orm/QueryBuilder.ts'))};
        export { Scheduler, SchedulerLock, task } from ${JSON.stringify(source('scheduler/index.ts'))};
        export { ApplicationContext } from ${JSON.stringify(source('support/Context.ts'))};
        export { schedulerClock, isSchedulerLeaseMutation } from ${JSON.stringify(support)};
        ${migrations.map(([name, file]) => `export { ${name} } from ${JSON.stringify(source(`database/core/${file}.ts`))};`).join('\n')}
      ` },
      outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', keepNames: true,
      alias: testCase.driver === 'postgres' ? { postgres: require.resolve('postgres') }
        : testCase.driver === 'mysql' ? { 'mysql2/promise': require.resolve('mysql2/promise'), 'drizzle-orm/mysql2': require.resolve('drizzle-orm/mysql2') } : {},
      external: ['better-sqlite3', 'drizzle-orm/better-sqlite3', ...(testCase.driver !== 'mysql' ? ['mysql2/promise', 'drizzle-orm/mysql2'] : []), ...(testCase.driver !== 'postgres' ? ['postgres', 'drizzle-orm/postgres-js'] : [])],
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      plugins: [{
        name: 'scheduler-local-native-test-clock',
        setup(bundle) {
          bundle.onLoad({ filter: /[/\\]scheduler[/\\](?:index|SchedulerLock)\.ts$/ }, async ({ path }) => ({
            contents: `import { setTimeout, clearTimeout, setInterval, clearInterval } from ${JSON.stringify(support)};\n${await readFile(path, 'utf8')}`,
            loader: 'ts', resolveDir: dirname(path),
          }));
        },
      }],
      logLevel: 'silent',
    });
    const proof = `
      import assert from 'node:assert/strict';
      import { randomUUID } from 'node:crypto';
      import { setImmediate as immediate } from 'node:timers/promises';
      import * as core from ${JSON.stringify(pathToFileURL(outfile).href)};
      const { Connection, QueryBuilder, Scheduler, SchedulerLock, task, ApplicationContext, schedulerClock, isSchedulerLeaseMutation } = core;
      const driver = ${JSON.stringify(testCase.driver)};
      if (driver !== 'sqlite') assert.equal(process.env.SVELAR_TEST_SCHEDULER_DATABASE_CREATE, '1');
      const database = 'svelar_scheduler_native_' + randomUUID().replaceAll('-', '');
      assert.match(database, /^svelar_scheduler_native_[a-f0-9]{32}$/);
      let admin;
      if (driver === 'sqlite') {
        admin = { driver, filename: ':memory:' };
      } else if (driver === 'postgres' && process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL) {
        const url = new URL(process.env.SVELAR_TEST_SCHEMA_POSTGRES_URL);
        assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Scheduler proof requires an owned loopback service.');
        assert(Number(url.port) > 0 && Number(url.port) !== 5432, 'Scheduler proof requires an explicit non-default port.');
        admin = { driver, url: url.href, prepare: false };
      } else {
        const port = Number(driver === 'postgres' ? process.env.SVELAR_TEST_QUEUE_PG_PORT : process.env.SVELAR_TEST_QUEUE_MYSQL_PORT);
        assert(Number.isSafeInteger(port) && port > 0 && port <= 65535 && port !== (driver === 'postgres' ? 5432 : 3306));
        admin = { driver, host: '127.0.0.1', port, user: driver === 'postgres' ? 'svelar_queue' : 'root',
          password: 'queue-proof', database: 'queue_proof', prepare: false, ...(driver === 'mysql' ? { timezone: 'Z', connectionLimit: 2 } : {}) };
      }
      const config = { ...admin, ...(driver !== 'sqlite' ? { database } : {}) };
      if (admin.url) { const url = new URL(admin.url); url.pathname = '/' + database; config.url = url.href; }
      const quote = driver === 'postgres' ? '"' : String.fromCharCode(96);
      const ownedDatabase = quote + database + quote;
      Connection.configure({ default: 'proof', connections: { admin, proof: config } });
      const workers = [];
      let created = false;
      let instrumented = false;
      let clockEnabled = false;
      const raw = Connection.raw.bind(Connection);
      const realTimeout = globalThis.setTimeout;
      const realClearTimeout = globalThis.clearTimeout;
      const statements = [];
      const pending = new Set();
      const errors = [];
      const results = [];
      const counts = { startup: 0, idlePulses: [], minuteEvaluation: 0, manualPulses: [] };
      let minuteStatements = [];
      let stage = 'migrations';
      const at = new Date('2026-10-14T12:00:01Z');
      const minute = Math.floor(at.getTime() / 60000) * 60000;
      function worker(scope = 'native-one') {
        const scheduler = new Scheduler({ persistent: true, tenantId: scope, timezone: 'UTC', heartbeatMilliseconds: 5000, requestBatchSize: 2 });
        workers.push(scheduler);
        for (let index = 0; index < 66; index++) {
          const time = String(Math.floor(index / 60)).padStart(2, '0') + ':' + String(index % 60).padStart(2, '0');
          scheduler.register(task('native-' + index, async () => {
            const context = ApplicationContext.get('scheduler');
            assert.equal(context.tenantId, scope);
          }, (job) => job.dailyAt(time)));
        }
        return scheduler;
      }
      async function settle() {
        let timeout;
        try {
          await Promise.race([
            (async () => {
              for (;;) {
                await Promise.allSettled([...pending]);
                await immediate();
                if (pending.size) continue;
                await immediate();
                if (!pending.size) return;
              }
            })(),
            new Promise((_, reject) => { timeout = realTimeout(() => reject(new Error('Native scheduler work did not settle during ' + stage + '. Last statements: ' + JSON.stringify(statements.slice(-3)))), 10000); }),
          ]);
        } finally { realClearTimeout(timeout); }
        assert.deepEqual(errors, []);
      }
      async function advance(milliseconds) { schedulerClock.tick(milliseconds); await settle(); }
      const observe = { onResult: (result) => results.push(result), onError: (error) => errors.push(error.message) };
      try {
        // Infrastructure setup only. Core migrations and ordinary queries run exclusively in this owned database.
        if (driver !== 'sqlite') { await raw('CREATE DATABASE ' + ownedDatabase, [], 'admin'); created = true; }
        for (const name of ${JSON.stringify(migrations.map(([name]) => name))}) await new core[name]().up();
        Connection.raw = (sql, bindings, name) => {
          statements.push(sql);
          const work = raw(sql, bindings, name);
          pending.add(work);
          void work.then(() => pending.delete(work), () => pending.delete(work));
          return work;
        };
        instrumented = true;
        schedulerClock.enable(at); clockEnabled = true;
        const scheduler = worker();
        stage = 'startup';
        scheduler.start(observe); await settle();
        counts.startup = statements.length;
        assert(counts.startup <= 70);
        assert.equal(statements.filter((sql) => sql.includes('LEFT JOIN')).length, 1);
        assert.equal(statements.filter((sql) => sql.startsWith('INSERT') && sql.includes('scheduler_runtime')).length, 2);
        for (let pulse = 0; pulse < 11; pulse++) {
          stage = 'idle pulse ' + pulse;
          statements.length = 0; await advance(5000);
          counts.idlePulses.push(statements.length);
          assert.equal(statements.length, 2);
          assert(!statements.some((sql) => sql.includes('scheduled_task_settings') || sql.includes('scheduler_locks')));
        }
        assert.equal(results.length, 0);
        stage = 'minute evaluation';
        statements.length = 0; await advance(4000);
        counts.minuteEvaluation = statements.length;
        minuteStatements = [...statements];
        assert.equal(counts.minuteEvaluation, 3);
        assert(!statements.some(isSchedulerLeaseMutation), 'Idle evaluation mutated the invocation lease table: ' + JSON.stringify(statements));

        stage = 'manual request batches';
        const requests = [];
        for (let index = 0; index < 3; index++) requests.push(await scheduler.requestRun('native-0'));
        requests.push(await scheduler.requestRun('native-65'));
        const paused = await scheduler.requestRun('native-1');
        await scheduler.configureTask('native-1', { enabled: false });
        const cancelled = await scheduler.requestRun('native-2');
        await scheduler.cancelRunRequest('native-2', cancelled.id);
        const expired = await scheduler.requestRun('native-3');
        await new QueryBuilder('scheduler_requests').where('id', expired.id).update({ state: 'running', owner: 'dead-worker', lease_until: Date.now() - 1, attempts: 1 });
        const foreign = worker('native-two');
        const foreignRequest = await foreign.requestRun('native-0');
        statements.length = 0; await advance(1000);
        counts.manualPulses.push(statements.length); assert(statements.length <= 74);
        assert.equal(results.length, 4);
        statements.length = 0; await advance(5000);
        counts.manualPulses.push(statements.length); assert(statements.length <= 25);
        assert.equal(results.length, 5);
        assert.equal((await scheduler.getRunRequest('native-3', expired.id)).attempts, 2);
        assert.equal((await scheduler.getRunRequest('native-1', paused.id)).state, 'pending');
        assert.equal((await scheduler.getRunRequest('native-2', cancelled.id)).state, 'cancelled');
        assert.equal((await foreign.getRunRequest('native-0', foreignRequest.id)).state, 'pending');
        assert.equal(await scheduler.getRunRequest('native-0', foreignRequest.id), null);
        await scheduler.configureTask('native-1', { enabled: true });
        statements.length = 0; await advance(5000);
        counts.manualPulses.push(statements.length); assert(statements.length <= 25);
        assert.equal(results.length, 6);
        assert.equal((await scheduler.getRunRequest('native-1', paused.id)).state, 'succeeded');
        for (const request of requests) assert.equal((await scheduler.getRunRequest(request.task, request.id)).state, 'succeeded');
        statements.length = 0; await advance(5000);
        assert.equal(statements.length, 2);
        assert.equal(Number((await scheduler.getRuntimeStore().task('native-64')).last_checked_at), minute + 60000);

        const store = scheduler.getRuntimeStore();
        stage = 'cursor fences';
        await store.updateTask('native-4', { last_checked_at: minute + 120000 });
        await scheduler.run(new Date(minute + 60000));
        assert.equal(Number((await store.task('native-4')).last_checked_at), minute + 120000);
        const protectedBefore = Number((await store.task('native-5')).last_checked_at);
        const lease = await SchedulerLock.acquireLease(store.key('native-5'), 1);
        assert(lease);
        try {
          await store.updateTask('native-5', { owner: 'stale-runtime-owner', lease_until: Date.now() - 1, state: 'running' });
          await scheduler.run(new Date(minute + 120000));
          const protectedRuntime = await store.task('native-5');
          assert.equal(Number(protectedRuntime.last_checked_at), protectedBefore);
          assert.equal(protectedRuntime.state, 'running');
        } finally { await lease.release(); }

        const restartRequest = await scheduler.requestRun('native-6');
        stage = 'restart controls';
        await scheduler.configureTask('native-6', { enabled: false });
        await scheduler.stop();
        const restarted = worker();
        restarted.start(observe); await settle();
        assert.equal((await restarted.getRunRequest('native-6', restartRequest.id)).state, 'pending');
        await restarted.configureTask('native-6', { enabled: true });
        await advance(5000);
        assert.equal((await restarted.getRunRequest('native-6', restartRequest.id)).state, 'succeeded');
        assert.equal(results.length, 7);
        await restarted.stop();

        const slots = [];
        stage = 'catch-up';
        const catchup = new Scheduler({ persistent: true, tenantId: 'native-one', timezone: 'UTC' }).register(task('catch-up', async () => {
          slots.push(ApplicationContext.get('scheduler').scheduledFor.getTime());
        }, (job) => job.everyMinute().missedRuns('catch-up', { windowMinutes: 10, maxRuns: 2 })));
        workers.push(catchup);
        await catchup.run(new Date(minute)); await catchup.run(new Date(minute + 5 * 60000));
        assert.deepEqual(slots, [minute, minute + 4 * 60000, minute + 5 * 60000]);
        assert(results.every((result) => result.success && !result.skipped && result.requestId));
        assert.equal((await new QueryBuilder('scheduler_locks').get()).length, 0);
      } finally {
        try {
          const stopped = await Promise.allSettled(workers.map((worker) => worker.stop()));
          for (const result of stopped) if (result.status === 'rejected') throw result.reason;
        } finally {
          if (clockEnabled) schedulerClock.reset();
          if (instrumented) Connection.raw = raw;
          try {
            await Connection.disconnect('proof');
            if (created) await raw('DROP DATABASE ' + ownedDatabase, [], 'admin');
          } finally { await Connection.disconnect(); }
        }
      }
      console.log('NATIVE_SCHEDULER_HEARTBEAT_PROOF ' + JSON.stringify({ driver, scope: driver === 'sqlite' ? 'local-source-fixture' : 'source-native-not-installed-artifact', catalogSize: 66,
        counts, minuteStatements, clockIsolation: 'scheduler-only-real-driver-timers', manualExecutions: results.length, ownedDatabaseRemoved: driver !== 'sqlite',
        checks: ['bulk-registration-and-minute-snapshot', 'idle-heartbeat-query-count', 'real-manual-request-batches',
          'expired-cancelled-paused-and-foreign-requests', 'active-and-newer-cursor-fences', 'persistent-restart-controls', 'bounded-catch-up'] }));
    `;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', proof], {
      env: process.env, timeout: 45000, maxBuffer: 1024 * 1024,
    }).catch((error) => { throw new Error(redactLogText(`Native ${testCase.driver} scheduler proof failed (${JSON.stringify({ code: error.code, signal: error.signal, killed: error.killed })}).\n${error.stdout ?? ''}\n${error.stderr ?? ''}`)); });
    const receipts = result.stdout.split('\n').filter((line) => line.startsWith('NATIVE_SCHEDULER_HEARTBEAT_PROOF '));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0].slice('NATIVE_SCHEDULER_HEARTBEAT_PROOF '.length));
    expect(receipt).toMatchObject({ driver: testCase.driver, catalogSize: 66, clockIsolation: 'scheduler-only-real-driver-timers', manualExecutions: 7, ownedDatabaseRemoved: testCase.driver !== 'sqlite' });
    expect(receipt.counts.idlePulses).toEqual(Array(11).fill(2));
    expect(receipt.counts.minuteEvaluation).toBe(3);
    expect(receipt.checks).toHaveLength(7);
    console.log(receipts[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
