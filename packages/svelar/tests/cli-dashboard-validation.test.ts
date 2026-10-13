import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zod4Client, valibotClient } from 'sveltekit-superforms/adapters';
import * as v from 'valibot';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';
import { NewCommand } from '../src/cli/commands/NewCommand.js';
import { UpdateCommand } from '../src/cli/commands/UpdateCommand.js';
import { NewCommandTemplates as T } from '../src/cli/commands/NewCommandTemplates.js';
import { DashboardMutationRequest } from '../src/dashboard/contracts.js';
import { dashboardRoleCreateSchema, dashboardUserAccessSchema, dashboardUserRoleSchema, dashboardUserCapabilitySchema } from '../src/dashboard/schemas.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: (path: Parameters<typeof actual.readFileSync>[0], options?: Parameters<typeof actual.readFileSync>[1]) => {
    // Source entry imports do not have the installed dist/cli depth assumed by NewCommand.
    const ownSourcePath = fileURLToPath(new URL('../src/package.json', import.meta.url));
    const ownManifest = fileURLToPath(new URL('../package.json', import.meta.url));
    return actual.readFileSync(path === ownSourcePath ? ownManifest : path, options);
  } };
});

const dashboardPath = 'src/routes/admin/dashboard/+page.svelte';
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const schemas = ['dashboardRoleCreateSchema', 'dashboardUserAccessSchema', 'dashboardUserRoleSchema', 'dashboardUserCapabilitySchema'];
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(packageRoot, '.test-dashboard-validation-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

function assertNative(content: string): void {
  expect(content).toContain("from '@beeblock/svelar/dashboard/schemas'");
  for (const schema of schemas) expect(content).toContain(`zod4Client(${schema})`);
  expect(content).not.toContain('valibotClient');
}

describe('Controlled framework dashboard validation producer', () => {
  it.each(['zod', 'valibot'] as const)('keeps MakeDashboard fixed contracts byte-identical for %s in both layouts', (validation) => {
    for (const flat of [false, true]) {
      const files = new MakeDashboardCommand().files(undefined, flat ? '$lib/permissions/access.server.js' : '$lib/shared/permissions/access.server.js');
      const page = files.find(file => file.path === dashboardPath)!;
      const transformed = T.applyValidationProvider(page.content, validation, page.path);
      expect(transformed).toBe(page.content); assertNative(transformed);
    }
  });

  it.each(['zod', 'valibot'] as const)('emits matching New and Update dashboard contracts for %s in DDD/flat', async (validation) => {
    for (const flat of [false, true]) {
      const app = join(root, flat ? 'flat' : 'ddd');
      await new NewCommand().handle([app], { 'no-install': true, flat, validation });
      const source = readFileSync(join(app, dashboardPath), 'utf8'); assertNative(source);
      const login = readFileSync(join(app, 'src/routes/login/+page.svelte'), 'utf8');
      expect(login).toContain(validation === 'valibot' ? 'valibotClient(loginSchema)' : 'zod4Client(loginSchema)');
      const cwd = vi.spyOn(process, 'cwd').mockReturnValue(app);
      try {
        const update = new UpdateCommand();
        const factory: unknown = Reflect.get(update, 'getFileManifest');
        if (typeof factory !== 'function') throw new Error('Update manifest helper missing');
        const manifest: unknown = Reflect.apply(factory, update, [!flat, 'fixture']);
        if (!Array.isArray(manifest)) throw new Error('Invalid Update manifest');
        const page: unknown = manifest.find((entry: unknown) => !!entry && typeof entry === 'object' && 'path' in entry && entry.path === dashboardPath);
        if (!page || typeof page !== 'object' || !('content' in page) || typeof page.content !== 'function') throw new Error('Dashboard manifest entry missing');
        const refreshed: unknown = Reflect.apply(page.content, page, []);
        expect(typeof refreshed).toBe('string'); assertNative(String(refreshed));
        expect(refreshed).toBe(source);
      } finally { cwd.mockRestore(); }
    }
  }, 30_000);

  it('does not infer native ownership from imported core names, comments, or source strings in an app producer', () => {
    const app = `// src/routes/admin/dashboard/+page.svelte; fixed core names are not producer metadata
import { zod4Client } from 'sveltekit-superforms/adapters';
const path = 'src/routes/admin/dashboard/+page.svelte';
const form = zod4Client(appOwnedSchema);
`;
    const converted = T.applyValidationProvider(app, 'valibot', 'src/routes/profile/+page.svelte');
    expect(converted).toContain('valibotClient(appOwnedSchema)');
    expect(T.applyValidationProvider(app, 'valibot')).toBe(converted);
  });

  it('keeps app schema generation Valibot while the console uses the identical backend Zod contracts', async () => {
    expect(new DashboardMutationRequest('createRole').rules()).toBe(dashboardRoleCreateSchema);
    expect(new DashboardMutationRequest('assignRole').rules()).toBe(dashboardUserRoleSchema);
    expect(new DashboardMutationRequest('grantCapability').rules()).toBe(dashboardUserCapabilitySchema);
    const forms = [
      zod4Client(dashboardRoleCreateSchema).validate({ scope: 'team', teamId: 'team', name: 'Support', label: 'Support', confirmed: true }),
      zod4Client(dashboardUserAccessSchema).validate({ scope: 'team', teamId: 'team', id: '7' }),
      zod4Client(dashboardUserRoleSchema).validate({ scope: 'team', teamId: 'team', id: '7', roleId: 3, confirmed: true }),
      zod4Client(dashboardUserCapabilitySchema).validate({ scope: 'team', teamId: 'team', id: '7', capability: 'action.operations.users.view', confirmed: true }),
      valibotClient(v.object({ label: v.string() })).validate({ label: 'App-owned Valibot' }),
    ];
    expect((await Promise.all(forms)).every(result => result.success)).toBe(true);
    expect(T.applyValidationProvider(T.loginPageSvelte(), 'valibot', 'src/routes/login/+page.svelte')).toContain('valibotClient(loginSchema)');
  });
});
