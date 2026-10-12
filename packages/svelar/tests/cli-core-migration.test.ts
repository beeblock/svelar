import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { applyCoreScaffoldMigration, planCoreScaffoldMigration, planCoreScaffoldMigrationFromSource } from '../src/cli/CoreScaffoldMigration.js';
import { UpdateCommand } from '../src/cli/commands/UpdateCommand.js';

const confirmation = vi.hoisted(() => ({ answer: 'yes' }));
vi.mock('node:readline', () => ({ createInterface: () => ({
  question: (_prompt: string, callback: (value: string) => void) => callback(confirmation.answer), close: () => {},
}) }));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, renameSync: vi.fn(original.renameSync) };
});
const originalRename = (await vi.importActual<typeof import('node:fs')>('node:fs')).renameSync;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
let root: string;
let cwd: string;

function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
function read(path: string): string { return readFileSync(join(root, path), 'utf8'); }
function files(directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

export function legacyCoreFixture(flat: boolean): Map<string, string> {
  const shared = flat ? 'src/lib' : 'src/lib/shared';
  const module = flat ? 'src/lib' : 'src/lib/modules/auth/application';
  const provider = flat ? './lib/providers/EventServiceProvider.js' : '$lib/shared/providers/EventServiceProvider.js';
  return new Map([
    ['src/app.ts', `import { EventServiceProvider } from '${provider}';\nconst esp = new EventServiceProvider();\nesp.boot();\nexport const customMarker = 'original bootstrap';\n`],
    [`${shared}/providers/EventServiceProvider.ts`, "import { EventServiceProvider as BaseProvider } from '@beeblock/svelar/events';\nexport class EventServiceProvider extends BaseProvider { protected listen = {}; }\n"],
    [`${shared}/scheduler/QueueHealthCheck.ts`, "import { Queue } from '@beeblock/svelar/queue';\nexport default class QueueHealthCheck { async handle(): Promise<void> {\n    const stats = await Queue.stats();\n    // retained health marker\n    const { pending, failed } = stats;\n    console.log(pending, failed);\n  }\n}\n"],
    [`${module}/notifications/WelcomeNotification.ts`, "import { Notification } from '@beeblock/svelar/notifications';\nexport class WelcomeNotification extends Notification {\n  channels() { return ['database'] as const; }\n  toDatabase() { return { message: 'custom welcome marker' }; }\n}\n"],
    ['src/routes/admin/+page.server.ts', "import { fail } from '@sveltejs/kit';\nexport const load = async (event) => {\n  const user = event.locals.user;\n  const customMarker = 'original admin';\n  return { user: { id: user.id, name: user.name, email: user.email, role: user.role }, customMarker };\n};\nexport const actions = { deleteUser: async (event) => {\n    const denied = await authorize(deleteUserRequest, event);\n    if (denied) return denied;\n    const result = await deleteUserAction.run({ currentUserId: event.locals.user.id });\n    return result;\n  }\n};\n"],
    ['src/routes/api/admin/queue/[id]/+server.ts', route('DELETE', 'JobMonitor', 'queue/JobMonitor', 'id', "await JobMonitor.deleteJob(id);\n    return json({ success: true, message: 'Job removed' });")],
    ['src/routes/api/admin/queue/[id]/retry/+server.ts', route('POST', 'JobMonitor', 'queue/JobMonitor', 'id', "await JobMonitor.retryJob(id);\n    return json({ success: true, message: 'Job queued for retry' });")],
    ['src/routes/api/admin/scheduler/[name]/run/+server.ts', route('POST', 'ScheduleMonitor', 'scheduler/ScheduleMonitor', 'name', 'await ScheduleMonitor.runTask(name);\n    return json({ success: true, message: `Task \'${name}\' triggered` });')],
    ['src/routes/api/admin/scheduler/[name]/toggle/+server.ts', route('POST', 'ScheduleMonitor', 'scheduler/ScheduleMonitor', 'name', "if (enabled) { ScheduleMonitor.enableTask(name); } else { ScheduleMonitor.disableTask(name); }\n    return json({ success: true });", '  const body = await event.request.json();\n  const enabled = body.enabled ?? true;\n')],
  ]);
}

function route(method: string, manager: string, module: string, param: string, operation: string, setup = ''): string {
  return `import { json } from '@sveltejs/kit';\nimport { ${manager} } from '@beeblock/svelar/${module}';\nexport const ${method} = async (event) => {\n  const { ${param} } = event.params;\n${setup}  try {\n    ${operation}\n  } catch { return json({ success: false }, { status: 500 }); }\n};\n`;
}

function fixture(flat = false): Map<string, string> {
  const source = legacyCoreFixture(flat);
  for (const [path, content] of source) write(path, content);
  write('package.json', '{"name":"legacy-custom","type":"module"}\n');
  write('.env', 'APP_KEY=original-secret\r\n');
  write('src/lib/database/migrations/custom.ts', '// original migration');
  return source;
}

interface TestEvent {
  params: Record<string, string | undefined>;
  locals: { user: { id: number; role: string; name: string; email: string } | null };
  request: Request;
}
function event(params: TestEvent['params'] = {}, user: TestEvent['locals']['user'] = { id: 1, role: 'admin', name: 'Admin', email: 'admin@example.com' }, body: unknown = {}): TestEvent {
  return { params, locals: { user }, request: new Request('http://localhost/test', { method: 'POST', body: JSON.stringify(body) }) };
}
const kit = {
  json: (body: unknown, options?: { status: number }) => new Response(JSON.stringify(body), { status: options?.status ?? 200 }),
  fail: (status: number, data: unknown) => ({ status, data }),
  redirect: (status: number, location: string): never => { throw Object.assign(new Error('redirect'), { status, location }); },
  error: (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); },
};
async function execute<T>(path: string, modules: Record<string, unknown> = {}, globals: Record<string, unknown> = {}): Promise<T> {
  const output = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  await runInNewContext(`(async () => { ${output}\n })()`, {
    exports, console, process, require: (name: string) => name === '@sveltejs/kit' ? kit : modules[name], ...globals,
  });
  return exports as T;
}
type Handler = (event: TestEvent) => Promise<Response>;

