<script lang="ts">
  import { apiFetch } from 'svelar/http';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Alert, Tabs, TabsContent, TabsList, TabsTrigger } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();
  let users = $state(data.users);
  let activeTab = $state('overview');
  let message = $state('');
  let messageType = $state<'success' | 'error'>('success');

  // Real data from server
  let queueCounts = $state(data.queueCounts);
  let scheduledTasks = $state(data.scheduledTasks);
  let recentLogs = $state(data.recentLogs);
  let logStats = $state(data.logStats);
  let health = $state(data.health);

  let logFilter = $state<'all' | 'info' | 'warn' | 'error'>('all');

  const filteredLogs = $derived(
    logFilter === 'all' ? recentLogs : recentLogs.filter((log: any) => log.level === logFilter)
  );

  async function refreshDashboard() {
    try {
      const res = await apiFetch('/api/admin/stats');
      if (res.ok) {
        const stats = await res.json();
        if (stats.queue) {
          queueCounts = stats.queue.queues?.default ?? queueCounts;
        }
      }
    } catch { /* ignore refresh errors */ }
  }

  async function updateUserRole(userId: number, newRole: string) {
    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'PUT',
        body: JSON.stringify({ userId, role: newRole }),
      });

      if (res.ok) {
        message = 'User role updated successfully!';
        messageType = 'success';
        await refreshUsers();
      } else {
        const error = await res.json();
        message = error.message || 'Failed to update user role';
        messageType = 'error';
      }
    } catch (err) {
      message = 'Network error';
      messageType = 'error';
    }
  }

  async function deleteUser(userId: number, userName: string) {
    if (!confirm(`Are you sure you want to delete ${userName}? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'DELETE',
        body: JSON.stringify({ userId }),
      });

      if (res.ok) {
        message = 'User deleted successfully!';
        messageType = 'success';
        await refreshUsers();
      } else {
        const error = await res.json();
        message = error.message || 'Failed to delete user';
        messageType = 'error';
      }
    } catch (err) {
      message = 'Network error';
      messageType = 'error';
    }
  }

  async function refreshUsers() {
    const res = await apiFetch('/api/admin/users');
    if (res.ok) {
      const data = await res.json();
      users = data;
    }
  }

  async function retryJob(jobId: string) {
    try {
      const res = await apiFetch(`/api/admin/queue/${jobId}/retry`, { method: 'POST' });
      if (res.ok) {
        message = 'Job queued for retry';
        messageType = 'success';
        await refreshQueue();
      }
    } catch {
      message = 'Failed to retry job';
      messageType = 'error';
    }
  }

  async function refreshQueue() {
    try {
      const res = await apiFetch('/api/admin/queue');
      if (res.ok) {
        const data = await res.json();
        queueCounts = data.counts;
      }
    } catch { /* ignore */ }
  }

  async function runTask(taskName: string) {
    try {
      const res = await apiFetch(`/api/admin/scheduler/${taskName}/run`, { method: 'POST' });
      if (res.ok) {
        message = `Task '${taskName}' triggered`;
        messageType = 'success';
      } else {
        const err = await res.json();
        message = err.error || 'Failed to run task';
        messageType = 'error';
      }
    } catch {
      message = 'Failed to run task';
      messageType = 'error';
    }
  }

  async function toggleTask(taskName: string, enabled: boolean) {
    try {
      const res = await apiFetch(`/api/admin/scheduler/${taskName}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        // Update local state
        scheduledTasks = scheduledTasks.map((t: any) =>
          t.name === taskName ? { ...t, enabled } : t
        );
        message = `Task '${taskName}' ${enabled ? 'enabled' : 'disabled'}`;
        messageType = 'success';
      }
    } catch {
      message = 'Failed to toggle task';
      messageType = 'error';
    }
  }

  function formatDate(date: string | null): string {
    if (!date) return 'Never';
    return new Date(date).toLocaleString();
  }

  function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function getLogBadgeVariant(level: string): 'default' | 'secondary' | 'destructive' {
    return level === 'error' || level === 'fatal' ? 'destructive' : level === 'warn' ? 'secondary' : 'default';
  }
</script>

