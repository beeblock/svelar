import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { NewCommandTemplates as T } from '../src/cli/commands/NewCommandTemplates.js';
import { transformScaffoldFile } from '../src/cli/commands/NewCommand.js';
import { LintArchitectureCommand } from '../src/cli/commands/LintArchitectureCommand.js';
import { Connection } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Model, QueryBuilder } from '../src/orm/index.js';
import { Job } from '../src/queue/index.js';
import { ScheduledTask } from '../src/scheduler/index.js';
import { Mailer } from '../src/mail/index.js';
import { Storage } from '../src/storage/index.js';
import { AuthManager } from '../src/auth/index.js';
import { DatabaseSessionStore } from '../src/session/index.js';
import { Audit } from '../src/audit/index.js';
import { Container } from '../src/container/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templateFiles: Record<string, () => string> = {
  'src/lib/modules/auth/User.ts': T.userModel,
  'src/lib/modules/posts/Post.ts': T.postModel,
  'src/lib/modules/admin/BackgroundWorkRepository.ts': T.backgroundWorkRepository,
  'src/lib/shared/jobs/DailyDigestJob.ts': T.dailyDigestJob,
  'src/lib/shared/jobs/ExportDataJob.ts': T.exportDataJob,
  'src/lib/shared/scheduler/CleanupExpiredTokens.ts': T.cleanupExpiredTokens,
  'src/lib/shared/scheduler/CleanExpiredSessions.ts': T.cleanExpiredSessions,
  'src/lib/shared/scheduler/PruneAuditLogs.ts': T.pruneAuditLogs,
};
function typecheck(flat: boolean) {
  const directory = join(packageRoot, '.virtual-background-scaffold');
  const virtual = new Map(Object.entries(templateFiles).map(([path, template]) => {
    const file = transformScaffoldFile(path, template(), flat);
    return [join(directory, file.path), file.content];
  }));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, types: ['node'],
    esModuleInterop: true, paths: { '@beeblock/svelar/*': [join(packageRoot, 'src/*/index.ts')], '$lib/*': [join(directory, 'src/lib/*')] } };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host), isDirectory = host.directoryExists!.bind(host);
  host.readFile = path => virtual.get(path) ?? read(path);
  host.fileExists = path => virtual.has(path) || exists(path);
  host.directoryExists = path => [...virtual.keys()].some(file => file.startsWith(path + '/')) || isDirectory(path);
  host.getSourceFile = (path, languageVersion) => {
    const source = host.readFile(path); return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion, true);
  };
  return ts.getPreEmitDiagnostics(ts.createProgram([...virtual.keys(), join(packageRoot, 'src/types/externals.d.ts')], options, host))
    .map(item => item.file?.fileName + ': ' + ts.flattenDiagnosticMessageText(item.messageText, '\n'));
}
function evaluate(source: string, dependencies: Record<string, unknown>): any {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', compiled)(module.exports, (name: string) => {
    if (!(name in dependencies)) throw new Error('Unbound background scaffold import: ' + name);
    return dependencies[name];
  }, module);
  return module.exports;
}
class FixtureUser extends Model {
  static table = 'users'; static timestamps = false; static fillable = ['name', 'email', 'role'];
  declare id: number; declare name: string; declare email: string; declare role: string;
}
class FixturePost extends Model {
  static table = 'posts'; static timestamps = false;
  static fillable = ['title', 'slug', 'body', 'published', 'user_id', 'created_at'];
  static casts = { published: 'boolean' as const, created_at: 'date' as const };
  declare id: number; declare title: string; declare slug: string; declare body: string;
  declare published: boolean; declare user_id: number; declare created_at: Date;
}
function runtime() {
  const container = new Container();
  const dependencies: Record<string, any> = { '@beeblock/svelar/queue': { Job }, '@beeblock/svelar/scheduler': { ScheduledTask },
    '@beeblock/svelar/mail': { Mailer }, '@beeblock/svelar/storage': { Storage }, '@beeblock/svelar/audit': { Audit },
    '@beeblock/svelar/session': { DatabaseSessionStore }, '@beeblock/svelar/container': { container },
    '$lib/modules/auth/User.js': { User: FixtureUser }, '$lib/modules/posts/Post.js': { Post: FixturePost } };
  const repository = evaluate(T.backgroundWorkRepository(), dependencies);
  dependencies['$lib/modules/admin/BackgroundWorkRepository.js'] = repository;
  return { container, repository: new repository.BackgroundWorkRepository(),
    DailyDigestJob: evaluate(T.dailyDigestJob(), dependencies).DailyDigestJob,
    ExportDataJob: evaluate(T.exportDataJob(), dependencies).ExportDataJob,
    CleanupExpiredTokens: evaluate(T.cleanupExpiredTokens(), dependencies).default,
    CleanExpiredSessions: evaluate(T.cleanExpiredSessions(), dependencies).default,
    PruneAuditLogs: evaluate(T.pruneAuditLogs(), dependencies).default };
}
async function database() {
  Connection.configure({ default: 'test', connections: { test: { driver: 'sqlite', filename: ':memory:' } } });
  await new Migrator().fresh(svelarCoreMigrations());
  const schema = new Schema();
  await schema.createTable('users', table => { table.increments(); table.string('name'); table.string('email'); table.string('role'); });
  await schema.createTable('posts', table => { table.increments(); table.string('title'); table.string('slug'); table.text('body');
    table.boolean('published'); table.integer('user_id'); table.datetime('created_at'); });
}
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => { await Connection.disconnect(); vi.restoreAllMocks(); });