beforeEach(() => {
  cwd = process.cwd();
  root = mkdtempSync(join(packageRoot, '.test-core-migration-'));
  process.chdir(root);
  confirmation.answer = 'yes';
  vi.mocked(renameSync).mockReset().mockImplementation(originalRename);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Scoped core AST migration', () => {
  it.each([false, true])('changes exactly eight DDD/flat files, exposes rules/tokens, backs up originals and is idempotent (flat=%s)', async (flat) => {
    const originals = fixture(flat);
    const plan = await planCoreScaffoldMigration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits).toHaveLength(8);
    for (const edit of plan.edits) {
      expect(edit.tokens.every((token) => token.start <= token.end && token.rule.length > 0)).toBe(true);
      expect(read(edit.path)).toBe(originals.get(edit.path));
    }
    const backups = applyCoreScaffoldMigration(plan, { confirmed: true });
    expect(backups).toHaveLength(8);
    for (const edit of plan.edits) expect(readFileSync(join(root, `${edit.path}.core.bak`))).toEqual(edit.original);
    expect(read('.env')).toBe('APP_KEY=original-secret\r\n');
    expect(read('src/lib/database/migrations/custom.ts')).toBe('// original migration');
    const next = await planCoreScaffoldMigration(root);
    expect(next.errors).toEqual([]);
    expect(next.edits).toEqual([]);
  });

  it('preserves BOM/CRLF, comments, examples, unrelated custom code and the existing JSON body semantics', async () => {
    fixture();
    const path = 'src/lib/shared/scheduler/QueueHealthCheck.ts';
    const original = '\uFEFF' + read(path).replace(/\n/g, '\r\n') + "\r\n// Queue.stats() example must remain\r\nexport const example = 'Queue.stats()';\r\n";
    write(path, original);
    const plan = await planCoreScaffoldMigration(root);
    expect(plan.errors).toEqual([]);
    applyCoreScaffoldMigration(plan, { confirmed: true });
    expect(read(path)).toBe(original.replace('await Queue.stats()', '{ pending: await Queue.size(), failed: (await Queue.failed()).length }'));
    expect(read('src/routes/api/admin/scheduler/[name]/toggle/+server.ts')).toContain('const enabled = body.enabled ?? true;');
    expect(plan.warnings.join('\n')).toContain('not full BullMQ');
    expect(plan.warnings.join('\n')).toContain('JSON/schema APIs are not migrated');
  });

  it.each(['./lib/providers/EventServiceProvider.js', '$lib/providers/EventServiceProvider.js'])(
    'verifies the actual flat provider and preserves its import spelling: %s', async (specifier) => {
      fixture(true);
      write('src/app.ts', read('src/app.ts').replace('./lib/providers/EventServiceProvider.js', specifier));
      const original = read('src/app.ts');
      const plan = await planCoreScaffoldMigration(root);
      expect(plan.errors).toEqual([]);
      expect(plan.edits).toHaveLength(8);
      applyCoreScaffoldMigration(plan, { confirmed: true });
      expect(read('src/app.ts')).toContain(`from '${specifier}'`);
      expect(read('src/app.ts')).toContain('new EventServiceProvider(svelarCoreContainer)');
      expect(read('src/app.ts')).toContain('await esp.boot();');
      expect(read('src/app.ts.core.bak')).toBe(original);
    },
  );

  it('does not treat an arbitrary relative provider or customized constructor as the published flat scaffold', async () => {
    fixture(true);
    write('src/app.ts', read('src/app.ts').replace('./lib/providers/EventServiceProvider.js', '../outside/providers/EventServiceProvider.js'));
    const unsupported = await planCoreScaffoldMigration(root);
    expect(unsupported.errors.join('\n')).toContain('Provider import differs');
    expect(() => applyCoreScaffoldMigration(unsupported, { confirmed: true })).toThrow('preflight failed');
    fixture(true);
    write('src/lib/providers/EventServiceProvider.ts', read('src/lib/providers/EventServiceProvider.ts')
      .replace('protected listen = {};', 'constructor() { super(customContainer); }'));
    const custom = await planCoreScaffoldMigration(root);
    expect(custom.errors.join('\n')).toContain('Custom provider inheritance/constructor');
    expect(files().some((path) => path.includes('.core.bak'))).toBe(false);
  });

  it.each([
    ['src/lib/shared/providers/EventServiceProvider.ts', 'protected listen = {};', 'constructor() { super(customContainer); }'],
    ['src/lib/shared/scheduler/QueueHealthCheck.ts', 'const { pending, failed } = stats;', 'const { pending, failed, custom } = stats;'],
    ['src/lib/modules/auth/application/notifications/WelcomeNotification.ts', "['database'] as const", "['database', 'mail'] as const"],
    ['src/routes/api/admin/queue/[id]/+server.ts', 'const { id } = event.params;', 'const id = customizedId(event);'],
    ['src/lib/shared/scheduler/QueueHealthCheck.ts', 'Queue.stats()', 'Queue.stats(/* custom comment */)'],
  ])('refuses customized legacy pattern before any writes: %s', async (path, old, replacement) => {
    fixture();
    write(path, read(path).replace(old, replacement));
    const before = read('src/app.ts');
    const plan = await planCoreScaffoldMigration(root);
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(() => applyCoreScaffoldMigration(plan, { confirmed: true })).toThrow('preflight failed');
    expect(read('src/app.ts')).toBe(before);
    expect(files().some((path) => path.includes('.core.bak'))).toBe(false);
  });

  it('requires approval, detects stale files before backups and preserves numbered existing backups/modes', async () => {
    fixture();
    const plan = await planCoreScaffoldMigration(root);
    expect(() => applyCoreScaffoldMigration(plan, { confirmed: false })).toThrow('confirmation');
    write('src/app.ts', read('src/app.ts') + '// concurrent customization\n');
    expect(() => applyCoreScaffoldMigration(plan, { confirmed: true })).toThrow('changed after planning');
    expect(files().some((path) => path.includes('.core.bak'))).toBe(false);
    write('src/app.ts.core.bak', 'existing backup');
    chmodSync(join(root, 'src/app.ts'), 0o640);
    const refreshed = await planCoreScaffoldMigration(root);
    const original = read('src/app.ts');
    expect(applyCoreScaffoldMigration(refreshed, { confirmed: true })).toContain('src/app.ts.core.bak.1');
    expect(read('src/app.ts.core.bak')).toBe('existing backup');
    expect(read('src/app.ts.core.bak.1')).toBe(original);
    expect(lstatSync(join(root, 'src/app.ts')).mode & 0o777).toBe(0o640);
  });

  it('rolls back prior edits on failure and retains exact originals', async () => {
    fixture();
    const plan = await planCoreScaffoldMigration(root);
    vi.mocked(renameSync).mockImplementationOnce(originalRename).mockImplementationOnce(() => { throw new Error('injected I/O failure'); });
    expect(() => applyCoreScaffoldMigration(plan, { confirmed: true })).toThrow('injected I/O failure');
    for (const edit of plan.edits) {
      expect(readFileSync(join(root, edit.path))).toEqual(edit.original);
      expect(readFileSync(join(root, `${edit.path}.core.bak`))).toEqual(edit.original);
    }
    expect(files().some((path) => path.endsWith('.tmp'))).toBe(false);
  });

  it('preserves concurrent edits during rollback and reports recovery', async () => {
    fixture();
    const plan = await planCoreScaffoldMigration(root);
    vi.mocked(renameSync).mockImplementationOnce(originalRename).mockImplementationOnce(() => {
      write('src/app.ts', '// concurrent user edit');
      throw new Error('injected I/O failure');
    });
    expect(() => applyCoreScaffoldMigration(plan, { confirmed: true })).toThrow('Rollback needs review');
    expect(read('src/app.ts')).toBe('// concurrent user edit');
  });

  it('refuses symlink targets', async () => {
    fixture();
    rmSync(join(root, 'src/app.ts'));
    symlinkSync(join(root, 'package.json'), join(root, 'src/app.ts'));
    const plan = await planCoreScaffoldMigration(root);
    expect(plan.errors.join('\n')).toContain('symlinks');
    expect(() => applyCoreScaffoldMigration(plan, { confirmed: true })).toThrow('preflight failed');
  });

  it('plans explicit expectations against an original source snapshot without writing', () => {
    const originals = fixture();
    const snapshot = new Map([...originals].map(([path, content]) => [path, Buffer.from(content)]));
    const plan = planCoreScaffoldMigrationFromSource(root, ts, snapshot);
    expect(plan.errors).toEqual([]);
    expect(plan.edits).toHaveLength(8);
    expect(read('src/app.ts')).toBe(originals.get('src/app.ts'));
  });
});

