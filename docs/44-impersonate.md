# Impersonate Plugin

A user impersonation plugin for Svelar/SvelteKit that allows administrators to log in as other users for debugging and support. Features session-based impersonation, configurable guard checks, middleware for automatic user switching, and pre-built UI components for the impersonation banner and trigger button.

**Package:** `@beeblock/svelar-impersonate`

Requires Node.js `>=22.12.0`, Svelar `^0.8.0`, and Svelte `^5.0.0`. Impersonation requires the request-local `AuthManager`, a Svelar session, and `authenticatedVia: 'session'`; verified Bearer credentials cannot start or continue impersonation.

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-impersonate
```

**Imports:**

```ts
// Plugin registration
import SvelarImpersonatePlugin from '@beeblock/svelar-impersonate/plugin';

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
import { capabilityAccess } from '$lib/shared/permissions/access.server.js';

Impersonate.configure({
  userModel: User,
  redirect: '/dashboard',
  guard: async (admin) => {
    // This example uses the application's default numeric permission subject.
    const modelId = admin.getAttribute(User.primaryKey);
    if (typeof modelId !== 'number' || !Number.isSafeInteger(modelId) || modelId < 1) return false;
    return (await capabilityAccess.can('action.support.impersonate', {
      principal: { kind: 'user', modelType: User.name, modelId },
      scope: { platform: true },
    })) === true;
  },
  targetGuard: (target) => {
    const role = target?.role ?? target?.getAttribute?.('role');
    return role !== 'admin' && role !== 'super-admin';
  },
});
```

The default-exported `/plugin` class extends Svelar's `Plugin`; its `boot()` configures this same facade. The named `/server` class export remains available. Use either normal plugin boot or explicit `Impersonate.configure()` in the common server bootstrap. Keep the configured user model consistent with the auth manager's model and eligibility policy.

Bind `guard` to current trusted platform authority and the application's registered support capability. Return a boolean; when adapting a capability resolver, allow only `(await resolverResult) === true`. Tenant-admin grants or client permission snapshots must not establish platform impersonation authority. The built-in role checks are defaults and do not register or seed application capabilities.

Register and seed `action.support.impersonate` as a platform capability in the application's literal manifest. The example uses its default numeric permission subject; opaque auth IDs require the application's trusted permission-subject mapping, never `Number(uuid)`. Both initial access and the freshly reloaded original admin use this same capability decision.

The capability resolver imports shown here use the DDD layout. Flat apps use `$lib/permissions/access.server.js`; use the generated path for your layout.

### 2. Add the Middleware

```ts
// src/hooks.server.ts
import { ImpersonateMiddleware } from '@beeblock/svelar-impersonate/server';
import { CsrfMiddleware } from '@beeblock/svelar/middleware';

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({ ... }),
    new AuthenticateMiddleware(auth),
    new CsrfMiddleware(),
    new ImpersonateMiddleware(), // must come after auth
  ],
});
```

### 3. Add API Routes

```ts
// src/routes/api/admin/impersonate/[id]/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';

export const POST = capabilityAccess.guardEndpoint(
  'action.support.impersonate',
  (event) => ImpersonateController.start(event),
  resolveCapabilityInput,
);
```

```ts
// src/routes/api/admin/impersonate/stop/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';

// Reviewed functional-RBAC exemption: restore this authenticated session only.
// The service reauthorizes the original admin through the configured capability guard.
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
| `userModel` | User model or resolver | `null` | `find(id: string \| number)` must return `Promise<AuthUser \| null>` |

**Guard type signatures:**

```ts
import type { AuthUser } from '@beeblock/svelar/auth';

type ImpersonateGuard = (admin: AuthUser) => boolean | Promise<boolean>;
type CanBeImpersonatedGuard = (target: AuthUser) => boolean | Promise<boolean>;
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

IDs retain their `string | number` type; UUID/ULID user IDs are supported, including custom named primary keys. The service reads the model constructor's declared `primaryKey` through `getAttribute()` and preserves the exact identifier during start and restoration. A missing declared key is rejected even if the record contains a shadow `id`; the default `id` lookup is used only for records without model primary-key metadata. The HTTP start request validates a non-empty, trimmed ID of at most 255 characters and passes it to the service without numeric coercion.

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
- Self and nested impersonation are prevented
- Current persisted admin and target accounts are checked against guards and core eligibility rules
- Core `AuthManager.login()` rotates the session and synchronizes its stored identity, `auth.user()`, and `event.locals.user`
- The original admin's eligibility and authority are rechecked before restoration and on subsequent requests
- A failed post-login guard restores the original identity or revokes authentication; revocation clears authenticated state even if logout auditing fails

Core auth uses its configured audit sink. The plugin does not emit the old console start/stop logs or dispatch its exported `ImpersonateStartEvent`/`ImpersonateStopEvent` interfaces. Add application-owned audit records with the original actor and target when that durable trail is required.

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
import { Model } from '@beeblock/svelar/orm';
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
import { Model } from '@beeblock/svelar/orm';
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
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';

export const POST = capabilityAccess.guardEndpoint(
  'action.support.impersonate',
  (event) => ImpersonateController.start(event),
  resolveCapabilityInput,
);
```

