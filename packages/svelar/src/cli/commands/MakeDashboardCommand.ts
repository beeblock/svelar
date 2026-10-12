/** Scaffold the monitor-backed administrative console. */
import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class MakeDashboardCommand extends Command {
  name = 'make:dashboard';
  description = 'Scaffold admin dashboard routes (health, queue, scheduler, logs)';
  arguments = [];
  flags = [{ name: 'force', alias: 'f', description: 'Overwrite existing files', type: 'boolean' as const }];

  /** Shared by new, update, and make:dashboard so their operational routes cannot drift. */
  files(): Array<{ path: string; content: string }> {
    const routes: Array<[string, Record<string, string>]> = [
      ['health', { GET: 'health' }], ['stats', { GET: 'stats' }], ['queue', { GET: 'queue' }],
      ['queue/[id]', { GET: 'job', DELETE: 'deleteJob' }], ['queue/[id]/retry', { POST: 'retryJob' }],
      ['scheduler', { GET: 'scheduler' }], ['scheduler/[name]/run', { POST: 'runTask' }],
      ['scheduler/[name]/toggle', { POST: 'toggleTask' }], ['logs', { GET: 'logs' }], ['logs/tail', { GET: 'logsTail' }],
    ];
    const files = routes.map(([path, handlers]) => ({
      path: `src/routes/api/admin/${path}/+server.ts`,
      content: `import { DashboardController } from '@beeblock/svelar/dashboard';\n\nconst controller = new DashboardController();\n${Object.entries(handlers).map(([method, handler]) => `export const ${method} = controller.handle('${handler}');`).join('\n')}\n`,
    }));
    files.push(
      { path: 'src/routes/admin/dashboard/+page.server.ts', content: this.dashboardPageServerTemplate() },
      { path: 'src/routes/admin/dashboard/+page.svelte', content: this.dashboardPageSvelteTemplate() },
    );
    return files;
  }

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    let created = 0;
    let skipped = 0;
    for (const file of this.files()) {
      const path = join(process.cwd(), file.path);
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
    this.info(`${created} file(s) created, ${skipped} skipped`);
    this.info('Open /admin/dashboard. Admin authorization and CSRF are enforced by DashboardController.');
    this.info('Customize configureDashboard({ authorize: (event, operation) => ... }) in src/app.ts for your access policy.');
    this.info('Configure Queue/JobMonitor and ScheduleMonitor in src/app.ts, load the same task registry in web and scheduler, and run migrations.');
    this.info('Use a persistent Audit driver in production. Logs are limited to the current web process.');
  }

  private dashboardPageServerTemplate(): string {
    return `import { error } from '@sveltejs/kit';
import { authorizeDashboard } from '@beeblock/svelar/dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (!await authorizeDashboard(event)) error(403, 'Dashboard access denied.');
  const query = event.url.searchParams;
  const selection = {
    queue: query.get('queue') ?? 'default', status: query.get('status') ?? 'failed',
    offset: query.get('offset') ?? '0', limit: query.get('limit') ?? '25',
    level: query.get('level') ?? '', channel: query.get('channel') ?? '', search: query.get('search') ?? '', logOffset: query.get('logOffset') ?? '0',
  };
  const queueQuery = new URLSearchParams({ queue: selection.queue, status: selection.status, offset: selection.offset, limit: selection.limit });
  const logQuery = new URLSearchParams({ limit: '25', offset: selection.logOffset });
  for (const key of ['level', 'channel', 'search'] as const) if (selection[key]) logQuery.set(key, selection[key]);
  const endpoints = { stats: '/api/admin/stats', health: '/api/admin/health', queue: '/api/admin/queue?' + queueQuery,
    scheduler: '/api/admin/scheduler', logs: '/api/admin/logs?' + logQuery };
  const panels = await Promise.all(Object.entries(endpoints).map(async ([name, url]) => {
    try {
      const response = await event.fetch(url);
      const payload = await response.json();
      if (!response.ok) return [name, { data: null, error: payload.meta?.message ?? 'Panel unavailable.' }] as const;
      return [name, { data: payload.data, meta: payload.meta, error: '' }] as const;
    } catch { return [name, { data: null, error: 'Panel unavailable.' }] as const; }
  }));
  return { panels: Object.fromEntries(panels), selection };
};
`;
  }

  private dashboardPageSvelteTemplate(): string {
    return `<script lang="ts">
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { apiFetch } from '@beeblock/svelar/http';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Play from 'lucide-svelte/icons/play';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  // svelte-ignore state_referenced_locally
  let panels = $state<any>(data.panels);
  let queueName = $state('default');
  let status = $state('failed');
  let offset = $state(0);
  let limit = $state(25);
  let level = $state('');
  let channel = $state('');
  let search = $state('');
  let logOffset = $state(0);
  let pending = $state('');
  let notice = $state('');
  let noticeError = $state(false);
  const tabs = ['overview', 'queue', 'scheduler', 'logs'] as const;
  const selectedTab = $derived(tabs.find((tab) => tab === page.url.searchParams.get('tab')) ?? 'overview');
  const topology = $derived(panels.stats?.data?.queue?.topology ?? []);
  const jobs = $derived(panels.queue?.data?.jobs ?? []);
  const tasks = $derived(panels.scheduler?.data?.tasks ?? []);
  const totalJobs = $derived(topology.reduce((sum: number, queue: any) => sum + (queue.counts?.total ?? 0), 0));
  $effect(() => {
    panels = data.panels;
    queueName = data.selection.queue; status = data.selection.status;
    offset = Number(data.selection.offset); limit = Number(data.selection.limit);
    level = data.selection.level; channel = data.selection.channel; search = data.selection.search; logOffset = Number(data.selection.logOffset);
  });

  function selectTab(tab: string) { const url = new URL(page.url); url.searchParams.set('tab', tab); replaceState(url, page.state); }
  function syncQuery() {
    const url = new URL(page.url);
    for (const [key, value] of Object.entries({ queue: queueName, status, offset, limit, level, channel, search, logOffset })) {
      if (value === '') url.searchParams.delete(key); else url.searchParams.set(key, String(value));
    }
    replaceState(url, page.state);
  }
  async function refreshPanels() {
    const queueQuery = new URLSearchParams({ queue: queueName, status, limit: String(limit), offset: String(offset) });
    const logQuery = new URLSearchParams({ limit: '25', offset: String(logOffset) });
    if (level) logQuery.set('level', level); if (channel) logQuery.set('channel', channel); if (search) logQuery.set('search', search);
    const urls = { stats: '/api/admin/stats', health: '/api/admin/health', queue: '/api/admin/queue?' + queueQuery,
      scheduler: '/api/admin/scheduler', logs: '/api/admin/logs?' + logQuery };
    const next = await Promise.all(Object.entries(urls).map(async ([name, url]) => {
      try {
        const response = await apiFetch(url, { showToast: false }); const payload = await response.json();
        if (!response.ok) return [name, { data: null, error: payload.meta?.message ?? 'Panel unavailable.' }];
        return [name, { data: payload.data, meta: payload.meta, error: '' }];
      } catch { return [name, { data: null, error: 'Panel unavailable.' }]; }
    }));
    panels = Object.fromEntries(next);
  }
  async function refreshData() { if (pending) return; pending = 'refresh'; try { syncQuery(); await refreshPanels(); } finally { pending = ''; } }
  async function filterJobs() { offset = 0; await refreshData(); }
  async function filterLogs() { logOffset = 0; await refreshData(); }
  async function jobPage(direction: number) { offset = Math.max(0, offset + direction * limit); await refreshData(); }
  async function logPage(direction: number) { logOffset = Math.max(0, logOffset + direction * 25); await refreshData(); }
  async function postAction(key: string, url: string, body: Record<string, unknown>, method = 'POST') {
    if (pending) return; pending = key; notice = ''; noticeError = false;
    try {
      const response = await apiFetch(url, { method, showToast: false, body: JSON.stringify(body) }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.meta?.message ?? 'Dashboard action failed.');
      notice = [payload.meta?.message ?? 'Action completed.', payload.meta?.auditWarning].filter(Boolean).join(' ');
      await refreshPanels();
    } catch (error) { notice = error instanceof Error ? error.message : 'Dashboard action failed.'; noticeError = true; }
    finally { pending = ''; }
  }
  async function retryJob(job: any) {
    if (pending || !confirm('Retry job ' + job.id + '? This can repeat external side effects.')) return;
    await postAction('retry:' + job.id, '/api/admin/queue/' + encodeURIComponent(job.id) + '/retry?queue=' + encodeURIComponent(job.queue), {});
  }
  async function deleteJob(job: any) {
    if (pending || !confirm('Delete job ' + job.id + '? This cannot be undone.')) return;
    await postAction('delete:' + job.id, '/api/admin/queue/' + encodeURIComponent(job.id) + '?queue=' + encodeURIComponent(job.queue), { confirmed: true }, 'DELETE');
  }
  async function runTask(name: string) {
    if (pending || !confirm('Run task ' + name + ' now?')) return;
    await postAction('run:' + name, '/api/admin/scheduler/' + encodeURIComponent(name) + '/run', {});
  }
  async function toggleTask(name: string, enabled: boolean) {
    if (pending || (!enabled && !confirm('Disable task ' + name + '?'))) return;
    await postAction('toggle:' + name, '/api/admin/scheduler/' + encodeURIComponent(name) + '/toggle', { enabled });
  }
  function date(value: string | number | null | undefined) { return value == null ? 'Unknown' : new Date(value).toLocaleString(); }
  function json(value: unknown) { return JSON.stringify(value, null, 2); }
</script>

<svelte:head><title>Admin Dashboard</title></svelte:head>
<div class="dashboard" aria-busy={Boolean(pending)}>
  <header><h1>Admin Dashboard</h1><button title="Refresh dashboard" aria-label="Refresh dashboard" disabled={Boolean(pending)} onclick={refreshData}><RefreshCw size={18} class={pending === 'refresh' ? 'spinning' : ''} /></button></header>
  <nav aria-label="Dashboard sections">{#each tabs as tab}<a href={'?tab=' + tab} aria-current={selectedTab === tab ? 'page' : undefined} onclick={(event) => { event.preventDefault(); selectTab(tab); }}>{tab}</a>{/each}</nav>
  {#if notice}<p role={noticeError ? 'alert' : 'status'} class:error={noticeError}>{notice}</p>{/if}
  {#each Object.entries(panels) as [name, panel]}{#if (panel as any)?.error}<p role="alert">{name}: {(panel as any).error}</p>{/if}{/each}
  <main>
    {#if selectedTab === 'overview'}
      <h2>System Overview</h2>
      <dl class="metrics">
        <div><dt>Jobs (observed queues)</dt><dd>{panels.stats?.data ? totalJobs : 'Unknown'}</dd></div>
        <div><dt>Scheduled Tasks</dt><dd>{panels.scheduler?.data?.health?.totalTasks ?? 'Unknown'}</dd></div>
        <div><dt>Recent Errors</dt><dd>{panels.stats?.data?.recentErrors?.length ?? 'Unknown'}</dd></div>
        <div><dt>Web Uptime</dt><dd>{panels.health?.data ? (panels.health.data.uptime / 3600).toFixed(2) + ' h' : 'Unknown'}</dd></div>
        <div><dt>Web Heap Used</dt><dd>{panels.health?.data ? (panels.health.data.memory.heapUsed / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'}</dd></div>
      </dl>
      <h2>Queues</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Queue / Connection</th><th>Waiting</th><th>Active</th><th>Failed</th><th>Completed</th><th>Delayed</th><th>Workers</th><th>Concurrency (effective / configured / global)</th><th>Paused</th><th>Lag</th><th>Oldest Waiting</th></tr></thead>
        <tbody>{#each topology as queue}<tr>
          <td><button disabled={Boolean(pending) || !queue.counts} onclick={() => { queueName = queue.name; selectTab('queue'); filterJobs(); }}>{queue.definition?.label ?? queue.name}</button><small>{queue.name} / {queue.definition?.connection ?? 'default connection'}</small>{#if queue.definition?.metadata}<details><summary>Metadata</summary><pre>{json(queue.definition.metadata)}</pre></details>{/if}</td>
          {#each ['waiting', 'active', 'failed', 'completed', 'delayed'] as state}<td>{queue.counts?.[state] ?? 'Unknown'}</td>{/each}
          <td>{queue.runtime?.workers ?? 'Unknown'}</td><td>{queue.runtime?.effectiveConcurrency ?? 'Unknown'} / {queue.definition?.concurrency ?? 'Unknown'} / {queue.runtime?.globalConcurrency ?? 'Unknown'}</td>
          <td>{queue.runtime?.paused == null ? 'Unknown' : queue.runtime.paused ? 'Yes' : 'No'}</td><td>{queue.runtime?.lag == null ? 'Unknown' : Math.round(queue.runtime.lag / 1000) + ' s'}</td><td>{date(queue.runtime?.oldestWaitingJob)}</td>
        </tr>{:else}<tr><td colspan="11">No queue topology available.</td></tr>{/each}</tbody>
      </table></div>
    {:else if selectedTab === 'queue'}
      <h2>Job Queue</h2>
      <form class="filters" onsubmit={(event) => { event.preventDefault(); filterJobs(); }}>
        <label>Queue<select bind:value={queueName} disabled={Boolean(pending)} onchange={filterJobs}>{#if !topology.some((entry: any) => entry.name === queueName)}<option value={queueName}>{queueName}</option>{/if}{#each topology as entry}<option value={entry.name} disabled={!entry.counts}>{entry.definition?.label ?? entry.name}</option>{/each}</select></label>
        <label>Status<select bind:value={status} disabled={Boolean(pending)} onchange={filterJobs}>{#each ['waiting', 'active', 'failed', 'completed', 'delayed'] as state}<option value={state}>{state}</option>{/each}</select></label>
        <label>Page Size<select bind:value={limit} disabled={Boolean(pending)} onchange={filterJobs}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      </form>
      {#if panels.queue?.data?.counts}<dl class="metrics">{#each Object.entries(panels.queue.data.counts) as [state, count]}<div><dt>{state}</dt><dd>{count}</dd></div>{/each}</dl>{/if}
      <div class="table-wrap"><table><thead><tr><th>Job</th><th>Status</th><th>Attempts</th><th>Created</th><th>Inspection</th><th>Actions</th></tr></thead>
        <tbody>{#each jobs as job}<tr>
          <td>{job.jobClass}<small>{job.id} / {job.queue}</small></td><td>{job.status}</td><td>{job.attempts} / {job.maxAttempts}</td><td>{date(job.createdAt)}</td>
          <td><details><summary>Details</summary>{#if job.error}<h3>Error</h3><pre>{job.error}</pre>{/if}<h3>Payload</h3><pre>{json(job.payload)}</pre><h3>Metadata</h3><pre>{json(job.metadata)}</pre><h3>Progress</h3><pre>{json(job.progress)}</pre><h3>Timeline</h3>{#each job.timeline ?? [] as entry}<p>{entry.event}: {date(entry.timestamp)}</p>{/each}</details></td>
          <td><div class="actions">{#if job.status === 'failed'}<button aria-label={'Retry job ' + job.id} title="Retry job" aria-busy={pending === 'retry:' + job.id} disabled={Boolean(pending)} onclick={() => retryJob(job)}><RotateCcw size={16} /></button>{/if}<button class="danger" aria-label={'Delete job ' + job.id} title="Delete job" aria-busy={pending === 'delete:' + job.id} disabled={Boolean(pending) || job.status === 'active'} onclick={() => deleteJob(job)}><Trash2 size={16} /></button></div></td>
        </tr>{:else}<tr><td colspan="6">{panels.queue?.error ? 'Jobs unavailable.' : 'No jobs found.'}</td></tr>{/each}</tbody>
      </table></div>
      <div class="pager"><button title="Previous jobs page" aria-label="Previous jobs page" disabled={Boolean(pending) || offset <= 0} onclick={() => jobPage(-1)}><ChevronLeft size={18} /></button><span>{offset + (jobs.length ? 1 : 0)} - {offset + jobs.length} / {panels.queue?.meta?.total ?? 'Unknown'}</span><button title="Next jobs page" aria-label="Next jobs page" disabled={Boolean(pending) || !panels.queue?.meta?.hasMore} onclick={() => jobPage(1)}><ChevronRight size={18} /></button></div>
    {:else if selectedTab === 'scheduler'}
      <h2>Scheduled Tasks</h2>
      <div class="table-wrap"><table><thead><tr><th>Task</th><th>Schedule</th><th>Last / Next Run</th><th>Duration / Status</th><th>History</th><th>Enabled</th><th>Run</th></tr></thead>
        <tbody>{#each tasks as task}<tr><td>{task.name}</td><td>{task.humanReadable}<small>{task.expression}</small></td><td>{date(task.lastRun)}<small>{date(task.nextRun)}</small></td><td>{task.lastDuration == null ? 'Unknown' : task.lastDuration + ' ms'}<small>{task.isRunning ? 'Running (web process)' : task.lastStatus ?? 'Not run'}</small></td>
          <td><details><summary>Runs</summary>{#each task.history as run}<p>{date(run.timestamp)}: {run.success ? 'success' : 'failed'} ({run.duration} ms)</p>{#if run.error}<pre>{run.error}</pre>{/if}{:else}<p>No history.</p>{/each}</details></td>
          <td><input type="checkbox" aria-label={'Enable task ' + task.name} checked={task.enabled} disabled={Boolean(pending)} onchange={(event) => { const enabled = event.currentTarget.checked; event.currentTarget.checked = task.enabled; toggleTask(task.name, enabled); }} /></td><td><button title="Run task now" aria-label={'Run task ' + task.name} aria-busy={pending === 'run:' + task.name} disabled={Boolean(pending) || task.isRunning || !task.enabled} onclick={() => runTask(task.name)}><Play size={16} /></button></td>
        </tr>{:else}<tr><td colspan="7">{panels.scheduler?.error ? 'Scheduler unavailable.' : 'No scheduled tasks registered.'}</td></tr>{/each}</tbody>
      </table></div>
    {:else if selectedTab === 'logs'}
      <h2>Application Logs</h2><p>Scope: {panels.logs?.data?.scope ?? 'Unknown'}</p>
      <form class="filters" onsubmit={(event) => { event.preventDefault(); filterLogs(); }}><label>Minimum Level<select bind:value={level} disabled={Boolean(pending)}><option value="">All</option>{#each ['debug', 'info', 'warn', 'error', 'fatal'] as value}<option value={value}>{value}</option>{/each}</select></label><label>Channel<input bind:value={channel} maxlength="255" disabled={Boolean(pending)} /></label><label>Search<input type="search" bind:value={search} maxlength="500" disabled={Boolean(pending)} /></label><button disabled={Boolean(pending)} type="submit">Search</button></form>
      <div class="table-wrap"><table><thead><tr><th>Time</th><th>Level / Channel</th><th>Message / Context</th></tr></thead><tbody>{#each panels.logs?.data?.logs ?? [] as log}<tr><td>{date(log.timestamp)}</td><td>{log.level}<small>{log.channel}</small></td><td>{log.message}<details><summary>Context</summary><pre>{json(log.context)}</pre></details></td></tr>{:else}<tr><td colspan="3">{panels.logs?.error ? 'Logs unavailable.' : 'No log entries found.'}</td></tr>{/each}</tbody></table></div>
      <div class="pager"><button title="Previous logs page" aria-label="Previous logs page" disabled={Boolean(pending) || logOffset <= 0} onclick={() => logPage(-1)}><ChevronLeft size={18} /></button><span>{logOffset + (panels.logs?.data?.logs?.length ? 1 : 0)} - {logOffset + (panels.logs?.data?.logs?.length ?? 0)} / {panels.logs?.data?.total ?? 'Unknown'}</span><button title="Next logs page" aria-label="Next logs page" disabled={Boolean(pending) || logOffset + 25 >= (panels.logs?.data?.total ?? 0)} onclick={() => logPage(1)}><ChevronRight size={18} /></button></div>
    {/if}
  </main>
</div>

<style>
  .dashboard { max-width: 1440px; margin: 0 auto; padding: 24px; color: #1f2937; background: #fff; }
  header, .actions, .pager, .filters { display: flex; align-items: center; gap: 12px; }
  header { justify-content: space-between; } h1 { font-size: 24px; margin: 0; } h2 { font-size: 20px; margin: 24px 0 16px; } h3 { font-size: 14px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid #d1d5db; margin: 20px 0; }
  nav a { padding: 12px; color: #374151; text-transform: capitalize; text-decoration: none; border-bottom: 3px solid transparent; }
  nav a[aria-current="page"] { color: #075985; border-color: #0284c7; }
  button { min-width: 40px; min-height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 8px; border: 1px solid #9ca3af; border-radius: 4px; background: #fff; color: #075985; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; } .danger { color: #b91c1c; }
  :global(.spinning) { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
  .metrics { display: flex; flex-wrap: wrap; gap: 24px; padding: 16px 0; border-bottom: 1px solid #d1d5db; }
  dt { color: #4b5563; font-size: 13px; text-transform: capitalize; } dd { margin: 4px 0 0; font-size: 22px; font-weight: 600; }
  .filters { flex-wrap: wrap; margin-bottom: 16px; align-items: end; } label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
  select, input:not([type="checkbox"]) { box-sizing: border-box; min-height: 40px; max-width: 100%; padding: 8px; border: 1px solid #9ca3af; border-radius: 4px; background: #fff; color: #1f2937; }
  input[type="checkbox"] { width: 20px; height: 20px; } .table-wrap { max-width: 100%; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; } th, td { text-align: left; vertical-align: top; padding: 12px; border-bottom: 1px solid #e5e7eb; }
  th { background: #f3f4f6; white-space: nowrap; font-size: 12px; } td { max-width: 420px; overflow-wrap: anywhere; }
  small { display: block; margin-top: 4px; color: #4b5563; } summary { cursor: pointer; padding: 8px 0; color: #075985; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 420px; font-size: 12px; background: #f3f4f6; padding: 12px; }
  [role="alert"], .error { color: #b91c1c; } .pager { justify-content: center; margin-top: 16px; }
  :focus-visible { outline: 2px solid #0284c7; outline-offset: 2px; }
  @media (max-width: 640px) { .dashboard { padding: 12px; } .filters > label { width: 100%; } h1 { font-size: 22px; } }
  @media (prefers-reduced-motion: reduce) { :global(.spinning) { animation: none; } }
</style>
`;
  }
}
