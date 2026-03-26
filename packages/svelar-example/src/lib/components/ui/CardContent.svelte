<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { class: className = '', children, ...rest }: Props = $props();
</script>

<div class="p-6 pt-0 {className}" {...rest}>
  {#if children}{@render children()}{/if}
</div>
