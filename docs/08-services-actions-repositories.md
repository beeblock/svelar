# Services, Actions & Repositories

Learn about the business logic layers in Svelar: services, actions, and repositories.

## Architecture Overview

Svelar follows a layered architecture for clean separation of concerns:

```
Controller
    ↓
Service (orchestrate operations)
    ↓
Action (single use-case)
    ↓
Repository (data access)
    ↓
Model (ORM)
```

This architecture keeps controllers thin, makes code reusable, and improves testability.

## Repositories

Repositories abstract data access and provide a clean interface to query models.

### Creating a Repository

```bash
npx svelar make:repository UserRepository
```

This creates `src/lib/repositories/UserRepository.ts`:

```typescript
import { Repository } from '@beeblock/svelar/repositories';
import { User } from '../models/User.js';

export class UserRepository extends Repository<User> {
  model() {
    return User;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.query().where('email', email).first();
  }

  async findWithPosts(id: number): Promise<User | null> {
    return this.query().with('posts').find(id);
  }

  async findActive(): Promise<User[]> {
    return this.query().where('active', true).get();
  }
}
```

### Repository Methods

Repositories extend the base `Repository<T>` class which provides:

```typescript
export class UserRepository extends Repository<User> {
  model() {
    return User; // Return model class
  }

  // Built-in CRUD methods from Repository base class:
  // await repo.all()                    - Get all
  // await repo.find(id)                 - Get by ID
  // await repo.findOrFail(id)           - Get or throw
  // await repo.first()                  - Get first
  // await repo.paginate(page, perPage)  - Paginate
  // await repo.count()                  - Count all
  // await repo.create(attributes)       - Create new
  // await repo.update(id, attributes)   - Update
  // await repo.delete(id)               - Delete

  // Custom query methods:
  query() {
    return this.model().query();
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.query().where('email', email).first();
  }

  async findWithPosts(id: number): Promise<User | null> {
    return this.query().with('posts').find(id);
  }

  async findActive(): Promise<User[]> {
    return this.query().where('active', true).get();
  }
}
```

### Using Repositories

```typescript
const userRepo = new UserRepository();

// Use built-in methods
const user = await userRepo.find(1);
const users = await userRepo.all();
const count = await userRepo.count();

// Use custom methods
const user = await userRepo.findByEmail('john@example.com');
const user = await userRepo.findWithPosts(1);
const activeUsers = await userRepo.findActive();

// Create/Update/Delete
const user = await userRepo.create({ name: 'John', email: 'john@example.com' });
await userRepo.update(1, { name: 'Jane' });
await userRepo.delete(1);
```

### Post Repository Example

```typescript
// src/lib/repositories/PostRepository.ts
import { Repository } from '@beeblock/svelar/repositories';
import { Post } from '../models/Post.js';

export class PostRepository extends Repository<Post> {
  model() {
    return Post;
  }

  async findPublished(): Promise<Post[]> {
    return this.query()
      .where('published', true)
      .orderBy('created_at', 'desc')
      .get();
  }

  async findByUser(userId: number): Promise<Post[]> {
    return this.query()
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .get();
  }

  async findBySlug(slug: string): Promise<Post | null> {
    return this.query().where('slug', slug).first();
  }

  async findWithAuthor(id: number): Promise<Post | null> {
    return this.query().with('author').find(id);
  }

  async findPublishedWithAuthor(): Promise<Post[]> {
    return this.query()
      .where('published', true)
      .with('author')
      .orderBy('created_at', 'desc')
      .get();
  }
}
```

## Services

Services orchestrate multiple operations, coordinate repositories, emit events, and return typed results.

### Creating a Service

```bash
npx svelar make:service AuthService
```

This creates `src/lib/services/AuthService.ts`:

