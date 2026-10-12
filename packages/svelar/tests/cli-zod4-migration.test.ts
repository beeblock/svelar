import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { applyZod4Migration, planZod4Migration } from '../src/cli/Zod4Migration.js';
import { UpdateCommand } from '../src/cli/commands/UpdateCommand.js';

const confirmation = vi.hoisted(() => ({ answer: 'yes' }));
vi.mock('node:readline', () => ({
  createInterface: () => ({
    question: (_question: string, callback: (answer: string) => void) => callback(confirmation.answer),
    close: () => {},
  }),
}));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, renameSync: vi.fn(original.renameSync) };
});
const originalRename = (await vi.importActual<typeof import('node:fs')>('node:fs')).renameSync;

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const adapterImport = "import { zod, zodClient as client, valibot } from 'sveltekit-superforms/adapters';\n";
const migratedImport = "import { zod4 as zod, zod4Client as client, valibot } from 'sveltekit-superforms/adapters';\n";
let root: string;
let cwd: string;

function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function read(path: string): string { return readFileSync(join(root, path), 'utf8'); }

async function withTTY(value: boolean, callback: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
  try { await callback(); }
  finally {
    if (original) Object.defineProperty(process.stdin, 'isTTY', original);
    else Reflect.deleteProperty(process.stdin, 'isTTY');
  }
}

