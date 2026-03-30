# Controllers & Routing

Learn how to create controllers and wire them to SvelteKit routes to handle HTTP requests.

## Controllers

Controllers accept HTTP requests and return responses. They're the glue between routes and your business logic.

### Creating a Controller

```bash
npx svelar make:controller AuthController
```

This creates `src/lib/controllers/AuthController.ts`:

```typescript
import { Controller } from '@beeblock/svelar/routing';

export class AuthController extends Controller {
  async register(event: any) {
    return this.json({ message: 'Register endpoint' });
  }

  async login(event: any) {
    return this.json({ message: 'Login endpoint' });
  }

  async logout(event: any) {
    return this.json({ message: 'Logged out' });
  }
}
```

## Response Helpers

Controllers provide convenient response methods:

```typescript
// JSON response
return this.json({ message: 'Success' });
return this.json({ message: 'Not found' }, 404);

// Created (201 status)
return this.created({ id: 1, name: 'John' });

// No content (204 status)
return this.noContent();

// Text response
return this.text('Plain text response');

// HTML response
return this.html('<h1>Hello</h1>');

// Redirect
return this.redirect('/login');
return this.redirect('https://example.com');

// Error responses
return this.json({ message: 'Unauthorized' }, 401);
return this.json({ message: 'Forbidden' }, 403);
return this.json({ message: 'Internal Server Error' }, 500);
```

## Wiring Controllers to Routes

Connect controllers to SvelteKit route handlers using the `handle()` method:

```typescript
// src/routes/api/auth/register/+server.ts
import { AuthController } from '$lib/controllers/AuthController.js';

const ctrl = new AuthController();
export const POST = ctrl.handle('register');
```

The `handle()` method wraps your controller method and passes the SvelteKit event:

```typescript
export class AuthController extends Controller {
  async register(event: any) {
    // event.request, event.params, event.locals, etc.
    // are available from SvelteKit
    return this.json({ message: 'Register successful' }, 201);
  }
}
```

### Multiple Routes with One Controller

```typescript
// src/routes/api/posts/+server.ts
import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();

export const GET = ctrl.handle('index');   // List posts
export const POST = ctrl.handle('store');  // Create post
```

```typescript
// src/routes/api/posts/[id]/+server.ts
import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();

export const GET = ctrl.handle('show');    // Get single post
export const PUT = ctrl.handle('update');  // Update post
export const DELETE = ctrl.handle('destroy'); // Delete post
```

### Generating Routes with the CLI

Instead of creating `+server.ts` files manually, use the `make:route` command:

```bash
# Generate full CRUD resource routes (collection + single)
npx svelar make:route posts --api --resource -c PostController --module posts
```

This creates two files:

```
src/routes/api/posts/+server.ts         → GET (index), POST (store)
src/routes/api/posts/[id]/+server.ts    → GET (show), PUT (update), DELETE (destroy)
```

Each file is pre-wired to the controller:

```typescript
// src/routes/api/posts/+server.ts (generated)
import { PostController } from '$lib/modules/posts/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('index');
export const POST = ctrl.handle('store');
```

More examples:

```bash
# Single route with specific methods
npx svelar make:route admin/settings --api -m GET,PUT -c SettingController --module admin

# Simple GET-only route
npx svelar make:route dashboard/stats --api -c DashboardController --module dashboard
```

The command **never overwrites** existing files — if a `+server.ts` already exists at that path, it skips with a warning.

### Listing Routes

See all routes in your application at a glance:

```bash
npx svelar routes:list
```

Output:

```
  Application Routes (29 routes)

  METHOD  PATH                    HANDLER          FILE
  ──────  ──────────────────────  ───────────────  ────────────────────────────────
  GET     /api/auth/me            ctrl.me()        src/routes/api/auth/me/+server.ts
  POST    /api/auth/login         ctrl.login()     src/routes/api/auth/login/+server.ts
  POST    /api/auth/register      ctrl.register()  src/routes/api/auth/register/+server.ts
  GET     /api/posts              ctrl.index()     src/routes/api/posts/+server.ts
  POST    /api/posts              ctrl.store()     src/routes/api/posts/+server.ts
  GET     /api/posts/:id          ctrl.show()      src/routes/api/posts/[id]/+server.ts
  PUT     /api/posts/:id          ctrl.update()    src/routes/api/posts/[id]/+server.ts
  DELETE  /api/posts/:id          ctrl.destroy()   src/routes/api/posts/[id]/+server.ts
  GET     /dashboard              load()           src/routes/dashboard/+page.server.ts
```

