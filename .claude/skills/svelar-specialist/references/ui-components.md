# UI Components

Full docs: https://svelar.dev/docs/ui-components

Import: `from '@beeblock/svelar/ui'`

All components are shipped as `.svelte` source (not compiled). They use Svelte 5 runes.

## Components

### Button
```svelte
<Button variant="default" size="default" disabled={false} onclick={handler}>
  Click me
</Button>
```
- `variant`: `'default'` | `'destructive'` | `'outline'` | `'secondary'` | `'ghost'` | `'link'`
- `size`: `'default'` | `'sm'` | `'lg'` | `'icon'`
- `type`: `'button'` | `'submit'` | `'reset'`

### Input
```svelte
<Input type="text" bind:value={name} placeholder="Name" />
<Input type="email" name="email" required disabled />
```
Uses `$bindable()` for two-way binding.

### Label
```svelte
<Label for="email">Email</Label>
```

### Card (Composite)
```svelte
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Subtitle</CardDescription>
  </CardHeader>
  <CardContent>Body</CardContent>
  <CardFooter>Footer</CardFooter>
</Card>
```

### Icon
```svelte
<script>
  import Users from 'lucide-svelte/icons/users';
</script>

<Icon icon={Users} size={24} strokeWidth={2} color="currentColor" />
<Icon path="M12 2L2 7..." />  <!-- raw SVG path -->
```

**CRITICAL: Always import lucide icons individually, never from barrel export.**

### Alert
```svelte
<Alert variant="default">Alert message</Alert>
```
- `variant`: `'default'` | `'destructive'` | `'success'`

### Badge
```svelte
<Badge variant="default">Status</Badge>
```
- `variant`: `'default'` | `'secondary'` | `'destructive'` | `'outline'` | `'success'`

### Separator
```svelte
<Separator />
```

### Avatar (Composite)
```svelte
<Avatar>
  <AvatarImage src="/photo.jpg" alt="User" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>
```

### Tabs (Composite)
```svelte
<Tabs value="overview" onchange={(v) => activeTab = v}>
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="settings">Settings</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">Overview content</TabsContent>
  <TabsContent value="settings">Settings content</TabsContent>
</Tabs>
```
Uses Svelte context internally.

### Toaster & Toast API
```svelte
<!-- In +layout.svelte -->
<Toaster position="bottom-right" maxVisible={3} />
```

Props:
- `position`: `'top-right'` | `'top-left'` | `'bottom-right'` | `'bottom-left'` | `'top-center'` | `'bottom-center'`
- `maxVisible`: number
- `variants`: custom per-variant styling (icon, classes)

```typescript
import { toast } from '@beeblock/svelar/ui';

toast('Default message');
toast.success('Success!');
toast.error('Something went wrong');
toast.warning('Warning');
toast.info('FYI');

toast.success('Saved', {
  description: 'Your changes were saved.',
  duration: 5000,           // ms, 0 = persistent
  dismissible: true,
  action: { label: 'Undo', onClick: () => undo() },
});

toast.dismiss(id);
toast.dismissAll();

// Promise-based
await toast.promise(saveData(), {
  loading: 'Saving...',
  success: 'Saved!',
  error: (err) => `Failed: ${err.message}`,
});
```

Toast store API (for advanced use):
```typescript
import { subscribe, getToasts, dismiss, pauseToast, resumeToast } from '@beeblock/svelar/ui';

const unsub = subscribe(() => {
  const toasts = getToasts();
});
```

## All Exports

```typescript
import {
  Button,
  Input,
  Label,
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  Icon,
  Alert,
  Badge,
  Separator,
  Avatar, AvatarImage, AvatarFallback,
  Tabs, TabsList, TabsTrigger, TabsContent,
  Toaster,
  toast,
} from '@beeblock/svelar/ui';
```
