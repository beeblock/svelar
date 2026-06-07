<script lang="ts">
  import type { Snippet } from 'svelte';
  import SocialLoginButton from './SocialLoginButton.svelte';

  type ProviderName = 'google' | 'github';

  interface Props {
    providers: ProviderName[];
    redirectBase?: string;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'filled' | 'outline';
    class?: string;
    gap?: string;
    direction?: 'vertical' | 'horizontal';
    disabled?: boolean;
    labelFn?: (provider: ProviderName) => string;
    header?: Snippet;
    footer?: Snippet;
  }

  let {
    providers,
    redirectBase = '/auth',
    size = 'md',
    variant = 'filled',
    class: className = '',
    gap = '0.5rem',
    direction = 'vertical',
    disabled = false,
    labelFn,
    header,
    footer,
  }: Props = $props();
</script>

<div
  class="ssa-buttons {className}"
  style:gap={gap}
  style:flex-direction={direction === 'horizontal' ? 'row' : 'column'}
>
  {#if header}
    {@render header()}
  {/if}

  {#each providers as provider (provider)}
    <SocialLoginButton
      {provider}
      href="{redirectBase}/{provider}/redirect"
      {size}
      {variant}
      {disabled}
      label={labelFn ? labelFn(provider) : undefined}
    />
  {/each}

  {#if footer}
    {@render footer()}
  {/if}
</div>

<style>
  .ssa-buttons {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
</style>
