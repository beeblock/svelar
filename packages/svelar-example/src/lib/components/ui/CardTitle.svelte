<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { class: className = '', children, ...rest }: Props = $props();
</script>

<h2 class="text-2xl font-semibold leading-none tracking-tight {className}" {...rest}>
  {#if children}{@render children()}{/if}
</h2>
