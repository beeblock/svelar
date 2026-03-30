# HTTP Utilities

Svelar provides two HTTP layers:

- **Client-side** (`apiFetch`) — CSRF-aware fetch for calling your own API from Svelte components
- **Server-side** (`Http`) — Fluent HTTP client for calling third-party APIs (Postmark, Stripe, Mailchimp, etc.)

## Server-Side HTTP Client

The `Http` client is designed for server-to-server communication — calling external APIs from your controllers, services, and jobs. It provides a fluent, immutable API inspired by Laravel's `Http` facade.

### Import

```typescript
import { Http } from '@beeblock/svelar/http';
```

### Basic Usage

```typescript
// GET request
const response = await Http
  .baseUrl('https://api.example.com')
  .withToken(process.env.API_TOKEN!)
  .get('/users');

console.log(response.data);   // parsed JSON
console.log(response.status); // 200
console.log(response.ok);     // true

// POST with JSON body
const response = await Http
  .withToken(process.env.STRIPE_SECRET!)
  .baseUrl('https://api.stripe.com/v1')
  .contentType('application/x-www-form-urlencoded')
  .post('/customers', 'email=user@example.com&name=John');
```

### Authentication

```typescript
// Bearer token (default)
Http.withToken('sk_live_...')

// Custom header token (e.g., Postmark uses X-Postmark-Server-Token)
Http.withHeaders({ 'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN! })

// Basic auth
Http.withBasicAuth('username', 'password')

// API key header
Http.withHeaders({ 'X-API-Key': process.env.MAILCHIMP_KEY! })
```

### Third-Party API Examples

#### Postmark

```typescript
import { Http } from '@beeblock/svelar/http';

const postmark = Http
  .baseUrl('https://api.postmarkapp.com')
  .withHeaders({ 'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN! });

const response = await postmark.post('/email', {
  From: 'hello@myapp.com',
  To: 'user@example.com',
  Subject: 'Welcome!',
  HtmlBody: '<h1>Hello</h1>',
});
```

#### Resend

```typescript
const resend = Http
  .baseUrl('https://api.resend.com')
  .withToken(process.env.RESEND_API_KEY!);

await resend.post('/emails', {
  from: 'hello@myapp.com',
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello</h1>',
});
```

#### Stripe

```typescript
const stripe = Http
  .baseUrl('https://api.stripe.com/v1')
  .withToken(process.env.STRIPE_SECRET!)
  .contentType('application/x-www-form-urlencoded');

// Create a customer
const customer = await stripe.post('/customers', 'email=user@example.com');

// List charges with query params
const charges = await stripe.query({ limit: 10 }).get('/charges');
```

#### Mailchimp

```typescript
const mailchimp = Http
  .baseUrl(`https://${process.env.MAILCHIMP_DC}.api.mailchimp.com/3.0`)
  .withToken(process.env.MAILCHIMP_KEY!);

// Get lists
const lists = await mailchimp.get('/lists');

// Add a subscriber
await mailchimp.post(`/lists/${listId}/members`, {
  email_address: 'user@example.com',
  status: 'subscribed',
});
```

#### Any REST API

```typescript
const github = Http
  .baseUrl('https://api.github.com')
  .withToken(process.env.GITHUB_TOKEN!)
  .withHeaders({ 'X-GitHub-Api-Version': '2022-11-28' });

const repos = await github.get('/user/repos');
```

### Retry & Timeout

```typescript
// Retry up to 3 times on 5xx errors (1s, 2s, 3s delays)
const response = await Http
  .withToken(token)
  .baseUrl('https://api.example.com')
  .retry(3, 1000)
  .timeout(10_000)
  .get('/data');
```

Only 5xx server errors are retried. Client errors (4xx) fail immediately.

### Error Handling

Failed requests throw `HttpRequestError` with the status code and response body:

```typescript
import { Http, HttpRequestError } from '@beeblock/svelar/http';

