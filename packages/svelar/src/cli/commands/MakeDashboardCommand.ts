/** Scaffold the monitor-backed administrative console. */
import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CapabilityScaffold, capabilityFlags, type CapabilityDecision } from '../CapabilityScaffold.js';
import { UiPatternTemplates } from './UiPatternTemplates.js';

const dashboardCapabilities: Readonly<Record<string, string>> = {
  health: 'health.view', stats: 'stats.view', queue: 'queue.view', job: 'queue.inspect', retryJob: 'queue.retry', deleteJob: 'queue.delete',
  scheduler: 'scheduler.view', runTask: 'scheduler.run', toggleTask: 'scheduler.toggle', logs: 'logs.view', logsTail: 'logs.tail',
  console: 'console.view', timeline: 'queue.timeline', retryJobs: 'queue.retry.batch', cleanupJobs: 'queue.cleanup', pauseQueue: 'queue.pause',
  runRequest: 'scheduler.requests.view', users: 'users.view', resetPassword: 'users.resetPassword', deleteUser: 'users.delete',
  permissions: 'permissions.view', profile: 'permissions.profile.view', saveProfile: 'permissions.profile.update', deleteRole: 'permissions.delete',
  features: 'features.view', toggleFeature: 'features.toggle',
  userAccess: 'users.access.view', createRole: 'permissions.create', assignRole: 'users.roles.assign', detachRole: 'users.roles.detach',
  grantCapability: 'users.capabilities.grant', revokeCapability: 'users.capabilities.revoke',
};

export class MakeDashboardCommand extends Command {
  name = 'make:dashboard';
  description = 'Scaffold admin dashboard routes (health, queue, scheduler, logs)';
  arguments = [];
  flags = [{ name: 'force', alias: 'f', description: 'Overwrite existing files', type: 'boolean' as const }, ...capabilityFlags];
  capabilityActions(): readonly string[] { return Object.values(dashboardCapabilities); }

