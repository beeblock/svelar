<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success';
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { variant = 'default', class: className = '', children, ...rest }: Props = $props();

  const variants: Record<string, string> = {
    default: 'bg-[var(--color-brand)] text-white',
    secondary: 'bg-gray-100 text-gray-900',
    destructive: 'bg-red-100 text-red-900',
    outline: 'border border-gray-300 bg-white text-gray-900',
    success: 'bg-green-100 text-green-900',
  };
</script>

<span
  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors {variants[variant]} {className}"
  {...rest}
>
  {#if children}{@render children()}{/if}
</span>
