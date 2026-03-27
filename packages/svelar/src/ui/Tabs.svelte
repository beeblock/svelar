<script lang="ts">
  import type { Snippet } from 'svelte';
  import { setContext } from 'svelte';

  interface Props {
    value?: string;
    onchange?: (value: string) => void;
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { value = '', onchange, class: className = '', children, ...rest }: Props = $props();

  setContext('tabs', {
    get value() { return value; },
    onchange,
  });
</script>

<div class="w-full {className}" {...rest}>
  {#if children}{@render children()}{/if}
</div>
