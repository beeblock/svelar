/**
 * shadcn-svelte-style UI component templates
 */

export const buttonComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost';
    size?: 'default' | 'sm' | 'lg';
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    class?: string;
    children?: any;
    onclick?: (e: MouseEvent) => void;
  }

  const {
    variant = 'default',
    size = 'default',
    disabled = false,
    type = 'button',
    class: klass = '',
    children,
    onclick,
  }: Props = $props();

  const baseStyles = 'inline-flex items-center justify-center gap-2 font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

  const variants = {
    default: 'bg-brand text-white hover:bg-brand-dark',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
    destructive: 'bg-red-600 text-white hover:bg-red-700',
    outline: 'border border-gray-300 bg-white hover:bg-gray-50',
    ghost: 'hover:bg-gray-100',
  };

  const sizes = {
    default: 'h-10 px-4 py-2',
    sm: 'h-8 px-3 text-sm',
    lg: 'h-12 px-8',
  };

  const buttonClass = cn(baseStyles, variants[variant], sizes[size], klass);
</script>

<button {type} {disabled} class={buttonClass} {onclick}>
  {@render children?.()}
</button>
`;

export const inputComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    type?: string;
    placeholder?: string;
    value?: string;
    disabled?: boolean;
    class?: string;
    id?: string;
    name?: string;
    required?: boolean;
    onchange?: (e: Event) => void;
    oninput?: (e: Event) => void;
  }

  const {
    type = 'text',
    placeholder = '',
    value = '',
    disabled = false,
    class: klass = '',
    id,
    name,
    required = false,
    onchange,
    oninput,
  }: Props = $props();

  const baseStyles = 'flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

  const inputClass = cn(baseStyles, klass);
</script>

<input
  {type}
  {placeholder}
  {value}
  {disabled}
  {id}
  {name}
  {required}
  class={inputClass}
  {onchange}
  {oninput}
/>
`;

export const labelComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    for?: string;
    class?: string;
    children?: any;
  }

  const { for: htmlFor = '', class: klass = '', children }: Props = $props();

  const baseStyles = 'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70';

  const labelClass = cn(baseStyles, klass);
</script>

<label for={htmlFor} class={labelClass}>
  {@render children?.()}
</label>
`;

export const cardComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    class?: string;
    children?: any;
  }

  const { class: klass = '', children }: Props = $props();

  const baseStyles = 'rounded-lg border border-gray-200 bg-white shadow-sm';

  const cardClass = cn(baseStyles, klass);
</script>

<div class={cardClass}>
  {@render children?.()}
</div>
`;

export const cardHeaderComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    class?: string;
    children?: any;
  }

  const { class: klass = '', children }: Props = $props();

  const baseStyles = 'flex flex-col space-y-1.5 p-6';

  const headerClass = cn(baseStyles, klass);
</script>

<div class={headerClass}>
  {@render children?.()}
</div>
`;

export const cardTitleComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    class?: string;
    children?: any;
  }

  const { class: klass = '', children }: Props = $props();

  const baseStyles = 'text-2xl font-semibold leading-none tracking-tight';

  const titleClass = cn(baseStyles, klass);
</script>

<h2 class={titleClass}>
  {@render children?.()}
</h2>
`;

export const cardDescriptionComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    class?: string;
    children?: any;
  }

  const { class: klass = '', children }: Props = $props();

  const baseStyles = 'text-sm text-gray-600';

  const descriptionClass = cn(baseStyles, klass);
</script>

<p class={descriptionClass}>
  {@render children?.()}
</p>
`;

export const cardContentComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    class?: string;
    children?: any;
  }

  const { class: klass = '', children }: Props = $props();

  const baseStyles = 'p-6 pt-0';

  const contentClass = cn(baseStyles, klass);
</script>

<div class={contentClass}>
  {@render children?.()}
</div>
`;

export const cardFooterComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    class?: string;
    children?: any;
  }

  const { class: klass = '', children }: Props = $props();

  const baseStyles = 'flex items-center p-6 pt-0';

  const footerClass = cn(baseStyles, klass);
</script>

<div class={footerClass}>
  {@render children?.()}
</div>
`;

export const alertComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    variant?: 'default' | 'destructive' | 'success' | 'warning';
    class?: string;
    children?: any;
  }

  const { variant = 'default', class: klass = '', children }: Props = $props();

  const variants = {
    default: 'bg-blue-50 border-blue-200 text-blue-900',
    destructive: 'bg-red-50 border-red-200 text-red-900',
    success: 'bg-green-50 border-green-200 text-green-900',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  };

  const baseStyles = 'relative w-full rounded-lg border p-4';

  const alertClass = cn(baseStyles, variants[variant], klass);
</script>

<div class={alertClass} role="alert">
  {@render children?.()}
</div>
`;

export const badgeComponent = `<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  interface Props {
    variant?: 'default' | 'secondary' | 'destructive' | 'outline';
    class?: string;
    children?: any;
  }

  const { variant = 'default', class: klass = '', children }: Props = $props();

  const variants = {
    default: 'bg-brand text-white',
    secondary: 'bg-gray-200 text-gray-900',
    destructive: 'bg-red-600 text-white',
    outline: 'border border-gray-300 text-gray-900',
  };

  const baseStyles = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors';

  const badgeClass = cn(baseStyles, variants[variant], klass);
</script>

<div class={badgeClass}>
  {@render children?.()}
</div>
`;

export const uiIndex = `// UI Components - shadcn-svelte style
export { default as Button } from './Button.svelte';
export { default as Input } from './Input.svelte';
export { default as Label } from './Label.svelte';
export { default as Card } from './Card.svelte';
export { default as CardHeader } from './CardHeader.svelte';
export { default as CardTitle } from './CardTitle.svelte';
export { default as CardDescription } from './CardDescription.svelte';
export { default as CardContent } from './CardContent.svelte';
export { default as CardFooter } from './CardFooter.svelte';
export { default as Alert } from './Alert.svelte';
export { default as Badge } from './Badge.svelte';
`;
