<script lang="ts">
  import { apiFetch } from 'svelar/http';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Alert, Tabs, TabsContent, TabsList, TabsTrigger } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();
  let users = $state(data.users);
  let activeTab = $state('overview');
  let message = $state('');
  let messageType = $state<'success' | 'error'>('success');

  // Queue and scheduler state
  let queueStats = $state({
    pending: 12,
    processing: 2,
    failed: 1,
    completed: 145,
  });

  let scheduledTasks = $state([
    {
      id: 'cleanup-expired-tokens',
      name: 'Cleanup Expired Tokens',
      schedule: 'Daily at 00:00',
      status: 'enabled',
      lastRun: new Date(Date.now() - 2 * 60 * 60 * 1000),
      nextRun: new Date(Date.now() + 22 * 60 * 60 * 1000),
    },
    {
      id: 'daily-digest-email',
      name: 'Daily Digest Email',
      schedule: 'Daily at 09:00',
      status: 'enabled',
      lastRun: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      nextRun: new Date(Date.now() + 7 * 60 * 60 * 1000),
    },
    {
      id: 'prune-audit-logs',
      name: 'Prune Audit Logs',
      schedule: 'Weekly on Sunday at 02:00',
      status: 'enabled',
      lastRun: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      nextRun: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
    },
    {
      id: 'queue-health-check',
      name: 'Queue Health Check',
      schedule: 'Every 5 minutes',
      status: 'enabled',
      lastRun: new Date(Date.now() - 3 * 60 * 1000),
      nextRun: new Date(Date.now() + 2 * 60 * 1000),
    },
  ]);

  let recentLogs = $state([
    { id: 1, level: 'info', message: 'User registered', timestamp: new Date(Date.now() - 10 * 60 * 1000) },
    { id: 2, level: 'warning', message: 'Failed login attempt for admin@example.com', timestamp: new Date(Date.now() - 30 * 60 * 1000) },
    { id: 3, level: 'error', message: 'Database connection timeout', timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    { id: 4, level: 'info', message: 'Job completed: SendWelcomeEmail', timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    { id: 5, level: 'info', message: 'Audit log entry created', timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000) },
  ]);

  let logFilter = $state<'all' | 'info' | 'warning' | 'error'>('all');

  const filteredLogs = $derived(
    logFilter === 'all' ? recentLogs : recentLogs.filter((log) => log.level === logFilter)
  );

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

  function formatDate(date: Date): string {
    return date.toLocaleString();
  }

  function getLogBadgeVariant(level: string): 'default' | 'secondary' | 'destructive' {
    return level === 'error' ? 'destructive' : level === 'warning' ? 'secondary' : 'default';
  }
</script>

<svelte:head>
  <title>Admin Dashboard — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
    <p class="text-gray-600 mt-1">System health, queue monitoring, and task management</p>
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
              <p class="text-3xl font-bold text-yellow-600 mt-2">{queueStats.pending}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Failed Jobs</p>
              <p class="text-3xl font-bold text-red-600 mt-2">{queueStats.failed}</p>
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
              <span>Database Connection</span>
              <Badge variant="default">Online</Badge>
            </div>
            <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div class="h-full bg-green-500" style="width: 100%"></div>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>Queue System</span>
              <Badge variant="default">Active</Badge>
            </div>
            <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div class="h-full bg-green-500" style="width: 95%"></div>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>Memory Usage</span>
              <Badge variant="secondary">45%</Badge>
            </div>
            <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div class="h-full bg-yellow-500" style="width: 45%"></div>
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
          <CardDescription>Manage user roles and permissions</CardDescription>
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
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Pending</p>
              <p class="text-3xl font-bold text-yellow-600 mt-2">{queueStats.pending}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Processing</p>
              <p class="text-3xl font-bold text-blue-600 mt-2">{queueStats.processing}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Failed</p>
              <p class="text-3xl font-bold text-red-600 mt-2">{queueStats.failed}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-gray-600">Completed</p>
              <p class="text-3xl font-bold text-green-600 mt-2">{queueStats.completed}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Jobs</CardTitle>
          <CardDescription>Queue job history</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
              <div>
                <p class="font-medium text-gray-900">SendWelcomeEmail (ID: 1234)</p>
                <p class="text-sm text-gray-600">User: John Doe</p>
              </div>
              <Badge variant="default">Completed</Badge>
            </div>

            <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
              <div>
                <p class="font-medium text-gray-900">DailyDigestJob (ID: 1235)</p>
                <p class="text-sm text-gray-600">Dispatched 2 hours ago</p>
              </div>
              <Badge variant="secondary">Processing</Badge>
            </div>

            <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
              <div>
                <p class="font-medium text-gray-900">ExportDataJob (ID: 1236)</p>
                <p class="text-sm text-gray-600">User: Jane Smith</p>
              </div>
              <Badge variant="destructive">Failed (1/3)</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>

    <!-- Scheduler Tab -->
    <TabsContent value="scheduler" class="space-y-6 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>Scheduled Tasks</CardTitle>
          <CardDescription>Manage application background tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            {#each scheduledTasks as task (task.id)}
              <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                <div class="flex-1">
                  <p class="font-medium text-gray-900">{task.name}</p>
                  <p class="text-sm text-gray-600">Schedule: {task.schedule}</p>
                  <p class="text-xs text-gray-500 mt-1">Last run: {formatDate(task.lastRun)}</p>
                  <p class="text-xs text-gray-500">Next run: {formatDate(task.nextRun)}</p>
                </div>
                <div class="flex items-center gap-3">
                  <Badge variant={task.status === 'enabled' ? 'default' : 'secondary'}>
                    {task.status}
                  </Badge>
                  <Button size="sm" variant="outline">Run Now</Button>
                  <Button size="sm" variant="outline">{task.status === 'enabled' ? 'Disable' : 'Enable'}</Button>
                </div>
              </div>
            {/each}
          </div>
        </CardContent>
      </Card>
    </TabsContent>

    <!-- Logs Tab -->
    <TabsContent value="logs" class="space-y-6 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>Application Logs</CardTitle>
          <CardDescription>Recent system and application events</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex gap-2 mb-4">
            <Button
              size="sm"
              variant={logFilter === 'all' ? 'default' : 'outline'}
              onclick={() => (logFilter = 'all')}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={logFilter === 'info' ? 'default' : 'outline'}
              onclick={() => (logFilter = 'info')}
            >
              Info
            </Button>
            <Button
              size="sm"
              variant={logFilter === 'warning' ? 'default' : 'outline'}
              onclick={() => (logFilter = 'warning')}
            >
              Warning
            </Button>
            <Button
              size="sm"
              variant={logFilter === 'error' ? 'default' : 'outline'}
              onclick={() => (logFilter = 'error')}
            >
              Error
            </Button>
          </div>

          <div class="space-y-2 max-h-96 overflow-y-auto">
            {#each filteredLogs as log (log.id)}
              <div class="flex items-start gap-3 p-3 border border-gray-200 rounded bg-gray-50 text-sm">
                <Badge variant={getLogBadgeVariant(log.level)} class="mt-0.5">
                  {log.level.toUpperCase()}
                </Badge>
                <div class="flex-1">
                  <p class="text-gray-900">{log.message}</p>
                  <p class="text-xs text-gray-500 mt-1">{formatDate(log.timestamp)}</p>
                </div>
              </div>
            {/each}
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>
</div>
