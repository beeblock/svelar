<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon';
    class?: string;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    children?: Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  }

  let {
    variant = 'default',
    size = 'default',
    class: className = '',
    disabled = false,
    type = 'button',
    children,
    onclick,
    ...rest
  }: Props = $props();

  const variants: Record<string, string> = {
    default: 'bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)] shadow-sm',
    destructive: 'bg-red-500 text-white hover:bg-red-600 shadow-sm',
    outline: 'border border-gray-300 bg-white hover:bg-gray-50 text-gray-700',
    secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
    ghost: 'hover:bg-gray-100 text-gray-700',
    link: 'text-[var(--color-brand)] underline-offset-4 hover:underline',
  };

  const sizes: Record<string, string> = {
    default: 'h-10 px-4 py-2',
    sm: 'h-9 rounded-md px-3 text-sm',
    lg: 'h-11 rounded-md px-8 text-base',
    icon: 'h-10 w-10',
  };
</script>

<button
  {type}
  {disabled}
  class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 {variants[variant]} {sizes[size]} {className}"
  {onclick}
  {...rest}
>
  {#if children}{@render children()}{/if}
</button>
