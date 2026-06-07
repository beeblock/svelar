# Validation & DTOs

Learn how to validate incoming data with FormRequest classes, Zod or Valibot schemas, and contract schemas that share types across your entire stack.

## Choosing a Validation Library

`npx svelar new` asks which validation library to scaffold with. In non-interactive environments it defaults to Zod. You can make the choice explicit:

```bash
npx svelar new my-app --validation=zod
npx svelar new my-app --validation=valibot
```

The choice is stored in `svelar.validation.json`. Generators such as `make:schema`, `make:request`, `make:action --schema`, and `make:entity` read that file so new artifacts stay consistent with the app. FormRequest, controller body validation, and the forms helpers support both providers.

## Contract Schemas — Single Source of Truth

Instead of defining validation schemas inline in FormRequests and types separately on the frontend, define them once in a **contract schema** file. Every layer imports from it.

```bash
npx svelar make:schema Post --module=posts
```

This creates `src/lib/modules/posts/contracts/schemas/post.schema.ts`:

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
| **DTO** | `CreatePostInput` | Validated service/action payload |
| **Resource** | `PostData` | `Resource<Post, PostData>` output shape |
| **Controller** | nothing extra | data typed automatically |
| **Frontend** | `PostData`, `CreatePostInput` | Type-safe forms and responses |

## FormRequest Classes

FormRequest classes encapsulate validation logic and authorization checks. They import their schema from the contract file. A FormRequest is not the DTO itself; it is the request boundary that validates input and can return a DTO from `passedValidation()`.

## DTO Classes

DTOs carry validated data into services and actions. Services should accept DTOs instead of raw `FormData`, request bodies, or unvalidated objects.

```typescript
// src/lib/modules/posts/application/dto/CreatePostDto.ts
import type { CreatePostInput } from '../../contracts/schemas/post.schema.js';

export class CreatePostDto {
  constructor(
    public readonly title: string,
    public readonly slug: string | undefined,
    public readonly body: string,
    public readonly published: boolean
  ) {}

  static from(input: CreatePostInput): CreatePostDto {
    return new CreatePostDto(input.title, input.slug, input.body, input.published ?? false);
  }
}
```

### Creating a FormRequest

```bash
npx svelar make:request CreatePost --module=posts
```

Wire it to the contract schema:

```typescript
// src/lib/modules/posts/interface/http/requests/CreatePostRequest.ts
import { FormRequest } from '@beeblock/svelar/forms';
import { CreatePostDto } from '../../../application/dto/CreatePostDto.js';
import { createPostSchema } from '../../../contracts/schemas/post.schema.js';

export class CreatePostRequest extends FormRequest {
  rules() {
    return createPostSchema;
  }

  authorize(event: any): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: any): CreatePostDto {
    if (!data.slug) {
      data.slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    return CreatePostDto.from(data);
  }
}
```

The update request reuses the same schema with `.partial()`:

```typescript
// src/lib/modules/posts/interface/http/requests/UpdatePostRequest.ts
import { FormRequest } from '@beeblock/svelar/forms';
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
    // data is a CreatePostDto returned by passedValidation()
    const data = await CreatePostRequest.validate(event);

    const post = await postService.create(data, event.locals.user.id);

    return PostResource.make(post).status(201).toResponse();
  }
}
```

### Using Types on the Frontend

```typescript
// +page.svelte or any client component
import type { PostData, CreatePostInput } from '$lib/modules/posts/contracts/schemas/post.schema';
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
// src/lib/modules/auth/contracts/schemas/user.schema.ts
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
// src/lib/modules/auth/contracts/schemas/user.schema.ts
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
// src/lib/modules/auth/interface/http/requests/RegisterRequest.ts
import { FormRequest } from '@beeblock/svelar/forms';
import { registerSchema } from './user.schema.js';

export class RegisterRequest extends FormRequest {
  rules() {
    return registerSchema;
  }
}
```

```typescript
// src/lib/modules/auth/interface/http/requests/LoginRequest.ts
import { FormRequest } from '@beeblock/svelar/forms';
import { loginSchema } from './user.schema.js';

export class LoginRequest extends FormRequest {
  rules() {
    return loginSchema;
  }
}
```

```typescript
// Frontend — register form
import type { RegisterInput } from '$lib/modules/auth/contracts/schemas/user.schema';

let form: RegisterInput = {
  name: '',
  email: '',
  password: '',
  password_confirmation: '',
};
```

### Posts Module

