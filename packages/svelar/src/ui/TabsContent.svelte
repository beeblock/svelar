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

  const tabs = getContext<{ value: string }>('tabs');

  const isActive = $derived(tabs.value === value);
</script>

{#if isActive}
  <div
    role="tabpanel"
    class="ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 {className}"
    {...rest}
  >
    {#if children}{@render children()}{/if}
  </div>
{/if}