function files(directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function packageJson(dependencies: Record<string, string> = {}): string {
  return JSON.stringify({
    name: 'custom-old-app', version: '0.7.9', private: true, type: 'module',
    scripts: { check: 'svelte-check', custom: 'echo original-source-preservation-marker' },
    dependencies: { '@beeblock/svelar': '^0.7.9', zod: '^3.23.0', 'sveltekit-superforms': '^2.27.0', ...dependencies },
  }, null, 2) + '\n';
}

beforeEach(() => {
  cwd = process.cwd();
  root = mkdtempSync(join(packageRoot, '.test-zod4-'));
  write('package.json', packageJson());
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

describe('Zod 4 migration planning', () => {
  it.each(['src/lib/schemas/custom.ts', 'src/lib/modules/invoices/contracts/schemas/custom.ts'])(
    'preserves flat/DDD custom source bytes except adapter import tokens: %s', async (path) => {
      const source = '\uFEFF' + [
        '// custom marker: import { zod } from "sveltekit-superforms/adapters";',
        'const example = "zodClient and zod are not rewritten";',
        "import { zod, /* keep comment */ zodClient as formAdapter, valibot } from 'sveltekit-superforms/adapters';",
        "import { zod as unrelated } from './custom-adapter.js';",
        "import { z } from '@beeblock/svelar/validation';",
        'export const schema = z.object({ enabled: z.boolean() });',
        'export const adapter = zod(schema);',
        'export const custom = { example, unrelated, formAdapter, valibot };',
        '',
      ].join('\r\n');
      write(path, source);
      const plan = await planZod4Migration(root);
      expect(plan.errors).toEqual([]);
      expect(plan.edits.map((edit) => edit.path)).toEqual(['package.json', path]);
      expect(read(path)).toBe(source);
      expect(files().some((path) => path.includes('.zod4.bak'))).toBe(false);
      applyZod4Migration(plan, { confirmed: true });
      expect(read(path)).toBe(source.replace(
        'import { zod, /* keep comment */ zodClient as formAdapter, valibot }',
        'import { zod4 as zod, /* keep comment */ zod4Client as formAdapter, valibot }',
      ));
      expect(readFileSync(join(root, `${path}.zod4.bak`))).toEqual(Buffer.from(source));
    },
  );

  it('preserves explicit aliases, type imports, quoted names and existing Zod 4/Valibot imports', async () => {
    const source = [
      "import { zod as serverAdapter, zodClient } from 'sveltekit-superforms/adapters';",
      'import type { zod as AdapterType } from "sveltekit-superforms/adapters";',
      "import { 'zodClient' as quoted } from 'sveltekit-superforms/adapters';",
      "import { zod4 as current, valibot, valibotClient } from 'sveltekit-superforms/adapters';",
    ].join('\n');
    write('src/contracts.ts', source);
    const plan = await planZod4Migration(root);
    expect(plan.errors).toEqual([]);
    applyZod4Migration(plan, { confirmed: true });
    expect(read('src/contracts.ts')).toBe([
      "import { zod4 as serverAdapter, zod4Client as zodClient } from 'sveltekit-superforms/adapters';",
      'import type { zod4 as AdapterType } from "sveltekit-superforms/adapters";',
      "import { 'zod4Client' as quoted } from 'sveltekit-superforms/adapters';",
      "import { zod4 as current, valibot, valibotClient } from 'sveltekit-superforms/adapters';",
    ].join('\n'));
  });

  it('uses Svelte compiler module/instance script spans without touching markup, styles or examples', async () => {
    const source = [
      '<!-- custom import { zod } from "sveltekit-superforms/adapters" -->',
      '<script module lang="ts">',
      "  import { zod as serverAdapter } from 'sveltekit-superforms/adapters';",
      '  export const custom = "zodClient";',
      '</script>',
      '<script lang="ts">',
      "  import { zodClient } from 'sveltekit-superforms/adapters';",
      '  let count = $state(0);',
      '</script>',
      '<button onclick={() => count++}>{custom}: {count}</button>',
      '<p>zodClient from sveltekit-superforms/adapters</p>',
      '<style>p { color: red; }</style>',
      '',
    ].join('\r\n');
    write('src/routes/+page.svelte', source);
    const plan = await planZod4Migration(root);
    expect(plan.errors).toEqual([]);
    applyZod4Migration(plan, { confirmed: true });
    expect(read('src/routes/+page.svelte')).toBe(source
      .replace('import { zod as serverAdapter }', 'import { zod4 as serverAdapter }')
      .replace('import { zodClient }', 'import { zod4Client as zodClient }'));
    expect(read('src/routes/+page.svelte.zod4.bak')).toBe(source);
  });

  it.each(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'])('handles .%s source syntax', async (extension) => {
    const source = adapterImport + (extension.endsWith('x') ? 'export const view = <div />;\n' : 'export const value = 1;\n');
    write(`src/custom.${extension}`, source);
    const plan = await planZod4Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.find((edit) => edit.path === `src/custom.${extension}`)?.updated.toString()).toBe(
      source.replace(adapterImport, migratedImport),
    );
  });

  it('leaves Valibot projects entirely unchanged, including root Zod dependency', async () => {
    write('svelar.validation.json', '{"validation":"valibot"}');
    write('src/custom.ts', adapterImport);
    const before = read('package.json');
    const plan = await planZod4Migration(root);
    expect(plan.skipped).toContain('Valibot');
    expect(plan.edits).toEqual([]);
    expect(applyZod4Migration(plan, { confirmed: true })).toEqual([]);
    expect(read('package.json')).toBe(before);
    expect(read('src/custom.ts')).toBe(adapterImport);
  });

  it('updates only selected existing dependency tokens, preserving scripts and unrelated metadata', async () => {
    const original = '\uFEFF' + packageJson({
      'shadcn-svelte': '^1.0.0', 'zod-v3-to-json-schema': '^3.25.0',
      'zod-to-json-schema': '^3.24.0', customized: 'file:../customized',
    }).replace(/\n/g, '\r\n');
    write('package.json', original);
    const plan = await planZod4Migration(root);
    expect(plan.errors).toEqual([]);
    applyZod4Migration(plan, { confirmed: true });
    expect(read('package.json')).toBe(original
      .replace('"zod": "^3.23.0"', '"zod": "^4.6.7"')
      .replace('"sveltekit-superforms": "^2.27.0"', '"sveltekit-superforms": "^2.31.0"')
      .replace('"shadcn-svelte": "^1.0.0"', '"shadcn-svelte": "^1.7.0"')
      .replace('"zod-v3-to-json-schema": "^3.25.0"', '"zod-v3-to-json-schema": "^4.0.0"'));
    expect(readFileSync(join(root, 'package.json.zod4.bak'))).toEqual(Buffer.from(original));
  });

  it('retains newer selected dependencies and warns about manual semantic/toolchain migration', async () => {
    write('package.json', packageJson({ zod: '^4.7.0', 'sveltekit-superforms': '^2.32.0' }));
    write('src/schema.ts', "import { z } from 'zod';\nimport { zodToJsonSchema } from 'zod-to-json-schema';\nexport const custom = z.string();\n");
    const plan = await planZod4Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits).toEqual([]);
    expect(plan.warnings.join('\n')).toContain('semantic changes manually');
    expect(plan.warnings.join('\n')).toContain('zod-to-json-schema may require Zod 3');
  });
});

