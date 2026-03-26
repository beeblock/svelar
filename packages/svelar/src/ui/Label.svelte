<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    for?: string;
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { for: htmlFor = '', class: className = '', children, ...rest }: Props = $props();
</script>

<label
  {htmlFor}
  class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 {className}"
  {...rest}
>
  {#if children}{@render children()}{/if}
</label>
