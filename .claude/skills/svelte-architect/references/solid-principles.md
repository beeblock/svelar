# SOLID Principles in Svelte

## Single Responsibility
Each component has one reason to change.

```svelte
<!-- ❌ Bad: Multiple responsibilities -->
<UserManagement />  <!-- Display, validation, submission, error handling -->

<!-- ✅ Good: Separate concerns -->
<UserForm />        <!-- Structure and submission -->
<FormField />       <!-- Individual field display -->
<FormError />       <!-- Error display -->
```

## Open/Closed Principle
Components open for extension through snippets and props.

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'secondary';
    icon?: Snippet;
    children: Snippet;
  }

  let { variant = 'primary', icon, children }: Props = $props();
</script>

<button class={variant}>
  {#if icon}
    {@render icon()}
  {/if}
  {@render children()}
</button>
```

## Dependency Inversion
Depend on abstractions, not concretions. Load data in loaders, not components.

```typescript
// +page.server.ts - Inject implementation
export const load: PageServerLoad = async ({ locals }) => {
  return { users: await locals.userRepository.getAll() };
};
```

```svelte
<!-- +page.svelte - Depend on abstraction -->
<script lang="ts">
  let { data }: { data: PageData } = $props();
</script>

<UserList users={data.users} />
```