describe('Migrated runtime semantics', () => {
  beforeEach(async () => {
    fixture();
    const plan = await planCoreScaffoldMigration(root);
    expect(plan.errors).toEqual([]);
    applyCoreScaffoldMigration(plan, { confirmed: true });
  });

  it.each([
    ['src/routes/api/admin/queue/[id]/+server.ts', 'DELETE', 'JobMonitor', 'queue/JobMonitor', 'deleteJob', 'id', 404],
    ['src/routes/api/admin/queue/[id]/retry/+server.ts', 'POST', 'JobMonitor', 'queue/JobMonitor', 'retryJob', 'id', 409],
  ] as const)('guards params and does not report false operation success: %s', async (path, verb, name, module, method, param, status) => {
    const operation = vi.fn().mockResolvedValue(false);
    const api = await execute<Record<string, Handler>>(path, { [`@beeblock/svelar/${module}`]: { [name]: { [method]: operation } } });
    expect((await api[verb](event())).status).toBe(400);
    expect(operation).not.toHaveBeenCalled();
    const response = await api[verb](event({ [param]: 'job-1' }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ success: false });
    operation.mockResolvedValueOnce(true);
    expect((await api[verb](event({ [param]: 'job-1' }))).status).toBe(200);
  });

  it.each([{ success: true, skipped: true, status: 409 }, { success: false, skipped: false, status: 500 }, { success: true, skipped: false, status: 200 }])(
    'surfaces scheduler run outcomes ($success, skipped=$skipped)', async ({ success, skipped, status }) => {
      const runTask = vi.fn().mockResolvedValue({ success, skipped });
      const api = await execute<{ POST: Handler }>('src/routes/api/admin/scheduler/[name]/run/+server.ts', {
        '@beeblock/svelar/scheduler/ScheduleMonitor': { ScheduleMonitor: { runTask } },
      });
      expect((await api.POST(event())).status).toBe(400);
      expect(runTask).not.toHaveBeenCalled();
      const response = await api.POST(event({ name: 'task-1' }));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ success: status === 200 });
    },
  );

  it.each([true, false])('awaits toggle persistence before success and catches rejection (enabled=%s)', async (enabled) => {
    const operation = vi.fn().mockRejectedValueOnce(new Error('persistence failed')).mockResolvedValueOnce(undefined);
    const api = await execute<{ POST: Handler }>('src/routes/api/admin/scheduler/[name]/toggle/+server.ts', {
      '@beeblock/svelar/scheduler/ScheduleMonitor': { ScheduleMonitor: { enableTask: operation, disableTask: operation } },
    });
    expect((await api.POST(event({}, undefined, { enabled }))).status).toBe(400);
    expect(operation).not.toHaveBeenCalled();
    expect((await api.POST(event({ name: 'task-1' }, undefined, { enabled }))).status).toBe(500);
    expect((await api.POST(event({ name: 'task-1' }, undefined, { enabled }))).status).toBe(200);
  });

  it('guards admin load/delete before side effects and preserves the existing authorization decision', async () => {
    const authorize = vi.fn().mockResolvedValue(null);
    const run = vi.fn().mockResolvedValue({ success: true });
    const api = await execute<{ load: (event: TestEvent) => Promise<unknown>; actions: { deleteUser: (event: TestEvent) => Promise<unknown> } }>(
      'src/routes/admin/+page.server.ts', {}, { authorize, deleteUserRequest: {}, deleteUserAction: { run } },
    );
    await expect(api.load(event({}, null))).rejects.toMatchObject({ status: 303 });
    await expect(api.load(event({}, { id: 2, role: 'user', name: 'Demo', email: 'demo@example.com' }))).rejects.toMatchObject({ status: 403 });
    expect(await api.actions.deleteUser(event({}, null))).toMatchObject({ status: 401 });
    expect(await api.actions.deleteUser(event({}, { id: 2, role: 'user', name: 'Demo', email: 'demo@example.com' }))).toMatchObject({ status: 403 });
    expect(authorize).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    authorize.mockResolvedValueOnce({ status: 403 });
    expect(await api.actions.deleteUser(event())).toMatchObject({ status: 403 });
    expect(run).not.toHaveBeenCalled();
    expect(await api.actions.deleteUser(event())).toEqual({ success: true });
    expect(run).toHaveBeenCalledWith({ currentUserId: 1 });
  });

  it('uses supported queue observations and retains notification channels at runtime', async () => {
    const size = vi.fn().mockResolvedValue(7);
    const failed = vi.fn().mockResolvedValue([{}, {}]);
    const task = await execute<{ default: new () => { handle(): Promise<void> } }>('src/lib/shared/scheduler/QueueHealthCheck.ts', {
      '@beeblock/svelar/queue': { Queue: { size, failed } },
    });
    await new task.default().handle();
    expect(size).toHaveBeenCalledWith();
    expect(failed).toHaveBeenCalledWith();
    expect(console.log).toHaveBeenCalledWith(7, 2);
    const notification = await execute<{ WelcomeNotification: new () => { channels(): string[] } }>('src/lib/modules/auth/application/notifications/WelcomeNotification.ts', {
      '@beeblock/svelar/notifications': { Notification: class {} },
    });
    expect(new notification.WelcomeNotification().channels()).toEqual(['database']);
  });
});

