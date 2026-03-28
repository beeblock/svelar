# Forms

Svelar bridges [sveltekit-superforms](https://superforms.rocks) with Zod validation, providing helpers for creating validated form actions with minimal boilerplate.

## Setup

Install superforms and its Zod adapter:

```bash
npm install sveltekit-superforms zod
```

## Quick Example

### Define a Schema

```typescript
// src/lib/schemas/post.ts
import { z } from 'zod';

export const createPostSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  body: z.string().min(10, 'Body must be at least 10 characters'),
  published: z.boolean().default(false),
});
```

### Server-Side Action

```typescript
// src/routes/dashboard/+page.server.ts
import { createFormAction, loadForm } from '@beeblock/svelar/forms';
import { createPostSchema } from '$lib/schemas/post';

export const load = async () => ({
  form: await loadForm(createPostSchema),
});

export const actions = {
  create: createFormAction(createPostSchema, async (data, event) => {
    const user = event.locals.user;
    await Post.create({ ...data, user_id: user.id });
  }),
};
```

### Client-Side Form

```svelte
<script>
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  const { form, errors, message, enhance, delayed } = superForm(data.form);
</script>

{#if $message}
  <Alert variant={$message.includes('Error') ? 'destructive' : 'success'}>
    {$message}
  </Alert>
{/if}

<form method="POST" action="?/create" use:enhance>
  <Label for="title">Title</Label>
  <Input id="title" name="title" bind:value={$form.title} />
  {#if $errors.title}
    <p class="text-sm text-red-600">{$errors.title[0]}</p>
  {/if}

  <Label for="body">Body</Label>
  <textarea id="body" name="body" bind:value={$form.body}></textarea>
  {#if $errors.body}
    <p class="text-sm text-red-600">{$errors.body[0]}</p>
  {/if}

  <Button type="submit" disabled={$delayed}>
    {$delayed ? 'Creating...' : 'Create Post'}
  </Button>
</form>
```

## API Reference

### createFormAction

Creates a server-side form action with Zod validation:

```typescript
import { createFormAction } from '@beeblock/svelar/forms';

createFormAction(schema, handler, options?)
```

- `schema` — Zod schema to validate against
- `handler` — Async function receiving validated data and the SvelteKit event
- `options.redirectTo` — URL to redirect on success
- `options.errorMessage` — Custom error message on failure

```typescript
// With redirect
export const actions = {
  default: createFormAction(registerSchema, async (data, event) => {
    await User.create(data);
  }, { redirectTo: '/login' }),
};
```

### loadForm

Loads an empty (or pre-filled) form for a SvelteKit `load` function:

```typescript
import { loadForm } from '@beeblock/svelar/forms';

// Empty form
export const load = async () => ({
  form: await loadForm(schema),
});

// Pre-filled form (for edit pages)
export const load = async ({ params }) => {
  const post = await Post.find(params.id);
  return {
    form: await loadForm(schema, { title: post.title, body: post.body }),
  };
};
```

### validateForm

Standalone validation for API routes or custom actions:

```typescript
import { validateForm } from '@beeblock/svelar/forms';

// In a +server.ts API endpoint
export async function POST(event) {
  const data = await validateForm(event, createPostSchema);
  // data is fully typed and validated
  const post = await Post.create(data);
  return json(post);
}
```

Throws `FormValidationError` if validation fails, which Svelar's error handler catches and returns as a 422 response with field errors.

## Multiple Actions

```typescript
// +page.server.ts
export const actions = {
  create: createFormAction(createPostSchema, async (data, event) => {
    await Post.create({ ...data, user_id: event.locals.user.id });
  }),

  update: createFormAction(updatePostSchema, async (data, event) => {
    await Post.where('id', data.id).update(data);
  }),

  delete: createFormAction(
    z.object({ postId: z.coerce.number() }),
    async (data, event) => {
      await Post.destroy(data.postId);
    },
  ),
};
```

## Next Steps

- Learn about [UI Components](./13-ui-components.md) for form inputs and layout
- Explore [Validation & DTOs](./05-validation-dtos.md) for the FormRequest pattern
- Check [Controllers & Routing](./04-controllers-routing.md) for API endpoint validation

---

**Svelar Forms Guide** © 2026
