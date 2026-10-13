import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardController, configureDashboard } from '../src/dashboard/index.js';
import { Queue, type QueueMonitoringAdapter, type QueueJobSnapshot, type QueueJobFilter, type QueueJobReference } from '../src/queue/index.js';
import { ScheduleMonitor } from '../src/scheduler/ScheduleMonitor.js';
import { Features } from '../src/feature-flags/index.js';
import { Audit } from '../src/audit/index.js';
import { Log } from '../src/logging/index.js';
import { createRequestEvent } from '../src/testing/request.js';
import type { RequestEvent } from '../src/routing/Controller.js';
import { DashboardService } from '../src/dashboard/DashboardService.js';
import { dashboardProviders } from '../src/dashboard/providers.js';

const counts = { waiting: 1, active: 2, failed: 3, completed: 4, delayed: 5, deadLetter: 6 };
const runtime = { paused: null, workers: null, globalConcurrency: null, observedConcurrency: null, effectiveConcurrency: null,
  oldestWaitingAt: null, lag: null, stalled: null, expiredLocks: null, locksComplete: false, coverage: 'instrumented' as const };
const job: QueueJobSnapshot = { id: '17', connection: 'secondary', queue: 'imports', jobClass: 'ImportJob', status: 'failed', attempts: 3, maxAttempts: 3, stalledCount: 1, createdAt: 1000,
  payload: JSON.stringify({ password: 'DO-NOT-SEND', name: 'Visible' }), metadata: { resourceId: '17', access_token: 'DO-NOT-SEND' }, error: 'Bearer DO-NOT-SEND\n at handler.ts:12',
  lock: { source: 'unavailable', state: 'unknown', expiresAt: null, owner: null } };
function adapter(): QueueMonitoringAdapter {
  return { connection: 'secondary', queue: 'imports', driver: 'redis', capabilities: {shared:true,indexedMetadata:true,durableReplay:true,pause:true},
    counts: vi.fn(async()=>counts), runtime: vi.fn(async()=>runtime), metrics: vi.fn(async()=>({source:'redis' as const,completed:10,failed:2,completedPerMinute:[1],failedPerMinute:[0],minutes:60})),
    list: vi.fn(async(filter?: QueueJobFilter)=>({items:[job],offset:filter?.offset??0,limit:filter?.limit??25,indexedCount:9,coverage:'instrumented' as const})), get: vi.fn(async()=>job),
    deadLetter: vi.fn(async()=>({id:'dlq',connection:'secondary',queue:'imports',jobClass:'ImportJob',payload:job.payload,exception:job.error!,failedAt:3,metadata:job.metadata})),
    deadLetters: vi.fn(async()=>[]), timeline: vi.fn(async()=>[{id:'event',event:'failed',at:3000}]), retry:vi.fn(async(ref: QueueJobReference)=>({...ref,outcome:'accepted' as const})), remove:vi.fn(async(ref: QueueJobReference)=>({...ref,outcome:'accepted' as const})),
    retryMany:vi.fn(async(refs: readonly QueueJobReference[])=>({results:refs.map(ref=>({...ref,outcome:'accepted' as const})),failures:[]})), cleanup:vi.fn(async()=>({results:[],failures:[]})), pause:vi.fn(async()=>{}),resume:vi.fn(async()=>{}),reconcile:vi.fn(async()=>({indexed:0,complete:true})),recover:vi.fn(async()=>0) };
}
let selected: QueueMonitoringAdapter;
function event(path: string, method='GET', body?: unknown, csrf=true, user: unknown={id:4,role:'admin'}): RequestEvent {
  const headers: Record<string,string> = csrf ? {Cookie:'XSRF-TOKEN=csrf; session=valid','X-CSRF-Token':'csrf'} : {};
  if (body!==undefined) headers['Content-Type']='application/json';
  const url = new URL(path,'http://localhost');
  return createRequestEvent({url:url.href,method,headers,body,locals:{user},params:{id:'17',name:'ImportJob',requestId:'request'}});
}
const handle = (name: string, input: RequestEvent) => new DashboardController().handle(name)(input);
beforeEach(()=>{
  selected=adapter(); configureDashboard({enabled:true,refreshInterval:0,authorize:()=>true,providers:{}});
  vi.spyOn(Queue,'adapter').mockImplementation(()=>selected); vi.spyOn(Queue,'queues').mockReturnValue([{name:'imports',connection:'secondary',label:'Imports'}]);
  vi.spyOn(Audit,'log').mockResolvedValue(); vi.spyOn(Log,'error').mockResolvedValue();
});
afterEach(()=>{configureDashboard({enabled:false,providers:{}});vi.restoreAllMocks();});

