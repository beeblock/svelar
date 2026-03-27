<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Alert } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';

  let { data, form: actionData } = $props();
  let apiKeys = $state(data.apiKeys);
  let showCreateForm = $state(false);
  let newKeyName = $state('');
  let newKeyPermissions = $state('read');
  let generatedKey = $state('');
  let showCopyAlert = $state(false);

  // Update keys when page data changes (after form submission)
  $effect(() => {
    apiKeys = data.apiKeys;
  });

  // Show the generated key after creation
  $effect(() => {
    if (actionData?.plainTextKey) {
      generatedKey = actionData.plainTextKey;
      showCreateForm = false;
      newKeyName = '';
      newKeyPermissions = 'read';
    }
  });

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    showCopyAlert = true;
    setTimeout(() => { showCopyAlert = false; }, 2000);
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
</script>

<svelte:head>
  <title>API Keys — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">API Keys</h1>
    <p class="text-gray-600 mt-1">Manage your API keys for programmatic access</p>
  </div>

  {#if showCopyAlert}
    <Alert variant="default">
      <span class="text-sm">Copied to clipboard!</span>
    </Alert>
  {/if}

  {#if actionData?.error}
    <Alert variant="destructive">
      <span class="text-sm">{actionData.error}</span>
    </Alert>
  {/if}

  {#if generatedKey}
    <Alert variant="default">
      <div class="space-y-2">
        <p class="font-medium">New API Key Created</p>
        <p class="text-sm">Copy your key now — you won't be able to see it again!</p>
        <div class="flex gap-2 mt-3">
          <code class="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono break-all">{generatedKey}</code>
          <Button size="sm" variant="outline" onclick={() => copyToClipboard(generatedKey)}>Copy</Button>
        </div>
      </div>
    </Alert>
  {/if}

  <!-- Create Key -->
  {#if showCreateForm}
    <Card>
      <CardHeader>
        <CardTitle>Create New API Key</CardTitle>
      </CardHeader>
      <CardContent>
        <form method="POST" action="?/create" use:enhance class="space-y-4">
          <div class="space-y-2">
            <Label for="keyName">Key Name</Label>
            <Input id="keyName" name="name" placeholder="e.g., Production Server" bind:value={newKeyName} required />
          </div>

          <div class="space-y-2">
            <Label for="permissions">Permissions (comma-separated)</Label>
            <Input id="permissions" name="permissions" placeholder="read,write" bind:value={newKeyPermissions} />
            <p class="text-xs text-gray-500">e.g., read, write, delete</p>
          </div>

          <div class="flex gap-2">
            <Button type="submit">Create Key</Button>
            <Button type="button" variant="outline" onclick={() => { showCreateForm = false; newKeyName = ''; }}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  {:else}
    <Button onclick={() => (showCreateForm = true)}>Create New Key</Button>
  {/if}

  <!-- Keys List -->
  <div class="space-y-4">
    <h2 class="text-xl font-bold text-gray-900">Your API Keys ({apiKeys.length})</h2>

    {#if apiKeys.length === 0}
      <Card>
        <CardContent class="pt-8 text-center">
          <p class="text-gray-500 text-sm">No API keys yet. Create one to get started with programmatic access.</p>
        </CardContent>
      </Card>
    {:else}
      <div class="space-y-3">
        {#each apiKeys as key (key.id)}
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1">
                  <div class="flex items-center gap-2 mb-2">
                    <h3 class="font-semibold text-gray-900">{key.name}</h3>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <p class="font-mono text-xs bg-gray-100 px-2 py-1 rounded inline-block mb-2">{key.prefix}••••••••</p>
                  <div class="flex gap-4 text-xs text-gray-500">
                    <span>Created {formatDate(key.createdAt)}</span>
                    {#if key.lastUsedAt}
                      <span>Last used {formatRelativeTime(key.lastUsedAt)}</span>
                    {:else}
                      <span>Never used</span>
                    {/if}
                  </div>
                  {#if key.permissions.length > 0}
                    <div class="flex gap-1 mt-2">
                      {#each key.permissions as perm}
                        <Badge variant="secondary" class="text-xs">{perm}</Badge>
                      {/each}
                    </div>
                  {/if}
                </div>
                <form method="POST" action="?/revoke" use:enhance>
                  <input type="hidden" name="keyId" value={key.id} />
                  <Button size="sm" variant="destructive" type="submit" onclick={(e) => { if (!confirm(`Revoke "${key.name}"?`)) e.preventDefault(); }}>
                    Revoke
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Usage Docs -->
  <Card>
    <CardHeader>
      <CardTitle>API Documentation</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      <div>
        <h4 class="font-medium text-gray-900 mb-2">Include API Key in Requests</h4>
        <code class="block bg-gray-100 px-4 py-3 rounded text-sm font-mono overflow-x-auto">
          curl -H "Authorization: Bearer sk_your_key_here" https://your-app.com/api/v1/data
        </code>
      </div>
    </CardContent>
  </Card>
</div>
