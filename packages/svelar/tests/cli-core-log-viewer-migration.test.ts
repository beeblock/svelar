import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { applyCoreScaffoldMigration, planCoreScaffoldMigrationFromSource } from '../src/cli/CoreScaffoldMigration.js';
import { UpdateCommand } from '../src/cli/commands/UpdateCommand.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const logsPath = 'src/routes/api/admin/logs/+server.ts';
const statsPath = 'src/routes/api/admin/stats/+server.ts';
let root: string;
function write(path: string, contents: string | Buffer) {
  mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), contents);
}
function read(path: string) { return readFileSync(join(root, path), 'utf8'); }
function snapshot(directory = root, prefix = ''): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) for (const item of snapshot(join(directory, entry.name), `${path}/`)) result.set(...item);
    else result.set(path, readFileSync(join(directory, entry.name)));
  }
  return result;
}

// The published 0.7.9 GET bodies, including their Promise-aware stats request.
const publishedLogs = `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { LogViewer } from '@beeblock/svelar/logging/LogViewer';

export const GET: RequestHandler = async (event) => {
  const { searchParams } = event.url;
  const level = searchParams.get('level');
  const channel = searchParams.get('channel');
  const search = searchParams.get('search');
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const logs = LogViewer.query({
      level: level as any,
      channel: channel ?? undefined,
      search: search ?? undefined,
      limit,
      offset,
    });
    const stats = LogViewer.getStats();
    return json({ logs, total: stats.totalEntries, limit, offset });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to fetch logs' }, { status: 500 });
  }
};
`;
const publishedStats = `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';
import { LogViewer } from '@beeblock/svelar/logging/LogViewer';

export const GET: RequestHandler = async () => {
  try {
    const [queueHealth, recentErrors] = await Promise.all([
      JobMonitor.getHealth(),
      Promise.resolve(LogViewer.getRecentErrors(10)),
    ]);
    const schedulerHealth = await ScheduleMonitor.getHealth();
    const logStats = LogViewer.getStats();

    return json({
      queue: queueHealth,
      scheduler: schedulerHealth,
      logs: logStats,
      recentErrors,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to fetch stats' }, { status: 500 });
  }
};
`;
function fixtures(flat: boolean, validation: string) {
  write(flat ? 'src/lib/models/User.ts' : 'src/lib/modules/auth/domain/models/User.ts', '// preserved user model');
  write('svelar.validation.json', JSON.stringify({ validation }));
  write('package.json', '{"name":"legacy-logs","type":"module"}\n');
  write('.env', 'APP_KEY=preserved-fixture-key\r\n');
  write('database.db', Buffer.from([0, 1, 2, 3]));
  write('src/lib/database/seeders/UserSeeder.ts', '// preserved seeder');
  write('docs/verification.md', '# Original timeline\n');
  write(logsPath, publishedLogs); write(statsPath, publishedStats);
}
type Handler = (event: { url: URL }) => Promise<Response>;
function handlers(path: string, viewer: Record<string, unknown>): { GET: Handler; DELETE?: Handler } {
  const output = ts.transpileModule(read(path), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(output, { exports, Promise, Date, URL,
    require: (name: string) => {
      if (name === '@sveltejs/kit') return { json: (data: unknown, options?: { status: number }) =>
        new Response(JSON.stringify(data), { status: options?.status ?? 200 }) };
      if (name.startsWith('@beeblock/svelar/logging')) return { LogViewer: viewer };
      if (name.endsWith('/queue/JobMonitor')) return { JobMonitor: { getHealth: async () => ({ queue: 'healthy' }) } };
      if (name.endsWith('/scheduler/ScheduleMonitor')) return { ScheduleMonitor: { getHealth: async () => ({ scheduler: 'healthy' }) } };
      throw new Error(`Unexpected fixture import: ${name}`);
    },
  });
  return exports as { GET: Handler; DELETE?: Handler };
}
function strictDiagnostics(content: string) {
  const path = join(root, 'route.ts'); const contracts = join(root, 'contracts.d.ts');
  const files = new Map([[path, content], [contracts, `
declare module '@sveltejs/kit' {
  export type RequestHandler = (event: { url: URL }) => Promise<Response>;
  export function json(value: unknown, options?: { status: number }): Response;
}
declare module '@beeblock/svelar/logging/LogViewer' {
  export const LogViewer: {
    query(filter?: unknown): Promise<unknown[]>;
    getStats(): Promise<{ totalEntries: number; byLevel: Record<string, number>; byChannel: Record<string, number> }>;
    getRecentErrors(limit?: number): Promise<unknown[]>;
  };
}
declare module '@beeblock/svelar/queue/JobMonitor' { export const JobMonitor: { getHealth(): Promise<unknown> }; }
declare module '@beeblock/svelar/scheduler/ScheduleMonitor' { export const ScheduleMonitor: { getHealth(): Promise<unknown> }; }
`]]);
  const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options); const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, fresh) => files.has(name)
    ? ts.createSourceFile(name, files.get(name)!, version, true) : original(name, version, onError, fresh);
  return ts.getPreEmitDiagnostics(ts.createProgram([path, contracts], options, host)).map(diagnostic => ({
    code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  }));
}