```typescript
import { Service } from '@beeblock/svelar/services';
import { Hash } from '@beeblock/svelar/hashing';
import { UserRepository } from '../repositories/UserRepository.js';

const userRepo = new UserRepository();

export class AuthService extends Service {
  async register(data: { name: string; email: string; password: string }) {
    // Check if email already exists
    const existing = await userRepo.findByEmail(data.email);
    if (existing) {
      return this.fail('Email already registered');
    }

    // Hash password
    const hashedPassword = await Hash.make(data.password);

    // Create user
    const user = await userRepo.create({
      name: data.name,
      email: data.email,
      password: hashedPassword,
    });

    // Emit event
    await this.emit('user:registered', user);

    return this.ok(user);
  }

  async login(email: string, password: string) {
    const user = await userRepo.findByEmail(email);
    if (!user) {
      return this.fail('Invalid credentials');
    }

    const valid = await Hash.verify(password, (user as any).password);
    if (!valid) {
      return this.fail('Invalid credentials');
    }

    return this.ok(user);
  }
}
```

### Service Result Type

Services return `ServiceResult<T>` which is either a success or failure:

```typescript
// Success result
return this.ok(user);
// {
//   success: true,
//   data: User,
//   error: null
// }

// Failure result
return this.fail('Invalid credentials');
// {
//   success: false,
//   data: null,
//   error: 'Invalid credentials'
// }
```

Using the result:

```typescript
const result = await authService.login(email, password);

if (!result.success) {
  console.error(result.error);
  return;
}

const user = result.data;
```

### CrudService

For standard CRUD operations, extend `CrudService`:

```typescript
import { CrudService } from '@beeblock/svelar/services';
import { PostRepository } from '../repositories/PostRepository.js';
import type { Post } from '../models/Post.js';

const postRepo = new PostRepository();

export class PostService extends CrudService<Post> {
  protected repository() {
    return postRepo;
  }

  async findPublished(): Promise<Post[]> {
    return postRepo.findPublished();
  }

  async findByUser(userId: number): Promise<Post[]> {
    return postRepo.findByUser(userId);
  }
}
```

`CrudService` automatically provides:

```typescript
// All CRUD methods from Repository
await service.all()
await service.find(id)
await service.findOrFail(id)
await service.first()
await service.paginate(page, perPage)
await service.count()
await service.create(attributes)
await service.update(id, attributes)
await service.delete(id)

// Plus service-specific methods
await service.findPublished()
await service.findByUser(userId)
```

### Service Events

Services can emit events for other parts of the application to listen to:

```typescript
export class AuthService extends Service {
  async register(data: any) {
    const user = await userRepo.create(data);

    // Emit domain event
    await this.emit('user:registered', user);

    return this.ok(user);
  }
}

// Listen to event elsewhere (or in your EventServiceProvider)
import { Event } from '@beeblock/svelar/events';

Event.listen('user:registered', async (user) => {
  // Send welcome email, create profile, etc.
  console.log('New user registered:', user.email);
});
```

For the full events system including typed event classes, listeners, and the EventServiceProvider, see [Events & Listeners](./23-events.md).

## Actions

Actions encapsulate single, well-defined use cases. Each action does one thing well. They support before/after hooks, middleware pipelines, safe execution, and chaining.

### Creating an Action

```bash
npx svelar make:action RegisterUser --module=auth
```

This creates `src/lib/modules/auth/RegisterUserAction.ts`:

```typescript
import { Action } from '@beeblock/svelar/actions';
import { Hash } from '@beeblock/svelar/hashing';
import { User } from './User.js';

interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export class RegisterUserAction extends Action<RegisterInput, User> {
  async execute(input: RegisterInput): Promise<User> {
    const user = await User.create({
      name: input.name,
      email: input.email,
      password: await Hash.make(input.password),
    });
    return user;
  }
}
```

### Using Actions

```typescript
const action = new RegisterUserAction();

// Standard execution — throws on error
const user = await action.run({
  name: 'John Doe',
  email: 'john@example.com',
  password: 'password123',
});

// Safe execution — returns ActionResult (never throws)
const result = await action.runSafe({
  name: 'John Doe',
  email: 'john@example.com',
  password: 'password123',
});

if (result.success) {
  console.log('User registered:', result.data);
} else {
  console.error('Registration failed:', result.error);
}
```

