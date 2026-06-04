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
    // Fetch initial dashboard data
    const statsRes = await fetch('/api/admin/stats');
    const stats = await statsRes.json();

    const healthRes = await fetch('/api/admin/health');
    const health = await healthRes.json();

    return {
      stats,
      health,
    };
  } catch (error) {
    console.error('Failed to load dashboard:', error);
    return {
      stats: null,
      health: null,
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

  async function refreshData() {
    loading = true;
    try {
      const response = await fetch('/api/admin/stats');
      const newStats = await response.json();
      data.stats = newStats;
    } catch (error) {
      console.error('Failed to refresh:', error);
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
              <p class="stat-number">{data.stats.queue?.total || 0}</p>
              <small>Active: {data.stats.queue?.active || 0}</small>
            </div>

            <div class="stat-card">
              <h3>Scheduled Tasks</h3>
              <p class="stat-number">{data.stats.scheduler?.total || 0}</p>
              <small>Enabled: {data.stats.scheduler?.enabled || 0}</small>
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
        <p>Queue management interface coming soon...</p>
      </section>
    {:else if selectedTab === 'scheduler'}
      <section class="scheduler">
        <h2>Scheduled Tasks</h2>
        <p>Task management interface coming soon...</p>
      </section>
    {:else if selectedTab === 'logs'}
      <section class="logs">
        <h2>Application Logs</h2>
        <p>Log viewer coming soon...</p>
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

  section h2 {
    margin-top: 0;
  }
</style>
`;
  }
}
