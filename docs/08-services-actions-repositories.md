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
import { Repository } from 'svelar/repositories';
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
import { Repository } from 'svelar/repositories';
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
import { Service } from 'svelar/services';
import { Hash } from 'svelar/hashing';
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
import { CrudService } from 'svelar/services';
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

    // Emit event
    await this.emit('user:registered', user);

    return this.ok(user);
  }
}

// Listen to event elsewhere
import { EventDispatcher } from 'svelar/events';

EventDispatcher.listen('user:registered', async (user) => {
  // Send welcome email, create profile, etc.
  console.log('New user registered:', user.email);
});
```

## Actions

Actions encapsulate single, well-defined use cases. Each action does one thing well.

### Creating an Action

```bash
npx svelar make:action RegisterUserAction
```

This creates `src/lib/actions/RegisterUserAction.ts`:

```typescript
import { Action } from 'svelar/actions';
import { AuthService } from '../services/AuthService.js';
import type { User } from '../models/User.js';
import type { ServiceResult } from 'svelar/services';

interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

const authService = new AuthService();

export class RegisterUserAction extends Action<RegisterInput, ServiceResult<User>> {
  async execute(input: RegisterInput): Promise<ServiceResult<User>> {
    return authService.register(input);
  }
}
```

### Using Actions

```typescript
const registerAction = new RegisterUserAction();

const result = await registerAction.run({
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

### Action Hooks

Actions support hooks that run at specific lifecycle points:

```typescript
export class PublishPostAction extends Action<PublishInput, ServiceResult<Post>> {
  async execute(input: PublishInput): Promise<ServiceResult<Post>> {
    return postService.publish(input);
  }

  async beforeExecute(input: PublishInput): Promise<void> {
    console.log('Publishing post...');
  }

  async afterExecute(result: ServiceResult<Post>): Promise<void> {
    if (result.success) {
      console.log('Post published successfully');
    }
  }
}
```

### ChainableAction

Chain multiple actions together:

```typescript
import { ChainableAction } from 'svelar/actions';

const chain = new ChainableAction()
  .add(new CreatePostAction())
  .add(new PublishPostAction())
  .add(new SendNotificationAction());

const results = await chain.run({ title: 'Hello', body: '...' });
```

## Controller → Service → Action → Repository → Model Flow

Here's a complete example showing all layers from the svelar-example app:

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
import { Controller } from 'svelar/routing';
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
import { Action } from 'svelar/actions';
import { AuthService } from '../services/AuthService.js';
import type { ServiceResult } from 'svelar/services';

export class RegisterUserAction extends Action<RegisterInput, ServiceResult<User>> {
  async execute(input: RegisterInput): Promise<ServiceResult<User>> {
    return authService.register(input);
  }
}
```

### 4. Service

```typescript
// src/lib/services/AuthService.ts
import { Service } from 'svelar/services';
import { Hash } from 'svelar/hashing';
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
import { Repository } from 'svelar/repositories';
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
import { Model } from 'svelar/orm';

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