```typescript
// src/lib/modules/posts/contracts/schemas/post.schema.ts
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
// src/lib/modules/posts/interface/http/requests/CreatePostRequest.ts
import { FormRequest } from '@beeblock/svelar/forms';
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
// src/lib/modules/posts/interface/http/requests/UpdatePostRequest.ts
import { FormRequest } from '@beeblock/svelar/forms';
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
// src/lib/modules/posts/interface/http/resources/PostResource.ts
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
// src/lib/modules/posts/interface/http/controllers/PostController.ts — thin controller
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

Zod remains the default validation provider. Here are common validation rules:

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
  token:    rules.uuid(),                         // any UUID version
  publicId: rules.uuidv7(),                       // UUID v7 public IDs
  ulid:     rules.ulid(),                         // ULID public IDs
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

The Zod `rules` helper is entirely optional — you can always use Zod directly. It's provided for developers familiar with Laravel's named validation rules.

## Valibot Validation Schema

Valibot apps import Valibot directly and use `v.InferOutput` for DTO/resource types:

```typescript
import * as v from 'valibot';

export const createPostSchema = v.object({
  title: v.pipe(v.string(), v.minLength(3, 'Title must be at least 3 characters'), v.maxLength(255)),
  slug: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'))),
  body: v.pipe(v.string(), v.minLength(10, 'Body must be at least 10 characters')),
  published: v.optional(v.boolean(), false),
});

export const updatePostSchema = v.partial(createPostSchema);

export type CreatePostInput = v.InferOutput<typeof createPostSchema>;
export type UpdatePostInput = v.InferOutput<typeof updatePostSchema>;
```

Cross-field validation uses `v.forward` so the error lands on the matching field:

```typescript
export const registerSchema = v.pipe(
  v.object({
    password: v.pipe(v.string(), v.minLength(8)),
    password_confirmation: v.string(),
  }),
  v.forward(
    v.check((data) => data.password === data.password_confirmation, 'Passwords do not match'),
    ['password_confirmation']
  )
);
```

## Valibot Laravel-like Validation Rules

Valibot apps can use the same Svelar rule names from the Valibot validation subpath:

```typescript
import { rules, v } from '@beeblock/svelar/validation/valibot';

const schema = v.object({
  name:     rules.required(),                     // v.pipe(v.string(), v.minLength(1))
  email:    rules.email(),                        // v.pipe(v.string(), v.email())
  age:      rules.integer(),                      // v.pipe(v.number(), v.integer())
  bio:      rules.string(10, 500),                // string with min/max length
  score:    rules.number(0, 100),                 // number with min/max value
  price:    rules.between(1, 999),                // number between values
  active:   rules.boolean(),                      // v.boolean()
  birthday: rules.date(),                         // coerces to Date, then validates
  website:  rules.url(),                          // URL string
  token:    rules.uuid(),                         // any UUID version
  publicId: rules.uuidv7(),                       // UUID v7 public IDs
  ulid:     rules.ulid(),                         // ULID public IDs
  role:     rules.enum(['admin', 'user']),         // v.picklist(['admin', 'user'])
  tags:     rules.array(rules.string()),          // array of strings
  phone:    rules.nullable(rules.string()),        // nullable string
  nickname: rules.optional(rules.string()),        // optional string
  slug:     rules.regex(/^[a-z0-9-]+$/),          // regex string
  ip:       rules.ip(),                           // IP validation
  config:   rules.json(),                         // valid JSON string
  min_age:  rules.min(18),                        // number >= 18
  max_size: rules.max(1024),                      // number <= 1024
});
```

Valibot also has a matching `validate` helper:

```typescript
import { rules, validate, v } from '@beeblock/svelar/validation/valibot';

const result = validate(v.object({ email: rules.email() }), { email: 'bad' });
// { success: false, errors: { email: [...] } }
```

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
// 1. Contract — src/lib/modules/posts/contracts/schemas/post.schema.ts
export const createPostSchema = z.object({
  title: z.string().min(3).max(255),
  body: z.string().min(10),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type PostData = z.infer<typeof postSchema>;

// 2. FormRequest — src/lib/modules/posts/interface/http/requests/CreatePostRequest.ts
export class CreatePostRequest extends FormRequest {
  rules() { return createPostSchema; }
  authorize(event: any) { return !!event.locals.user; }
}

// 3. Resource — src/lib/modules/posts/interface/http/resources/PostResource.ts
export class PostResource extends Resource<Post, PostData> {
  toJSON(): PostData { return { id: this.data.id, title: this.data.title, ... }; }
}

// 4. Controller — src/lib/modules/posts/interface/http/controllers/PostController.ts
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
import type { CreatePostInput, PostData } from '$lib/modules/posts/contracts/schemas/post.schema';
let form: CreatePostInput = { title: '', body: '' };
const { data } = await apiFetchJson<{ data: PostData }>('/api/posts', {
  method: 'POST',
  body: JSON.stringify(form),
});
```

## Nested JSON with Pivot Data

It's common for forms to submit a base model alongside related pivot data in a single request — for example, creating an order with its product line items. Svelar handles this naturally because Zod supports nested objects and arrays.

### 1. Define a nested schema

