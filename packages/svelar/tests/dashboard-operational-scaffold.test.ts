import { describe, expect, it } from 'vitest';
import { compile, parse } from 'svelte/compiler';
import ts from 'typescript';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';

describe('operational console scaffold source contracts',()=>{
  const command = new MakeDashboardCommand();
  const decision={public:false,resource:'operations',scope:'platform' as const,route:'/admin/dashboard'};
  const files=command.files(decision,'$lib/shared/permissions/access.server.js');
  const ui=files.find(file=>file.path.endsWith('admin/dashboard/+page.svelte'))!.content;
  it.each(['client','server'] as const)('compiles all generated Svelte surfaces for %s',generate=>{
    for(const file of files.filter(file=>file.path.endsWith('.svelte'))) {
      const result=compile(file.content,{filename:file.path,generate});
      expect(result.js.code.length).toBeGreaterThan(1000);
      expect(result.warnings.filter(warning=>warning.code.startsWith('a11y'))).toEqual([]);
    }
  });
  it('generates static capability wrappers before controller dispatch and a unique declaration for every operation',()=>{
    expect(new Set(command.capabilityActions()).size).toBe(command.capabilityActions().length);
    for(const file of files.filter(file=>file.path.endsWith('+server.ts'))) {
      const result=ts.transpileModule(file.content,{fileName:file.path,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
      expect(result.diagnostics).toEqual([]);expect(file.content).toContain('capabilityAccess.guardEndpoint');expect(file.content).not.toContain('request.json');
    }
    const server=files.find(file=>file.path.endsWith('+page.server.ts'))!.content;
    expect(ts.transpileModule(server,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.ESNext}}).diagnostics).toEqual([]);
    expect(server).toContain('capabilityAccess.guardLayout');expect(server).toContain("if (tab === 'queues')");expect(server).toContain("if (tab === 'users')");
  });
  it('uses actual operations, confirmation, per-action state and URL navigation, never blanket invalidation/polling',()=>{
    for(const value of ['CapabilityEditor','queue/batch/','/requests/','reset-password','profile','confirmed:true','apiFetch','pending[item.key]','goto(url','replaceState','Unknown','Unavailable']) expect(ui).toContain(value);
    expect(ui).not.toContain('invalidateAll');expect(ui).not.toContain('setInterval');expect(ui).not.toContain('on:click');
    expect(ui).not.toContain(' as any');expect(ui).not.toContain('$state<any>');
  });
  it('keeps responsive shell, bounded scroll surfaces and wrap-safe dynamic identifiers',()=>{
    const ast=parse(ui,{modern:true});expect(ast.fragment.nodes.length).toBeGreaterThan(0);
    expect(ui).toContain('grid-template-columns:216px minmax(0,1fr)');expect(ui).toContain('@media(max-width:760px)');
    expect(ui).toContain('overflow-x:auto');expect(ui).toContain('overflow-wrap:anywhere');expect(ui).toContain('aria-label="Operations navigation"');
    expect(ui).toContain('aria-current=');expect(ui).toContain('aria-labelledby="confirmation-title"');
  });
  it('binds parity fields and inline errors through shared Superforms schemas, not native required or old admin endpoints',()=>{
    for(const value of ['@beeblock/svelar/dashboard/schemas','zod4Client','superForm<DashboardRoleCreateInput>','use:enhanceRoleCreate','use:enhanceUserRole','use:enhanceUserCapability',
      'bind:value={$roleCreateValues.name}','bind:value={$userRoleValues.roleId}','bind:value={$userCapabilityValues.capability}',
      '$roleCreateErrors.name','$userRoleErrors.roleId','$userCapabilityErrors.capability','managementBusy','available.assignRole','directGrants.slice(directOffset,directOffset+25)'])expect(ui).toContain(value);
    expect(ui).not.toMatch(/\brequired[\s/>]/);expect(ui).not.toContain('selectedCapability');expect(ui).not.toContain('selectedRole');
    for(const [path,methods] of [['users/[id]/access',['userAccess']],['users/[id]/roles',['assignRole','detachRole']],['users/[id]/capabilities',['grantCapability','revokeCapability']],['permissions/roles',['createRole']]] as const) {
      const endpoint=files.find(file=>file.path===`src/routes/api/admin/${path}/+server.ts`)!;
      for(const method of methods)expect(endpoint.content).toContain(`controller.handle('${method}')`);
      expect(endpoint.content).toContain('capabilityAccess.guardEndpoint');
    }
  });
});
