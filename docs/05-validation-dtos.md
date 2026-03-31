# Validation & DTOs

Learn how to validate incoming data with FormRequest classes, Zod schemas, and contract schemas that share types across your entire stack.

## Contract Schemas — Single Source of Truth

Instead of defining Zod schemas inline in FormRequests and types separately on the frontend, define them once in a **contract schema** file. Every layer imports from it.

```bash
npx svelar make:schema Post --module=posts
```

This creates `src/lib/modules/posts/post.schema.ts`:

```typescript
import { z } from 'zod';

// ── Response schema (what the API returns) ──────────────────

export const postSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  body: z.string(),
  published: z.boolean(),
  author: z.string(),
  created_at: z.string(),
});

// ── Input schemas (what the API accepts) ────────────────────

export const createPostSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  body: z.string().min(10, 'Body must be at least 10 characters'),
  published: z.boolean().optional().default(false),
});

export const updatePostSchema = createPostSchema.partial();

// ── Inferred types — shared between server and frontend ─────

export type PostData = z.infer<typeof postSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
```

Now every layer imports from this one file — zero type duplication:

| Layer | Imports | Uses |
|-------|---------|------|
| **FormRequest** | `createPostSchema` | Validation rules |
| **Resource** | `PostData` | `Resource<Post, PostData>` output shape |
| **Controller** | nothing extra | data typed automatically |
| **Frontend** | `PostData`, `CreatePostInput` | Type-safe forms and responses |

## FormRequest Classes (DTOs)

FormRequest classes encapsulate validation logic and authorization checks. They import their schema from the contract file.

### Creating a FormRequest

```bash
npx svelar make:request CreatePost --module=posts
```

Wire it to the contract schema:

```typescript
// src/lib/modules/posts/CreatePostRequest.ts
import { FormRequest } from '@beeblock/svelar/routing';
import { createPostSchema } from './post.schema.js';

export class CreatePostRequest extends FormRequest {
  rules() {
    return createPostSchema;
  }

  authorize(event: any): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: any) {
    if (!data.slug) {
      data.slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    return data;
  }
}
```

The update request reuses the same schema with `.partial()`:

```typescript
// src/lib/modules/posts/UpdatePostRequest.ts
import { FormRequest } from '@beeblock/svelar/routing';
import { updatePostSchema } from './post.schema.js';

export class UpdatePostRequest extends FormRequest {
  rules() {
    return updatePostSchema;
  }

  async authorize(event: any): Promise<boolean> {
    const post = await Post.find(event.params.id);
    return post?.user_id === event.locals.user?.id;
  }
}
```

### Using FormRequest in Controllers

```typescript
import { CreatePostRequest } from './CreatePostRequest.js';
import { PostResource } from './PostResource.js';

export class PostController extends Controller {
  async store(event: any) {
    // Validate and authorize — throws 422 or 403 on failure
    // data is typed as CreatePostInput
    const data = await CreatePostRequest.validate(event);

    const post = await Post.create({
      ...data,
      user_id: event.locals.user.id,
    });

    return PostResource.make(post).status(201).toResponse();
  }
}
```

### Using Types on the Frontend

```typescript
// +page.svelte or any client component
import type { PostData, CreatePostInput } from '$lib/modules/posts/post.schema';
import { apiFetchJson } from '@beeblock/svelar/http';

// Form data is typed — IDE catches missing fields
let form: CreatePostInput = {
  title: '',
  body: '',
  published: false,
};

// Response is typed — autocomplete on data.title, data.slug, etc.
const { data } = await apiFetchJson<{ data: PostData }>('/api/posts', {
  method: 'POST',
  body: JSON.stringify(form),
});
```

## FormRequest Methods

### rules()

Define Zod schema for validation. Prefer importing from a contract schema file:

```typescript
// Recommended — import from contract schema
import { createUserSchema } from './user.schema.js';

rules() {
  return createUserSchema;
}
```

Or define inline for simple cases:

