import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, DatabaseConfig } from '../src/database/Connection.js';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../src/database/Connection.ts');
const run = promisify(execFile);
type Fixture = { Connection: typeof Connection; calls: Record<string, unknown>[] };
type MockPool = { options: Record<string, unknown>; closed: boolean };

describe.sequential('MySQL structured connection URL', () => {
  let fixture: Fixture;
  beforeAll(async () => {
    const result = await build({
      stdin: { contents: `export { Connection } from ${JSON.stringify(source)}; export { calls } from 'mysql2/promise';`, resolveDir: dirname(source) },
      write: false, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', logLevel: 'silent',
      plugins: [{ name: 'public-driver-contract', setup(builder) {
        builder.onResolve({ filter: /^(mysql2\/promise|drizzle-orm\/mysql2)$/ }, ({ path }) => ({ path, namespace: 'driver-proof' }));
        builder.onLoad({ filter: /.*/, namespace: 'driver-proof' }, ({ path }) => ({ contents: path === 'mysql2/promise'
          ? 'export const calls = []; export function createPool(options) { calls.push(options); return { options, closed: false, async end() { this.closed = true; } }; }'
          : 'export function drizzle(pool) { return { $client: pool }; }' }));
      } }],
    });
    const bundled = 'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64');
    fixture = await import(/* @vite-ignore */ bundled);
  });
  beforeEach(() => { fixture.calls.length = 0; });
  afterEach(async () => { await fixture.Connection.disconnect(); vi.restoreAllMocks(); });

  async function open(config: Omit<DatabaseConfig, 'driver'> & { driver?: DatabaseConfig['driver'] }) {
    fixture.Connection.configure({ default: 'proof', connections: { proof: { driver: 'mysql', ...config } } });
    return await fixture.Connection.rawClient() as MockPool;
  }

  it('decodes escaped authority/database and preserves nondefault host/port without a second URI merge', async () => {
    const pool = await open({ driver: 'mysql2', url: 'mysql://api%2Bworker:p%3A%40%2F%25%23%2B@db.example:13317/app%20data%2Bblue' });
    expect(pool.options).toEqual({ host: 'db.example', port: 13317, user: 'api+worker', password: 'p:@/%#+', database: 'app data+blue' });
    expect(pool.options).not.toHaveProperty('uri');
    expect(fixture.calls).toHaveLength(1);
    await fixture.Connection.disconnect();
    expect(pool.closed).toBe(true);
  });

  it('passes only defined explicit fields, including empty credentials/database, after parsed URL values', async () => {
    const pool = await open({
      url: 'mysql://url-user:url-secret@url-host:13317/url-db?connectionLimit=4&timezone=%22Z%22',
      host: 'explicit-host', port: 14417, user: '', password: '', database: '', connectionLimit: 2, timezone: '+05:30',
    });
    expect(pool.options).toEqual({ host: 'explicit-host', port: 14417, user: '', password: '', database: '', connectionLimit: 2, timezone: '+05:30' });
  });

  it('does not overlay absent fields or an absent port with Svelar defaults when a URL is supplied', async () => {
    const pool = await open({ url: 'mysql://url-user:url-secret@url-host/url-db', host: undefined, user: undefined, port: undefined });
    expect(pool.options).toEqual({ host: 'url-host', user: 'url-user', password: 'url-secret', database: 'url-db' });
    expect(pool.options).not.toHaveProperty('port');
  });

  it('retains no-URL host/port defaults without inventing database/user/password', async () => {
    expect((await open({})).options).toEqual({ host: 'localhost', port: 3306 });
  });

  it('keeps explicit no-URL fields and typed pool options', async () => {
    expect((await open({ host: 'db.local', port: 14417, user: '', password: '', database: 'app', connectionLimit: 1000, timezone: 'local' })).options)
      .toEqual({ host: 'db.local', port: 14417, user: '', password: '', database: 'app', connectionLimit: 1000, timezone: 'local' });
  });

  it('handles bracketed IPv6 authority without passing brackets to mysql2', async () => {
    expect((await open({ url: 'mysql://worker:secret@[::1]:14417/app' })).options.host).toBe('::1');
  });

  it('validates JSON numeric/boolean query options while preserving false/zero and URL-encoded timezones', async () => {
    const params = new URLSearchParams({ connectionLimit: '3', connectTimeout: '2500', queueLimit: '0', maxIdle: '0', idleTimeout: '1000',
      waitForConnections: 'false', dateStrings: 'true', supportBigNumbers: 'true', bigNumberStrings: 'false', decimalNumbers: 'true',
      namedPlaceholders: 'false', multipleStatements: 'false', jsonStrings: 'true', timezone: JSON.stringify('+05:30') });
    expect((await open({ url: 'mysql://worker:secret@db/app?' + params })).options).toMatchObject({
      connectionLimit: 3, connectTimeout: 2500, queueLimit: 0, maxIdle: 0, idleTimeout: 1000, waitForConnections: false, dateStrings: true,
      supportBigNumbers: true, bigNumberStrings: false, decimalNumbers: true, namedPlaceholders: false, multipleStatements: false,
      jsonStrings: true, timezone: '+05:30',
    });
  });

  it.each(['local', 'Z', '-03:30'])('accepts public plain timezone syntax (%s)', async (timezone) => {
    expect((await open({ url: 'mysql://worker:secret@db/app?' + new URLSearchParams({ timezone }) })).options.timezone).toBe(timezone);
  });

  const invalidQuery = [
    'connectionLimit=0', 'connectionLimit=1001', 'connectionLimit=-1', 'connectionLimit=1.5', 'connectionLimit=%223%22',
    'connectionLimit=true', 'connectionLimit=null', 'connectionLimit=%7B%7D', 'connectionLimit=3&connectionLimit=4',
    'waitForConnections=1', 'dateStrings=%22true%22', 'decimalNumbers=no', 'queueLimit=-1', 'maxIdle=1001', 'connectTimeout=0',
    'idleTimeout=3600001', 'timezone=%22%2B24%3A00%22', 'timezone=Z%0Asecret', 'timezone=%7B%7D',
    '__proto__=%7B%22polluted%22%3Atrue%7D', 'constructor=secret', 'prototype=secret', 'uri=secret', 'unknown=secret',
    'host=foreign', 'port=3307', 'user=foreign', 'password=foreign', 'database=foreign', 'ssl=%7B%7D',
  ];
  it.each(invalidQuery)('fails closed before acquiring a pool for invalid/authority query: %s', async (query) => {
    const error = await open({ url: 'mysql://private-user:private-secret@db/private-db?' + query }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).toBe('TypeError: Invalid MySQL connection URL or query options.');
    expect(error).not.toHaveProperty('cause');
    expect(fixture.calls).toEqual([]);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it.each(['', 'not-a-url-private-secret', 'postgres://user:private-secret@db/app', 'mysql:///app',
    'mysql://user:private-secret@db:65536/app', 'mysql://user:private-secret@db:0/app',
    'mysql://user:private%ZZsecret@db/app', 'mysql://user:private-secret@db/app#fragment-private-secret'])
  ('rejects malformed URL without retaining sensitive input or a nested parser error: %s', async (url) => {
    const error = await open({ url }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('private');
    expect(error).not.toHaveProperty('cause');
    expect(fixture.calls).toEqual([]);
  });

  it.each([0, -1, 1001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('bounds explicit connectionLimit (%s)', async (connectionLimit) => {
    await expect(open({ url: 'mysql://worker:secret@db/app', connectionLimit })).rejects.toThrow('MySQL connectionLimit must be 1..1000.');
    expect(fixture.calls).toEqual([]);
  });

  it.each(['', 'UTC', '+24:00', '+01:60', 'Z\n', 'secret-value'])('rejects explicit unsupported timezone without echoing it (%s)', async (timezone) => {
    await expect(open({ timezone })).rejects.toThrow('Invalid MySQL timezone.');
    expect(fixture.calls).toEqual([]);
  });

  it.each([0, 65536, 1.5, Number.NaN])('bounds explicit port (%s)', async (port) => {
    await expect(open({ port })).rejects.toThrow('Invalid MySQL port.');
    expect(fixture.calls).toEqual([]);
  });

  it('never logs URL secrets, including malformed query values rejected before SDK initialization', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(open({ url: 'mysql://private-user:private-secret@db/app?timezone=private-secret' })).rejects.toThrow('Invalid MySQL connection URL or query options.');
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
});

const native = process.env.SVELAR_TEST_MYSQL_URL === '1';
describe.skipIf(!native)('MySQL URL native isolated driver proof', () => {
  it('connects using escaped URL fields and JSON options; explicit empty values cannot regain URL credentials', async () => {
    const modules = process.env.SVELAR_TEST_MYSQL_URL_MODULES;
    if (!modules) throw new Error('SVELAR_TEST_MYSQL_URL_MODULES must point to installed mysql2 dependencies.');
    await access(join(modules, 'mysql2/promise.js'));
    const directory = await mkdtemp(join(tmpdir(), 'svelar-mysql-url-'));
    const container = 'svelar-mysql-url-' + randomUUID();
    const docker = (args: string[]) => run('docker', args, { timeout: 120_000, maxBuffer: 1024 * 1024 });
    let started = false;
    try {
      await mkdir(join(directory, 'node_modules'));
      await symlink(join(modules, 'mysql2'), join(directory, 'node_modules/mysql2'));
      const drizzle = resolve(dirname(source), '../../../../node_modules/drizzle-orm');
      await cp(drizzle, join(directory, 'node_modules/drizzle-orm'), { recursive: true });
      const outfile = join(directory, 'connection.mjs');
      // Bundle only the owned source; native SDK/Drizzle stay external in this isolated fixture.
      await build({ entryPoints: [source], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', logLevel: 'silent' });
      const user = 'url+proof', password = 'proof:@/%#+' + randomUUID(), database = 'url proof+db';
      started = true;
      await docker(['run', '--detach', '--rm', '--name', container, '--label', 'svelar.fixture=mysql-url', '--publish', '127.0.0.1::3306',
        '--tmpfs', '/var/lib/mysql:rw', '--env', 'MYSQL_USER=' + user, '--env', 'MYSQL_PASSWORD=' + password,
        '--env', 'MYSQL_DATABASE=' + database, '--env', 'MYSQL_ROOT_PASSWORD=' + randomUUID(), 'mysql:8.0']);
      const published = await docker(['port', container, '3306/tcp']);
      const port = Number(published.stdout.trim().split(':').at(-1));
      expect(port).toBeGreaterThan(1024); expect(port).not.toBe(3306);
      const url = 'mysql://' + encodeURIComponent(user) + ':' + encodeURIComponent(password) + '@127.0.0.1:' + port + '/' + encodeURIComponent(database)
        + '?connectionLimit=3&timezone=%22Z%22&dateStrings=true&waitForConnections=false&connectTimeout=1000';
      const script = `
        import assert from 'node:assert/strict';
        import { Connection } from ${JSON.stringify(pathToFileURL(outfile).href)};
        const config = JSON.parse(process.env.SVELAR_MYSQL_URL_CONFIG);
        async function open(overrides = {}) {
          await Connection.disconnect();
          Connection.configure({default:'proof', connections:{proof:{driver:'mysql', ...config, ...overrides}}});
          return Connection.rawClient();
        }
        try {
          const pool = await open();
          const [rows] = await pool.execute("SELECT DATABASE() AS db, CURRENT_USER() AS actor, CAST('2026-01-02 03:04:05' AS DATETIME) AS stamp");
          assert.equal(rows[0].db, ${JSON.stringify(database)});
          assert.equal(rows[0].actor, ${JSON.stringify(user + '@%')});
          assert.equal(rows[0].stamp, '2026-01-02 03:04:05');
          const held = await Promise.all([pool.getConnection(), pool.getConnection(), pool.getConnection()]);
          try { await assert.rejects(pool.getConnection(), /No connections available/); } finally { held.forEach(client => client.release()); }
          const emptyDatabase = await open({database:''});
          const [emptyRows] = await emptyDatabase.execute('SELECT DATABASE() AS db');
          assert.equal(emptyRows[0].db, null);
          const emptyPassword = await open({password:''});
          await assert.rejects(emptyPassword.execute('SELECT 1'), error => error.code === 'ER_ACCESS_DENIED_ERROR');
          const emptyUser = await open({user:''});
          await assert.rejects(emptyUser.execute('SELECT 1'), error => error.code === 'ER_ACCESS_DENIED_ERROR');
          console.log(JSON.stringify({driver:'mysql', passed:true, nondefaultPort:true, escapedAuthorityAndDatabase:true, jsonOptions:true,
            observedConnectionLimit:3, dateStrings:true, emptyDatabasePreserved:true, emptyPasswordDenied:true, emptyUserDenied:true}));
        } finally { await Connection.disconnect(); }
      `;
      const execute = () => run(process.execPath, ['--input-type=module', '--eval', script], {
        timeout: 15_000, maxBuffer: 1024 * 1024, env: { ...process.env, SVELAR_MYSQL_URL_CONFIG: JSON.stringify({ url }) },
      });
      // Startup readiness is separate from assertions: retries stop before running the proof.
      const ping = `import { Connection } from ${JSON.stringify(pathToFileURL(outfile).href)};
        try { Connection.configure({default:'proof',connections:{proof:JSON.parse(process.env.SVELAR_MYSQL_URL_CONFIG)}}); await Connection.raw('SELECT 1'); }
        finally { await Connection.disconnect(); }`;
      const deadline = Date.now() + 90_000; let ready = false;
      while (Date.now() < deadline) {
        try {
          await run(process.execPath, ['--input-type=module', '--eval', ping], { timeout: 5000, maxBuffer: 1024 * 1024,
            env: { ...process.env, SVELAR_MYSQL_URL_CONFIG: JSON.stringify({ driver: 'mysql', url }) } });
          ready = true; break;
        } catch { await new Promise((done) => setTimeout(done, 250)); }
      }
      if (!ready) throw new Error('Labelled native MySQL URL fixture did not become ready.');
      const result = await execute();
      const proof: unknown = JSON.parse(result.stdout.trim());
      expect(proof).toMatchObject({ driver: 'mysql', passed: true, observedConnectionLimit: 3, emptyPasswordDenied: true, emptyUserDenied: true });
      const evidence = process.env.SVELAR_TEST_MYSQL_URL_EVIDENCE;
      if (evidence) { await mkdir(dirname(evidence), { recursive: true }); await writeFile(evidence, JSON.stringify(proof, null, 2)); }
    } finally {
      try { if (started) await docker(['rm', '--force', container]); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  }, 180_000);
});
