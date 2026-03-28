# UI Components

Svelar ships a minimal, composable component library built on Svelte 5 runes. Every component is themed via CSS custom properties and works out of the box with Tailwind CSS.

## Available Components

Svelar includes components covering the most common UI patterns: `Button`, `Input`, `Label`, `Card` (with `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`), `Alert`, `Badge`, `Separator`, `Avatar` (with `AvatarImage`, `AvatarFallback`), `Tabs` (with `TabsList`, `TabsTrigger`, `TabsContent`), `Icon`, `Toaster`, and a `toast` notification API.

## Import

All components are available from the `svelar/ui` entry point:

```svelte
<script>
  import { Button, Card, CardContent, Input, Label } from '@beeblock/svelar/ui';
</script>
```

You can also import individual components directly:

```svelte
<script>
  import Button from '@beeblock/svelar/ui/Button.svelte';
</script>
```

## Theming

Components use CSS custom properties for brand colors. Set them in your `app.css`:

```css
:root {
  --color-brand: #6366f1;        /* Primary color (buttons, links, focus rings) */
  --color-brand-dark: #4f46e5;   /* Hover state for primary buttons */
}
```

This single change rebrands every component in your app.

## Component Reference

### Button

Supports 6 variants and 4 sizes:

```svelte
<Button>Default</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Cancel</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button size="icon">🔍</Button>

<Button disabled>Disabled</Button>
<Button type="submit">Submit</Button>
<Button onclick={() => alert('clicked')}>Click Me</Button>
```

### Input

Text input with bindable value:

```svelte
<Input placeholder="Enter your name" bind:value={name} />
<Input type="email" required />
<Input type="password" disabled />
```

### Label

Associates with form inputs:

```svelte
<Label for="email">Email Address</Label>
<Input id="email" type="email" />
```

### Card

Composable card with header, content, and footer slots:

```svelte
<Card>
  <CardHeader>
    <CardTitle>Post Title</CardTitle>
    <CardDescription>Published 2 days ago</CardDescription>
  </CardHeader>
  <CardContent>
    <p>Card body content goes here.</p>
  </CardContent>
  <CardFooter>
    <Button>Read More</Button>
  </CardFooter>
</Card>
```

### Alert

Status messages with 3 variants:

```svelte
<Alert>Default informational alert.</Alert>
<Alert variant="destructive">Something went wrong.</Alert>
<Alert variant="success">Operation completed.</Alert>
```

### Badge

Inline status indicators with 5 variants:

```svelte
<Badge>Default</Badge>
<Badge variant="secondary">Draft</Badge>
<Badge variant="destructive">Error</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="success">Published</Badge>
```

### Avatar

User avatar with image and fallback:

```svelte
<Avatar>
  <AvatarImage src="/user.jpg" alt="John" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>
```

### Separator

Horizontal divider:

```svelte
<Separator />
<Separator class="my-8" />
```

### Tabs

Tab navigation with content panels:

```svelte
<script lang="ts">
  import { Tabs, TabsList, TabsTrigger, TabsContent } from '@beeblock/svelar/ui';

  let activeTab = $state('overview');
</script>

<Tabs value={activeTab} onchange={(v) => (activeTab = v)}>
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="settings">Settings</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">Overview content</TabsContent>
  <TabsContent value="settings">Settings content</TabsContent>
</Tabs>
```

### Icon