Filter routes:

```bash
npx svelar routes:list --api            # API routes only
npx svelar routes:list --method POST    # POST routes only
npx svelar routes:list --json           # JSON output (for scripting)
```

## Complete Controller Example

Here's a complete authentication controller from a scaffolded Svelar project:

```typescript
// src/lib/controllers/AuthController.ts
import { Controller } from '@beeblock/svelar/routing';
import { RegisterRequest } from '../dtos/RegisterRequest.js';
import { LoginRequest } from '../dtos/LoginRequest.js';
import { RegisterUserAction } from '../actions/RegisterUserAction.js';
import { AuthService } from '../services/AuthService.js';

const registerAction = new RegisterUserAction();
const authService = new AuthService();

export class AuthController extends Controller {
  /** POST /api/auth/register */
  async register(event: any) {
    // Validate request with FormRequest DTO
    const data = await RegisterRequest.validate(event);

    // Run action
    const result = await registerAction.run({
      name: data.name,
      email: data.email,
      password: data.password,
    });

    // Handle result
    if (!result.success) {
      return this.json({ message: result.error }, 422);
    }

    // Set session and return user
    const user = result.data!;
    event.locals.session.set('auth_user_id', (user as any).id);
    event.locals.session.regenerateId();

    return this.created({
      message: 'Registration successful',
      user: {
        id: (user as any).id,
        name: (user as any).name,
        email: (user as any).email,
      },
    });
  }

  /** POST /api/auth/login */
  async login(event: any) {
    const data = await LoginRequest.validate(event);

    const result = await authService.login(data.email, data.password);

    if (!result.success) {
      return this.json({ message: result.error }, 401);
    }

    const user = result.data!;
    event.locals.session.set('auth_user_id', (user as any).id);
    event.locals.session.regenerateId();

    return this.json({
      message: 'Login successful',
      user: {
        id: (user as any).id,
        name: (user as any).name,
        email: (user as any).email,
      },
    });
  }

  /** POST /api/auth/logout */
  async logout(event: any) {
    event.locals.session.forget('auth_user_id');
    event.locals.session.regenerateId();

    return this.json({ message: 'Logged out successfully' });
  }

  /** GET /api/auth/me */
  async me(event: any) {
    const user = event.locals.user;
    if (!user) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    return this.json({
      id: user.id,
      name: user.name,
      email: user.email,
      created_at: user.created_at,
    });
  }
}
```

And the routes:

```typescript
// src/routes/api/auth/register/+server.ts
import { AuthController } from '$lib/controllers/AuthController.js';

const ctrl = new AuthController();
export const POST = ctrl.handle('register');
```

```typescript
// src/routes/api/auth/login/+server.ts
import { AuthController } from '$lib/controllers/AuthController.js';

const ctrl = new AuthController();
export const POST = ctrl.handle('login');
```

## Post Controller Example

Here's a complete post controller with CRUD operations:

```typescript
// src/lib/controllers/PostController.ts
import { Controller } from '@beeblock/svelar/routing';
import { CreatePostRequest } from '../dtos/CreatePostRequest.js';
import { UpdatePostRequest } from '../dtos/UpdatePostRequest.js';
import { PostService } from '../services/PostService.js';
import { CreatePostAction } from '../actions/CreatePostAction.js';

const postService = new PostService();
const createPostAction = new CreatePostAction();

export class PostController extends Controller {
  /** GET /api/posts — List published posts */
  async index(event: any) {
    const showAll = event.url.searchParams.get('all') === 'true';

    if (showAll && event.locals.user) {
      const posts = await postService.findAll();
      return this.json(posts);
    }

    const posts = await postService.findPublished();
    return this.json(posts);
  }

  /** GET /api/posts/:id — Show single post */
  async show(event: any) {
    const post = await postService.findByIdOrFail(event.params.id);
    return this.json(post);
  }

  /** POST /api/posts — Create post (authenticated) */
  async store(event: any) {
    const data = await CreatePostRequest.validate(event);
    const userId = event.locals.user?.id;

    if (!userId) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    const post = await createPostAction.run({
      userId,
      title: data.title,
      slug: data.slug,
      body: data.body,
      published: data.published,
    });

    return this.created(post);
  }

  /** PUT /api/posts/:id — Update post */
  async update(event: any) {
    const data = await UpdatePostRequest.validate(event);
    const post = await postService.update(event.params.id, data);
    return this.json(post);
  }

  /** DELETE /api/posts/:id — Delete post */
  async destroy(event: any) {
    await postService.delete(event.params.id);
    return this.noContent();
  }

  /** GET /api/posts/mine — Get current user's posts */
  async mine(event: any) {
    const userId = event.locals.user?.id;
    if (!userId) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    const posts = await postService.findByUser(userId);
    return this.json(posts);
  }
}
```

Routes:

```typescript
// src/routes/api/posts/+server.ts
import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('index');
export const POST = ctrl.handle('store');
```

```typescript
// src/routes/api/posts/[id]/+server.ts
import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('show');
export const PUT = ctrl.handle('update');
export const DELETE = ctrl.handle('destroy');
```

## Controller Middleware

Apply middleware to specific controller methods:

```typescript
export class AdminController extends Controller {
  constructor() {
    super();

    // Apply RequireAuthMiddleware to these methods only
    this.middleware('auth').only(['create', 'store', 'edit', 'update', 'destroy']);
  }

  async index(event: any) {
    // No auth required
    return this.json({ message: 'Public endpoint' });
  }

  async create(event: any) {
    // Auth required
    return this.json({ message: 'Create form' });
  }
}
```

## Error Handling

Controllers can throw errors that are automatically caught and formatted:

```typescript
import { Controller, ValidationError, NotFoundError, UnauthorizedError, ForbiddenError } from '@beeblock/svelar/routing';

export class PostController extends Controller {
  async show(event: any) {
    const post = await Post.findOrFail(event.params.id);
    // If not found, throws ModelNotFoundError (becomes 404)

    if (!post.published && post.user_id !== event.locals.user?.id) {
      throw new ForbiddenError('You cannot view this post');
      // Returns 403 with error message
    }

    return this.json(post);
  }

  async store(event: any) {
    // Validation errors
    if (!event.request.body) {
      throw new ValidationError({ message: 'Body is required' });
      // Returns 422 with validation errors
    }

    return this.created(post);
  }
}
```

### Localized Error Messages

Use Paraglide messages to localize error messages for your API consumers:

```typescript
import { Controller } from '@beeblock/svelar/routing';
import { NotFoundError, ForbiddenError } from '@beeblock/svelar/errors';
import * as m from '$lib/paraglide/messages';

export class PostController extends Controller {
  async show(event: any) {
    const post = await Post.find(event.params.id);
    if (!post) {
      throw new NotFoundError(m.error_post_not_found());
    }

    if (!post.published && post.user_id !== event.locals.user?.id) {
      throw new ForbiddenError(m.error_post_private());
    }

    return this.json(post);
  }
}
```

Validation messages can also be localized in your Zod schemas:

```typescript
import * as m from '$lib/paraglide/messages';

const data = await this.validate(event, {
  email: z.string().email(m.validation_email_invalid()),
  name: z.string().min(2, m.validation_name_min()),
});
```

