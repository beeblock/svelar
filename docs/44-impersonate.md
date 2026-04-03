# Impersonate Plugin

A user impersonation plugin for Svelar/SvelteKit that allows administrators to log in as other users for debugging and support. Features session-based impersonation, configurable guard checks, middleware for automatic user switching, and pre-built UI components for the impersonation banner and trigger button.

**Package:** `@beeblock/svelar-impersonate`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-impersonate
```

**Imports:**

```ts
// Plugin registration
import { SvelarImpersonatePlugin } from '@beeblock/svelar-impersonate/server';

// Core API
import { Impersonate, ImpersonateService, CanImpersonate, CanBeImpersonated } from '@beeblock/svelar-impersonate';

// Server-side (controller, middleware)
import { ImpersonateController, ImpersonateMiddleware } from '@beeblock/svelar-impersonate/server';

// UI components
import { ImpersonateBanner, ImpersonateButton } from '@beeblock/svelar-impersonate/ui';

// Types
import type { ImpersonateConfig, ImpersonatePluginConfig, ImpersonateGuard, CanBeImpersonatedGuard, ImpersonateStartEvent, ImpersonateStopEvent, ImpersonateStatus } from '@beeblock/svelar-impersonate';
import type { CanImpersonateInstance, CanBeImpersonatedInstance } from '@beeblock/svelar-impersonate';
```

---

## Quick Start

### 1. Configure the Plugin

```ts
// src/lib/impersonate.ts
import { Impersonate } from '@beeblock/svelar-impersonate';
import { User } from '$lib/models/User';

Impersonate.configure({
  userModel: User,
  redirect: '/dashboard',
  guard: (admin) => {
    const role = admin?.role ?? admin?.getAttribute?.('role');
    return role === 'admin' || role === 'super-admin';
  },
  targetGuard: (target) => {
    const role = target?.role ?? target?.getAttribute?.('role');
    return role !== 'admin' && role !== 'super-admin';
  },
});
```

### 2. Add the Middleware

```ts
// src/hooks.server.ts
import { ImpersonateMiddleware } from '@beeblock/svelar-impersonate/server';

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({ ... }),
    new AuthenticateMiddleware(auth),
    new ImpersonateMiddleware(), // must come after auth
  ],
});
```

### 3. Add API Routes

```ts
// src/routes/api/admin/impersonate/[id]/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';

export const POST = async (event) => ImpersonateController.start(event);
```

```ts
// src/routes/api/admin/impersonate/stop/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';

export const POST = async (event) => ImpersonateController.stop(event);
```

### 4. Add the Banner

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { ImpersonateBanner } from '@beeblock/svelar-impersonate/ui';

  interface Props {
    data: { impersonating: boolean; impersonatedUserName?: string };
    children: any;
  }
  let { data, children }: Props = $props();
</script>

<ImpersonateBanner
  isImpersonating={data.impersonating}
  userName={data.impersonatedUserName}
/>

{@render children()}
```

---

## Configuration

The `SvelarImpersonatePlugin` / `Impersonate.configure()` accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `sessionKey` | `string` | `'impersonate_original_user_id'` | Session key for the original admin user ID |
| `impersonatedKey` | `string` | `'impersonate_target_user_id'` | Session key for the impersonated user ID |
| `guard` | `ImpersonateGuard` | checks for `admin`/`super-admin` role | Function that determines if a user can impersonate |
| `targetGuard` | `CanBeImpersonatedGuard` | prevents impersonating `admin`/`super-admin` | Function that determines if a user can be impersonated |
| `redirect` | `string` | `'/dashboard'` | URL to redirect to after starting/stopping impersonation |
| `userModel` | `any` | `null` | The User model class (must have a static `find(id)` method) |

**Guard type signatures:**

```ts
type ImpersonateGuard = (admin: any) => boolean | Promise<boolean>;
type CanBeImpersonatedGuard = (target: any) => boolean | Promise<boolean>;
```

---

## Core API

### Impersonate Facade

The `Impersonate` object is the main entry point:

```ts
import { Impersonate } from '@beeblock/svelar-impersonate';
```

| Method | Returns | Description |
|---|---|---|
| `Impersonate.configure(config)` | `void` | Initialize with configuration |
| `Impersonate.getConfig()` | `ImpersonateConfig` | Get current configuration |
| `Impersonate.start(event, targetUserId)` | `Promise<void>` | Start impersonating a user |
| `Impersonate.stop(event)` | `Promise<void>` | Stop impersonating, restore admin |
| `Impersonate.isImpersonating(event)` | `boolean` | Check if session is in impersonation mode |
| `Impersonate.getOriginalUserId(event)` | `string \| number \| null` | Get the original admin user ID |
| `Impersonate.getImpersonatedUserId(event)` | `string \| number \| null` | Get the impersonated user ID |
| `Impersonate.getStatus(event)` | `Promise<ImpersonateStatus>` | Get full status for the client |

