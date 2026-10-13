import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MakeEntityCommand } from '../src/cli/commands/MakeEntityCommand.js';
import { LintArchitectureCommand } from '../src/cli/commands/LintArchitectureCommand.js';

const cwd = process.cwd(); let root: string;
function write(path: string, content: string): void { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); }
function scan() { return new LintArchitectureCommand().scanProject(join(root, 'src')).filter((finding) => finding.rule.startsWith('capability') || finding.rule === 'architecture-scan'); }
const access = "import { capabilityAccess as access, resolveCapabilityInput as input } from '$lib/permissions/access.server.js';\n";
beforeEach(async () => {
  root = mkdtempSync(join(cwd, '.test-lint-capability-')); process.chdir(root); vi.spyOn(console, 'log').mockImplementation(() => {});
  await new MakeEntityCommand().handle(['Invoice'], { module: 'billing', capability: 'invoices', crud: true, 'no-migration': true });
});
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

describe('architecture audit of explicit capability manifests', () => {
  it('recognizes imported authorizer aliases and namespace aliases, not directory assumptions', () => {
    write('src/routes/invoices/+server.ts', access + "export const POST = access.guardEndpoint('action.invoices.create', async () => new Response(), input);");
    write('src/routes/invoices/detail/+page.server.ts', "import * as auth from '$lib/permissions/access.server.js';\nexport const actions = auth.capabilityAccess.guardPageActions({save: {capability: 'action.invoices.update', handler: async () => ({})}}, auth.resolveCapabilityInput);");
    expect(scan()).toEqual([]);
  });
  it('proves a real Controller.handle binding whose target starts with awaited authorization', () => {
    write('src/routes/invoices/+server.ts', "import { InvoiceController as Invoices } from '$lib/controllers/InvoiceController.js';\nconst ctrl = new Invoices();\nexport const POST = ctrl.handle('store');");
    expect(scan()).toEqual([]);
  });
  it('rejects unguarded endpoint and named page actions with exact source lines', () => {
    write('src/routes/invoices/+server.ts', 'const noop = () => new Response();\nexport const POST = noop;');
    write('src/routes/invoices/+page.server.ts', 'export const actions = { save: async () => ({}) };');
    expect(scan()).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'src/routes/invoices/+server.ts', line: 2, rule: 'capability-binding' }),
      expect.objectContaining({ file: 'src/routes/invoices/+page.server.ts', rule: 'capability-binding' }),
    ]));
  });
  it('rejects undeclared, wrong-kind and dynamic capability bindings', () => {
    write('src/routes/invoices/+server.ts', access + "const name = 'action.invoices.create';\nexport const POST = access.guardEndpoint(name, async () => new Response(), input);\nexport const GET = access.guardEndpoint('action.invoices.unregistered', async () => new Response(), input);");
    write('src/routes/invoices/+page.server.ts', access + "export const actions = access.guardPageActions({save: {capability:'screen.invoices.view', handler: async () => ({})}}, input);");
    const findings = scan();
    expect(findings.some((finding) => finding.rule === 'capability-binding' && finding.message.includes('static canonical'))).toBe(true);
    expect(findings.filter((finding) => finding.rule === 'capability-manifest')).toHaveLength(2);
  });
  it('never treats a fake or lexically shadowed authorizer as a guard', () => {
    write('src/routes/invoices/+server.ts', "const access = {guardEndpoint: (_name: string, handler: () => Response) => handler};\nexport const POST = access.guardEndpoint('action.invoices.create', () => new Response());");
    write('src/routes/invoices/fake/+server.ts', access + "export async function POST(access: {authorize(name: string): Promise<void>}) { await access.authorize('action.invoices.create'); return new Response(); }");
    expect(scan().filter((finding) => finding.rule === 'capability-binding')).toHaveLength(2);
  });
  it('requires first awaited authorization, and screens use a guarded load', () => {
    write('src/routes/invoices/+server.ts', access + "export async function POST(event: unknown) { console.log(event); await access.authorize('action.invoices.create', null); return new Response(); }");
    write('src/routes/invoices/+page.server.ts', 'export const load = async () => ({});');
    expect(scan().filter((finding) => finding.rule === 'capability-binding')).toHaveLength(2);
  });
  it('only leading public decisions exempt functional binding checks, not invalid explicit guards', () => {
    write('src/routes/invoices/+server.ts', '// svelar:public - auth and policy checks still apply\nexport const GET = () => new Response();');
    expect(scan()).toEqual([]);
    write('src/routes/invoices/+server.ts', access + "// svelar:public\nexport const GET = () => new Response();");
    expect(scan().filter((finding) => finding.rule === 'capability-binding')).toHaveLength(1);
    write('src/routes/invoices/+server.ts', '// svelar:public\n' + access + "export const POST = access.guardEndpoint('action.invoices.missing', () => new Response(), input);");
    expect(scan().filter((finding) => finding.rule === 'capability-manifest')).toHaveLength(1);
  });
  it('retains the caller integration hook and fails closed for dynamic central manifests', () => {
    const hook = vi.fn(() => [{ severity: 'error' as const, rule: 'custom-capability', file: 'src/app.ts', line: 1, message: 'External manifest check' }]);
    const findings = new LintArchitectureCommand().scanProject(join(root, 'src'), { auditCapabilities: hook });
    expect(hook).toHaveBeenCalledOnce(); expect(findings.some((finding) => finding.rule === 'custom-capability')).toBe(true);
    write('src/lib/permissions/manifest.ts', "import {PermissionManifest} from '@beeblock/svelar/permissions';\nexport const permissionManifest = new PermissionManifest(JSON.parse('{}'));");
    expect(scan().some((finding) => finding.rule === 'architecture-scan')).toBe(true);
  });
});
