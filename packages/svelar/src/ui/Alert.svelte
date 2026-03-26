<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'destructive' | 'success';
    class?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { variant = 'default', class: className = '', children, ...rest }: Props = $props();

  const variants: Record<string, string> = {
    default: 'bg-blue-50 text-blue-900 border border-blue-200',
    destructive: 'bg-red-50 text-red-900 border border-red-200',
    success: 'bg-green-50 text-green-900 border border-green-200',
  };
</script>

<div class="rounded-lg p-4 {variants[variant]} {className}" role="alert" {...rest}>
  {#if children}{@render children()}{/if}
</div>
