<script lang="ts">
  import type { Snippet } from 'svelte';

  export type SocialLoginProvider = 'google' | 'github';

  interface Props {
    provider: SocialLoginProvider;
    href?: string;
    label?: string;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'filled' | 'outline';
    class?: string;
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
    children?: Snippet;
  }

  let {
    provider,
    href,
    label,
    size = 'md',
    variant = 'filled',
    class: className = '',
    disabled = false,
    onclick,
    children,
  }: Props = $props();

  const providerLabels: Record<SocialLoginProvider, string> = {
    google: 'Google',
    github: 'GitHub',
  };

  let displayLabel = $derived(label ?? `Continue with ${providerLabels[provider]}`);
</script>

{#snippet icon()}
  {#if provider === 'google'}
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
    </svg>
  {/if}
{/snippet}

{#snippet content()}
  <span class="ssa-btn-icon">{@render icon()}</span>
  <span class="ssa-btn-label">
    {#if children}
      {@render children()}
    {:else}
      {displayLabel}
    {/if}
  </span>
{/snippet}

{#if href}
  <a
    {href}
    class="ssa-btn ssa-btn-{provider} ssa-btn-{size} ssa-btn-{variant} {className}"
    class:ssa-btn-disabled={disabled}
    aria-disabled={disabled}
  >
    {@render content()}
  </a>
{:else}
  <button
    type="button"
    class="ssa-btn ssa-btn-{provider} ssa-btn-{size} ssa-btn-{variant} {className}"
    {disabled}
    onclick={onclick}
  >
    {@render content()}
  </button>
{/if}

<style>
  .ssa-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 500;
    line-height: 1;
    text-decoration: none;
    cursor: pointer;
    transition: background-color 0.15s, border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
  }

  .ssa-btn:focus-visible {
    outline: 2px solid var(--ssa-focus-ring, #3b82f6);
    outline-offset: 2px;
  }

  .ssa-btn-sm {
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
  }

  .ssa-btn-md {
    padding: 0.625rem 1.25rem;
    font-size: 0.875rem;
  }

  .ssa-btn-lg {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
  }

  .ssa-btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .ssa-btn-label {
    white-space: nowrap;
  }

  .ssa-btn-disabled,
  .ssa-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  .ssa-btn-google.ssa-btn-filled {
    background-color: #ffffff;
    color: #3c4043;
    border-color: #dadce0;
  }

  .ssa-btn-google.ssa-btn-filled:hover {
    background-color: #f8f9fa;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .ssa-btn-github.ssa-btn-filled {
    background-color: #24292e;
    color: #ffffff;
  }

  .ssa-btn-github.ssa-btn-filled:hover {
    background-color: #2f363d;
  }

  .ssa-btn-outline {
    background-color: transparent;
    color: currentColor;
    border-color: currentColor;
  }

  .ssa-btn-outline:hover {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
</style>