```ts
// src/routes/api/admin/impersonate/stop/+server.ts
// Reviewed functional-RBAC exemption: existing session restoration, original-admin guard still applies.
export const POST = async (event) => ImpersonateController.stop(event);
```

```ts
// src/routes/api/admin/impersonate/status/+server.ts
// Reviewed functional-RBAC exemption: current authenticated session state only.
export const GET = async (event) => ImpersonateController.status(event);
```

| Method | Route | Description |
|---|---|---|
| `ImpersonateController.start(event)` | `POST /api/admin/impersonate/:id` | Start impersonating (reads `event.params.id`) |
| `ImpersonateController.stop(event)` | `POST /api/admin/impersonate/stop` | Stop impersonating |
| `ImpersonateController.status(event)` | `GET /api/admin/impersonate/status` | Get impersonation status |

**Error responses:**
- `401` -- Unauthenticated or missing a required session/auth context
- `422` -- Invalid or missing target ID
- `403` -- Guard, account eligibility, or session-only authorization denied
- `404` -- Target user not found
- `409` -- Already impersonating / not currently impersonating
- `503` -- Required user model is not configured
- `500` -- Unexpected internal failure, returned as the generic `Impersonation failed.` message

The plugin publisher supplies separate start (`[id]`) and stop routes; add the optional status route manually. Keep authentication, capability/policy checks, validation, and CSRF enabled for the write routes.

Record the reviewed stop/status exemptions in the application manifest. Stop is authorized against the freshly loaded original admin through `guard`, so the impersonated member does not need the support capability to restore the session. Status exposes only this authenticated session and must run after verification middleware.

### ImpersonateMiddleware

Verifies impersonation on every request using current account data and the core auth engine. It checks that the authenticated session identity matches the stored target and keeps `auth.user()` and `event.locals.user` synchronized.

```ts
// src/hooks.server.ts
import { ImpersonateMiddleware } from '@beeblock/svelar-impersonate/server';
import { CsrfMiddleware } from '@beeblock/svelar/middleware';

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({ ... }),
    new AuthenticateMiddleware(auth),
    new CsrfMiddleware(),
    new ImpersonateMiddleware(), // MUST come after authentication
  ],
});
```

The middleware:
- Checks the stored original/target IDs and requires authenticated session context
- Reloads the original admin and checks current eligibility and authority
- Reloads and validates the target, then resolves it through the auth manager
- Restores an eligible, authorized original admin when the target disappears and the session context remains valid
- Revokes authentication when context or original authority is lost; verification failures do not silently continue
- Sets `event.locals.impersonating` to `true` or `false`

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

Both controls use the standard `XSRF-TOKEN` cookie and `X-CSRF-Token` header. Keep the server CSRF middleware enabled. With custom CSRF names, use an application-owned control that sends the configured header, such as one built on core `apiFetch`; the `csrfToken` prop supplies a token value but does not rename the header.

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
| `startUrl` | `string` | `'/api/admin/impersonate/{userId}'` | API endpoint (userId is URI-encoded when generated) |
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
import { Model } from '@beeblock/svelar/orm';
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

// Use the capability-bound guard configuration from Quick Start above.
// A role-only default is insufficient for a platform support endpoint.
```

```ts
// src/hooks.server.ts
import '$lib/impersonate';
import { ImpersonateMiddleware } from '@beeblock/svelar-impersonate/server';
import { CsrfMiddleware } from '@beeblock/svelar/middleware';

export const handle = createSvelarHooks({
  middleware: [
    new SessionMiddleware({ store: new DatabaseSessionStore() }), // run core session migrations first
    new AuthenticateMiddleware(auth),
    new CsrfMiddleware(),
    new ImpersonateMiddleware(),
  ],
});
```

```ts
// src/routes/api/admin/impersonate/[id]/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';

export const POST = capabilityAccess.guardEndpoint(
  'action.support.impersonate',
  (event) => ImpersonateController.start(event),
  resolveCapabilityInput,
);
```

```ts
// src/routes/api/admin/impersonate/stop/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';

// Reviewed functional-RBAC exemption: original-admin capability guard and CSRF remain enforced.
export const POST = async (event) => ImpersonateController.stop(event);
```

```ts
// src/routes/api/admin/impersonate/status/+server.ts
import { ImpersonateController } from '@beeblock/svelar-impersonate/server';

// Reviewed functional-RBAC exemption: current authenticated session state only.
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