<svelte:head>
  <title>Admin Dashboard — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div class="flex justify-between items-center">
    <div>
      <h1 class="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
      <p class="text-gray-600 mt-1">System health, queue monitoring, and task management</p>
    </div>
    <Button variant="outline" onclick={refreshDashboard}>Refresh</Button>
  </div>

  {#if message}
    <Alert variant={messageType === 'error' ? 'destructive' : 'success'}>
      <span class="text-sm">{message}</span>
    </Alert>
  {/if}

  <Tabs value={activeTab} onchange={(value) => (activeTab = value)} class="w-full">
    <TabsList class="grid w-full grid-cols-5">
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="users">Users</TabsTrigger>
      <TabsTrigger value="queue">Queue</TabsTrigger>
      <TabsTrigger value="scheduler">Scheduler</TabsTrigger>
      <TabsTrigger value="logs">Logs</TabsTrigger>
    </TabsList>

    <!-- Overview Tab -->
    <TabsContent value="overview" class="space-y-6 mt-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Total Users</p>
              <p class="text-3xl font-bold text-[var(--color-brand)] mt-2">{data.stats.userCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Total Posts</p>
              <p class="text-3xl font-bold text-[var(--color-brand)] mt-2">{data.stats.postCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Queue Pending</p>
              <p class="text-3xl font-bold text-yellow-600 mt-2">{queueCounts.waiting}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Failed Jobs</p>
              <p class="text-3xl font-bold text-red-600 mt-2">{queueCounts.failed}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>Status</span>
              <Badge variant="default">{health.status}</Badge>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>Uptime</span>
              <span class="font-medium">{formatUptime(health.uptime)}</span>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>Memory Usage</span>
              <Badge variant={health.memoryPercent > 90 ? 'destructive' : health.memoryPercent > 70 ? 'secondary' : 'default'}>
                {health.memoryUsedMB} MB / {health.memoryTotalMB} MB ({health.memoryPercent}%)
              </Badge>
            </div>
            <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                class="h-full transition-all"
                class:bg-green-500={health.memoryPercent <= 70}
                class:bg-yellow-500={health.memoryPercent > 70 && health.memoryPercent <= 90}
                class:bg-red-500={health.memoryPercent > 90}
                style="width: {health.memoryPercent}%"
              ></div>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>Queue Throughput</span>
              <span class="font-medium">{queueCounts.total} total jobs</span>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>Log Entries</span>
              <span class="font-medium">{logStats.totalEntries} entries ({logStats.byLevel?.error ?? 0} errors)</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>

    <!-- Users Tab -->
    <TabsContent value="users" class="space-y-6 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
          <CardDescription>Manage user roles and permissions ({data.stats.userCount} users)</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200">
                  <th class="text-left py-3 px-4 font-semibold text-gray-900">Name</th>
                  <th class="text-left py-3 px-4 font-semibold text-gray-900">Email</th>
                  <th class="text-left py-3 px-4 font-semibold text-gray-900">Role</th>
                  <th class="text-left py-3 px-4 font-semibold text-gray-900">Joined</th>
                  <th class="text-left py-3 px-4 font-semibold text-gray-900">Actions</th>
                </tr>
              </thead>
              <tbody>
                {#each users as user (user.id)}
                  <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="py-3 px-4 font-medium text-gray-900">{user.name}</td>
                    <td class="py-3 px-4 text-gray-600">{user.email}</td>
                    <td class="py-3 px-4">
                      <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                        {user.role}
                      </Badge>
                    </td>
                    <td class="py-3 px-4 text-gray-600">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td class="py-3 px-4">
                      <div class="flex gap-2">
                        {#if user.role === 'user'}
                          <Button
                            size="sm"
                            variant="outline"
                            onclick={() => updateUserRole(user.id, 'admin')}
                          >
                            Make Admin
                          </Button>
                        {:else if data.stats.roleDistribution.admin > 1}
                          <Button
                            size="sm"
                            variant="outline"
                            onclick={() => updateUserRole(user.id, 'user')}
                          >
                            Demote
                          </Button>
                        {/if}

                        {#if user.id !== data.user.id}
                          <Button
                            size="sm"
                            variant="destructive"
                            onclick={() => deleteUser(user.id, user.name)}
                          >
                            Delete
                          </Button>
                        {/if}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </TabsContent>

    <!-- Queue Tab -->
    <TabsContent value="queue" class="space-y-6 mt-6">
      <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Waiting</p>
              <p class="text-3xl font-bold text-yellow-600 mt-2">{queueCounts.waiting}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Active</p>
              <p class="text-3xl font-bold text-blue-600 mt-2">{queueCounts.active}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Failed</p>
              <p class="text-3xl font-bold text-red-600 mt-2">{queueCounts.failed}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Completed</p>
              <p class="text-3xl font-bold text-green-600 mt-2">{queueCounts.completed}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Delayed</p>
              <p class="text-3xl font-bold text-gray-600 mt-2">{queueCounts.delayed}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Queue Actions</CardTitle>
          <CardDescription>Manage job queue</CardDescription>
        </CardHeader>
        <CardContent class="flex gap-3">
          <Button variant="outline" onclick={refreshQueue}>Refresh Counts</Button>
        </CardContent>
      </Card>
    </TabsContent>

    <!-- Scheduler Tab -->
    <TabsContent value="scheduler" class="space-y-6 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>Scheduled Tasks</CardTitle>
          <CardDescription>
            {scheduledTasks.length > 0
              ? `${scheduledTasks.length} registered tasks`
              : 'No tasks registered. Configure your scheduler to see tasks here.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {#if scheduledTasks.length > 0}
            <div class="space-y-3">
              {#each scheduledTasks as task (task.name)}
                <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <div class="flex-1">
                    <p class="font-medium text-gray-900">{task.name}</p>
                    <p class="text-sm text-gray-600">Schedule: {task.humanReadable}</p>
                    <p class="text-xs text-gray-500 mt-1">Last run: {formatDate(task.lastRun)}</p>
                    <p class="text-xs text-gray-500">Next run: {formatDate(task.nextRun)}</p>
                  </div>
                  <div class="flex items-center gap-3">
                    {#if task.lastStatus}
                      <Badge variant={task.lastStatus === 'success' ? 'default' : 'destructive'}>
                        {task.lastStatus}
                      </Badge>
                    {/if}
                    <Badge variant={task.enabled ? 'default' : 'secondary'}>
                      {task.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                    <Button size="sm" variant="outline" onclick={() => runTask(task.name)}>Run Now</Button>
                    <Button size="sm" variant="outline" onclick={() => toggleTask(task.name, !task.enabled)}>
                      {task.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-gray-500 py-4 text-center">
              No scheduled tasks found. Configure the Scheduler in your app.ts to register tasks.
            </p>
          {/if}
        </CardContent>
      </Card>
    </TabsContent>

    <!-- Logs Tab -->
    <TabsContent value="logs" class="space-y-6 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>Application Logs</CardTitle>
          <CardDescription>
            {logStats.totalEntries} total entries
            {#if logStats.byLevel?.error}
              ({logStats.byLevel.error} errors)
            {/if}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex gap-2 mb-4">
            <Button
              size="sm"
              variant={logFilter === 'all' ? 'default' : 'outline'}
              onclick={() => (logFilter = 'all')}
            >
              All ({logStats.totalEntries})
            </Button>
            <Button
              size="sm"
              variant={logFilter === 'info' ? 'default' : 'outline'}
              onclick={() => (logFilter = 'info')}
            >
              Info ({logStats.byLevel?.info ?? 0})
            </Button>
            <Button
              size="sm"
              variant={logFilter === 'warn' ? 'default' : 'outline'}
              onclick={() => (logFilter = 'warn')}
            >
              Warning ({logStats.byLevel?.warn ?? 0})
            </Button>
            <Button
              size="sm"
              variant={logFilter === 'error' ? 'default' : 'outline'}
              onclick={() => (logFilter = 'error')}
            >
              Error ({logStats.byLevel?.error ?? 0})
            </Button>
          </div>

          {#if filteredLogs.length > 0}
            <div class="space-y-2 max-h-96 overflow-y-auto">
              {#each filteredLogs as log, i (i)}
                <div class="flex items-start gap-3 p-3 border border-gray-200 rounded bg-gray-50 text-sm">
                  <Badge variant={getLogBadgeVariant(log.level)} class="mt-0.5">
                    {log.level.toUpperCase()}
                  </Badge>
                  <div class="flex-1">
                    <p class="text-gray-900">{log.message}</p>
                    <p class="text-xs text-gray-500 mt-1">
                      {new Date(log.timestamp).toLocaleString()}
                      {#if log.channel && log.channel !== 'default'}
                        <span class="ml-2 text-gray-400">[{log.channel}]</span>
                      {/if}
                    </p>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-gray-500 py-4 text-center">
              No log entries found. Logs appear here as your application runs.
            </p>
          {/if}
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>
</div>