describe('migration safety', () => {
  it.each([
    "import * as adapters from 'sveltekit-superforms/adapters';",
    "import adapters from 'sveltekit-superforms/adapters';",
    "const adapters = import('sveltekit-superforms/adapters');",
    'const adapters = import(`sveltekit-superforms/adapters`);',
    "const adapters = require('sveltekit-superforms/adapters');",
    "import adapters = require('sveltekit-superforms/adapters');",
    "export * from 'sveltekit-superforms/adapters';",
    "export { zod as custom } from 'sveltekit-superforms/adapters';",
    "type Adapters = typeof import('sveltekit-superforms/adapters');",
    "const name = 'sveltekit-superforms/adapters'; const adapters = import(name);",
    "const adapters = import('sveltekit-superforms/' + 'adapters');",
    "import { z } from 'zod/v3';",
  ])('rejects unsafe patterns before all source/package writes: %s', async (unsafe) => {
    write('src/safe.ts', adapterImport);
    write('src/unsafe.ts', unsafe);
    const originalPackage = read('package.json');
    const plan = await planZod4Migration(root);
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.errors.join('\n')).toContain('src/unsafe.ts');
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('preflight failed');
    expect(read('package.json')).toBe(originalPackage);
    expect(read('src/safe.ts')).toBe(adapterImport);
    expect(read('src/unsafe.ts')).toBe(unsafe);
    expect(files().some((path) => path.includes('.zod4.bak'))).toBe(false);
  });

  it('rejects unsafe adapter patterns within a Svelte script before writes', async () => {
    write('src/routes/+page.svelte', '<script>const name = "sveltekit-superforms/adapters"; const adapter = import(name);</script><p>custom</p>');
    const plan = await planZod4Migration(root);
    expect(plan.errors.join('\n')).toContain('Nonliteral module loading');
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('preflight failed');
  });

  it.each(['file:../zod', 'workspace:*', 'npm:zod@3.25.0', '>=3 <5'])('rejects custom Zod spec %s', async (zod) => {
    write('package.json', packageJson({ zod }));
    const plan = await planZod4Migration(root);
    expect(plan.errors.join('\n')).toContain('unsupported version');
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('preflight failed');
  });

  it.each([
    '{"dependencies":{"zod":"^3.23.0","zod":"^4.6.7"}}',
    '{"dependencies":{"zod":"^3.23.0"},"overrides":{"zod":"^3.23.0"}}',
    '{"dependencies":{"zod":"^3.23.0"},"resolutions":{"zod":"^3.23.0"}}',
    '{"dependencies":{"zod":"^3.23.0"},"pnpm":{"overrides":{"zod":"^3.23.0"}}}',
    '{"dependencies":{}}',
    '{broken-json',
  ])('blocks invalid/ambiguous dependency manifests: %s', async (content) => {
    write('package.json', content);
    const plan = await planZod4Migration(root);
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('preflight failed');
    expect(read('package.json')).toBe(content);
  });

  it('refuses invalid validation config instead of guessing the provider', async () => {
    write('svelar.validation.json', '{"validation":"custom"}');
    const plan = await planZod4Migration(root);
    expect(plan.errors.join('\n')).toContain('expected validation');
    expect(plan.edits).toEqual([]);
  });

  it('requires explicit authorization even for a valid plan', async () => {
    const plan = await planZod4Migration(root);
    expect(() => applyZod4Migration(plan, { confirmed: false })).toThrow('requires --force');
    expect(existsSync(join(root, 'package.json.zod4.bak'))).toBe(false);
  });

  it('detects stale source before creating any backup or applying the package edit', async () => {
    write('src/custom.ts', adapterImport);
    const plan = await planZod4Migration(root);
    write('src/custom.ts', adapterImport + '// concurrent customization\n');
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('changed after planning');
    expect(read('package.json')).toBe(packageJson());
    expect(files().some((path) => path.includes('.zod4.bak'))).toBe(false);
  });

  it('retains an existing backup, creates exact numbered backups and is idempotent', async () => {
    write('src/custom.ts', adapterImport);
    write('src/custom.ts.zod4.bak', 'existing backup');
    chmodSync(join(root, 'src/custom.ts'), 0o640);
    const plan = await planZod4Migration(root);
    const backups = applyZod4Migration(plan, { confirmed: true });
    expect(backups).toContain('src/custom.ts.zod4.bak.1');
    expect(read('src/custom.ts.zod4.bak')).toBe('existing backup');
    expect(read('src/custom.ts.zod4.bak.1')).toBe(adapterImport);
    expect(lstatSync(join(root, 'src/custom.ts')).mode & 0o777).toBe(0o640);
    const next = await planZod4Migration(root);
    expect(next.errors).toEqual([]);
    expect(next.edits).toEqual([]);
    expect(applyZod4Migration(next, { confirmed: true })).toEqual([]);
  });

  it('rolls back already edited files after an I/O failure while retaining exact-original backups', async () => {
    write('src/custom.ts', adapterImport);
    const plan = await planZod4Migration(root);
    vi.mocked(renameSync).mockImplementationOnce(originalRename).mockImplementationOnce(() => {
      throw new Error('injected source rename failure');
    });
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('injected source rename failure');
    expect(read('package.json')).toBe(packageJson());
    expect(read('src/custom.ts')).toBe(adapterImport);
    expect(read('package.json.zod4.bak')).toBe(packageJson());
    expect(read('src/custom.ts.zod4.bak')).toBe(adapterImport);
    expect(files().some((path) => path.endsWith('.tmp'))).toBe(false);
  });

  it('never overwrites concurrent user edits during rollback and reports manual backup recovery', async () => {
    write('src/custom.ts', adapterImport);
    const plan = await planZod4Migration(root);
    vi.mocked(renameSync).mockImplementationOnce(originalRename).mockImplementationOnce(() => {
      write('package.json', 'concurrent user customization');
      throw new Error('injected source rename failure');
    });
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('Rollback needs review');
    expect(read('package.json')).toBe('concurrent user customization');
    expect(read('package.json.zod4.bak')).toBe(packageJson());
    expect(read('src/custom.ts')).toBe(adapterImport);
  });

  it('refuses source symlinks and never writes their targets', async () => {
    write('src/custom.ts', adapterImport);
    symlinkSync(join(root, 'src/custom.ts'), join(root, 'src/linked.ts'));
    const plan = await planZod4Migration(root);
    expect(plan.errors.join('\n')).toContain('symlink encountered');
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('preflight failed');
    expect(read('src/custom.ts')).toBe(adapterImport);
  });

  it('detects a source symlink introduced after planning', async () => {
    write('src/custom.ts', adapterImport);
    const plan = await planZod4Migration(root);
    rmSync(join(root, 'src/custom.ts'));
    symlinkSync(join(root, 'package.json'), join(root, 'src/custom.ts'));
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('Symlink changed');
    expect(existsSync(join(root, 'package.json.zod4.bak'))).toBe(false);
  });

  it('reports missing project TypeScript prerequisite with an install command', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'svelar-zod4-no-compiler-'));
    try {
      writeFileSync(join(isolated, 'package.json'), packageJson());
      const plan = await planZod4Migration(isolated);
      expect(plan.errors.join('\n')).toContain('npm install -D typescript');
      expect(plan.edits).toEqual([]);
    } finally { rmSync(isolated, { recursive: true, force: true }); }
  });

  it('reports missing Svelte compiler before changing a project with Svelte imports', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'svelar-zod4-no-svelte-'));
    try {
      const require = createRequire(import.meta.url);
      writeFileSync(join(isolated, 'package.json'), packageJson());
      mkdirSync(join(isolated, 'node_modules'));
      symlinkSync(dirname(require.resolve('typescript/package.json')), join(isolated, 'node_modules/typescript'));
      writeFileSync(join(isolated, 'Custom.svelte'), `<script>${adapterImport}</script><p>custom</p>`);
      const plan = await planZod4Migration(isolated);
      expect(plan.errors.join('\n')).toContain('npm install -D svelte');
      expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('preflight failed');
      expect(readFileSync(join(isolated, 'package.json'), 'utf8')).toBe(packageJson());
    } finally { rmSync(isolated, { recursive: true, force: true }); }
  });

  it.each([
    ['src/broken.ts', 'export const = ;'],
    ['src/Broken.svelte', '<script>const missing = </script><p>broken'],
  ])('blocks invalid syntax before writes: %s', async (path, content) => {
    write(path, content);
    const plan = await planZod4Migration(root);
    expect(plan.errors.join('\n')).toContain(path);
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('preflight failed');
    expect(read('package.json')).toBe(packageJson());
  });

  it('blocks invalid UTF-8 source rather than replacing original bytes', async () => {
    write('src/broken.ts', Buffer.from([0xff, 0xfe, 0x00]));
    const plan = await planZod4Migration(root);
    expect(plan.errors.join('\n')).toContain('not valid UTF-8');
    expect(() => applyZod4Migration(plan, { confirmed: true })).toThrow('preflight failed');
  });

  it('ignores installed/generated directories while preserving user scripts and runtime files', async () => {
    write('node_modules/unsafe.ts', "import * as adapters from 'sveltekit-superforms/adapters';");
    write('.svelte-kit/unsafe.ts', "const adapter = import('sveltekit-superforms/adapters');");
    write('src/lib/controllers/CustomController.ts', '// custom controller marker\nexport class CustomController {}\n');
    write('scripts/custom.mjs', '// custom script marker\nexport const custom = true;\n');
    const plan = await planZod4Migration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.map((edit) => edit.path)).toEqual(['package.json']);
  });
});