### Inline Actions

For simple one-off actions without creating a class:

```typescript
import { inlineAction } from '@beeblock/svelar/actions';

const sendEmail = inlineAction(async (data: { to: string; body: string }) => {
  await mailer.send(data);
  return { sent: true };
});

await sendEmail.run({ to: 'user@example.com', body: 'Hello!' });
```

### Action Hooks (Before/After)

Attach hooks that run before or after the action executes:

```typescript
const action = new RegisterUserAction();

// Before hook — runs before execute()
action.before(async (input) => {
  console.log('Registering:', input.email);
  // Validate, transform, log, etc.
});

// After hook — runs after execute() with both input and output
action.after(async (input, user) => {
  console.log('Registered user:', user.getAttribute('id'));
  await Event.dispatch(new UserRegistered(user));
});

const user = await action.run({ name: 'Jane', email: 'jane@test.com', password: 'secret' });
```

Hooks are chainable:

```typescript
const user = await new RegisterUserAction()
  .before((input) => { input.email = input.email.toLowerCase(); })
  .after((input, user) => { console.log('Created user:', user.getAttribute('id')); })
  .run(data);
```

### Action Middleware

Actions support a middleware pipeline — each middleware receives the input and a `next` function:

```typescript
import type { ActionMiddleware } from '@beeblock/svelar/actions';

// Middleware that logs execution time
const timingMiddleware: ActionMiddleware<RegisterInput> = async (input, next) => {
  const start = Date.now();
  const result = await next(input);
  console.log(`RegisterUserAction took ${Date.now() - start}ms`);
  return result;
};

// Middleware that validates input
const validateMiddleware: ActionMiddleware<RegisterInput> = async (input, next) => {
  if (!input.email.includes('@')) {
    throw new Error('Invalid email');
  }
  return next(input);
};

const user = await new RegisterUserAction()
  .through(validateMiddleware)
  .through(timingMiddleware)
  .run(data);
```

Middleware executes in the order it's added. Each middleware can:
- Modify the input before calling `next()`
- Modify the result after `next()` returns
- Halt the chain by not calling `next()` or throwing

### Chainable Actions

When the output of one action becomes the input of the next, use `ChainableAction`:

```typescript
import { ChainableAction } from '@beeblock/svelar/actions';

// Step 1: Parse raw CSV data into rows
class ParseCsv extends ChainableAction<string, string[][]> {
  async execute(csv: string) {
    return csv.split('\n').map(row => row.split(','));
  }
}

// Step 2: Validate rows
class ValidateRows extends ChainableAction<string[][], ValidatedRow[]> {
  async execute(rows: string[][]) {
    return rows
      .filter(row => row.length === 3)
      .map(([name, email, role]) => ({ name, email, role }));
  }
}

// Step 3: Import into database
class ImportUsers extends ChainableAction<ValidatedRow[], ImportResult> {
  async execute(rows: ValidatedRow[]) {
    let imported = 0;
    for (const row of rows) {
      await User.create(row);
      imported++;
    }
    return { imported, total: rows.length };
  }
}

// Chain them: ParseCsv → ValidateRows → ImportUsers
const importPipeline = new ParseCsv()
  .then(new ValidateRows())
  .then(new ImportUsers());

const result = await importPipeline.run(csvString);
// result: { imported: 42, total: 50 }
```

Each action in the chain is **type-safe** — TypeScript ensures the output type of one matches the input type of the next.

### ChainableAction vs Pipeline

Both process data through steps, but they serve different purposes:

