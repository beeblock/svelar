<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { class: className = '', children, ...rest }: Props = $props();
</script>

<div class="rounded-lg border border-gray-200 bg-white shadow-sm {className}" {...rest}>
  {#if children}{@render children()}{/if}
</div>