describe('bounded operational dashboard',()=>{
  it('requires authentication and CSRF before accessing adapters/providers/audit',async()=>{
    expect((await handle('queue',event('/api/admin/queue','GET',undefined,true,null))).status).toBe(403);
    expect((await handle('retryJobs',event('/api/admin/queue/batch/retry','POST',{references:[{id:'17',source:'live'}],confirmed:true},false))).status).toBe(419);
    expect(Queue.adapter).not.toHaveBeenCalled();expect(Audit.log).not.toHaveBeenCalled();
  });
  it('scopes every query by connection/queue and passes indexed metadata filters with finite paging',async()=>{
    const response=await handle('queue',event('/api/admin/queue?queue=imports&connection=secondary&status=failed&tenantId=tenant&accountId=account&resourceId=17&correlationId=incident&limit=2&offset=3'));
    const body=await response.json();expect(response.status).toBe(200);expect(Queue.adapter).toHaveBeenCalledWith('imports','secondary');
    expect(selected.list).toHaveBeenCalledWith({status:'failed',limit:2,offset:3,tenantId:'tenant',accountId:'account',resourceId:'17',correlationId:'incident'});
    expect(body.meta).toMatchObject({total:9,hasMore:true,coverage:'instrumented'});expect(JSON.stringify(body)).not.toContain('DO-NOT-SEND');
  });
  it('uses indexed dead-letter lookup and bounded timeline without listing all failures',async()=>{
    const response=await handle('job',event('/api/admin/queue/17?queue=imports&connection=secondary&source=dead-letter'));
    const body=await response.json();expect(response.status).toBe(200);expect(selected.deadLetter).toHaveBeenCalledWith('17');
    expect(selected.timeline).toHaveBeenCalledWith({id:'17',source:'dead-letter'},50);expect(selected.get).not.toHaveBeenCalled();expect(selected.deadLetters).not.toHaveBeenCalled();
    expect(body.data.timeline[0].event).toBe('failed');expect(JSON.stringify(body)).not.toContain('DO-NOT-SEND');
  });
  it('uses limit+1 DLQ pagination and reports filtered total unknown instead of unfiltered counts',async()=>{
    const response=await handle('queue',event('/api/admin/queue?queue=imports&connection=secondary&status=dead-letter&limit=100&offset=10'));
    expect(selected.deadLetters).toHaveBeenCalledWith({limit:101,offset:10});expect((await response.json()).meta.total).toBeNull();
  });
  it.each([0,101,-1,1.5])('rejects invalid page size %s before querying',async(limit)=>{
    expect((await handle('queue',event('/api/admin/queue?limit='+limit))).status).toBe(422);expect(Queue.adapter).not.toHaveBeenCalled();
  });
  it('keeps scope in the URL, not the mutation body, and requires confirmation for destructive/batch/pause',async()=>{
    const refs=[{id:'17',source:'dead-letter'}];
    expect((await handle('retryJobs',event('/api/admin/queue/batch/retry?queue=imports&connection=secondary','POST',{references:refs,confirmed:true,queue:'foreign',connection:'foreign'}))).status).toBe(200);
    expect(Queue.adapter).toHaveBeenCalledWith('imports','secondary');expect(selected.retryMany).toHaveBeenCalledWith(refs);
    for(const operation of ['retryJobs','cleanupJobs','pauseQueue','deleteJob']) expect((await handle(operation,event('/api/admin/queue?queue=imports','POST',{references:refs,paused:true}))).status).toBe(422);
    expect(selected.cleanup).not.toHaveBeenCalled();expect(selected.pause).not.toHaveBeenCalled();expect(selected.remove).not.toHaveBeenCalled();
  });
  it('caps batch references at 100 and surfaces partial outcomes without claiming complete success',async()=>{
    const refs=Array.from({length:101},(_,index)=>({id:String(index),source:'live'}));
    expect((await handle('retryJobs',event('/api/admin/queue','POST',{references:refs,confirmed:true}))).status).toBe(422);
    vi.mocked(selected.retryMany).mockResolvedValue({results:[{id:'17',source:'live',outcome:'busy'}],failures:[]});
    const response=await handle('retryJobs',event('/api/admin/queue','POST',{references:[{id:'17',source:'live'}],confirmed:true}));
    const body=await response.json();expect(body.data.partial).toBe(true);expect(body.meta.message).toContain('0 accepted; 1 not accepted');
  });
  it('audit failure blocks mutations, and completion failure never tells the operator to repeat them',async()=>{
    vi.mocked(Audit.log).mockRejectedValueOnce(new Error('password=DO-NOT-SEND'));
    const request=()=>event('/api/admin/queue/17?queue=imports&connection=secondary','POST');
    const denied=await handle('retryJob',request());expect(denied.status).toBe(503);expect(selected.retry).not.toHaveBeenCalled();expect(await denied.text()).not.toContain('DO-NOT-SEND');
    vi.mocked(Audit.log).mockResolvedValueOnce().mockRejectedValueOnce(new Error('audit failed'));
    const accepted=await handle('retryJob',request());expect(accepted.status).toBe(200);expect((await accepted.json()).meta.auditWarning).toContain('Do not repeat');
  });
  it('preserves unknown runtime and bounds registry telemetry to 100 registered queues and 60 metric buckets',async()=>{
    vi.mocked(Queue.queues).mockReturnValue(Array.from({length:105},(_,index)=>({name:'queue-'+index,connection:'secondary'})));
    const result=await new DashboardService().topology();expect(result.truncated).toBe(true);expect(result.topology).toHaveLength(100);
    expect(result.topology[0].runtime?.effectiveConcurrency).toBeNull();expect(selected.metrics).toHaveBeenCalledWith(60);expect(Queue.adapter).toHaveBeenCalledTimes(100);
  });
  it('does not ask volatile adapters for manufactured shared metrics',async()=>{
    selected={...selected,driver:'memory',capabilities:{shared:false,indexedMetadata:false,durableReplay:false,pause:false}};
    const result=await new DashboardService().topology();expect(result.topology[0].counts).toBeNull();expect(selected.counts).not.toHaveBeenCalled();
    expect((await handle('queue',event('/api/admin/queue'))).status).toBe(503);
  });
  it('requests persistent scheduler execution and never calls runTask in the web process',async()=>{
    vi.spyOn(ScheduleMonitor,'getTask').mockResolvedValue({name:'ImportJob',expression:'* * * * *',humanReadable:'Every minute',nextRun:null,enabled:true,isRunning:false,history:[]});
    const run=vi.spyOn(ScheduleMonitor,'runTask');const enqueue=vi.spyOn(ScheduleMonitor,'requestRun').mockResolvedValue({id:'request',task:'ImportJob',tenantId:null,state:'pending',requestedAt:new Date(),requestedBy:'4',owner:null,leaseUntil:null,attempts:0,result:null,error:null});
    const response=await handle('runTask',event('/api/admin/scheduler/ImportJob/run','POST'));expect(response.status).toBe(200);const body=await response.json();expect(body.data.queued).toBe(true);expect(body.data.data.state).toBe('pending');expect(enqueue).toHaveBeenCalledWith('ImportJob');expect(run).not.toHaveBeenCalled();
  });
  it('fails closed for absent providers and checks per-operation authorization before user reads',async()=>{
    expect((await handle('users',event('/api/admin/users'))).status).toBe(503);
    const list=vi.fn(async()=>({items:[],total:null,hasMore:false,scope:'unknown' as const}));
    configureDashboard({providers:{users:{list,delete:vi.fn(),resetPassword:vi.fn()}},authorize:(_event,operation)=>operation!=='users'});
    expect((await handle('users',event('/api/admin/users'))).status).toBe(403);expect(list).not.toHaveBeenCalled();
  });
  it('projects only typed user fields and rejects oversized provider pages',async()=>{
    const list=vi.fn(async()=>({items:[{id:1,name:'Safe',email:'safe@test',globalRole:null,protected:true,canResetPassword:false,canDelete:false,password:'DO-NOT-SEND'}],total:1,hasMore:false,scope:'shared' as const}));
    configureDashboard({providers:{users:{list,delete:vi.fn(),resetPassword:vi.fn(async()=>({queued:true}))}}});
    expect(await (await handle('users',event('/api/admin/users'))).text()).not.toContain('DO-NOT-SEND');
    list.mockResolvedValue({items:Array.from({length:26},()=>({id:1,name:'Safe',email:'safe@test',globalRole:null,protected:true,canResetPassword:false,canDelete:false,password:'DO-NOT-SEND'})),total:26,hasMore:false,scope:'shared'});
    expect((await handle('users',event('/api/admin/users'))).status).toBe(503);
  });
  it('uses only registered feature names and audits explicit boolean updates',async()=>{
    const all=vi.spyOn(Features,'allFlags');vi.spyOn(Features,'getFlag').mockResolvedValue({id:'f',name:'ImportJob',description:'Import integration',enabled:true,percentage:null,createdAt:0,updatedAt:1});
    const update=vi.spyOn(Features,'updateFlag').mockResolvedValue({id:'f',name:'ImportJob',description:'Import integration',enabled:false,percentage:null,createdAt:0,updatedAt:2});
    configureDashboard({providers:{features:{names:['ImportJob'],scope:'shared'}}});expect((await handle('features',event('/api/admin/features'))).status).toBe(200);expect(all).not.toHaveBeenCalled();
    expect((await handle('toggleFeature',event('/api/admin/features/ImportJob','PUT',{enabled:false,confirmed:true}))).status).toBe(200);expect(update).toHaveBeenCalledWith('ImportJob',{enabled:false});
    expect(Audit.log).toHaveBeenCalledWith(expect.objectContaining({action:'dashboard.toggleFeature.completed'}));
    dashboardProviders.current={};expect((await handle('toggleFeature',event('/api/admin/features/ImportJob','PUT',{enabled:false,confirmed:true}))).status).toBe(404);
  });
  it('keeps the full validated capability graph and rejects unknown, wrong-scope and unconfirmed profile grants',async()=>{
    const manifest={screens:[{resource:'imports',label:'Imports',group:'Work',route:'/imports',scope:'team' as const},{resource:'platform',label:'Platform',group:'System',route:'/platform',scope:'platform' as const}],actions:Array.from({length:150},(_,index)=>({screen:'imports',action:'op'+index,label:'Operation '+index}))};
    const save=vi.fn(async()=>{});
    configureDashboard({providers:{permissions:{roles:async()=>({items:[],total:0,hasMore:false,scope:'shared'}),manifest:async()=>manifest,saveProfile:save,profile:async()=>({profile:null,selected:[],staleCapabilities:[]})}}});
    const catalog=await handle('permissions',event('/api/admin/permissions'));expect((await catalog.json()).data.catalog).toHaveLength(152);
    const update=(input:Record<string,unknown>)=>handle('saveProfile',event('/api/admin/permissions/roles/17/profile','PUT',{kind:'custom',scope:'team',teamId:'tenant',capabilities:['screen.imports.view'],confirmed:true,...input}));
    expect((await update({confirmed:false})).status).toBe(422);expect((await update({capabilities:['unknown']})).status).toBe(422);expect((await update({capabilities:['screen.platform.view']})).status).toBe(422);expect(save).not.toHaveBeenCalled();
    expect((await update({roleId:99})).status).toBe(200);expect(save).toHaveBeenCalledWith(expect.objectContaining({roleId:17,teamId:'tenant',capabilities:['screen.imports.view']}),expect.anything());
  });
});