| | ChainableAction | Pipeline |
|---|---|---|
| **Each step is** | An Action class with `execute()` | A Pipe class with `handle(data, next)` or inline function |
| **Step control** | Each step runs fully, output feeds into next | Each step can halt, skip, or modify before/after `next()` |
| **Typing** | Output of step N must match input of step N+1 | All steps share the same type `T` |
| **Best for** | Typed transformations: CSV → rows → users | Processing with guards: validate → discount → tax → charge |
| **Hooks** | Before/after hooks on each action | Error handler via `onCatch()` |

**Use ChainableAction** when each step transforms data into a different shape (type changes at each step).

**Use Pipeline** when each step processes/modifies the same data shape (type stays the same throughout).

```typescript
// ChainableAction — types change at each step
// string → string[][] → ValidatedRow[] → ImportResult
new ParseCsv().then(new ValidateRows()).then(new ImportUsers());

// Pipeline — same type throughout
// OrderData → OrderData → OrderData → OrderData
Pipeline.send(order).through([ValidateStock, ApplyDiscount, CalculateTax, ChargePayment]);
```

## Pipelines

Pipelines implement the Chain of Responsibility pattern — data flows through a sequence of pipes where each pipe can transform, validate, or halt the chain. See [Architecture & Module Communication](./20-architecture.md#pipelines-chain-of-responsibility) for full documentation.

```typescript
import { Pipeline } from '@beeblock/svelar/support';

// Process an order through multiple steps
const processedOrder = await Pipeline.send(order)
  .through([ValidateStock, ApplyDiscount, CalculateTax, ChargePayment])
  .thenReturn();

// With a final destination callback
const invoice = await Pipeline.send(order)
  .through([ValidateStock, ApplyDiscount, CalculateTax, ChargePayment])
  .then(async (order) => {
    return Invoice.create({ user_id: order.userId, total: order.total });
  });

// With error handling
const result = await Pipeline.send(order)
  .through([ValidateStock, ApplyDiscount, CalculateTax, ChargePayment])
  .onCatch(async (error, order) => {
    order.status = 'failed';
    order.error = error.message;
    return order;
  })
  .thenReturn();
```

### Creating Pipes

```typescript
import type { Pipe } from '@beeblock/svelar/support';

class ValidateStock implements Pipe<OrderData> {
  async handle(order: OrderData, next: (order: OrderData) => Promise<OrderData>) {
    for (const item of order.items) {
      const product = await Product.find(item.productId);
      if (product.getAttribute('stock') < item.quantity) {
        throw new Error(`Insufficient stock for product ${item.productId}`);
      }
    }
    return next(order); // Pass to next pipe
  }
}

class ApplyDiscount implements Pipe<OrderData> {
  async handle(order: OrderData, next: (order: OrderData) => Promise<OrderData>) {
    if (order.couponCode) {
      const coupon = await Coupon.where('code', order.couponCode).first();
      if (coupon) {
        order.discount = coupon.getAttribute('percentage') / 100;
      }
    }
    return next(order);
  }
}
```

### Inline Pipes

```typescript
const result = await Pipeline.send(data)
  .through([
    async (data, next) => {
      data.email = data.email.trim().toLowerCase();
      return next(data);
    },
    ValidateUnique,
    async (data, next) => {
      data.password = await Hash.make(data.password);
      return next(data);
    },
  ])
  .thenReturn();
```

### Real-World Pipeline Examples

**Content publishing:**

```typescript
await Pipeline.send(post)
  .through([SanitizeHtml, ParseMarkdown, GenerateSlug, OptimizeImages, UpdateSearchIndex])
  .thenReturn();
```

**User onboarding:**

```typescript
await Pipeline.send(registrationData)
  .through([ValidateEmail, HashPassword, CreateUser, AssignRole, CreateWorkspace, SendWelcome])
  .thenReturn();
```

**Data import:**

```typescript
await Pipeline.send(csvRows)
  .through([ValidateHeaders, NormalizeData, Deduplicate, ValidateRules, InsertBatches])
  .thenReturn();
```

### Pipelines + Events Together

Use pipelines for sequential processing, then fire an event when done:

```typescript
const order = await Pipeline.send(orderData)
  .through([ValidateStock, ApplyDiscount, CalculateTax, ChargePayment])
  .thenReturn();

// Notify other modules
await Event.dispatch(new OrderCompleted(order));
```

## Controller → Service → Action → Repository → Model Flow

Here's a complete example showing all layers from a scaffolded Svelar project:

### 1. Route Handler

```typescript
// src/routes/api/auth/register/+server.ts
import { AuthController } from '$lib/controllers/AuthController.js';

const ctrl = new AuthController();
export const POST = ctrl.handle('register');
```

### 2. Controller

```typescript
// src/lib/controllers/AuthController.ts
import { Controller } from '@beeblock/svelar/routing';
import { RegisterRequest } from '../dtos/RegisterRequest.js';
import { RegisterUserAction } from '../actions/RegisterUserAction.js';

export class AuthController extends Controller {
  async register(event: any) {
    const data = await RegisterRequest.validate(event);

    const result = await registerAction.run({
      name: data.name,
      email: data.email,
      password: data.password,
    });

    if (!result.success) {
      return this.json({ message: result.error }, 422);
    }

    const user = result.data!;
    event.locals.session.set('auth_user_id', (user as any).id);

    return this.created({
      message: 'Registration successful',
      user: { id: (user as any).id, name: (user as any).name, email: (user as any).email },
    });
  }
}
```

### 3. Action

```typescript
// src/lib/actions/RegisterUserAction.ts
import { Action } from '@beeblock/svelar/actions';
import { AuthService } from '../services/AuthService.js';
import type { ServiceResult } from '@beeblock/svelar/services';

export class RegisterUserAction extends Action<RegisterInput, ServiceResult<User>> {
  async execute(input: RegisterInput): Promise<ServiceResult<User>> {
    return authService.register(input);
  }
}
```

### 4. Service

```typescript
// src/lib/services/AuthService.ts
import { Service } from '@beeblock/svelar/services';
import { Hash } from '@beeblock/svelar/hashing';
import { UserRepository } from '../repositories/UserRepository.js';

export class AuthService extends Service {
  async register(data: any) {
    const existing = await userRepo.findByEmail(data.email);
    if (existing) {
      return this.fail('Email already registered');
    }

    const hashedPassword = await Hash.make(data.password);
    const user = await userRepo.create({
      name: data.name,
      email: data.email,
      password: hashedPassword,
    });

    await this.emit('user:registered', user);
    return this.ok(user);
  }
}
```

### 5. Repository

```typescript
// src/lib/repositories/UserRepository.ts
import { Repository } from '@beeblock/svelar/repositories';
import { User } from '../models/User.js';

export class UserRepository extends Repository<User> {
  model() {
    return User;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.query().where('email', email).first();
  }
}
```

### 6. Model

```typescript
// src/lib/models/User.ts
import { Model } from '@beeblock/svelar/orm';

export class User extends Model {
  static table = 'users';
  static timestamps = true;
  static fillable = ['name', 'email', 'password'];
  static hidden = ['password'];

  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
}
```

## Best Practices

1. **Controllers delegate to services** - Controllers should be thin request handlers
2. **Services orchestrate operations** - Compose multiple repositories and actions
3. **Actions encapsulate use cases** - Each action should do one thing well
4. **Repositories abstract data access** - Never query models directly in services
5. **Keep models simple** - Models define data, relationships, and basic queries
6. **Use strong typing** - Define input/output types for better IDE support
7. **Emit events** - Use events for loose coupling between components
8. **Test services** - Unit test services independently from HTTP layer

## Next Steps

- Learn [Controllers & Routing](./04-controllers-routing.md) to use services
- Explore [Validation](./05-validation-dtos.md) to validate service inputs
- Check [Models & ORM](./03-models-orm.md) for data modeling

---

**Svelar Services, Actions & Repositories Guide** © 2026