describe('UpdateCommand core opt-in', () => {
  it.each(['dry-run', 'list'])('previews named token rules with --%s without source/backup writes', async (flag) => {
    const original = fixture();
    const command = new UpdateCommand();
    await command.handle([], { 'migrate-core': true, [flag]: true, force: true });
    expect(command.exitCode).toBe(0);
    for (const [path, content] of original) expect(read(path)).toBe(content);
    expect(files().some((path) => path.includes('.core.bak'))).toBe(false);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('queue-delete-outcome');
  });

  it('force applies only finite core tokens, leaving packages/configs/secret/schema bytes unchanged', async () => {
    fixture();
    write('vite.config.ts', '// custom config');
    write('src/lib/schemas/custom.ts', '// custom schema');
    const command = new UpdateCommand();
    await command.handle([], { 'migrate-core': true, force: true });
    expect(command.exitCode).toBe(0);
    expect(read('src/app.ts')).toContain('new EventServiceProvider(svelarCoreContainer)');
    expect(read('vite.config.ts')).toBe('// custom config');
    expect(read('src/lib/schemas/custom.ts')).toBe('// custom schema');
    expect(read('package.json')).toBe('{"name":"legacy-custom","type":"module"}\n');
    expect(existsSync(join(root, 'src/svelar.d.ts'))).toBe(false);
  });

  it.each(['migrate-zod4', 'include-user-files', 'add-missing-user-files', 'category'])('refuses mixing migration with %s', async (flag) => {
    fixture();
    const command = new UpdateCommand();
    await command.handle([], { 'migrate-core': true, [flag]: flag === 'category' ? 'config' : true, force: true });
    expect(command.exitCode).toBe(1);
    expect(files().some((path) => path.includes('.core.bak'))).toBe(false);
  });

  it.each([true, false])('requires explicit approval (TTY=%s)', async (tty) => {
    const originals = fixture();
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: tty });
    confirmation.answer = 'no';
    try {
      const command = new UpdateCommand();
      await command.handle([], { 'migrate-core': true });
      expect(command.exitCode).toBe(tty ? 0 : 1);
      for (const [path, content] of originals) expect(read(path)).toBe(content);
      expect(files().some((path) => path.includes('.core.bak'))).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor);
      else Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });
});
