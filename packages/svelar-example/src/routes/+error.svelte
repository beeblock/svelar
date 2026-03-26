<script lang="ts">
  import { page } from '$app/state';
  import { Button, Card, CardContent } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { localizeHref } from '$lib/paraglide/runtime';

  const errorMessages: Record<number, { title: () => string; description: () => string }> = {
    400: { title: () => m.error_400_title(), description: () => m.error_400_desc() },
    401: { title: () => m.error_401_title(), description: () => m.error_401_desc() },
    403: { title: () => m.error_403_title(), description: () => m.error_403_desc() },
    404: { title: () => m.error_404_title(), description: () => m.error_404_desc() },
    500: { title: () => m.error_500_title(), description: () => m.error_500_desc() },
  };

  const status = $derived(page.status);
  const message = $derived(page.error?.message);
  const info = $derived(errorMessages[status] ?? { title: () => 'Error', description: () => 'An unexpected error occurred.' });
</script>

<svelte:head>
  <title>{status} — {info.title()} — {m.app_name()}</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-lg text-center">
    <CardContent class="pt-10 pb-10 space-y-6">
      <div class="text-8xl font-bold text-gray-200">{status}</div>

      <div class="space-y-2">
        <h1 class="text-2xl font-bold text-gray-900">{info.title()}</h1>
        <p class="text-gray-600">{message || info.description()}</p>
      </div>

      <div class="flex gap-3 justify-center pt-4">
        {#if status === 401}
          <Button href={localizeHref('/login')}>{m.error_sign_in()}</Button>
        {:else}
          <Button href={localizeHref('/')} variant="outline">{m.error_go_home()}</Button>
          <Button onclick={() => window.location.reload()}>{m.error_try_again()}</Button>
        {/if}
      </div>
    </CardContent>
  </Card>
</div>
