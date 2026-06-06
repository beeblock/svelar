# Tailwind CSS Guide for Svelte

**Official Site:** https://tailwindcss.com/

Tailwind CSS is a utility-first CSS framework that provides low-level utility classes to build custom designs.

## Installation

Tailwind CSS is automatically installed with shadcn-svelte. If setting up manually:

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

## Configuration

```javascript
// tailwind.config.js
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          // ... your brand colors
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    }
  },
  plugins: []
}
```

## Core Concepts

### Utility-First Workflow

Use utility classes directly in your markup instead of custom CSS:

```svelte
<!-- ❌ Bad: Custom CSS -->
<div class="card">
  <h2 class="card-title">Title</h2>
  <p class="card-text">Content</p>
</div>

<style>
  .card {
    background: white;
    padding: 1.5rem;
    border-radius: 0.5rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  }
</style>

<!-- ✅ Good: Tailwind utilities -->
<div class="bg-white p-6 rounded-lg shadow-sm">
  <h2 class="text-xl font-semibold mb-2">Title</h2>
  <p class="text-gray-600">Content</p>
</div>
```

### Responsive Design

Use responsive prefixes for mobile-first design:

```svelte
<div class="w-full md:w-1/2 lg:w-1/3">
  <!-- Full width on mobile, half on tablet, third on desktop -->
</div>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <!-- Responsive grid -->
</div>

<h1 class="text-2xl md:text-3xl lg:text-4xl">
  <!-- Responsive typography -->
</h1>
```

### State Variants

Apply styles based on state:

```svelte
<button class="bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:bg-gray-300">
  Click me
</button>

<input class="border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200" />

<a class="text-blue-600 hover:text-blue-800 visited:text-purple-600">
  Link
</a>
```

### Dark Mode

```svelte
<div class="bg-white dark:bg-gray-900 text-black dark:text-white">
  <!-- Adapts to dark mode -->
</div>

<button class="bg-blue-500 dark:bg-blue-600">
  <!-- Different colors in dark mode -->
</button>
```

## Common Patterns

### Layout

```svelte
<!-- Container -->
<div class="container mx-auto px-4">
  <!-- Centered container with padding -->
</div>

<!-- Flexbox -->
<div class="flex items-center justify-between gap-4">
  <!-- Flex with alignment and spacing -->
</div>

<div class="flex flex-col md:flex-row">
  <!-- Column on mobile, row on desktop -->
</div>

<!-- Grid -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <!-- Responsive grid -->
</div>

<!-- Centering -->
<div class="flex items-center justify-center min-h-screen">
  <!-- Vertically and horizontally centered -->
</div>
```

### Typography

```svelte
<!-- Headings -->
<h1 class="text-4xl font-bold tracking-tight">
<h2 class="text-3xl font-semibold">
<h3 class="text-2xl font-medium">

<!-- Body text -->
<p class="text-base leading-relaxed text-gray-700">

<!-- Small text -->
<span class="text-sm text-gray-500">

<!-- Truncate -->
<p class="truncate">Very long text that will be truncated...</p>

<!-- Line clamp -->
<p class="line-clamp-3">
  Text that will be limited to 3 lines...
</p>
```

### Spacing

```svelte
<!-- Padding -->
<div class="p-4">       <!-- All sides -->
<div class="px-4 py-6"> <!-- Horizontal and vertical -->
<div class="pt-4 pb-8"> <!-- Individual sides -->

<!-- Margin -->
<div class="m-4">       <!-- All sides -->
<div class="mx-auto">   <!-- Horizontal centering -->
<div class="mt-4 mb-8"> <!-- Individual sides -->

<!-- Space between children -->
<div class="space-y-4">  <!-- Vertical spacing -->
<div class="space-x-4">  <!-- Horizontal spacing -->

<!-- Gap (for flex/grid) -->
<div class="flex gap-4">
<div class="grid gap-6">
```

### Colors

```svelte
<!-- Background -->
<div class="bg-blue-500">
<div class="bg-gradient-to-r from-blue-500 to-purple-600">

<!-- Text -->
<p class="text-gray-900">
<p class="text-blue-600">

<!-- Border -->
<div class="border border-gray-300">
<div class="border-2 border-blue-500">
```

### Borders & Shadows

```svelte
<!-- Borders -->
<div class="border rounded-lg">
<div class="border-t border-b">
<div class="border-l-4 border-blue-500">

<!-- Rounded corners -->
<div class="rounded">      <!-- 0.25rem -->
<div class="rounded-lg">   <!-- 0.5rem -->
<div class="rounded-full"> <!-- Full circle/pill -->

<!-- Shadows -->
<div class="shadow-sm">    <!-- Small shadow -->
<div class="shadow">       <!-- Default shadow -->
<div class="shadow-lg">    <!-- Large shadow -->
<div class="shadow-xl">    <!-- Extra large -->
```

### Sizing

```svelte
<!-- Width -->
<div class="w-full">      <!-- 100% -->
<div class="w-1/2">       <!-- 50% -->
<div class="w-64">        <!-- 16rem = 256px -->
<div class="max-w-md">    <!-- Max width -->

<!-- Height -->
<div class="h-64">        <!-- 16rem = 256px -->
<div class="min-h-screen"> <!-- At least viewport height -->

<!-- Square -->
<div class="size-16">     <!-- w-16 h-16 -->
```