describe('Background work scaffold architecture', () => {
  it.each([false, true])('strictly compiles all owned generated artifacts in flat=%s', flat => {
    expect(typecheck(flat)).toEqual([]);
  }, 60_000);

  it.each([false, true])('generates a complete CLI app with zero unfiltered architecture findings in flat=%s', async flat => {
    const directory = mkdtempSync(join(packageRoot, '.test-background-scaffold-'));
    try {
      const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, type: 'module' }));
      symlinkSync(resolve(packageRoot, '../../node_modules'), join(directory, 'node_modules'), 'dir');
      const bundle = join(directory, 'dist/cli/NewCommand.js');
      await build({ entryPoints: [join(packageRoot, 'src/cli/commands/NewCommand.ts')], outfile: bundle, bundle: true, keepNames: true,
        format: 'esm', platform: 'node', target: 'node22', packages: 'external', logLevel: 'silent' });
      const { NewCommand } = await import(pathToFileURL(bundle).href);
      const app = join(directory, 'app');
      await new NewCommand().handle([app], { 'no-install': true, flat, validation: 'zod' });
      expect(new LintArchitectureCommand().scanProject(join(app, 'src'))).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('uses actual ORM repository reads for digest counts, published ordering/limit and administrator recipients', async () => {
    await database(); const h = runtime();
    const admin = await FixtureUser.create({ name: 'Admin', email: 'admin@test', role: 'admin' });
    await FixtureUser.create({ name: 'Reader', email: 'reader@test', role: 'user' });
    for (let index = 0; index < 8; index++) await FixturePost.create({ title: 'Post ' + index, slug: 'post-' + index, body: 'Body',
      published: index !== 7, user_id: admin.id, created_at: new Date(Date.UTC(2026, 0, index + 1)) });
    const data = await h.repository.dailyDigest();
    expect(data).toMatchObject({ userCount: 2, postCount: 8 });
    expect(data.recentPosts.map((post: FixturePost) => post.title)).toEqual(['Post 6', 'Post 5', 'Post 4', 'Post 3', 'Post 2']);
    expect(data.admins.map((user: FixtureUser) => user.email)).toEqual(['admin@test']);
    const send = vi.spyOn(Mailer, 'send').mockResolvedValue({ accepted: ['admin@test'], rejected: [] });
    await new h.DailyDigestJob('2026-01-08').handle();
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0]).toMatchObject({ to: 'admin@test' });
    expect(send.mock.calls[0][0].html).toContain('Post 6'); expect(send.mock.calls[0][0].html).not.toContain('Post 7');
  });

  it('exports only the requesting user posts in either format and rejects missing owners before storage', async () => {
    await database(); const h = runtime();
    const owner = await FixtureUser.create({ name: 'Owner', email: 'owner@test', role: 'user' });
    const other = await FixtureUser.create({ name: 'Other', email: 'other@test', role: 'user' });
    for (const user of [owner, other]) await FixturePost.create({ title: user.name, slug: user.name, body: 'Body', published: false,
      user_id: user.id, created_at: new Date('2026-01-01T00:00:00Z') });
    const put = vi.spyOn(Storage, 'put').mockResolvedValue(undefined);
    await new h.ExportDataJob(owner.id, 'json').handle();
    const json = JSON.parse(String(put.mock.calls[0][1])); expect(json.map((post: any) => post.title)).toEqual(['Owner']);
    await new h.ExportDataJob(owner.id, 'csv').handle(); expect(put.mock.calls[1][1]).toContain('Owner'); expect(put.mock.calls[1][1]).not.toContain('Other');
    expect(await h.repository.exportPosts(999)).toBeNull(); await expect(new h.ExportDataJob(999).handle()).rejects.toThrow('not found');
    await expect(new h.ExportDataJob().handle()).rejects.toThrow('required'); expect(put).toHaveBeenCalledTimes(2);
  });

  it('uses the configured AuthManager instance and custom recovery tables instead of duplicated task queries', async () => {
    await database(); const h = runtime(); const schema = new Schema();
    for (const table of ['password_resets', 'email_verifications', 'otp_codes']) await schema.renameTable(table, 'custom_' + table);
    const auth = new AuthManager({ guard: 'session', model: FixtureUser, passwordResets: { table: 'custom_password_resets' },
      emailVerification: { table: 'custom_email_verifications' }, otp: { table: 'custom_otp_codes' } });
    h.container.instance('auth', auth);
    const expires = new Date(Date.now() - 1000).toISOString();
    await new QueryBuilder('custom_password_resets').insert({ email: 'old@test', token: 'fixture', created_at: expires, expires_at: expires });
    await new QueryBuilder('custom_email_verifications').insert({ user_id: 1, token: 'fixture', created_at: expires, expires_at: expires });
    await new QueryBuilder('custom_otp_codes').insert({ email: 'old@test', code: 'fixture', purpose: 'login', created_at: expires, expires_at: expires });
    await new h.CleanupExpiredTokens().handle();
    for (const table of ['custom_password_resets', 'custom_email_verifications', 'custom_otp_codes']) expect(await new QueryBuilder(table).count()).toBe(0);
  });

  it('delegates session expiry to the real configured scaffold store public GC contract', async () => {
    await database(); const h = runtime(); const store = new DatabaseSessionStore();
    await store.write('expired-session', { user: 'expired' }, -10); await store.write('active-session', { user: 'active' }, 1000);
    await new h.CleanExpiredSessions().handle();
    expect(await store.read('expired-session')).toBeNull(); expect(await store.read('active-session')).toEqual({ user: 'active' });
    expect(await new QueryBuilder('sessions').count()).toBe(1);
  });

  it('uses public audit pruning and propagates all maintenance failures without missing-table waivers', async () => {
    const h = runtime(); const authFailure = new Error('auth persistence unavailable');
    h.container.instance('auth', { cleanupExpiredTokens: async () => { throw authFailure; } });
    await expect(new h.CleanupExpiredTokens().handle()).rejects.toBe(authFailure);
    const sessionFailure = new Error('session storage unavailable'); vi.spyOn(DatabaseSessionStore.prototype, 'gc').mockRejectedValue(sessionFailure);
    await expect(new h.CleanExpiredSessions().handle()).rejects.toBe(sessionFailure);
    const prune = vi.spyOn(Audit, 'pruneBefore').mockResolvedValue(3); const clock = vi.spyOn(Date, 'now').mockReturnValue(100 * 86_400_000);
    await new h.PruneAuditLogs().handle(); expect(prune).toHaveBeenCalledWith(10 * 86_400_000);
    const auditFailure = new Error('no such table: audit_logs'); prune.mockRejectedValue(auditFailure);
    await expect(new h.PruneAuditLogs().handle()).rejects.toBe(auditFailure); clock.mockRestore();
  });
});
