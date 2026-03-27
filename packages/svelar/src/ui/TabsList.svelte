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
  class="inline-flex h-10 items-center justify-center rounded-md bg-gray-100 p-1 text-gray-500 {className}"
  role="tablist"
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>
