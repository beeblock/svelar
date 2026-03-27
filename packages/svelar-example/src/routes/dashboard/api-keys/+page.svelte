<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Alert } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatShortRelative } from '$lib/dates';

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
</script>

<svelte:head>
  <title>{m.apikeys_title()} — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">{m.apikeys_title()}</h1>
    <p class="text-gray-600 mt-1">{m.apikeys_subtitle()}</p>
  </div>

  {#if showCopyAlert}
    <Alert variant="default">
      <span class="text-sm">{m.apikeys_copied()}</span>
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
        <p class="font-medium">{m.apikeys_created()}</p>
        <p class="text-sm">{m.apikeys_created_desc()}</p>
        <div class="flex gap-2 mt-3">
          <code class="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono break-all">{generatedKey}</code>
          <Button size="sm" variant="outline" onclick={() => copyToClipboard(generatedKey)}>{m.common_copy()}</Button>
        </div>
      </div>
    </Alert>
  {/if}

  <!-- Create Key -->
  {#if showCreateForm}
    <Card>
      <CardHeader>
        <CardTitle>{m.apikeys_create_title()}</CardTitle>
      </CardHeader>
      <CardContent>
        <form method="POST" action="?/create" use:enhance class="space-y-4">
          <div class="space-y-2">
            <Label for="keyName">{m.apikeys_key_name()}</Label>
            <Input id="keyName" name="name" placeholder={m.apikeys_key_name_placeholder()} bind:value={newKeyName} required />
          </div>

          <div class="space-y-2">
            <Label for="permissions">{m.apikeys_permissions()}</Label>
            <Input id="permissions" name="permissions" placeholder="read,write" bind:value={newKeyPermissions} />
            <p class="text-xs text-gray-500">{m.apikeys_permissions_hint()}</p>
          </div>

          <div class="flex gap-2">
            <Button type="submit">{m.apikeys_create_submit()}</Button>
            <Button type="button" variant="outline" onclick={() => { showCreateForm = false; newKeyName = ''; }}>{m.common_cancel()}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  {:else}
    <Button onclick={() => (showCreateForm = true)}>{m.apikeys_create_btn()}</Button>
  {/if}

  <!-- Keys List -->
  <div class="space-y-4">
    <h2 class="text-xl font-bold text-gray-900">{m.apikeys_list_title({ count: String(apiKeys.length) })}</h2>

    {#if apiKeys.length === 0}
      <Card>
        <CardContent class="pt-8 text-center">
          <p class="text-gray-500 text-sm">{m.apikeys_empty()}</p>
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
                    <Badge variant="default">{m.apikeys_active()}</Badge>
                  </div>
                  <p class="font-mono text-xs bg-gray-100 px-2 py-1 rounded inline-block mb-2">{key.prefix}••••••••</p>
                  <div class="flex gap-4 text-xs text-gray-500">
                    <span>{m.apikeys_created_at({ date: formatDate(key.createdAt) })}</span>
                    {#if key.lastUsedAt}
                      <span>{m.apikeys_last_used({ time: formatShortRelative(key.lastUsedAt) })}</span>
                    {:else}
                      <span>{m.apikeys_never_used()}</span>
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
                  <Button size="sm" variant="destructive" type="submit" onclick={(e) => { if (!confirm(m.apikeys_confirm_revoke({ name: key.name }))) e.preventDefault(); }}>
                    {m.apikeys_revoke()}
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
      <CardTitle>{m.apikeys_docs_title()}</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      <div>
        <h4 class="font-medium text-gray-900 mb-2">{m.apikeys_docs_usage()}</h4>
        <code class="block bg-gray-100 px-4 py-3 rounded text-sm font-mono overflow-x-auto">
          curl -H "Authorization: Bearer sk_your_key_here" https://your-app.com/api/v1/data
        </code>
      </div>
    </CardContent>
  </Card>
</div>
