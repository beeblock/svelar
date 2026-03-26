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
import { Controller } from 'svelar/routing';

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

## Complete Controller Example

Here's a complete authentication controller from the svelar-example app:

```typescript
// src/lib/controllers/AuthController.ts
import { Controller } from 'svelar/routing';
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
import { Controller } from 'svelar/routing';
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
import { Controller, ValidationError, NotFoundError, UnauthorizedError, ForbiddenError } from 'svelar/routing';

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

## Next Steps

- Learn [Validation & DTOs](./05-validation-dtos.md) to validate controller inputs
- Explore [Services & Actions](./08-services-actions-repositories.md) for business logic
- Check [Authentication](./06-authentication.md) to protect routes

---

**Svelar Controllers & Routing Guide** © 2026
