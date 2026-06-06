# Controllers, Resources, FormRequest & Responses

Full docs: https://svelar.dev/docs/controllers-routing

## Table of Contents
- [Controller Base Class](#controller-base-class)
- [Route Binding](#route-binding)
- [Response Classes](#response-classes)
- [API Resources](#api-resources)
- [FormRequest](#formrequest)

## Controller Base Class

Import: `import { Controller } from '@beeblock/svelar/routing';`

### Methods

**Response helpers:**
```typescript
this.json(data, status?, headers?)     // JSON response
this.text(content, status?)            // Plain text
this.html(content, status?)            // HTML
this.redirect(url, status?)            // Redirect (default 302)
this.noContent()                       // 204
this.created(data?)                    // 201 + JSON
```

**Validation:**
```typescript
await this.validate(event, zodSchema)       // body validation
this.validateQuery(event, zodSchema)        // query params
this.validateParams(event, zodSchema)       // URL params
```

**Middleware (in constructor):**
```typescript
constructor() {
  super();
  this.middleware(MiddlewareInstance);
  this.middleware(MiddlewareInstance, { only: ['store', 'update'] });
  this.middleware(MiddlewareInstance, { except: ['index', 'show'] });
}
```

### Complete Example
```typescript
import { Controller } from '@beeblock/svelar/routing';
import { RequireAuthMiddleware, GateMiddleware } from '@beeblock/svelar/auth';
import { z } from '@beeblock/svelar/validation';

export class PostController extends Controller {
  constructor() {
    super();
    this.middleware(new RequireAuthMiddleware());
    this.middleware(
      new GateMiddleware('update-post', (ctx) => Post.find(ctx.params.id)),
      { only: ['update', 'destroy'] }
    );
  }

  async index(event) {
    const posts = await Post.with('author').latest().paginate(
      Number(event.url.searchParams.get('page') ?? 1),
      20
    );
    return this.json(posts);
  }

  async show(event) {
    const post = await Post.with('author', 'comments').findOrFail(event.params.id);
    return this.json(post);
  }

  async store(event) {
    const data = await this.validate(event, {
      title: z.string().min(5).max(200),
      content: z.string().min(10),
    });
    const post = await Post.create({ ...data, user_id: event.locals.user.id });
    return this.created(post);
  }

  async update(event) {
    const data = await this.validate(event, {
      title: z.string().min(5).optional(),
      content: z.string().min(10).optional(),
    });
    const post = await Post.findOrFail(event.params.id);
    await post.update(data);
    return this.json(post);
  }

  async destroy(event) {
    const post = await Post.findOrFail(event.params.id);
    await post.delete();
    return this.noContent();
  }
}
```

## Route Binding

### Manual binding
```typescript
// src/routes/api/posts/+server.ts
import { PostController } from '$lib/controllers/PostController';
const ctrl = new PostController();
export const GET = ctrl.handle('index');
export const POST = ctrl.handle('store');

// src/routes/api/posts/[id]/+server.ts
export const GET = ctrl.handle('show');
export const PUT = ctrl.handle('update');
export const DELETE = ctrl.handle('destroy');
```

### Resource helper
```typescript
import { resource } from '@beeblock/svelar/routing';
import { PostController } from '$lib/controllers/PostController';

// src/routes/api/posts/+server.ts
export const { GET, POST } = resource(PostController);

// src/routes/api/posts/[id]/+server.ts
export const { GET, PUT, DELETE } = resource(PostController, true);
```

## Response Classes

Import: `import { JsonResponse, RedirectResponse, DownloadResponse, StreamedResponse } from '@beeblock/svelar/routing';`

### JsonResponse
```typescript
JsonResponse.success(data)                          // 200
JsonResponse.created(data)                          // 201
JsonResponse.error('Not found', 404)                // error
JsonResponse.validationError(errors)                // 422
JsonResponse.noContent()                            // 204

// Fluent
new JsonResponse(data)
  .status(200)
  .header('X-Custom', 'value')
  .toResponse();
```

### DownloadResponse
```typescript
DownloadResponse.make(buffer, 'report.pdf', 'application/pdf')
DownloadResponse.json(data, 'export.json')
DownloadResponse.csv(csvString, 'users.csv')
```

### StreamedResponse (SSE)
```typescript
StreamedResponse.sse(async function* () {
  yield { event: 'update', data: JSON.stringify({ progress: 50 }) };
  yield { event: 'done', data: JSON.stringify({ result: 'ok' }) };
});
```

## API Resources

Import: `import { Resource } from '@beeblock/svelar/routing';`

Transform models into consistent API responses:

```typescript
interface UserData {
  id: number;
  name: string;
  email: string;
  role: string;
}

class UserResource extends Resource<User, UserData> {
  toJSON(): UserData {
    return {
      id: this.data.id,
      name: this.data.name,
      email: this.data.email,
      role: this.data.role,
    };
  }

  async toWith() {
    return { permissions: await this.data.getAllPermissions() };
  }

  toAdditional() {
    return { timestamp: new Date().toISOString() };
  }
}

// Single item: { data: UserData, permissions: [...], timestamp: '...' }
return UserResource.make(user).toResponse();

// Collection: { data: UserData[], timestamp: '...' }
return UserResource.collection(users).toResponse();

// Paginated: { data: UserData[], meta: { total, page, per_page, last_page, has_more } }
return UserResource.paginate(paginationResult).toResponse();

// With extra metadata
return UserResource.collection(users)
  .additional({ count: users.length })
  .status(200)
  .headers({ 'X-Total': String(users.length) })
  .toResponse();
```

## FormRequest

Import: `import { FormRequest } from '@beeblock/svelar/forms';`

Dedicated validation classes with authorization:

```typescript
class UpdateUserRequest extends FormRequest {
  rules() {
    return z.object({
      name: z.string().min(2).max(100).optional(),
      email: z.string().email().optional(),
      avatar: z.string().url().optional(),
    });
  }

  authorize(event) {
    // Return true/false for authorization
    const user = event.locals.user;
    const targetId = event.params.id;
    return user && (user.id === Number(targetId) || user.role === 'admin');
  }

  messages() {
    return {
      'name.min': 'Name must be at least 2 characters',
      'email.email': 'Invalid email address',
    };
  }

  attributes() {
    return { avatar: 'profile picture' };
  }

  passedValidation(data) {
    // Transform after validation
    if (data.email) data.email = data.email.toLowerCase();
    return data;
  }
}

// Usage in controller
async update(event) {
  const data = await UpdateUserRequest.validate(event);
  // data is validated + authorized + transformed
}
```

### Error Responses
- `FormValidationError` (422): `{ message, errors: { field: ['message'] } }`
- `FormAuthorizationError` (403): `{ message: 'Unauthorized' }`
