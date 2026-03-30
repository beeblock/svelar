# Error Handling

Svelar provides a full-stack error handling system covering both API routes (JSON responses with toast notifications) and page routes (polished error pages with i18n support).

## Architecture

The error system has three layers:

1. **Server-side** — Structured error classes (`@beeblock/svelar/errors`) thrown in load functions, actions, and API routes. The `ErrorHandler` catches them and returns proper HTTP responses.

2. **Client-side API** — `apiFetch` and `apiFetchJson` (`@beeblock/svelar/http`) automatically show toast notifications on error responses. Validation errors (422) display field-level details.

3. **Client-side Pages** — The `+error.svelte` page renders a polished, i18n-aware error UI for all HTTP status codes (400–504), with contextual actions (retry, go back, sign in).

## Quick Setup

If you're using `createSvelarApp`, error handling is already wired up:

```typescript
// hooks.server.ts
import { createSvelarApp } from '@beeblock/svelar/hooks';
export const { handle, handleError } = createSvelarApp({ auth });
```

Add the `<Toaster />` component to your layout for client-side toast notifications:

```svelte
<!-- +layout.svelte -->
<script>
  import { Toaster } from '@beeblock/svelar/ui';
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
} from '@beeblock/svelar/errors';
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
  import { Toaster } from '@beeblock/svelar/ui';
</script>

<Toaster position="bottom-right" />
```

### Manual Usage

```typescript
import { toast } from '@beeblock/svelar/ui';

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
import { apiFetch } from '@beeblock/svelar/http';

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
import { apiFetchJson } from '@beeblock/svelar/http';

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
import { guardAuth } from '@beeblock/svelar/auth';
export const load = guardAuth();

// src/routes/admin/+layout.server.ts — with role check
import { guardAuth } from '@beeblock/svelar/auth';
export const load = guardAuth('/dashboard', { role: 'admin' });
```

### RequireAuthMiddleware

For API routes, returns 401 JSON:

```typescript
import { RequireAuthMiddleware } from '@beeblock/svelar/auth';
// Returns { message: 'Unauthenticated' } with status 401
```

### RedirectIfNotAuthenticated

For page routes, 302 redirects to login:

```typescript
import { RedirectIfNotAuthenticated } from '@beeblock/svelar/auth';
// Redirects to /login (or custom path)
```

## Localized Error Messages

Svelar supports error localization at three levels: the error page, server-side error classes, and client-side API toasts.

### Level 1: Error Page (Automatic)

The `+error.svelte` page already localizes error messages using Paraglide. Each HTTP status code maps to an i18n key:

```
error_401_title → "Unauthenticated" (EN) / "No autenticado" (ES) / "Nao autenticado" (PT)
error_401_desc  → "Your session has expired..." / "Tu sesion ha expirado..." / ...
```

This means for **page routes** (load functions, form actions), you don't need to localize server-side messages — the error page overrides them with the user's locale automatically. The server just throws the right status code:

```typescript
// +page.server.ts — no need to localize, the error page handles it
export const load = async ({ locals }) => {
  abortUnless(locals.user, 401); // Error page shows localized 401 message
};
```

### Level 2: Server-Side Localized Errors (API Routes)

For API routes that return JSON, the client receives the `message` field. If your API consumers are browsers using your own frontend, you can localize server-side using Paraglide messages.

Paraglide 2.x makes message functions available on the server within the request context. Import them in your controllers or services:

```typescript
// src/lib/modules/posts/PostController.ts
import { Controller } from '@beeblock/svelar/routing';
import { NotFoundError, ForbiddenError } from '@beeblock/svelar/errors';
import * as m from '$lib/paraglide/messages';

export class PostController extends Controller {
  async show(event: any) {
    const post = await Post.find(event.params.id);

    if (!post) {
      // Localized error message — uses the request's detected locale
      throw new NotFoundError(m.error_post_not_found());
    }

    if (!post.published && post.user_id !== event.locals.user?.id) {
      throw new ForbiddenError(m.error_post_private());
    }

    return this.json(post);
  }
}
```

Add the corresponding message keys to all locale files:

```json
// messages/en.json
{
  "error_post_not_found": "Post not found",
  "error_post_private": "You don't have permission to view this post"
}

// messages/es.json
{
  "error_post_not_found": "Publicacion no encontrada",
  "error_post_private": "No tienes permiso para ver esta publicacion"
}

// messages/pt.json
{
  "error_post_not_found": "Publicacao nao encontrada",
  "error_post_private": "Voce nao tem permissao para ver esta publicacao"
}
```

### Level 3: Localized Validation Messages

Validation errors often need field-level localization. Use Paraglide messages in your `FormRequest` classes:

```typescript
// src/lib/modules/auth/RegisterRequest.ts
import { FormRequest } from '@beeblock/svelar/routing';
import { z } from 'zod';
import * as m from '$lib/paraglide/messages';

export class RegisterRequest extends FormRequest {
  rules() {
    return z.object({
      name: z.string().min(2, m.validation_name_min()),
      email: z.string().email(m.validation_email_invalid()),
      password: z.string().min(8, m.validation_password_min()),
    });
  }
}
```

```json
// messages/en.json
{
  "validation_name_min": "Name must be at least 2 characters",
  "validation_email_invalid": "Please enter a valid email address",
  "validation_password_min": "Password must be at least 8 characters"
}

// messages/es.json
{
  "validation_name_min": "El nombre debe tener al menos 2 caracteres",
  "validation_email_invalid": "Ingrese una direccion de correo valida",
  "validation_password_min": "La contrasena debe tener al menos 8 caracteres"
}
```

The validation error response will contain localized field messages:

```json
{
  "message": "Validation failed",
  "errors": {
    "email": ["Ingrese una direccion de correo valida"],
    "password": ["La contrasena debe tener al menos 8 caracteres"]
  }
}
```

### Localized Validation with Parameters

Paraglide messages support parameters for dynamic values:

```json
// messages/en.json
{
  "validation_min_length": "{field} must be at least {min} characters",
  "validation_max_length": "{field} must not exceed {max} characters",
  "validation_unique": "This {field} is already taken"
}
```

```typescript
import * as m from '$lib/paraglide/messages';

z.string().min(2, m.validation_min_length({ field: m.field_name(), min: '2' }));
```

### Localized abort() Helper

You can pass localized messages to `abort()` and its variants:

```typescript
import { abort, abortUnless } from '@beeblock/svelar/errors';
import * as m from '$lib/paraglide/messages';

// In a load function or controller method
abortUnless(locals.user, 401, m.error_401_title());
abort(403, m.error_admin_only());
abortIf(post.archived, 410, m.error_post_archived());
```

### Localized Custom Error Classes

For domain-specific errors, create localized error classes:

```typescript
// src/lib/modules/billing/errors.ts
import { HttpError } from '@beeblock/svelar/errors';
import * as m from '$lib/paraglide/messages';

export class InsufficientCreditsError extends HttpError {
  constructor(required: number, available: number) {
    super(402, m.error_insufficient_credits({ required: String(required), available: String(available) }));
  }
}

export class SubscriptionExpiredError extends HttpError {
  constructor() {
    super(403, m.error_subscription_expired());
  }
}
```

```json
// messages/en.json
{
  "error_insufficient_credits": "You need {required} credits but only have {available}",
  "error_subscription_expired": "Your subscription has expired. Please renew to continue."
}
```

### Summary: When to Localize Where

| Layer | Who localizes | How |
|-------|--------------|-----|
| **Error pages** (`+error.svelte`) | Client | Automatic — maps status code to i18n key |
| **API JSON responses** | Server | Pass `m.message_key()` when throwing errors |
| **Validation field errors** | Server | Use `m.message_key()` in Zod schemas / FormRequest |
| **Toast notifications** | Client | `apiFetch` shows the server's `message` field |
| **Custom error classes** | Server | Use `m.message_key()` in constructor |

> **Tip:** For public-facing APIs consumed by third parties, keep error messages in English (the HTTP standard). Use localization only for APIs consumed by your own frontend where you control the locale detection.

## Custom Error Reporting

```typescript
import { createSvelarApp } from '@beeblock/svelar/hooks';

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

- Learn about [Auth](./06-authentication.md) for authentication setup
- Check [Middleware](./07-middleware.md) for request pipeline
- Explore [Validation](./05-validation-dtos.md) for input validation
- See [SaaS Guide](./17-saas-guide.md) for full application patterns

---

**Svelar Error Handling** © 2026
