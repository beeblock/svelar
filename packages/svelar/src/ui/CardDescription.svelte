<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { class: className = '', children, ...rest }: Props = $props();
</script>

<p class="text-sm text-gray-500 {className}" {...rest}>
  {#if children}{@render children()}{/if}
</p>