```typescript
rules() {
  return z.object({
    email: z.string().email(),
    password: z.string().min(8),
    password_confirmation: z.string(),
  }).refine((data) => data.password === data.password_confirmation, {
    message: 'Passwords do not match',
    path: ['password_confirmation'],
  });
}
```

### messages()

Custom error messages for validation rules:

```typescript
messages() {
  return {
    'email.invalid': 'Please enter a valid email address',
    'password.too_small': 'Password must be at least 8 characters',
  };
}
```

### Localized Validation Messages

There are two approaches to localize validation messages with Paraglide.

**Approach 1: In the contract schema** (recommended — messages live with the schema):

```typescript
// src/lib/modules/auth/user.schema.ts
import { z } from 'zod';
import * as m from '$lib/paraglide/messages';

export const registerSchema = z.object({
  name: z.string().min(2, m.validation_name_min()),
  email: z.string().email(m.validation_email_invalid()),
  password: z.string().min(8, m.validation_password_min()),
  password_confirmation: z.string(),
}).refine((data) => data.password === data.password_confirmation, {
  message: m.validation_passwords_must_match(),
  path: ['password_confirmation'],
});
```

```json
// messages/en.json
{
  "validation_name_min": "Name must be at least 2 characters",
  "validation_email_invalid": "Please enter a valid email address",
  "validation_password_min": "Password must be at least 8 characters",
  "validation_passwords_must_match": "Passwords do not match"
}

// messages/es.json
{
  "validation_name_min": "El nombre debe tener al menos 2 caracteres",
  "validation_email_invalid": "Ingrese una direccion de correo valida",
  "validation_password_min": "La contrasena debe tener al menos 8 caracteres",
  "validation_passwords_must_match": "Las contrasenas no coinciden"
}

// messages/pt.json
{
  "validation_name_min": "O nome deve ter pelo menos 2 caracteres",
  "validation_email_invalid": "Insira um endereco de email valido",
  "validation_password_min": "A senha deve ter pelo menos 8 caracteres",
  "validation_passwords_must_match": "As senhas nao coincidem"
}
```

The FormRequest just imports the schema — messages are already localized:

```typescript
import { registerSchema } from './user.schema.js';

export class RegisterRequest extends FormRequest {
  rules() {
    return registerSchema;
  }
}
```

**Approach 2: In the `messages()` override** (useful when the schema is shared/generic):

```typescript
import * as m from '$lib/paraglide/messages';

export class RegisterRequest extends FormRequest {
  rules() {
    return registerSchema; // schema with English defaults
  }

  messages() {
    return {
      'name.too_small': m.validation_name_min(),
      'email.invalid_string': m.validation_email_invalid(),
      'password.too_small': m.validation_password_min(),
      'password_confirmation': m.validation_passwords_must_match(),
    };
  }
}
```

### Localized Messages with Parameters

Paraglide messages support parameters for dynamic values:

```json
// messages/en.json
{
  "validation_min_length": "{field} must be at least {min} characters",
  "validation_max_length": "{field} must not exceed {max} characters"
}
```

```typescript
import * as m from '$lib/paraglide/messages';

export const createPostSchema = z.object({
  title: z.string()
    .min(3, m.validation_min_length({ field: m.field_title(), min: '3' }))
    .max(255, m.validation_max_length({ field: m.field_title(), max: '255' })),
  body: z.string()
    .min(10, m.validation_min_length({ field: m.field_body(), min: '10' })),
});
```

The API returns localized field errors based on the user's detected locale:

```json
// Response for Spanish user submitting invalid data
{
  "message": "Validation failed",
  "errors": {
    "title": ["Titulo debe tener al menos 3 caracteres"],
    "body": ["Contenido debe tener al menos 10 caracteres"]
  }
}
```

### authorize()

Check if user is authorized to make this request. Return false to throw FormAuthorizationError (403):

```typescript
authorize(event: any): boolean {
  // Only the user themselves can update their profile
  return event.params.id === event.locals.user?.id;
}
```

### passedValidation()

