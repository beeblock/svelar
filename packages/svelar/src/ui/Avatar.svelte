<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { class: className = '', children, ...rest }: Props = $props();
</script>

<div
  class="relative inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-200 {className}"
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>