try {
  await Http.withToken(token).baseUrl('https://api.stripe.com/v1').get('/charges');
} catch (err) {
  if (err instanceof HttpRequestError) {
    console.log(err.status); // 401
    console.log(err.body);   // { error: { message: 'Invalid API Key' } }
  }
}
```

### Reusable Clients

Create a pre-configured client in a service file and reuse it across your app:

```typescript
// src/lib/services/PostmarkClient.ts
import { Http } from '@beeblock/svelar/http';

export const postmarkClient = Http
  .baseUrl('https://api.postmarkapp.com')
  .withHeaders({ 'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN! })
  .retry(2);

// src/lib/services/StripeClient.ts
import { Http } from '@beeblock/svelar/http';

export const stripeClient = Http
  .baseUrl('https://api.stripe.com/v1')
  .withToken(process.env.STRIPE_SECRET!)
  .contentType('application/x-www-form-urlencoded')
  .retry(2);
```

```typescript
// In a controller or service
import { postmarkClient } from '$lib/services/PostmarkClient.js';

await postmarkClient.post('/email', {
  From: 'hello@myapp.com',
  To: user.email,
  Subject: 'Your invoice',
  HtmlBody: invoiceHtml,
});
```

### Full API

| Method | Description |
|--------|-------------|
| `Http.baseUrl(url)` | Set the base URL for all requests |
| `Http.withToken(token, type?)` | Set `Authorization: Bearer <token>` (or custom type) |
| `Http.withBasicAuth(user, pass)` | Set `Authorization: Basic <base64>` |
| `Http.withHeaders(headers)` | Merge additional headers |
| `Http.accept(type)` | Set `Accept` header |
| `Http.contentType(type)` | Set `Content-Type` header |
| `Http.timeout(ms)` | Set request timeout (default: 30s) |
| `Http.retry(times, delayMs?)` | Retry on 5xx errors |
| `Http.query(params)` | Add URL query parameters |
| `Http.get(path)` | Send GET request |
| `Http.post(path, body?)` | Send POST request |
| `Http.put(path, body?)` | Send PUT request |
| `Http.patch(path, body?)` | Send PATCH request |
| `Http.delete(path, body?)` | Send DELETE request |

All chainable methods return a new `HttpClient` instance (immutable) — safe to store and reuse.

---

## Creating Custom Integrations

Svelar provides three levels of extensibility for third-party integrations:

### 1. Service Pattern (Recommended for Most Cases)

Create a service class that wraps `Http` for a specific API. This is the simplest and most common pattern:

```typescript
// src/lib/modules/billing/StripeService.ts
import { Http, HttpClient, HttpRequestError } from '@beeblock/svelar/http';

export class StripeService {
  private client: HttpClient;

  constructor() {
    this.client = Http
      .baseUrl('https://api.stripe.com/v1')
      .withToken(process.env.STRIPE_SECRET!)
      .contentType('application/x-www-form-urlencoded')
      .retry(2);
  }

  async createCustomer(email: string, name?: string) {
    const params = new URLSearchParams({ email });
    if (name) params.set('name', name);
    return this.client.post('/customers', params.toString());
  }

  async createSubscription(customerId: string, priceId: string) {
    const params = new URLSearchParams({
      customer: customerId,
      'items[0][price]': priceId,
    });
    return this.client.post('/subscriptions', params.toString());
  }

  async getInvoices(customerId: string) {
    return this.client.query({ customer: customerId }).get('/invoices');
  }
}
```

Use it in your controllers:

```typescript
// src/lib/modules/billing/BillingController.ts
import { Controller } from '@beeblock/svelar/routing';
import { StripeService } from './StripeService.js';

export class BillingController extends Controller {
  private stripe = new StripeService();

  async subscribe(event) {
    const { priceId } = await event.request.json();
    const user = event.locals.user;

    const customer = await this.stripe.createCustomer(user.email, user.name);
    const subscription = await this.stripe.createSubscription(customer.data.id, priceId);

    return this.json({ subscription: subscription.data });
  }
}
```

### 2. Custom Mail Driver

To add a new email provider (e.g., Mailchimp Transactional), implement the `MailTransport` interface:

```typescript
// src/lib/shared/mail/MailchimpTransport.ts
import { Http } from '@beeblock/svelar/http';
import type { MailTransport, MailMessage, SendResult } from '@beeblock/svelar/mail';

export class MailchimpTransport implements MailTransport {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(message: MailMessage): Promise<SendResult> {
    try {
      const response = await Http
        .baseUrl('https://mandrillapp.com/api/1.0')
        .post('/messages/send', {
          key: this.apiKey,
          message: {
            from_email: message.from?.address ?? message.from,
            to: [{ email: message.to, type: 'to' }],
            subject: message.subject,
            html: message.html,
            text: message.text,
          },
        });

      return { success: true, messageId: response.data[0]?._id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
```

Register it in your app bootstrap:

```typescript
// src/app.ts
import { Mailer } from '@beeblock/svelar/mail';
import { MailchimpTransport } from '$lib/shared/mail/MailchimpTransport.js';

Mailer.configure({
  default: 'mailchimp',
  mailers: {
    mailchimp: {
      driver: 'custom',
      transport: new MailchimpTransport(process.env.MAILCHIMP_API_KEY!),
    },
  },
});
```

### 3. Plugin (For Reusable, Publishable Integrations)

For integrations you want to distribute as an npm package, use the Plugin system:

```typescript
// svelar-mailchimp/src/index.ts
import { Plugin } from '@beeblock/svelar/plugins';
import { MailchimpTransport } from './MailchimpTransport.js';

export class MailchimpPlugin extends Plugin {
  name = 'svelar-mailchimp';
  version = '1.0.0';
  description = 'Mailchimp Transactional integration for Svelar';

  register() {
    this.app.singleton('mailchimp', () => {
      return new MailchimpTransport(process.env.MAILCHIMP_API_KEY!);
    });
  }

  config() {
    return {
      key: 'mailchimp',
      defaults: {
        apiKey: '',
        defaultFromEmail: 'hello@example.com',
      },
    };
  }
}
```

Install and use:

```typescript
// src/app.ts
import { PluginManager } from '@beeblock/svelar/plugins';
import { MailchimpPlugin } from 'svelar-mailchimp';

const plugins = new PluginManager(app);
plugins.use(new MailchimpPlugin());
await plugins.boot();
```

### When to Use What

| Pattern | When to use |
|---------|-------------|
| **Service** | App-specific integrations (your Stripe, your CRM, your analytics) |
| **Custom Driver** | Swappable implementations (new mail provider, new cache backend) |
| **Plugin** | Publishable packages with migrations, config, and lifecycle hooks |

---

## Client-Side: apiFetch

The `apiFetch` function is a drop-in replacement for `fetch` that automatically handles CSRF tokens. It reads the `XSRF-TOKEN` cookie and attaches it as an `X-CSRF-Token` header on mutation requests (POST, PUT, PATCH, DELETE).

### Import

```typescript
import { apiFetch } from '@beeblock/svelar/http';
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
  import { apiFetch } from '@beeblock/svelar/http';

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
import { buildUrl } from '@beeblock/svelar/http';

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
import { getCsrfToken } from '@beeblock/svelar/http';

const token = getCsrfToken();
// Returns null on the server (SSR)
```

## Next Steps

- Set up [Internationalization](./15-i18n.md) for multi-language support
- Explore [Forms](./16-forms.md) for server-side validation with Superforms
- Learn about [Middleware](./07-middleware.md) to understand how CSRF protection works
- See [Mail](./24-mail.md) for built-in email drivers (SMTP, Postmark, Resend)
- Check [Plugins](./09-plugins.md) for building publishable integrations

---

**Svelar HTTP Guide** © 2026
