# SvelteKit Patterns

## Load Functions

```typescript
// +page.server.ts
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals }) => {
  const user = await locals.db.user.findUnique({
    where: { id: params.id }
  });

  if (!user) {
    throw error(404, 'User not found');
  }

  return { user };
};
```

## Form Actions

```typescript
// +page.server.ts
import type { Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';

export const actions: Actions = {
  update: async ({ request, params }) => {
    const data = await request.formData();

    // Process form data

    throw redirect(303, '/success');
  }
};
```

## Server Hooks

```typescript
// hooks.server.ts
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const session = event.cookies.get('session');

  if (session) {
    event.locals.user = await validateSession(session);
  }

  return resolve(event);
};
```
