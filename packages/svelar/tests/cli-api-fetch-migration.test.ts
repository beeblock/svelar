import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyApiFetchMigration, planApiFetchMigration } from '../src/cli/ApiFetchMigration';
import { UpdateCommand } from '../src/cli/commands/UpdateCommand';
import { Cli } from '../src/cli/CLI';

const approval = vi.hoisted(() => ({ answer: 'yes' }));
vi.mock('node:readline', () => ({ createInterface: () => ({ question: (_prompt: string, callback: (answer: string) => void) => callback(approval.answer), close: () => {} }) }));
vi.mock('node:fs', async (original) => { const fs = await original<typeof import('node:fs')>(); return { ...fs, renameSync: vi.fn(fs.renameSync) }; });
const originalRename = (await vi.importActual<typeof import('node:fs')>('node:fs')).renameSync;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
let root: string;
let cwd: string;
const write = (path: string, content: string | Buffer) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const component = (expression: string, preamble = '') => `<script lang="ts">\n${preamble}\nasync function save() { return ${expression}; }\n</script>\n<button onclick={save}>Save</button>\n`;
const mutation = "fetch('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'post' }) })";

beforeEach(() => {
  cwd = process.cwd();
  root = mkdtempSync(join(packageRoot, '.test-cli-api-fetch-'));
  write('package.json', '{"type":"module","name":"custom-app"}\n');
  vi.mocked(renameSync).mockReset().mockImplementation(originalRename);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  approval.answer = 'yes';
});
afterEach(() => { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

function files(dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const path = join(dir, entry.name); return entry.isDirectory() ? files(path) : [path]; });
}
async function withTTY(value: boolean, action: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
  try { await action(); } finally { if (original) Object.defineProperty(process.stdin, 'isTTY', original); else Reflect.deleteProperty(process.stdin, 'isTTY'); }
}

