# HTTP Utilities

Client-side HTTP helpers for making CSRF-aware API calls from your Svelte components.

## apiFetch

The `apiFetch` function is a drop-in replacement for `fetch` that automatically handles CSRF tokens. It reads the `XSRF-TOKEN` cookie and attaches it as an `X-CSRF-Token` header on mutation requests (POST, PUT, PATCH, DELETE).

### Import

```typescript
import { apiFetch } from 'svelar/http';
```

### Basic Usage

```typescript
// GET request (no CSRF token needed)
const res = await apiFetch('/api/posts');
const posts = await res.json();

// POST request (CSRF token auto-attached)
const res = await apiFetch('/api/posts', {
  method: 'POST',
  body: JSON.stringify({ title: 'Hello', body: 'World' }),
});

// PUT request
await apiFetch(`/api/posts/${id}`, {
  method: 'PUT',
  body: JSON.stringify({ title: 'Updated' }),
});

// DELETE request
await apiFetch(`/api/posts/${id}`, { method: 'DELETE' });
```

### In Svelte Components

```svelte
<script lang="ts">
  import { apiFetch } from 'svelar/http';

  let posts: any[] = $state([]);
  let loading = $state(false);

  async function loadPosts() {
    loading = true;
    const res = await apiFetch('/api/posts');
    posts = await res.json();
    loading = false;
  }

  async function createPost(title: string, body: string) {
    const res = await apiFetch('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    });

    if (res.ok) {
      await loadPosts(); // Refresh
    }
  }
</script>
```

### Custom CSRF Configuration

```typescript
// Custom cookie/header names
await apiFetch('/api/data', {
  method: 'POST',
  body: JSON.stringify({ key: 'value' }),
  csrfCookieName: 'MY_CSRF_TOKEN',
  csrfHeaderName: 'X-My-Csrf',
});
```

### How It Works

Svelar's `CsrfMiddleware` sets an `XSRF-TOKEN` cookie on every safe request (GET, HEAD, OPTIONS). When `apiFetch` makes a mutation request, it reads that cookie and sends it back as a header. The middleware validates the header matches the cookie — this is the "double-submit cookie" pattern.

Safe methods (GET, HEAD, OPTIONS) skip CSRF entirely. If the body is a string and no `Content-Type` is set, `apiFetch` defaults to `application/json`.

## buildUrl

Helper to construct URLs with query parameters:

```typescript
import { buildUrl } from 'svelar/http';

buildUrl('/api/posts', { page: 1, per_page: 10 });
// => '/api/posts?page=1&per_page=10'

buildUrl('/api/users', { role: 'admin', active: true });
// => '/api/users?role=admin&active=true'

// Null/undefined values are omitted
buildUrl('/api/posts', { page: 1, search: undefined });
// => '/api/posts?page=1'
```

## getCsrfToken

Extract the CSRF token directly:

```typescript
import { getCsrfToken } from 'svelar/http';

const token = getCsrfToken();
// Returns null on the server (SSR)
```

## Next Steps

- Set up [Internationalization](./15-i18n.md) for multi-language support
- Explore [Forms](./16-forms.md) for server-side validation with Superforms
- Learn about [Middleware](./07-middleware.md) to understand how CSRF protection works

---

**Svelar HTTP Guide** © 2026
