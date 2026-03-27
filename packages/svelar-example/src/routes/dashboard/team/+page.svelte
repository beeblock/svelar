<script lang="ts">
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Alert } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';

  interface TeamMember {
    id: string;
    name: string;
    email: string;
    role: 'owner' | 'admin' | 'member';
    joined_at: Date;
    avatar?: string;
  }

  interface PendingInvitation {
    id: string;
    email: string;
    role: 'admin' | 'member';
    sent_at: Date;
    expires_at: Date;
  }

  let { data } = $props();

  let teamName = $state('Acme Corp');
  let members = $state<TeamMember[]>([
    {
      id: '1',
      name: 'You',
      email: 'you@example.com',
      role: 'owner',
      joined_at: new Date('2024-01-01'),
    },
    {
      id: '2',
      name: 'John Doe',
      email: 'john@example.com',
      role: 'admin',
      joined_at: new Date('2024-02-01'),
    },
    {
      id: '3',
      name: 'Jane Smith',
      email: 'jane@example.com',
      role: 'member',
      joined_at: new Date('2024-02-15'),
    },
  ]);

  let pendingInvitations = $state<PendingInvitation[]>([
    {
      id: 'inv_1',
      email: 'pending@example.com',
      role: 'member',
      sent_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    },
  ]);

  let showInviteForm = $state(false);
  let inviteEmail = $state('');
  let inviteRole = $state<'admin' | 'member'>('member');
  let message = $state('');
  let messageType = $state<'success' | 'error'>('success');

  function sendInvitation() {
    if (!inviteEmail.trim()) {
      message = 'Please enter an email address';
      messageType = 'error';
      return;
    }

    if (!inviteEmail.includes('@')) {
      message = 'Please enter a valid email address';
      messageType = 'error';
      return;
    }

    // Check if already invited or member
    if (members.some((m) => m.email === inviteEmail) || pendingInvitations.some((i) => i.email === inviteEmail)) {
      message = 'This person is already a member or has been invited';
      messageType = 'error';
      return;
    }

    const invitation: PendingInvitation = {
      id: `inv_${Math.random().toString(36).substr(2, 9)}`,
      email: inviteEmail,
      role: inviteRole,
      sent_at: new Date(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };

    pendingInvitations = [...pendingInvitations, invitation];
    message = `Invitation sent to ${inviteEmail}`;
    messageType = 'success';
    showInviteForm = false;
    inviteEmail = '';
    inviteRole = 'member';

    setTimeout(() => {
      message = '';
    }, 3000);
  }

  function changeRole(memberId: string, newRole: 'admin' | 'member') {
    const member = members.find((m) => m.id === memberId);
    if (member && member.role !== 'owner') {
      member.role = newRole;
      members = members;
      message = `${member.name}'s role updated to ${newRole}`;
      messageType = 'success';
      setTimeout(() => {
        message = '';
      }, 3000);
    }
  }

  function removeMember(memberId: string, memberName: string) {
    if (confirm(`Remove ${memberName} from the team? This action cannot be undone.`)) {
      members = members.filter((m) => m.id !== memberId);
      message = `${memberName} has been removed from the team`;
      messageType = 'success';
      setTimeout(() => {
        message = '';
      }, 3000);
    }
  }

  function cancelInvitation(invitationId: string, email: string) {
    if (confirm(`Cancel invitation to ${email}?`)) {
      pendingInvitations = pendingInvitations.filter((i) => i.id !== invitationId);
      message = `Invitation to ${email} has been cancelled`;
      messageType = 'success';
      setTimeout(() => {
        message = '';
      }, 3000);
    }
  }

  function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function getRoleColor(role: string): 'default' | 'secondary' | 'destructive' {
    switch (role) {
      case 'owner':
        return 'destructive';
      case 'admin':
        return 'default';
      default:
        return 'secondary';
    }
  }
</script>

<svelte:head>
  <title>Team Settings — {m.app_name()}</title>
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

  <!-- Team Info -->
  <Card>
    <CardHeader>
      <CardTitle>Team Information</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      <div>
        <Label for="teamName">Team Name</Label>
        <div class="flex gap-2 mt-2">
          <Input
            id="teamName"
            bind:value={teamName}
            class="flex-1"
          />
          <Button>Save</Button>
        </div>
      </div>

      <div class="p-4 bg-gray-50 rounded-lg">
        <p class="text-sm text-gray-600 mb-1">Team ID</p>
        <code class="font-mono text-sm">team_abc123def456</code>
      </div>
    </CardContent>
  </Card>

  <!-- Invite Member Form -->
  <Card>
    <CardHeader>
      <CardTitle>Invite Team Member</CardTitle>
      <CardDescription>Add new members to your team</CardDescription>
    </CardHeader>
    <CardContent>
      {#if showInviteForm}
        <div class="space-y-4">
          <div>
            <Label for="inviteEmail">Email Address</Label>
            <Input
              id="inviteEmail"
              type="email"
              placeholder="member@example.com"
              bind:value={inviteEmail}
              class="mt-2"
            />
          </div>

          <div>
            <Label for="inviteRole">Role</Label>
            <select
              id="inviteRole"
              bind:value={inviteRole}
              class="mt-2 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="member">Member (Read only)</option>
              <option value="admin">Admin (Read & Write)</option>
            </select>
          </div>

          <div class="flex gap-2">
            <Button onclick={sendInvitation}>Send Invitation</Button>
            <Button
              variant="outline"
              onclick={() => {
                showInviteForm = false;
                inviteEmail = '';
                inviteRole = 'member';
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      {:else}
        <Button onclick={() => (showInviteForm = true)}>Invite Member</Button>
      {/if}
    </CardContent>
  </Card>

  <!-- Team Members -->
  <Card>
    <CardHeader>
      <CardTitle>Team Members</CardTitle>
      <CardDescription>{members.length} active member{members.length !== 1 ? 's' : ''}</CardDescription>
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
            {#each members as member (member.id)}
              <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="py-3 px-4">
                  <div class="flex items-center gap-2">
                    <div class="w-8 h-8 bg-[var(--color-brand)] rounded-full flex items-center justify-center text-white text-xs font-bold">
                      {member.name.substring(0, 2).toUpperCase()}
                    </div>
                    <p class="font-medium text-gray-900">{member.name}</p>
                  </div>
                </td>
                <td class="py-3 px-4 text-gray-600">{member.email}</td>
                <td class="py-3 px-4">
                  <Badge variant={getRoleColor(member.role)}>
                    {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                  </Badge>
                </td>
                <td class="py-3 px-4 text-gray-600">{formatDate(member.joined_at)}</td>
                <td class="py-3 px-4">
                  {#if member.role !== 'owner'}
                    <div class="flex gap-2">
                      <select
                        value={member.role}
                        onchange={(e) => changeRole(member.id, e.currentTarget.value as 'admin' | 'member')}
                        class="px-2 py-1 border border-gray-300 rounded text-xs"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                      <Button
                        size="sm"
                        variant="destructive"
                        onclick={() => removeMember(member.id, member.name)}
                      >
                        Remove
                      </Button>
                    </div>
                  {:else}
                    <span class="text-xs text-gray-500">Owner</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>

  <!-- Pending Invitations -->
  {#if pendingInvitations.length > 0}
    <Card>
      <CardHeader>
        <CardTitle>Pending Invitations</CardTitle>
        <CardDescription>{pendingInvitations.length} pending invite{pendingInvitations.length !== 1 ? 's' : ''}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-2">
          {#each pendingInvitations as invitation (invitation.id)}
            <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg bg-gray-50">
              <div>
                <p class="font-medium text-gray-900">{invitation.email}</p>
                <p class="text-xs text-gray-600">
                  Invited {formatDate(invitation.sent_at)} • Expires {formatDate(invitation.expires_at)}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <Badge variant="secondary" class="text-xs">
                  {invitation.role}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onclick={() => cancelInvitation(invitation.id, invitation.email)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          {/each}
        </div>
      </CardContent>
    </Card>
  {/if}

  <!-- Team Permissions -->
  <Card>
    <CardHeader>
      <CardTitle>Role Permissions</CardTitle>
      <CardDescription>What can each role do?</CardDescription>
    </CardHeader>
    <CardContent>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200">
              <th class="text-left py-3 px-4 font-semibold text-gray-900">Permission</th>
              <th class="text-center py-3 px-4 font-semibold text-gray-900">Owner</th>
              <th class="text-center py-3 px-4 font-semibold text-gray-900">Admin</th>
              <th class="text-center py-3 px-4 font-semibold text-gray-900">Member</th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-b border-gray-100">
              <td class="py-3 px-4 font-medium">Manage team settings</td>
              <td class="py-3 px-4 text-center">
                <svg class="w-5 h-5 text-green-500 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </td>
              <td class="py-3 px-4 text-center">—</td>
              <td class="py-3 px-4 text-center">—</td>
            </tr>
            <tr class="border-b border-gray-100">
              <td class="py-3 px-4 font-medium">Invite team members</td>
              <td class="py-3 px-4 text-center">
                <svg class="w-5 h-5 text-green-500 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </td>
              <td class="py-3 px-4 text-center">
                <svg class="w-5 h-5 text-green-500 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </td>
              <td class="py-3 px-4 text-center">—</td>
            </tr>
            <tr class="border-b border-gray-100">
              <td class="py-3 px-4 font-medium">Manage content</td>
              <td class="py-3 px-4 text-center">
                <svg class="w-5 h-5 text-green-500 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </td>
              <td class="py-3 px-4 text-center">
                <svg class="w-5 h-5 text-green-500 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </td>
              <td class="py-3 px-4 text-center">
                <svg class="w-5 h-5 text-green-500 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </td>
            </tr>
            <tr>
              <td class="py-3 px-4 font-medium">View analytics</td>
              <td class="py-3 px-4 text-center">
                <svg class="w-5 h-5 text-green-500 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </td>
              <td class="py-3 px-4 text-center">
                <svg class="w-5 h-5 text-green-500 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </td>
              <td class="py-3 px-4 text-center">
                <svg class="w-5 h-5 text-green-500 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
</div>
