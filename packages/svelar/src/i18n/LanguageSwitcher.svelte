<script lang="ts">
  // Svelar Language Switcher Component
  // A generic locale switcher that works with paraglide-js 2.x.
  // Pass in your paraglide runtime functions and it handles the rest.

  interface Props {
    /** Available locale codes (e.g. ['en', 'pt']) */
    locales: readonly string[];
    /** Function that returns the current locale */
    getLocale: () => string;
    /** Function to localize a path for a given locale */
    localizeHref: (path: string, options?: { locale: string }) => string;
    /** Current pathname (e.g. page.url.pathname) */
    pathname?: string;
    /** Optional display labels per locale (e.g. { en: 'EN', pt: 'PT' }) */
    labels?: Record<string, string>;
    /** Extra CSS class for the container */
    class?: string;
    [key: string]: any;
  }

  let {
    locales,
    getLocale,
    localizeHref,
    pathname = '/',
    labels = {},
    class: className = '',
    ...rest
  }: Props = $props();
</script>

<div class="flex items-center gap-1 border border-gray-200 rounded-md overflow-hidden {className}" {...rest}>
  {#each locales as locale}
    {@const current = getLocale() === locale}
    <a
      href={localizeHref(pathname, { locale })}
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
