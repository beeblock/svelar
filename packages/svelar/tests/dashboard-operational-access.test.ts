import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { zod4Client } from 'sveltekit-superforms/adapters';
import { DashboardController, configureDashboard, DashboardOperationError, type DashboardProviders, type DashboardUserAccess } from '../src/dashboard/index.js';
import { dashboardRoleCreateSchema, dashboardUserRoleSchema } from '../src/dashboard/schemas.js';
import { createRequestEvent } from '../src/testing/request.js';
import { Audit } from '../src/audit/index.js';
import { Log } from '../src/logging/index.js';
import type { DashboardRole } from '../src/dashboard/providers.js';
import type { PermissionManifestDefinition } from '../src/permissions/PermissionManifest.js';

const definition: PermissionManifestDefinition = {
  screens: [{resource:'items',label:'Items',group:'Work',route:'/items',scope:'team' as const},
    {resource:'platform',label:'Platform',group:'System',route:'/platform',scope:'platform' as const}],
  actions: [{screen:'items',action:'edit',label:'Edit'}],
  aliases: [{name:'legacy-items',label:'Legacy',capabilities:['screen.items.view']}],
};
const role: DashboardRole = {id:3,name:'editor',label:'Editor',guard:'web',protected:false};
let snapshot: DashboardUserAccess;
let foundRole: DashboardRole | null;
const list = vi.fn(async()=>({items:[],total:0,hasMore:false,scope:'shared' as const}));
const access = vi.fn(async()=>snapshot);
const assign = vi.fn(async()=>{}); const detach = vi.fn(async()=>{});
const grant = vi.fn(async()=>{}); const revoke = vi.fn(async()=>{});
const create = vi.fn(async()=>role); const getRole = vi.fn(async()=>foundRole);
const providers = (): DashboardProviders => ({users:{list,access,assignRole:assign,detachRole:detach,grantCapability:grant,revokeCapability:revoke,
  delete:async()=>{},resetPassword:async()=>({queued:true})},permissions:{roles:list,manifest:async()=>definition,createRole:create,getRole}});
function request(method='GET',body?:unknown,id='17',csrf=true,actor:unknown={id:4}) {
  return createRequestEvent({url:'http://localhost/api/admin/users/'+id+'/access?scope=team&teamId=A',method,body,params:{id},locals:{user:actor},
    headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(csrf?{Cookie:'XSRF-TOKEN=csrf','X-CSRF-Token':'csrf'}:{})}});
}
const invoke=(operation:string,method='POST',body:unknown={scope:'team',teamId:'A',roleId:3,confirmed:true},id='17',csrf=true,actor?:unknown)=>
  new DashboardController().handle(operation)(request(method,body,id,csrf,actor));
beforeEach(()=>{
  vi.clearAllMocks(); snapshot={id:'17',scope:'team',teamId:'A',protected:false,roles:[role],directCapabilities:['screen.items.view','legacy-items','retired.name']}; foundRole={...role};
  configureDashboard({enabled:true,refreshInterval:0,authorize:()=>true,providers:providers()});
  vi.spyOn(Audit,'log').mockResolvedValue(); vi.spyOn(Log,'error').mockResolvedValue();
});
afterEach(()=>{configureDashboard({enabled:false,providers:{}});vi.restoreAllMocks();});