beforeEach(() => {
  root = mkdtempSync(join(packageRoot, '.test-core-logs-'));
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

describe('Known historical logs and stats route migration', () => {
  it.each([
    { flat: false, validation: 'zod' }, { flat: false, validation: 'valibot' },
    { flat: true, validation: 'zod' }, { flat: true, validation: 'valibot' },
  ])('officially migrates only the two routes with exact backups and resolved responses ($flat/$validation)', async ({ flat, validation }) => {
    fixtures(flat, validation);
    const before = snapshot();
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const dry = new UpdateCommand(); await dry.handle([], { 'migrate-core': true, 'dry-run': true });
    expect(dry.exitCode).toBe(0); expect(snapshot()).toEqual(before);
    const plan = planCoreScaffoldMigrationFromSource(root, ts);
    expect(plan.errors).toEqual([]); expect(plan.edits.map(edit => edit.path)).toEqual([logsPath, statsPath]);
    expect(plan.warnings[0]).toContain('eleven recognized');
    expect(plan.edits.flatMap(edit => edit.tokens).every(token => token.rule === 'log-viewer-await')).toBe(true);
    expect(plan.edits[1].updated.toString()).toBe(publishedStats.replace('const logStats = LogViewer.getStats();', 'const logStats = (await LogViewer.getStats());'));
    const command = new UpdateCommand(); await command.handle([], { 'migrate-core': true, force: true });
    expect(command.exitCode).toBe(0);
    for (const [path, bytes] of before) {
      if ([logsPath, statsPath].includes(path)) expect(readFileSync(join(root, path + '.core.bak'))).toEqual(bytes);
      else expect(readFileSync(join(root, path))).toEqual(bytes);
    }
    const viewer = { query: vi.fn(async () => ['actual log']), getStats: vi.fn(async () => ({ totalEntries: 1, byLevel: { info: 1 }, byChannel: { default: 1 } })),
      getRecentErrors: vi.fn(async () => ['recent error']) };
    const event = { url: new URL('http://localhost/api/admin/logs?limit=2&offset=0') };
    expect(await (await handlers(logsPath, viewer).GET(event)).json()).toEqual({ logs: ['actual log'], total: 1, limit: 2, offset: 0 });
    expect(await (await handlers(statsPath, viewer).GET(event)).json()).toMatchObject({ logs: { totalEntries: 1 }, recentErrors: ['recent error'] });
    const migrated = snapshot();
    await new UpdateCommand().handle([], { 'migrate-core': true, force: true });
    expect(snapshot()).toEqual(migrated); expect(planCoreScaffoldMigrationFromSource(root, ts).edits).toEqual([]);
  });

  it('removes the published Promise property type error without relaxing strict checks', () => {
    fixtures(false, 'zod');
    expect(strictDiagnostics(publishedLogs).some(diagnostic => diagnostic.code === 2339)).toBe(true);
    applyCoreScaffoldMigration(planCoreScaffoldMigrationFromSource(root, ts), { confirmed: true });
    expect(strictDiagnostics(read(logsPath))).toEqual([]); expect(strictDiagnostics(read(statsPath))).toEqual([]);
  });

  it.each(['@beeblock/svelar/logging/LogViewer', '@beeblock/svelar/logging'])('awaits DELETE clear with a named import alias (%s)', async module => {
    fixtures(false, 'valibot');
    const source = `import { LogViewer as Viewer } from '${module}';\nimport { json } from '@sveltejs/kit';\nexport const DELETE = async () => { Viewer.clear(); return json({ success: true }); };\n`;
    write(logsPath, source);
    const cleared = vi.fn(async () => {});
    applyCoreScaffoldMigration(planCoreScaffoldMigrationFromSource(root, ts), { confirmed: true });
    expect(read(logsPath)).toContain('(await Viewer.clear())');
    expect(await (await handlers(logsPath, { clear: cleared }).DELETE!({ url: new URL('http://localhost') })).json()).toEqual({ success: true });
    expect(cleared).toHaveBeenCalledOnce(); expect(read(logsPath + '.core.bak')).toBe(source);
  });

  it('awaits each async viewer method, while leaving configure, tail and unrelated scheduler semantics intact', () => {
    fixtures(false, 'zod');
    const methods = ['query', 'page', 'getStats', 'getRecentErrors', 'addEntry', 'clear', 'prune'];
    const source = `import { LogViewer as Viewer } from '@beeblock/svelar/logging';
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';
import { json } from '@sveltejs/kit';
export const POST = async (event) => { const { name } = event.params; await ScheduleMonitor.runTask(name); return json({ success: true }); };
export const GET = async () => { ${methods.map(method => `Viewer.${method}();`).join(' ')} Viewer.configure({ driver: 'memory' }); const stop = Viewer.tail(() => {}); return stop; };`;
    write(logsPath, source);
    const plan = planCoreScaffoldMigrationFromSource(root, ts);
    expect(plan.errors).toEqual([]); expect(plan.edits[0].tokens).toHaveLength(methods.length * 2);
    applyCoreScaffoldMigration(plan, { confirmed: true });
    const expected = methods.reduce((text, method) => text.replace(`Viewer.${method}()`, `(await Viewer.${method}())`), source);
    expect(read(logsPath)).toBe(expected);
  });

  it('preserves comments, BOM, CRLF, file permissions and exact original backup bytes', () => {
    fixtures(false, 'zod');
    const original = '\uFEFF' + publishedLogs.replace('LogViewer.getStats()', 'LogViewer.getStats(/* retained */)').replace(/\n/g, '\r\n');
    write(logsPath, original); chmodSync(join(root, logsPath), 0o640);
    applyCoreScaffoldMigration(planCoreScaffoldMigrationFromSource(root, ts), { confirmed: true });
    expect(read(logsPath)).toContain('(await LogViewer.getStats(/* retained */))');
    expect(read(logsPath).startsWith('\uFEFF')).toBe(true); expect(read(logsPath).replace(/\r\n/g, '')).not.toContain('\n');
    expect(read(logsPath + '.core.bak')).toBe(original); expect(lstatSync(join(root, logsPath)).mode & 0o777).toBe(0o640);
  });

  it('propagates async query rejection through the retained legacy catch', async () => {
    fixtures(false, 'zod'); applyCoreScaffoldMigration(planCoreScaffoldMigrationFromSource(root, ts), { confirmed: true });
    const response = await handlers(logsPath, { query: async () => { throw new Error('Viewer unavailable'); } }).GET({ url: new URL('http://localhost') });
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: 'Viewer unavailable' });
  });

  it('does not scan or rewrite arbitrary source files', () => {
    write('src/custom.ts', "import { LogViewer } from '@beeblock/svelar/logging'; const stats = LogViewer.getStats();");
    const before = snapshot(); expect(planCoreScaffoldMigrationFromSource(root, ts)).toMatchObject({ edits: [], errors: [] });
    expect(snapshot()).toEqual(before);
  });
});

