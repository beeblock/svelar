<script lang="ts">
  import { apiFetch } from 'svelar/http';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Alert, Input, Label } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatDate as fmtDate, timeAgo } from '$lib/dates';
  import { page } from '$app/state';

  let { data } = $props();
  let users = $state(data.users);
  let message = $state('');
  let messageType = $state<'success' | 'error'>('success');

  // Real data from server
  let queueCounts = $state(data.queueCounts);
  let scheduledTasks = $state(data.scheduledTasks);
  let recentLogs = $state(data.recentLogs);
  let logStats = $state(data.logStats);
  let health = $state(data.health);

  // Roles & Permissions
  let roles = $state(data.roles ?? []);
  let permissions = $state(data.permissions ?? []);
  let rolePermissionsMap = $state<Record<number, number[]>>(data.rolePermissionsMap ?? {});
  let userRolesMap = $state<Record<number, { id: number; name: string }[]>>(data.userRolesMap ?? {});
  let userDirectPermsMap = $state<Record<number, { id: number; name: string }[]>>(data.userDirectPermsMap ?? {});

  // Form state
  let newRoleName = $state('');
  let newRoleDesc = $state('');
  let newPermName = $state('');
  let newPermDesc = $state('');
  let showRoleForm = $state(false);
  let showPermForm = $state(false);

  // User assignment state
  let selectedUserId = $state<number | null>(null);
  let selectedRoleIdForUser = $state<number | null>(null);
  let selectedPermIdForUser = $state<number | null>(null);

  let logFilter = $state<'all' | 'info' | 'warn' | 'error'>('all');

  const activeTab = $derived(page.url.searchParams.get('tab') ?? 'overview');

  const filteredLogs = $derived(
    logFilter === 'all' ? recentLogs : recentLogs.filter((log: any) => log.level === logFilter)
  );

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    message = msg;
    messageType = type;
  }

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
        flash('User role updated successfully!');
        await refreshUsers();
      } else {
        const error = await res.json();
        flash(error.message || 'Failed to update user role', 'error');
      }
    } catch {
      flash('Network error', 'error');
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
        flash('User deleted successfully!');
        await refreshUsers();
      } else {
        const error = await res.json();
        flash(error.message || 'Failed to delete user', 'error');
      }
    } catch {
      flash('Network error', 'error');
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
        flash('Job queued for retry');
        await refreshQueue();
      }
    } catch {
      flash('Failed to retry job', 'error');
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
        flash(`Task '${taskName}' triggered`);
      } else {
        const err = await res.json();
        flash(err.error || 'Failed to run task', 'error');
      }
    } catch {
      flash('Failed to run task', 'error');
    }
  }

  async function toggleTask(taskName: string, enabled: boolean) {
    try {
      const res = await apiFetch(`/api/admin/scheduler/${taskName}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        scheduledTasks = scheduledTasks.map((t: any) =>
          t.name === taskName ? { ...t, enabled } : t
        );
        flash(`Task '${taskName}' ${enabled ? 'enabled' : 'disabled'}`);
      }
    } catch {
      flash('Failed to toggle task', 'error');
    }
  }

  // ── Roles CRUD ──

  async function createRole() {
    if (!newRoleName.trim()) return;
    try {
      const res = await apiFetch('/api/admin/roles', {
        method: 'POST',
        body: JSON.stringify({ name: newRoleName.trim(), description: newRoleDesc.trim() || undefined }),
      });
      if (res.ok) {
        const role = await res.json();
        roles = [...roles, role];
        rolePermissionsMap[role.id] = [];
        newRoleName = '';
        newRoleDesc = '';
        showRoleForm = false;
        flash('Role created');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to create role', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  async function deleteRole(name: string) {
    if (!confirm(`Delete role "${name}"? This will remove it from all users.`)) return;
    try {
      const res = await apiFetch('/api/admin/roles', {
        method: 'DELETE',
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const deleted = roles.find((r: any) => r.name === name);
        roles = roles.filter((r: any) => r.name !== name);
        if (deleted) delete rolePermissionsMap[deleted.id];
        // Remove from user maps
        for (const uid of Object.keys(userRolesMap)) {
          userRolesMap[uid as any] = userRolesMap[uid as any].filter((r: any) => r.name !== name);
        }
        flash('Role deleted');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to delete role', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  // ── Permissions CRUD ──

  async function createPermission() {
    if (!newPermName.trim()) return;
    try {
      const res = await apiFetch('/api/admin/permissions', {
        method: 'POST',
        body: JSON.stringify({ name: newPermName.trim(), description: newPermDesc.trim() || undefined }),
      });
      if (res.ok) {
        const perm = await res.json();
        permissions = [...permissions, perm];
        newPermName = '';
        newPermDesc = '';
        showPermForm = false;
        flash('Permission created');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to create permission', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  async function deletePermission(name: string) {
    if (!confirm(`Delete permission "${name}"? This will revoke it from all roles and users.`)) return;
    try {
      const res = await apiFetch('/api/admin/permissions', {
        method: 'DELETE',
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const deleted = permissions.find((p: any) => p.name === name);
        permissions = permissions.filter((p: any) => p.name !== name);
        // Remove from role maps
        if (deleted) {
          for (const rid of Object.keys(rolePermissionsMap)) {
            rolePermissionsMap[rid as any] = rolePermissionsMap[rid as any].filter((pid: number) => pid !== deleted.id);
          }
        }
        flash('Permission deleted');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to delete permission', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  // ── Role ↔ Permission ──

  async function toggleRolePermission(roleId: number, permissionId: number) {
    const current = rolePermissionsMap[roleId] ?? [];
    const has = current.includes(permissionId);

    try {
      const res = await apiFetch('/api/admin/role-permissions', {
        method: has ? 'DELETE' : 'POST',
        body: JSON.stringify({ roleId, permissionId }),
      });
      if (res.ok) {
        if (has) {
          rolePermissionsMap[roleId] = current.filter((id: number) => id !== permissionId);
        } else {
          rolePermissionsMap[roleId] = [...current, permissionId];
        }
        // Force reactivity
        rolePermissionsMap = { ...rolePermissionsMap };
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to update', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  // ── User ↔ Role ──

  async function assignRoleToUser(userId: number, roleId: number) {
    try {
      const res = await apiFetch('/api/admin/user-roles', {
        method: 'POST',
        body: JSON.stringify({ userId, roleId }),
      });
      if (res.ok) {
        const role = roles.find((r: any) => r.id === roleId);
        if (role) {
          const current = userRolesMap[userId] ?? [];
          if (!current.some((r: any) => r.id === roleId)) {
            userRolesMap[userId] = [...current, { id: role.id, name: role.name }];
            userRolesMap = { ...userRolesMap };
          }
        }
        flash('Role assigned');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to assign role', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  async function removeRoleFromUser(userId: number, roleId: number) {
    try {
      const res = await apiFetch('/api/admin/user-roles', {
        method: 'DELETE',
        body: JSON.stringify({ userId, roleId }),
      });
      if (res.ok) {
        userRolesMap[userId] = (userRolesMap[userId] ?? []).filter((r: any) => r.id !== roleId);
        userRolesMap = { ...userRolesMap };
        flash('Role removed');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to remove role', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  // ── User ↔ Direct Permission ──

  async function grantPermToUser(userId: number, permissionId: number) {
    try {
      const res = await apiFetch('/api/admin/user-permissions', {
        method: 'POST',
        body: JSON.stringify({ userId, permissionId }),
      });
      if (res.ok) {
        const perm = permissions.find((p: any) => p.id === permissionId);
        if (perm) {
          const current = userDirectPermsMap[userId] ?? [];
          if (!current.some((p: any) => p.id === permissionId)) {
            userDirectPermsMap[userId] = [...current, { id: perm.id, name: perm.name }];
            userDirectPermsMap = { ...userDirectPermsMap };
          }
        }
        flash('Permission granted');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to grant permission', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  async function revokePermFromUser(userId: number, permissionId: number) {
    try {
      const res = await apiFetch('/api/admin/user-permissions', {
        method: 'DELETE',
        body: JSON.stringify({ userId, permissionId }),
      });
      if (res.ok) {
        userDirectPermsMap[userId] = (userDirectPermsMap[userId] ?? []).filter((p: any) => p.id !== permissionId);
        userDirectPermsMap = { ...userDirectPermsMap };
        flash('Permission revoked');
      } else {
        const err = await res.json();
        flash(err.message || 'Failed to revoke permission', 'error');
      }
    } catch {
      flash('Network error', 'error');
    }
  }

  function formatDate(date: string | null): string {
    if (!date) return 'Never';
    return fmtDate(date, 'Pp');
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

  <!-- Overview -->
  {#if activeTab === 'overview'}
    <div class="space-y-6">
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
          <div class="flex justify-between text-sm">
            <span>Status</span>
            <Badge variant="default">{health.status}</Badge>
          </div>
          <div class="flex justify-between text-sm">
            <span>Uptime</span>
            <span class="font-medium">{formatUptime(health.uptime)}</span>
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
          <div class="flex justify-between text-sm">
            <span>Queue Throughput</span>
            <span class="font-medium">{queueCounts.total} total jobs</span>
          </div>
          <div class="flex justify-between text-sm">
            <span>Log Entries</span>
            <span class="font-medium">{logStats.totalEntries} entries ({logStats.byLevel?.error ?? 0} errors)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Users -->
  {#if activeTab === 'users'}
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
                <th class="text-left py-3 px-4 font-semibold text-gray-900">Column Role</th>
                <th class="text-left py-3 px-4 font-semibold text-gray-900">Assigned Roles</th>
                <th class="text-left py-3 px-4 font-semibold text-gray-900">Direct Permissions</th>
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
                  <td class="py-3 px-4">
                    <div class="flex flex-wrap gap-1">
                      {#each (userRolesMap[user.id] ?? []) as role (role.id)}
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">
                          {role.name}
                          <button
                            type="button"
                            class="hover:text-red-600 font-bold"
                            onclick={() => removeRoleFromUser(user.id, role.id)}
                          >&times;</button>
                        </span>
                      {/each}
                      {#if roles.length > 0}
                        <select
                          class="text-xs border border-gray-200 rounded px-1 py-0.5"
                          onchange={(e) => {
                            const val = Number((e.target as HTMLSelectElement).value);
                            if (val) { assignRoleToUser(user.id, val); (e.target as HTMLSelectElement).value = ''; }
                          }}
                        >
                          <option value="">+ role</option>
                          {#each roles.filter((r) => !(userRolesMap[user.id] ?? []).some((ur) => ur.id === r.id)) as role (role.id)}
                            <option value={role.id}>{role.name}</option>
                          {/each}
                        </select>
                      {/if}
                    </div>
                  </td>
                  <td class="py-3 px-4">
                    <div class="flex flex-wrap gap-1">
                      {#each (userDirectPermsMap[user.id] ?? []) as perm (perm.id)}
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">
                          {perm.name}
                          <button
                            type="button"
                            class="hover:text-red-600 font-bold"
                            onclick={() => revokePermFromUser(user.id, perm.id)}
                          >&times;</button>
                        </span>
                      {/each}
                      {#if permissions.length > 0}
                        <select
                          class="text-xs border border-gray-200 rounded px-1 py-0.5"
                          onchange={(e) => {
                            const val = Number((e.target as HTMLSelectElement).value);
                            if (val) { grantPermToUser(user.id, val); (e.target as HTMLSelectElement).value = ''; }
                          }}
                        >
                          <option value="">+ perm</option>
                          {#each permissions.filter((p) => !(userDirectPermsMap[user.id] ?? []).some((up) => up.id === p.id)) as perm (perm.id)}
                            <option value={perm.id}>{perm.name}</option>
                          {/each}
                        </select>
                      {/if}
                    </div>
                  </td>
                  <td class="py-3 px-4">
                    <div class="flex gap-2">
                      {#if user.role === 'user'}
                        <Button size="sm" variant="outline" onclick={() => updateUserRole(user.id, 'admin')}>
                          Make Admin
                        </Button>
                      {:else if data.stats.roleDistribution.admin > 1}
                        <Button size="sm" variant="outline" onclick={() => updateUserRole(user.id, 'user')}>
                          Demote
                        </Button>
                      {/if}
                      {#if user.id !== data.user.id}
                        <Button size="sm" variant="destructive" onclick={() => deleteUser(user.id, user.name)}>
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
  {/if}

  <!-- Roles -->
  {#if activeTab === 'roles'}
    <div class="space-y-6">
      <Card>
        <CardHeader>
          <div class="flex justify-between items-start">
            <div>
              <CardTitle>Roles</CardTitle>
              <CardDescription>{roles.length} roles defined</CardDescription>
            </div>
            <Button size="sm" onclick={() => (showRoleForm = !showRoleForm)}>
              {showRoleForm ? 'Cancel' : 'Create Role'}
            </Button>
          </div>
        </CardHeader>
        {#if showRoleForm}
          <CardContent>
            <form
              class="flex flex-wrap gap-3 items-end border-b border-gray-100 pb-4 mb-4"
              onsubmit={(e) => { e.preventDefault(); createRole(); }}
            >
              <div class="flex-1 min-w-[200px]">
                <Label for="role-name">Name</Label>
                <Input id="role-name" bind:value={newRoleName} placeholder="e.g. editor" />
              </div>
              <div class="flex-1 min-w-[200px]">
                <Label for="role-desc">Description (optional)</Label>
                <Input id="role-desc" bind:value={newRoleDesc} placeholder="Can edit content" />
              </div>
              <Button type="submit" size="sm">Create</Button>
            </form>
          </CardContent>
        {/if}
        <CardContent>
          {#if roles.length > 0}
            <div class="space-y-4">
              {#each roles as role (role.id)}
                <div class="border border-gray-200 rounded-lg p-4">
                  <div class="flex items-center justify-between mb-3">
                    <div>
                      <span class="font-medium text-gray-900">{role.name}</span>
                      <Badge variant="secondary" class="ml-2">{role.guard}</Badge>
                      {#if role.description}
                        <p class="text-xs text-gray-500 mt-1">{role.description}</p>
                      {/if}
                    </div>
                    <Button size="sm" variant="destructive" onclick={() => deleteRole(role.name)}>Delete</Button>
                  </div>
                  <div>
                    <p class="text-xs font-semibold text-gray-500 uppercase mb-2">Permissions</p>
                    <div class="flex flex-wrap gap-2">
                      {#each permissions as perm (perm.id)}
                        {@const has = (rolePermissionsMap[role.id] ?? []).includes(perm.id)}
                        <button
                          type="button"
                          class="px-2 py-1 rounded text-xs border transition-colors {has
                            ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}"
                          onclick={() => toggleRolePermission(role.id, perm.id)}
                        >
                          {perm.name}
                        </button>
                      {/each}
                      {#if permissions.length === 0}
                        <span class="text-xs text-gray-400">No permissions defined yet</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-gray-500 py-4 text-center">
              No roles defined. Create one to start assigning permissions.
            </p>
          {/if}
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Permissions -->
  {#if activeTab === 'permissions'}
    <div class="space-y-6">
      <Card>
        <CardHeader>
          <div class="flex justify-between items-start">
            <div>
              <CardTitle>Permissions</CardTitle>
              <CardDescription>{permissions.length} permissions defined</CardDescription>
            </div>
            <Button size="sm" onclick={() => (showPermForm = !showPermForm)}>
              {showPermForm ? 'Cancel' : 'Create Permission'}
            </Button>
          </div>
        </CardHeader>
        {#if showPermForm}
          <CardContent>
            <form
              class="flex flex-wrap gap-3 items-end border-b border-gray-100 pb-4 mb-4"
              onsubmit={(e) => { e.preventDefault(); createPermission(); }}
            >
              <div class="flex-1 min-w-[200px]">
                <Label for="perm-name">Name</Label>
                <Input id="perm-name" bind:value={newPermName} placeholder="e.g. manage-users" />
              </div>
              <div class="flex-1 min-w-[200px]">
                <Label for="perm-desc">Description (optional)</Label>
                <Input id="perm-desc" bind:value={newPermDesc} placeholder="Can manage user accounts" />
              </div>
              <Button type="submit" size="sm">Create</Button>
            </form>
          </CardContent>
        {/if}
        <CardContent>
          {#if permissions.length > 0}
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-gray-200">
                    <th class="text-left py-3 px-4 font-semibold text-gray-900">Name</th>
                    <th class="text-left py-3 px-4 font-semibold text-gray-900">Guard</th>
                    <th class="text-left py-3 px-4 font-semibold text-gray-900">Description</th>
                    <th class="text-left py-3 px-4 font-semibold text-gray-900">Used by Roles</th>
                    <th class="text-left py-3 px-4 font-semibold text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {#each permissions as perm (perm.id)}
                    {@const usedBy = roles.filter((r) => (rolePermissionsMap[r.id] ?? []).includes(perm.id))}
                    <tr class="border-b border-gray-100 hover:bg-gray-50">
                      <td class="py-3 px-4 font-medium text-gray-900">{perm.name}</td>
                      <td class="py-3 px-4">
                        <Badge variant="secondary">{perm.guard}</Badge>
                      </td>
                      <td class="py-3 px-4 text-gray-600">{perm.description || '—'}</td>
                      <td class="py-3 px-4">
                        <div class="flex flex-wrap gap-1">
                          {#each usedBy as role (role.id)}
                            <Badge variant="outline">{role.name}</Badge>
                          {/each}
                          {#if usedBy.length === 0}
                            <span class="text-xs text-gray-400">None</span>
                          {/if}
                        </div>
                      </td>
                      <td class="py-3 px-4">
                        <Button size="sm" variant="destructive" onclick={() => deletePermission(perm.name)}>Delete</Button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <p class="text-sm text-gray-500 py-4 text-center">
              No permissions defined. Create one to start building your authorization system.
            </p>
          {/if}
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Queue -->
  {#if activeTab === 'queue'}
    <div class="space-y-6">
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
    </div>
  {/if}

  <!-- Scheduler -->
  {#if activeTab === 'scheduler'}
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
  {/if}

  <!-- Logs -->
  {#if activeTab === 'logs'}
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
          <Button size="sm" variant={logFilter === 'all' ? 'default' : 'outline'} onclick={() => (logFilter = 'all')}>
            All ({logStats.totalEntries})
          </Button>
          <Button size="sm" variant={logFilter === 'info' ? 'default' : 'outline'} onclick={() => (logFilter = 'info')}>
            Info ({logStats.byLevel?.info ?? 0})
          </Button>
          <Button size="sm" variant={logFilter === 'warn' ? 'default' : 'outline'} onclick={() => (logFilter = 'warn')}>
            Warning ({logStats.byLevel?.warn ?? 0})
          </Button>
          <Button size="sm" variant={logFilter === 'error' ? 'default' : 'outline'} onclick={() => (logFilter = 'error')}>
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
                    {fmtDate(log.timestamp, 'Pp')}
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
  {/if}
</div>
