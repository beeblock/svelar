<script lang="ts">
  import { apiFetch } from '$lib/utils/fetch';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Alert } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();
  let users = $state(data.users);
  let message = $state('');
  let messageType = $state<'success' | 'error'>('success');

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
</script>

<svelte:head>
  <title>{m.admin_title()} — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">{m.admin_title()}</h1>
    <p class="text-gray-600 mt-1">{m.admin_subtitle()}</p>
  </div>

  {#if message}
    <Alert variant={messageType === 'error' ? 'destructive' : 'success'}>
      <span class="text-sm">{message}</span>
    </Alert>
  {/if}

  <!-- Stats Section -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    <Card>
      <CardContent class="pt-6">
        <div>
          <p class="text-sm text-gray-600">Total Users</p>
          <p class="text-4xl font-bold text-[var(--color-brand)] mt-2">{data.stats.userCount}</p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="pt-6">
        <div>
          <p class="text-sm text-gray-600">Total Posts</p>
          <p class="text-4xl font-bold text-[var(--color-brand)] mt-2">{data.stats.postCount}</p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="pt-6">
        <div>
          <p class="text-sm text-gray-600 mb-2">Role Distribution</p>
          <div class="space-y-1 text-sm">
            <p><span class="font-medium">Admins:</span> {data.stats.roleDistribution.admin}</p>
            <p><span class="font-medium">Users:</span> {data.stats.roleDistribution.user}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>

  <!-- Users Table -->
  <div class="space-y-4">
    <h2 class="text-2xl font-bold">{m.admin_users()}</h2>

    <Card>
      <CardContent class="pt-6">
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
  </div>
</div>