describe('UpdateCommand migration opt-in', () => {
  it('exposes the opt-in flag and leaves normal update dry-run behavior unchanged', async () => {
    write('src/custom.ts', adapterImport);
    process.chdir(root);
    const command = new UpdateCommand();
    expect(command.flags.find((flag) => flag.name === 'migrate-zod4')?.default).toBe(false);
    await command.handle([], { 'dry-run': true });
    expect(read('src/custom.ts')).toBe(adapterImport);
    expect(read('package.json')).toBe(packageJson());
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).not.toContain('Zod 4 migration preflight');
  });

  it.each(['dry-run', 'list'])('migration --%s lists edits without writes or backups', async (flag) => {
    write('src/custom.ts', adapterImport);
    process.chdir(root);
    const command = new UpdateCommand();
    await command.handle([], { 'migrate-zod4': true, [flag]: true, force: true });
    expect(command.exitCode).toBe(0);
    expect(read('src/custom.ts')).toBe(adapterImport);
    expect(read('package.json')).toBe(packageJson());
    expect(files().some((path) => path.includes('.zod4.bak'))).toBe(false);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('src/custom.ts');
    expect(output).toContain('no files or backups written');
  });

  it('force applies only migration edits, never ordinary templates or scaffolds', async () => {
    write('src/custom.ts', adapterImport);
    write('src/app.ts', '// original-source-preservation-marker\nexport const custom = true;\n');
    process.chdir(root);
    const command = new UpdateCommand();
    await command.handle([], { 'migrate-zod4': true, force: true, 'include-user-files': true });
    expect(command.exitCode).toBe(0);
    expect(read('src/custom.ts')).toBe(migratedImport);
    expect(read('src/app.ts')).toContain('original-source-preservation-marker');
    expect(existsSync(join(root, 'src/app.d.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/hooks.server.ts'))).toBe(false);
    expect(read('package.json')).toContain('^4.6.7');
    expect(read('package.json')).toContain('^0.7.9');
  });

  it('noninteractive apply without force refuses and produces an actionable approval message', async () => {
    process.chdir(root);
    const command = new UpdateCommand();
    await withTTY(false, () => command.handle([], { 'migrate-zod4': true }));
    expect(command.exitCode).toBe(1);
    expect(read('package.json')).toBe(packageJson());
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain('--migrate-zod4 --force');
  });

  it.each(['yes', 'y', ' YES '])('accepts explicit interactive confirmation %s', async (answer) => {
    confirmation.answer = answer;
    write('src/custom.ts', adapterImport);
    process.chdir(root);
    const command = new UpdateCommand();
    await withTTY(true, () => command.handle([], { 'migrate-zod4': true }));
    expect(command.exitCode).toBe(0);
    expect(read('src/custom.ts')).toBe(migratedImport);
    expect(read('src/custom.ts.zod4.bak')).toBe(adapterImport);
  });

  it.each(['', 'no', 'not-approved'])('interactive response %s cancels without writes', async (answer) => {
    confirmation.answer = answer;
    process.chdir(root);
    const command = new UpdateCommand();
    await withTTY(true, () => command.handle([], { 'migrate-zod4': true }));
    expect(command.exitCode).toBe(0);
    expect(read('package.json')).toBe(packageJson());
    expect(existsSync(join(root, 'package.json.zod4.bak'))).toBe(false);
  });

  it('force cannot bypass unsafe preflight and dry-run reports blockers', async () => {
    write('src/custom.ts', "import * as adapters from 'sveltekit-superforms/adapters';");
    process.chdir(root);
    const command = new UpdateCommand();
    await command.handle([], { 'migrate-zod4': true, force: true, 'dry-run': true });
    expect(command.exitCode).toBe(1);
    expect(read('package.json')).toBe(packageJson());
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain('Migration blocked before writes');
  });
});
