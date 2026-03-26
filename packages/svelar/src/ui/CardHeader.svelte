<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { class: className = '', children, ...rest }: Props = $props();
</script>

<div class="flex flex-col space-y-1.5 p-6 {className}" {...rest}>
  {#if children}{@render children()}{/if}
</div>
