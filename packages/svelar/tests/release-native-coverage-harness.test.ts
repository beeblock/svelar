import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

const harness = await import(new URL('../../../scripts/release-smoke.mjs', import.meta.url).href);
const sha256 = 'a'.repeat(64);
const controllerTitle = 'preserves installed Controller native Kit errors/redirects and reports unexpected failures safely';
const httpTitle = 'bounds real outbound HTTP across installed child processes with shared Redis credential/account quotas';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const typeClient = process.env.SVELAR_RELEASE_COVERAGE_TYPE_CLIENT ?? resolve(repository, '../svelar-testing-area/apps/svelar-smoke-ddd');
const hasTypeClient = ['@beeblock/svelar', 'ioredis', 'vitest', '@types/node'].every(name => existsSync(join(typeClient, 'node_modules', name, 'package.json')));

function parsed(flat = false) {
  return ts.createSourceFile('certification.ts', harness.certificationTestSource(flat, sha256), ts.ScriptTarget.Latest, true);
}

function callbackCall(source: ts.SourceFile, title: string): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === title) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw new Error('Missing installed coverage assertion: ' + title);
  return found;
}

function helperSource(source: ts.SourceFile, name: string): string {
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error('Missing owned fixture helper: ' + name);
  return declaration.getText(source);
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);
  send = vi.fn();
}