For the full i18n + error handling guide (error pages, custom error classes, parameter interpolation), see [Error Handling — Localized Error Messages](./19-error-handling.md#localized-error-messages).

## Accessing Request Data

The event object passed to controller methods provides full access to SvelteKit request data:

```typescript
export class PostController extends Controller {
  async store(event: any) {
    // Request body
    const body = await event.request.json();

    // URL parameters (from [id] in route)
    const id = event.params.id;

    // Query string
    const page = event.url.searchParams.get('page');
    const sort = event.url.searchParams.get('sort');

    // Headers
    const token = event.request.headers.get('authorization');

    // Locals (set by middleware)
    const user = event.locals.user;
    const session = event.locals.session;

    // Cookies
    const sessionId = event.cookies.get('session_id');

    return this.json({ received: true });
  }
}
```

## Best Practices

1. **Keep controllers thin** - Delegate business logic to services and actions
2. **Use FormRequest for validation** - Don't validate manually in controllers
3. **Use services for complex operations** - Controllers should orchestrate, not implement
4. **Return appropriate status codes** - 200 for success, 201 for created, 204 for no content, 4xx for client errors, 5xx for server errors
5. **Consistency in responses** - Follow a consistent JSON response format across your API
6. **Handle errors gracefully** - Throw appropriate exceptions; let middleware handle them
7. **Use type safety** - Define request/response types for better IDE support

## API Resources (Response Transformers)

Resources control the shape of your API responses — like Laravel's `JsonResource`. They decouple your database schema from your API contract, and the **typed contract** is shared between server and frontend — define it once, use it everywhere.

### Creating a Resource

```bash
npx @beeblock/svelar make:resource User --module=auth
npx @beeblock/svelar make:resource User --module=auth --collection  # also creates UserCollectionResource
```

This creates `src/lib/modules/auth/UserResource.ts` with a typed API contract:

```typescript
import { Resource } from '@beeblock/svelar/routing';
import type { User } from './User.js';

// ── API Contract — define once, use on both server and frontend ──

export interface UserData {
  id: number;
  name: string;
  email: string;
  avatar_url: string;
  member_since: string;
  // Notice: password is NOT exposed
}

// ── Resource ──

export class UserResource extends Resource<User, UserData> {
  toJSON(): UserData {
    return {
      id: this.data.id,
      name: this.data.name,
      email: this.data.email,
      avatar_url: this.data.avatar,
      member_since: this.data.created_at,
    };
  }
}
```

### Contract Schemas — One Definition for Everything

Instead of defining types separately in resources, DTOs, validation, and frontend components, use a **contract schema** as the single source of truth. Zod schemas give you both validation and TypeScript types via `z.infer<>`.

```bash
npx @beeblock/svelar make:schema User --module=auth
```

This creates `src/lib/modules/auth/user.schema.ts`:

```typescript
import { z } from 'zod';

// ── Response schema (what the API returns) ──────────────────

export const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  avatar_url: z.string().nullable(),
  member_since: z.string(),
});

// ── Input schemas (what the API accepts) ────────────────────

export const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true });

// ── Inferred types — shared between server and frontend ─────

export type UserData = z.infer<typeof userSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
```

Now **every layer** imports from this one file:

**Resource** — uses the response type:

```typescript
import { Resource } from '@beeblock/svelar/routing';
import type { User } from './User.js';
import type { UserData } from './user.schema.js';

export class UserResource extends Resource<User, UserData> {
  toJSON(): UserData {
    return {
      id: this.data.id,
      name: this.data.name,
      email: this.data.email,
      avatar_url: this.data.avatar,
      member_since: this.data.created_at,
    };
  }
}
```

**FormRequest** — uses the input schema:

```typescript
import { FormRequest } from '@beeblock/svelar/routing';
import { createUserSchema } from './user.schema.js';

export class CreateUserRequest extends FormRequest {
  rules() {
    return createUserSchema;
  }
}
```

**Controller** — stays thin, no types needed:

```typescript
export class UserController extends Controller {
  async store(event: any) {
    const data = await CreateUserRequest.validate(event);
    // data is typed as CreateUserInput — autocomplete works
    const user = await User.create(data);
    return UserResource.make(user).toResponse();
  }
}
```

**Frontend** — imports the same types:

```typescript
import type { UserData, CreateUserInput } from '$lib/modules/auth/user.schema';
import { apiFetchJson } from '@beeblock/svelar/http';

// Response is typed
const { data } = await apiFetchJson<{ data: UserData }>('/api/users/1');
console.log(data?.name); // string — full autocomplete

// Form data is typed
let form: CreateUserInput = { name: '', email: '', password: '' };
```

**The full flow** — one schema drives the entire stack:

```
user.schema.ts (single source of truth)
    │
    ├── UserResource        → toJSON() returns UserData
    ├── CreateUserRequest   → validates against createUserSchema
    ├── UpdateUserRequest   → validates against updateUserSchema
    ├── UserController      → data typed as CreateUserInput / UpdateUserInput
    ├── +page.svelte        → form typed as CreateUserInput
    └── API consumers       → response typed as UserData
```

### Utility Types

For typed `apiFetchJson` calls, use the utility types:

```typescript
import type { ResourceData, ResourceCollection, InferResource } from '@beeblock/svelar/routing';
import type { UserResource } from '$lib/modules/auth/UserResource';

// Single: { data: UserData }
const user = await apiFetchJson<ResourceData<UserResource>>('/api/users/1');

// Collection with pagination: { data: UserData[], meta?: { total, page, ... } }
const users = await apiFetchJson<ResourceCollection<UserResource>>('/api/users?page=1');

// Extract the shape from any resource
type UserData = InferResource<UserResource>;
```

### Resource-Level Extra Data (`toWith` / `toAdditional`)

Override `toWith()` and `toAdditional()` in your resource class to include data automatically — no need to repeat it in every controller method.

- **`toWith()`** — top-level keys (roles, permissions, related context)
- **`toAdditional()`** — nested under `meta` (counts, flags, summaries)

Both can be sync or async.

```typescript
import { Resource } from '@beeblock/svelar/routing';
import type { User } from './User.js';

export class UserResource extends Resource<User> {
  toJSON() {
    return {
      id: this.data.id,
      name: this.data.name,
      email: this.data.email,
      avatar_url: this.data.avatar,
      member_since: this.data.created_at,
    };
  }

  // Automatically included at top level of every response
  async toWith() {
    return {
      roles: await this.data.getRoleNames(),
      permissions: await this.data.getAllPermissions(),
    };
  }
}
```

Now the controller stays thin:

```typescript
export class UserController extends Controller {
  async show(event: RequestEvent) {
    const user = await User.findOrFail(event.params.id);
    return UserResource.make(user).toResponse();
    // { data: { id, name, ... }, roles: [...], permissions: [...] }
  }
}
```

Another example — a `PostResource` with model-level permissions:

```typescript
export class PostResource extends Resource<Post> {
  toJSON() {
    return {
      id: this.data.id,
      title: this.data.title,
      slug: this.data.slug,
      published: this.data.published,
      author: this.data.author_name,
      created_at: this.data.created_at,
    };
  }

  // Tells the frontend what the current user can do with this post
  toWith() {
    return {
      can: {
        edit: this.data.user_id === this.data._currentUserId,
        delete: this.data.user_id === this.data._currentUserId,
        publish: this.data._currentUserRole === 'admin',
      },
    };
  }

  // Extra metadata
  toAdditional() {
    return {
      comments_count: this.data.comments_count ?? 0,
    };
  }
}
```

```json
{
  "data": {
    "id": 1,
    "title": "Getting Started with Svelar",
    "slug": "getting-started",
    "published": true,
    "author": "John Doe",
    "created_at": "2026-01-15T10:30:00Z"
  },
  "meta": {
    "comments_count": 12
  },
  "can": {
    "edit": true,
    "delete": true,
    "publish": false
  }
}
```

You can still override at the controller level with `.with()` or `.additional()` for one-off cases — they merge on top of what the resource defines:

```typescript
return UserResource.make(user)
  .with({ login_streak: 7 })          // merged with toWith()
  .additional({ cached: true })        // merged with toAdditional()
  .toResponse();
```

### Using Resources in Controllers

```typescript
import { UserResource } from './UserResource.js';

export class UserController extends Controller {
  // Single resource → { data: { id, name, email, ... } }
  async show(event: RequestEvent) {
    const user = await User.findOrFail(event.params.id);
    return UserResource.make(user).toResponse();
  }

  // Collection (no pagination) → { data: [{ id, ... }, ...] }
  async all(event: RequestEvent) {
    const users = await User.all();
    return UserResource.collection(users).toResponse();
  }

  // Paginated collection — pass the PaginationResult directly
  async index(event: RequestEvent) {
    const page = Number(event.url.searchParams.get('page') ?? 1);
    const result = await User.query().paginate(page, 20);
    return UserResource.paginate(result).toResponse();
  }
}
```

`paginate()` accepts the result from `Model.query().paginate()` and automatically includes `total`, `page`, `per_page`, `last_page`, and `has_more` in the response metadata. No manual `.additional()` needed.

### Response Format

```json
// Single: UserResource.make(user)
{
  "data": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "member_since": "2026-01-15T10:30:00Z"
  }
}

// Paginated: UserResource.paginate(result)
{
  "data": [
    { "id": 1, "name": "John Doe", ... },
    { "id": 2, "name": "Jane Doe", ... }
  ],
  "meta": {
    "total": 42,
    "page": 1,
    "per_page": 20,
    "last_page": 3,
    "has_more": true
  }
}

// Collection (no pagination): UserResource.collection(users)
{
  "data": [
    { "id": 1, "name": "John Doe", ... },
    { "id": 2, "name": "Jane Doe", ... }
  ]
}
```

You can still add extra metadata on top of pagination if needed:

```typescript
return UserResource.paginate(result)
  .additional({ filters: { role: 'admin' } })
  .toResponse();
```

### Resource Options

```typescript
// Custom status code
UserResource.make(user).status(201).toResponse();

// Custom headers
UserResource.make(user).headers({ 'X-Request-Id': '...' }).toResponse();

// Remove the "data" wrapper
UserResource.make(user).wrapper(null).toResponse();
// → { "id": 1, "name": "John Doe", ... }

// Plain object (for testing or further processing)
const obj = UserResource.make(user).toObject();
```

### Adding Extra Data with `.with()`

Use `.with()` to include top-level data alongside the resource — roles, permissions, computed summaries, or any related context that doesn't belong in the resource's `toJSON()` or in `meta`.

```typescript
// Single resource with roles and permissions
return UserResource.make(user)
  .with({
    roles: await user.getRoleNames(),
    permissions: await user.getAllPermissions(),
  })
  .toResponse();
```

```json
{
  "data": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com"
  },
  "roles": ["admin", "editor"],
  "permissions": ["users.create", "users.delete", "posts.publish"]
}
```

Works on collections and paginated results too:

```typescript
// Paginated users with available roles for the dropdown
return UserResource.paginate(result)
  .with({ available_roles: await Role.pluck('name') })
  .toResponse();
```

```json
{
  "data": [{ "id": 1, ... }, { "id": 2, ... }],
  "meta": { "total": 42, "page": 1, "per_page": 20, "last_page": 3, "has_more": true },
  "available_roles": ["admin", "editor", "viewer"]
}
```

`.with()` vs `.additional()`:

| Method | Placement | Use for |
|--------|-----------|---------|
| `.with()` | Top-level keys | Roles, permissions, related context, config |
| `.additional()` | Inside `meta` | Pagination, totals, filters, query info |

## Response Objects

Beyond the controller helper methods (`this.json()`, `this.redirect()`, etc.), Svelar provides dedicated response classes. These are standalone objects you can use anywhere — in controllers, middleware, services, or event listeners.

```typescript
import {
  JsonResponse,
  RedirectResponse,
  DownloadResponse,
  StreamedResponse,
} from '@beeblock/svelar/routing';
```

### JsonResponse

```typescript
// Basic usage
return new JsonResponse({ name: 'John' }).toResponse();
return new JsonResponse({ id: 1 }, 201).toResponse();

// Fluent API
return new JsonResponse({ users })
  .status(200)
  .header('X-Request-Id', requestId)
  .toResponse();

// Static factories (return Response directly)
return JsonResponse.success({ id: 1, name: 'John' });
return JsonResponse.created({ id: 1, name: 'John' });
return JsonResponse.error('Not found', 404);
return JsonResponse.validationError({ email: ['Email is required'] });
return JsonResponse.noContent();
```

### RedirectResponse

```typescript
// Basic usage
return new RedirectResponse('/dashboard').toResponse();
return new RedirectResponse('/login', 301).toResponse();

// Static factories
return RedirectResponse.to('/dashboard');           // 302 temporary
return RedirectResponse.permanent('/new-url');      // 301 permanent
return RedirectResponse.temporary('/maintenance');  // 307 preserves method

// Redirect back to referrer (with fallback)
return RedirectResponse.back(event.request, '/');
```

### DownloadResponse

```typescript
// Download a file
const pdf = await generateReport();
return new DownloadResponse(pdf, 'report.pdf').toResponse();

// With explicit content type
return new DownloadResponse(buffer, 'data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  .toResponse();

// Static factories
return DownloadResponse.make(buffer, 'image.png');
return DownloadResponse.json(data, 'export.json');     // Download JSON as file
return DownloadResponse.csv(csvString, 'users.csv');   // Download CSV
```

### StreamedResponse

```typescript
// SSE (Server-Sent Events) from an async generator
return StreamedResponse.sse(async function* () {
  for (let i = 0; i < 10; i++) {
    yield { event: 'progress', data: { percent: i * 10 } };
    await new Promise((r) => setTimeout(r, 500));
  }
  yield { event: 'complete', data: { percent: 100 } };
});

// Named events with IDs
return StreamedResponse.sse(async function* () {
  yield { id: '1', event: 'user.joined', data: { name: 'Alice' } };
  yield { id: '2', event: 'message', data: 'Hello everyone' };
});

// Raw stream with custom content type
return new StreamedResponse(readableStream, 'application/octet-stream')
  .header('X-Stream-Id', streamId)
  .toResponse();

// Text stream
return StreamedResponse.text(readableStream);
```

### Using Response Objects in Controllers

Response objects work seamlessly alongside controller helpers:

```typescript
import { JsonResponse, DownloadResponse, StreamedResponse } from '@beeblock/svelar/routing';

export class ReportController extends Controller {
  async export(event: any) {
    const format = event.url.searchParams.get('format');
    const data = await ReportService.generate();

    switch (format) {
      case 'csv':
        return DownloadResponse.csv(data.toCsv(), 'report.csv');
      case 'json':
        return DownloadResponse.json(data, 'report.json');
      default:
        return this.json(data);
    }
  }

  async stream(event: any) {
    return StreamedResponse.sse(async function* () {
      const rows = await ReportService.streamRows();
      for await (const row of rows) {
        yield { event: 'row', data: row };
      }
    });
  }
}
```

### Using Response Objects in Middleware

```typescript
import { JsonResponse, RedirectResponse } from '@beeblock/svelar/routing';
import { Middleware } from '@beeblock/svelar/middleware';

export class RequireApiKeyMiddleware extends Middleware {
  async handle(ctx: any, next: () => Promise<any>) {
    const apiKey = ctx.event.request.headers.get('X-Api-Key');

    if (!apiKey) {
      return JsonResponse.error('API key required', 401);
    }

    return next();
  }
}

export class MaintenanceMiddleware extends Middleware {
  async handle(ctx: any, next: () => Promise<any>) {
    if (isMaintenanceMode()) {
      return RedirectResponse.temporary('/maintenance');
    }
    return next();
  }
}
```

### Resources vs Response Objects

| Feature | Resources | Response Objects |
|---------|-----------|----------------|
| **Purpose** | Shape model data for API responses | General HTTP response building |
| **Best for** | Model → API contract mapping | Downloads, redirects, streams, error responses |
| **Wrapping** | Auto-wraps in `{ data: ... }` | Raw control over body |
| **Collections** | Built-in `.collection()` with metadata | N/A — use Resources for collections |
| **Fluent API** | `.additional()`, `.wrapper()`, `.status()` | `.header()`, `.status()` |
| **Static factories** | `.make()`, `.collection()` | `.success()`, `.error()`, `.created()`, etc. |

Use **Resources** when transforming models into API responses. Use **Response Objects** for everything else (file downloads, redirects, SSE streams, error responses from middleware).

## Next Steps

- Learn [Validation & DTOs](./05-validation-dtos.md) to validate controller inputs
- Explore [Services & Actions](./08-services-actions-repositories.md) for business logic
- Check [Authentication](./06-authentication.md) to protect routes

---

**Svelar Controllers & Routing Guide** © 2026
