import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

describe('Auditing models across independent public entry bundles', () => {
  let directory: string;
  let orm: typeof import('../src/orm/index.js');
  let audit: typeof import('../src/audit/index.js');
  let database: typeof import('../src/database/index.js');
  beforeAll(async () => {
    directory = await mkdtemp(resolve('.test-audit-model-bundles-'));
    await build({ entryPoints: { orm: resolve('src/orm/index.ts'), audit: resolve('src/audit/index.ts'), database: resolve('src/database/index.ts') },
      outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, splitting: false, minify: true, keepNames: true,
      packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    orm = await import(pathToFileURL(join(directory, 'orm.mjs')).href);
    audit = await import(pathToFileURL(join(directory, 'audit.mjs')).href);
    database = await import(pathToFileURL(join(directory, 'database.mjs')).href);
  }, 30000);
  afterEach(async () => { await database.Connection.disconnect(); audit.Audit.configure({ driver: 'memory' }); });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it('registers instance observers and records create/update/delete for a model imported from the ORM entry', async () => {
    database.Connection.configure({ default: 'fixture', connections: { fixture: { driver: 'sqlite', filename: ':memory:' } } });
    await new database.Schema().createTable('audit_bundle_records', (table) => { table.id(); table.string('name'); });
    class Record extends orm.Model { static table = 'audit_bundle_records'; static timestamps = false; static fillable = ['name']; }
    expect(orm.isModelClass(Record)).toBe(true);
    expect(audit.auditable(Record)).toBe(Record);
    audit.Audit.configure({ driver: 'memory', enabled: true });
    const record = await Record.create({ name: 'before' });
    await record.update({ name: 'after' });
    await record.delete();
    const entries = await audit.Audit.query({ modelType: 'Record', modelId: record.getAttribute('id') });
    expect(entries.map((entry) => entry.action).sort()).toEqual(['created', 'deleted', 'updated']);
    expect(entries.find((entry) => entry.action === 'updated')).toMatchObject({ oldValues: { name: 'before' }, newValues: { name: 'after' } });
  });

  it('rejects duck-typed and static-chain-only impostors', () => {
    class Impostor { static observe() {} }
    Object.setPrototypeOf(Impostor, orm.Model);
    expect(orm.isModelClass(Impostor)).toBe(false);
    expect(() => audit.auditable(Impostor as unknown as typeof orm.Model)).toThrow('requires a Svelar Model');
    expect(orm.isModelClass({ prototype: orm.Model.prototype })).toBe(false);
  });
});
