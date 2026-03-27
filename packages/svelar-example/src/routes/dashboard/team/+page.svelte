<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Alert } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';

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
      message = `Invitation sent to ${actionData.invited}`;
      messageType = 'success';
      showInviteForm = false;
    }
    if (actionData?.removed) {
      message = 'Member removed';
      messageType = 'success';
    }
    if (actionData?.cancelled) {
      message = 'Invitation cancelled';
      messageType = 'success';
    }
    if (actionData?.updated) {
      message = 'Team updated';
      messageType = 'success';
    }
    if (actionData?.error) {
      message = actionData.error;
      messageType = 'error';
    }
  });

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function getRoleColor(role: string): 'default' | 'secondary' | 'destructive' {
    return role === 'owner' ? 'destructive' : role === 'admin' ? 'default' : 'secondary';
  }
</script>

<svelte:head>
  <title>Team — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">Team Settings</h1>
    <p class="text-gray-600 mt-1">Manage your team members and permissions</p>
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
        <CardTitle>Team Information</CardTitle>
      </CardHeader>
      <CardContent>
        <form method="POST" action="?/updateTeam" use:enhance class="space-y-4">
          <input type="hidden" name="teamId" value={data.team.id} />
          <div>
            <Label for="teamName">Team Name</Label>
            <div class="flex gap-2 mt-2">
              <Input id="teamName" name="name" bind:value={teamName} class="flex-1" />
              <Button type="submit">Save</Button>
            </div>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <p class="text-sm text-gray-600 mb-1">Team ID</p>
            <code class="font-mono text-sm">{data.team.id}</code>
          </div>
        </form>
      </CardContent>
    </Card>

    <!-- Invite Member -->
    <Card>
      <CardHeader>
        <CardTitle>Invite Team Member</CardTitle>
        <CardDescription>Send invitations to add people to your team</CardDescription>
      </CardHeader>
      <CardContent>
        {#if showInviteForm}
          <form method="POST" action="?/invite" use:enhance class="space-y-4">
            <input type="hidden" name="teamId" value={data.team.id} />
            <div>
              <Label for="email">Email Address</Label>
              <Input id="email" name="email" type="email" placeholder="member@example.com" required class="mt-2" />
            </div>
            <div>
              <Label for="role">Role</Label>
              <select id="role" name="role" class="mt-2 w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div class="flex gap-2">
              <Button type="submit">Send Invitation</Button>
              <Button type="button" variant="outline" onclick={() => (showInviteForm = false)}>Cancel</Button>
            </div>
          </form>
        {:else}
          <Button onclick={() => (showInviteForm = true)}>Invite Member</Button>
        {/if}
      </CardContent>
    </Card>

    <!-- Members -->
    <Card>
      <CardHeader>
        <CardTitle>Team Members</CardTitle>
        <CardDescription>{members.length} member{members.length !== 1 ? 's' : ''}</CardDescription>
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
                      {member.userId == data.user.id ? `${data.user.name} (You)` : `User ${member.userId}`}
                    </p>
                    <p class="text-xs text-gray-500">Joined {formatDate(member.joinedAt)}</p>
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
                        onclick={(e) => { if (!confirm('Remove this member?')) e.preventDefault(); }}>
                        Remove
                      </Button>
                    </form>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-gray-500 text-center py-4">No members yet.</p>
        {/if}
      </CardContent>
    </Card>

    <!-- Pending Invitations -->
    {#if invitations.length > 0}
      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>{invitations.length} pending</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-2">
            {#each invitations as inv (inv.id)}
              <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg bg-gray-50">
                <div>
                  <p class="font-medium text-gray-900">{inv.email}</p>
                  <p class="text-xs text-gray-600">
                    Sent {formatDate(inv.createdAt)} — Expires {formatDate(inv.expiresAt)}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <Badge variant="secondary">{inv.role}</Badge>
                  <form method="POST" action="?/cancelInvitation" use:enhance>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <Button size="sm" variant="outline" type="submit">Cancel</Button>
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
        <p class="text-gray-500">Unable to load team. Please try refreshing the page.</p>
      </CardContent>
    </Card>
  {/if}
</div>