describe('guarded scoped console access',()=>{
  it('checks authentication, operation authorization and CSRF before any callback/audit',async()=>{
    expect((await invoke('assignRole','POST',undefined,'17',true,null)).status).toBe(403);
    expect((await invoke('assignRole','POST',{},'17',false)).status).toBe(419);
    configureDashboard({authorize:(_event,operation)=>operation!=='assignRole'&&operation!=='userAccess'});
    expect((await invoke('assignRole')).status).toBe(403);
    expect((await invoke('userAccess','GET',undefined)).status).toBe(403);
    expect(access).not.toHaveBeenCalled();expect(assign).not.toHaveBeenCalled();expect(Audit.log).not.toHaveBeenCalled();
  });
  it('separates configured availability from per-operation permission',async()=>{
    configureDashboard({authorize:(_event,operation)=>operation!=='createRole'});
    const body=await (await invoke('console','GET',undefined)).json();expect(body.data.available.createRole).toBe(true);expect(body.data.access.createRole).toBe(false);
    configureDashboard({providers:{}});
    const absent=await (await invoke('console','GET',undefined)).json();expect(absent.data.available.assignRole).toBe(false);
    expect((await invoke('userAccess','GET',undefined)).status).toBe(503);expect((await invoke('assignRole')).status).toBe(503);
  });
  it.each([{scope:'team'}, {scope:'team',teamId:null}, {scope:'platform',teamId:'A'}, {scope:'team',teamId:' '}, {scope:'team',teamId:'A',confirmed:false}])('rejects invalid scope/confirmation %j before callbacks',async scope=>{
    expect((await invoke('assignRole','POST',{roleId:3,confirmed:true,...scope})).status).toBe(422);
    expect(access).not.toHaveBeenCalled();expect(assign).not.toHaveBeenCalled();expect(Audit.log).not.toHaveBeenCalled();
  });
  it('projects only public exact scope fields and preserves finite names beyond 100 entries',async()=>{
    snapshot={...snapshot,directCapabilities:Array.from({length:150},(_,i)=>'screen.item'+i+'.view')};
    access.mockImplementationOnce(async()=>({...snapshot,password:'DO-NOT-SEND'}));
    const response=await invoke('userAccess','GET',undefined); const body=await response.json();expect(response.status).toBe(200);
    expect(body.data.directCapabilities).toHaveLength(150);expect(JSON.stringify(body)).not.toContain('DO-NOT-SEND');
    expect(access).toHaveBeenCalledWith({id:'17',scope:'team',teamId:'A'},expect.anything());
  });
  it.each(['identity','scope','team','protection','roles','names'] as const)('fails closed on malformed or unbounded snapshot %s',async kind=>{
    if(kind==='identity')snapshot.id='18'; if(kind==='scope')snapshot.scope='platform'; if(kind==='team')snapshot.teamId='B';
    if(kind==='protection')access.mockImplementationOnce(async()=>({...snapshot,protected:undefined}) as unknown as DashboardUserAccess);
    if(kind==='roles')snapshot.roles=Array.from({length:101},()=>role);
    if(kind==='names')snapshot.directCapabilities=Array.from({length:10_001},()=> 'screen.items.view');
    expect((await invoke('assignRole')).status).toBe(503);expect(assign).not.toHaveBeenCalled();
  });
  it.each(['4','004'])('rejects self identity %s even when numeric variants resolve to same user',async id=>{
    snapshot.id='4';expect((await invoke('assignRole','POST',{scope:'team',teamId:'A',roleId:3,confirmed:true},id)).status).toBe(403);expect(assign).not.toHaveBeenCalled();
  });
  it('rejects protected users and unavailable actor IDs',async()=>{
    snapshot.protected=true;expect((await invoke('assignRole')).status).toBe(403);
    snapshot.protected=false;expect((await invoke('assignRole','POST',{scope:'team',teamId:'A',roleId:3,confirmed:true},'17',true,{})).status).toBe(403);expect(assign).not.toHaveBeenCalled();
  });
  it.each(['owner','platform-owner','platform_owner','super-admin'])('rejects reserved assignment role %s',async name=>{
    foundRole={...role,name};expect((await invoke('assignRole')).status).toBe(403);expect((await invoke('detachRole','DELETE')).status).toBe(403);expect(assign).not.toHaveBeenCalled();expect(detach).not.toHaveBeenCalled();
  });
  it.each(['missing','protected','guard','different'] as const)('rejects role observation %s without paginated role scanning',async kind=>{
    if(kind==='missing')foundRole=null;if(kind==='protected')foundRole={...role,protected:true};if(kind==='guard')foundRole={...role,guard:'api'};if(kind==='different')foundRole={...role,id:99};
    expect((await invoke('assignRole')).status).toBe(kind==='missing'?404:kind==='different'?503:403);expect(list).not.toHaveBeenCalled();expect(assign).not.toHaveBeenCalled();
  });
  it('route identity overrides body; writes exact tenant scope and audits intent/completion',async()=>{
    const response=await invoke('assignRole','POST',{id:'4',scope:'team',teamId:'A',roleId:3,confirmed:true});expect(response.status).toBe(200);
    expect(assign).toHaveBeenCalledWith({id:'17',scope:'team',teamId:'A',roleId:3,confirmed:true},expect.anything());
    expect(Audit.log).toHaveBeenNthCalledWith(1,expect.objectContaining({action:'dashboard.assignRole.requested',modelId:'17',metadata:{scope:'team',teamId:'A',roleId:3}}));
    expect(Audit.log).toHaveBeenNthCalledWith(2,expect.objectContaining({action:'dashboard.assignRole.completed'}));
    expect(vi.mocked(Audit.log).mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0]);
    expect((await invoke('detachRole','DELETE')).status).toBe(200);expect(detach).toHaveBeenCalledTimes(1);
  });
  it.each(['unknown','*','legacy-items','screen.platform.view'])('does not grant unknown/alias/wildcard/foreign capability %s',async capability=>{
    expect((await invoke('grantCapability','POST',{scope:'team',teamId:'A',capability,confirmed:true})).status).toBe(422);expect(grant).not.toHaveBeenCalled();
  });
  it('grants canonical scope names without auto-expanding dependencies; permits stale direct revocation only when present',async()=>{
    expect((await invoke('grantCapability','POST',{scope:'team',teamId:'A',capability:'action.items.edit',confirmed:true})).status).toBe(200);
    expect(grant).toHaveBeenCalledWith({id:'17',scope:'team',teamId:'A',capability:'action.items.edit',confirmed:true},expect.anything());
    expect((await invoke('revokeCapability','DELETE',{scope:'team',teamId:'A',capability:'retired.name',confirmed:true})).status).toBe(200);
    expect((await invoke('revokeCapability','DELETE',{scope:'team',teamId:'A',capability:'missing',confirmed:true})).status).toBe(404);expect(revoke).toHaveBeenCalledTimes(1);
  });
  it('propagates provider denial/storage failure and blocks writes when intent audit fails',async()=>{
    assign.mockRejectedValueOnce(new DashboardOperationError(403,'Membership denied.'));expect((await invoke('assignRole')).status).toBe(403);
    vi.mocked(Audit.log).mockRejectedValueOnce(new Error('audit down'));expect((await invoke('assignRole')).status).toBe(503);expect(assign).toHaveBeenCalledTimes(1);
    assign.mockRejectedValueOnce(new Error('secret=DO-NOT-SEND'));const response=await invoke('assignRole');expect(response.status).toBe(503);expect(await response.text()).not.toContain('DO-NOT-SEND');
  });
  it.each(['owner','platform-owner','super_admin'])('shared server/client validation rejects reserved role creation %s',async name=>{
    const input={scope:'team',teamId:'A',name,label:'Owner',confirmed:true};expect((await zod4Client(dashboardRoleCreateSchema).validate(input)).success).toBe(false);
    expect((await invoke('createRole','POST',input)).status).toBe(422);expect(create).not.toHaveBeenCalled();
  });
  it('creates an empty scoped role through the provider, never automatically assigns one',async()=>{
    const response=await invoke('createRole','POST',{scope:'team',teamId:'A',name:'editor',label:'Editor',confirmed:true});expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith({scope:'team',teamId:'A',name:'editor',label:'Editor',confirmed:true},expect.anything());expect(assign).not.toHaveBeenCalled();
    expect((await response.json()).meta.message).toContain('empty permission profile');
  });
  it('uses identical coerce/validation semantics on browser and server schemas',async()=>{
    const input={id:'17',scope:'team',teamId:'A',roleId:'3',confirmed:true};const client=await zod4Client(dashboardUserRoleSchema).validate(input);
    expect(client).toEqual({success:true,data:dashboardUserRoleSchema.parse(input)});
  });
  it('bundles the actual public shared-schema path for a browser without server imports',async()=>{
    const output=await build({stdin:{contents:"export * from '@beeblock/svelar/dashboard/schemas';",loader:'ts',resolveDir:process.cwd()},
      alias:{'@beeblock/svelar/dashboard/schemas':new URL('../src/dashboard/schemas.ts',import.meta.url).pathname},bundle:true,write:false,platform:'browser',format:'esm',logLevel:'silent',metafile:true});
    expect(output.outputFiles[0].text).not.toContain('node:');expect(Object.keys(output.metafile!.inputs).some(name=>name.includes('PermissionAssignments')||name.includes('DashboardService'))).toBe(false);
  });
});