**ImpersonateStatus:**

```ts
interface ImpersonateStatus {
  isImpersonating: boolean;
  originalUserName?: string;
  impersonatedUserName?: string;
  impersonatedUserId?: string | number;
}
```

**Safety features:**
- Nested impersonation is prevented (throws an error if already impersonating)
- Guard checks run before every impersonation start
- Target user existence is verified
- Audit logging to console on start/stop

### ImpersonateService

The underlying service class used by the `Impersonate` facade. You rarely need to use this directly:

```ts
const service = new ImpersonateService(config);

await service.start(event, targetUserId);
await service.stop(event);
service.isImpersonating(event);
service.getOriginalUserId(event);
service.getImpersonatedUserId(event);
```

### CanImpersonate Mixin

Adds a `canImpersonate()` method to your User model. By default, checks for `admin` or `super-admin` role:

```ts
import { Model } from '@beeblock/svelar/database';
import { CanImpersonate } from '@beeblock/svelar-impersonate';

class User extends CanImpersonate(Model) {
  static table = 'users';

  // Override to customize authorization
  canImpersonate(): boolean {
    return this.role === 'admin' || this.role === 'super-admin';
  }
}
```

### CanBeImpersonated Mixin

Adds a `canBeImpersonated()` method. By default, prevents impersonation of admin and super-admin users:

```ts
import { Model } from '@beeblock/svelar/database';
import { CanImpersonate, CanBeImpersonated } from '@beeblock/svelar-impersonate';

class User extends CanImpersonate(CanBeImpersonated(Model)) {
  static table = 'users';

  // Override to customize
  canBeImpersonated(): boolean {
    return this.role !== 'admin' && this.role !== 'super-admin';
  }
}
```

---

## Server-Side

### ImpersonateController

Provides static methods for impersonation API routes:

```ts
// src/routes/api/admin/impersonate/[id]/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';

export const POST = async (event) => ImpersonateController.start(event);
```

```ts
// src/routes/api/admin/impersonate/stop/+server.ts
export const POST = async (event) => ImpersonateController.stop(event);
```

```ts
// src/routes/api/admin/impersonate/status/+server.ts
export const GET = async (event) => ImpersonateController.status(event);
```

| Method | Route | Description |
|---|---|---|
| `ImpersonateController.start(event)` | `POST /api/admin/impersonate/:id` | Start impersonating (reads `event.params.id`) |
| `ImpersonateController.stop(event)` | `POST /api/admin/impersonate/stop` | Stop impersonating |
| `ImpersonateController.status(event)` | `GET /api/admin/impersonate/status` | Get impersonation status |

**Error responses:**
- `401` -- Unauthenticated
- `400` -- Missing target ID or general error
- `403` -- Not authorized to impersonate
- `404` -- Target user not found
- `409` -- Already impersonating / not currently impersonating

### ImpersonateMiddleware

Automatically resolves the impersonated user on every request. When impersonation is active, it replaces `event.locals.user` with the target user and sets `event.locals.impersonating = true`.

```ts
// src/hooks.server.ts
import { ImpersonateMiddleware } from '@beeblock/svelar-impersonate/server';

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({ ... }),
    new AuthenticateMiddleware(auth),
    new ImpersonateMiddleware(), // MUST come after authentication
  ],
});
```

The middleware:
- Checks if impersonation session keys exist
- Loads the impersonated user via `config.userModel.find()`
- Replaces `event.locals.user` with the impersonated user
- Sets `event.locals.impersonating` to `true` or `false`
- Automatically stops impersonation if the target user no longer exists

---

## UI Components

### ImpersonateBanner

A fixed banner at the top of the page when impersonation is active:

```svelte
<script lang="ts">
  import { ImpersonateBanner } from '@beeblock/svelar-impersonate/ui';
</script>

<ImpersonateBanner
  isImpersonating={true}
  userName="John Doe"
  stopUrl="/api/admin/impersonate/stop"
  redirectUrl="/admin/users"
  className="my-custom-banner"
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `isImpersonating` | `boolean` | `false` | Whether impersonation is active |
| `userName` | `string` | `''` | Name of the impersonated user |
| `stopUrl` | `string` | `'/api/admin/impersonate/stop'` | API endpoint to stop impersonation |
| `redirectUrl` | `string` | `undefined` | URL to redirect after stopping (overrides server response) |
| `csrfToken` | `string` | `undefined` | CSRF token (reads from `XSRF-TOKEN` cookie by default) |
| `children` | `Snippet` | `undefined` | Custom banner content |
| `className` | `string` | `''` | CSS class override |

Features:
- Red banner fixed to the top of the viewport
- Shows "You are impersonating **userName**"
- "Stop Impersonating" button with loading state
- Automatically reads CSRF token from cookie
- Supports custom content via the `children` snippet

### ImpersonateButton

A button to start impersonation for a specific user:

```svelte
<script lang="ts">
  import { ImpersonateButton } from '@beeblock/svelar-impersonate/ui';
</script>

<ImpersonateButton
  userId={42}
  variant="outline"
  confirmMessage="Are you sure you want to impersonate this user?"
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `userId` | `string \| number` | required | ID of the user to impersonate |
| `startUrl` | `string` | `'/api/admin/impersonate/{userId}'` | API endpoint (auto-generated from userId) |
| `redirectUrl` | `string` | `undefined` | URL to redirect after starting |
| `csrfToken` | `string` | `undefined` | CSRF token (reads from cookie by default) |
| `disabled` | `boolean` | `false` | Disable the button |
| `children` | `Snippet` | `undefined` | Custom button content |
| `className` | `string` | `''` | CSS class override |
| `variant` | `'default' \| 'outline' \| 'ghost'` | `'default'` | Button style variant |
| `confirmMessage` | `string` | `'Are you sure you want to impersonate this user?'` | Confirmation dialog text (empty to skip) |

---

## Full Working Example

```ts
// src/lib/models/User.ts
import { Model } from '@beeblock/svelar/database';
import { CanImpersonate, CanBeImpersonated } from '@beeblock/svelar-impersonate';

export class User extends CanImpersonate(CanBeImpersonated(Model)) {
  static table = 'users';
  static fillable = ['name', 'email', 'role'];
}
```

```ts
// src/lib/impersonate.ts
import { Impersonate } from '@beeblock/svelar-impersonate';
import { User } from '$lib/models/User';

Impersonate.configure({
  userModel: User,
  redirect: '/dashboard',
});
```

```ts
// src/hooks.server.ts
import '$lib/impersonate';
import { ImpersonateMiddleware } from '@beeblock/svelar-impersonate/server';

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({ store: new DatabaseSessionStore(db) }),
    new AuthenticateMiddleware(auth),
    new ImpersonateMiddleware(),
  ],
});
```

```ts
// src/routes/api/admin/impersonate/[id]/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';

export const POST = async (event) => ImpersonateController.start(event);
```

```ts
// src/routes/api/admin/impersonate/stop/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';

export const POST = async (event) => ImpersonateController.stop(event);
```

```ts
// src/routes/api/admin/impersonate/status/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';

export const GET = async (event) => ImpersonateController.status(event);
```

```ts
// src/routes/+layout.server.ts
import { Impersonate } from '@beeblock/svelar-impersonate';

export async function load(event) {
  const status = await Impersonate.getStatus(event);
  return {
    user: event.locals.user,
    impersonating: status.isImpersonating,
    impersonatedUserName: status.impersonatedUserName,
  };
}
```

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { ImpersonateBanner } from '@beeblock/svelar-impersonate/ui';
  import type { Snippet } from 'svelte';

  interface Props {
    data: { impersonating: boolean; impersonatedUserName?: string };
    children: Snippet;
  }
  let { data, children }: Props = $props();
</script>

<ImpersonateBanner
  isImpersonating={data.impersonating}
  userName={data.impersonatedUserName ?? ''}
/>

{@render children()}
```

```svelte
<!-- src/routes/admin/users/+page.svelte -->
<script lang="ts">
  import { ImpersonateButton } from '@beeblock/svelar-impersonate/ui';

  interface Props {
    data: { users: any[] };
  }
  let { data }: Props = $props();
</script>

<h1>Users</h1>

<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Email</th>
      <th>Role</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody>
    {#each data.users as user}
      <tr>
        <td>{user.name}</td>
        <td>{user.email}</td>
        <td>{user.role}</td>
        <td>
          {#if user.role !== 'admin' && user.role !== 'super-admin'}
            <ImpersonateButton userId={user.id} variant="ghost" />
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
```
