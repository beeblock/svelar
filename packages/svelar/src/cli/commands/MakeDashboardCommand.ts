/**
 * make:dashboard — Scaffold admin dashboard routes
 *
 * Creates API routes and dashboard page for monitoring:
 * - System health
 * - Job queue (BullMQ)
 * - Scheduled tasks
 * - Application logs
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeDashboardCommand extends Command {
  name = 'make:dashboard';
  description = 'Scaffold admin dashboard routes (health, queue, scheduler, logs)';
  arguments = [];
  flags = [
    { name: 'force', alias: 'f', description: 'Overwrite existing files', type: 'boolean' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const cwd = process.cwd();
    const force = flags.force ?? false;

    const files: Array<{ path: string; content: string; label: string }> = [
      // API Routes
      {
        path: join(cwd, 'src/routes/api/admin/health/+server.ts'),
        content: this.healthServerTemplate(),
        label: 'api/admin/health/+server.ts',
      },
      {
        path: join(cwd, 'src/routes/api/admin/queue/+server.ts'),
        content: this.queueServerTemplate(),
        label: 'api/admin/queue/+server.ts',
      },
      {
        path: join(cwd, 'src/routes/api/admin/queue/[id]/retry/+server.ts'),
        content: this.queueRetryServerTemplate(),
        label: 'api/admin/queue/[id]/retry/+server.ts',
      },
      {
        path: join(cwd, 'src/routes/api/admin/queue/[id]/+server.ts'),
        content: this.queueDeleteServerTemplate(),
        label: 'api/admin/queue/[id]/+server.ts',
      },
      {
        path: join(cwd, 'src/routes/api/admin/scheduler/+server.ts'),
        content: this.schedulerServerTemplate(),
        label: 'api/admin/scheduler/+server.ts',
      },
      {
        path: join(cwd, 'src/routes/api/admin/scheduler/[name]/run/+server.ts'),
        content: this.schedulerRunServerTemplate(),
        label: 'api/admin/scheduler/[name]/run/+server.ts',
      },
      {
        path: join(cwd, 'src/routes/api/admin/scheduler/[name]/toggle/+server.ts'),
        content: this.schedulerToggleServerTemplate(),
        label: 'api/admin/scheduler/[name]/toggle/+server.ts',
      },
      {
        path: join(cwd, 'src/routes/api/admin/logs/+server.ts'),
        content: this.logsServerTemplate(),
        label: 'api/admin/logs/+server.ts',
      },
      {
        path: join(cwd, 'src/routes/api/admin/logs/tail/+server.ts'),
        content: this.logsTailServerTemplate(),
        label: 'api/admin/logs/tail/+server.ts',
      },
      {
        path: join(cwd, 'src/routes/api/admin/stats/+server.ts'),
        content: this.statsServerTemplate(),
        label: 'api/admin/stats/+server.ts',
      },
      // Dashboard Page
      {
        path: join(cwd, 'src/routes/admin/dashboard/+page.server.ts'),
        content: this.dashboardPageServerTemplate(),
        label: 'admin/dashboard/+page.server.ts',
      },
      {
        path: join(cwd, 'src/routes/admin/dashboard/+page.svelte'),
        content: this.dashboardPageSvelteTemplate(),
        label: 'admin/dashboard/+page.svelte',
      },
    ];

    let created = 0;
    let skipped = 0;

    for (const file of files) {
      // Create directory if needed
      const dir = file.path.substring(0, file.path.lastIndexOf('/'));
      mkdirSync(dir, { recursive: true });

      if (existsSync(file.path) && !force) {
        this.warn(`${file.label} already exists (use --force to overwrite)`);
        skipped++;
        continue;
      }

      writeFileSync(file.path, file.content);
      this.success(`Created ${file.label}`);
      created++;
    }

    this.newLine();
    if (created > 0) {
      this.info(`${created} file(s) created${skipped > 0 ? `, ${skipped} skipped` : ''}`);
    } else {
      this.info('No files created (all exist already)');
    }

    this.newLine();
    this.info('Setup instructions:');
    this.log('  1. Import dashboard modules in your app:');
    this.log('     import { ScheduleMonitor } from "@beeblock/svelar/scheduler/ScheduleMonitor";');
    this.log('     import { JobMonitor } from "@beeblock/svelar/queue/JobMonitor";');
    this.log('     import { LogViewer } from "@beeblock/svelar/logging/LogViewer";');
    this.newLine();
    this.log('  2. Configure auth middleware on admin routes:');
    this.log('     - API routes require event.locals.user.role === "admin" by default.');
    this.log('     - Adjust the generated requireAdmin check if your app uses a different admin contract.');
    this.newLine();
    this.log('  3. Access the dashboard:');
    this.log('     - Navigate to: /admin/dashboard');
    this.newLine();
    this.log('  4. API endpoints available at:');
    this.log('     - GET  /api/admin/health');
    this.log('     - GET  /api/admin/queue');
    this.log('     - GET  /api/admin/scheduler');
    this.log('     - GET  /api/admin/logs');
    this.log('     - GET  /api/admin/stats');
    this.newLine();
  }

  // ── API Route Templates ──

  private healthServerTemplate(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * GET /api/admin/health
 * Returns system health status
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }


  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '0.1.0',
  };

  return json(health);
};
`;
  }

  private queueServerTemplate(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * GET /api/admin/queue
 * List jobs from the queue
 *
 * Query params:
 * - status: 'completed' | 'failed' | 'delayed' | 'active' | 'waiting'
 * - queue: queue name (default: 'default')
 * - limit: number of jobs (default: 50)
 * - offset: pagination offset (default: 0)
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }


  const { searchParams } = event.url;
  const status = searchParams.get('status') || 'all';
  const queueName = searchParams.get('queue') || 'default';
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const { JobMonitor } = await import('@beeblock/svelar/queue/JobMonitor');

    const jobs = await JobMonitor.listJobs({
      queue: queueName,
      status: status === 'all' ? undefined : status as any,
      limit,
      offset,
    });

    const counts = await JobMonitor.getCounts(queueName);

    return json({
      jobs,
      counts,
      queueName,
    });
  } catch (error: any) {
    return json(
      {
        error: error.message || 'Failed to fetch queue jobs',
      },
      { status: 500 }
    );
  }
};
`;
  }

  private queueRetryServerTemplate(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * POST /api/admin/queue/[id]/retry
 * Retry a failed job
 */
