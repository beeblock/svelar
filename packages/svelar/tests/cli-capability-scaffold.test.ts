import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { CapabilityScaffold, capabilityManifestPath, loadCapabilityManifest } from '../src/cli/CapabilityScaffold.js';
import { MakeEntityCommand } from '../src/cli/commands/MakeEntityCommand.js';
import { MakeControllerCommand } from '../src/cli/commands/MakeControllerCommand.js';
import { MakeRouteCommand } from '../src/cli/commands/MakeRouteCommand.js';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';
import { LintArchitectureCommand } from '../src/cli/commands/LintArchitectureCommand.js';

const cwd = process.cwd();
let root: string;
function write(path: string, content: string): void { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); }
function read(path: string): string { return readFileSync(join(root, path), 'utf8'); }
function files(): string[] { return readdirSync(root, { recursive: true }).map(String).sort(); }
function capabilityFindings() { return new LintArchitectureCommand().scanProject(join(root, 'src')).filter((entry) => entry.rule.startsWith('capability') || entry.rule === 'architecture-scan'); }

beforeEach(() => { root = mkdtempSync(join(cwd, '.test-capability-scaffold-')); process.chdir(root); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

describe('explicit generator capability decisions', () => {
  it('seeds an explicit sibling project root without changing cwd and prevents escaped writes', () => {
    const sibling = mkdtempSync(join(tmpdir(), 'svelar-capability-root-'));
    try {
      const original = process.cwd();
      const decision = CapabilityScaffold.decision({ capability: 'operations' }, { route: '/admin/dashboard', scope: 'platform' });
      const plan = CapabilityScaffold.prepare('admin', 'Operations', decision, ['queue.retry'], sibling);
      plan.commit();
      expect(process.cwd()).toBe(original); expect(files()).toEqual([]);
      expect(loadCapabilityManifest(sibling)!.require('action.operations.queue.retry').scope).toBe('platform');
      const escaped = join(sibling, 'src/lib/permissions/capabilities');
      rmSync(escaped, { recursive: true }); symlinkSync(root, escaped, 'dir');
      expect(() => CapabilityScaffold.prepare('other', 'Other', decision, [], sibling)).toThrow('symlink');
      expect(files()).toEqual([]);
    } finally { rmSync(sibling, { recursive: true, force: true }); }
  });
  it.each([
    ['entity', () => new MakeEntityCommand().handle(['Invoice'], { crud: true })],
    ['controller', () => new MakeControllerCommand().handle(['Invoice'], {})],
    ['route', () => new MakeRouteCommand().handle(['invoices'], {})],
    ['dashboard', () => new MakeDashboardCommand().handle([], {})],
  ])('rejects missing %s decisions before any writes', async (_name, run) => {
    await expect(run()).rejects.toThrow('Choose exactly one'); expect(files()).toEqual([]);
  });
  it.each([
    { capability: 'invoices', public: true }, { public: true, scope: 'team' }, { public: 'true' },
    { capability: '9bad' }, { capability: "orders';throw Error('x')" }, { capability: 'invoices', scope: 'owner' },
    { capability: 'invoices', 'screen-route': '/../../admin' }, { capability: 'invoices', 'screen-route': 'https://evil.test' },
  ])('rejects invalid protected/public input before writes: %j', async (flags) => {
    await expect(new MakeEntityCommand().handle(['Invoice'], flags)).rejects.toThrow(); expect(files()).toEqual([]);
  });
  it('keeps public authentication/FormRequest authorization and creates no manifest or grants', async () => {
    await new MakeEntityCommand().handle(['Invoice'], { public: true, crud: true });
    await new MakeRouteCommand().handle(['invoices'], { public: true, resource: true });
    expect(read('src/lib/controllers/InvoiceController.ts')).toContain('CreateInvoiceRequest.validate(event)');
    expect(read('src/lib/dtos/InvoiceRequests.ts')).toContain('return !!event.locals.user;');
    expect(read('src/routes/invoices/+server.ts')).toMatch(/^\/\/ svelar:public/);
    expect(existsSync(capabilityManifestPath(root))).toBe(false);
  });
  it.each([false, true])('wires module fragments, exact CRUD guards and central imports (DDD=%s)', async (ddd) => {
    if (ddd) mkdirSync('src/lib/modules', { recursive: true });
    const flags = { module: 'billing', capability: 'invoices', crud: true, 'no-migration': true };
    await new MakeEntityCommand().handle(['Invoice'], flags);
    await new MakeRouteCommand().handle(['invoices'], { module: 'billing', controller: 'Invoice', capability: 'invoices', resource: true });
    const manifest = loadCapabilityManifest(root)!;
    expect(manifest.capabilities().map((entry) => entry.name).sort()).toEqual(['action.invoices.create', 'action.invoices.delete', 'action.invoices.update', 'screen.invoices.view']);
    const controller = read(`src/lib/${ddd ? 'modules/billing/interface/http/controllers' : 'controllers'}/InvoiceController.ts`);
    expect(controller.indexOf("authorize('action.invoices.create'")).toBeLessThan(controller.indexOf('CreateInvoiceRequest.validate'));
    expect(read('src/routes/invoices/+server.ts')).toContain("guardEndpoint('action.invoices.create', ctrl.handle('store')");
    expect(read('src/routes/invoices/[id]/+server.ts')).toContain("guardEndpoint('action.invoices.delete'");
    expect(read(`src/lib/${ddd ? 'shared/permissions' : 'permissions'}/manifest.ts`)).toContain(ddd ? '$lib/modules/billing/contracts/capabilities.js' : '$lib/permissions/capabilities/billing.js');
    const originals = new Map(files().filter((path) => path.endsWith('.ts')).map((path) => [path, read(path)]));
    await new MakeEntityCommand().handle(['Invoice'], flags);
    for (const [path, content] of originals) expect(read(path), path).toBe(content);
    expect(capabilityFindings()).toEqual([]);
  });
  it('preserves central aliases/comments and optional fragment arrays when extending', async () => {
    await new MakeControllerCommand().handle(['InvoiceRead'], { module: 'billing', capability: 'invoices' });
    const central = 'src/lib/permissions/manifest.ts';
    write(central, read(central).replace('capabilities as moduleBillingCapabilities', 'capabilities as invoiceCaps').replaceAll('moduleBillingCapabilities.', 'invoiceCaps.').replace('screens: [', 'screens: [ // retained central note'));
    const fragment = 'src/lib/permissions/capabilities/billing.ts';
    write(fragment, read(fragment).replace('  aliases: [],\n', '').replace('  systemProfiles: [],\n', '').replace('actions: [],', 'actions: [], // retained module note'));
    await new MakeEntityCommand().handle(['Invoice'], { module: 'billing', capability: 'invoices', crud: true, 'screen-route': '/billing', 'no-migration': true });
    expect(read(central)).toContain('invoiceCaps.screens'); expect(read(central)).toContain('// retained central note');
    expect(read(fragment)).toContain('// retained module note'); expect(loadCapabilityManifest(root)!.require('action.invoices.update')).toBeTruthy();
  });
  it('fails closed for dynamic manifests without executing app code or writing artifacts', async () => {
    write('src/lib/permissions/manifest.ts', `import { PermissionManifest } from '@beeblock/svelar/permissions';\nexport const permissionManifest = new PermissionManifest((() => { throw Error('executed'); })());`);
    const before = files(); await expect(new MakeControllerCommand().handle(['Invoice'], { capability: 'invoices' })).rejects.toThrow('literal'); expect(files()).toEqual(before);
  });
  it('rejects scoped/route conflicts and legacy customized protected controllers before writes', async () => {
    await new MakeControllerCommand().handle(['Invoice'], { module: 'billing', capability: 'invoices' });
    const before = files();
    await expect(new MakeEntityCommand().handle(['Credit'], { module: 'billing', capability: 'invoices', scope: 'platform' })).rejects.toThrow('scope/route');
    await expect(new MakeEntityCommand().handle(['Invoice'], { module: 'billing', capability: 'invoices', 'screen-route': '/billing' })).rejects.toThrow('Existing controller');
    expect(files()).toEqual(before);
  });
  it('supports declared exact permissions on custom routes and rejects unknown or broad resource grants', async () => {
    await new MakeEntityCommand().handle(['Invoice'], { module: 'billing', capability: 'invoices', crud: true });
    await new MakeRouteCommand().handle(['invoices/export'], { controller: 'Invoice', permission: 'screen.invoices.view' });
    expect(read('src/routes/invoices/export/+server.ts')).toContain("guardEndpoint('screen.invoices.view'");
    const before = files();
    await expect(new MakeRouteCommand().handle(['invoices/missing'], { permission: 'action.invoices.unknown' })).rejects.toThrow();
    await expect(new MakeRouteCommand().handle(['invoices/all'], { permission: 'screen.invoices.view', resource: true })).rejects.toThrow('broad');
    await expect(new MakeRouteCommand().handle(['invoices/foreign'], { permission: 'screen.invoices.view', scope: 'platform' })).rejects.toThrow('scope');
    expect(files()).toEqual(before);
  });
  it.each(['../escape', '/a/../../escape', '//evil.test', 'a/"quoted', 'a\\b', 'a/\ncontrol', 'a//b'])('rejects unsafe route %s before writes', async (path) => {
    await expect(new MakeRouteCommand().handle([path], { public: true })).rejects.toThrow(); expect(files()).toEqual([]);
  });
  it('rejects ambiguous DDD controller names and symlinked capability imports', async () => {
    for (const module of ['billing', 'sales']) write(`src/lib/modules/${module}/interface/http/controllers/InvoiceController.ts`, 'export class InvoiceController {}');
    await expect(new MakeRouteCommand().handle(['invoices'], { public: true, controller: 'Invoice' })).rejects.toThrow('multiple modules');
    process.chdir(cwd); rmSync(join(root, 'src'), { recursive: true }); process.chdir(root);
    mkdirSync('src/lib', { recursive: true }); symlinkSync(cwd, 'src/lib/permissions', 'dir');
    await expect(new MakeControllerCommand().handle(['Invoice'], { capability: 'invoices' })).rejects.toThrow();
    expect(existsSync('src/lib/controllers')).toBe(false);
  });
  it('registers platform-only dashboard operations without changing the UI template or bypassing native auth/CSRF', async () => {
    const command = new MakeDashboardCommand(); const beforeUi = command.files().find((file) => file.path.endsWith('.svelte'))!.content;
    await expect(command.handle([], { capability: 'operations', scope: 'team' })).rejects.toThrow('platform'); expect(files()).toEqual([]);
    await command.handle([], { capability: 'operations' });
    expect(read('src/routes/admin/dashboard/+page.svelte')).toBe(beforeUi);
    expect(read('src/routes/admin/dashboard/+page.server.ts')).toContain('capabilityAccess.guardLayout');
    expect(read('src/routes/admin/dashboard/+page.server.ts')).toContain('authorizeDashboard(event)');
    expect(read('src/routes/api/admin/queue/[id]/retry/+server.ts')).toContain("guardEndpoint('action.operations.queue.retry'");
    expect(loadCapabilityManifest(root)!.require('action.operations.logs.tail').scope).toBe('platform');
    expect(capabilityFindings()).toEqual([]);
    write('src/routes/api/admin/queue/+server.ts', 'export const GET = () => new Response();');
    const before = read('src/lib/permissions/manifest.ts');
    await expect(command.handle([], { capability: 'operations' })).rejects.toThrow('Existing dashboard');
    expect(read('src/lib/permissions/manifest.ts')).toBe(before);
  });
  it('emits API-only seeders that preserve profile customization and never assign users', () => {
    const seeder = CapabilityScaffold.supportFiles(true).find((file) => file.path.endsWith('Seeder.ts'))!.content;
    expect(seeder).toContain('Permissions.syncCapabilities'); expect(seeder).toContain('if (!await scope.get(role.id))');
    expect(seeder).not.toContain('assignRole'); expect(seeder).not.toContain('QueryBuilder'); expect(seeder).not.toContain('createTable');
  });
});
