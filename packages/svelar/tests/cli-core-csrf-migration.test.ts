import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { applyCoreScaffoldMigration, planCoreScaffoldMigrationFromSource } from '../src/cli/CoreScaffoldMigration.js';
import { UpdateCommand } from '../src/cli/commands/UpdateCommand.js';

const path = 'src/hooks.server.ts';
let root: string;
function write(source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}
function read(): string { return readFileSync(join(root, path), 'utf8'); }
function hooks(options: string, factory = 'createSvelarApp', imported = `import { ${factory} } from '@beeblock/svelar/hooks';`): string {
  return `${imported}\nimport { auth } from './app.js';\n\n// app-owned comment remains\nexport const { handle, handleError } = ${factory}({\n  auth,\n  secret: process.env.APP_KEY,\n  ${options}\n});\nexport const customMarker = '/api/internal/ example';\n`;
}
function plan() { return planCoreScaffoldMigrationFromSource(root, ts); }
function noBackups(): void { expect(readdirSync(join(root, 'src'))).toEqual(['hooks.server.ts']); }

beforeEach(() => {
  root = mkdtempSync(fileURLToPath(new URL('../.test-core-csrf-', import.meta.url)));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

describe('Recognized legacy CSRF token migration', () => {
  it('migrates the hash-verified published 0.7.9 hooks template and preserves the upgrade marker', () => {
    const published = `/**
 * SvelteKit Server Hooks \u2014 Svelar middleware pipeline
 */

import { createSvelarApp } from '@beeblock/svelar/hooks';
import { DatabaseSessionStore } from '@beeblock/svelar/session';

// Import app.ts to trigger database + hashing + auth configuration
import { auth } from './app.js';

export const { handle, handleError } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY,
  sessionStore: new DatabaseSessionStore(),
  rateLimitStore: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' : 'memory',
  rateLimitCacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
  authThrottleStore: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' : 'memory',
  authThrottleCacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
  csrfExcludePaths: ['/api/webhooks', '/api/internal/'],
});
`;
    expect(createHash('sha256').update(published).digest('hex')).toBe('74212577d6ce4fcbe1f280247aeecb8421a987265f8a0e01b87d7a24f1ca303c');
    const original = published + '\n// upgrade customization\n'; write(original);
    const migration = plan();
    expect(migration.errors).toEqual([]); expect(migration.edits).toHaveLength(1);
    applyCoreScaffoldMigration(migration, { confirmed: true });
    expect(read()).toBe(original.replace("['/api/webhooks', '/api/internal/']", "['/api/webhooks/incoming/'],\n  csrfExcludeExactPaths: ['/api/internal/broadcast']"));
    expect(readFileSync(join(root, path + '.core.bak'), 'utf8')).toBe(original);
    expect(plan().errors).toEqual([]); expect(plan().edits).toEqual([]);
  });

  it.each(['/api/webhooks', '/api/webhooks/', '/api/webhooks/incoming/'])('narrows %s plus broad internal prefix with exact backup and idempotence', (prefix) => {
    const source = hooks(`csrfExcludePaths: ['${prefix}', '/api/internal/'],`);
    write(source);
    const expected = source.replace(`['${prefix}', '/api/internal/']`, "['/api/webhooks/incoming/'],\n  csrfExcludeExactPaths: ['/api/internal/broadcast']");
    const migration = plan();
    expect(migration.errors).toEqual([]);
    expect(migration.edits).toHaveLength(1);
    expect(migration.edits[0].tokens.map((token) => token.rule)).toEqual(['csrf-exclusions', 'csrf-exclusions']);
    expect(read()).toBe(source); noBackups();
    expect(applyCoreScaffoldMigration(migration, { confirmed: true })).toEqual([path + '.core.bak']);
    expect(read()).toBe(expected);
    expect(readFileSync(join(root, path + '.core.bak'), 'utf8')).toBe(source);
    expect(plan().errors).toEqual([]); expect(plan().edits).toEqual([]);
  });

  it('proves a direct import alias and preserves BOM, CRLF, quotes, indentation and comments outside edit ranges', () => {
    const source = '\uFEFF' + hooks('csrfExcludePaths: ["/api/webhooks/", "/api/internal/"], // retained suffix', 'makeApp',
      "import { createSvelarApp as makeApp } from '@beeblock/svelar/hooks';").replace(/\n/g, '\r\n');
    write(source); chmodSync(join(root, path), 0o640);
    const migration = plan();
    expect(migration.errors).toEqual([]);
    applyCoreScaffoldMigration(migration, { confirmed: true });
    expect(read()).toBe(source.replace('["/api/webhooks/", "/api/internal/"]', '["/api/webhooks/incoming/"],\r\n  csrfExcludeExactPaths: ["/api/internal/broadcast"]'));
    expect(lstatSync(join(root, path)).mode & 0o777).toBe(0o640);
    expect(readFileSync(join(root, path + '.core.bak'))).toEqual(Buffer.from(source));
    expect(plan().edits).toEqual([]);
  });

  it.each(['', ',', ',\n  sessionLifetime: 900,'])('adds a valid exact option with any recognized trailing-comma layout (%s)', (suffix) => {
    write(hooks("csrfExcludePaths: ['/api/webhooks/', '/api/internal/']" + suffix));
    const migration = plan();
    expect(migration.errors).toEqual([]);
    applyCoreScaffoldMigration(migration, { confirmed: true });
    const parsed = ts.createSourceFile(path, read(), ts.ScriptTarget.Latest, true);
    const host = ts.createCompilerHost({ noLib: true, noResolve: true });
    host.getSourceFile = (name) => name === path ? parsed : undefined;
    expect(ts.createProgram([path], { noLib: true, noResolve: true }, host).getSyntacticDiagnostics(parsed)).toEqual([]);
    expect(read()).toContain("csrfExcludeExactPaths: ['/api/internal/broadcast']");
  });

  it('requires confirmation and rejects snapshots changed after review before writing/backing up', () => {
    write(hooks("csrfExcludePaths: ['/api/webhooks/', '/api/internal/'],"));
    const migration = plan();
    expect(() => applyCoreScaffoldMigration(migration, { confirmed: false })).toThrow('explicit confirmation'); noBackups();
    write(read() + '// concurrent app-owned edit\n');
    expect(() => applyCoreScaffoldMigration(migration, { confirmed: true })).toThrow('changed after planning'); noBackups();
  });

  it('retains previous exact backups and creates a distinct backup for the reviewed source', () => {
    const source = hooks("csrfExcludePaths: ['/api/webhooks/', '/api/internal/'],"); write(source);
    writeFileSync(join(root, path + '.core.bak'), 'previous backup');
    expect(applyCoreScaffoldMigration(plan(), { confirmed: true })).toEqual([path + '.core.bak.1']);
    expect(readFileSync(join(root, path + '.core.bak'), 'utf8')).toBe('previous backup');
    expect(readFileSync(join(root, path + '.core.bak.1'), 'utf8')).toBe(source);
  });
});

describe('Fail-closed app-owned CSRF configurations', () => {
  const options = [
    "csrfExcludePaths: ['/api/webhooks', '/api/internal/', '/custom/'],",
    "csrfExcludePaths: ['/api/webhooks', '/api/internal'],",
    "csrfExcludePaths: ['/api/webhooks-custom', '/api/internal/'],",
    "csrfExcludePaths: ['/api/webhooks', '/api/internal/'], csrfExcludeExactPaths: ['/custom'],",
    "csrfExcludePaths: ['/api/webhooks', '/api/internal/'], ...customOptions,",
    "csrfExcludePaths: ['/api/webhooks/', '/api/internal/', '/custom/'],",
    "csrfExcludePaths: ['/api/internal/', '/api/webhooks/'],",
    "csrfExcludePaths: ['/custom/', '/api/internal/'],",
    "csrfExcludePaths: ['/api/webhooks/incoming/'],",
    "csrfExcludePaths: exclusions,",
    "csrfExcludePaths,",
    "csrfExcludePaths: ['/api/webhooks/', ...exclusions],",
    "csrfExcludePaths: ['/api/webhooks/', /* app-owned reason */ '/api/internal/'],",
    "csrfExcludePaths: ['/api/webhooks/', '/api/internal/'], csrfExcludeExactPaths: ['/app-owned'],",
    "csrfExcludePaths: ['/api/webhooks/', '/api/internal/'], csrfExcludeExactPaths: ['/api/internal/broadcast'],",
    "csrfExcludePaths: ['/api/webhooks/', '/api/internal/'], ...customOptions,",
    "...customOptions, csrfExcludePaths: ['/api/webhooks/', '/api/internal/'],",
    "['csrfExcludePaths']: ['/api/webhooks/', '/api/internal/'],",
    "csrfExcludePaths: ['/api/webhooks/', '/api/internal/'], [optionName]: value,",
    "csrfExcludePaths: ['/api/webhooks/', '/api/internal/'], csrfExcludePaths: ['/custom/'],",
    "csrfExcludePaths: ['/api/webhooks/', '/api/internal/'], get csrfExcludeExactPaths() { return []; },",
  ];
  it.each(options)('requires manual review without source/backup writes: %s', (configuration) => {
    const source = hooks(configuration); write(source);
    const migration = plan();
    expect(migration.errors.join('\n')).toContain('manual'); expect(migration.edits).toEqual([]);
    expect(() => applyCoreScaffoldMigration(migration, { confirmed: true })).toThrow('preflight failed');
    expect(read()).toBe(source); noBackups();
  });

  it.each([
    (source: string) => source.replace('@beeblock/svelar/hooks', './custom-hooks.js'),
    (source: string) => source.replace('import { createSvelarApp }', 'import type { createSvelarApp }'),
    (source: string) => source.replace('export const { handle, handleError } = createSvelarApp', 'const app = createSvelarApp'),
    (source: string) => source.replace('export const { handle, handleError } =', 'export const { handle: customHandle, handleError } ='),
    (source: string) => source.replace('createSvelarApp({', 'wrapper(createSvelarApp({').replace('});', '}));'),
    (source: string) => source + '\nfunction custom(createSvelarApp) { return createSvelarApp({}); }\n',
    (source: string) => source + '\nconst alias = createSvelarApp;\n',
    (source: string) => source + '\nconst extra = createSvelarApp({});\n',
    (source: string) => source.replace('createSvelarApp({', 'createSvelarApp(...[{').replace('});', '}]);'),
    (source: string) => source.replace('createSvelarApp({', 'createSvelarApp({').replace('});', '}, extra);'),
  ])('rejects custom or shadowed callers (%#)', (customize) => {
    const source = customize(hooks("csrfExcludePaths: ['/api/webhooks/', '/api/internal/'],")); write(source);
    const migration = plan();
    expect(migration.errors.length).toBe(1); expect(migration.edits).toEqual([]);
    expect(read()).toBe(source); noBackups();
  });

  it('leaves hooks without explicit CSRF exclusions untouched', () => {
    const source = hooks('sessionLifetime: 900,'); write(source);
    expect(plan().errors).toEqual([]); expect(plan().edits).toEqual([]); expect(read()).toBe(source);
  });
});

describe('UpdateCommand explicit CSRF migration', () => {
  it.each(['dry-run', 'list'])('previews csrf-exclusions with --%s without writes even with --force', async (flag) => {
    const source = hooks("csrfExcludePaths: ['/api/webhooks/', '/api/internal/'],"); write(source);
    const command = new UpdateCommand(); await command.handle([], { 'migrate-core': true, [flag]: true, force: true });
    expect(command.exitCode).toBe(0); expect(read()).toBe(source); noBackups();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('csrf-exclusions');
  });

  it('force applies only reviewed tokens, backs up original hooks and preserves unrelated app bytes', async () => {
    const source = hooks("csrfExcludePaths: ['/api/webhooks/', '/api/internal/'],"); write(source);
    writeFileSync(join(root, '.env'), 'APP_KEY=app-owned-secret\r\n');
    const command = new UpdateCommand(); await command.handle([], { 'migrate-core': true, force: true });
    expect(command.exitCode).toBe(0); expect(readFileSync(join(root, path + '.core.bak'), 'utf8')).toBe(source);
    expect(read()).toContain("csrfExcludeExactPaths: ['/api/internal/broadcast']");
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('APP_KEY=app-owned-secret\r\n');
    expect(existsSync(join(root, 'src/app.ts'))).toBe(false);
    const again = new UpdateCommand(); await again.handle([], { 'migrate-core': true, force: true });
    expect(again.exitCode).toBe(0); expect(existsSync(join(root, path + '.core.bak.1'))).toBe(false);
  });

  it('force cannot authorize replacing custom exact options', async () => {
    const source = hooks("csrfExcludePaths: ['/api/webhooks/', '/api/internal/'], csrfExcludeExactPaths: ['/custom'],"); write(source);
    const command = new UpdateCommand(); await command.handle([], { 'migrate-core': true, force: true });
    expect(command.exitCode).toBe(1); expect(read()).toBe(source); noBackups();
  });
});
