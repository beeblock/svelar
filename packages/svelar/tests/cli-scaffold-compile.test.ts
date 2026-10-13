import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fail, redirect } from '@sveltejs/kit';
import ts from 'typescript';
import { Container, container } from '../src/container/Container.js';
import { NewCommandTemplates as T } from '../src/cli/commands/NewCommandTemplates.js';
import { transformScaffoldFile } from '../src/cli/commands/NewCommand.js';
import { UpdateCommand } from '../src/cli/commands/UpdateCommand.js';
import { Notification } from '../src/notifications/index.js';
import { Model } from '../src/orm/Model.js';
import { ScheduledTask } from '../src/scheduler/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = new Map<string, ts.SourceFile>();
let previousProgram: ts.Program | undefined;

function evaluate(source: string, dependencies: Record<string, unknown>): Record<string, unknown> {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function('exports', 'require', 'module', compiled.outputText)(module.exports, (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected template import: ${name}`);
    return dependencies[name];
  }, module);
  return module.exports;
}

function bootStatements(): string {
  const source = ts.createSourceFile('app.ts', T.appTs(), ts.ScriptTarget.Latest, true);
  const boot = source.statements.filter((statement) =>
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => declaration.name.getText(source) === 'esp'))
    || (ts.isExpressionStatement(statement) && statement.getText(source).includes('esp.boot()')));
  expect(boot).toHaveLength(2);
  return boot.map((statement) => statement.getText(source)).join('\n');
}

function typeDiagnostics(files: Record<string, string>): ts.Diagnostic[] {
  const root = join(packageRoot, '.virtual-scaffold-typecheck');
  const virtual = new Map(Object.entries(files).map(([path, content]) => [join(root, path), content]));
  const configPath = resolve(packageRoot, '../../tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const projectOptions = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, dirname(configPath));
  const options: ts.CompilerOptions = {
    ...projectOptions.options,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    noEmit: true,
    types: ['node'],
    paths: {
      '@beeblock/svelar/*': [join(packageRoot, 'src/*/index.ts')],
      '$lib/*': [join(root, 'src/lib/*')],
    },
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  host.readFile = (path) => virtual.get(path) ?? readFile(path);
  host.fileExists = (path) => virtual.has(path) || fileExists(path);
  host.directoryExists = (path) => [...virtual.keys()].some((file) => file.startsWith(path + '/')) || (directoryExists?.(path) ?? false);
  host.getSourceFile = (path, languageVersion) => {
    const content = host.readFile(path);
    if (content === undefined) return undefined;
    const cached = sourceFiles.get(path);
    if (cached?.text === content) return cached;
    const source = ts.createSourceFile(path, content, languageVersion, true);
    sourceFiles.set(path, source);
    return source;
  };
  const program = ts.createProgram([...virtual.keys(), join(packageRoot, 'src/types/externals.d.ts')], options, host, previousProgram);
  previousProgram = program;
  return ts.getPreEmitDiagnostics(program);
}

function fixtureFiles(flat: boolean): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, content] of [
    ['src/svelar.d.ts', T.appDts()],
    ['src/lib/modules/auth/User.ts', T.userModel()],
    ['src/lib/modules/posts/Post.ts', T.postModel()],
    ['src/lib/modules/auth/WelcomeNotification.ts', T.welcomeNotification()],
    ['src/lib/shared/scheduler/QueueHealthCheck.ts', T.queueHealthCheck()],
    ['src/lib/shared/providers/EventServiceProvider.ts', T.eventServiceProvider()],
    ['src/lib/modules/auth/UserRegistered.ts', 'export class UserRegistered {}'],
    ['src/lib/modules/auth/SendWelcomeEmailListener.ts', 'export class SendWelcomeEmailListener { handle(_event: unknown): void {} }'],
  ]) {
    const result = transformScaffoldFile(path, content, flat);
    files[result.path] = result.content;
  }
  const providerImport = flat ? '$lib/providers/EventServiceProvider.js' : '$lib/shared/providers/EventServiceProvider.js';
  files['src/bootstrap.ts'] = `import { container } from '@beeblock/svelar/container';
import { EventServiceProvider } from '${providerImport}';
${bootStatements()}
`;
  return files;
}

afterEach(() => vi.restoreAllMocks());

describe('Scaffold compile contracts', () => {
  it.each([false, true])('strictly compiles the corrected templates against public package exports (flat=%s)', (flat) => {
    const files = fixtureFiles(flat);
    const model = flat ? '$lib/models/User.js' : '$lib/modules/auth/domain/models/User.js';
    const notification = flat ? '$lib/notifications/WelcomeNotification.js' : '$lib/modules/auth/application/notifications/WelcomeNotification.js';
    files['src/probe.ts'] = `import type { AuthManager } from '@beeblock/svelar/auth';
import type { Session } from '@beeblock/svelar/session';
import type { Notification, NotificationChannel } from '@beeblock/svelar/notifications';
import { User } from '${model}';
import { WelcomeNotification } from '${notification}';
declare const locals: App.Locals;
declare const auth: AuthManager;
declare const session: Session;
locals.auth = auth;
locals.session = session;
locals.user = null;
locals.user = new User();
const id: number = locals.user.id;
const name: string = locals.user.name;
const notification: Notification = new WelcomeNotification(locals.user);
const channels: NotificationChannel[] = notification.channels(locals.user);
channels.push('email');
await locals.auth.attempt({ email: locals.user.email, password: 'test-password' }, locals.session);
`;
    const diagnostics = typeDiagnostics(files);
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  }, 60_000);

  it('rejects invalid locals assignments rather than hiding them behind an index signature', () => {
    const files = fixtureFiles(false);
    files['src/invalid-locals.ts'] = `export {};
declare const locals: App.Locals;
locals.auth = 'invalid';
locals.session = {};
locals.user = { id: 1 };
locals.user = undefined;
locals.undefinedField = true;
`;
    const diagnostics = typeDiagnostics(files);
    expect(diagnostics).toHaveLength(5);
    expect(diagnostics.every((diagnostic) => diagnostic.file?.fileName.endsWith('/invalid-locals.ts'))).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 2339)).toBe(true);
    expect(T.appDts()).not.toMatch(/\bany\b|\[key:|@ts-ignore|@ts-nocheck/);
  });

  it('registers the declaration in the new command write flow', () => {
    const source = ts.createSourceFile('NewCommand.ts', readFileSync(join(packageRoot, 'src/cli/commands/NewCommand.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const writes: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'write'
        && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'src/svelar.d.ts') writes.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(writes).toHaveLength(1);
    expect(writes[0].arguments[1].getText(source)).toBe('T.appDts()');
  });
});

interface ManifestFile {
  path: string;
  content(): string;
  ownership: 'user' | 'framework';
}

describe.sequential('Locals declaration upgrades', () => {
  it.each([false, true])('uses the same declarations and User imports for new and updated apps (flat=%s)', (flat) => {
    const command = new UpdateCommand() as unknown as { getFileManifest(ddd: boolean, projectName: string): ManifestFile[] };
    const file = command.getFileManifest(!flat, 'typecheck-app').find((entry) => entry.path === 'src/svelar.d.ts');
    expect(file?.ownership).toBe('user');
    expect(file?.content()).toBe(transformScaffoldFile('src/svelar.d.ts', T.appDts(), flat).content);
    expect(file?.content()).toContain(flat ? '$lib/models/User.js' : '$lib/modules/auth/domain/models/User.js');
  });

  it('preserves custom declarations by default and reports missing declarations for review', async () => {
    const cwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'svelar-locals-upgrade-'));
    try {
      process.chdir(root);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      mkdirSync('src/lib/modules', { recursive: true });
      writeFileSync('package.json', JSON.stringify({ name: 'typecheck-app' }));
      const custom = 'export {};\ndeclare global { namespace App { interface Locals { custom: string; } } }\n';
      writeFileSync('src/svelar.d.ts', custom);
      await new UpdateCommand().handle([], { force: true, category: 'config' });
      expect(readFileSync('src/svelar.d.ts', 'utf8')).toBe(custom);
      rmSync('src/svelar.d.ts');
      await new UpdateCommand().handle([], { list: true, category: 'config', 'include-user-files': true });
      expect(log.mock.calls.flat().some((value) => typeof value === 'string' && value.includes('src/svelar.d.ts'))).toBe(true);
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Scaffold runtime compile fixes', () => {
  it('redirects a null admin user before querying private data', async () => {
    const template = T.adminPageServer();
    const source = ts.createSourceFile('admin-page.ts', template, ts.ScriptTarget.Latest, true);
    const dependencies: Record<string, unknown> = {};
    class Placeholder {}
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      dependencies[statement.moduleSpecifier.text] = Object.fromEntries(bindings.elements.map((binding) => [binding.name.text, Placeholder]));
    }
    const can = vi.fn(() => { throw new Error('Capabilities queried without a user'); });
    dependencies['@sveltejs/kit'] = { fail, redirect };
    dependencies['$lib/shared/permissions/access.server.js'] = { capabilityAccess: { can }, resolveCapabilityInput: vi.fn() };
    const module = evaluate(template, dependencies);
    const load = module.load as (event: { locals: { user: null } }) => Promise<unknown>;
    await expect(load({ locals: { user: null } })).rejects.toMatchObject({ status: 302, location: '/login' });
    expect(can).not.toHaveBeenCalled();
    expect(template).not.toContain('User.query');
    expect(template).not.toContain('export const actions');
  });

  it('passes the public container and awaits provider boot completion', async () => {
    let booted = false;
    class Provider {
      constructor(readonly app: Container) {}
      async boot(): Promise<void> { await Promise.resolve(); booted = true; }
    }
    const run = new Function('EventServiceProvider', 'container', `return (async () => { ${bootStatements()} return esp; })();`);
    const provider: Provider = await run(Provider, container);
    expect(provider.app).toBe(container);
    expect(booted).toBe(true);
  });

  it('propagates asynchronous provider boot failures', async () => {
    class Provider {
      async boot(): Promise<void> { throw new Error('boot failed'); }
    }
    const run = new Function('EventServiceProvider', 'container', `return (async () => { ${bootStatements()} })();`);
    await expect(run(Provider, container)).rejects.toThrow('boot failed');
  });

  it.each([0, 101])('uses supported queue APIs and reports pending=%s and failed counts', async (pending) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queue = { size: vi.fn(async () => pending), failed: vi.fn(async () => [{ id: 'failed-1' }, { id: 'failed-2' }]) };
    const module = evaluate(T.queueHealthCheck(), {
      '@beeblock/svelar/queue': { Queue: queue },
      '@beeblock/svelar/scheduler': { ScheduledTask },
    });
    const Task = module.default as new () => ScheduledTask;
    await new Task().handle();
    expect(queue.size).toHaveBeenCalledOnce();
    expect(queue.failed).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(`[QueueHealthCheck] Queue stats: ${pending} pending, 2 failed`);
    expect(warn).toHaveBeenCalledWith('[QueueHealthCheck] 2 failed jobs in queue');
    if (pending > 100) expect(warn).toHaveBeenCalledWith(`[QueueHealthCheck] Queue backlog: ${pending} pending jobs`);
    expect(T.queueHealthCheck()).not.toContain('Queue.stats');
  });

  it('returns a mutable channel array compatible with the public notification contract', () => {
    class User extends Model {
      declare id: number;
      declare name: string;
    }
    const module = evaluate(T.welcomeNotification(), { '@beeblock/svelar/notifications': { Notification } });
    const Welcome = module.WelcomeNotification as new (user: User) => Notification;
    const user = new User({ id: 1, name: 'Test User' });
    const notification = new Welcome(user);
    const channels = notification.channels(user);
    expect(channels).toEqual(['database']);
    channels.push('email');
    expect(notification.toDatabase?.(user)?.data?.userId).toBe(1);
  });
});
