# Error Handling

Svelar provides a full-stack error handling system covering both API routes (JSON responses with toast notifications) and page routes (polished error pages with i18n support).

## Architecture

The error system has three layers:

1. **Server-side** — Structured error classes (`svelar/errors`) thrown in load functions, actions, and API routes. The `ErrorHandler` catches them and returns proper HTTP responses.

2. **Client-side API** — `apiFetch` and `apiFetchJson` (`svelar/http`) automatically show toast notifications on error responses. Validation errors (422) display field-level details.

3. **Client-side Pages** — The `+error.svelte` page renders a polished, i18n-aware error UI for all HTTP status codes (400–504), with contextual actions (retry, go back, sign in).

## Quick Setup

If you're using `createSvelarApp`, error handling is already wired up:

```typescript
// hooks.server.ts
import { createSvelarApp } from 'svelar/hooks';
export const { handle, handleError } = createSvelarApp({ auth });
```

Add the `<Toaster />` component to your layout for client-side toast notifications:

```svelte
<!-- +layout.svelte -->
<script>
  import { Toaster } from 'svelar/ui';
</script>

<slot />
<Toaster position="bottom-right" />
```

## Server-Side Error Classes

```typescript
import {
  abort,
  abortIf,
  abortUnless,
  HttpError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  TooManyRequestsError,
  ServiceUnavailableError,
  ModelNotFoundError,
} from 'svelar/errors';
```

### Throwing Errors

```typescript
// In a load function or action
export const load = async ({ locals }) => {
  const post = await Post.find(id);
  if (!post) throw new NotFoundError();

  abortUnless(locals.user, 401);
  abortIf(post.userId !== locals.user.id, 403, 'Not your post');

  // Validation errors with field details
  throw new ValidationError({
    email: ['Email is required', 'Must be a valid email'],
    name: ['Name is too short'],
  });
};
```

### abort() Helper

Laravel-style abort helper for quick HTTP errors:

```typescript
abort(404);                          // Throws NotFoundError
abort(403, 'Admin access only');     // Throws HttpError with custom message
abortIf(!user, 401);                // Throws if condition is true
abortUnless(user.isAdmin, 403);     // Throws if condition is false
```

## Toast Notifications

### Setup

Add `<Toaster />` once in your root layout:

```svelte
<script>
  import { Toaster } from 'svelar/ui';
</script>

<Toaster position="bottom-right" />
```

### Manual Usage

```typescript
import { toast } from 'svelar/ui';

toast('Hello world');
toast.success('Profile saved!');
toast.error('Failed to delete', { description: 'You lack permission' });
toast.warning('Unsaved changes');
toast.info('New version available', {
  action: { label: 'Update', onClick: () => location.reload() },
});

// Promise lifecycle
toast.promise(saveData(), {
  loading: 'Saving...',
  success: 'Saved!',
  error: 'Failed to save',
});

// Dismiss
const id = toast('Processing...');
toast.dismiss(id);
toast.dismissAll();
```

### Toaster Props

| Prop | Default | Description |
|------|---------|-------------|
| `position` | `'bottom-right'` | `'top-right'`, `'top-left'`, `'bottom-right'`, `'bottom-left'`, `'top-center'`, `'bottom-center'` |
| `maxVisible` | `5` | Maximum simultaneous toasts |

### Toast Options

| Option | Default | Description |
|--------|---------|-------------|
| `description` | — | Secondary text below the title |
| `duration` | `5000` | Auto-dismiss in ms (`0` = persistent) |
| `dismissible` | `true` | Show close button |
| `action` | — | `{ label, onClick }` action button |

## API Fetch with Auto-Toast

### apiFetch

Enhanced fetch that automatically shows toast notifications on error responses:

```typescript
import { apiFetch } from 'svelar/http';

// Errors auto-show as toasts
const res = await apiFetch('/api/posts', {
  method: 'POST',
  body: JSON.stringify({ title: 'Hello' }),
});

// Disable auto-toast for manual handling
const res = await apiFetch('/api/posts', { showToast: false });

// Custom error message for a specific status
const res = await apiFetch('/api/billing', {
  method: 'POST',
  errorMessages: { 402: 'Payment required. Update your billing.' },
});
```

### apiFetchJson

Typed wrapper that never throws — returns `{ data, error, ok }`:

```typescript
import { apiFetchJson } from 'svelar/http';

interface Post { id: number; title: string; }

const { data, error, ok } = await apiFetchJson<Post[]>('/api/posts');
if (ok) {
  console.log(data); // Post[]
} else {
  console.log(error.message); // Already shown as toast
  if (error.errors) {
    // Validation field errors
    console.log(error.errors); // { title: ['Required'] }
  }
}
```

### Auto-Toast Behavior by Status

| Status | Toast Variant | Behavior |
|--------|---------------|----------|
| 401 | Warning | "Please sign in to continue" |
| 422 | Warning | Shows field-level validation errors |
| 429 | Warning | Rate limit message |
| 4xx | Error | Server message or default description |
| 5xx | Error | Server error message |
| Network | Error | "Unable to connect" |

## Error Page

The `+error.svelte` page handles all HTTP status codes with:

- Color-coded top band (red for 5xx, blue for auth, yellow for client errors)
- Contextual icon and description per status code
- Smart action buttons (Sign In for 401, Go Back for 400/403, Retry for 5xx)
- Expandable technical details in development mode
- Full i18n support (EN, PT, ES)

### Supported Status Codes

400, 401, 403, 404, 405, 408, 409, 419, 422, 429, 500, 502, 503, 504, plus a generic fallback for any unlisted code.

## Route Protection

### guardAuth()

Protect entire route groups via `+layout.server.ts`:

```typescript
// src/routes/dashboard/+layout.server.ts
import { guardAuth } from 'svelar/auth';
export const load = guardAuth();

// src/routes/admin/+layout.server.ts — with role check
import { guardAuth } from 'svelar/auth';
export const load = guardAuth('/dashboard', { role: 'admin' });
```

### RequireAuthMiddleware

For API routes, returns 401 JSON:

```typescript
import { RequireAuthMiddleware } from 'svelar/auth';
// Returns { message: 'Unauthenticated' } with status 401
```

### RedirectIfNotAuthenticated

For page routes, 302 redirects to login:

```typescript
import { RedirectIfNotAuthenticated } from 'svelar/auth';
// Redirects to /login (or custom path)
```

## Custom Error Reporting

```typescript
import { createSvelarApp } from 'svelar/hooks';

export const { handle, handleError } = createSvelarApp({
  auth,
  errorConfig: {
    debug: process.env.NODE_ENV !== 'production',
    report: async (error, context) => {
      // Send to Sentry, Datadog, etc.
      await sentry.captureException(error, { extra: context });
    },
    dontReport: [ValidationError, NotFoundError],
  },
});
```

## Next Steps

- Learn about [Auth](./07-auth.md) for authentication setup
- Check [Middleware](./04-middleware.md) for request pipeline
- Explore [Validation](./05-validation.md) for input validation
- See [SaaS Guide](./17-saas-guide.md) for full application patterns

---

**Svelar Error Handling** © 2026
