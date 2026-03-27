<script lang="ts">
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Alert } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';

  interface ApiKey {
    id: string;
    name: string;
    key: string;
    masked: string;
    created_at: Date;
    last_used_at: Date | null;
    permissions: string[];
  }

  let { data } = $props();

  let apiKeys = $state<ApiKey[]>([
    {
      id: 'key_1',
      name: 'Production API Key',
      key: 'sk_live_abc123def456ghi789',
      masked: 'sk_live_••••••••••••••••789',
      created_at: new Date('2024-01-15'),
      last_used_at: new Date(Date.now() - 5 * 60 * 1000),
      permissions: ['read', 'write'],
    },
    {
      id: 'key_2',
      name: 'Development Key',
      key: 'sk_test_xyz789abc123def',
      masked: 'sk_test_••••••••••••••••def',
      created_at: new Date('2024-02-01'),
      last_used_at: new Date(Date.now() - 1 * 60 * 60 * 1000),
      permissions: ['read'],
    },
  ]);

  let showCreateForm = $state(false);
  let newKeyName = $state('');
  let newKeyPermissions = $state<string[]>(['read']);
  let generatedKey = $state('');
  let showCopyAlert = $state(false);

  function createNewKey() {
    if (!newKeyName.trim()) {
      alert('Please enter a key name');
      return;
    }

    const keyId = `key_${Math.random().toString(36).substr(2, 9)}`;
    const key = `sk_live_${Math.random().toString(36).substr(2, 20)}`;
    const masked = key.substring(0, 10) + '••••••••••••••••' + key.substring(key.length - 3);

    const newKey: ApiKey = {
      id: keyId,
      name: newKeyName,
      key,
      masked,
      created_at: new Date(),
      last_used_at: null,
      permissions: newKeyPermissions,
    };

    apiKeys = [newKey, ...apiKeys];
    generatedKey = key;
    showCreateForm = false;
    newKeyName = '';
    newKeyPermissions = ['read'];
  }

  function copyToClipboard(key: string) {
    navigator.clipboard.writeText(key);
    showCopyAlert = true;
    setTimeout(() => {
      showCopyAlert = false;
    }, 2000);
  }

  function revokeKey(keyId: string, keyName: string) {
    if (confirm(`Are you sure you want to revoke "${keyName}"? This action cannot be undone.`)) {
      apiKeys = apiKeys.filter((k) => k.id !== keyId);
    }
  }

  function togglePermission(permission: string) {
    if (newKeyPermissions.includes(permission)) {
      newKeyPermissions = newKeyPermissions.filter((p) => p !== permission);
    } else {
      newKeyPermissions = [...newKeyPermissions, permission];
    }
  }

  function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatRelativeTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    return `${days} day${days !== 1 ? 's' : ''} ago`;
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
      <span class="text-sm">API key copied to clipboard!</span>
    </Alert>
  {/if}

  {#if generatedKey}
    <Alert variant="default">
      <div class="space-y-2">
        <p class="font-medium">New API Key Created</p>
        <p class="text-sm">
          Make sure to copy your API key now. You won't be able to see it again!
        </p>
        <div class="flex gap-2 mt-3">
          <code class="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono break-all">
            {generatedKey}
          </code>
          <Button size="sm" variant="outline" onclick={() => copyToClipboard(generatedKey)}>
            Copy
          </Button>
        </div>
      </div>
    </Alert>
  {/if}

  <!-- Create New Key Form -->
  {#if showCreateForm}
    <Card>
      <CardHeader>
        <CardTitle>Create New API Key</CardTitle>
      </CardHeader>
      <CardContent class="space-y-6">
        <div class="space-y-2">
          <Label for="keyName">Key Name</Label>
          <Input
            id="keyName"
            placeholder="e.g., Production Server, Mobile App"
            bind:value={newKeyName}
          />
          <p class="text-xs text-gray-600">Give your key a descriptive name to keep track of it</p>
        </div>

        <div class="space-y-2">
          <Label>Permissions</Label>
          <div class="space-y-2">
            {#each ['read', 'write', 'delete'] as permission}
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newKeyPermissions.includes(permission)}
                  onchange={() => togglePermission(permission)}
                  class="w-4 h-4 rounded border border-gray-300 cursor-pointer"
                />
                <span class="text-sm capitalize text-gray-700">{permission} access</span>
              </label>
            {/each}
          </div>
        </div>

        <div class="flex gap-2">
          <Button onclick={createNewKey}>Create Key</Button>
          <Button
            variant="outline"
            onclick={() => {
              showCreateForm = false;
              newKeyName = '';
              newKeyPermissions = ['read'];
            }}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  {:else}
    <Button onclick={() => (showCreateForm = true)}>Create New Key</Button>
  {/if}

  <!-- API Keys List -->
  <div class="space-y-4">
    <h2 class="text-xl font-bold text-gray-900">Your API Keys</h2>

    {#if apiKeys.length === 0}
      <Card>
        <CardContent class="pt-8 text-center">
          <p class="text-gray-500 text-sm">No API keys yet. Create one to get started.</p>
        </CardContent>
      </Card>
    {:else}
      <div class="space-y-3">
        {#each apiKeys as apiKey (apiKey.id)}
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1">
                  <div class="flex items-center gap-2 mb-2">
                    <h3 class="font-semibold text-gray-900">{apiKey.name}</h3>
                    <Badge variant="secondary">Active</Badge>
                  </div>

                  <div class="space-y-2 text-sm text-gray-600">
                    <p class="font-mono text-xs bg-gray-100 px-2 py-1 rounded inline-block">
                      {apiKey.masked}
                    </p>

                    <div class="flex gap-4 text-xs">
                      <span>Created {formatDate(apiKey.created_at)}</span>
                      {#if apiKey.last_used_at}
                        <span>Last used {formatRelativeTime(apiKey.last_used_at)}</span>
                      {:else}
                        <span>Never used</span>
                      {/if}
                    </div>

                    <div class="flex gap-2 mt-2">
                      {#each apiKey.permissions as permission}
                        <Badge variant="secondary" class="text-xs">
                          {permission}
                        </Badge>
                      {/each}
                    </div>
                  </div>
                </div>

                <div class="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={() => copyToClipboard(apiKey.masked)}
                  >
                    Show Full Key
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onclick={() => revokeKey(apiKey.id, apiKey.name)}
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Documentation -->
  <Card>
    <CardHeader>
      <CardTitle>API Documentation</CardTitle>
      <CardDescription>How to use your API keys</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <div>
        <h4 class="font-medium text-gray-900 mb-2">Include API Key in Requests</h4>
        <code class="block bg-gray-100 px-4 py-3 rounded text-sm font-mono overflow-x-auto">
curl -H "Authorization: Bearer sk_live_your_api_key_here" \
  https://api.example.com/v1/posts
        </code>
      </div>

      <div>
        <h4 class="font-medium text-gray-900 mb-2">Best Practices</h4>
        <ul class="space-y-2 text-sm text-gray-700">
          <li class="flex gap-2">
            <span class="text-[var(--color-brand)]">•</span>
            <span>Never commit API keys to version control</span>
          </li>
          <li class="flex gap-2">
            <span class="text-[var(--color-brand)]">•</span>
            <span>Rotate keys regularly for security</span>
          </li>
          <li class="flex gap-2">
            <span class="text-[var(--color-brand)]">•</span>
            <span>Use separate keys for different environments</span>
          </li>
          <li class="flex gap-2">
            <span class="text-[var(--color-brand)]">•</span>
            <span>Revoke keys you no longer use</span>
          </li>
        </ul>
      </div>
    </CardContent>
  </Card>
</div>