function childHarness() {
  const child = new FakeChild();
  const spawn = vi.fn(() => child);
  const compiled = ts.transpileModule(helperSource(parsed(), 'startHttpBudgetChild') + '\nexport { startHttpBudgetChild };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports: Record<string, any> = {};
  new Function('exports', 'spawn', 'process', compiled.outputText)(exports, spawn, { execPath: '/proof/node', cwd: () => '/proof/app', env: {} });
  const peer = exports.startHttpBudgetChild({ sha256 });
  return { child, spawn, peer };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Installed release coverage contracts (no native execution)', () => {
  it('does not authorize destructive resets for SQLite or an external SQL database', () => {
    expect(harness.certificationDatabaseResetOptions({ db: 'sqlite' })).toEqual({ refreshDatabase: true });
    for (const db of ['postgres', 'mysql']) {
      expect(() => harness.certificationDatabaseResetOptions({ db, env: { DB_DRIVER: db } })).toThrow('created by this smoke run');
      expect(() => harness.certificationDatabaseResetOptions({ db, ownedDatabase: true, env: { DB_DRIVER: 'sqlite' } })).toThrow('created by this smoke run');
    }
    expect(harness.certificationTestSource(false, sha256)).not.toContain('"allowDestructiveDatabase":true');
  });

  it.each(['postgres', 'mysql'])('explicitly authorizes only the owned %s smoke database', (db) => {
    const options = harness.certificationDatabaseResetOptions({ db, ownedDatabase: true, env: { DB_DRIVER: db } });
    expect(options).toEqual({ refreshDatabase: true, allowDestructiveDatabase: true });
    const file = ts.createSourceFile('certification.ts', harness.certificationTestSource(false, sha256, options), ts.ScriptTarget.Latest, true);
    let found: ts.CallExpression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(file) === 'useSvelarTest') found = node;
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(found?.arguments[0].getText(file)).toContain('"allowDestructiveDatabase":true');
  });

  it.each([false, true])('emits real Kit and installed Controller assertions in flat=%s', (flat) => {
    const source = parsed(flat);
    const call = callbackCall(source, controllerTitle).getText(source);
    expect(source.text).toContain("from '@sveltejs/kit'");
    expect(source.text).toContain("import { Controller } from '@beeblock/svelar/routing'");
    expect(call).toContain("kitError(404, 'Certification record missing')");
    expect(call).toContain("kitRedirect(303, '/certification-destination')");
    expect(call).toContain("controller.handle('missing')(event)");
    expect(call).toContain("controller.handle('navigate')(event)");
    expect(call).toContain("controller.handle('unexpected')(event)");
    expect(call).toContain('ErrorHandler.bindForRequest');
    expect(call).toContain('expect(reported).toEqual([secret])');
    expect(call).toContain('expect(JSON.stringify(payload)).not.toContain(secret)');
    expect(call).not.toMatch(/vi\.mock|fakeHttp|interceptHttp/);
  });

  it.each([false, true])('combines UUID tenant lifecycle and persistent audit assertions in flat=%s', (flat) => {
    const source = parsed(flat);
    const call = callbackCall(source, 'persists find-or-create models with tenant scopes, casts, IDs and observer diffs').getText(source);
    expect(source.text).toContain("import { Audit, auditable } from '@beeblock/svelar/audit'");
    expect(call).toContain('class HelperRecord extends HasUuids(TenantModel)');
    expect(call).toContain('auditable(HelperRecord)');
    expect(call).toContain('ApplicationContext.run');
    expect(call).toContain("entry.metadata?.actorId === 'helper-actor'");
    expect(call).toContain("entry.metadata?.teamId === 'helper-team-a'");
    expect(call).toContain("oldValues: expect.objectContaining({ title: 'Created' })");
    expect(call).toContain("newValues: expect.objectContaining({ title: 'Updated' })");
    expect(call).toContain('expect(createdAudit).toHaveLength(1)');
    expect(call).toContain('expect(updatedAudit).toHaveLength(2)');
    expect(call).not.toContain("driver: 'memory'");
    expect(source.text).toContain('await Cache.close()');
  });

  it('pins each child to archive SHA, installed lock integrity and physical public exports', () => {
    const source = harness.installedHttpBudgetChildSource();
    expect(source).toContain("createRequire(config.appManifest)");
    expect(source).toContain("createHash('sha256').update(archiveBytes)");
    expect(source).toContain("createHash('sha512').update(archiveBytes)");
    expect(source).toContain("lock.packages?.['node_modules/@beeblock/svelar']?.integrity !== integrity");
    expect(source).toContain("require.resolve('@beeblock/svelar/package.json')");
    expect(source).toContain("manifest.exports[name]");
    expect(source).toContain("realpathSync(coreRoot)");
    expect(source).toContain("import(pathToFileURL(path).href)");
    expect(source).toContain("publicEntry('./http')");
    expect(source).toContain("publicEntry('./cache')");
    expect(source).not.toMatch(/packages\/svelar\/src|interceptHttp|fakeHttp|stubGlobal|fetch\s*=/);
  });

  it.each(['matching', 'same-version-other-archive', 'missing'] as const)('enforces selected archive lock integrity (%s)', (kind) => {
    const source = ts.createSourceFile('child.js', harness.installedHttpBudgetChildSource(), ts.ScriptTarget.Latest, true);
    const body = source.statements.find(ts.isTryStatement)!.tryBlock.statements;
    const boundary = body.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'coreRoot'));
    expect(boundary).toBeGreaterThan(0);
    const verify = new Function('config', 'readFileSync', 'createHash', 'dirname', 'resolve', body.slice(0, boundary).map(node => node.getText(source)).join('\n') + '\nreturn sha256;');
    const bytes = Buffer.from('selected fixture archive bytes, never packed or installed');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const integrityBytes = kind === 'same-version-other-archive' ? Buffer.from('different archive with the same version') : bytes;
    const lock = { packages: { 'node_modules/@beeblock/svelar': { version: '0.8.0', ...(kind === 'missing' ? {} : { integrity: 'sha512-' + createHash('sha512').update(integrityBytes).digest('base64') }) } } };
    const files: Record<string, string | Buffer> = {
      '/proof/app/package.json': JSON.stringify({ dependencies: { '@beeblock/svelar': 'file:./core.tgz' } }),
      '/proof/app/core.tgz': bytes,
      '/proof/app/package-lock.json': JSON.stringify(lock),
    };
    const read = (path: string) => { if (!(path in files)) throw new Error('Unexpected proof read'); return files[path]; };
    const run = () => verify({ appManifest: '/proof/app/package.json', sha256: digest }, read, createHash, dirname, resolve);
    if (kind === 'matching') expect(run()).toBe(digest);
    else expect(run).toThrow('installed lock integrity mismatch');
  });

  it('requires actual receiver counts, both independent quota controls and charged 429 retries', () => {
    const source = parsed();
    const call = callbackCall(source, httpTitle).getText(source);
    expect(call).toContain('if (!process.env.REDIS_URL) return');
    expect(call).toContain(sha256);
    expect(call).toContain("phase: 'account', accountLimit: 7, credentialLimit: 25");
    expect(call).toContain("phase: 'credential', accountLimit: 25, credentialLimit: 5");
    expect(call).toContain("phase: 'retry', accountLimit: 4, credentialLimit: 4");
    expect(call).toContain('new Set(ready.map(peer => peer.pid)).size');
    expect(call).toContain('received.filter(request => request.status === 200)');
    expect(call).toContain('received.filter(request => request.status === 429)');
    expect(call).toContain('expect(receiver.requests).toHaveLength(before)');
    expect(call).toContain("redis.scan(cursor, 'MATCH', prefix + '*'");
    expect(call).toContain('finally { redis.disconnect(); }');
    expect(call).toContain('await receiver.close()');
    expect(call).not.toMatch(/flushall|flushdb|Cache\.configure|fakeHttp|interceptHttp/);
    expect(helperSource(source, 'startHttpBudgetReceiver')).toContain("server.listen(0, '127.0.0.1'");
  });

  it.skipIf(!hasTypeClient)('strictly compiles new injected tests/helpers and the child HttpClient call against installed public declarations', () => {
    const source = parsed();
    const child = ts.createSourceFile('child.js', harness.installedHttpBudgetChildSource(), ts.ScriptTarget.Latest, true);
    let client: ts.Expression | undefined;
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(child) === 'client') client = node.initializer;
      ts.forEachChild(node, visit);
    }
    visit(child);
    expect(client).toBeDefined();
    const code = `import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { it, expect } from 'vitest';
import Redis from 'ioredis';
import { error as kitError, redirect as kitRedirect, isHttpError, isRedirect } from '@sveltejs/kit';
import { Controller } from '@beeblock/svelar/routing';
import { ErrorHandler } from '@beeblock/svelar/errors';
import { createRequestEvent } from '@beeblock/svelar/testing';
${callbackCall(source, controllerTitle).getText(source)};
${callbackCall(source, httpTitle).getText(source)};
${['startHttpBudgetChild', 'startHttpBudgetReceiver'].map(name => helperSource(source, name)).join('\n')}
declare const http: { module: typeof import('@beeblock/svelar/http') };
declare const cache: { module: typeof import('@beeblock/svelar/cache') };
declare const config: { retry: boolean; phase: string; credentialLimit: number; accountLimit: number };
const publicClient = ${client!.getText(child)};
`;
    const filename = join(typeClient, 'tests/feature/.virtual-release-native-coverage.ts');
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: ['node'], typeRoots: [join(typeClient, 'node_modules/@types')] };
    const host = ts.createCompilerHost(options);
    const originalSource = host.getSourceFile.bind(host), originalExists = host.fileExists.bind(host);
    host.fileExists = (path) => path === filename || originalExists(path);
    host.getSourceFile = (path, languageVersion, ...rest) => path === filename ? ts.createSourceFile(path, code, languageVersion, true) : originalSource(path, languageVersion, ...rest);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    expect(diagnostics.map(item => item.file?.fileName + ':' + item.start + ' ' + ts.flattenDiagnosticMessageText(item.messageText, '\n'))).toEqual([]);
  });

  it('does not accept result messages before the owned child closes successfully', async () => {
    const h = childHarness();
    h.child.emit('message', { type: 'ready', pid: 71 });
    await expect(h.peer.ready).resolves.toMatchObject({ pid: 71 });
    h.peer.start(); expect(h.child.send).toHaveBeenCalledWith({ type: 'start' });
    h.child.emit('message', { type: 'result', outcomes: [] });
    let settled = false;
    const pending = h.peer.result.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    h.child.emit('close', 0);
    await pending;
    await h.peer.stop();
    expect(h.child.kill).not.toHaveBeenCalled();
  });

  it('rejects evidence that never completed controlled startup', async () => {
    const h = childHarness();
    h.child.emit('message', { type: 'result', outcomes: [] });
    h.child.emit('close', 0);
    await expect(h.peer.ready).rejects.toThrow('without successful evidence');
    await expect(h.peer.result).rejects.toThrow('without successful evidence');
    await h.peer.stop();
  });

  it('bounds owned child startup/execution and escalates only that child', async () => {
    vi.useFakeTimers();
    const h = childHarness();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.child.kill).toHaveBeenCalledWith('SIGKILL');
    h.child.emit('close', null);
    await expect(h.peer.ready).rejects.toThrow('exceeded 15s');
    await expect(h.peer.result).rejects.toThrow('exceeded 15s');
    await h.peer.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains bounded diagnostics without forwarding child exception messages or stderr', async () => {
    const h = childHarness();
    h.child.stderr.emit('data', Buffer.from('redis://private-secret@fixture.invalid'));
    h.child.emit('message', { type: 'failure', diagnostic: { stage: 'redis-connect', name: 'Error', code: 'ECONNREFUSED', status: 503, message: 'private-secret' } });
    h.child.emit('close', 1);
    await expect(h.peer.ready).rejects.toThrow('redis-connect Error code=ECONNREFUSED status=503');
    await expect(h.peer.result).rejects.not.toThrow('private-secret');
    await h.peer.stop();
  });
});