  /** Shared by new, update, and make:dashboard so their operational routes cannot drift. */
  files(decision?: CapabilityDecision, accessAlias?: string): Array<{ path: string; content: string }> {
    const routes: Array<[string, Record<string, string>]> = [
      ['health', { GET: 'health' }], ['stats', { GET: 'stats' }], ['queue', { GET: 'queue' }],
      ['queue/[id]', { GET: 'job', DELETE: 'deleteJob' }], ['queue/[id]/retry', { POST: 'retryJob' }],
      ['scheduler', { GET: 'scheduler' }], ['scheduler/[name]/run', { POST: 'runTask' }],
      ['scheduler/[name]/toggle', { POST: 'toggleTask' }], ['logs', { GET: 'logs' }], ['logs/tail', { GET: 'logsTail' }],
      ['console', { GET: 'console' }], ['queue/[id]/timeline', { GET: 'timeline' }], ['queue/batch/retry', { POST: 'retryJobs' }],
      ['queue/batch/cleanup', { POST: 'cleanupJobs' }], ['queue/control/pause', { POST: 'pauseQueue' }],
      ['scheduler/[name]/requests/[requestId]', { GET: 'runRequest' }], ['users', { GET: 'users' }],
      ['users/[id]/reset-password', { POST: 'resetPassword' }], ['users/[id]', { DELETE: 'deleteUser' }],
      ['permissions', { GET: 'permissions' }], ['permissions/roles/[id]/profile', { GET: 'profile', PUT: 'saveProfile' }],
      ['permissions/roles/[id]', { DELETE: 'deleteRole' }], ['features', { GET: 'features' }], ['features/[name]', { PUT: 'toggleFeature' }],
      ['users/[id]/access', { GET: 'userAccess' }], ['users/[id]/roles', { POST: 'assignRole', DELETE: 'detachRole' }],
      ['users/[id]/capabilities', { POST: 'grantCapability', DELETE: 'revokeCapability' }], ['permissions/roles', { POST: 'createRole' }],
    ];
    const files = routes.map(([path, handlers]) => ({
      path: `src/routes/api/admin/${path}/+server.ts`,
      content: `${decision?.public ? '// svelar:public - functional RBAC exemption only; DashboardController authorization and CSRF remain.\n' : ''}import { DashboardController } from '@beeblock/svelar/dashboard';\n${decision && !decision.public ? `import { capabilityAccess, resolveCapabilityInput } from '${accessAlias}';\n` : ''}\nconst controller = new DashboardController();\n${Object.entries(handlers).map(([method, handler]) => `export const ${method} = ${decision && !decision.public ? `capabilityAccess.guardEndpoint('action.${decision.resource}.${dashboardCapabilities[handler]}', controller.handle('${handler}'), resolveCapabilityInput)` : `controller.handle('${handler}')`};`).join('\n')}\n`,
    }));
    files.push(
      { path: 'src/routes/admin/dashboard/+page.server.ts', content: this.dashboardPageServerTemplate(decision, accessAlias) },
      { path: 'src/routes/admin/dashboard/+page.svelte', content: this.dashboardPageSvelteTemplate(accessAlias?.includes('/shared/') ?? this.isDDD()) },
      ...UiPatternTemplates.files(['capability-editor'], accessAlias?.includes('/shared/') ?? this.isDDD()),
    );
    return files;
  }

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    this.generatorName(undefined, flags);
    const decision = CapabilityScaffold.decision(flags, { route: '/admin/dashboard', scope: 'platform' });
    if (!decision.public && (decision.scope !== 'platform' || decision.route !== '/admin/dashboard')) throw new Error('The global dashboard requires platform scope and its fixed /admin/dashboard screen route.');
    const plan = CapabilityScaffold.prepare('admin', 'Admin Dashboard', decision, Object.values(dashboardCapabilities));
    const files = this.files(decision, plan.accessAlias);
    for (const file of files) {
      const path = this.containedPath(process.cwd(), file.path);
      if (!decision.public && !flags.force && existsSync(path) && readFileSync(path, 'utf8') !== file.content) throw new Error('Existing dashboard differs from the protected scaffold. Review the diff before using --force.');
    }
    let created = 0;
    let skipped = 0;
    for (const file of files) {
      const path = this.containedPath(process.cwd(), file.path);
      if (existsSync(path) && !flags.force) {
        this.warn(`${file.path} already exists (use --force to overwrite)`);
        skipped++;
        continue;
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content);
      this.success(`Created ${file.path}`);
      created++;
    }
    plan.commit();
    this.info(`${created} file(s) created, ${skipped} skipped`);
    this.info('Open /admin/dashboard. Admin authorization and CSRF are enforced by DashboardController.');
    this.info('Customize configureDashboard({ authorize: (event, operation) => ... }) in src/app.ts for your access policy.');
    this.info('Configure Queue/JobMonitor and ScheduleMonitor in src/app.ts, load the same task registry in web and scheduler, and run migrations.');
    this.info('Configure persistent Audit/LogViewer drivers and app-owned dashboard users/permissions providers.');
    this.info('Required shadcn components: ' + UiPatternTemplates.shadcnComponents(['capability-editor']).join(', ') + '.');
    if (!decision.public) this.info('Run migrations and seed:run CapabilitySeeder. Assign platform operator roles only through authorized platform provisioning.');
  }

  private dashboardPageServerTemplate(decision?: CapabilityDecision, accessAlias?: string): string {
    const protectedScreen = decision && !decision.public;
    const imports = protectedScreen ? "import { capabilityAccess, resolveCapabilityInput } from '" + accessAlias + "';\n" : '';
    const open = protectedScreen ? 'capabilityAccess.guardLayout(async (event: Parameters<PageServerLoad>[0])' : 'async (event)';
    return `${decision?.public ? '// svelar:public - functional RBAC exemption only; dashboard authorization remains.\n' : ''}${imports}import { error } from '@sveltejs/kit';
import { authorizeDashboard } from '@beeblock/svelar/dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ${open} => {
  if (!await authorizeDashboard(event)) error(403, 'Dashboard access denied.');
  const query = event.url.searchParams;
  const tabs = ['overview', 'queues', 'scheduler', 'logs', 'users', 'permissions', 'features'] as const;
  const tab = tabs.find((value) => value === query.get('tab')) ?? 'overview';
  const selection = Object.fromEntries(['queue', 'connection', 'status', 'offset', 'limit', 'tenantId', 'accountId', 'resourceId', 'correlationId', 'jobClass', 'level', 'channel', 'search', 'logOffset', 'userSearch', 'userOffset', 'roleSearch', 'roleOffset', 'job', 'source'].map((name) => [name, query.get(name) ?? '']));
  const queueQuery = new URLSearchParams({ queue: selection.queue || 'default', status: selection.status || 'failed', offset: selection.offset || '0', limit: selection.limit || '25' });
  for (const key of ['connection', 'tenantId', 'accountId', 'resourceId', 'correlationId', 'jobClass'] as const) if (selection[key]) queueQuery.set(key, selection[key]);
  const logQuery = new URLSearchParams({ limit: '25', offset: selection.logOffset || '0' });
  for (const key of ['level', 'channel', 'search', 'correlationId'] as const) if (selection[key]) logQuery.set(key, selection[key]);
  const endpoints: Record<string, string> = { console: '/api/admin/console' };
  if (tab === 'overview') { endpoints.stats = '/api/admin/stats'; endpoints.health = '/api/admin/health'; }
  if (tab === 'queues') { endpoints.stats = '/api/admin/stats'; endpoints.queue = '/api/admin/queue?' + queueQuery; }
  if (tab === 'scheduler') endpoints.scheduler = '/api/admin/scheduler';
  if (tab === 'logs') endpoints.logs = '/api/admin/logs?' + logQuery;
  if (tab === 'users') endpoints.users = '/api/admin/users?' + new URLSearchParams({ limit: '25', offset: selection.userOffset || '0', search: selection.userSearch });
  if (tab === 'permissions') endpoints.permissions = '/api/admin/permissions?' + new URLSearchParams({ limit: '25', offset: selection.roleOffset || '0', search: selection.roleSearch });
  if (tab === 'features') endpoints.features = '/api/admin/features';
  if (tab === 'queues' && selection.job) {
    const scope = new URLSearchParams({ queue: selection.queue || 'default', source: selection.source || 'live' });
    if (selection.connection) scope.set('connection', selection.connection);
    endpoints.job = '/api/admin/queue/' + encodeURIComponent(selection.job) + '?' + scope;
  }
  const panels = await Promise.all(Object.entries(endpoints).map(async ([name, url]) => {
    try {
      const response = await event.fetch(url);
      const payload = await response.json();
      if (!response.ok) return [name, { data: null, meta: payload.meta ?? {}, error: payload.meta?.message ?? 'Panel unavailable.' }] as const;
      return [name, { data: payload.data, meta: payload.meta ?? {}, error: '' }] as const;
    } catch { return [name, { data: null, meta: {}, error: 'Panel unavailable.' }] as const; }
  }));
  return { panels: Object.fromEntries(panels), selection, tab };
}${protectedScreen ? ', resolveCapabilityInput)' : ''};
`;
  }

  private dashboardPageSvelteTemplate(ddd = false): string {
    const patternAlias = ddd ? '$lib/shared/components/patterns' : '$lib/components/patterns';
    return `<script lang="ts">
  import { page } from '$app/state';
  import { goto, replaceState } from '$app/navigation';
  import { apiFetch } from '@beeblock/svelar/http';
  import CapabilityEditor from '${patternAlias}/CapabilityEditor.svelte';
  import type { ManifestCapability, ManifestAlias } from '${patternAlias}/contracts.js';
  import { focusableScrollRegion, profileSelection } from '${patternAlias}/helpers.js';
  import type { DashboardUser, DashboardRole, DashboardProfileUpdate } from '@beeblock/svelar/dashboard';
  import { dashboardRoleCreateSchema, dashboardUserAccessSchema, dashboardUserRoleSchema, dashboardUserCapabilitySchema } from '@beeblock/svelar/dashboard/schemas';
  import type { DashboardRoleCreateInput, DashboardUserRoleInput, DashboardUserCapabilityInput } from '@beeblock/svelar/dashboard/schemas';
  import type { DashboardUserAccess } from '@beeblock/svelar/dashboard';
  import { zod4Client, type ClientValidationAdapter } from 'sveltekit-superforms/adapters';
  import { superForm } from 'sveltekit-superforms/client';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Menu from '@lucide/svelte/icons/menu';
  import X from '@lucide/svelte/icons/x';
  import LogOut from '@lucide/svelte/icons/log-out';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Eye from '@lucide/svelte/icons/eye';
  import Save from '@lucide/svelte/icons/save';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import Users from '@lucide/svelte/icons/users';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import Clock3 from '@lucide/svelte/icons/clock-3';
  import Logs from '@lucide/svelte/icons/logs';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Plus from '@lucide/svelte/icons/plus';
  import UserRoundCog from '@lucide/svelte/icons/user-round-cog';
  import type { PageData } from './$types';

  interface Panel { data: unknown; meta: Record<string, unknown>; error: string; }
  interface QueueRow { name: string; connection: string | null; definition: {label?: string}; counts: Record<string, number> | null;
    runtime: {paused: boolean | null; effectiveConcurrency: number | null; observedConcurrency: number | null; lag: number | null; oldestWaitingAt: number | null; workers: {complete: boolean; coverage: string; observed: {live: number; active: number; draining: number; stale: number} | null} | null} | null;
    metrics?: {completed: number; failed: number; minutes: number} | null; capabilities?: {pause: boolean}; error: string | null; }
  interface Job { id: string; source: 'live' | 'dead-letter'; jobClass: string; status: string; attempts?: number; maxAttempts?: number; stalledCount?: number; error: string | null; createdAt?: number; failedAt?: number; finishedAt?: number;
    payload: unknown; metadata: unknown; resourcePath: string | null; lock?: {state: string}; timeline?: Array<{id: string; event: string; at: number}>; }
  interface Flag { name: string; description?: string; enabled: boolean | null; percentage: number | null; available: boolean; }
  interface LogEntry { id?: number; timestamp: string; level: string; channel: string; message: string; context: unknown; }
  interface Task {name: string; humanReadable: string; timezone?: string; lastRun?: string; lastStatus?: string; lastDuration?: number; nextRun: string | null; nextRunError?: string; isRunning: boolean; lockOwner?: string | null; leaseUntil?: string | null; enabled: boolean; history: Array<{timestamp: string;success: boolean;duration: number;error?: string}>;}
  interface Template {name: string; label: string; scope: 'team' | 'platform'; defaults: 'all' | string[];}
  interface Confirmation {title: string; message: string; url: string; method: string; body?: unknown; panel: string; key: string; form?: 'roleCreate' | 'userAccess';}
  let { data }: { data: PageData } = $props();
  let panels = $state<Record<string, Panel>>({});
  let pending = $state<Record<string, boolean>>({});
  let feedback = $state<Record<string, string>>({});
  let failures = $state<Record<string, string>>({});
  let sidebarOpen = $state(false);
  let sidebarCollapsed = $state(false);
  let selected = $state<string[]>([]);
  let confirmation = $state<Confirmation | null>(null);
  let dialog: HTMLDialogElement;
  let role = $state<DashboardRole | null>(null);
  let profileScope = $state<'team' | 'platform'>('team');
  let teamId = $state('');
  let mode = $state<'custom' | 'system'>('custom');
  let systemProfile = $state('');
  let values = $state<string[]>([]); let inclusions = $state<string[]>([]); let exclusions = $state<string[]>([]);
  let profileReady = $state(false);
  let catalogSearch = $state(''); let catalogOffset = $state(0);
  let requests = $state<Record<string, {id: string; state: string; error?: string}>>({});
  let management = $state<'roleCreate' | 'userAccess' | null>(null);
  let managementDialog: HTMLDialogElement;
  let grantScope = $state<'team' | 'platform'>('team'); let grantTeamId = $state('');
  let managedUser = $state<DashboardUser | null>(null); let userAccess = $state<DashboardUserAccess | null>(null);
  let formErrors = $state<Record<string, string[]>>({}); let formError = $state(''); let formMessage = $state('');
  let roleChoices = $state<DashboardRole[]>([]); let capabilityChoices = $state<ManifestCapability[]>([]);
  let roleChoiceSearch = $state(''); let roleChoiceOffset = $state(0); let roleChoiceMore = $state(false); let choiceError = $state('');
  let capabilityChoiceSearch = $state('');
  let directSearch = $state(''); let directOffset = $state(0);
  const roleCreateValidator = zod4Client(dashboardRoleCreateSchema);
  const userAccessValidator = zod4Client(dashboardUserAccessSchema);
  const userRoleValidator = zod4Client(dashboardUserRoleSchema);
  const userCapabilityValidator = zod4Client(dashboardUserCapabilitySchema);
  const roleCreateForm = superForm<DashboardRoleCreateInput>({scope:'team',name:'',label:'',confirmed:true}, {
    id:'dashboard-role-create',SPA:true,dataType:'json',validators:roleCreateValidator,resetForm:false,
    onSubmit:({cancel})=>{cancel();void createRole();},
  });
  const {form:roleCreateValues,errors:roleCreateErrors,enhance:enhanceRoleCreate} = roleCreateForm;
  const userRoleForm = superForm<DashboardUserRoleInput>({id:'',scope:'team',roleId:0,confirmed:true}, {
    id:'dashboard-user-role',SPA:true,dataType:'json',validators:userRoleValidator,resetForm:false,
    onSubmit:({cancel})=>{cancel();void userRoleChange($userRoleValues.roleId,false);},
  });
  const {form:userRoleValues,errors:userRoleErrors,enhance:enhanceUserRole} = userRoleForm;
  const userCapabilityForm = superForm<DashboardUserCapabilityInput>({id:'',scope:'team',capability:'',confirmed:true}, {
    id:'dashboard-user-capability',SPA:true,dataType:'json',validators:userCapabilityValidator,resetForm:false,
    onSubmit:({cancel})=>{cancel();void userCapabilityChange($userCapabilityValues.capability,false);},
  });
  const {form:userCapabilityValues,errors:userCapabilityErrors,enhance:enhanceUserCapability} = userCapabilityForm;
  const tabs = [{value:'overview',label:'Overview',icon:LayoutDashboard}, {value:'users',label:'Users',icon:Users}, {value:'permissions',label:'Roles & permissions',icon:ShieldCheck},
    {value:'queues',label:'Queues',icon:ListChecks}, {value:'scheduler',label:'Scheduler',icon:Clock3}, {value:'logs',label:'Logs',icon:Logs}, {value:'features',label:'Features',icon:SlidersHorizontal}];
  const tab = $derived(tabs.find((item) => item.value === page.url.searchParams.get('tab'))?.value ?? 'overview');
  const panelNames: Record<string, string> = {overview:'stats',queues:'queue',scheduler:'scheduler',logs:'logs',users:'users',permissions:'permissions',features:'features'};
  const activePanel = $derived(panelNames[tab] ?? 'stats');
  const shell = $derived(record(record(panels.console?.data).shell));
  const identity = $derived(record(record(panels.console?.data).user));
  const access = $derived(record(record(panels.console?.data).access));
  const available = $derived(record(record(panels.console?.data).available));
  const managementBusy = $derived(Boolean(pending['access-read'] || pending['management-validate'] || pending['role-create'] || Object.entries(pending).some(([key, value]) => key.startsWith('access-write:') && value)));
  const scopeErrors = $derived(formErrors.scope ?? $roleCreateErrors.scope ?? $userRoleErrors.scope ?? $userCapabilityErrors.scope ?? []);
  const teamErrors = $derived(formErrors.teamId ?? $roleCreateErrors.teamId ?? $userRoleErrors.teamId ?? $userCapabilityErrors.teamId ?? []);
  const capabilityOptions = $derived(capabilityChoices.filter(item => item.scope === grantScope && !userAccess?.directCapabilities.includes(item.name)
    && (item.label+' '+item.name).toLowerCase().includes(capabilityChoiceSearch.toLowerCase())).slice(0,100));
  const snapshotMatches = $derived(userAccess !== null && userAccess.scope === grantScope && userAccess.teamId === (grantScope === 'team' ? grantTeamId : undefined));
  const directGrants = $derived((userAccess?.directCapabilities ?? []).filter(name => name.toLowerCase().includes(directSearch.toLowerCase())));
  const topology = $derived(rows<QueueRow>(record(record(panels.stats?.data).queue).topology));
  const jobs = $derived(rows<Job>(record(panels.queue?.data).jobs));
  const tasks = $derived(rows<Task>(record(panels.scheduler?.data).tasks));
  const users = $derived(rows<DashboardUser>(record(panels.users?.data).items));
  const roles = $derived(rows<DashboardRole>(record(panels.permissions?.data).items));
  const catalog = $derived(rows<ManifestCapability>(record(panels.permissions?.data).catalog));
  const aliases = $derived(rows<ManifestAlias>(record(panels.permissions?.data).aliases));
  const filteredCatalog = $derived(catalog.filter((item) => (item.label + ' ' + item.name + ' ' + item.group).toLowerCase().includes(catalogSearch.toLowerCase())));
  const catalogPage = $derived(filteredCatalog.slice(catalogOffset, catalogOffset + 25));
  const templates = $derived(rows<Template>(record(panels.permissions?.data).systemProfiles).filter((item) => item.scope === profileScope));
  const defaults = $derived(templates.find((item) => item.name === systemProfile)?.defaults ?? []);
  const defaultNames = $derived(defaults === 'all' ? catalog.filter((item) => item.scope === profileScope).map((item) => item.name) : defaults);
  const inspected = $derived(record(panels.job?.data));
  $effect(() => { panels = data.panels; selected = []; });
  $effect(() => { if (confirmation && dialog && !dialog.open) dialog.showModal(); else if (!confirmation && dialog?.open) dialog.close(); });
  $effect(() => { if (management && managementDialog && !managementDialog.open) managementDialog.showModal(); else if (!management && managementDialog?.open) managementDialog.close(); });
  function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
  function rows<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
  function count(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : 'Unknown'; }
  function time(value: unknown) { if (typeof value !== 'string' && typeof value !== 'number') return 'Unknown'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString(); }
  function format(value: unknown) { return JSON.stringify(value, null, 2) ?? 'Unknown'; }
  function query(name: string, fallback = '') { return page.url.searchParams.get(name) ?? fallback; }
  function scope(source?: string) { const result = new URLSearchParams({queue: query('queue', 'default')}); if (query('connection')) result.set('connection', query('connection')); if (source) result.set('source', source); return result; }
  async function navigate(values: Record<string, string>, reset: string[] = []) {
    const url = new URL(page.url);
    for (const key of reset) url.searchParams.delete(key);
    for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    sidebarOpen = false; await goto(url, {keepFocus: true, noScroll: true});
  }
  function filters(event: SubmitEvent, reset: string[]) {
    event.preventDefault(); const form = event.currentTarget;
    if (form instanceof HTMLFormElement) void navigate(Object.fromEntries([...new FormData(form)].map(([key,value]) => [key,String(value)])), reset);
  }
  function endpoint(name: string) {
    const queues = new URLSearchParams(scope()); queues.set('status', query('status', 'failed')); queues.set('offset', query('offset', '0')); queues.set('limit', query('limit', '25'));
    for (const key of ['tenantId','accountId','resourceId','correlationId','jobClass']) if (query(key)) queues.set(key, query(key));
    const logs = new URLSearchParams({limit:'25',offset:query('logOffset','0')});
    for (const key of ['level','channel','search','correlationId']) if (query(key)) logs.set(key, query(key));
    const urls: Record<string,string> = {console:'/api/admin/console',stats:'/api/admin/stats',health:'/api/admin/health',queue:'/api/admin/queue?'+queues,scheduler:'/api/admin/scheduler',logs:'/api/admin/logs?'+logs,
      users:'/api/admin/users?'+new URLSearchParams({limit:'25',offset:query('userOffset','0'),search:query('userSearch')}),
      permissions:'/api/admin/permissions?'+new URLSearchParams({limit:'25',offset:query('roleOffset','0'),search:query('roleSearch')}),features:'/api/admin/features'};
    return urls[name];
  }
  async function refresh(name: string) {
    const key = 'read:'+name; if (pending[key] || !endpoint(name)) return;
    pending[key] = true;
    try { const response = await apiFetch(endpoint(name)); const body = await response.json(); if (!response.ok) throw new Error(body.meta?.message ?? 'Unavailable.');
      panels[name] = {data:body.data,meta:body.meta ?? {},error:''}; }
    catch (error) { panels[name] = {data:null,meta:{},error:error instanceof Error ? error.message : 'Unavailable.'}; }
    finally { pending[key] = false; }
  }
  async function command(item: Confirmation) {
    if (pending[item.key]) return; confirmation = null; pending[item.key] = true; failures[item.key] = ''; feedback[item.key] = '';
    try { const response = await apiFetch(item.url, {method:item.method, ...(item.body === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(item.body)})});
      const body = await response.json(); if (!response.ok) {
        if (item.form && response.status === 422 && body.meta?.errors) { setFormErrors(body.meta.errors); return; }
        throw new Error(body.meta?.message ?? 'Operation not accepted.');
      }
      if (item.key === 'logout') { await goto(typeof shell.appPath === 'string' ? shell.appPath : '/'); return; }
      if (item.form) {
        formMessage = (body.meta?.message ?? 'Accepted.') + (body.meta?.auditWarning ? ' '+body.meta.auditWarning : '');
        if (item.form === 'userAccess') { userAccess = null; await loadUserAccess(); }
        else { management = null; roleCreateForm.reset(); feedback[item.key] = formMessage; await refresh('permissions'); }
        return;
      }
      feedback[item.key] = body.meta?.message ?? 'Accepted.';
      if (body.meta?.auditWarning) feedback[item.key] += ' '+body.meta.auditWarning;
      if (body.data?.partial) failures[item.key] = 'Some records were not accepted. Review their current state before retrying.';
      if (body.data?.queued && body.data.data?.id) requests[item.key] = {id:body.data.data.id,state:body.data.data.state};
      await refresh(item.panel);
    } catch (error) { if (item.form) formError = error instanceof Error ? error.message : 'Operation not accepted.';
      else failures[item.key] = error instanceof Error ? error.message : 'Operation not accepted.'; }
    finally { pending[item.key] = false; }
  }
  function jobCommand(job: Job, remove: boolean) {
    confirmation = {title:remove?'Remove job':'Retry job',message:remove?'Remove this retained record?':'Queue this job for another delivery?',url:'/api/admin/queue/'+encodeURIComponent(job.id)+(remove?'':'/retry')+'?'+scope(job.source),
      method:remove?'DELETE':'POST',body:remove?{confirmed:true}:undefined,panel:'queue',key:'job:'+job.source+':'+job.id};
  }
  function batch(remove: boolean) {
    const references = jobs.filter((job) => selected.includes(job.source+':'+job.id)).map(({id,source})=>({id,source}));
    if (!references.length) return;
    confirmation = {title:remove?'Remove selected jobs':'Retry selected jobs',message:String(references.length)+' selected records. Busy or protected records remain retained.',url:'/api/admin/queue/batch/'+(remove?'cleanup':'retry')+'?'+scope(),
      method:'POST',body:{references,confirmed:true},panel:'queue',key:'queue-batch'};
  }
  async function inspect(job: Job) {
    const key = 'inspect:'+job.id; if (pending[key]) return; pending[key] = true;
    const url = new URL(page.url); url.searchParams.set('job',job.id); url.searchParams.set('source',job.source); replaceState(url,page.state);
    try { const response = await apiFetch('/api/admin/queue/'+encodeURIComponent(job.id)+'?'+scope(job.source)); const body = await response.json(); if (!response.ok) throw new Error(body.meta?.message ?? 'Inspection unavailable.');
      panels.job = {data:body.data,meta:body.meta ?? {},error:''}; }
    catch (error) { panels.job = {data:null,meta:{},error:error instanceof Error ? error.message : 'Inspection unavailable.'}; }
    finally { pending[key] = false; }
  }
  async function loadProfile() {
    if (!role || profileScope === 'team' && !teamId) return; profileReady = false; const key='profile'; pending[key] = true; failures[key] = '';
    try { const response = await apiFetch('/api/admin/permissions/roles/'+role.id+'/profile?'+new URLSearchParams({scope:profileScope,...(profileScope==='team'?{teamId}:{})}));
      const body = await response.json(); if (!response.ok) throw new Error(body.meta?.message ?? 'Profile unavailable.');
      const profile = body.data.profile; mode = profile?.kind ?? 'custom'; systemProfile = profile?.systemProfile ?? '';
      values = [...new Set<string>([...(body.data.selected ?? []),...(body.data.staleCapabilities ?? [])])];
      inclusions = [...(profile?.inclusions ?? [])]; exclusions = [...(profile?.exclusions ?? [])]; profileReady = true;
    } catch(error) { failures[key] = error instanceof Error ? error.message : 'Profile unavailable.'; }
    finally { pending[key] = false; }
  }
  function saveProfile() {
    if (!role || !profileReady) return;
    const body: DashboardProfileUpdate & {confirmed:true} = {roleId:role.id,scope:profileScope,...(profileScope==='team'?{teamId}:{}),kind:mode,
      ...(mode==='system'?{systemProfile}:{}),capabilities:mode==='custom'?values:[],exclusions:mode==='system'?exclusions:[],inclusions:mode==='system'?inclusions:[],confirmed:true};
    confirmation = {title:'Save permission profile',message:'Apply these grants to this role and assignment scope?',url:'/api/admin/permissions/roles/'+role.id+'/profile',method:'PUT',body,panel:'permissions',key:'profile-save'};
  }
  async function validateForm<T>(validator: ClientValidationAdapter<T>, input: unknown): Promise<T | null> {
    formErrors = {}; formError = '';
    const result = await validator.validate(input);
    if (result.success) return result.data;
    for (const issue of result.issues) { const field = String(issue.path?.[0] ?? '_root'); (formErrors[field] ??= []).push(issue.message); }
    return null;
  }
  function setFormErrors(errors: Record<string,string[]>) {
    formErrors = errors;
    roleCreateErrors.set({name:errors.name,label:errors.label,scope:errors.scope,teamId:errors.teamId});
    userRoleErrors.set({roleId:errors.roleId}); userCapabilityErrors.set({capability:errors.capability});
  }
  function assignmentScope() { return {scope:grantScope,...(grantScope === 'team' ? {teamId:grantTeamId} : {})}; }
  function openManagement(kind: 'roleCreate' | 'userAccess', user?: DashboardUser) {
    if (managementBusy) return;
    management = kind; managedUser = user ?? null; userAccess = null; formErrors = {}; formError = ''; formMessage = '';
    roleCreateForm.reset(); userRoleForm.reset(); userCapabilityForm.reset(); choiceError = ''; roleChoiceOffset = 0; roleChoiceSearch = '';
    if (kind === 'userAccess') { void loadRoleChoices(); if (grantScope === 'platform' || grantTeamId) void loadUserAccess(); }
  }
  function closeManagement() { if (!managementBusy) management = null; }
  async function loadRoleChoices() {
    if (pending['role-choices']) return; pending['role-choices'] = true; choiceError = '';
    try { const response = await apiFetch('/api/admin/permissions?'+new URLSearchParams({limit:'25',offset:String(roleChoiceOffset),search:roleChoiceSearch}));
      const body = await response.json(); if (!response.ok) throw new Error(body.meta?.message ?? 'Role catalog unavailable.');
      roleChoices = rows<DashboardRole>(body.data.items).filter(item => !item.protected);
      capabilityChoices = rows<ManifestCapability>(body.data.catalog); roleChoiceMore = body.data.hasMore === true;
    } catch (error) { choiceError = error instanceof Error ? error.message : 'Role catalog unavailable.'; roleChoices = []; capabilityChoices = []; }
    finally { pending['role-choices'] = false; }
  }
  async function loadUserAccess() {
    if (!managedUser || pending['access-read']) return;
    pending['access-read'] = true; userAccess = null; $userRoleValues.roleId = 0; $userCapabilityValues.capability = '';
    try { const input = await validateForm(userAccessValidator, {id:String(managedUser.id),...assignmentScope()}); if (!input) return;
      const response = await apiFetch('/api/admin/users/'+encodeURIComponent(input.id)+'/access?'+new URLSearchParams({scope:input.scope,...(input.teamId?{teamId:input.teamId}:{})}));
      const body = await response.json(); if (!response.ok) throw new Error(body.meta?.message ?? 'Access unavailable.');
      userAccess = body.data; directOffset = 0;
    } catch (error) { formError = error instanceof Error ? error.message : 'Access unavailable.'; }
    finally { pending['access-read'] = false; }
  }
  async function createRole() {
    if (managementBusy) return;
    formError = ''; formErrors = {};
    roleCreateValues.set({...assignmentScope(),name:$roleCreateValues.name,label:$roleCreateValues.label,confirmed:true});
    pending['management-validate'] = true;
    let result; try { result = await roleCreateForm.validateForm({update:true}); } finally { pending['management-validate'] = false; }
    if (!result.valid) { formErrors._root = result.errors._errors ?? []; return; } const input = result.data;
    confirmation = {title:'Create role',message:input.label+' · '+input.scope+(input.teamId?' / '+input.teamId:''),url:'/api/admin/permissions/roles',method:'POST',body:input,panel:'permissions',key:'role-create',form:'roleCreate'};
  }
  async function userRoleChange(roleId: string | number, detach: boolean) {
    if (!managedUser || !snapshotMatches || managementBusy) return;
    formError = ''; formErrors = {};
    userRoleValues.set({id:String(managedUser.id),...assignmentScope(),roleId:Number(roleId),confirmed:true});
    pending['management-validate'] = true;
    let result; try { result = await userRoleForm.validateForm({update:true}); } finally { pending['management-validate'] = false; }
    if (!result.valid) { formErrors._root = result.errors._errors ?? []; return; } const input = result.data;
    confirmation = {title:detach?'Detach role':'Assign role',message:managedUser.email+' · '+input.scope+(input.teamId?' / '+input.teamId:''),url:'/api/admin/users/'+encodeURIComponent(input.id)+'/roles',method:detach?'DELETE':'POST',body:input,panel:'users',key:'access-write:role:'+input.roleId,form:'userAccess'};
  }
  async function userCapabilityChange(capability: string, revoke: boolean) {
    if (!managedUser || !snapshotMatches || managementBusy) return;
    formError = ''; formErrors = {};
    userCapabilityValues.set({id:String(managedUser.id),...assignmentScope(),capability,confirmed:true});
    pending['management-validate'] = true;
    let result; try { result = await userCapabilityForm.validateForm({update:true}); } finally { pending['management-validate'] = false; }
    if (!result.valid) { formErrors._root = result.errors._errors ?? []; return; } const input = result.data;
    confirmation = {title:revoke?'Revoke direct capability':'Grant direct capability',message:managedUser.email+' · '+input.capability+' · '+input.scope+(input.teamId?' / '+input.teamId:''),url:'/api/admin/users/'+encodeURIComponent(input.id)+'/capabilities',method:revoke?'DELETE':'POST',body:input,panel:'users',key:'access-write:capability:'+input.capability,form:'userAccess'};
  }
  async function requestStatus(task: string, key: string) {
    const request = requests[key]; if (!request || pending[key]) return; pending[key] = true;
    try { const response = await apiFetch('/api/admin/scheduler/'+encodeURIComponent(task)+'/requests/'+encodeURIComponent(request.id)); const body = await response.json();
      if (!response.ok) throw new Error(body.meta?.message ?? 'Request unavailable.'); requests[key] = {id:body.data.id,state:body.data.state,error:body.data.error}; }
    catch(error) { failures[key] = error instanceof Error ? error.message : 'Request unavailable.'; } finally { pending[key] = false; }
  }
</script>

<div class="console-shell" class:collapsed={sidebarCollapsed}>
  <aside class:open={sidebarOpen} aria-label="Operations navigation">
    <div class="brand">{typeof shell.title === 'string' ? shell.title : 'Operations'}</div>
    <nav aria-label="Console sections">{#each tabs as item}{@const Icon=item.icon}<a title={item.label} aria-label={item.label} href={'?'+new URLSearchParams({...Object.fromEntries(page.url.searchParams),tab:item.value})} class:active={tab===item.value} aria-current={tab===item.value?'page':undefined} onclick={(event)=>{event.preventDefault();void navigate({tab:item.value});}}><Icon size={17}/><span>{item.label}</span></a>{/each}</nav>
    <a class="return-link" href={typeof shell.appPath==='string'?shell.appPath:'/'}><ExternalLink size={16}/>Return to app</a>
  </aside>
  <div class="workspace">
    <header class="topbar"><button class="icon" title="Toggle navigation" aria-label="Toggle navigation" aria-expanded={!sidebarCollapsed} onclick={()=>{sidebarCollapsed=!sidebarCollapsed;sidebarOpen=!sidebarOpen;}}><Menu size={18}/></button>
      <span class="identity">{typeof identity.name==='string'?identity.name:typeof identity.email==='string'?identity.email:'Administrator'}</span>
      <button class="icon" title="Log out" aria-label="Log out" aria-busy={pending.logout} disabled={pending.logout} onclick={()=>confirmation={title:'Log out',message:'End this session?',url:typeof shell.logoutPath==='string'?shell.logoutPath:'/api/auth/logout',method:'POST',panel:'console',key:'logout'}}>{#if pending.logout}<LoaderCircle size={18} class="spin"/>{:else}<LogOut size={18}/>{/if}</button>
    </header>
    <main>
      <div class="section-title"><h1>{tabs.find((item)=>item.value===tab)?.label}</h1><button class="command" disabled={pending['read:'+activePanel]} onclick={()=>void refresh(activePanel)}><RefreshCw size={16}/>Refresh</button></div>
      {#if panels.console?.error}<p class="error" role="alert">{panels.console.error}<button class="icon" title="Retry console state" aria-label="Retry console state" onclick={()=>void refresh('console')}><RotateCcw size={16}/></button></p>{/if}
      {#each Object.entries(failures).filter(([,message])=>!!message) as [key,message]}<p class="error" role="alert">{message}<span class="operation-id">{key}</span></p>{/each}
      {#each Object.entries(feedback).filter(([,message])=>!!message) as [key,message]}<p class="notice" role="status">{message}<span class="operation-id">{key}</span></p>{/each}
      <div class="running-ops" role="status">{#each Object.keys(pending).filter((key)=>pending[key]) as key}<span><LoaderCircle size={14} class="spin"/>Processing {key.replaceAll(':',' · ')}</span>{/each}</div>

      {#if tab==='overview'}
        {#if panels.stats?.error}<p class="error" role="alert">{panels.stats.error}<button class="command" onclick={()=>void refresh('stats')}><RotateCcw size={16}/>Retry</button></p>{/if}
        <dl class="metrics"><div><dt>Users</dt><dd>{count(record(panels.stats?.data).usersCount)}</dd></div><div><dt>Roles</dt><dd>{count(record(panels.stats?.data).rolesCount)}</dd></div>
          <div><dt>Waiting jobs</dt><dd>{!record(record(panels.stats?.data).queue).truncated && topology.length && topology.every((queue)=>queue.counts!==null)?count(topology.reduce((total,queue)=>total+(queue.counts?.waiting??0),0)):'Unknown'}</dd></div>
          <div><dt>Failed / dead letters</dt><dd>{!record(record(panels.stats?.data).queue).truncated && topology.length && topology.every((queue)=>queue.counts!==null)?count(topology.reduce((total,queue)=>total+(queue.counts?.failed??0)+(queue.counts?.deadLetter??0),0)):'Unknown'}</dd></div></dl>
        {#if panels.health?.error}<p class="error" role="alert">{panels.health.error}</p>{/if}
        <h2>System</h2><dl class="metrics"><div><dt>Status</dt><dd>{String(record(panels.health?.data).status??'Unknown')}</dd></div><div><dt>Uptime (seconds)</dt><dd>{count(record(panels.health?.data).uptime)}</dd></div><div><dt>Memory (MiB)</dt><dd>{typeof record(record(panels.health?.data).memory).rss==='number'?count(Number(record(record(panels.health?.data).memory).rss)/1048576):'Unknown'}</dd></div></dl>
        <div class="table-scroll" role="region" aria-label="Dependency observations" use:focusableScrollRegion><table><thead><tr><th>Dependency</th><th>Status</th><th>Latency</th></tr></thead><tbody>{#each rows<{name:string;status:string;latencyMs:number|null}>(record(panels.health?.data).dependencies) as dependency}<tr><td>{dependency.name}</td><td>{dependency.status}</td><td>{count(dependency.latencyMs)} ms</td></tr>{:else}<tr><td colspan="3">Dependency observations unavailable.</td></tr>{/each}</tbody></table></div>
      {:else if tab==='queues'}
        <div class="table-scroll" role="region" aria-label="Registered queues" use:focusableScrollRegion><table><thead><tr><th>Queue / connection</th><th>Waiting</th><th>Active</th><th>Failed</th><th>Completed</th><th>Delayed</th><th>Observed workers / active / draining</th><th>Concurrency</th><th>Observed lag</th><th>Oldest observed ready</th><th>State</th><th>Metrics completed / failed</th><th>Controls</th></tr></thead><tbody>{#each topology as queue}<tr>
          <td><button class="text-link" onclick={()=>void navigate({queue:queue.name,connection:queue.connection??'',offset:'0'},['job','source'])}>{queue.definition.label??queue.name}</button><small>{queue.name} / {queue.connection??'Unknown'}</small></td>
          {#each ['waiting','active','failed','completed','delayed'] as status}<td>{count(queue.counts?.[status])}</td>{/each}
          <td>{count(queue.runtime?.workers?.observed?.live)} / {count(queue.runtime?.workers?.observed?.active)} / {count(queue.runtime?.workers?.observed?.draining)}<small>{queue.runtime?.workers?.coverage??'Unknown'}{queue.runtime?.workers?.complete===false?' · partial':''}</small></td>
          <td>{count(queue.runtime?.effectiveConcurrency)}<small>Observed {count(queue.runtime?.observedConcurrency)}</small></td><td>{count(queue.runtime?.lag)} ms</td><td>{time(queue.runtime?.oldestWaitingAt)}</td><td>{queue.runtime?.paused===null||!queue.runtime?'Unknown':queue.runtime.paused?'Paused':'Unpaused'}{#if queue.error}<small class="error">{queue.error}</small>{/if}</td>
          <td>{count(queue.metrics?.completed)} / {count(queue.metrics?.failed)}<small>{count(queue.metrics?.minutes)} retained minute buckets</small></td>
          <td><button class="icon" title={queue.runtime?.paused?'Resume queue':'Pause queue'} aria-label={queue.runtime?.paused?'Resume queue':'Pause queue'} disabled={!queue.capabilities?.pause||queue.runtime?.paused==null||!access.pauseQueue||pending['pause:'+queue.connection+':'+queue.name]} onclick={()=>confirmation={title:queue.runtime?.paused?'Resume queue':'Pause queue',message:queue.name+' / '+queue.connection,url:'/api/admin/queue/control/pause?'+new URLSearchParams({queue:queue.name,...(queue.connection?{connection:queue.connection}:{})}),method:'POST',body:{paused:!queue.runtime?.paused,confirmed:true},panel:'stats',key:'pause:'+queue.connection+':'+queue.name}}>{#if queue.runtime?.paused}<Play size={16}/>{:else}<Pause size={16}/>{/if}</button></td>
        </tr>{:else}<tr><td colspan="13">Queue registry unavailable.</td></tr>{/each}</tbody></table></div>
        <form class="filters" onsubmit={(event)=>filters(event,['offset','job','source'])}><label>Queue<input name="queue" value={query('queue','default')}/></label><label>Connection<input name="connection" value={query('connection')}/></label>
          <label>Status<select name="status" value={query('status','failed')}>{#each ['waiting','active','failed','completed','delayed','dead-letter'] as status}<option value={status}>{status}</option>{/each}</select></label>
          {#each [['tenantId','Tenant'],['accountId','Account'],['resourceId','Resource'],['correlationId','Correlation'],['jobClass','Job class']] as [name,label]}<label>{label}<input {name} value={query(name)}/></label>{/each}
          <button class="command" type="submit"><Eye size={16}/>Apply</button></form>
        {#if panels.queue?.error}<p class="error" role="alert">{panels.queue.error}<button class="command" onclick={()=>void refresh('queue')}><RotateCcw size={16}/>Retry</button></p>{/if}
        <div class="toolbar"><span>{selected.length} selected · Indexed total {count(panels.queue?.meta.total)}</span><button class="command" disabled={!selected.length||pending['queue-batch']||!access.retryJobs} onclick={()=>batch(false)}><RotateCcw size={16}/>Retry selected</button><button class="command danger" disabled={!selected.length||pending['queue-batch']||!access.cleanupJobs} onclick={()=>batch(true)}><Trash2 size={16}/>Remove selected</button></div>
        <div class="table-scroll" role="region" aria-label="Queue jobs" use:focusableScrollRegion><table><thead><tr><th>Select</th><th>Job</th><th>Status</th><th>Attempts</th><th>Created / failed</th><th>Operations</th></tr></thead><tbody>{#each jobs as job}<tr>
          <td><input type="checkbox" aria-label={'Select '+job.id} checked={selected.includes(job.source+':'+job.id)} onchange={(event)=>selected=event.currentTarget.checked?[...selected,job.source+':'+job.id]:selected.filter((key)=>key!==job.source+':'+job.id)}/></td>
          <td><button class="text-link" onclick={()=>void inspect(job)}>{job.jobClass}</button><small>{job.id}</small></td><td>{job.status}</td><td>{count(job.attempts)} / {count(job.maxAttempts)}</td><td>{time(job.createdAt??job.failedAt)}</td><td class="controls">
            <button class="icon" title="Inspect job" aria-label="Inspect job" disabled={pending['inspect:'+job.id]} onclick={()=>void inspect(job)}><Eye size={16}/></button>
            <button class="icon" title="Retry job" aria-label="Retry job" disabled={!['failed','dead-letter'].includes(job.status)||pending['job:'+job.source+':'+job.id]||!access.retryJob} onclick={()=>jobCommand(job,false)}><RotateCcw size={16}/></button>
            <button class="icon danger" title="Remove job" aria-label="Remove job" disabled={job.status==='active'||pending['job:'+job.source+':'+job.id]||!access.deleteJob} onclick={()=>jobCommand(job,true)}><Trash2 size={16}/></button>
          </td></tr>{:else}<tr><td colspan="6">{panels.queue?.error?'Jobs unavailable.':'No jobs on this page.'}</td></tr>{/each}</tbody></table></div>
        <div class="pagination"><button class="icon" title="Previous jobs" aria-label="Previous jobs" disabled={Number(query('offset','0'))===0} onclick={()=>void navigate({offset:String(Math.max(0,Number(query('offset','0'))-Number(query('limit','25'))))},['job','source'])}><ChevronLeft size={16}/></button><span>Offset {query('offset','0')}</span><button class="icon" title="Next jobs" aria-label="Next jobs" disabled={!panels.queue?.meta.hasMore} onclick={()=>void navigate({offset:String(Number(query('offset','0'))+Number(query('limit','25')))},['job','source'])}><ChevronRight size={16}/></button></div>
        {#if panels.job}<section class="inspector" aria-label="Job inspection"><div class="section-title"><h2>Job inspection</h2><button class="icon" title="Close inspection" aria-label="Close inspection" onclick={()=>{delete panels.job;const url=new URL(page.url);url.searchParams.delete('job');url.searchParams.delete('source');replaceState(url,page.state);}}><X size={16}/></button></div>
          {#if panels.job.error}<p class="error" role="alert">{panels.job.error}</p>{:else}<p>{String(inspected.jobClass??'')} · {String(inspected.id??'')} · {String(inspected.status??'')}</p><p>Attempts {count(inspected.attempts)} / {count(inspected.maxAttempts)} · Stalls {count(inspected.stalledCount)} · Lock {String(record(inspected.lock).state??'Unknown')}</p>
            {#if typeof inspected.resourcePath==='string'}<a href={inspected.resourcePath}>Open origin resource <ExternalLink size={16}/></a>{/if}
            <h3>Error</h3><pre class="error-trace">{String(inspected.error??'No retained error.')}</pre><h3>Payload</h3><pre>{format(inspected.payload)}</pre><h3>Metadata</h3><pre>{format(inspected.metadata)}</pre>
            <h3>Timeline</h3><ol class="timeline">{#each rows<{id:string;event:string;at:number}>(inspected.timeline) as entry}<li><time>{time(entry.at)}</time> {entry.event}</li>{:else}<li>No retained timeline.</li>{/each}</ol>
          {/if}</section>{/if}
      {:else if tab==='scheduler'}
        {#if panels.scheduler?.error}<p class="error" role="alert">{panels.scheduler.error}<button class="command" onclick={()=>void refresh('scheduler')}><RotateCcw size={16}/>Retry</button></p>{/if}
        <p class="scope">Runtime scope: {String(record(panels.scheduler?.data).runtimeScope??'Unknown')}</p>
        <div class="table-scroll" role="region" aria-label="Scheduler tasks" use:focusableScrollRegion><table><thead><tr><th>Task / schedule</th><th>Last run / duration</th><th>Next run</th><th>Lock / lease</th><th>Enabled</th><th>Controls / run request</th></tr></thead><tbody>{#each tasks as task}<tr><td>{task.name}<small>{task.humanReadable} · {task.timezone??'System timezone'}</small></td><td>{time(task.lastRun)}<small>{task.lastStatus??'Unknown'} · {count(task.lastDuration)} ms</small></td><td>{time(task.nextRun)}{#if task.nextRunError}<small class="error">{task.nextRunError}</small>{/if}</td><td>{task.isRunning?'Running':record(panels.scheduler?.data).runtimeScope==='shared'?'Idle':'Unknown'}<small>{task.lockOwner??'Unknown'} · {time(task.leaseUntil)}</small></td><td><input type="checkbox" aria-label={'Enable '+task.name} checked={task.enabled} disabled={pending['toggle:'+task.name]||!access.toggleTask} onchange={(event)=>{const enabled=event.currentTarget.checked;event.currentTarget.checked=task.enabled;void command({title:'Toggle task',message:'',url:'/api/admin/scheduler/'+encodeURIComponent(task.name)+'/toggle',method:'POST',body:{enabled},panel:'scheduler',key:'toggle:'+task.name});}}/></td>
          <td><button class="command" disabled={!task.enabled||task.isRunning||pending['run:'+task.name]||!access.runTask} onclick={()=>confirmation={title:'Queue task run',message:task.name,url:'/api/admin/scheduler/'+encodeURIComponent(task.name)+'/run',method:'POST',panel:'scheduler',key:'run:'+task.name}}><Play size={16}/>Run now</button>
            {#if requests['run:'+task.name]}<small>{requests['run:'+task.name].state}</small><button class="icon" title="Refresh run request" aria-label="Refresh run request" disabled={pending['run:'+task.name]} onclick={()=>void requestStatus(task.name,'run:'+task.name)}><RefreshCw size={16}/></button>{#if requests['run:'+task.name].error}<p class="error">{requests['run:'+task.name].error}</p>{/if}{/if}
            <details><summary>Run history</summary>{#each task.history as run}<p>{time(run.timestamp)} · {run.success?'Succeeded':'Failed'} · {count(run.duration)} ms</p>{#if run.error}<pre class="error-trace">{run.error}</pre>{/if}{:else}<p>No retained runs.</p>{/each}</details></td>
        </tr>{:else}<tr><td colspan="6">No registered tasks.</td></tr>{/each}</tbody></table></div>
      {:else if tab==='logs'}
        <form class="filters" onsubmit={(event)=>filters(event,['logOffset'])}><label>Level<select name="level" value={query('level')}><option value="">All</option>{#each ['debug','info','warn','error','fatal'] as level}<option>{level}</option>{/each}</select></label><label>Channel<input name="channel" value={query('channel')}/></label><label>Search / incident<input name="search" value={query('search')}/></label><label>Correlation ID<input name="correlationId" value={query('correlationId')}/></label><button class="command" type="submit"><Eye size={16}/>Apply</button></form>
        {#if panels.logs?.error}<p class="error" role="alert">{panels.logs.error}<button class="command" onclick={()=>void refresh('logs')}><RotateCcw size={16}/>Retry</button></p>{/if}
        <p class="scope">Storage: {String(record(panels.logs?.data).scope??'Unknown')} · Total {count(record(panels.logs?.data).total)}</p>
        <div class="table-scroll" role="region" aria-label="Persistent logs" use:focusableScrollRegion><table><thead><tr><th>Time / level</th><th>Channel</th><th>Message / context</th></tr></thead><tbody>{#each rows<LogEntry>(record(panels.logs?.data).logs) as log}<tr><td>{time(log.timestamp)}<small>{log.level}</small></td><td>{log.channel}</td><td class="log-message">{log.message}<details><summary>Context</summary><pre>{format(log.context)}</pre></details></td></tr>{:else}<tr><td colspan="3">No matching logs.</td></tr>{/each}</tbody></table></div>
        <div class="pagination"><button class="icon" title="Previous logs" aria-label="Previous logs" disabled={Number(query('logOffset','0'))===0} onclick={()=>void navigate({logOffset:String(Math.max(0,Number(query('logOffset','0'))-25))})}><ChevronLeft size={16}/></button><span>Offset {query('logOffset','0')}</span><button class="icon" title="Next logs" aria-label="Next logs" disabled={!record(panels.logs?.data).hasMore} onclick={()=>void navigate({logOffset:String(Number(query('logOffset','0'))+25)})}><ChevronRight size={16}/></button></div>
      {:else if tab==='users'}
        <form class="filters" onsubmit={(event)=>filters(event,['userOffset'])}><label>Search users<input name="userSearch" value={query('userSearch')}/></label><button class="command" type="submit"><Eye size={16}/>Search</button></form>
        {#if panels.users?.error}<p class="error" role="alert">{panels.users.error}<button class="command" onclick={()=>void refresh('users')}><RotateCcw size={16}/>Retry</button></p>{/if}
        <div class="table-scroll" role="region" aria-label="User directory" use:focusableScrollRegion><table><thead><tr><th>User</th><th>Email</th><th>Global role</th><th>Controls</th></tr></thead><tbody>{#each users as user}<tr><td>{user.name}<small>{user.id}</small></td><td>{user.email}</td><td>{user.globalRole??'Unknown'}</td><td class="controls"><button class="icon" title="Reset password" aria-label="Reset password" disabled={!user.canResetPassword||pending['user:'+user.id]||!access.resetPassword} onclick={()=>confirmation={title:'Reset password',message:user.email,url:'/api/admin/users/'+encodeURIComponent(String(user.id))+'/reset-password',method:'POST',panel:'users',key:'user:'+user.id}}><KeyRound size={16}/></button>
          <button class="icon" title="Manage user access" aria-label="Manage user access" disabled={!available.userAccess||!access.userAccess||managementBusy} onclick={()=>openManagement('userAccess',user)}><UserRoundCog size={16}/></button>
          <button class="icon danger" title="Delete user" aria-label="Delete user" disabled={user.protected||!user.canDelete||pending['user:'+user.id]||!access.deleteUser} onclick={()=>confirmation={title:'Delete user',message:user.email,url:'/api/admin/users/'+encodeURIComponent(String(user.id)),method:'DELETE',body:{confirmed:true},panel:'users',key:'user:'+user.id}}><Trash2 size={16}/></button></td></tr>{:else}<tr><td colspan="4">{panels.users?.error?'User directory unavailable.':'No matching users.'}</td></tr>{/each}</tbody></table></div>
        <div class="pagination"><button class="icon" title="Previous users" aria-label="Previous users" disabled={Number(query('userOffset','0'))===0} onclick={()=>void navigate({userOffset:String(Math.max(0,Number(query('userOffset','0'))-25))})}><ChevronLeft size={16}/></button><span>Total {count(record(panels.users?.data).total)}</span><button class="icon" title="Next users" aria-label="Next users" disabled={!record(panels.users?.data).hasMore} onclick={()=>void navigate({userOffset:String(Number(query('userOffset','0'))+25)})}><ChevronRight size={16}/></button></div>
      {:else if tab==='permissions'}
        <form class="filters" onsubmit={(event)=>filters(event,['roleOffset'])}><label>Search roles<input name="roleSearch" value={query('roleSearch')}/></label><button class="command" type="submit"><Eye size={16}/>Search</button><button class="command" type="button" disabled={!available.createRole||!access.createRole||managementBusy} onclick={()=>openManagement('roleCreate')}><Plus size={16}/>Create role</button></form>
        {#if panels.permissions?.error}<p class="error" role="alert">{panels.permissions.error}<button class="command" onclick={()=>void refresh('permissions')}><RotateCcw size={16}/>Retry</button></p>{/if}
        <div class="table-scroll" role="region" aria-label="Permission roles" use:focusableScrollRegion><table><thead><tr><th>Role</th><th>Guard</th><th>Protected</th><th>Profile</th></tr></thead><tbody>{#each roles as item}<tr><td>{item.label}<small>{item.name}</small></td><td>{item.guard}</td><td>{item.protected?'Yes':'No'}</td><td><button class="icon" title="Edit permission profile" aria-label="Edit permission profile" disabled={pending.profile||pending['profile-save']||item.protected||!record(panels.permissions?.data).editable||!access.saveProfile} onclick={()=>{role=item;profileReady=false;}}><Eye size={16}/></button></td></tr>{:else}<tr><td colspan="4">No matching roles.</td></tr>{/each}</tbody></table></div>
        <div class="pagination"><button class="icon" title="Previous roles" aria-label="Previous roles" disabled={Number(query('roleOffset','0'))===0} onclick={()=>void navigate({roleOffset:String(Math.max(0,Number(query('roleOffset','0'))-25))})}><ChevronLeft size={16}/></button><span>Total {count(record(panels.permissions?.data).total)}</span><button class="icon" title="Next roles" aria-label="Next roles" disabled={!record(panels.permissions?.data).hasMore} onclick={()=>void navigate({roleOffset:String(Number(query('roleOffset','0'))+25)})}><ChevronRight size={16}/></button></div>
        {#if role}<section class="profile-editor"><h2>{role.label}</h2><div class="filters"><label>Scope<select disabled={pending.profile||pending['profile-save']} bind:value={profileScope} onchange={()=>profileReady=false}><option value="team">Team</option><option value="platform">Platform</option></select></label>{#if profileScope==='team'}<label>Team ID<input disabled={pending.profile||pending['profile-save']} bind:value={teamId} oninput={()=>profileReady=false}/></label>{/if}<button class="command" disabled={pending.profile||profileScope==='team'&&!teamId} onclick={()=>void loadProfile()}><RefreshCw size={16}/>Load profile</button></div>
          {#if profileReady}<div class="filters"><label>Profile mode<select disabled={pending['profile-save']} value={mode} onchange={(event)=>{const next=event.currentTarget.value;if(next==='custom'&&mode==='system')values=profileSelection(defaultNames,exclusions,inclusions);mode=next==='system'?'system':'custom';}}><option value="custom">Custom exact grants</option><option value="system">System defaults</option></select></label>{#if mode==='system'}<label>System profile<select disabled={pending['profile-save']} bind:value={systemProfile}><option value="">Select profile</option>{#each templates as template}<option value={template.name}>{template.label}</option>{/each}</select></label>{/if}</div>
            <CapabilityEditor {catalog} {aliases} scope={profileScope} bind:value={values} {mode} defaults={defaultNames} bind:inclusions bind:exclusions disabled={pending['profile-save']} error={failures['profile-save']??''}/>
            <div class="toolbar"><button class="command" disabled={pending['profile-save']||mode==='system'&&!systemProfile} onclick={saveProfile}><Save size={16}/>Save profile</button>
              <button class="command danger" disabled={!access.deleteRole||pending['role-delete']} onclick={()=>confirmation={title:'Remove role assignments',message:role?.label??'',url:'/api/admin/permissions/roles/'+role?.id,method:'DELETE',body:{scope:profileScope,...(profileScope==='team'?{teamId}:{}),confirmed:true},panel:'permissions',key:'role-delete'}}><Trash2 size={16}/>Remove role</button></div>
          {/if}</section>{/if}
        <h2>Capability catalog</h2><div class="filters"><label>Search capabilities<input bind:value={catalogSearch} oninput={()=>catalogOffset=0}/></label></div><div class="table-scroll" role="region" aria-label="Capability catalog" use:focusableScrollRegion><table><thead><tr><th>Group / screen</th><th>Capability</th><th>Scope</th><th>Dependencies</th></tr></thead><tbody>{#each catalogPage as capability}<tr><td>{capability.group}<small>{capability.screen}</small></td><td>{capability.label}<small>{capability.name}</small></td><td>{capability.scope}</td><td>{capability.dependencies.join(', ')||'None'}</td></tr>{/each}</tbody></table></div>
        <div class="pagination"><button class="icon" title="Previous capabilities" aria-label="Previous capabilities" disabled={catalogOffset===0} onclick={()=>catalogOffset=Math.max(0,catalogOffset-25)}><ChevronLeft size={16}/></button><span>{filteredCatalog.length} capabilities</span><button class="icon" title="Next capabilities" aria-label="Next capabilities" disabled={catalogOffset+25>=filteredCatalog.length} onclick={()=>catalogOffset+=25}><ChevronRight size={16}/></button></div>
      {:else if tab==='features'}
        {#if panels.features?.error}<p class="error" role="alert">{panels.features.error}<button class="command" onclick={()=>void refresh('features')}><RotateCcw size={16}/>Retry</button></p>{/if}<p class="scope">Storage: {String(record(panels.features?.data).scope??'Unknown')}</p>
        <div class="table-scroll" role="region" aria-label="Feature switches" use:focusableScrollRegion><table><thead><tr><th>Feature</th><th>Enabled</th><th>Rollout</th><th>Controls</th></tr></thead><tbody>{#each rows<Flag>(record(panels.features?.data).flags) as flag}<tr><td>{flag.name}<small>{flag.description??''}</small></td><td>{flag.enabled===null?'Unknown':flag.enabled?'Enabled':'Disabled'}</td><td>{flag.percentage===null?'Global':count(flag.percentage)+'%'}</td><td><input type="checkbox" aria-label={'Enable '+flag.name} checked={flag.enabled===true} disabled={!flag.available||!access.toggleFeature||pending['flag:'+flag.name]} onchange={(event)=>{const enabled=event.currentTarget.checked;event.currentTarget.checked=flag.enabled===true;confirmation={title:enabled?'Enable feature':'Disable feature',message:flag.name,url:'/api/admin/features/'+encodeURIComponent(flag.name),method:'PUT',body:{enabled,confirmed:true},panel:'features',key:'flag:'+flag.name};}}/></td></tr>{:else}<tr><td colspan="4">Feature registry unavailable.</td></tr>{/each}</tbody></table></div>
      {/if}
    </main>
  </div>
</div>
<dialog class="management-dialog" bind:this={managementDialog} aria-labelledby="management-title" oncancel={(event)=>{event.preventDefault();closeManagement();}} onclose={closeManagement}>
  {#if management}<div class="section-title"><h2 id="management-title">{management==='roleCreate'?'Create role':'User access'}</h2><button class="icon" title="Close access management" aria-label="Close access management" disabled={managementBusy} onclick={closeManagement}><X size={16}/></button></div>
    {#if managedUser}<p>{managedUser.name} · {managedUser.email}</p>{/if}
    {#if formError}<p class="error" role="alert">{formError}</p>{/if}{#if formMessage}<p class="notice" role="status">{formMessage}</p>{/if}
    {#each formErrors._root ?? [] as message}<p class="error" role="alert">{message}</p>{/each}
    <div class="filters"><label for="management-scope">Assignment scope<select id="management-scope" bind:value={grantScope} disabled={managementBusy} onchange={()=>{userAccess=null;formErrors={};$userCapabilityValues.capability='';roleCreateErrors.set({});userRoleErrors.set({});userCapabilityErrors.set({});}} aria-invalid={scopeErrors.length>0}><option value="team">Team</option><option value="platform">Platform</option></select>{#each scopeErrors as message}<small class="field-error">{message}</small>{/each}</label>
      {#if grantScope==='team'}<label for="management-team">Team ID<input id="management-team" bind:value={grantTeamId} disabled={managementBusy} oninput={()=>userAccess=null} aria-invalid={teamErrors.length>0}/>{#each teamErrors as message}<small class="field-error">{message}</small>{/each}</label>{/if}
      {#if management==='userAccess'}<button class="command" disabled={managementBusy} onclick={()=>void loadUserAccess()}>{#if pending['access-read']}<LoaderCircle size={16} class="spin"/>{:else}<RefreshCw size={16}/>{/if}Load access</button>{/if}
    </div>
      {#if management==='roleCreate'}<form novalidate method="POST" use:enhanceRoleCreate>
      <div class="filters"><label for="new-role-name">Role name<input id="new-role-name" name="name" bind:value={$roleCreateValues.name} disabled={managementBusy} aria-invalid={!!$roleCreateErrors.name?.length}/>{#each $roleCreateErrors.name ?? [] as message}<small class="field-error">{message}</small>{/each}</label>
        <label for="new-role-label">Label<input id="new-role-label" name="label" bind:value={$roleCreateValues.label} disabled={managementBusy} aria-invalid={!!$roleCreateErrors.label?.length}/>{#each $roleCreateErrors.label ?? [] as message}<small class="field-error">{message}</small>{/each}</label></div>
      <div class="toolbar"><button class="command" type="button" disabled={managementBusy} onclick={closeManagement}>Cancel</button><button class="command" type="submit" disabled={managementBusy||!access.createRole||!available.createRole}><Plus size={16}/>Create role</button></div>
    </form>{:else if snapshotMatches && userAccess}
      {#if userAccess.protected}<p class="notice" role="status">This user's access is protected.</p>{/if}
      <h3>Assigned roles</h3><ul class="grant-list">{#each userAccess.roles as assigned}<li><span>{assigned.label}<small>{assigned.name}</small></span><button class="icon danger" title="Detach role" aria-label={'Detach '+assigned.label} disabled={managementBusy||userAccess.protected||assigned.protected||!access.detachRole||!available.detachRole} onclick={()=>void userRoleChange(assigned.id,true)}><X size={16}/></button></li>{:else}<li>No roles assigned in this scope.</li>{/each}</ul>
      <h3>Assign role</h3>{#if choiceError}<p class="error" role="alert">{choiceError}<button class="icon" title="Retry role catalog" aria-label="Retry role catalog" disabled={pending['role-choices']} onclick={()=>void loadRoleChoices()}><RotateCcw size={16}/></button></p>{/if}
      <form class="filters" novalidate onsubmit={(event)=>{event.preventDefault();roleChoiceOffset=0;void loadRoleChoices();}}><label for="assign-role-search">Search roles<input id="assign-role-search" bind:value={roleChoiceSearch} disabled={pending['role-choices']}/></label><button class="command" disabled={pending['role-choices']}><Eye size={16}/>Search</button></form>
      <form class="filters" novalidate method="POST" use:enhanceUserRole><label for="assign-role">Role<select id="assign-role" name="roleId" bind:value={$userRoleValues.roleId} disabled={managementBusy||pending['role-choices']} aria-invalid={!!$userRoleErrors.roleId?.length}><option value={0}>Select role</option>{#each roleChoices.filter(item=>!userAccess?.roles.some(assigned=>assigned.id===item.id)) as choice}<option value={choice.id}>{choice.label}</option>{/each}</select>{#each $userRoleErrors.roleId ?? [] as message}<small class="field-error">{message}</small>{/each}</label>
        <button class="command" type="submit" disabled={managementBusy||userAccess.protected||!available.assignRole||!access.assignRole}><Plus size={16}/>Assign role</button></form>
      <div class="pagination"><button class="icon" title="Previous role choices" aria-label="Previous role choices" disabled={pending['role-choices']||roleChoiceOffset===0} onclick={()=>{roleChoiceOffset=Math.max(0,roleChoiceOffset-25);void loadRoleChoices();}}><ChevronLeft size={16}/></button><span>Offset {roleChoiceOffset}</span><button class="icon" title="Next role choices" aria-label="Next role choices" disabled={pending['role-choices']||!roleChoiceMore} onclick={()=>{roleChoiceOffset+=25;void loadRoleChoices();}}><ChevronRight size={16}/></button></div>
      <h3>Direct capabilities</h3><div class="filters"><label for="direct-search">Search direct grants<input id="direct-search" bind:value={directSearch} oninput={()=>directOffset=0}/></label></div>
      <ul class="grant-list">{#each directGrants.slice(directOffset,directOffset+25) as capability}<li><span>{capability}</span><button class="icon danger" title="Revoke direct capability" aria-label={'Revoke '+capability} disabled={managementBusy||userAccess.protected||!available.revokeCapability||!access.revokeCapability} onclick={()=>void userCapabilityChange(capability,true)}><X size={16}/></button></li>{:else}<li>No matching direct grants in this scope.</li>{/each}</ul>
      <div class="pagination"><button class="icon" title="Previous direct grants" aria-label="Previous direct grants" disabled={directOffset===0} onclick={()=>directOffset=Math.max(0,directOffset-25)}><ChevronLeft size={16}/></button><span>{directGrants.length} grants</span><button class="icon" title="Next direct grants" aria-label="Next direct grants" disabled={directOffset+25>=directGrants.length} onclick={()=>directOffset+=25}><ChevronRight size={16}/></button></div>
      <h3>Grant capability</h3><div class="filters"><label for="grant-capability-search">Search capabilities<input id="grant-capability-search" bind:value={capabilityChoiceSearch} oninput={()=>$userCapabilityValues.capability=''}/></label></div>
      <form class="filters" novalidate method="POST" use:enhanceUserCapability><label for="grant-capability">Capability<select id="grant-capability" name="capability" bind:value={$userCapabilityValues.capability} disabled={managementBusy} aria-invalid={!!$userCapabilityErrors.capability?.length}><option value="">Select capability</option>{#each capabilityOptions as choice}<option value={choice.name}>{choice.label} · {choice.name}</option>{/each}</select>{#each $userCapabilityErrors.capability ?? [] as message}<small class="field-error">{message}</small>{/each}</label>
        <button class="command" type="submit" disabled={managementBusy||userAccess.protected||!available.grantCapability||!access.grantCapability}><Plus size={16}/>Grant capability</button></form>
    {/if}
  {/if}
</dialog>
<dialog bind:this={dialog} aria-labelledby="confirmation-title" oncancel={()=>confirmation=null} onclose={()=>confirmation=null}>
  {#if confirmation}<h2 id="confirmation-title">{confirmation.title}</h2><p>{confirmation.message}</p><div class="toolbar"><button class="command" onclick={()=>confirmation=null}>Cancel</button><button class="command danger" onclick={()=>confirmation&&void command(confirmation)}>Confirm</button></div>{/if}
</dialog>

<style>
  .running-ops{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#4e6478;margin:8px 0}.running-ops span{display:flex;gap:6px;align-items:center}.running-ops :global(.spin),button :global(.spin){animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.running-ops :global(.spin),button :global(.spin){animation:none}}
  nav a{display:flex;gap:10px;align-items:center}.console-shell.collapsed{grid-template-columns:68px minmax(0,1fr)}.collapsed nav span,.collapsed .brand,.collapsed .return-link{display:none}.collapsed aside{padding:24px 10px}
  :global(body){margin:0} .console-shell{display:grid;grid-template-columns:216px minmax(0,1fr);min-height:100vh;background:#f8fafb;color:#20252b;font-family:inherit}
  aside{display:flex;flex-direction:column;gap:24px;padding:24px 16px;background:#fff;border-right:1px solid #dde2e6;min-width:0}.brand{font-weight:700;font-size:18px;overflow-wrap:anywhere}
  nav{display:grid;gap:4px}nav a,.return-link{padding:10px 12px;color:#535d67;text-decoration:none;border-radius:4px;overflow-wrap:anywhere}nav a.active{background:#e6f0f8;color:#164c75;font-weight:600;border-left:3px solid #3279b4}.return-link{margin-top:auto;display:flex;gap:8px;align-items:center}
  .workspace{min-width:0}.topbar{height:60px;box-sizing:border-box;border-bottom:1px solid #dde2e6;background:#fff;display:flex;align-items:center;gap:12px;padding:12px 24px}.identity{margin-left:auto;min-width:0;overflow-wrap:anywhere}
  main{padding:24px;max-width:1600px;margin:auto;min-width:0;overflow-wrap:anywhere}h1{font-size:22px;margin:0;font-weight:650}h2{font-size:17px;margin:24px 0 12px}h3{font-size:14px;margin:20px 0 8px}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}.section-title h2{margin:0}
  .command,.icon{font:inherit;border:1px solid #ced6dc;background:white;color:#273541;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:4px;min-height:36px;padding:7px 12px;flex-shrink:0}.icon{height:36px;width:36px;padding:8px}.command:hover,.icon:hover{background:#edf3f7}.command:disabled,.icon:disabled{opacity:.48;cursor:not-allowed}.danger{color:#a32c38}.text-link{font:inherit;border:0;background:transparent;padding:0;color:#185b8a;cursor:pointer;text-align:left;overflow-wrap:anywhere}
  .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;margin:0 0 24px;border-top:1px solid #dde2e6;border-bottom:1px solid #dde2e6}.metrics>div{padding:16px 12px}.metrics dt{font-size:12px;color:#62707c}.metrics dd{font-size:23px;margin:6px 0 0;font-weight:600}
  .filters,.toolbar{display:flex;align-items:end;flex-wrap:wrap;gap:12px;margin:16px 0}.filters label{display:grid;gap:6px;flex:1 1 140px;max-width:260px;font-size:12px;font-weight:600}.filters input,.filters select{font:inherit;font-weight:400;box-sizing:border-box;border:1px solid #cdd6df;border-radius:4px;background:white;min-width:0;width:100%;height:36px;padding:7px 9px}
  .table-scroll{max-width:100%;min-width:0;width:100%;overflow-x:auto;background:white;border-top:1px solid #dde2e6;border-bottom:1px solid #dde2e6}table{border-collapse:collapse;width:100%;min-width:650px;font-size:13px}th{text-align:left;padding:11px 12px;background:#f0f3f5;color:#515d68;font-size:12px;white-space:nowrap}td{padding:12px;border-top:1px solid #e7ebee;vertical-align:top;max-width:360px;overflow-wrap:anywhere}small{display:block;color:#647280;font-size:11px;margin-top:5px}.controls{display:flex;gap:6px}.log-message{min-width:240px}.pagination{display:flex;justify-content:flex-end;align-items:center;gap:12px;margin:14px 0;font-size:12px}.scope{color:#626f7b;font-size:12px}
  .error{color:#a52636;background:#fcecef;padding:10px 12px;font-size:13px;overflow-wrap:anywhere}.notice{color:#246347;background:#e9f5ef;padding:10px 12px;font-size:13px}.operation-id{font-size:11px;margin-left:8px;opacity:.7}
  .inspector,.profile-editor{border-top:2px solid #b9cbd9;margin-top:24px;padding:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:420px;overflow:auto;background:#f0f3f5;padding:12px;margin:8px 0}.error-trace{color:#97323a;background:#fbeff0}.timeline{padding-left:20px;font-size:13px}.timeline li{margin:8px 0}.timeline time{color:#626f7b}details{margin-top:8px}summary{cursor:pointer;color:#345a78}
  dialog{border:1px solid #cdd6df;border-radius:8px;width:min(420px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;padding:24px;color:#20252b}dialog::backdrop{background:rgb(20 28 35 / .42)}dialog h2{margin-top:0}.toolbar>span{margin-right:auto}
  .management-dialog{width:min(680px,calc(100vw - 32px));box-sizing:border-box;overflow-wrap:anywhere}.management-dialog .filters label{max-width:none}.grant-list{list-style:none;margin:0;padding:0}.grant-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #dde2e6;font-size:13px}.grant-list span{min-width:0;overflow-wrap:anywhere}.field-error{color:#a52636;font-weight:400}.management-dialog .section-title{align-items:center}
  @media(max-width:760px){.console-shell,.console-shell.collapsed{grid-template-columns:minmax(0,1fr)}.collapsed nav span,.collapsed .brand{display:block}.collapsed .return-link{display:flex}aside{display:none;position:fixed;inset:60px auto 0 0;width:min(260px,calc(100vw - 40px));box-sizing:border-box;z-index:20;box-shadow:12px 0 24px rgb(20 28 35 / .12)}aside.open{display:flex}.topbar{padding:12px 16px}main{padding:18px 16px}.section-title{align-items:flex-start}h1{font-size:20px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.filters label{max-width:none;flex-basis:140px}.controls{flex-wrap:wrap}.command{font-size:12px}.metrics dd{font-size:21px}}
</style>\n`;
  }
}
