<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getContext } from 'svelte';

  interface Props {
    value: string;
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { value, class: className = '', children, ...rest }: Props = $props();

  const tabs = getContext<{ value: string; onchange?: (v: string) => void }>('tabs');

  const isActive = $derived(tabs.value === value);
</script>

<button
  type="button"
  role="tab"
  aria-selected={isActive}
  class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 {isActive ? 'bg-white text-gray-900 shadow-sm' : ''} {className}"
  onclick={() => tabs.onchange?.(value)}
  {...rest}
>
  {#if children}{@render children()}{/if}
</button>
