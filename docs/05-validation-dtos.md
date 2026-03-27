# Validation & DTOs

Learn how to validate incoming data with FormRequest classes and Zod schemas.

## FormRequest Classes (DTOs)

FormRequest classes encapsulate validation logic and authorization checks. They're ideal for form submissions and API requests.

### Creating a FormRequest

```bash
npx svelar make:request CreatePostRequest
```

This creates `src/lib/dtos/CreatePostRequest.ts`:

```typescript
import { FormRequest } from 'svelar/routing';
import { z } from 'svelar/validation';

export class CreatePostRequest extends FormRequest {
  rules() {
    return z.object({
      title: z.string().min(3).max(255),
      slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
      body: z.string().min(10),
      published: z.boolean().optional().default(false),
    });
  }

  messages() {
    return {
      'title.too_small': 'Title must be at least 3 characters',
      'title.too_big': 'Title cannot exceed 255 characters',
      'body.too_small': 'Body must be at least 10 characters',
    };
  }

  authorize(event: any): boolean {
    // Only authenticated users can create posts
    return !!event.locals.user;
  }

  passedValidation(data: any) {
    // Transform data after validation
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

### Using FormRequest in Controllers

```typescript
import { CreatePostRequest } from '../dtos/CreatePostRequest.js';

export class PostController extends Controller {
  async store(event: any) {
    // Validate and authorize request
    // Throws FormValidationError (422) or FormAuthorizationError (403)
    // If passed, returns validated and transformed data
    const data = await CreatePostRequest.validate(event);

    // data is guaranteed to be valid
    return this.created(await Post.create(data));
  }
}
```

## FormRequest Methods

### rules()

Define Zod schema for validation:

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

## Complete FormRequest Examples

### Register Request

```typescript
// src/lib/dtos/RegisterRequest.ts
import { FormRequest } from 'svelar/routing';
import { z } from 'svelar/validation';

export class RegisterRequest extends FormRequest {
  rules() {
    return z.object({
      name: z.string().min(2).max(100),
      email: z.string().email(),
      password: z.string().min(8),
      password_confirmation: z.string(),
    }).refine((data) => data.password === data.password_confirmation, {
      message: 'Passwords do not match',
      path: ['password_confirmation'],
    });
  }

  messages() {
    return {
      'name.too_small': 'Name must be at least 2 characters',
      'email.invalid_string': 'Please enter a valid email address',
      'password.too_small': 'Password must be at least 8 characters',
    };
  }
}
```

### Login Request

```typescript
// src/lib/dtos/LoginRequest.ts
import { FormRequest } from 'svelar/routing';
import { z } from 'svelar/validation';

export class LoginRequest extends FormRequest {
  rules() {
    return z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
  }

  messages() {
    return {
      'email.invalid_string': 'Please enter a valid email address',
      'password.min_length': 'Password is required',
    };
  }
}
```

### Create Post Request with Authorization

```typescript
// src/lib/dtos/CreatePostRequest.ts
import { FormRequest } from 'svelar/routing';
import { z } from 'svelar/validation';

export class CreatePostRequest extends FormRequest {
  rules() {
    return z.object({
      title: z.string().min(3).max(255),
      slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
      body: z.string().min(10),
      published: z.boolean().optional().default(false),
    });
  }

  messages() {
    return {
      'title.too_small': 'Title must be at least 3 characters',
      'title.too_big': 'Title cannot exceed 255 characters',
      'body.too_small': 'Body must be at least 10 characters',
    };
  }

  authorize(event: any): boolean {
    // Only authenticated users can create posts
    return !!event.locals.user;
  }

  passedValidation(data: any) {
    // Auto-generate slug if not provided
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

### Update Post Request with Authorization

```typescript
// src/lib/dtos/UpdatePostRequest.ts
import { FormRequest } from 'svelar/routing';
import { z } from 'svelar/validation';
import { Post } from '../models/Post.js';

export class UpdatePostRequest extends FormRequest {
  rules() {
    return z.object({
      title: z.string().min(3).max(255).optional(),
      slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
      body: z.string().min(10).optional(),
      published: z.boolean().optional(),
    });
  }

  async authorize(event: any): Promise<boolean> {
    const post = await Post.find(event.params.id);
    if (!post) return false;

    // Only the post author can update it
    return post.user_id === event.locals.user?.id;
  }
}
```

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
import { validate, z } from 'svelar/validation';

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
import { rules, z } from 'svelar/validation';

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

## Validation Example in Action

Here's a complete flow in the svelar-example app:

```typescript
// Route handler
// src/routes/api/posts/+server.ts
import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();
export const POST = ctrl.handle('store');

// Controller
// src/lib/controllers/PostController.ts
export class PostController extends Controller {
  async store(event: any) {
    const data = await CreatePostRequest.validate(event);
    // data is validated, authorized, and transformed

    const post = await createPostAction.run({
      userId: event.locals.user.id,
      ...data,
    });

    return this.created(post);
  }
}

// DTO (FormRequest)
// src/lib/dtos/CreatePostRequest.ts
export class CreatePostRequest extends FormRequest {
  rules() {
    return z.object({
      title: z.string().min(3).max(255),
      slug: z.string().optional(),
      body: z.string().min(10),
      published: z.boolean().optional().default(false),
    });
  }

  authorize(event: any): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: any) {
    if (!data.slug) {
      data.slug = data.title.toLowerCase().replace(/\s+/g, '-');
    }
    return data;
  }
}
```

## Best Practices

1. **Use FormRequest for API requests** - Encapsulates validation and authorization
2. **Keep validation rules in `rules()`** - Makes it easy to see what's validated
3. **Provide helpful error messages** - Use `messages()` for user-friendly errors
4. **Validate authorization in `authorize()`** - Keeps authorization logic in one place
5. **Transform data in `passedValidation()`** - Hash passwords, slugify fields, etc. here
6. **Use Zod's built-in validation** - Don't write custom validators for common patterns
7. **Test your validation** - Write tests for edge cases in your schemas

## Next Steps

- Learn [Controllers & Routing](./04-controllers-routing.md) to use validation in handlers
- Explore [Services & Actions](./08-services-actions-repositories.md) for business logic
- Check [Models & ORM](./03-models-orm.md) to work with validated data

---

**Svelar Validation & DTOs Guide** © 2026
