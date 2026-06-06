# shadcn-svelte Guide

**Official Site:** https://www.shadcn-svelte.com/

shadcn-svelte provides beautifully designed, accessible components built with Svelte 5 and Tailwind CSS.

## Installation

```bash
# Initialize shadcn-svelte in your project
npx shadcn-svelte@latest init

# Follow the prompts to configure:
# - TypeScript: Yes (always)
# - Tailwind CSS: Yes
# - Components directory: src/lib/components
```

## Adding Components

```bash
# Add individual components
npx shadcn-svelte@latest add button
npx shadcn-svelte@latest add input
npx shadcn-svelte@latest add dialog
npx shadcn-svelte@latest add select
npx shadcn-svelte@latest add tabs
npx shadcn-svelte@latest add card
npx shadcn-svelte@latest add table

# Add all components
npx shadcn-svelte@latest add --all
```

## Common Components

### Button

```svelte
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
</script>

<!-- Variants -->
<Button variant="default">Default</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

<!-- Sizes -->
<Button size="default">Default</Button>
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button size="icon">🔥</Button>

<!-- States -->
<Button disabled>Disabled</Button>
```

### Input

```svelte
<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";

  let email = $state('');
</script>

<div class="grid w-full max-w-sm items-center gap-1.5">
  <Label for="email">Email</Label>
  <Input
    type="email"
    id="email"
    bind:value={email}
    placeholder="Email"
  />
</div>
```

### Dialog

```svelte
<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";

  let open = $state(false);
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger asChild let:builder>
    <Button builders={[builder]}>Open Dialog</Button>
  </Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Are you sure?</Dialog.Title>
      <Dialog.Description>
        This action cannot be undone.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => open = false}>Cancel</Button>
      <Button onclick={handleConfirm}>Confirm</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
```

### Select

```svelte
<script lang="ts">
  import * as Select from "$lib/components/ui/select";

  let selected = $state<string>();
</script>

<Select.Root bind:selected>
  <Select.Trigger class="w-[180px]">
    <Select.Value placeholder="Select a fruit" />
  </Select.Trigger>
  <Select.Content>
    <Select.Item value="apple">Apple</Select.Item>
    <Select.Item value="banana">Banana</Select.Item>
    <Select.Item value="orange">Orange</Select.Item>
  </Select.Content>
</Select.Root>
```

### Tabs

```svelte
<script lang="ts">
  import * as Tabs from "$lib/components/ui/tabs";
</script>

<Tabs.Root value="account" class="w-[400px]">
  <Tabs.List>
    <Tabs.Trigger value="account">Account</Tabs.Trigger>
    <Tabs.Trigger value="password">Password</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="account">
    <p>Account settings content</p>
  </Tabs.Content>
  <Tabs.Content value="password">
    <p>Password settings content</p>
  </Tabs.Content>
</Tabs.Root>
```

### Card

```svelte
<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Card Title</Card.Title>
    <Card.Description>Card description goes here</Card.Description>
  </Card.Header>
  <Card.Content>
    <p>Card content</p>
  </Card.Content>
  <Card.Footer>
    <Button>Action</Button>
  </Card.Footer>
</Card.Root>
```

### Table

```svelte
<script lang="ts">
  import * as Table from "$lib/components/ui/table";

  const users = $state([
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
  ]);
</script>

<Table.Root>
  <Table.Header>
    <Table.Row>
      <Table.Head>Name</Table.Head>
      <Table.Head>Email</Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each users as user}
      <Table.Row>
        <Table.Cell>{user.name}</Table.Cell>
        <Table.Cell>{user.email}</Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>
```

### Form with Multiple Components

```svelte
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";

  let name = $state('');
  let email = $state('');
  let role = $state<string>();

  function handleSubmit() {
    console.log({ name, email, role });
  }
</script>

<Card.Root class="w-[400px]">
  <Card.Header>
    <Card.Title>Create Account</Card.Title>
    <Card.Description>Enter your information below</Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <div class="space-y-2">
      <Label for="name">Name</Label>
      <Input id="name" bind:value={name} placeholder="John Doe" />
    </div>

    <div class="space-y-2">
      <Label for="email">Email</Label>
      <Input id="email" type="email" bind:value={email} placeholder="john@example.com" />
    </div>

    <div class="space-y-2">
      <Label for="role">Role</Label>
      <Select.Root bind:selected={role}>
        <Select.Trigger id="role">
          <Select.Value placeholder="Select a role" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="admin">Admin</Select.Item>
          <Select.Item value="user">User</Select.Item>
          <Select.Item value="guest">Guest</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  </Card.Content>
  <Card.Footer>
    <Button onclick={handleSubmit} class="w-full">Create Account</Button>
  </Card.Footer>
</Card.Root>
```

## Customization

Components are installed in your project, so you can customize them:

```svelte
<!-- src/lib/components/ui/button/button.svelte -->
<script lang="ts">
  // Modify the component as needed
  // Add custom variants, sizes, or functionality
</script>
```

## Available Components

- Accordion
- Alert
- Alert Dialog
- Avatar
- Badge
- Button
- Calendar
- Card
- Checkbox
- Collapsible
- Command
- Context Menu
- Dialog
- Dropdown Menu
- Form
- Hover Card
- Input
- Label
- Menubar
- Navigation Menu
- Popover
- Progress
- Radio Group
- ScrollArea
- Select
- Separator
- Sheet
- Skeleton
- Slider
- Switch
- Table
- Tabs
- Textarea
- Toast
- Toggle
- Tooltip

## Best Practices

1. **Always use TypeScript** - shadcn-svelte components are fully typed
2. **Customize in place** - Components are copied to your project, not installed as dependencies
3. **Use with Tailwind** - Components are styled with Tailwind CSS
4. **Follow naming patterns** - Import as namespaces for compound components (`* as Dialog`)
5. **Accessibility first** - All components follow ARIA best practices