Transform data after successful validation:

```typescript
passedValidation(data: any) {
  // Slugify title if not provided
  if (!data.slug) {
    data.slug = data.title.toLowerCase().replace(/\s+/g, '-');
  }

  // Trim whitespace
  data.name = data.name?.trim();

  // Hash password
  data.password = await Hash.make(data.password);

  return data;
}
```

## Complete Examples with Contract Schemas

### Auth Module

```typescript
// src/lib/modules/auth/user.schema.ts
import { z } from 'zod';

export const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  created_at: z.string(),
});

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  password_confirmation: z.string(),
}).refine((data) => data.password === data.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
});

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type UserData = z.infer<typeof userSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
```

```typescript
// src/lib/modules/auth/RegisterRequest.ts
import { FormRequest } from '@beeblock/svelar/routing';
import { registerSchema } from './user.schema.js';

export class RegisterRequest extends FormRequest {
  rules() {
    return registerSchema;
  }
}
```

```typescript
// src/lib/modules/auth/LoginRequest.ts
import { FormRequest } from '@beeblock/svelar/routing';
import { loginSchema } from './user.schema.js';

export class LoginRequest extends FormRequest {
  rules() {
    return loginSchema;
  }
}
```

```typescript
// Frontend — register form
import type { RegisterInput } from '$lib/modules/auth/user.schema';

let form: RegisterInput = {
  name: '',
  email: '',
  password: '',
  password_confirmation: '',
};
```

### Posts Module

```typescript
// src/lib/modules/posts/post.schema.ts
import { z } from 'zod';

export const postSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  body: z.string(),
  published: z.boolean(),
  author: z.string(),
  created_at: z.string(),
});

export const createPostSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  body: z.string().min(10, 'Body must be at least 10 characters'),
  published: z.boolean().optional().default(false),
});

export const updatePostSchema = createPostSchema.partial();

export type PostData = z.infer<typeof postSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
```

```typescript
// src/lib/modules/posts/CreatePostRequest.ts
import { FormRequest } from '@beeblock/svelar/routing';
import { createPostSchema } from './post.schema.js';

export class CreatePostRequest extends FormRequest {
  rules() {
    return createPostSchema;
  }

  authorize(event: any): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: any) {
    if (!data.slug) {
      data.slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    return data;
  }
}
```

```typescript
// src/lib/modules/posts/UpdatePostRequest.ts
import { FormRequest } from '@beeblock/svelar/routing';
import { updatePostSchema } from './post.schema.js';

export class UpdatePostRequest extends FormRequest {
  rules() {
    return updatePostSchema;
  }

  async authorize(event: any): Promise<boolean> {
    const post = await Post.find(event.params.id);
    return post?.user_id === event.locals.user?.id;
  }
}
```

```typescript
// src/lib/modules/posts/PostResource.ts
import { Resource } from '@beeblock/svelar/routing';
import type { Post } from './Post.js';
import type { PostData } from './post.schema.js';

export class PostResource extends Resource<Post, PostData> {
  toJSON(): PostData {
    return {
      id: this.data.id,
      title: this.data.title,
      slug: this.data.slug,
      body: this.data.body,
      published: this.data.published,
      author: this.data.author_name,
      created_at: this.data.created_at,
    };
  }
}
```

```typescript
// src/lib/modules/posts/PostController.ts — thin controller
import { Controller } from '@beeblock/svelar/routing';
import { CreatePostRequest } from './CreatePostRequest.js';
import { UpdatePostRequest } from './UpdatePostRequest.js';
import { PostResource } from './PostResource.js';

export class PostController extends Controller {
  async index(event: any) {
    const page = Number(event.url.searchParams.get('page') ?? 1);
    const result = await Post.query().paginate(page, 20);
    return PostResource.paginate(result).toResponse();
  }

  async show(event: any) {
    const post = await Post.findOrFail(event.params.id);
    return PostResource.make(post).toResponse();
  }

  async store(event: any) {
    const data = await CreatePostRequest.validate(event);
    const post = await Post.create({ ...data, user_id: event.locals.user.id });
    return PostResource.make(post).status(201).toResponse();
  }

  async update(event: any) {
    const data = await UpdatePostRequest.validate(event);
    const post = await Post.findOrFail(event.params.id);
    await post.update(data);
    return PostResource.make(post).toResponse();
  }
}
```

