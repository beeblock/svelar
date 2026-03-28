/**
 * Local toast store wrapper.
 *
 * Re-exports the svelar toast API and provides a reactive Svelte 5
 * `$state` binding that the Toaster component can derive from.
 * This file lives inside the app so the Svelte compiler processes
 * the $state rune correctly.
 */

import { getToasts, toastSubscribe, type ToastItem } from 'svelar/ui';

export { toast, dismiss, pauseToast, resumeToast } from 'svelar/ui';
export type { ToastItem, ToastVariant, ToastState } from 'svelar/ui';

let items = $state<ToastItem[]>([]);

// Sync from the toast store whenever it changes
toastSubscribe(() => {
  items = [...getToasts()];
});

// Also grab current state right away
items = [...getToasts()];

export function toasts(): ToastItem[] {
  return items;
}