export const POST: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }


  const { id } = event.params;

  try {
    const { JobMonitor } = await import('@beeblock/svelar/queue/JobMonitor');
    await JobMonitor.retryJob(id);

    return json({ success: true, message: 'Job queued for retry' });
  } catch (error: any) {
    return json(
      {
        error: error.message || 'Failed to retry job',
      },
      { status: 500 }
    );
  }
};
`;
  }

  private queueDeleteServerTemplate(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * DELETE /api/admin/queue/[id]
 * Remove a job from the queue
 */
export const DELETE: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }


  const { id } = event.params;

  try {
    const { JobMonitor } = await import('@beeblock/svelar/queue/JobMonitor');
    await JobMonitor.deleteJob(id);

    return json({ success: true, message: 'Job removed' });
  } catch (error: any) {
    return json(
      {
        error: error.message || 'Failed to remove job',
      },
      { status: 500 }
    );
  }
};
`;
  }

  private schedulerServerTemplate(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * GET /api/admin/scheduler
 * List all scheduled tasks
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }


  try {
    const { ScheduleMonitor } = await import('@beeblock/svelar/scheduler/ScheduleMonitor');

    const tasks = await ScheduleMonitor.listTasks();
    const health = await ScheduleMonitor.getHealth();

    return json({
      tasks,
      health,
    });
  } catch (error: any) {
    return json(
      {
        error: error.message || 'Failed to fetch scheduled tasks',
      },
      { status: 500 }
    );
  }
};
`;
  }

  private schedulerRunServerTemplate(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * POST /api/admin/scheduler/[name]/run
 * Manually trigger a scheduled task
 */
export const POST: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }


  const { name } = event.params;

  try {
    const { ScheduleMonitor } = await import('@beeblock/svelar/scheduler/ScheduleMonitor');
    await ScheduleMonitor.runTask(name);

    return json({ success: true, message: \`Task '\${name}' triggered\` });
  } catch (error: any) {
    return json(
      {
        error: error.message || 'Failed to run task',
      },
      { status: 500 }
    );
  }
};
`;
  }

  private schedulerToggleServerTemplate(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * POST /api/admin/scheduler/[name]/toggle
 * Enable or disable a scheduled task
 */
export const POST: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }


  const { name } = event.params;
  const body = await event.request.json();
  const enabled = body.enabled ?? true;

  try {
    const { ScheduleMonitor } = await import('@beeblock/svelar/scheduler/ScheduleMonitor');
    if (enabled) {
      ScheduleMonitor.enableTask(name);
    } else {
      ScheduleMonitor.disableTask(name);
    }

    return json({ success: true, message: \`Task '\${name}' \${enabled ? 'enabled' : 'disabled'}\` });
  } catch (error: any) {
    return json(
      {
        error: error.message || 'Failed to toggle task',
      },
      { status: 500 }
    );
  }
};
`;
  }

  private logsServerTemplate(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * GET /api/admin/logs
 * Retrieve logs with filtering
 *
 * Query params:
 * - level: 'debug' | 'info' | 'warn' | 'error'
 * - channel: log channel name
 * - search: search term
 * - limit: number of logs (default: 100)
 * - offset: pagination offset (default: 0)
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }


  const { searchParams } = event.url;
  const level = searchParams.get('level');
  const channel = searchParams.get('channel');
  const search = searchParams.get('search');
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const { LogViewer } = await import('@beeblock/svelar/logging/LogViewer');

    const logs = LogViewer.query({
      level: level as any,
      channel: channel ?? undefined,
      search: search ?? undefined,
      limit,
      offset,
    });

    const stats = LogViewer.getStats();

    return json({
      logs,
      total: stats.totalEntries,
      limit,
      offset,
    });
  } catch (error: any) {
    return json(
      {
        error: error.message || 'Failed to fetch logs',
      },
      { status: 500 }
    );
  }
};
`;
  }

  private logsTailServerTemplate(): string {
    return `import type { RequestHandler } from '@sveltejs/kit';