The entire module's type contract lives in `post.schema.ts`. Change it once, TypeScript catches mismatches everywhere — controller, resource, FormRequests, and frontend.

## Zod Validation Schema

Svelar uses Zod for schema validation. Here are common validation rules:

### Strings

```typescript
z.string()                    // String type
  .min(2)                     // Minimum length
  .max(255)                   // Maximum length
  .email()                    // Valid email
  .url()                      // Valid URL
  .regex(/^[a-z]+$/)          // Regex pattern
  .includes('hello')          // Must contain substring
  .startsWith('https://')     // Must start with
  .toLowerCase()              // Transform to lowercase
  .optional()                 // Optional (can be undefined)
  .default('value')           // Default value
  .nullable()                 // Can be null
```

### Numbers

```typescript
z.number()
  .min(0)                     // Minimum value
  .max(100)                   // Maximum value
  .int()                      // Integer only
  .positive()                 // Must be > 0
  .negative()                 // Must be < 0
  .multipleOf(5)              // Must be multiple of 5
  .optional()
  .default(0)
```

### Booleans

```typescript
z.boolean()
  .optional()
  .default(false)
```

### Arrays

```typescript
z.array(z.string())           // Array of strings
  .min(1)                     // At least 1 item
  .max(10)                    // At most 10 items
  .default([])
```

### Objects

```typescript
z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
})
```

### Unions

```typescript
z.union([z.string(), z.number()])  // String or number
```

### Custom Validation

```typescript
z.string()
  .refine((val) => val.length > 3, { message: 'Too short' })

// Cross-field validation
z.object({
  password: z.string().min(8),
  password_confirmation: z.string(),
}).refine((data) => data.password === data.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
})
```

## Inline Validation in Controllers

For simple cases, you can validate directly in the controller using the `validate` helper:

```typescript
import { validate, z } from '@beeblock/svelar/validation';

export class PostController extends Controller {
  async store(event: any) {
    const body = await event.request.json();

    const schema = z.object({
      title: z.string().min(3),
      body: z.string().min(10),
    });

    const result = validate(schema, body);

    if (!result.success) {
      return this.json({ errors: result.errors }, 422);
    }

    return this.created(await Post.create(result.data));
  }
}
```

> **Note**: `validate(schema, data)` is synchronous and returns `{ success: true, data }` or `{ success: false, errors }`. The `errors` object has field names as keys and arrays of error messages as values.

## Laravel-like Validation Rules

Svelar provides a `rules` helper with named validators that map to common Laravel validation rules. These are convenience wrappers around Zod:

```typescript
import { rules, z } from '@beeblock/svelar/validation';

const schema = z.object({
  name:     rules.required(),                     // z.string().min(1)
  email:    rules.email(),                        // z.string().email()
  age:      rules.integer(),                      // z.number().int()
  bio:      rules.string(10, 500),                // z.string().min(10).max(500)
  score:    rules.number(0, 100),                 // z.number().min(0).max(100)
  price:    rules.between(1, 999),                // z.number().min(1).max(999)
  active:   rules.boolean(),                      // z.boolean()
  birthday: rules.date(),                         // z.coerce.date()
  website:  rules.url(),                          // z.string().url()
  token:    rules.uuid(),                         // z.string().uuid()
  role:     rules.enum(['admin', 'user']),         // z.enum(['admin', 'user'])
  tags:     rules.array(z.string()),              // z.array(z.string())
  phone:    rules.nullable(z.string()),           // z.string().nullable()
  nickname: rules.optional(z.string()),           // z.string().optional()
  slug:     rules.regex(/^[a-z0-9-]+$/),          // z.string().regex(...)
  ip:       rules.ip(),                           // IPv4 validation
  config:   rules.json(),                         // valid JSON string
  min_age:  rules.min(18),                        // z.number().min(18)
  max_size: rules.max(1024),                      // z.number().max(1024)
});
```