A generic icon wrapper that supports [lucide-svelte](https://lucide.dev) and [@tabler/icons-svelte](https://tabler.io/icons) components, raw SVG path data, or inline SVG children.

**Important:** Always import lucide icons individually. The barrel export (`from 'lucide-svelte'`) causes SSR issues.

```svelte
<script lang="ts">
  import { Icon } from '@beeblock/svelar/ui';
  import Users from 'lucide-svelte/icons/users';
  import KeyRound from 'lucide-svelte/icons/key-round';
</script>

<!-- Pass a Svelte icon component -->
<Icon icon={Users} size={20} />
<Icon icon={KeyRound} size={18} color="gray" />

<!-- Pass raw SVG path data -->
<Icon path="M5 12l5 5L20 7" size={24} strokeWidth={2} />

<!-- Inline SVG children -->
<Icon size={24}>
  <circle cx="12" cy="12" r="10" />
</Icon>
```

Props: `icon` (Component), `path` (string), `size` (number, default 24), `strokeWidth` (number, default 2), `color` (string, default `currentColor`), `class`, `aria-label`.

#### Vite Configuration for Icon Libraries

When using `lucide-svelte` or `@tabler/icons-svelte`, add these to your `vite.config.ts`:

```typescript
export default defineConfig({
  // ...
  ssr: {
    noExternal: ['lucide-svelte'],
  },
  optimizeDeps: {
    exclude: ['lucide-svelte'],
  },
});
```

### Toast Notifications

Svelar includes a full toast notification system with animations, auto-dismiss, hover-to-pause, action buttons, and a progress bar.

#### Basic Usage

```typescript
import { toast } from '@beeblock/svelar/ui';

toast('Hello');
toast.success('Saved!');
toast.error('Failed', { description: 'Network error' });
toast.warning('Careful', { duration: 8000 });
toast.info('Tip', { action: { label: 'Undo', onClick: () => undo() } });
```

#### Promise Toasts

Track async operations with loading → success/error:

```typescript
toast.promise(fetch('/api/save'), {
  loading: 'Saving...',
  success: 'Saved!',
  error: (err) => `Failed: ${err.message}`,
});
```

#### Dismissing Toasts

```typescript
const id = toast('Manual dismiss', { duration: 0 });  // persistent
toast.dismiss(id);   // dismiss one
toast.dismissAll();  // dismiss all
```

#### Toast Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `description` | `string` | — | Secondary text below the title |
| `duration` | `number` | 5000 (8000 for errors) | Auto-dismiss in ms. `0` = persistent |
| `dismissible` | `boolean` | `true` | Show close button |
| `action` | `{ label, onClick }` | — | Action button |

#### Rendering Toasts with Toaster

Add `<Toaster />` to your root layout to render toast notifications:

```svelte
<script>
  import { Toaster } from '@beeblock/svelar/ui';
</script>

<Toaster position="bottom-right" maxVisible={5} />
```

Positions: `top-right`, `top-left`, `bottom-right`, `bottom-left`, `top-center`, `bottom-center`.

#### Cross-Package Reactivity Note

The toast store uses a callback-based pattern (not `$state`) so it works when imported from the `svelar` package. If you need fine-grained `$state` reactivity in your app, create a local wrapper:

```typescript
// src/lib/stores/toasts.svelte.ts
import { getToasts, subscribe as toastSubscribe } from '@beeblock/svelar/ui';
export { toast, dismiss } from '@beeblock/svelar/ui';

let items = $state(getToasts());
toastSubscribe(() => { items = [...getToasts()]; });

export function toasts() { return items; }
```

Then use `toasts()` in your components for reactive rendering.

## Extending the UI

Svelar's built-in components are intentionally minimal — they cover the patterns every app needs. For your app-specific UI, create custom components in your project that compose and extend svelar's base components.

### Creating App-Specific Components

Create your custom components in `src/lib/components/` and import svelar's base components:

```svelte
<!-- src/lib/components/PostCard.svelte -->
<script lang="ts">
  import { Card, CardHeader, CardTitle, CardContent, CardFooter, Badge, Button } from '@beeblock/svelar/ui';

  interface Props {
    title: string;
    body: string;
    published: boolean;
    onDelete?: () => void;
  }

  let { title, body, published, onDelete }: Props = $props();
</script>

<Card class="hover:shadow-md transition-shadow">
  <CardHeader>
    <div class="flex items-center justify-between">
      <CardTitle>{title}</CardTitle>
      <Badge variant={published ? 'success' : 'secondary'}>
        {published ? 'Published' : 'Draft'}
      </Badge>
    </div>
  </CardHeader>
  <CardContent>
    <p class="text-gray-600">{body}</p>
  </CardContent>
  <CardFooter>
    <Button variant="outline" size="sm">Edit</Button>
    {#if onDelete}
      <Button variant="destructive" size="sm" onclick={onDelete}>Delete</Button>
    {/if}
  </CardFooter>
</Card>
```

Use it in your pages:

```svelte
<script>
  import PostCard from '$lib/components/PostCard.svelte';
</script>

{#each posts as post}
  <PostCard
    title={post.title}
    body={post.body}
    published={post.published}
    onDelete={() => deletePost(post.id)}
  />
{/each}
```

### Building a Form Field Component

Compose `Label`, `Input`, and error display into a reusable form field:

```svelte
<!-- src/lib/components/FormField.svelte -->
<script lang="ts">
  import { Label, Input } from '@beeblock/svelar/ui';

  interface Props {
    label: string;
    name: string;
    type?: string;
    value?: string;
    error?: string;
    placeholder?: string;
    required?: boolean;
  }

  let {
    label,
    name,
    type = 'text',
    value = $bindable(''),
    error,
    placeholder = '',
    required = false,
  }: Props = $props();
</script>

<div class="space-y-2">
  <Label for={name}>{label}</Label>
  <Input
    id={name}
    {name}
    {type}
    {placeholder}
    {required}
    bind:value
    class={error ? 'border-red-500' : ''}
    aria-invalid={error ? 'true' : undefined}
  />
  {#if error}
    <p class="text-sm text-red-600">{error}</p>
  {/if}
</div>
```

### Creating a Confirmation Dialog

Build higher-level UI patterns on top of the base components:

```svelte
<!-- src/lib/components/ConfirmDialog.svelte -->
<script lang="ts">
  import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button } from '@beeblock/svelar/ui';

  interface Props {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'destructive';
    onConfirm: () => void;
    onCancel: () => void;
  }

  let {
    open = $bindable(false),
    title,
    description = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'default',
    onConfirm,
    onCancel,
  }: Props = $props();
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <Card class="w-full max-w-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {#if description}
          <CardDescription>{description}</CardDescription>
        {/if}
      </CardHeader>
      <CardFooter class="flex justify-end gap-2">
        <Button variant="outline" onclick={onCancel}>{cancelLabel}</Button>
        <Button variant={variant === 'destructive' ? 'destructive' : 'default'} onclick={onConfirm}>
          {confirmLabel}
        </Button>
      </CardFooter>
    </Card>
  </div>
{/if}
```

### Wrapping a Button with Loading State

```svelte
<!-- src/lib/components/LoadingButton.svelte -->
<script lang="ts">
  import { Button } from '@beeblock/svelar/ui';
  import type { Snippet } from 'svelte';

  interface Props {
    loading?: boolean;
    loadingText?: string;
    children?: Snippet;
    [key: string]: any;
  }

  let { loading = false, loadingText = 'Loading...', children, ...rest }: Props = $props();
</script>

<Button disabled={loading} {...rest}>
  {#if loading}
    <svg class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
    {loadingText}
  {:else if children}
    {@render children()}
  {/if}
</Button>
```

### Customizing Component Styles

Every component accepts a `class` prop for Tailwind overrides:

```svelte
<Button class="rounded-full px-8">Pill Button</Button>
<Card class="bg-gradient-to-r from-indigo-500 to-purple-600 text-white border-0">
  <CardContent>Gradient card</CardContent>
</Card>
<Input class="text-lg py-3" placeholder="Large input" />
<Badge class="text-base px-4 py-1">Large Badge</Badge>
```

### Adding New Base Components to Svelar Core

If you're building a component that every Svelar app would benefit from, add it to the framework itself:

1. Create the `.svelte` file in `packages/svelar/src/ui/`
2. Re-export it from `packages/svelar/src/ui/index.ts`
3. No build step needed — SvelteKit compiles Svelte source at dev/build time

```typescript
// packages/svelar/src/ui/index.ts
export { default as Button } from './Button.svelte';
export { default as MyNewComponent } from './MyNewComponent.svelte';
// ...
```

Follow these conventions when adding core components:

- Use Svelte 5 runes (`$props()`, `$state()`, `$derived()`)
- Accept a `class` prop for style overrides
- Spread `...rest` props for flexibility
- Use `--color-brand` CSS variables for theming
- Keep components small and composable

## Next Steps

- Learn about [HTTP utilities](./14-http.md) for CSRF-aware API calls
- Set up [Internationalization](./15-i18n.md) for multi-language support
- Explore [Forms](./16-forms.md) for validation with Superforms

---

**Svelar UI Components Guide** © 2026
