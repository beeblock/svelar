import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

type Runtime = typeof import('../src/dashboard/index.js') & typeof import('../src/database/index.js') & typeof import('../src/queue/index.js') & typeof import('../src/testing/index.js');
let root: string | undefined; let app: Runtime | undefined;
afterEach(async()=>{await app?.Queue.stop(); await app?.Connection.disconnect();app?.configureDashboard({enabled:false,providers:{}});if(root)rmSync(root,{recursive:true,force:true});});
it('bundles actual public subpaths and operates colliding named SQLite queue IDs without cross-connection mutation',async()=>{
  root=mkdtempSync(join(process.cwd(),'.test-dashboard-operational-'));
  const output=join(root,'proof.mjs');
  await build({stdin:{contents:"export * from '@beeblock/svelar/dashboard';\nexport * from '@beeblock/svelar/database';\nexport {Queue,Job} from '@beeblock/svelar/queue';\nexport {createRequestEvent} from '@beeblock/svelar/testing';",loader:'ts',resolveDir:root},
    outfile:output,alias:{'@beeblock/svelar':resolve('src')},bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',keepNames:true,logLevel:'silent'});
  const framework: Runtime=await import(pathToFileURL(output).href);app=framework;
  await framework.Connection.disconnect();framework.Connection.configure({default:'primary',connections:{primary:{driver:'sqlite',filename:':memory:'},secondary:{driver:'sqlite',filename:':memory:'}}});
  for(const connection of ['primary','secondary']) await framework.Connection.usingConnection(connection,async()=>{
    for(const Migration of [framework.CreateSvelarJobsTable,framework.CreateSvelarFailedJobsTable,framework.AddQueueJobLeases,framework.AddFailedQueueReplay,framework.CreateQueueEventsTable])await new Migration().up();
  });
  framework.Queue.configure({default:'primary',connections:{primary:{driver:'database',databaseConnection:'primary',queue:'imports'},secondary:{driver:'database',databaseConnection:'secondary',queue:'imports'}},queues:[{name:'imports',connection:'primary'},{name:'imports',connection:'secondary'}]});
  class ProofJob extends framework.Job { async handle():Promise<void>{} }
  framework.Queue.register(ProofJob,{name:'ProofJob',label:'Operational proof'});
  await framework.Queue.dispatch(new ProofJob(),{connection:'primary',queue:'imports',jobId:'17',metadata:{tenantId:'primary-tenant',resourceId:'resource',secret:'DO-NOT-SEND'}});
  await framework.Queue.dispatch(new ProofJob(),{connection:'secondary',queue:'imports',jobId:'17',metadata:{tenantId:'secondary-tenant',resourceId:'resource',secret:'DO-NOT-SEND'}});
  framework.configureDashboard({enabled:true,refreshInterval:0,authorize:()=>true,providers:{}});
  const controller=new framework.DashboardController();
  const event=(path:string,method='GET',body?:unknown)=>framework.createRequestEvent({url:'http://localhost'+path,method,body,headers:{Cookie:'XSRF-TOKEN=csrf','X-CSRF-Token':'csrf'},params:{id:'17'},locals:{user:{id:1}}});
  const filtered=await controller.handle('queue')(event('/api/admin/queue?queue=imports&connection=secondary&status=waiting&tenantId=secondary-tenant&resourceId=resource'));
  expect(filtered.status).toBe(200);const page=await filtered.json();expect(page.data.jobs).toHaveLength(1);expect(page.data.jobs[0].connection).toBe('secondary');expect(JSON.stringify(page)).not.toContain('DO-NOT-SEND');
  const runtime=await framework.Queue.adapter('imports','secondary').runtime();expect(runtime.workers).toBeNull();expect(runtime.effectiveConcurrency).toBeNull();
  const removed=await controller.handle('deleteJob')(event('/api/admin/queue/17?queue=imports&connection=secondary','DELETE',{confirmed:true,connection:'primary'}));expect(removed.status).toBe(200);
  expect(await framework.Queue.adapter('imports','secondary').get('17')).toBeNull();expect(await framework.Queue.adapter('imports','primary').get('17')).not.toBeNull();
  const missing=await controller.handle('job')(event('/api/admin/queue/17?queue=imports&connection=secondary'));expect(missing.status).toBe(404);
},30_000);