describe('Promise-aware viewer preservation', () => {
  it.each(["import type { Promise } from './custom.js';", "import { type Promise } from './custom.js';"])(
    'does not treat type-only Promise imports as runtime shadows: %s', declaration => {
      const original = `import { LogViewer as Viewer } from '@beeblock/svelar/logging';\n${declaration}\nexport const GET = async () => Promise.resolve(Viewer.getStats());\n`;
      write(logsPath, original);
      expect(planCoreScaffoldMigrationFromSource(root, ts)).toMatchObject({ edits: [], errors: [] });
      expect(read(logsPath)).toBe(original);
    },
  );

  it.each([
    'await Viewer.getStats()', 'await (Viewer.getStats())', 'await (Viewer.getStats() as Promise<unknown>)',
    'Promise.resolve(Viewer.getStats())', 'await Promise.resolve(Viewer.getStats())',
    'await Promise.all([Viewer.getStats(), other()])', 'Promise.allSettled([Viewer.getStats()])',
    'Promise.race([Viewer.getStats()])', 'Promise.any([Viewer.getStats()])',
    'Viewer.getStats().then(value => value)', 'Viewer.getStats().catch(() => null)',
    'Viewer.getStats().finally(() => {})', '(Viewer.getStats()).then(value => value)',
    "Viewer.getStats()['then'](value => value)", 'void Viewer.clear()',
  ])('leaves already Promise-aware source exactly unchanged: %s', expression => {
    const original = `import { LogViewer as Viewer } from '@beeblock/svelar/logging';\nexport const GET = async () => { ${expression}; };\n`;
    write(logsPath, original);
    expect(planCoreScaffoldMigrationFromSource(root, ts)).toMatchObject({ edits: [], errors: [] });
    expect(read(logsPath)).toBe(original); expect(existsSync(join(root, logsPath + '.core.bak'))).toBe(false);
  });

  it.each([
    "export const GET = async (Viewer) => Viewer.getStats();",
    "export const GET = async ({ Viewer }) => Viewer.getStats();",
    "export const GET = async ([Viewer]) => Viewer.getStats();",
    "export const GET = async () => { const { Viewer } = custom; return Viewer.getStats(); };",
    "export const GET = async () => { const [Viewer] = custom; return Viewer.getStats(); };",
    "export const GET = async () => { const { nested: { Viewer } } = custom; return Viewer.getStats(); };",
    "export const GET = async () => { const { handler: Viewer } = custom; return Viewer.getStats(); };",
    "export const GET = async () => { try {} catch (Viewer) { return Viewer.getStats(); } };",
    "export const GET = async (Promise) => Promise.resolve(Viewer.getStats());",
    "export const GET = async ({ Promise }) => Promise.all([Viewer.getStats()]);",
    "export const GET = async () => { const [Promise] = custom; return Promise.resolve(Viewer.getStats()); };",
    "import { Promise } from './custom.js'; export const GET = async () => Promise.resolve(Viewer.getStats());",
    "export const GET = () => Viewer.getStats();",
    "export const GET = async () => { return [1].map(() => Viewer.getStats()); };",
    "class Custom { get stats() { return Viewer.getStats(); } }",
    "class Custom { stats = Viewer.getStats(); }",
    "class Custom { constructor() { Viewer.clear(); } }",
    "class Custom { static { Viewer.clear(); } }",
    "export const GET = async (stats = Viewer.getStats()) => stats;",
    "const custom = { async [Viewer.getStats()]() {} };",
  ])('blocks unsafe/shadowed contexts before any writes: %s', body => {
    const original = `import { LogViewer as Viewer } from '@beeblock/svelar/logging';\n${body}\n`;
    write(logsPath, original); const before = snapshot();
    const plan = planCoreScaffoldMigrationFromSource(root, ts);
    expect(plan.errors.some(error => error.includes('manual review'))).toBe(true); expect(plan.edits).toEqual([]);
    expect(() => applyCoreScaffoldMigration(plan, { confirmed: true })).toThrow('no files written');
    expect(snapshot()).toEqual(before);
  });
});
