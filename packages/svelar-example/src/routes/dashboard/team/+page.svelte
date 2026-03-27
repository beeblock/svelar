<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Alert } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatDate } from '$lib/dates';

  let { data, form: actionData } = $props();
  let members = $state(data.members);
  let invitations = $state(data.invitations);
  let teamName = $state(data.team?.name ?? '');
  let showInviteForm = $state(false);
  let message = $state('');
  let messageType = $state<'success' | 'error'>('success');

  $effect(() => {
    members = data.members;
    invitations = data.invitations;
    teamName = data.team?.name ?? '';
  });

  $effect(() => {
    if (actionData?.invited) {
      message = m.team_invited({ email: actionData.invited });
      messageType = 'success';
      showInviteForm = false;
    }
    if (actionData?.removed) {
      message = m.team_member_removed();
      messageType = 'success';
    }
    if (actionData?.cancelled) {
      message = m.team_inv_cancelled();
      messageType = 'success';
    }
    if (actionData?.updated) {
      message = m.team_updated();
      messageType = 'success';
    }
    if (actionData?.error) {
      message = actionData.error;
      messageType = 'error';
    }
  });

  function getRoleColor(role: string): 'default' | 'secondary' | 'destructive' {
    return role === 'owner' ? 'destructive' : role === 'admin' ? 'default' : 'secondary';
  }
</script>

<svelte:head>
  <title>{m.team_title()} — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">{m.team_title()}</h1>
    <p class="text-gray-600 mt-1">{m.team_subtitle()}</p>
  </div>

  {#if message}
    <Alert variant={messageType === 'error' ? 'destructive' : 'success'}>
      <span class="text-sm">{message}</span>
    </Alert>
  {/if}

  {#if data.team}
    <!-- Team Info -->
    <Card>
      <CardHeader>
        <CardTitle>{m.team_info()}</CardTitle>
      </CardHeader>
      <CardContent>
        <form method="POST" action="?/updateTeam" use:enhance class="space-y-4">
          <input type="hidden" name="teamId" value={data.team.id} />
          <div>
            <Label for="teamName">{m.team_name_label()}</Label>
            <div class="flex gap-2 mt-2">
              <Input id="teamName" name="name" bind:value={teamName} class="flex-1" />
              <Button type="submit">{m.common_save()}</Button>
            </div>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <p class="text-sm text-gray-600 mb-1">{m.team_id_label()}</p>
            <code class="font-mono text-sm">{data.team.id}</code>
          </div>
        </form>
      </CardContent>
    </Card>

    <!-- Invite Member -->
    <Card>
      <CardHeader>
        <CardTitle>{m.team_invite_title()}</CardTitle>
        <CardDescription>{m.team_invite_desc()}</CardDescription>
      </CardHeader>
      <CardContent>
        {#if showInviteForm}
          <form method="POST" action="?/invite" use:enhance class="space-y-4">
            <input type="hidden" name="teamId" value={data.team.id} />
            <div>
              <Label for="email">{m.team_email()}</Label>
              <Input id="email" name="email" type="email" placeholder="member@example.com" required class="mt-2" />
            </div>
            <div>
              <Label for="role">{m.team_role()}</Label>
              <select id="role" name="role" class="mt-2 w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                <option value="member">{m.team_role_member()}</option>
                <option value="admin">{m.team_role_admin()}</option>
              </select>
            </div>
            <div class="flex gap-2">
              <Button type="submit">{m.team_send_invite()}</Button>
              <Button type="button" variant="outline" onclick={() => (showInviteForm = false)}>{m.common_cancel()}</Button>
            </div>
          </form>
        {:else}
          <Button onclick={() => (showInviteForm = true)}>{m.team_invite_btn()}</Button>
        {/if}
      </CardContent>
    </Card>

    <!-- Members -->
    <Card>
      <CardHeader>
        <CardTitle>{m.team_members_title()}</CardTitle>
        <CardDescription>{m.team_member_count({ count: String(members.length) })}</CardDescription>
      </CardHeader>
      <CardContent>
        {#if members.length > 0}
          <div class="space-y-3">
            {#each members as member (member.id)}
              <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 bg-[var(--color-brand)] rounded-full flex items-center justify-center text-white text-xs font-bold">
                    {String(member.userId).substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p class="font-medium text-gray-900">
                      {member.userId == data.user.id ? `${data.user.name} ${m.team_you()}` : m.team_user_label({ id: member.userId })}
                    </p>
                    <p class="text-xs text-gray-500">{m.team_joined({ date: formatDate(member.joinedAt) })}</p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <Badge variant={getRoleColor(member.role)}>
                    {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                  </Badge>
                  {#if member.role !== 'owner' && member.userId != data.user.id}
                    <form method="POST" action="?/removeMember" use:enhance>
                      <input type="hidden" name="teamId" value={data.team.id} />
                      <input type="hidden" name="userId" value={member.userId} />
                      <Button size="sm" variant="destructive" type="submit"
                        onclick={(e) => { if (!confirm(m.team_confirm_remove())) e.preventDefault(); }}>
                        {m.team_remove()}
                      </Button>
                    </form>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-gray-500 text-center py-4">{m.team_no_members()}</p>
        {/if}
      </CardContent>
    </Card>

    <!-- Pending Invitations -->
    {#if invitations.length > 0}
      <Card>
        <CardHeader>
          <CardTitle>{m.team_pending_title()}</CardTitle>
          <CardDescription>{m.team_pending_count({ count: String(invitations.length) })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-2">
            {#each invitations as inv (inv.id)}
              <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg bg-gray-50">
                <div>
                  <p class="font-medium text-gray-900">{inv.email}</p>
                  <p class="text-xs text-gray-600">
                    {m.team_sent_expires({ sent: formatDate(inv.createdAt), expires: formatDate(inv.expiresAt) })}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <Badge variant="secondary">{inv.role}</Badge>
                  <form method="POST" action="?/cancelInvitation" use:enhance>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <Button size="sm" variant="outline" type="submit">{m.common_cancel()}</Button>
                  </form>
                </div>
              </div>
            {/each}
          </div>
        </CardContent>
      </Card>
    {/if}
  {:else}
    <Card>
      <CardContent class="pt-8 text-center">
        <p class="text-gray-500">{m.team_load_error()}</p>
      </CardContent>
    </Card>
  {/if}
</div>
