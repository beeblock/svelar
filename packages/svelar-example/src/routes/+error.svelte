<script lang="ts">
  import { page } from '$app/state';
  import { Button } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';
  import { localizeHref } from '$lib/paraglide/runtime';

  // ── Error metadata by status code ────────────────────────
  // Covers all standard HTTP error codes a user might encounter.

  interface ErrorMeta {
    title: () => string;
    description: () => string;
    icon: string;
    color: string;        // Tailwind text color
    bgColor: string;      // Tailwind bg for the icon circle
    suggestion?: 'login' | 'back' | 'home' | 'retry' | 'wait';
  }

  const errorMeta: Record<number, ErrorMeta> = {
    400: {
      title: () => m.error_400_title(),
      description: () => m.error_400_desc(),
      icon: '⚠',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
      suggestion: 'back',
    },
    401: {
      title: () => m.error_401_title(),
      description: () => m.error_401_desc(),
      icon: '🔒',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      suggestion: 'login',
    },
    403: {
      title: () => m.error_403_title(),
      description: () => m.error_403_desc(),
      icon: '🚫',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      suggestion: 'back',
    },
    404: {
      title: () => m.error_404_title(),
      description: () => m.error_404_desc(),
      icon: '🔍',
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
      suggestion: 'home',
    },
    405: {
      title: () => m.error_405_title(),
      description: () => m.error_405_desc(),
      icon: '🚧',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      suggestion: 'back',
    },
    408: {
      title: () => m.error_408_title(),
      description: () => m.error_408_desc(),
      icon: '⏱',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
      suggestion: 'retry',
    },
    409: {
      title: () => m.error_409_title(),
      description: () => m.error_409_desc(),
      icon: '⚡',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      suggestion: 'retry',
    },
    419: {
      title: () => m.error_419_title(),
      description: () => m.error_419_desc(),
      icon: '⏳',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
      suggestion: 'retry',
    },
    422: {
      title: () => m.error_422_title(),
      description: () => m.error_422_desc(),
      icon: '📝',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
      suggestion: 'back',
    },
    429: {
      title: () => m.error_429_title(),
      description: () => m.error_429_desc(),
      icon: '🐢',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      suggestion: 'wait',
    },
    500: {
      title: () => m.error_500_title(),
      description: () => m.error_500_desc(),
      icon: '💥',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      suggestion: 'retry',
    },
    502: {
      title: () => m.error_502_title(),
      description: () => m.error_502_desc(),
      icon: '🔌',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      suggestion: 'wait',
    },
    503: {
      title: () => m.error_503_title(),
      description: () => m.error_503_desc(),
      icon: '🔧',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
      suggestion: 'wait',
    },
    504: {
      title: () => m.error_504_title(),
      description: () => m.error_504_desc(),
      icon: '⏰',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      suggestion: 'retry',
    },
  };

  // Fallback for unknown status codes
  const fallbackMeta: ErrorMeta = {
    title: () => m.error_generic_title(),
    description: () => m.error_generic_desc(),
    icon: '❌',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    suggestion: 'home',
  };

  const status = $derived(page.status);
  const message = $derived(page.error?.message);
  const meta = $derived(errorMeta[status] ?? fallbackMeta);

  // Categorize for the color band at top
  const statusCategory = $derived(
    status >= 500 ? 'server' : status === 401 || status === 403 ? 'auth' : status === 404 ? 'notfound' : 'client'
  );

  const bandColors: Record<string, string> = {
    server: 'from-red-500 to-red-600',
    auth: 'from-blue-500 to-indigo-600',
    notfound: 'from-gray-400 to-gray-500',
    client: 'from-yellow-500 to-orange-500',
  };
</script>

<svelte:head>
  <title>{status} — {meta.title()} — {m.app_name()}</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)] px-4">
  <div class="w-full max-w-lg">
    <!-- Color band -->
    <div class="h-1.5 rounded-t-xl bg-gradient-to-r {bandColors[statusCategory]}"></div>

    <!-- Card -->
    <div class="bg-white border border-gray-200 border-t-0 rounded-b-xl shadow-lg overflow-hidden">
      <div class="px-8 pt-10 pb-8 text-center">
        <!-- Icon + Status Code -->
        <div class="flex items-center justify-center gap-4 mb-6">
          <div class="w-16 h-16 rounded-full {meta.bgColor} flex items-center justify-center text-2xl">
            {meta.icon}
          </div>
          <div class="text-left">
            <div class="text-5xl font-bold text-gray-200 leading-none">{status}</div>
          </div>
        </div>

        <!-- Title -->
        <h1 class="text-xl font-bold text-gray-900 mb-2">
          {meta.title()}
        </h1>

        <!-- Description -->
        <p class="text-gray-500 text-sm leading-relaxed max-w-sm mx-auto">
          {message || meta.description()}
        </p>

        <!-- Validation errors (if 422 with field errors) -->
        {#if status === 422 && page.error?.errors}
          <div class="mt-4 text-left bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <ul class="text-sm text-yellow-800 space-y-1">
              {#each Object.entries(page.error.errors) as [field, msgs]}
                <li><span class="font-medium capitalize">{field}:</span> {(msgs as string[]).join(', ')}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>

      <!-- Actions -->
      <div class="px-8 pb-8">
        <div class="flex gap-3 justify-center">
          {#if meta.suggestion === 'login'}
            <Button href={localizeHref('/login')} class="flex-1 max-w-[180px]">{m.error_sign_in()}</Button>
            <Button href={localizeHref('/')} variant="outline" class="flex-1 max-w-[180px]">{m.error_go_home()}</Button>
          {:else if meta.suggestion === 'retry'}
            <Button onclick={() => window.location.reload()} class="flex-1 max-w-[180px]">{m.error_try_again()}</Button>
            <Button href={localizeHref('/')} variant="outline" class="flex-1 max-w-[180px]">{m.error_go_home()}</Button>
          {:else if meta.suggestion === 'back'}
            <Button onclick={() => history.back()} variant="outline" class="flex-1 max-w-[180px]">{m.error_go_back()}</Button>
            <Button href={localizeHref('/')} variant="outline" class="flex-1 max-w-[180px]">{m.error_go_home()}</Button>
          {:else if meta.suggestion === 'wait'}
            <Button onclick={() => window.location.reload()} class="flex-1 max-w-[180px]">{m.error_try_again()}</Button>
            <p class="text-xs text-gray-400 self-center">{m.error_wait_hint()}</p>
          {:else}
            <Button href={localizeHref('/')} class="flex-1 max-w-[180px]">{m.error_go_home()}</Button>
          {/if}
        </div>
      </div>

      <!-- Technical details (development only — server passes stack in debug mode) -->
      {#if page.error?.stack}
        <div class="border-t border-gray-100 px-8 py-4">
          <details class="text-xs">
            <summary class="text-gray-400 cursor-pointer hover:text-gray-600 font-medium">
              {m.error_technical_details()}
            </summary>
            <pre class="mt-2 p-3 bg-gray-50 rounded text-gray-600 overflow-x-auto whitespace-pre-wrap break-words max-h-48">{page.error.stack}</pre>
          </details>
        </div>
      {/if}
    </div>
  </div>
</div>