```typescript
// src/lib/modules/orders/contracts/schemas/schemas.ts
import { z } from 'zod';

export const createOrderSchema = z.object({
  // Base model fields
  customer_name: z.string().min(1),
  shipping_address: z.string().min(5),
  notes: z.string().optional(),

  // Pivot data (products with quantities)
  products: z.array(z.object({
    id: z.number(),
    quantity: z.number().min(1),
    price: z.number().positive(),
  })).min(1, 'At least one product is required'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
```

### 2. Create the FormRequest

```typescript
// src/lib/modules/orders/interface/http/requests/CreateOrderRequest.ts
import { FormRequest } from '@beeblock/svelar/forms';
import { createOrderSchema } from '../../../contracts/schemas/schemas.js';

export class CreateOrderRequest extends FormRequest {
  rules() {
    return createOrderSchema;
  }

  authorize(event: any): boolean {
    return !!event.locals.user;
  }
}
```

### 3. Handle in controller/service — split base fields from pivot data

```typescript
// src/lib/modules/orders/interface/http/controllers/OrderController.ts
import { Controller } from '@beeblock/svelar/routing';
import { CreateOrderRequest } from '../requests/CreateOrderRequest.js';
import { Order } from '../../../domain/models/Order.js';

export class OrderController extends Controller {
  async store(event: any) {
    const data = await CreateOrderRequest.validate(event);

    // Create the base model (fillable ignores the nested 'products' key)
    const order = await Order.create({
      customer_name: data.customer_name,
      shipping_address: data.shipping_address,
      notes: data.notes,
      user_id: event.locals.user.id,
    });

    // Attach pivot data with extra columns
    const products = order.products(); // belongsToMany relationship
    for (const item of data.products) {
      await products.attach(item.id, {
        quantity: item.quantity,
        price: item.price,
      });
    }

    return this.created(order);
  }
}
```

### 4. The model relationship

```typescript
// src/lib/modules/orders/domain/models/Order.ts
import { Model } from '@beeblock/svelar/orm';
import { Product } from '../products/Product';

export class Order extends Model {
  static table = 'orders';
  static fillable = ['customer_name', 'shipping_address', 'notes', 'user_id'];

  products() {
    return this.belongsToMany(Product, 'order_product', 'order_id', 'product_id');
  }
}
```

### Key points

- **Zod validates the full nested structure** including arrays of objects, so everything is type-safe before it reaches your service layer.
- **`Model.fillable` protects you** — even if you pass the entire validated object to `Model.create()`, only whitelisted columns are inserted. The nested `products` key is ignored.
- **`attach(id, pivotData)`** accepts extra pivot columns like `quantity` and `price`.
- **`sync(ids)`** replaces all pivot records — useful for update endpoints where the frontend sends the full list.
- **`passedValidation(data)`** can restructure the payload if needed (e.g., compute totals, normalize data).

### Update pattern with sync

For update endpoints where the frontend sends the complete list of related items:

```typescript
async update(event: any) {
  const data = await UpdateOrderRequest.validate(event);
  const order = await Order.findOrFail(event.params.id);

  order.fill({ customer_name: data.customer_name, shipping_address: data.shipping_address });
  await order.save();

  // Replace all product associations
  const productIds = data.products.map((p) => p.id);
  await order.products().sync(productIds);

  return this.json(order);
}
```

### Frontend example

```typescript
const orderData: CreateOrderInput = {
  customer_name: 'Alice',
  shipping_address: '123 Main St',
  products: [
    { id: 1, quantity: 2, price: 29.99 },
    { id: 5, quantity: 1, price: 49.99 },
  ],
};

const response = await apiFetch('/api/orders', {
  method: 'POST',
  body: JSON.stringify(orderData),
});
```

## Best Practices

1. **Use contract schemas** — Define Zod or Valibot schemas + types once in `*.schema.ts`, import everywhere
2. **Use FormRequest for API requests** — Encapsulates validation and authorization
3. **Import schemas, don't inline them** — `rules() { return createPostSchema; }` not `rules() { return z.object({...}); }`
4. **Provide helpful error messages** — Define them in the schema: `z.string().min(2, 'Too short')`
5. **Validate authorization in `authorize()`** — Keeps auth logic in one place
6. **Transform data in `passedValidation()`** — Hash passwords, slugify fields, etc.
7. **Keep controllers thin** — Validate with FormRequest, respond with Resource, logic in Services/Actions
8. **Share types with the frontend** — `import type { PostData } from '$lib/modules/posts/contracts/schemas/post.schema'`

## Next Steps

- Learn [Controllers & Routing](./04-controllers-routing.md) to use validation in handlers
- Explore [Services & Actions](./08-services-actions-repositories.md) for business logic
- Check [Models & ORM](./03-models-orm.md) to work with validated data

---

**Svelar Validation & DTOs Guide** © 2026
