<script lang="ts">
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';
  import { localizeHref } from '$lib/paraglide/runtime';
  import { timeAgo } from '$lib/dates';

  let { data } = $props();
</script>

<svelte:head>
  <title>{m.dashboard_title()} — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900 mb-2">{m.dashboard_title()}</h1>
    <p class="text-gray-600">{m.dashboard_welcome({ name: data.user.name })}</p>
  </div>

  <!-- Quick Stats -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <Card>
      <CardContent class="pt-6">
        <div>
          <p class="text-sm text-gray-600">{m.dash_stat_api_keys()}</p>
          <p class="text-3xl font-bold text-[var(--color-brand)] mt-2">{data.stats.apiKeyCount}</p>
          <a href={localizeHref('/dashboard/api-keys')} class="text-sm text-[var(--color-brand)] hover:underline mt-2 inline-block">{m.dash_manage_keys()}</a>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="pt-6">
        <div>
          <p class="text-sm text-gray-600">{m.dash_stat_team_members()}</p>
          <p class="text-3xl font-bold text-[var(--color-brand)] mt-2">{data.stats.teamMemberCount}</p>
          <a href={localizeHref('/dashboard/team')} class="text-sm text-[var(--color-brand)] hover:underline mt-2 inline-block">{m.dash_manage_team()}</a>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="pt-6">
        <div>
          <p class="text-sm text-gray-600">{m.dash_stat_account()}</p>
          <Badge variant="default" class="mt-2">{data.user.role}</Badge>
          <a href={localizeHref('/dashboard/billing')} class="text-sm text-[var(--color-brand)] hover:underline mt-2 inline-block block">{m.dash_view_billing()}</a>
        </div>
      </CardContent>
    </Card>
  </div>

  <!-- Quick Actions -->
  <Card>
    <CardHeader>
      <CardTitle>{m.dash_quick_actions()}</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-wrap gap-3">
      <a href={localizeHref('/dashboard/api-keys')}>
        <Button variant="outline">{m.dash_action_create_key()}</Button>
      </a>
      <a href={localizeHref('/dashboard/team')}>
        <Button variant="outline">{m.dash_action_invite()}</Button>
      </a>
      <a href={localizeHref('/dashboard/billing')}>
        <Button variant="outline">{m.dash_action_billing()}</Button>
      </a>
      {#if data.user.role === 'admin'}
        <a href={localizeHref('/admin')}>
          <Button variant="outline">{m.dash_action_admin()}</Button>
        </a>
      {/if}
    </CardContent>
  </Card>

  <!-- Recent Activity -->
  <Card>
    <CardHeader>
      <CardTitle>{m.dash_recent_activity()}</CardTitle>
      <CardDescription>{m.dash_recent_activity_desc()}</CardDescription>
    </CardHeader>
    <CardContent>
      {#if data.recentActivity.length > 0}
        <div class="space-y-3">
          {#each data.recentActivity as entry, i (i)}
            <div class="flex items-start gap-3 py-2 {i < data.recentActivity.length - 1 ? 'border-b border-gray-100' : ''}">
              <div class="w-2 h-2 mt-2 rounded-full bg-[var(--color-brand)]"></div>
              <div class="flex-1">
                <p class="text-sm text-gray-900">{entry.description}</p>
                {#if entry.timestamp}
                  <p class="text-xs text-gray-500 mt-0.5">{timeAgo(entry.timestamp)}</p>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-sm text-gray-500 py-4 text-center">{m.dash_no_activity()}</p>
      {/if}
    </CardContent>
  </Card>

  <!-- Getting Started -->
  <Card>
    <CardHeader>
      <CardTitle>{m.dash_getting_started()}</CardTitle>
      <CardDescription>{m.dash_getting_started_desc()}</CardDescription>
    </CardHeader>
    <CardContent>
      <div class="space-y-4">
        <div class="flex items-center gap-4 p-3 rounded-lg border border-gray-200">
          <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold {data.stats.apiKeyCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">
            {data.stats.apiKeyCount > 0 ? '✓' : '1'}
          </div>
          <div class="flex-1">
            <p class="font-medium text-gray-900">{m.dash_step_api_key()}</p>
            <p class="text-sm text-gray-600">{m.dash_step_api_key_desc()}</p>
          </div>
          {#if data.stats.apiKeyCount === 0}
            <a href={localizeHref('/dashboard/api-keys')}>
              <Button size="sm">{m.common_create()}</Button>
            </a>
          {/if}
        </div>

        <div class="flex items-center gap-4 p-3 rounded-lg border border-gray-200">
          <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold {data.stats.teamMemberCount > 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">
            {data.stats.teamMemberCount > 1 ? '✓' : '2'}
          </div>
          <div class="flex-1">
            <p class="font-medium text-gray-900">{m.dash_step_invite()}</p>
            <p class="text-sm text-gray-600">{m.dash_step_invite_desc()}</p>
          </div>
          {#if data.stats.teamMemberCount <= 1}
            <a href={localizeHref('/dashboard/team')}>
              <Button size="sm">{m.common_invite()}</Button>
            </a>
          {/if}
        </div>

        <div class="flex items-center gap-4 p-3 rounded-lg border border-gray-200">
          <div class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-sm font-bold">3</div>
          <div class="flex-1">
            <p class="font-medium text-gray-900">{m.dash_step_billing()}</p>
            <p class="text-sm text-gray-600">{m.dash_step_billing_desc()}</p>
          </div>
          <a href={localizeHref('/dashboard/billing')}>
            <Button size="sm" variant="outline">{m.common_configure()}</Button>
          </a>
        </div>
      </div>
    </CardContent>
  </Card>
</div>
