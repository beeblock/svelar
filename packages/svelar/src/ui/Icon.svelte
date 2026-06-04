<script lang="ts">
  import type { Snippet, Component } from 'svelte';

  interface Props {
    // A Svelte icon component (from @lucide/svelte or @tabler/icons-svelte)
    icon?: Component<any>;
    // Raw SVG path data (d attribute) for inline icons
    path?: string;
    size?: number;
    strokeWidth?: number;
    color?: string;
    class?: string;
    'aria-label'?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let {
    icon,
    path,
    size = 24,
    strokeWidth = 2,
    color = 'currentColor',
    class: className = '',
    'aria-label': ariaLabel,
    children,
    ...rest
  }: Props = $props();
</script>

{#if icon}
  {@const IconComponent = icon}
  <IconComponent
    {size}
    {strokeWidth}
    stroke-width={strokeWidth}
    {color}
    class={className}
    aria-label={ariaLabel}
    aria-hidden={!ariaLabel}
    {...rest}
  />
{:else if path}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    class={className}
    role={ariaLabel ? 'img' : 'presentation'}
    aria-label={ariaLabel}
    aria-hidden={!ariaLabel}
    {...rest}
  >
    <path d={path} />
  </svg>
{:else if children}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    class={className}
    role={ariaLabel ? 'img' : 'presentation'}
    aria-label={ariaLabel}
    aria-hidden={!ariaLabel}
    {...rest}
  >
    {@render children()}
  </svg>
{/if}