/**
 * GET /api/admin/logs/tail
 * Server-Sent Events stream of live logs
 *
 * Returns a text/event-stream response with real-time log entries
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }


  const { LogViewer } = await import('@beeblock/svelar/logging/LogViewer');

  // Set up SSE headers
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  };

  // Create a readable stream using the tail() subscription
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const unsubscribe = LogViewer.tail((entry) => {
        try {
          controller.enqueue(encoder.encode(\`data: \${JSON.stringify(entry)}\n\n\`));
        } catch {
          unsubscribe();
        }
      });

      // Clean up when the client disconnects
      event.request.signal.addEventListener('abort', () => {
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, { headers });
};
`;
  }

  private statsServerTemplate(): string {
    return `import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * GET /api/admin/stats
 * Dashboard overview statistics
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user || event.locals.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }


  try {
    const { JobMonitor } = await import('@beeblock/svelar/queue/JobMonitor');
    const { ScheduleMonitor } = await import('@beeblock/svelar/scheduler/ScheduleMonitor');
    const { LogViewer } = await import('@beeblock/svelar/logging/LogViewer');

    const [queueHealth, recentErrors] = await Promise.all([
      JobMonitor.getHealth(),
      Promise.resolve(LogViewer.getRecentErrors(10)),
    ]);

    const schedulerHealth = await ScheduleMonitor.getHealth();
    const logStats = LogViewer.getStats();

    return json({
      queue: queueHealth,
      scheduler: schedulerHealth,
      logs: logStats,
      recentErrors,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return json(
      {
        error: error.message || 'Failed to fetch stats',
      },
      { status: 500 }
    );
  }
};
`;
  }

  // ── Dashboard Page Templates ──

	  private dashboardPageServerTemplate(): string {
	    return `import type { PageServerLoad } from './$types';

	export const load: PageServerLoad = async ({ fetch }) => {
	  try {
	    const [statsRes, healthRes, queueRes, schedulerRes, logsRes] = await Promise.all([
	      fetch('/api/admin/stats'),
	      fetch('/api/admin/health'),
	      fetch('/api/admin/queue?limit=10'),
	      fetch('/api/admin/scheduler'),
	      fetch('/api/admin/logs?limit=25'),
	    ]);

	    const [stats, health, queue, scheduler, logs] = await Promise.all([
	      statsRes.json(),
	      healthRes.json(),
	      queueRes.json(),
	      schedulerRes.json(),
	      logsRes.json(),
	    ]);

	    return {
	      stats,
	      health,
	      queue,
	      scheduler,
	      logs,
	    };
	  } catch (error) {
	    console.error('Failed to load dashboard:', error);
	    return {
	      stats: null,
	      health: null,
	      queue: null,
	      scheduler: null,
	      logs: null,
	      error: 'Failed to load dashboard data',
	    };
	  }
};
`;
  }

  private dashboardPageSvelteTemplate(): string {
    return `<script lang="ts">
  import type { PageData } from './$types';

  export let data: PageData;

	  let selectedTab: 'overview' | 'queue' | 'scheduler' | 'logs' = 'overview';
	  let loading = false;
	  let actionMessage = '';

	  async function refreshData() {
	    loading = true;
	    actionMessage = '';
	    try {
	      const [statsRes, healthRes, queueRes, schedulerRes, logsRes] = await Promise.all([
	        fetch('/api/admin/stats'),
	        fetch('/api/admin/health'),
	        fetch('/api/admin/queue?limit=10'),
	        fetch('/api/admin/scheduler'),
	        fetch('/api/admin/logs?limit=25'),
	      ]);
	      data.stats = await statsRes.json();
	      data.health = await healthRes.json();
	      data.queue = await queueRes.json();
	      data.scheduler = await schedulerRes.json();
	      data.logs = await logsRes.json();
	    } catch (error) {
	      console.error('Failed to refresh:', error);
	      actionMessage = 'Failed to refresh dashboard data';
	    } finally {
	      loading = false;
	    }
	  }

	  async function retryJob(id: string) {
	    await postAction(\`/api/admin/queue/\${id}/retry\`, {});
	  }

	  async function deleteJob(id: string) {
	    await postAction(\`/api/admin/queue/\${id}\`, {}, 'DELETE');
	  }

	  async function runTask(name: string) {
	    await postAction(\`/api/admin/scheduler/\${encodeURIComponent(name)}/run\`, {});
	  }

	  async function toggleTask(name: string, enabled: boolean) {
	    await postAction(\`/api/admin/scheduler/\${encodeURIComponent(name)}/toggle\`, { enabled });
	  }

	  async function postAction(url: string, body: Record<string, unknown>, method = 'POST') {
	    loading = true;
	    actionMessage = '';
	    try {
	      const response = await fetch(url, {
	        method,
	        headers: { 'content-type': 'application/json' },
	        body: method === 'DELETE' ? undefined : JSON.stringify(body),
	      });
	      const payload = await response.json().catch(() => ({}));
	      if (!response.ok) throw new Error(payload.error ?? 'Dashboard action failed');
	      actionMessage = payload.message ?? 'Action completed';
	      await refreshData();
	    } catch (error: any) {
	      actionMessage = error.message ?? 'Dashboard action failed';
	    } finally {
	      loading = false;
	    }
	  }
</script>

<div class="dashboard">
	  <header class="dashboard-header">
	    <h1>Admin Dashboard</h1>
	    <button on:click={refreshData} disabled={loading}>
	      {loading ? 'Refreshing...' : 'Refresh'}
	    </button>
	  </header>

	  {#if actionMessage}
	    <p class="notice">{actionMessage}</p>
	  {/if}

  <nav class="tabs">
    <button
      class:active={selectedTab === 'overview'}
      on:click={() => (selectedTab = 'overview')}
    >
      Overview
    </button>
    <button
      class:active={selectedTab === 'queue'}
      on:click={() => (selectedTab = 'queue')}
    >
      Queue
    </button>
    <button
      class:active={selectedTab === 'scheduler'}
      on:click={() => (selectedTab = 'scheduler')}
    >
      Scheduler
    </button>
    <button
      class:active={selectedTab === 'logs'}
      on:click={() => (selectedTab = 'logs')}
    >
      Logs
    </button>
  </nav>

  <main class="dashboard-content">
    {#if selectedTab === 'overview'}
      <section class="overview">
        <h2>System Overview</h2>

        {#if data.health}
          <div class="health-card">
            <h3>System Health</h3>
            <p>Status: <strong>{data.health.status}</strong></p>
            <p>Uptime: {(data.health.uptime / 3600).toFixed(2)} hours</p>
            <p>Memory: {(data.health.memory.heapUsed / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        {/if}

        {#if data.stats}
          <div class="stats-grid">
	            <div class="stat-card">
	              <h3>Queue Jobs</h3>
	              <p class="stat-number">{data.stats.queue?.queues?.default?.total || 0}</p>
	              <small>Active: {data.stats.queue?.queues?.default?.active || 0}</small>
	            </div>

	            <div class="stat-card">
	              <h3>Scheduled Tasks</h3>
	              <p class="stat-number">{data.stats.scheduler?.totalTasks || 0}</p>
	              <small>Enabled: {data.stats.scheduler?.enabledTasks || 0}</small>
	            </div>

            <div class="stat-card">
              <h3>Recent Errors</h3>
              <p class="stat-number">{data.stats.recentErrors?.length || 0}</p>
              <small>Last 24 hours</small>
            </div>
          </div>
        {/if}
      </section>
	    {:else if selectedTab === 'queue'}
	      <section class="queue">
	        <h2>Job Queue</h2>
	        {#if data.queue?.counts}
	          <div class="stats-grid compact">
	            <div class="stat-card"><h3>Waiting</h3><p class="stat-number">{data.queue.counts.waiting}</p></div>
	            <div class="stat-card"><h3>Active</h3><p class="stat-number">{data.queue.counts.active}</p></div>
	            <div class="stat-card"><h3>Failed</h3><p class="stat-number">{data.queue.counts.failed}</p></div>
	            <div class="stat-card"><h3>Delayed</h3><p class="stat-number">{data.queue.counts.delayed}</p></div>
	          </div>
	        {/if}

	        <div class="table-wrap">
	          <table>
	            <thead>
	              <tr>
	                <th>ID</th>
	                <th>Job</th>
	                <th>Queue</th>
	                <th>Status</th>
	                <th>Attempts</th>
	                <th>Created</th>
	                <th>Actions</th>
	              </tr>
	            </thead>
	            <tbody>
	              {#each data.queue?.jobs ?? [] as job}
	                <tr>
	                  <td class="mono">{job.id}</td>
	                  <td>{job.jobClass}</td>
	                  <td>{job.queue}</td>
	                  <td><span class="badge {job.status}">{job.status}</span></td>
	                  <td>{job.attempts}/{job.maxAttempts}</td>
	                  <td>{new Date(job.createdAt).toLocaleString()}</td>
	                  <td class="actions">
	                    {#if job.status === 'failed'}
	                      <button on:click={() => retryJob(job.id)} disabled={loading}>Retry</button>
	                    {/if}
	                    <button class="danger" on:click={() => deleteJob(job.id)} disabled={loading}>Delete</button>
	                  </td>
	                </tr>
	              {:else}
	                <tr><td colspan="7" class="empty">No jobs found.</td></tr>
	              {/each}
	            </tbody>
	          </table>
	        </div>
	      </section>
	    {:else if selectedTab === 'scheduler'}
	      <section class="scheduler">
	        <h2>Scheduled Tasks</h2>
	        {#if data.scheduler?.health}
	          <div class="stats-grid compact">
	            <div class="stat-card"><h3>Total</h3><p class="stat-number">{data.scheduler.health.totalTasks}</p></div>
	            <div class="stat-card"><h3>Enabled</h3><p class="stat-number">{data.scheduler.health.enabledTasks}</p></div>
	            <div class="stat-card"><h3>Running</h3><p class="stat-number">{data.scheduler.health.runningTasks}</p></div>
	          </div>
	        {/if}

	        <div class="table-wrap">
	          <table>
	            <thead>
	              <tr>
	                <th>Task</th>
	                <th>Schedule</th>
	                <th>Next Run</th>
	                <th>Last Status</th>
	                <th>Enabled</th>
	                <th>Actions</th>
	              </tr>
	            </thead>
	            <tbody>
	              {#each data.scheduler?.tasks ?? [] as task}
	                <tr>
	                  <td>{task.name}</td>
	                  <td>{task.humanReadable}</td>
	                  <td>{task.nextRun ? new Date(task.nextRun).toLocaleString() : 'n/a'}</td>
	                  <td><span class="badge {task.lastStatus ?? 'waiting'}">{task.lastStatus ?? 'waiting'}</span></td>
	                  <td>{task.enabled ? 'Yes' : 'No'}</td>
	                  <td class="actions">
	                    <button on:click={() => runTask(task.name)} disabled={loading || task.isRunning}>Run</button>
	                    <button on:click={() => toggleTask(task.name, !task.enabled)} disabled={loading}>
	                      {task.enabled ? 'Disable' : 'Enable'}
	                    </button>
	                  </td>
	                </tr>
	              {:else}
	                <tr><td colspan="6" class="empty">No scheduled tasks registered.</td></tr>
	              {/each}
	            </tbody>
	          </table>
	        </div>
	      </section>
	    {:else if selectedTab === 'logs'}
	      <section class="logs">
	        <h2>Application Logs</h2>
	        {#if data.logs}
	          <div class="stats-grid compact">
	            <div class="stat-card"><h3>Total</h3><p class="stat-number">{data.logs.total ?? 0}</p></div>
	            <div class="stat-card"><h3>Limit</h3><p class="stat-number">{data.logs.limit ?? 0}</p></div>
	          </div>
	        {/if}

	        <div class="table-wrap">
	          <table>
	            <thead>
	              <tr>
	                <th>Time</th>
	                <th>Level</th>
	                <th>Channel</th>
	                <th>Message</th>
	              </tr>
	            </thead>
	            <tbody>
	              {#each data.logs?.logs ?? [] as log}
	                <tr>
	                  <td>{new Date(log.timestamp).toLocaleString()}</td>
	                  <td><span class="badge {log.level}">{log.level}</span></td>
	                  <td>{log.channel}</td>
	                  <td>
	                    <div>{log.message}</div>
	                    {#if Object.keys(log.context ?? {}).length}
	                      <pre>{JSON.stringify(log.context, null, 2)}</pre>
	                    {/if}
	                  </td>
	                </tr>
	              {:else}
	                <tr><td colspan="4" class="empty">No log entries captured yet.</td></tr>
	              {/each}
	            </tbody>
	          </table>
	        </div>
	      </section>
	    {/if}
  </main>
</div>

<style>
  .dashboard {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .dashboard-header h1 {
    margin: 0;
    font-size: 2rem;
  }

  .dashboard-header button {
    padding: 0.5rem 1rem;
    background: #0066cc;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
  }

  .dashboard-header button:hover:not(:disabled) {
    background: #0052a3;
  }

  .dashboard-header button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .tabs {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
    border-bottom: 1px solid #e0e0e0;
  }

  .tabs button {
    padding: 0.75rem 1.5rem;
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    cursor: pointer;
    font-size: 1rem;
    color: #666;
    transition: all 0.3s ease;
  }

  .tabs button:hover {
    color: #0066cc;
  }

  .tabs button.active {
    color: #0066cc;
    border-bottom-color: #0066cc;
  }

  .dashboard-content {
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .overview {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .health-card {
    padding: 1.5rem;
    background: #f5f5f5;
    border-radius: 8px;
    border-left: 4px solid #00aa00;
  }

  .health-card h3 {
    margin-top: 0;
  }

  .health-card p {
    margin: 0.5rem 0;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.5rem;
  }

  .stat-card {
    padding: 1.5rem;
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .stat-card h3 {
    margin-top: 0;
    font-size: 0.9rem;
    color: #666;
    text-transform: uppercase;
  }

  .stat-number {
    margin: 0.5rem 0;
    font-size: 2rem;
    font-weight: bold;
    color: #0066cc;
  }

	  .stat-card small {
	    display: block;
	    color: #999;
	    font-size: 0.85rem;
	  }

	  .notice {
	    margin: 0 0 1rem;
	    padding: 0.75rem 1rem;
	    background: #eef6ff;
	    border: 1px solid #b8dcff;
	    border-radius: 6px;
	    color: #164a7a;
	  }

	  .compact {
	    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	    gap: 1rem;
	    margin-bottom: 1.5rem;
	  }

	  .compact .stat-card {
	    padding: 1rem;
	  }

	  .table-wrap {
	    overflow-x: auto;
	    border: 1px solid #e0e0e0;
	    border-radius: 8px;
	    background: white;
	  }

	  table {
	    width: 100%;
	    border-collapse: collapse;
	    font-size: 0.92rem;
	  }

	  th,
	  td {
	    padding: 0.75rem;
	    border-bottom: 1px solid #eee;
	    text-align: left;
	    vertical-align: top;
	  }

	  th {
	    background: #f7f8fa;
	    color: #555;
	    font-size: 0.78rem;
	    text-transform: uppercase;
	  }

	  tr:last-child td {
	    border-bottom: 0;
	  }

	  .mono {
	    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	    font-size: 0.82rem;
	  }

	  .actions {
	    display: flex;
	    gap: 0.5rem;
	    white-space: nowrap;
	  }

	  .actions button {
	    padding: 0.35rem 0.65rem;
	    border: 1px solid #c9d7e8;
	    border-radius: 6px;
	    background: #fff;
	    color: #164a7a;
	    cursor: pointer;
	  }

	  .actions button:hover:not(:disabled) {
	    background: #eef6ff;
	  }

	  .actions button.danger {
	    border-color: #f1c0c0;
	    color: #a52323;
	  }

	  .actions button.danger:hover:not(:disabled) {
	    background: #fff0f0;
	  }

	  .badge {
	    display: inline-block;
	    padding: 0.18rem 0.45rem;
	    border-radius: 999px;
	    background: #eef0f4;
	    color: #3f4652;
	    font-size: 0.75rem;
	    font-weight: 600;
	    text-transform: uppercase;
	  }

	  .badge.active,
	  .badge.completed,
	  .badge.success,
	  .badge.info {
	    background: #e8f7ee;
	    color: #176b39;
	  }

	  .badge.failed,
	  .badge.error,
	  .badge.fatal {
	    background: #fdeeee;
	    color: #a52323;
	  }

	  .badge.delayed,
	  .badge.warn {
	    background: #fff6df;
	    color: #8a5a00;
	  }

	  pre {
	    margin: 0.5rem 0 0;
	    padding: 0.5rem;
	    max-width: 36rem;
	    overflow: auto;
	    background: #f7f8fa;
	    border-radius: 6px;
	    font-size: 0.78rem;
	  }

	  .empty {
	    color: #777;
	    text-align: center;
	  }

	  section h2 {
	    margin-top: 0;
	  }
</style>
`;
  }
}
