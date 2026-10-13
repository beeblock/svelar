import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

type Runtime = typeof import('../src/dashboard/index.js') & typeof import('../src/database/index.js')
  & typeof import('../src/permissions/index.js') & typeof import('../src/orm/index.js') & typeof import('../src/testing/index.js');
it('public console mutations persist only the selected SQLite assignment scope and preserve capability dependencies',async()=>{
  const root=mkdtempSync(join(process.cwd(),'.test-dashboard-access-')); let framework:Runtime|undefined;
  try {
    const output=join(root,'proof.mjs');
    await build({stdin:{contents:"export * from '@beeblock/svelar/dashboard';\nexport * from '@beeblock/svelar/database';\nexport * from '@beeblock/svelar/permissions';\nexport {QueryBuilder} from '@beeblock/svelar/orm';\nexport {createRequestEvent} from '@beeblock/svelar/testing';",loader:'ts',resolveDir:root},
      outfile:output,alias:{'@beeblock/svelar':resolve('src')},bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',keepNames:true,logLevel:'silent'});
    const app:Runtime=await import(pathToFileURL(output).href);framework=app;
    await app.Connection.disconnect();app.Connection.configure({default:'sqlite',connections:{sqlite:{driver:'sqlite',filename:':memory:'}}});
    for(const Migration of [app.CreateTeamsTable,app.CreateRolesTable,app.CreatePermissionsTable,app.CreateRoleHasPermissionsTable,
      app.CreateModelHasRolesTable,app.CreateModelHasPermissionsTable,app.CreateTeamRoleHasPermissionsTable,
      app.CreateTeamModelHasRolesTable,app.CreateTeamModelHasPermissionsTable,app.CreateRoleCapabilityProfilesTable,app.CreateTeamRoleCapabilityProfilesTable])await new Migration().up();
    for(const id of ['A','B'])await new app.QueryBuilder('teams').insert({id,name:id,slug:id,owner_id:'1',personal_team:false,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    const definition={screens:[{resource:'items',label:'Items',group:'Work',route:'/items',scope:'team' as const},{resource:'system',label:'System',group:'Ops',route:'/system',scope:'platform' as const}],actions:[{screen:'items',action:'edit',label:'Edit'}]};
    const manifest=new app.PermissionManifest(definition);app.Permissions.registerManifest(manifest);await app.Permissions.syncCapabilities();
    const profiles=new app.PermissionProfiles(manifest);
    const editor=await app.Permissions.createRole({name:'editor'});await profiles.forTeam('A').setCustom(editor.id,['screen.items.view']);await profiles.forTeam('B').setCustom(editor.id,[]);
    await app.Permissions.forTeam('B').assignRole('User',17,editor.id);
    const assignments=(input:{scope:'team'|'platform';teamId?:string})=>input.scope==='team'?app.Permissions.forTeam(input.teamId!):app.Permissions.global();
    const roleResource=(record:{id:number;name:string;guard:string;description?:string})=>({id:record.id,name:record.name,label:record.description??record.name,guard:record.guard,protected:false});
    app.configureDashboard({enabled:true,refreshInterval:0,authorize:()=>true,providers:{
      users:{list:async()=>({items:[],total:0,hasMore:false,scope:'shared'}),delete:async()=>{},resetPassword:async()=>({queued:true}),
        access:async(input)=>({...input,protected:false,roles:(await assignments(input).getModelRoles('User',Number(input.id))).map(roleResource),directCapabilities:(await assignments(input).getModelDirectPermissions('User',Number(input.id))).map(record=>record.name)}),
        assignRole:async(input)=>{await assignments(input).assignRole('User',Number(input.id),input.roleId);},
        detachRole:async(input)=>{await assignments(input).removeRole('User',Number(input.id),input.roleId);},
        grantCapability:async(input)=>{const permission=await app.Permissions.findPermission(input.capability,manifest.guard);if(!permission)throw new Error('Unseeded capability');await assignments(input).giveModelPermission('User',Number(input.id),permission.id);},
        revokeCapability:async(input)=>{const permission=await app.Permissions.findPermission(input.capability,manifest.guard);if(!permission)throw new Error('Unseeded capability');await assignments(input).revokeModelPermission('User',Number(input.id),permission.id);},
      },permissions:{manifest:async()=>definition,roles:async()=>({items:[],total:0,hasMore:false,scope:'shared'}),
        getRole:async(id)=>{const record=await app.Permissions.findRoleById(id);return record?roleResource(record):null;},
        createRole:async(input)=>app.Connection.transaction(async()=>{const created=await app.Permissions.createRole({name:input.name,description:input.label,guard:manifest.guard});await (input.scope==='team'?profiles.forTeam(input.teamId!):profiles.forPlatform()).setCustom(created.id,[]);return roleResource(created);}),
      },
    }});
    const controller=new app.DashboardController();
    const call=(operation:string,method:string,body:unknown)=>controller.handle(operation)(app.createRequestEvent({url:'http://localhost/api/admin/users/17/roles',params:{id:'17'},method,body,locals:{user:{id:4}},headers:{Cookie:'XSRF-TOKEN=csrf','X-CSRF-Token':'csrf','Content-Type':'application/json'}}));
    expect((await call('assignRole','POST',{scope:'team',teamId:'A',roleId:editor.id,confirmed:true})).status).toBe(200);
    expect(await app.Permissions.forTeam('A').modelHasRole('User',17,'editor')).toBe(true);
    expect(await app.Permissions.forTeam('B').modelHasRole('User',17,'editor')).toBe(true);
    expect(await app.Permissions.global().getModelRoles('User',17)).toEqual([]);
    const authorizer=new app.CapabilityAuthorizer(manifest);
    const context=(teamId:string)=>({principal:{kind:'user' as const,modelType:'User',modelId:17},scope:{teamId},context:{}});
    expect(await authorizer.can('action.items.edit',context('A'))).toBe(false);
    expect((await call('grantCapability','POST',{scope:'team',teamId:'A',capability:'action.items.edit',confirmed:true})).status).toBe(200);
    expect(await authorizer.can('action.items.edit',context('A'))).toBe(true);expect(await authorizer.can('action.items.edit',context('B'))).toBe(false);
    expect(await app.Permissions.global().getModelDirectPermissions('User',17)).toEqual([]);
    expect((await call('detachRole','DELETE',{scope:'team',teamId:'A',roleId:editor.id,confirmed:true})).status).toBe(200);
    expect(await authorizer.can('action.items.edit',context('A'))).toBe(false);expect(await app.Permissions.forTeam('B').modelHasRole('User',17,'editor')).toBe(true);
    expect((await call('revokeCapability','DELETE',{scope:'team',teamId:'A',capability:'action.items.edit',confirmed:true})).status).toBe(200);
    expect(await app.Permissions.forTeam('A').getModelDirectPermissions('User',17)).toEqual([]);
    const response=await call('createRole','POST',{scope:'team',teamId:'A',name:'new-reader',label:'New reader',confirmed:true});expect(response.status).toBe(200);
    const created=(await response.json()).data.data;
    expect(await profiles.forTeam('A').get(created.id)).toMatchObject({kind:'custom',capabilities:[]});expect(await profiles.forTeam('B').get(created.id)).toBeNull();
    expect(await app.Permissions.forTeam('A').getModelRoles('User',17)).toEqual([]);
  } finally {vi.restoreAllMocks();framework?.Permissions.clearCapabilities();framework?.configureDashboard({enabled:false,providers:{}});await framework?.Connection.disconnect();rmSync(root,{recursive:true,force:true});}
},30_000);
