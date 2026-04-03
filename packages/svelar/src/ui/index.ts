/**
 * Svelar UI Components
 *
 * A minimal, composable component library built on Svelte 5 runes.
 * Uses CSS custom properties (--color-brand, --color-brand-dark) for theming.
 *
 * @module svelar/ui
 */

export { default as Button } from './Button.svelte';
export { default as Input } from './Input.svelte';
export { default as Label } from './Label.svelte';
export { default as Card } from './Card.svelte';
export { default as CardHeader } from './CardHeader.svelte';
export { default as CardTitle } from './CardTitle.svelte';
export { default as CardDescription } from './CardDescription.svelte';
export { default as CardContent } from './CardContent.svelte';
export { default as CardFooter } from './CardFooter.svelte';
export { default as Icon } from './Icon.svelte';
export { default as Alert } from './Alert.svelte';
export { default as Badge } from './Badge.svelte';
export { default as Separator } from './Separator.svelte';
export { default as Avatar } from './Avatar.svelte';
export { default as AvatarImage } from './AvatarImage.svelte';
export { default as AvatarFallback } from './AvatarFallback.svelte';
export { default as Tabs } from './Tabs.svelte';
export { default as TabsList } from './TabsList.svelte';
export { default as TabsTrigger } from './TabsTrigger.svelte';
export { default as TabsContent } from './TabsContent.svelte';
export { default as Toaster } from './Toaster.svelte';
export { default as Seo } from './Seo.svelte';
export { toast, subscribe as toastSubscribe, getToasts, dismiss, pauseToast, resumeToast, type ToastItem, type ToastVariant, type ToastOptions, type ToastState } from './toast.ts';