### Password Confirmation

```typescript
// Validates that password and password_confirmation match
const passwordSchema = rules.confirmed('password');
// Equivalent to z.object({ password, password_confirmation }).refine(match)
```

The `rules` helper is entirely optional — you can always use Zod directly. It's provided for developers familiar with Laravel's named validation rules.

## Validation Error Responses

When validation fails, a `FormValidationError` is thrown automatically. The error response looks like:

```json
{
  "message": "Validation failed",
  "errors": {
    "email": ["Email is required", "Must be a valid email"],
    "password": ["Password must be at least 8 characters"]
  }
}
```

Status code is 422 (Unprocessable Entity).

## Authorization Error Responses

When `authorize()` returns false, a `FormAuthorizationError` is thrown:

```json
{
  "message": "Unauthorized",
  "status": 403
}
```

Status code is 403 (Forbidden).

## Full Stack Flow

Here's the complete flow from route to frontend using a contract schema:

```
post.schema.ts  →  CreatePostRequest  →  PostController  →  PostResource  →  Frontend
  (contract)         (validation)          (thin)            (response)       (typed)
```

```typescript
// 1. Contract — src/lib/modules/posts/post.schema.ts
export const createPostSchema = z.object({
  title: z.string().min(3).max(255),
  body: z.string().min(10),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type PostData = z.infer<typeof postSchema>;

// 2. FormRequest — src/lib/modules/posts/CreatePostRequest.ts
export class CreatePostRequest extends FormRequest {
  rules() { return createPostSchema; }
  authorize(event: any) { return !!event.locals.user; }
}

// 3. Resource — src/lib/modules/posts/PostResource.ts
export class PostResource extends Resource<Post, PostData> {
  toJSON(): PostData { return { id: this.data.id, title: this.data.title, ... }; }
}

// 4. Controller — src/lib/modules/posts/PostController.ts
export class PostController extends Controller {
  async store(event: any) {
    const data = await CreatePostRequest.validate(event); // typed as CreatePostInput
    const post = await Post.create({ ...data, user_id: event.locals.user.id });
    return PostResource.make(post).status(201).toResponse();
  }
}

// 5. Route — src/routes/api/posts/+server.ts
const ctrl = new PostController();
export const POST = ctrl.handle('store');

// 6. Frontend — src/routes/posts/new/+page.svelte
import type { CreatePostInput, PostData } from '$lib/modules/posts/post.schema';
let form: CreatePostInput = { title: '', body: '' };
const { data } = await apiFetchJson<{ data: PostData }>('/api/posts', {
  method: 'POST',
  body: JSON.stringify(form),
});
```

## Best Practices

1. **Use contract schemas** — Define Zod schemas + types once in `*.schema.ts`, import everywhere
2. **Use FormRequest for API requests** — Encapsulates validation and authorization
3. **Import schemas, don't inline them** — `rules() { return createPostSchema; }` not `rules() { return z.object({...}); }`
4. **Provide helpful error messages** — Define them in the schema: `z.string().min(2, 'Too short')`
5. **Validate authorization in `authorize()`** — Keeps auth logic in one place
6. **Transform data in `passedValidation()`** — Hash passwords, slugify fields, etc.
7. **Keep controllers thin** — Validate with FormRequest, respond with Resource, logic in Services/Actions
8. **Share types with the frontend** — `import type { PostData } from '$lib/modules/posts/post.schema'`

## Next Steps

- Learn [Controllers & Routing](./04-controllers-routing.md) to use validation in handlers
- Explore [Services & Actions](./08-services-actions-repositories.md) for business logic
- Check [Models & ORM](./03-models-orm.md) to work with validated data

---

**Svelar Validation & DTOs Guide** © 2026
