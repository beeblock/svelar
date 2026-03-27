<script lang="ts">
  import { getToasts, dismiss, pauseToast, resumeToast, type ToastVariant, type ToastState } from './toast.svelte.js';

  interface Props {
    position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
    maxVisible?: number;
    class?: string;
  }

  let { position = 'bottom-right', maxVisible = 5, class: className = '' }: Props = $props();

  const allToasts = $derived(getToasts());
  const toasts = $derived(allToasts.slice(-maxVisible));

  const isBottom = $derived(position.startsWith('bottom'));

  const positionClasses: Record<string, string> = {
    'top-right': 'top-0 right-0 pt-4 pr-4',
    'top-left': 'top-0 left-0 pt-4 pl-4',
    'bottom-right': 'bottom-0 right-0 pb-4 pr-4',
    'bottom-left': 'bottom-0 left-0 pb-4 pl-4',
    'top-center': 'top-0 left-1/2 -translate-x-1/2 pt-4',
    'bottom-center': 'bottom-0 left-1/2 -translate-x-1/2 pb-4',
  };

  const icons: Record<ToastVariant, { svg: string; colors: string }> = {
    default: { svg: '', colors: '' },
    success: {
      svg: '<path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
      colors: 'text-emerald-600 bg-emerald-50 ring-emerald-200',
    },
    error: {
      svg: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/>',
      colors: 'text-red-600 bg-red-50 ring-red-200',
    },
    warning: {
      svg: '<path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/>',
      colors: 'text-amber-600 bg-amber-50 ring-amber-200',
    },
    info: {
      svg: '<circle cx="12" cy="12" r="1" fill="currentColor"/><path d="M12 16v-4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/>',
      colors: 'text-blue-600 bg-blue-50 ring-blue-200',
    },
  };

  const borderAccent: Record<ToastVariant, string> = {
    default: 'border-l-gray-300',
    success: 'border-l-emerald-500',
    error: 'border-l-red-500',
    warning: 'border-l-amber-500',
    info: 'border-l-blue-500',
  };

  function animClass(state: ToastState): string {
    if (state === 'entering') {
      return isBottom ? 'toast-enter-bottom' : 'toast-enter-top';
    }
    if (state === 'exiting') return 'toast-exit';
    return 'toast-visible';
  }
</script>

{#if toasts.length > 0}
  <div
    class="fixed z-[9999] flex w-[400px] max-w-[calc(100vw-2rem)] pointer-events-none {isBottom ? 'flex-col-reverse' : 'flex-col'} gap-2 {positionClasses[position]} {className}"
    role="region"
    aria-label="Notifications"
    aria-live="polite"
  >
    {#each toasts as item (item.id)}
      {@const icon = icons[item.variant]}
      <div
        class="pointer-events-auto bg-white border border-gray-200 border-l-4 {borderAccent[item.variant]} rounded-lg shadow-lg {animClass(item.state)} group"
        role="alert"
        onmouseenter={() => pauseToast(item.id)}
        onmouseleave={() => resumeToast(item.id)}
      >
        <div class="flex items-start gap-3 p-4">
          <!-- Icon -->
          {#if icon.svg}
            <div class="flex-shrink-0 w-7 h-7 rounded-full ring-1 flex items-center justify-center {icon.colors}">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none">
                {@html icon.svg}
              </svg>
            </div>
          {/if}

          <!-- Content -->
          <div class="flex-1 min-w-0 pt-0.5">
            <p class="text-sm font-semibold text-gray-900 leading-snug">{item.title}</p>
            {#if item.description}
              <p class="text-[13px] text-gray-500 mt-1 leading-relaxed">{item.description}</p>
            {/if}
            {#if item.action}
              <button
                class="text-[13px] font-semibold mt-2 text-[var(--color-brand,#6366f1)] hover:underline focus:outline-none"
                onclick={() => { item.action?.onClick(); dismiss(item.id); }}
              >
                {item.action.label}
              </button>
            {/if}
          </div>

          <!-- Close button -->
          {#if item.dismissible}
            <button
              class="flex-shrink-0 p-1 -m-1 rounded-md text-gray-300 opacity-0 group-hover:opacity-100 hover:text-gray-500 hover:bg-gray-100 transition-all duration-150 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
              onclick={() => dismiss(item.id)}
              aria-label="Dismiss notification"
            >
              <svg class="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          {/if}
        </div>

        <!-- Progress bar for timed toasts -->
        {#if item.duration > 0 && item.state !== 'exiting'}
          <div class="h-0.5 bg-gray-100 rounded-b-lg overflow-hidden">
            <div
              class="h-full rounded-b-lg {item.variant === 'success' ? 'bg-emerald-400' : item.variant === 'error' ? 'bg-red-400' : item.variant === 'warning' ? 'bg-amber-400' : item.variant === 'info' ? 'bg-blue-400' : 'bg-gray-400'} toast-progress"
              style="animation-duration: {item.duration}ms; {item.pausedAt ? 'animation-play-state: paused;' : ''}"
            ></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  /* ── Enter from bottom ─────────────────────────────── */
  .toast-enter-bottom {
    animation: slideInBottom 300ms cubic-bezier(0.21, 1.02, 0.73, 1) forwards;
  }

  @keyframes slideInBottom {
    from {
      opacity: 0;
      transform: translateY(100%) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* ── Enter from top ────────────────────────────────── */
  .toast-enter-top {
    animation: slideInTop 300ms cubic-bezier(0.21, 1.02, 0.73, 1) forwards;
  }

  @keyframes slideInTop {
    from {
      opacity: 0;
      transform: translateY(-100%) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* ── Visible (idle) ────────────────────────────────── */
  .toast-visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  /* ── Exit ──────────────────────────────────────────── */
  .toast-exit {
    animation: slideOut 200ms cubic-bezier(0.06, 0.71, 0.55, 1) forwards;
  }

  @keyframes slideOut {
    from {
      opacity: 1;
      transform: translateX(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateX(100%) scale(0.95);
    }
  }

  /* ── Progress bar countdown ────────────────────────── */
  .toast-progress {
    animation: progressShrink linear forwards;
    transform-origin: left;
  }

  @keyframes progressShrink {
    from {
      width: 100%;
    }
    to {
      width: 0%;
    }
  }
</style>
