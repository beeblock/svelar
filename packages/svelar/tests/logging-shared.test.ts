import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Connection } from '../src/database/Connection.js';
import { CreateSvelarLogsTable } from '../src/database/CoreMigrations.js';
import { LogViewerService } from '../src/logging/LogViewer.js';

const exec = promisify(execFile);
let directory: string;
let viewer: LogViewerService;
let stop = () => {};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'svelar-shared-logs-'));
  Connection.configure({ default: 'default', connections: { default: { driver: 'sqlite', filename: join(directory, 'logs.db') } } });
  await new CreateSvelarLogsTable().up();
  viewer = new LogViewerService();
  viewer.configure({ driver: 'database', tailIntervalMs: 25, retentionSeconds: 60 });
});
afterEach(async () => { stop(); stop = () => {}; await Connection.disconnect(); await rm(directory, { recursive: true, force: true }); });

const entry = (message: string, extra = {}) => ({ timestamp: new Date().toISOString(), level: 'info' as const,
  channel: 'worker', message, context: { correlationId: 'incident-1', tenantId: 'tenant-1', ...extra } });

describe('Shared durable log viewer', () => {
  it('persists redacted entries and cursor pages across independent viewer instances', async () => {
    await viewer.addEntry(entry('First', { nested: { password: 'hidden' } }));
    await viewer.addEntry(entry('Second password=hidden', { access_token: 'hidden' }));
    const web = new LogViewerService();
    web.configure({ driver: 'database' });
    const first = await web.page({ limit: 1, tenantId: 'tenant-1', correlationId: 'incident-1' });
    expect(first.meta).toMatchObject({ total: 2, scope: 'shared database', hasMore: true });
    await viewer.addEntry(entry('Third'));
    const second = await web.page({ limit: 1, cursor: first.meta.nextCursor! });
    expect(second.data[0].message).toBe('Second password=[REDACTED]');
    const third = await web.page({ limit: 1, cursor: second.meta.nextCursor! });
    expect(third.data[0].message).toBe('Third');
    expect(JSON.stringify([first, second])).not.toContain('hidden');
    expect((await web.page({ tenantId: 'another-tenant' })).meta.total).toBe(0);
  });

  it('aggregates in the database, filters minimum severity and applies retention', async () => {
    await viewer.addEntry(entry('Recent'));
    await viewer.addEntry({ ...entry('Expired'), timestamp: new Date(Date.now() - 120_000).toISOString(), level: 'fatal', channel: 'scheduler' });
    expect(await viewer.getStats()).toEqual({ totalEntries: 2, byLevel: { info: 1, fatal: 1 }, byChannel: { worker: 1, scheduler: 1 } });
    expect((await viewer.query({ level: 'error', search: 'EXPIRED' })).map((row) => row.message)).toEqual(['Expired']);
    expect((await viewer.getRecentErrors())[0].message).toBe('Expired');
    expect(await viewer.prune()).toBe(1);
    expect((await viewer.getStats()).totalEntries).toBe(1);
    await viewer.clear();
    expect((await viewer.page()).meta.total).toBe(0);
  });

  it('sees another process append and resumes tail without replaying earlier entries', async () => {
    await viewer.addEntry(entry('Already read'));
    const cursor = (await viewer.query())[0].id!;
    const observed: string[] = [];
    stop = viewer.tail((row) => { observed.push(row.message); }, { cursor });
    // Compile only the two infrastructure entry points for an actual isolated Node process.
    const { build } = await import('esbuild');
    const childEntry = join(directory, 'writer.mjs');
    await symlink(resolve(import.meta.dirname, '../../../node_modules'), join(directory, 'node_modules'), 'dir');
    await build({ stdin: { contents: `
      import { Connection } from ${JSON.stringify(resolve(import.meta.dirname, '../src/database/Connection.ts'))};
      import { LogViewerService } from ${JSON.stringify(resolve(import.meta.dirname, '../src/logging/LogViewer.ts'))};
      Connection.configure({ default: 'default', connections: { default: { driver: 'sqlite', filename: process.env.LOG_TEST_DB } } });
      const viewer = new LogViewerService(); viewer.configure({ driver: 'database' });
      await viewer.addEntry({ timestamp: new Date().toISOString(), level: 'error', channel: 'scheduler', message: 'Child entry', context: { jobId: '17' } });
      await Connection.disconnect();
    `, resolveDir: process.cwd(), sourcefile: 'writer.ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: childEntry });
    await exec(process.execPath, [childEntry], { env: { ...process.env, LOG_TEST_DB: join(directory, 'logs.db'), NODE_PATH: resolve('node_modules') }, timeout: 15_000 });
    await expect.poll(() => observed, { timeout: 2000 }).toEqual(['Child entry']);
    expect((await viewer.query({ level: 'error' }))[0].context.jobId).toBe('17');
  });

  it.each([{ cursor: -1 }, { limit: 0 }, { offset: 1.5 }])('rejects unsafe pagination %j', async (filter) => {
    await expect(viewer.query(filter)).rejects.toThrow('Invalid log');
  });

  it('keeps memory driver explicit, bounded and mutation-safe', async () => {
    viewer.configure({ driver: 'memory', maxEntries: 2 });
    await viewer.addEntry(entry('Dropped'));
    await viewer.addEntry(entry('Kept'));
    await viewer.addEntry(entry('Newest'));
    const page = await viewer.page({ limit: 1 });
    page.data[0].context.tenantId = 'tampered';
    expect((await viewer.query())[0].context.tenantId).toBe('tenant-1');
    expect(page.meta.scope).toBe('process');
    expect((await viewer.getStats()).totalEntries).toBe(2);
  });
});
