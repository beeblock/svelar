import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { MakeEntityCommand } from '../src/cli/commands/MakeEntityCommand.js';
import { MakeControllerCommand } from '../src/cli/commands/MakeControllerCommand.js';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';
import { MakeRouteCommand } from '../src/cli/commands/MakeRouteCommand.js';
import type { FormRequest, Controller, RequestEvent } from '../src/routing/index.js';
import type { PermissionManifest, CapabilityAuthorizer, CapabilityAuthorizationInput } from '../src/permissions/index.js';

const packageRoot = process.cwd(); const sourceRoot = resolve('src');
const migrationNames = ['CreateTeamsTable', 'CreateRolesTable', 'CreatePermissionsTable', 'CreateRoleHasPermissionsTable',
  'CreateModelHasRolesTable', 'CreateModelHasPermissionsTable', 'CreateTeamRoleHasPermissionsTable',
  'CreateTeamModelHasRolesTable', 'CreateTeamModelHasPermissionsTable', 'CreateRoleCapabilityProfilesTable', 'CreateTeamRoleCapabilityProfilesTable'] as const;
type Runtime = typeof import('../src/database/index.js') & typeof import('../src/permissions/index.js') & typeof import('../src/orm/index.js') & typeof import('../src/support/index.js') & typeof import('../src/testing/index.js') & {
  CreateInvoiceRequest: typeof FormRequest;
  InvoiceController: new () => Controller & { store(event: RequestEvent): Promise<Response> };
  permissionManifest: PermissionManifest;
  capabilityAccess: CapabilityAuthorizer;
  resolveCapabilityInput(event: RequestEvent): CapabilityAuthorizationInput | null;
  CapabilitySeeder: new () => { run(): Promise<void> };
  EntityMigration: new () => { up(): Promise<void> };
  POST(event: RequestEvent): Promise<Response>;
};
const roots: string[] = []; let runtime: Runtime | undefined;
function write(root: string, path: string, content: string): void { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); }
function typecheck(root: string): string {
  const program = ts.createProgram({ rootNames: [...ts.sys.readDirectory(root, ['.ts']), join(sourceRoot, 'types/externals.d.ts')], options: {
    noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true, types: ['node'], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    paths: { '$lib/*': [join(root, 'src/lib/*')], '@beeblock/svelar': [join(sourceRoot, 'index.ts')], '@beeblock/svelar/*': [join(sourceRoot, '*')] },
  } });
  return ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), { getCanonicalFileName: (path) => path, getCurrentDirectory: () => packageRoot, getNewLine: () => '\n' });
}
afterEach(async () => { await runtime?.Connection.disconnect(); runtime?.ApplicationContext.clear(); runtime?.Permissions.clearCapabilities(); runtime = undefined; vi.restoreAllMocks(); process.chdir(packageRoot); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe.each([{ ddd: false, validation: 'zod' }, { ddd: false, validation: 'valibot' }, { ddd: true, validation: 'zod' }, { ddd: true, validation: 'valibot' }])('protected public-subpath fixture (DDD=$ddd, $validation)', ({ ddd, validation }) => {
  it('typechecks/bundles actual framework APIs and proves scoped denial before FormRequest, credentials and seeders', async () => {
    const root = mkdtempSync(join(packageRoot, '.test-capability-runtime-')); roots.push(root);
    if (ddd) mkdirSync(join(root, 'src/lib/modules'), { recursive: true });
    write(root, 'svelar.validation.json', JSON.stringify({ validation }));
    const shared = ddd ? 'shared/permissions' : 'permissions';
    const layered = (flat: string, dddPath: string) => ddd ? `modules/billing/${dddPath}` : flat;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.chdir(root);
      await new MakeEntityCommand().handle(['Invoice'], { module: 'billing', fields: 'title:string', crud: true, capability: 'invoices' });
      await new MakeRouteCommand().handle(['invoices'], { module: 'billing', controller: 'Invoice', resource: true, capability: 'invoices' });
      await new MakeControllerCommand().handle(['Reports'], { module: 'reports', capability: 'reports' });
      await new MakeDashboardCommand().handle([], { capability: 'operations' });
    } finally { process.chdir(packageRoot); }
    write(root, 'src/routes/admin/dashboard/$types.d.ts', "export type { ServerLoad as PageServerLoad } from '@sveltejs/kit';\n");
    write(root, 'public-contracts.ts', `import { PermissionManifest, PermissionProfiles, CapabilityAuthorizer } from '@beeblock/svelar/permissions';
import { capabilityClient } from '@beeblock/svelar/permissions/client';
import { permissionManifest } from '$lib/${shared}/manifest.js';
export const profiles: PermissionProfiles = new PermissionProfiles(permissionManifest);
export const authorizer: CapabilityAuthorizer = new CapabilityAuthorizer(permissionManifest);
export const manifest: PermissionManifest = permissionManifest;
export async function snapshot() { return capabilityClient(await authorizer.snapshot({ principal: {kind: 'user', modelType: 'User', modelId: 1, credentialCapabilities: ['screen.invoices.view']}, scope: {teamId: 'team-a'}, context: {teamId: 'team-a'} })).can('screen.invoices.view'); }
`);
    expect(typecheck(root)).toBe('');
    const entityMigration = readdirSync(join(root, 'src/lib/database/migrations')).find((file) => file.endsWith('_create_invoices_table.ts'))!;
    const entry = `export { Connection, ${migrationNames.join(', ')} } from '@beeblock/svelar/database';
export { Permissions, PermissionProfiles } from '@beeblock/svelar/permissions';
export { QueryBuilder } from '@beeblock/svelar/orm';
export { ApplicationContext } from '@beeblock/svelar/support';
export { createRequestEvent } from '@beeblock/svelar/testing';
export { capabilityAccess, resolveCapabilityInput } from '$lib/${shared}/access.server.js';
export { permissionManifest } from '$lib/${shared}/manifest.js';
export { CapabilitySeeder } from '$lib/database/seeders/CapabilitySeeder.js';
export { CreateInvoiceRequest } from '$lib/${layered('dtos', 'interface/http/requests')}/InvoiceRequests.js';
export { InvoiceController } from '$lib/${layered('controllers', 'interface/http/controllers')}/InvoiceController.js';
export { POST } from './src/routes/invoices/+server.js';
export { default as EntityMigration } from './src/lib/database/migrations/${entityMigration}';
`;
    const output = join(root, 'fixture.mjs');
    await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, outfile: output,
      alias: { '$lib': join(root, 'src/lib'), '@beeblock/svelar': sourceRoot }, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent' });
    const app: Runtime = await import(pathToFileURL(output).href); runtime = app;
    await app.Connection.disconnect(); app.ApplicationContext.clear(); app.Permissions.clearCapabilities();
    app.Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    for (const name of migrationNames) await new app[name]().up();
    await new app.EntityMigration().up();
    for (const id of ['team-a', 'team-b']) await new app.QueryBuilder('teams').insert({ id, name: id, slug: id, owner_id: '1', personal_team: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await app.ApplicationContext.runIsolated({ teamId: 'team-a' }, () => new app.CapabilitySeeder().run());
    const role = await app.Permissions.findRole('tenant-admin'); expect(role).not.toBeNull();
    expect(await new app.QueryBuilder('team_model_has_roles').count()).toBe(0);
    const profiles = new app.PermissionProfiles(app.permissionManifest);
    await profiles.forTeam('team-a').setCustom(role!.id, ['screen.invoices.view']);
    await app.ApplicationContext.runIsolated({ teamId: 'team-a' }, () => new app.CapabilitySeeder().run());
    expect(await profiles.forTeam('team-a').get(role!.id)).toMatchObject({ kind: 'custom', capabilities: ['screen.invoices.view'] });
    await profiles.forTeam('team-a').setSystem(role!.id, 'tenant-admin');
    const validationSpy = vi.spyOn(app.CreateInvoiceRequest, 'validate');
    const event = (apiKey?: Record<string, unknown>, anonymous = false): RequestEvent => app.createRequestEvent({ method: 'POST', url: 'http://svelar.test/invoices', body: { title: 'Invoice' }, locals: anonymous ? {} : { user: { id: 1 }, ...(apiKey ? { apiKey } : {}) } });
    expect((await app.ApplicationContext.runIsolated({ teamId: 'team-a' }, () => app.POST(event()))).status).toBe(403);
    expect((await app.ApplicationContext.runIsolated({ teamId: 'team-a' }, () => app.POST(event(undefined, true)))).status).toBe(401);
    expect(validationSpy).not.toHaveBeenCalled();
    await app.Permissions.forTeam('team-a').assignRole('User', 1, role!.id);
    expect((await app.ApplicationContext.runIsolated({ teamId: 'team-b' }, () => app.POST(event()))).status).toBe(403);
    for (const permissions of [[], ['action.invoices.create'], ['screen.invoices.view'], ['unknown']]) {
      expect((await app.ApplicationContext.runIsolated({ teamId: 'team-a', actorId: 1, actorType: 'user' }, () => app.POST(event({ actorType: 'user', actorId: 1, teamId: 'team-a', permissions })))).status).toBe(403);
    }
    expect((await app.ApplicationContext.runIsolated({ teamId: 'team-a' }, () => app.POST(event({ actorType: 'user', teamId: 'team-b', permissions: ['*'] })))).status).toBe(401);
    expect(validationSpy).not.toHaveBeenCalled();
    await expect(app.ApplicationContext.runIsolated({ teamId: 'team-a' }, () => new app.InvoiceController().store(event({ permissions: [] })))).rejects.toMatchObject({ status: 403 });
    expect(validationSpy).not.toHaveBeenCalled();
    expect((await app.ApplicationContext.runIsolated({ teamId: 'team-a', actorId: 1, actorType: 'user' }, () => app.POST(event({ actorType: 'user', actorId: 1, teamId: 'team-a', permissions: ['screen.invoices.view', 'action.invoices.create'] })))).status).toBe(201);
    expect(validationSpy).toHaveBeenCalledTimes(1);
    const serviceEvent: RequestEvent = app.createRequestEvent({ method: 'POST', url: 'http://svelar.test/invoices', body: { title: 'Service' }, locals: { apiKey: { actorType: 'service_account', actorId: 'svc', teamId: 'team-a', permissions: ['screen.invoices.view', 'action.invoices.create'] } } });
    expect((await app.ApplicationContext.runIsolated({ teamId: 'team-a', actorId: 'wrong', actorType: 'service_account' }, () => app.POST(serviceEvent))).status).toBe(403);
    expect((await app.ApplicationContext.runIsolated({ teamId: 'team-a', actorId: 'svc', actorType: 'service_account' }, () => app.POST(serviceEvent))).status).toBe(403);
    // Functional permission does not override the generated FormRequest's human-user authentication policy.
    expect(validationSpy).toHaveBeenCalledTimes(2);
    expect(await new app.QueryBuilder('invoices').count()).toBe(1);
  }, 120_000);
});