## Component Examples

### Card

```svelte
<div class="bg-white rounded-lg shadow-md p-6 space-y-4">
  <h3 class="text-xl font-semibold text-gray-900">Card Title</h3>
  <p class="text-gray-600">Card content goes here.</p>
  <button class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
    Action
  </button>
</div>
```

### Input Group

```svelte
<div class="space-y-2">
  <label class="text-sm font-medium text-gray-700">
    Email
  </label>
  <input
    type="email"
    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    placeholder="you@example.com"
  />
  <p class="text-sm text-gray-500">
    We'll never share your email.
  </p>
</div>
```

### Button Variants

```svelte
<!-- Primary -->
<button class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
  Primary
</button>

<!-- Secondary -->
<button class="bg-gray-200 text-gray-900 px-4 py-2 rounded hover:bg-gray-300">
  Secondary
</button>

<!-- Outline -->
<button class="border-2 border-blue-500 text-blue-500 px-4 py-2 rounded hover:bg-blue-50">
  Outline
</button>

<!-- Ghost -->
<button class="text-blue-500 px-4 py-2 rounded hover:bg-blue-50">
  Ghost
</button>
```

### Navigation

```svelte
<nav class="bg-white border-b border-gray-200">
  <div class="container mx-auto px-4">
    <div class="flex items-center justify-between h-16">
      <div class="flex items-center space-x-8">
        <a href="/" class="text-xl font-bold text-gray-900">Logo</a>
        <div class="hidden md:flex space-x-4">
          <a href="/about" class="text-gray-600 hover:text-gray-900">About</a>
          <a href="/features" class="text-gray-600 hover:text-gray-900">Features</a>
          <a href="/pricing" class="text-gray-600 hover:text-gray-900">Pricing</a>
        </div>
      </div>
      <button class="bg-blue-500 text-white px-4 py-2 rounded">
        Sign up
      </button>
    </div>
  </div>
</nav>
```

## Svelte-Specific Patterns

### Class Binding

```svelte
<script lang="ts">
  let isActive = $state(false);
  let variant = $state<'primary' | 'secondary'>('primary');
</script>

<!-- Conditional classes -->
<button class="px-4 py-2 rounded" class:bg-blue-500={isActive} class:bg-gray-300={!isActive}>
  Toggle
</button>

<!-- Dynamic classes with object -->
<div class:active={isActive} class:disabled={!isActive}>
  Content
</div>

<!-- Using template literals -->
<button class={`px-4 py-2 rounded ${variant === 'primary' ? 'bg-blue-500' : 'bg-gray-500'}`}>
  Button
</button>
```

### Class Helper Function

```typescript
// utils/cn.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

```svelte
<script lang="ts">
  import { cn } from '$lib/utils/cn';

  interface Props {
    variant?: 'primary' | 'secondary';
    size?: 'sm' | 'md' | 'lg';
    class?: string;
  }

  let { variant = 'primary', size = 'md', class: className }: Props = $props();

  const buttonClasses = $derived(cn(
    'rounded font-medium transition-colors',
    {
      'bg-blue-500 text-white hover:bg-blue-600': variant === 'primary',
      'bg-gray-200 text-gray-900 hover:bg-gray-300': variant === 'secondary',
      'px-3 py-1.5 text-sm': size === 'sm',
      'px-4 py-2 text-base': size === 'md',
      'px-6 py-3 text-lg': size === 'lg',
    },
    className
  ));
</script>

<button class={buttonClasses}>
  <slot />
</button>
```

## Best Practices

1. **Use the Design System** - Stick to Tailwind's spacing scale (4px increments: 1, 2, 3, 4, 6, 8...)
2. **Responsive First** - Design mobile-first, then add `md:` and `lg:` breakpoints
3. **Consistent Colors** - Use the color palette consistently (gray-50 to gray-900)
4. **Extract Components** - If repeating classes, create a Svelte component
5. **Use @apply Sparingly** - Prefer utility classes in markup over `@apply` in CSS
6. **Focus States** - Always include focus styles for accessibility
7. **Dark Mode** - Consider dark mode variants when appropriate
8. **Semantic HTML** - Use proper HTML elements with Tailwind classes

## Customization

### Custom Colors

```javascript
// tailwind.config.js
theme: {
  extend: {
    colors: {
      brand: {
        50: '#f0f9ff',
        500: '#0ea5e9',
        900: '#0c4a6e',
      }
    }
  }
}
```

### Custom Spacing

```javascript
theme: {
  extend: {
    spacing: {
      '128': '32rem',
      '144': '36rem',
    }
  }
}
```

### Custom Fonts

```javascript
theme: {
  extend: {
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
      mono: ['Fira Code', 'monospace'],
    }
  }
}
```

## Integration with shadcn-svelte

shadcn-svelte components are built with Tailwind CSS. You can customize them by:

1. Editing the component files in `src/lib/components/ui/`
2. Extending the theme in `tailwind.config.js`
3. Using the `class` prop to add additional styles

```svelte
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
</script>

<!-- Add additional Tailwind classes -->
<Button class="w-full mt-4">
  Full Width Button
</Button>
```

## Resources

- **Official Docs:** https://tailwindcss.com/docs
- **Playground:** https://play.tailwindcss.com/
- **Components:** https://tailwindui.com/
- **Color Palette:** https://tailwindcss.com/docs/customizing-colors