describe('apiFetch AST migration', () => {
  it('plans exact token edits, retains comments/CRLF/BOM/mode, backs up exact bytes and is idempotent', async () => {
    const source = '\uFEFF' + component(mutation, "// keep: fetch('/api/posts')\nconst example = 'fetch and apiFetch stay unchanged';").replaceAll('\n', '\r\n');
    write('src/lib/Form.svelte', source);
    chmodSync(join(root, 'src/lib/Form.svelte'), 0o640);
    const plan = await planApiFetchMigration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits).toHaveLength(1);
    expect(read('src/lib/Form.svelte')).toBe(source);
    expect(files().some((path) => path.includes('.bak'))).toBe(false);
    const updated = plan.edits[0].updated.toString('utf8');
    expect(updated).toContain("return apiFetch('/api/posts', { showToast: false, method: 'POST', headers: { Accept: '*/*', 'Content-Type': 'application/json' }");
    expect(updated).toContain("// keep: fetch('/api/posts')\r\n");
    expect(updated).toContain("const example = 'fetch and apiFetch stay unchanged';");
    expect(updated.startsWith('\uFEFF')).toBe(true);
    expect(updated.replaceAll('\r\n', '').includes('\n')).toBe(false);
    const backups = applyApiFetchMigration(plan, { confirmed: true });
    expect(backups).toEqual(['src/lib/Form.svelte.api-fetch.bak']);
    expect(readFileSync(join(root, backups[0]))).toEqual(Buffer.from(source));
    expect(lstatSync(join(root, 'src/lib/Form.svelte')).mode & 0o777).toBe(0o640);
    expect((await planApiFetchMigration(root)).edits).toEqual([]);
  });

  it('reuses a safe apiFetch alias without modifying the import or unrelated custom fetch', async () => {
    const preamble = "import { apiFetch as guarded, /* keep import */ Http } from '@beeblock/svelar/http';\nimport { fetch as customFetch } from './custom.js';\nconst custom = () => customFetch('/api/posts', {method:'POST'});";
    write('src/lib/Form.svelte', component(mutation, preamble));
    const plan = await planApiFetchMigration(root);
    expect(plan.errors).toEqual([]);
    const updated = plan.edits[0].updated.toString();
    expect(updated).toContain(preamble);
    expect(updated).toContain("return guarded('/api/posts'");
    expect(updated.match(/from '@beeblock\/svelar\/http'/g)).toHaveLength(1);
  });

  it('creates a fresh import alias when names collide or the existing apiFetch alias is shadowed', async () => {
    write('src/lib/Form.svelte', component(mutation, "import { apiFetch as guarded } from '@beeblock/svelar/http';\nconst apiFetch = 'local';\nfunction other(guarded: unknown) { return guarded; }"));
    const plan = await planApiFetchMigration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits[0].updated.toString()).toContain("import { apiFetch as svelarApiFetch } from '@beeblock/svelar/http';");
    expect(plan.edits[0].updated.toString()).toContain("return svelarApiFetch('/api/posts'");
  });

  it('preserves destructured custom fetch and avoids destructured apiFetch alias shadowing', async () => {
    write('src/lib/Custom.svelte', '<script>const {fetch}=transport;</script><button onclick={()=>fetch("/api/custom",{method:"POST"})}>Save</button>');
    write('src/lib/Form.svelte', component(mutation, "import { apiFetch as guarded } from '@beeblock/svelar/http'; function other({guarded}: {guarded:unknown}) { return guarded; }"));
    const plan = await planApiFetchMigration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.map((edit) => edit.path)).toEqual(['src/lib/Form.svelte']);
    expect(plan.edits[0].updated.toString()).toContain("return svelarApiFetch('/api/posts'");
  });

  it('blocks reassigned global fetch, including bracket and compound assignments', async () => {
    for (const preamble of ["globalThis['fetch'] = custom;", 'globalThis.fetch ||= custom;']) {
      write('src/lib/Form.svelte', component(mutation, preamble));
      const plan = await planApiFetchMigration(root);
      expect(plan.errors.join('\n')).toContain('Fetch is reassigned');
      expect(() => applyApiFetchMigration(plan, { confirmed: true })).toThrow();
    }
  });

  it('handles inline DOM events and preserves comments adjacent to the callee and options', async () => {
    write('src/lib/Inline.svelte', `<script>const label='Save';</script>\n<button onclick={() => fetch /* keep callee */ ('/api/save', { /* keep options */ method: 'DELETE' })}>{label}</button>\n`);
    const plan = await planApiFetchMigration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits[0].updated.toString()).toContain("apiFetch /* keep callee */ ('/api/save', { showToast: false, headers: { Accept: '*/*' }, /* keep options */ method: 'DELETE'");
  });

  it('migrates browser-guarded and aliased onMount calls but leaves SSR and else branches alone', async () => {
    write('src/lib/browser.ts', `import { browser as isBrowser } from '$app/environment';
import { onMount as mounted } from 'svelte';
if (isBrowser) { fetch('/api/browser', {method:'POST'}); } else { fetch('/api/server', {method:'POST'}); }
mounted(() => { window.fetch('/api/mounted', {method:'PATCH'}); });
export const server = () => fetch('/api/unknown-context', {method:'POST'});
`);
    const plan = await planApiFetchMigration(root);
    expect(plan.errors).toEqual([]);
    const updated = plan.edits[0].updated.toString();
    expect(updated).toContain("apiFetch('/api/browser'");
    expect(updated).toContain("apiFetch('/api/mounted'");
    expect(updated).toContain("else { fetch('/api/server'");
    expect(updated).toContain("() => fetch('/api/unknown-context'");
  });

  it('never replaces external/server/GET/custom fetch or calls also evaluated during SSR', async () => {
    const unchanged = {
      'src/routes/api/+server.ts': `export const POST=async()=>${mutation};\n`,
      'src/lib/server/provider.ts': `export const run=()=>${mutation};\n`,
      'src/lib/External.svelte': component("fetch('https://provider.test/api', {method:'POST'})"),
      'src/lib/Protocol.svelte': component("fetch('//provider.test/api', {method:'POST'})"),
      'src/lib/Relative.svelte': component("fetch('api/posts', {method:'POST'})"),
      'src/lib/Read.svelte': component("fetch('/api/posts')"),
      'src/lib/ExplicitGet.svelte': component("fetch('/api/posts', {method:'GET'})"),
      'src/lib/Custom.svelte': component(mutation, "import { fetch } from './custom.js';"),
      'src/lib/Ssr.svelte': component(mutation, 'save();'),
      'src/lib/Module.svelte': `<script module>${mutation};</script><p>module</p>`,
    };
    for (const [path, source] of Object.entries(unchanged)) write(path, source);
    const plan = await planApiFetchMigration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits).toEqual([]);
    applyApiFetchMigration(plan, { confirmed: true });
    for (const [path, source] of Object.entries(unchanged)) expect(read(path)).toBe(source);
    expect(files().some((path) => path.includes('.bak'))).toBe(false);
  });

  it.each([
    "fetch('/api/posts', {method:'POST', ...options})",
    "fetch('/api/posts', {method:'POST', headers: new Headers()})",
    "fetch('/api/posts', {method:'POST', headers: {['X-Test']:'value'}})",
    "fetch('/api/posts', {method:'POST', body: 'raw string'})",
    "fetch('/api/posts', {method:'POST', credentials:'omit'})",
    "fetch('/api/posts', {method:'POST', mode:'no-cors'})",
    "fetch('/api/posts', {method:method})",
    "fetch(url, {method:'POST'})",
    "fetch('/api/posts', {method:'POST', method:'DELETE'})",
    "fetch('/api/posts', {method:'POST', headers:{Accept:'json',accept:'text'}})",
    "fetch('/api/posts', {method:'POST', customOption:true})",
    "window /* never discard */ .fetch('/api/posts', {method:'POST'})",
  ])('blocks unsafe candidate %s before writing any otherwise-safe file', async (expression) => {
    write('src/lib/Safe.svelte', component(mutation));
    write('src/lib/Unsafe.svelte', component(expression));
    const plan = await planApiFetchMigration(root);
    expect(plan.errors.length).toBeGreaterThan(0);
    await expect(async () => applyApiFetchMigration(plan, { confirmed: true })).rejects.toThrow('preflight failed');
    expect(read('src/lib/Safe.svelte')).toBe(component(mutation));
    expect(files().some((path) => path.includes('.bak'))).toBe(false);
  });

  it('preserves explicit CSRF calls and existing Accept headers and supports nonstring FormData bodies', async () => {
    write('src/lib/Guarded.svelte', component("fetch('/api/posts', {method:'POST',headers:{'X-CSRF-Token':token}})"));
    write('src/lib/Form.svelte', component("fetch('/api/posts', {method:'POST',headers:{Accept:'text/plain'},body:new FormData()})"));
    const plan = await planApiFetchMigration(root);
    expect(plan.errors).toEqual([]);
    expect(plan.edits.map((edit) => edit.path)).toEqual(['src/lib/Form.svelte']);
    expect(plan.edits[0].updated.toString()).toContain("headers:{Accept:'text/plain'}");
  });

  it('refuses syntax errors, invalid UTF-8 and symlink boundaries without any writes', async () => {
    write('src/lib/Safe.svelte', component(mutation));
    write('src/lib/Broken.svelte', '<script>const broken=;</script>');
    write('src/lib/Binary.ts', Buffer.from([0xff, 0xfe]));
    symlinkSync(join(root, 'src/lib/Safe.svelte'), join(root, 'src/lib/Link.svelte'));
    const plan = await planApiFetchMigration(root);
    expect(plan.errors).toHaveLength(3);
    expect(() => applyApiFetchMigration(plan, { confirmed: true })).toThrow();
    expect(files().some((path) => path.includes('.bak'))).toBe(false);
  });

  it('requires approval and detects concurrent source changes before backups', async () => {
    write('src/lib/Form.svelte', component(mutation));
    const plan = await planApiFetchMigration(root);
    expect(() => applyApiFetchMigration(plan, { confirmed: false })).toThrow('confirmation');
    write('src/lib/Form.svelte', `${component(mutation)}<!-- parent customization -->`);
    expect(() => applyApiFetchMigration(plan, { confirmed: true })).toThrow('changed after planning');
    expect(files().some((path) => path.includes('.bak'))).toBe(false);
  });

  it('preserves a concurrent permission change rather than reopening the file from an old plan', async () => {
    write('src/lib/Form.svelte', component(mutation));
    const plan = await planApiFetchMigration(root);
    chmodSync(join(root, 'src/lib/Form.svelte'), 0o600);
    expect(() => applyApiFetchMigration(plan, { confirmed: true })).toThrow('changed after planning');
    expect(lstatSync(join(root, 'src/lib/Form.svelte')).mode & 0o777).toBe(0o600);
    expect(files().some((path) => path.includes('.bak'))).toBe(false);
  });

  it('never clobbers old backups and rolls back own writes after an atomic rename failure', async () => {
    write('src/lib/A.svelte', component(mutation));
    write('src/lib/B.svelte', component(mutation));
    write('src/lib/A.svelte.api-fetch.bak', 'old backup must survive');
    const plan = await planApiFetchMigration(root);
    let calls = 0;
    vi.mocked(renameSync).mockImplementation((from, to) => { if (++calls === 2) throw new Error('injected rename failure'); originalRename(from, to); });
    expect(() => applyApiFetchMigration(plan, { confirmed: true })).toThrow('Exact backups retained');
    expect(read('src/lib/A.svelte')).toBe(component(mutation));
    expect(read('src/lib/B.svelte')).toBe(component(mutation));
    expect(read('src/lib/A.svelte.api-fetch.bak')).toBe('old backup must survive');
    expect(read('src/lib/A.svelte.api-fetch.bak.1')).toBe(component(mutation));
    expect(read('src/lib/B.svelte.api-fetch.bak')).toBe(component(mutation));
    expect(files().some((path) => path.endsWith('.tmp'))).toBe(false);
  });

  it('rejects a symlink swapped in after planning instead of mutating its target', async () => {
    write('src/lib/Form.svelte', component(mutation));
    write('src/lib/Untouched.svelte', component(mutation));
    const plan = await planApiFetchMigration(root);
    rmSync(join(root, 'src/lib/Form.svelte'));
    symlinkSync(join(root, 'src/lib/Untouched.svelte'), join(root, 'src/lib/Form.svelte'));
    expect(() => applyApiFetchMigration(plan, { confirmed: true })).toThrow('symlink changed');
    expect(read('src/lib/Untouched.svelte')).toBe(component(mutation));
  });
});

