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
  class="flex items-center justify-center w-full h-full bg-gray-300 text-gray-700 font-semibold text-sm {className}"
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>
