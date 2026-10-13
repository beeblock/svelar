import { describe, expect, it, vi } from 'vitest';
import { compile, parse, type AST } from 'svelte/compiler';
import { error, redirect } from '@sveltejs/kit';
import ts from 'typescript';
import { NewCommandTemplates as T, type ValidationProvider } from '../src/cli/commands/NewCommandTemplates.js';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';

type Element = AST.RegularElement | AST.Component;
function elements(value: unknown): Element[] {
  const found: Element[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if ('type' in node && (node.type === 'RegularElement' || node.type === 'Component')) found.push(node as Element);
    Object.values(node).forEach(visit);
  }; visit(value); return found;
}
function attribute(node: Element, name: string): string {
  const value = node.attributes.find((item) => item.type === 'Attribute' && item.name === name);
  return value?.type === 'Attribute' && Array.isArray(value.value) ? value.value.filter((part) => part.type === 'Text').map((part) => part.data).join('') : '';
}
function load(source: string, can = vi.fn(async()=>true)) {
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{} as Record<string,unknown>};
  new Function('exports','require','module',compiled)(module.exports,(name:string)=>{
    if(name==='@sveltejs/kit')return{error,redirect};
    if(name==='$lib/shared/permissions/access.server.js')return{capabilityAccess:{can},resolveCapabilityInput:()=>({principal:{kind:'user',modelId:1},scope:{platform:true}})};
    throw new Error('Unexpected redirect template import: '+name);
  },module);
  return {can,run:module.exports.load as (event:{locals:{user:unknown};url:URL})=>Promise<unknown>};
}
const consoleUi=new MakeDashboardCommand().files({public:false,resource:'operations',scope:'platform',route:'/admin/dashboard'},'$lib/shared/permissions/access.server.js').find(file=>file.path.endsWith('admin/dashboard/+page.svelte'))!.content;

describe('Legacy admin redirects and operational shell bounds',()=>{
  describe.each<ValidationProvider>(['zod','valibot'])('compiler contract (%s)',provider=>{
    it.each(['client','server'] as const)('compiles the thin legacy shell and operational console for %s',generate=>{
      for(const source of [T.adminLayoutSvelte(),T.adminPageSvelte(),consoleUi]) {
        const result=compile(T.applyValidationProvider(source,provider),{generate,filename:'admin-page.svelte'});
        expect(result.js.code.length).toBeGreaterThan(0);expect(result.warnings.filter(item=>item.code.startsWith('a11y'))).toEqual([]);
      }
    });
  });
  it('removes the nested admin shell, stale CRUD actions and guessed health counters',()=>{
    const layout=T.adminLayoutSvelte();expect(layout).toContain('{@render children()}');expect(elements(parse(layout,{modern:true}).fragment)).toEqual([]);
    for(const source of [T.adminLayoutServer(),T.adminPageServer(),T.adminPageSvelte()]) {
      expect(source).not.toContain("role: 'admin'");expect(source).not.toContain('User.query');expect(source).not.toContain('export const actions');
      expect(source).not.toContain('superValidate');expect(source).not.toContain("status: 'ok'");
    }
  });
  it('keeps the actual console shell responsive with active URL navigation and bounded scroll surfaces',()=>{
    expect(consoleUi).toContain('grid-template-columns:216px minmax(0,1fr)');expect(consoleUi).toContain('@media(max-width:760px)');
    expect(consoleUi).toContain('minmax(0,1fr)');expect(consoleUi).toContain('overflow-wrap:anywhere');expect(consoleUi).toContain('overflow-x:auto');
    const nodes=elements(parse(consoleUi,{modern:true}).fragment);
    for(const label of ['User directory','Permission roles','Queue jobs','Scheduler tasks']) {
      const region=nodes.find(node=>attribute(node,'aria-label')===label)!;expect(region).toBeTruthy();expect(attribute(region,'role')).toBe('region');
      expect(region.attributes.some(item=>item.type==='UseDirective'&&item.name==='focusableScrollRegion')).toBe(true);
    }
    expect(consoleUi).toContain('aria-current=');expect(consoleUi).toContain('class:collapsed={sidebarCollapsed}');
  });
  it.each([['queue','queues'],['jobs','queues'],['roles','permissions'],['schedule','scheduler'],['tasks','scheduler'],['scheduler','scheduler'],['logs','logs']])('redirects legacy tab %s to %s without losing scope/pagination',async(before,after)=>{
    const {run,can}=load(T.adminPageServer());
    await expect(run({locals:{user:{id:1,role:'operator'}},url:new URL('http://localhost/admin?tab='+before+'&queue=imports&connection=secondary&status=failed&offset=25&tenantId=tenant')})).rejects.toMatchObject({status:302,location:'/admin/dashboard?tab='+after+'&queue=imports&connection=secondary&status=failed&offset=25&tenantId=tenant'});
    expect(can).toHaveBeenCalledWith('screen.operations.view',expect.anything());
  });
  it.each([T.adminLayoutServer(),T.adminPageServer()])('checks authentication before capabilities and rejects unauthorized direct loads',async(source)=>{
    const can=vi.fn(async()=>false);const {run}=load(source,can);
    await expect(run({locals:{user:null},url:new URL('http://localhost/admin')})).rejects.toMatchObject({status:302,location:'/login'});expect(can).not.toHaveBeenCalled();
    await expect(run({locals:{user:{id:1,role:'admin'}},url:new URL('http://localhost/admin')})).rejects.toMatchObject({status:403});
  });
  it('allows a capability-authorized non-admin operator through the layout',async()=>{
    const {run}=load(T.adminLayoutServer());expect(await run({locals:{user:{id:1,role:'operator'}},url:new URL('http://localhost/admin/dashboard')})).toEqual({});
  });
});
