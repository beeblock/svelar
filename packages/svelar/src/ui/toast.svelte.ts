/**
 * Svelar Toast Store & API
 *
 * Reactive toast notification system built on Svelte 5 runes.
 * Import { toast } anywhere to show notifications.
 * Import { Toaster } in your layout to render them.
 *
 * @module svelar/ui
 *
 * @example
 * ```ts
 * import { toast } from 'svelar/ui';
 *
 * toast('Hello');
 * toast.success('Saved!');
 * toast.error('Failed', { description: 'Network error' });
 * toast.warning('Careful', { duration: 8000 });
 * toast.info('Tip', { action: { label: 'Undo', onClick: () => undo() } });
 * toast.dismiss(id);
 * toast.dismissAll();
 * ```
 */

export type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

export type ToastState = 'entering' | 'visible' | 'exiting';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration: number;
  dismissible: boolean;
  action?: { label: string; onClick: () => void };
  createdAt: number;
  state: ToastState;
  pausedAt?: number;
  remaining: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export interface ToastOptions {
  description?: string;
  /** Auto-dismiss in ms. 0 = persistent. Default: 5000 (8000 for errors) */
  duration?: number;
  /** Show close button. Default: true */
  dismissible?: boolean;
  /** Action button */
  action?: { label: string; onClick: () => void };
}

// ── Reactive Store ────────────────────────────────────────

let _toasts = $state<ToastItem[]>([]);
let _counter = 0;

const ENTER_DURATION = 300;
const EXIT_DURATION = 200;

export function getToasts(): ToastItem[] {
  return _toasts;
}

function scheduleAutoDismiss(item: ToastItem) {
  if (item.duration <= 0) return;

  item.timeoutId = setTimeout(() => {
    dismiss(item.id);
  }, item.remaining);
}

function addToast(variant: ToastVariant, title: string, options: ToastOptions = {}): string {
  const id = `toast-${++_counter}-${Date.now()}`;
  const duration = options.duration ?? (variant === 'error' ? 8000 : 5000);

  const item: ToastItem = {
    id,
    variant,
    title,
    description: options.description,
    duration,
    dismissible: options.dismissible ?? true,
    action: options.action,
    createdAt: Date.now(),
    state: 'entering',
    remaining: duration,
  };

  _toasts = [..._toasts, item];

  // Transition to visible after enter animation
  setTimeout(() => {
    _toasts = _toasts.map((t) => (t.id === id ? { ...t, state: 'visible' as ToastState } : t));
  }, ENTER_DURATION);

  // Start auto-dismiss timer
  scheduleAutoDismiss(item);

  return id;
}

export function dismiss(id: string) {
  // Clear any pending timeout
  const item = _toasts.find((t) => t.id === id);
  if (!item || item.state === 'exiting') return;

  if (item.timeoutId) clearTimeout(item.timeoutId);

  // Start exit animation
  _toasts = _toasts.map((t) => (t.id === id ? { ...t, state: 'exiting' as ToastState } : t));

  // Remove after exit animation
  setTimeout(() => {
    _toasts = _toasts.filter((t) => t.id !== id);
  }, EXIT_DURATION);
}

export function dismissAll() {
  // Animate all out
  _toasts = _toasts.map((t) => {
    if (t.timeoutId) clearTimeout(t.timeoutId);
    return { ...t, state: 'exiting' as ToastState };
  });

  setTimeout(() => {
    _toasts = [];
  }, EXIT_DURATION);
}

/**
 * Pause auto-dismiss for a toast (e.g. on hover).
 */
export function pauseToast(id: string) {
  _toasts = _toasts.map((t) => {
    if (t.id !== id || t.duration <= 0) return t;
    if (t.timeoutId) clearTimeout(t.timeoutId);
    const elapsed = Date.now() - t.createdAt - (t.duration - t.remaining);
    return { ...t, pausedAt: Date.now(), remaining: Math.max(t.remaining - elapsed, 1000), timeoutId: undefined };
  });
}

/**
 * Resume auto-dismiss for a toast (e.g. on mouse leave).
 */
export function resumeToast(id: string) {
  const item = _toasts.find((t) => t.id === id);
  if (!item || !item.pausedAt || item.duration <= 0) return;

  _toasts = _toasts.map((t) => {
    if (t.id !== id) return t;
    return { ...t, pausedAt: undefined };
  });

  scheduleAutoDismiss(item);
}

// ── Public API ────────────────────────────────────────────

/**
 * Show a default toast notification.
 *
 * Also available as `toast.success()`, `toast.error()`, `toast.warning()`, `toast.info()`.
 */
function toastFn(title: string, options?: ToastOptions): string {
  return addToast('default', title, options);
}

toastFn.success = (title: string, options?: ToastOptions) => addToast('success', title, options);
toastFn.error = (title: string, options?: ToastOptions) => addToast('error', title, options);
toastFn.warning = (title: string, options?: ToastOptions) => addToast('warning', title, options);
toastFn.info = (title: string, options?: ToastOptions) => addToast('info', title, options);
toastFn.dismiss = dismiss;
toastFn.dismissAll = dismissAll;

/**
 * Show a toast for a promise lifecycle (loading → success/error).
 */
toastFn.promise = <T>(
  promise: Promise<T>,
  messages: {
    loading: string;
    success: string | ((data: T) => string);
    error: string | ((err: any) => string);
  },
  options?: ToastOptions,
): Promise<T> => {
  const id = addToast('info', messages.loading, { ...options, duration: 0 });

  promise
    .then((data) => {
      dismiss(id);
      const msg = typeof messages.success === 'function' ? messages.success(data) : messages.success;
      addToast('success', msg, options);
    })
    .catch((err) => {
      dismiss(id);
      const msg = typeof messages.error === 'function' ? messages.error(err) : messages.error;
      addToast('error', msg, options);
    });

  return promise;
};

export const toast = toastFn;