describe('update --migrate-api-fetch integration', () => {
  beforeEach(() => { write('src/lib/Form.svelte', component(mutation)); process.chdir(root); });

  it.each(['dry-run', 'list'])('provides reviewed token output and zero writes in --%s', async (flag) => {
    await new UpdateCommand().handle([], { 'migrate-api-fetch': true, [flag]: true, force: true });
    expect(read('src/lib/Form.svelte')).toBe(component(mutation));
    expect(files().some((path) => path.includes('.bak'))).toBe(false);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('->');
  });

  it('requires noninteractive --force, and respects rejected and accepted interactive confirmation', async () => {
    const noninteractive = new UpdateCommand();
    await withTTY(false, () => noninteractive.handle([], { 'migrate-api-fetch': true }));
    expect(noninteractive.exitCode).toBe(1);
    approval.answer = 'no';
    await withTTY(true, () => new UpdateCommand().handle([], { 'migrate-api-fetch': true }));
    expect(read('src/lib/Form.svelte')).toBe(component(mutation));
    approval.answer = 'yes';
    await withTTY(true, () => new UpdateCommand().handle([], { 'migrate-api-fetch': true }));
    expect(read('src/lib/Form.svelte')).toContain("return apiFetch('/api/posts'");
  });

  it.each(['migrate-core', 'migrate-zod4', 'include-user-files', 'add-missing-user-files', 'category'])('rejects combining with --%s before migration', async (flag) => {
    const command = new UpdateCommand();
    await command.handle([], { 'migrate-api-fetch': true, [flag]: flag === 'category' ? 'page' : true, force: true });
    expect(command.exitCode).toBe(1);
    expect(read('src/lib/Form.svelte')).toBe(component(mutation));
  });

  it('passes the opt-in flag through the real CLI parser, leaving package/config/templates untouched', async () => {
    const manifest = read('package.json');
    const command = new UpdateCommand();
    expect(command.flags.find((flag) => flag.name === 'migrate-api-fetch')?.default).toBe(false);
    const cli = new Cli();
    cli.register(UpdateCommand);
    await cli.run(['update', '--migrate-api-fetch', '--force']);
    expect(read('src/lib/Form.svelte')).toContain("return apiFetch('/api/posts'");
    expect(read('package.json')).toBe(manifest);
    expect(files().map((path) => path.slice(root.length + 1)).sort()).toEqual(['package.json', 'src/lib/Form.svelte', 'src/lib/Form.svelte.api-fetch.bak']);
  });
});
