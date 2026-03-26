/**
 * Admin dashboard templates
 */

export const adminPageServer = `import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import { User } from '$lib/models/User.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(302, '/login');
  }

  // Check if user has admin role
  const user = await User.find(locals.user.id);
  if (!user || user.role?.name !== 'admin') {
    error(403, 'Forbidden');
  }

  // Fetch dashboard data
  const totalUsers = await User.count();
  const recentUsers = await User.orderBy('created_at', 'desc').limit(10).get();

  return {
    user: locals.user,
    stats: {
      totalUsers,
      recentUsers,
    },
  };
};
`;

export const adminPageSvelte = `<script>
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/index.js';
  import { Badge } from '$lib/components/ui/Badge.svelte';

  let { data } = $props();
</script>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
    <p class="text-gray-600 mt-2">Welcome back, {data.user.name}. Here's what's happening in your app.</p>
  </div>

  <!-- Stats -->
  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Total Users</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="text-2xl font-bold">{data.stats.totalUsers}</div>
        <p class="text-xs text-gray-600">Total registered users</p>
      </CardContent>
    </Card>
  </div>

  <!-- Recent Users -->
  <Card>
    <CardHeader>
      <CardTitle>Recent Users</CardTitle>
      <CardDescription>Latest registered users in the system</CardDescription>
    </CardHeader>
    <CardContent>
      <div class="space-y-4">
        {#each data.stats.recentUsers as user (user.id)}
          <div class="flex items-center justify-between">
            <div>
              <p class="font-medium">{user.name}</p>
              <p class="text-sm text-gray-600">{user.email}</p>
            </div>
            <Badge>
              {new Date(user.created_at).toLocaleDateString()}
            </Badge>
          </div>
        {/each}
      </div>
    </CardContent>
  </Card>
</div>

<style>
  :global(body) {
    @apply bg-gray-50;
  }
</style>
`;

export const adminLayoutServer = `import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types.js';
import { User } from '$lib/models/User.js';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(302, '/login');
  }

  const user = await User.find(locals.user.id);
  if (!user || user.role?.name !== 'admin') {
    error(403, 'Forbidden');
  }

  return {
    user: locals.user,
  };
};
`;

export const adminLayoutSvelte = `<script>
  import { Button } from '$lib/components/ui/Button.svelte';
  import { Card } from '$lib/components/ui/Card.svelte';

  let { children, data } = $props();
</script>

<div class="flex h-screen bg-gray-100">
  <!-- Sidebar -->
  <aside class="w-64 bg-white shadow-sm">
    <div class="p-6">
      <h2 class="text-xl font-bold text-brand">Admin Panel</h2>
    </div>
    <nav class="space-y-1 px-4">
      <a href="/admin" class="block px-4 py-2 text-sm font-medium text-gray-900 rounded-md hover:bg-gray-50">
        Dashboard
      </a>
      <a href="/admin/users" class="block px-4 py-2 text-sm font-medium text-gray-600 rounded-md hover:bg-gray-50">
        Users
      </a>
      <a href="/admin/stats" class="block px-4 py-2 text-sm font-medium text-gray-600 rounded-md hover:bg-gray-50">
        Statistics
      </a>
    </nav>
  </aside>

  <!-- Main Content -->
  <main class="flex-1 overflow-auto">
    <div class="p-8">
      {@render children?.()}
    </div>
  </main>
</div>
`;

export const adminUsersRoute = `<script>
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/index.js';
  import { Button } from '$lib/components/ui/Button.svelte';
  import { Badge } from '$lib/components/ui/Badge.svelte';

  let { data } = $props();
</script>

<div class="space-y-8">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-3xl font-bold tracking-tight">Users</h1>
      <p class="text-gray-600 mt-2">Manage system users and their roles</p>
    </div>
    <Button>Add User</Button>
  </div>

  <Card>
    <CardHeader>
      <CardTitle>All Users</CardTitle>
    </CardHeader>
    <CardContent>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b">
            <tr>
              <th class="text-left py-3 px-4 font-medium">Name</th>
              <th class="text-left py-3 px-4 font-medium">Email</th>
              <th class="text-left py-3 px-4 font-medium">Role</th>
              <th class="text-left py-3 px-4 font-medium">Joined</th>
              <th class="text-left py-3 px-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each data.users as user (user.id)}
              <tr class="border-b hover:bg-gray-50">
                <td class="py-3 px-4">{user.name}</td>
                <td class="py-3 px-4">{user.email}</td>
                <td class="py-3 px-4">
                  <Badge variant={user.role?.name === 'admin' ? 'default' : 'secondary'}>
                    {user.role?.name || 'user'}
                  </Badge>
                </td>
                <td class="py-3 px-4">{new Date(user.created_at).toLocaleDateString()}</td>
                <td class="py-3 px-4">
                  <Button size="sm" variant="outline">Edit</Button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
</div>
`;

export const adminStatsRoute = `<script>
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/index.js';

  let { data } = $props();
</script>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">Statistics</h1>
    <p class="text-gray-600 mt-2">Application analytics and insights</p>
  </div>

  <!-- Stats Grid -->
  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Total Users</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="text-2xl font-bold">{data.stats.totalUsers}</div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Active Sessions</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="text-2xl font-bold">{data.stats.activeSessions}</div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Server Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="text-2xl font-bold text-green-600">Healthy</div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Response Time</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="text-2xl font-bold">{data.stats.avgResponseTime}ms</div>
      </CardContent>
    </Card>
  </div>
</div>
`;
