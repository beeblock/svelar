<script lang="ts">
  import { page } from '$app/state';
  import { locales, getLocale, localizeHref } from '$lib/paraglide/runtime';

  const labels: Record<string, string> = {
    en: 'EN',
    pt: 'PT',
  };
</script>

<div class="flex items-center gap-1 border border-gray-200 rounded-md overflow-hidden">
  {#each locales as locale}
    {@const current = getLocale() === locale}
    <a
      href={localizeHref(page.url.pathname, { locale })}
      hreflang={locale}
      data-sveltekit-reload
      class="px-2 py-1 text-xs font-medium transition-colors {current
        ? 'bg-brand text-white'
        : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}"
    >
      {labels[locale] ?? locale.toUpperCase()}
    </a>
  {/each}
</div>
